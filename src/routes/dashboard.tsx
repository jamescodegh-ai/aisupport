import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { agentReply, setConversationStatus, markConversationRead } from "@/lib/ai.functions";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Agent Dashboard — WolvCapital" }] }),
  component: Dashboard,
});

type Conv = { id: string; visitor_id: string; status: "ai" | "human" | "closed"; assigned_agent_id: string | null; unread_agent_count: number; last_message_at: string; last_message_preview: string | null; site_id: string | null };
type Visitor = { id: string; session_id: string; name: string | null; email: string | null; ip: string | null; country: string | null; city: string | null; region: string | null; timezone: string | null; language: string | null; browser: string | null; os: string | null; device_type: string | null; screen_width: number | null; screen_height: number | null; current_page: string | null; last_seen: string; first_seen: string; is_returning: boolean | null };
type Msg = { id: string; conversation_id: string; role: "visitor" | "ai" | "agent" | "system"; content: string; created_at: string };
type PageView = { id: string; url: string; title: string | null; viewed_at: string };

// Notification sound (inline beep via Web Audio API — no file needed)
function playBeep(type: "visitor" | "message" | "escalation" = "message") {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = type === "escalation" ? 880 : type === "visitor" ? 440 : 660;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
  } catch { /* ignore */ }
}

function Dashboard() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const { permission, subscribed, subscribe } = usePushNotifications(authToken);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [visitors, setVisitors] = useState<Record<string, Visitor>>({});
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pageViews, setPageViews] = useState<PageView[]>([]);
  const [input, setInput] = useState("");
  const [mobilePane, setMobilePane] = useState<"inbox" | "thread" | "info">("inbox");
  const [statusLoading, setStatusLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [notifications, setNotifications] = useState<{ id: string; type: string; text: string; conv_id?: string }[]>([]);
  const msgsRef = useRef<HTMLDivElement>(null);
  const pageViewsRef = useRef<HTMLDivElement>(null);
  const knownConvIds = useRef<Set<string>>(new Set());
  const knownVisitorIds = useRef<Set<string>>(new Set());
  const reply = useServerFn(agentReply);
  const setStatus = useServerFn(setConversationStatus);
  const markRead = useServerFn(markConversationRead);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate({ to: "/auth" });
      else {
        const token = data.session.access_token;
        setAuthed(true); setAuthToken(token);
        const origFetch = window.__wolvOrigFetch || window.fetch;
        window.__wolvOrigFetch = origFetch;
        window.fetch = function(input, init) {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
          if (url.includes('/_serverFn/')) {
            init = init || {};
            init.headers = Object.assign({}, init.headers, { 'Authorization': 'Bearer ' + token });
          }
          return origFetch.call(this, input, init);
        };
      }
    });
  }, [navigate]);

  // Open conversation from push notification click
  useEffect(() => {
    const handler = (e: Event) => {
      const conv_id = (e as CustomEvent).detail?.conversation_id;
      if (conv_id) { setActive(conv_id); setMobilePane("thread"); }
    };
    window.addEventListener("push:open_conversation", handler);
    return () => window.removeEventListener("push:open_conversation", handler);
  }, []);

  const addNotif = useCallback((type: string, text: string, conv_id?: string) => {
    const id = Math.random().toString(36).slice(2);
    setNotifications((prev) => [{ id, type, text, conv_id }, ...prev].slice(0, 5));
    setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 6000);
  }, []);

  const loadAll = useCallback(async () => {
    const { data: c } = await supabase.from("conversations").select("*").order("last_message_at", { ascending: false }).limit(100);
    const convList = (c as Conv[]) ?? [];

    // Detect new conversations (new visitors)
    convList.forEach((conv) => {
      if (!knownConvIds.current.has(conv.id)) {
        if (knownConvIds.current.size > 0) {
          // New conversation arrived after initial load
          playBeep("visitor");
          addNotif("visitor", "New visitor started a conversation", conv.id);
        }
        knownConvIds.current.add(conv.id);
      }
    });

    setConvs(convList);
    if (convList.length) {
      const ids = [...new Set(convList.map((x) => x.visitor_id))];
      const { data: vs } = await supabase.from("visitors").select("*").in("id", ids);
      const map: Record<string, Visitor> = {};
      (vs as Visitor[] | null)?.forEach((v) => {
        // Detect returning visitor notification
        if (!knownVisitorIds.current.has(v.id)) {
          knownVisitorIds.current.add(v.id);
        } else if (v.is_returning) {
          // Visitor seen again — already in our map, check last_seen freshness
        }
        map[v.id] = v;
      });
      setVisitors(map);
    }
  }, [addNotif]);

  useEffect(() => {
    if (!authed) return;
    loadAll();

    const ch = supabase.channel("dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, loadAll)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
        const m = p.new as Msg;
        if (!m) return;

        // Sound + notification for new visitor messages
        if (m.role === "visitor") {
          playBeep("message");
          addNotif("message", m.content.slice(0, 60), m.conversation_id);
        }
        if (m.role === "system" && m.content.includes("escalated")) {
          playBeep("escalation");
          addNotif("escalation", "⚡ Escalated to human agent", m.conversation_id);
        }

        setMsgs((prev) => {
          if (!prev.length) return prev; // no active conv loaded
          if (m.conversation_id !== active) return prev;
          return prev.some((x) => x.id === m.id) ? prev : [...prev, m];
        });
        loadAll();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "visitors" }, (p) => {
        const v = p.new as Visitor;
        if (v && v.is_returning) {
          // Check if this visitor has an open conversation in our list
          const existingConv = convs.find((c) => c.visitor_id === v.id);
          if (existingConv) {
            playBeep("visitor");
            addNotif("returning", `↩ ${v.name || v.session_id?.slice(0, 8) || "Visitor"} returned — ${v.current_page?.replace(/^https?:\/\/[^/]+/, "") || "/"}`, existingConv.id);
          }
        }
        loadAll();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "page_views" }, (p) => {
        const pv = p.new as PageView & { visitor_id: string };
        const activeConvObj = convs.find((c) => c.id === active);
        if (active && activeConvObj && visitors[activeConvObj.visitor_id]?.id === pv.visitor_id) {
          setPageViews((prev) => [pv, ...prev].slice(0, 30));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, active, loadAll]);

  useEffect(() => {
    if (!active) { setMsgs([]); setPageViews([]); return; }
    supabase.from("messages").select("*").eq("conversation_id", active).order("created_at").then(({ data }) => setMsgs((data as Msg[]) ?? []));
    const conv = convs.find((c) => c.id === active);
    if (conv) {
      supabase.from("page_views").select("*").eq("visitor_id", conv.visitor_id).order("viewed_at", { ascending: false }).limit(30).then(({ data }) => setPageViews((data as PageView[]) ?? []));
      if (conv.unread_agent_count > 0) markRead({ data: { conversation_id: active } });
    }
  }, [active, convs, markRead]);

  useEffect(() => { msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight }); }, [msgs]);
  useEffect(() => { pageViewsRef.current?.scrollTo({ top: 0 }); }, [pageViews]);

  // ── Status change with debounce guard ──
  async function changeStatus(status: "ai" | "human" | "closed") {
    if (!active || statusLoading) return;
    setStatusLoading(true);
    try {
      await setStatus({ data: { conversation_id: active, status } });
      // Optimistically update local state immediately
      setConvs((prev) => prev.map((c) => c.id === active ? { ...c, status } : c));
    } finally {
      // Delay re-enable to prevent double-tap
      setTimeout(() => setStatusLoading(false), 1500);
    }
  }

  async function send() {
    if (!input.trim() || !active || sendLoading) return;
    const text = input; setInput("");
    setSendLoading(true);
    try {
      await reply({ data: { conversation_id: active, content: text } });
    } finally {
      setSendLoading(false);
    }
  }

  async function signOut() { await supabase.auth.signOut(); navigate({ to: "/auth" }); }

  if (!authed) return <div className="min-h-screen bg-[#06101f] text-white flex items-center justify-center">Loading...</div>;

  const activeConv = convs.find((c) => c.id === active);
  const activeVisitor = activeConv ? visitors[activeConv.visitor_id] : null;
  const totalUnread = convs.reduce((s, c) => s + (c.unread_agent_count || 0), 0);

  function openConv(id: string) { setActive(id); setMobilePane("thread"); }

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row bg-[#06101f] text-white text-sm relative">

      {/* ── Toast notifications ── */}
      <div className="fixed top-3 right-3 z-50 flex flex-col gap-2 pointer-events-none">
        {notifications.map((n) => (
          <button
            key={n.id}
            onClick={() => { if (n.conv_id) { setActive(n.conv_id); setMobilePane("thread"); } setNotifications((p) => p.filter((x) => x.id !== n.id)); }}
            className="pointer-events-auto text-left bg-[#0a1628] border border-[#d4af37] rounded-lg px-4 py-2.5 shadow-xl max-w-xs animate-in slide-in-from-right"
          >
            <div className="text-[10px] text-[#d4af37] uppercase font-semibold mb-0.5">
              {n.type === "visitor" ? "🟢 New Visitor" : n.type === "message" ? "💬 New Message" : n.type === "escalation" ? "⚡ Escalation" : "↩ Returned"}
            </div>
            <div className="text-xs text-[#e5e7eb] truncate max-w-[240px]">{n.text}</div>
          </button>
        ))}
      </div>

      {/* ── Sidebar / Inbox ── */}
      <aside className={`${mobilePane === "inbox" ? "flex" : "hidden"} md:flex w-full md:w-80 border-r border-[#1e3a5f] flex-col flex-1 md:flex-none min-h-0`}>
        <div className="p-3 sm:p-4 border-b border-[#1e3a5f] grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="w-8 h-8 shrink-0 rounded bg-[#d4af37] text-[#0a1628] font-bold flex items-center justify-center">W</div>
            <div className="min-w-0">
              <div className="font-semibold text-xs truncate">WolvCapital</div>
              <div className="text-[10px] text-[#8aa0c0] truncate">
                Inbox · {convs.length} {totalUnread > 0 && <span className="bg-red-500 text-white rounded-full px-1.5">{totalUnread}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {permission !== "granted" && !subscribed && (
              <button onClick={subscribe} title="Enable desktop notifications" className="text-[10px] bg-[#d4af37] text-[#0a1628] px-2 py-1 rounded font-semibold">🔔 Enable</button>
            )}
            {(permission === "granted" || subscribed) && (
              <span title="Desktop notifications active" className="text-[10px] text-[#10b981]">🔔 On</span>
            )}
            <a href="/kb" className="text-[10px] text-[#8aa0c0] hover:text-[#d4af37]">KB</a>
            <button onClick={signOut} className="text-[10px] text-[#8aa0c0] hover:text-[#d4af37]">Sign out</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {convs.map((c) => {
            const v = visitors[c.visitor_id];
            const isActive = c.id === active;
            return (
              <button key={c.id} onClick={() => openConv(c.id)} className={`w-full text-left p-3 border-b border-[#0f2138] hover:bg-[#0a1628] transition-colors ${isActive ? "bg-[#0a1628] border-l-2 border-l-[#d4af37]" : ""}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="font-medium text-xs truncate min-w-0">{v?.name || v?.email || (v?.session_id?.slice(0, 12) ?? "Visitor")}</div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.status === "human" && <span className="text-[9px] bg-[#d4af37] text-[#0a1628] px-1.5 py-0.5 rounded font-semibold">LIVE</span>}
                    {c.status === "ai" && <span className="text-[9px] bg-[#1e3a5f] text-[#8aa0c0] px-1.5 py-0.5 rounded">AI</span>}
                    {c.status === "closed" && <span className="text-[9px] bg-[#0f2138] text-[#6b7d99] px-1.5 py-0.5 rounded">CLOSED</span>}
                    {c.unread_agent_count > 0 && <span className="text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold">{c.unread_agent_count}</span>}
                  </div>
                </div>
                <div className="text-[11px] text-[#8aa0c0] truncate">{c.last_message_preview || "—"}</div>
                <div className="text-[10px] text-[#6b7d99] mt-0.5 truncate">
                  {v?.country ? `${v.city ?? ""} ${v.country}`.trim() : v?.ip ?? ""}
                  {v?.is_returning && <span className="ml-1 text-[#d4af37]">↩</span>}
                </div>
              </button>
            );
          })}
          {!convs.length && <div className="p-6 text-center text-xs text-[#6b7d99]">No conversations yet.</div>}
        </div>
      </aside>

      {/* ── Thread ── */}
      <main className={`${mobilePane === "thread" ? "flex" : "hidden"} md:flex flex-1 flex-col min-h-0 min-w-0`}>
        {!active && <div className="flex-1 hidden md:flex items-center justify-center text-[#6b7d99]">Select a conversation</div>}
        {active && activeConv && (
          <>
            {/* Header */}
            <div className="p-3 sm:p-4 border-b border-[#1e3a5f] grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
              <button onClick={() => setMobilePane("inbox")} className="md:hidden text-[#8aa0c0] hover:text-[#d4af37] text-lg leading-none px-1" aria-label="Back">←</button>
              <div className="min-w-0">
                <div className="font-semibold truncate text-sm sm:text-base">{activeVisitor?.name || activeVisitor?.email || "Anonymous visitor"}</div>
                <div className="text-[11px] text-[#8aa0c0] flex items-center gap-2">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${activeConv.status === "human" ? "bg-[#d4af37]" : activeConv.status === "ai" ? "bg-[#10b981]" : "bg-[#6b7d99]"}`} />
                  {activeConv.status === "human" ? "Agent handling" : activeConv.status === "ai" ? "AI handling" : "Closed"}
                  {activeVisitor?.current_page && <span className="text-[10px] text-[#6b7d99] truncate hidden sm:block">· {activeVisitor.current_page.replace(/^https?:\/\/[^/]+/, "") || "/"}</span>}
                </div>
              </div>
              <button onClick={() => setMobilePane("info")} className="md:hidden text-[10px] text-[#8aa0c0] hover:text-[#d4af37] border border-[#1e3a5f] px-2 py-1 rounded">Info</button>
            </div>

            {/* Action bar */}
            <div className="px-3 sm:px-4 pt-2 pb-3 border-b border-[#1e3a5f] flex flex-wrap gap-2 items-center">
              {activeConv.status === "ai" && (
                <button
                  onClick={() => changeStatus("human")}
                  disabled={statusLoading}
                  className="text-xs bg-[#d4af37] text-[#0a1628] px-3 py-1.5 rounded font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {statusLoading ? "..." : "🙋 Take over"}
                </button>
              )}
              {activeConv.status === "human" && (
                <button
                  onClick={() => changeStatus("ai")}
                  disabled={statusLoading}
                  className="text-xs bg-[#162846] border border-[#1e3a5f] px-3 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:border-[#d4af37]"
                >
                  {statusLoading ? "..." : "🤖 Hand back to AI"}
                </button>
              )}
              {activeConv.status === "closed" && (
                <button
                  onClick={() => changeStatus("ai")}
                  disabled={statusLoading}
                  className="text-xs bg-[#162846] border border-[#1e3a5f] px-3 py-1.5 rounded disabled:opacity-50 hover:border-[#d4af37]"
                >
                  {statusLoading ? "..." : "↩ Reopen"}
                </button>
              )}
              <button
                onClick={() => changeStatus("closed")}
                disabled={statusLoading || activeConv.status === "closed"}
                className="text-xs text-[#8aa0c0] hover:text-red-400 px-3 py-1.5 disabled:opacity-30 transition-colors"
              >
                ✕ Close
              </button>
              {statusLoading && <span className="text-[10px] text-[#6b7d99] animate-pulse">Updating...</span>}
            </div>

            {/* Messages */}
            <div ref={msgsRef} className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3 flex flex-col">
              {msgs.map((m) => (
                <div key={m.id} className={`max-w-[85%] sm:max-w-[70%] ${m.role === "visitor" ? "self-end" : m.role === "system" ? "self-center" : "self-start"}`}>
                  {m.role !== "system" && (
                    <div className={`text-[10px] mb-1 text-[#8aa0c0] ${m.role === "visitor" ? "text-right" : ""}`}>
                      {m.role === "visitor" ? "Visitor" : m.role === "ai" ? "🤖 AI" : "🙋 Agent"} · {new Date(m.created_at).toLocaleTimeString()}
                    </div>
                  )}
                  <div className={`rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 break-words ${
                    m.role === "visitor" ? "bg-[#162846] border border-[#1e3a5f]" :
                    m.role === "agent" ? "bg-[#d4af37] text-[#0a1628]" :
                    m.role === "ai" ? "bg-[#0a1628] border border-[#1e3a5f]" :
                    "text-[10px] text-[#6b7d99] text-center bg-transparent border border-[#0f2138] rounded-full px-3 py-1"
                  }`}>
                    {m.role === "system" ? m.content : (
                      <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_pre]:overflow-x-auto">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {!msgs.length && <div className="text-center text-xs text-[#6b7d99] mt-8">No messages yet</div>}
            </div>

            {/* Reply box */}
            <div className="p-3 sm:p-4 border-t border-[#1e3a5f]">
              {activeConv.status === "ai" && (
                <div className="mb-2 text-[11px] text-[#8aa0c0] flex items-center gap-2">
                  <span>🤖 AI is handling this conversation.</span>
                  <button onClick={() => changeStatus("human")} disabled={statusLoading} className="text-[#d4af37] underline hover:no-underline">Take over to reply</button>
                </div>
              )}
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={activeConv.status !== "human" ? "Take over to reply..." : "Reply as agent... (Enter to send)"}
                  disabled={activeConv.status !== "human" || sendLoading}
                  className="flex-1 min-w-0 bg-[#0a1628] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm resize-none disabled:opacity-40 focus:border-[#d4af37] outline-none transition-colors"
                  rows={2}
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || activeConv.status !== "human" || sendLoading}
                  className="bg-[#d4af37] text-[#0a1628] font-semibold px-4 rounded-lg disabled:opacity-40 shrink-0 transition-opacity"
                >
                  {sendLoading ? "..." : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ── Visitor inspector ── */}
      {activeVisitor && (
        <aside className={`${mobilePane === "info" ? "flex" : "hidden"} md:flex w-full md:w-80 border-l border-[#1e3a5f] overflow-y-auto p-4 flex-col gap-4 flex-1 md:flex-none min-h-0`}>
          <div className="flex md:hidden items-center justify-between -mb-2">
            <button onClick={() => setMobilePane("thread")} className="text-[#8aa0c0] hover:text-[#d4af37] text-sm">← Back to chat</button>
          </div>
          <div>
            <h3 className="font-semibold text-[#d4af37] text-xs uppercase tracking-wide mb-2">Visitor</h3>
            <div className="space-y-1 text-xs">
              <Row k="Name" v={activeVisitor.name || "—"} />
              <Row k="Email" v={activeVisitor.email || "—"} />
              <Row k="IP" v={activeVisitor.ip || "—"} />
              <Row k="Location" v={[activeVisitor.city, activeVisitor.region, activeVisitor.country].filter(Boolean).join(", ") || "—"} />
              <Row k="Timezone" v={activeVisitor.timezone || "—"} />
              <Row k="Language" v={activeVisitor.language || "—"} />
              <Row k="Returning" v={activeVisitor.is_returning ? "✓ Yes" : "First visit"} />
              <Row k="First seen" v={new Date(activeVisitor.first_seen).toLocaleString()} />
              <Row k="Last seen" v={new Date(activeVisitor.last_seen).toLocaleString()} />
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-[#d4af37] text-xs uppercase tracking-wide mb-2">Device</h3>
            <div className="space-y-1 text-xs">
              <Row k="Browser" v={`${activeVisitor.browser ?? "?"} / ${activeVisitor.os ?? "?"}`} />
              <Row k="Device" v={activeVisitor.device_type || "—"} />
              <Row k="Screen" v={activeVisitor.screen_width ? `${activeVisitor.screen_width}×${activeVisitor.screen_height}` : "—"} />
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-[#d4af37] text-xs uppercase tracking-wide mb-2">Current page</h3>
            <a href={activeVisitor.current_page || "#"} target="_blank" rel="noreferrer" className="text-xs text-[#8aa0c0] break-all hover:text-[#d4af37]">{activeVisitor.current_page || "—"}</a>
          </div>
          <div className="flex flex-col min-h-0">
            <h3 className="font-semibold text-[#d4af37] text-xs uppercase tracking-wide mb-2">Page history</h3>
            <div ref={pageViewsRef} className="overflow-y-auto max-h-56 space-y-0.5">
              {pageViews.map((p) => (
                <div key={p.id} className="text-[11px] leading-snug px-2 py-1.5 rounded bg-[#0a1628] border border-[#0f2138]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#e5e7eb] truncate font-medium">{p.url.replace(/^https?:\/\/[^/]+/, "") || "/"}</span>
                    <span className="text-[10px] text-[#6b7d99] shrink-0">{new Date(p.viewed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              ))}
              {!pageViews.length && <div className="text-[11px] text-[#6b7d99] py-2">No tracked pages yet</div>}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><span className="text-[#6b7d99] shrink-0">{k}</span><span className="text-[#e5e7eb] text-right break-all">{v}</span></div>;
}
