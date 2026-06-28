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

type Conv = { id: string; visitor_id: string; status: "ai" | "human" | "closed"; assigned_agent_id: string | null; unread_agent_count: number; last_message_at: string; last_message_preview: string | null };
type Visitor = { id: string; session_id: string; name: string | null; email: string | null; ip: string | null; country: string | null; city: string | null; region: string | null; browser: string | null; os: string | null; device_type: string | null; current_page: string | null; last_seen: string; first_seen: string; timezone: string | null; language: string | null; screen_width: number | null; screen_height: number | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; is_returning: boolean | null; referrer: string | null };
type Msg = { id: string; conversation_id: string; role: "visitor" | "ai" | "agent" | "system"; content: string; created_at: string };
type PageView = { id: string; url: string; title: string | null; viewed_at: string };

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
  const [showInfo, setShowInfo] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);
  const reply = useServerFn(agentReply);
  const setStatus = useServerFn(setConversationStatus);
  const markRead = useServerFn(markConversationRead);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate({ to: "/auth" });
      else { setAuthed(true); setAuthToken(data.session.access_token); }
    });
  }, [navigate]);

  const loadAll = useCallback(async () => {
    const { data: c } = await supabase.from("conversations").select("*").order("last_message_at", { ascending: false }).limit(100);
    setConvs((c as Conv[]) ?? []);
    if (c && c.length) {
      const ids = [...new Set((c as Conv[]).map((x) => x.visitor_id))];
      const { data: vs } = await supabase.from("visitors").select("*").in("id", ids);
      const map: Record<string, Visitor> = {};
      (vs as Visitor[] | null)?.forEach((v) => { map[v.id] = v; });
      setVisitors(map);
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const conv_id = (e as CustomEvent).detail?.conversation_id;
      if (conv_id) { setActive(conv_id); setMobilePane("thread"); }
    };
    window.addEventListener("push:open_conversation", handler);
    return () => window.removeEventListener("push:open_conversation", handler);
  }, []);

  useEffect(() => {
    if (!authed) return;
    loadAll();
    const ch = supabase.channel("dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (p) => {
        const m = p.new as Msg;
        if (active && m && m.conversation_id === active) setMsgs((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
        loadAll();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "visitors" }, loadAll)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "page_views" }, (p) => {
        const pv = p.new as PageView & { visitor_id: string };
        if (active && visitors[convs.find((c) => c.id === active)?.visitor_id ?? ""]?.id === pv.visitor_id) {
          setPageViews((prev) => [pv, ...prev].slice(0, 30));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [authed, active, loadAll, convs, visitors]);

  useEffect(() => {
    if (!active) { setMsgs([]); setPageViews([]); return; }
    supabase.from("messages").select("*").eq("conversation_id", active).order("created_at").then(({ data }) => setMsgs((data as Msg[]) ?? []));
    const conv = convs.find((c) => c.id === active);
    if (conv) {
      supabase.from("page_views").select("*").eq("visitor_id", conv.visitor_id).order("viewed_at", { ascending: false }).limit(30).then(({ data }) => setPageViews((data as PageView[]) ?? []));
      if (conv.unread_agent_count > 0) markRead({ data: { conversation_id: active } });
    }
  }, [active, convs, markRead]);

  useEffect(() => { msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  async function send() {
    if (!input.trim() || !active) return;
    const text = input; setInput("");
    await reply({ data: { conversation_id: active, content: text } });
  }

  async function signOut() { await supabase.auth.signOut(); navigate({ to: "/auth" }); }

  if (!authed) return (
    <div className="min-h-screen bg-[#06101f] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
        <span className="text-[#8aa0c0] text-sm">Loading...</span>
      </div>
    </div>
  );

  const activeConv = convs.find((c) => c.id === active);
  const activeVisitor = activeConv ? visitors[activeConv.visitor_id] : null;
  const totalUnread = convs.reduce((s, c) => s + (c.unread_agent_count || 0), 0);

  function openConv(id: string) { setActive(id); setMobilePane("thread"); setShowInfo(false); }

  return (
    <div className="h-[100dvh] flex flex-col bg-[#06101f] text-white text-sm overflow-hidden">

      {/* ── Top nav bar (mobile) ── */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-[#1e3a5f] bg-[#06101f] shrink-0">
        {mobilePane === "inbox" ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-[#d4af37] text-[#0a1628] font-bold text-xs flex items-center justify-center">W</div>
              <span className="font-semibold text-sm">Inbox {totalUnread > 0 && <span className="ml-1 bg-red-500 text-white text-[10px] px-1.5 rounded-full">{totalUnread}</span>}</span>
            </div>
            <div className="flex items-center gap-3">
              {!subscribed && <button onClick={subscribe} className="text-[10px] bg-[#d4af37] text-[#0a1628] px-2 py-1 rounded font-semibold">🔔</button>}
              {(permission === "granted" || subscribed) && <span className="text-[10px] text-[#10b981]">🔔</span>}
              <a href="/knowledge" className="text-[10px] text-[#8aa0c0]">KB</a>
              <button onClick={signOut} className="text-[10px] text-[#8aa0c0]">Sign out</button>
            </div>
          </>
        ) : mobilePane === "thread" ? (
          <>
            <button onClick={() => setMobilePane("inbox")} className="flex items-center gap-1 text-[#8aa0c0] active:text-[#d4af37]">
              <span className="text-lg">←</span>
              <span className="text-xs">Inbox</span>
            </button>
            <div className="text-sm font-semibold truncate mx-2 flex-1 text-center">
              {activeVisitor?.name || activeVisitor?.email || "Visitor"}
            </div>
            <button onClick={() => setMobilePane("info")} className="text-[10px] border border-[#1e3a5f] px-2 py-1 rounded text-[#8aa0c0] active:text-[#d4af37]">
              Info
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setMobilePane("thread")} className="flex items-center gap-1 text-[#8aa0c0] active:text-[#d4af37]">
              <span className="text-lg">←</span>
              <span className="text-xs">Chat</span>
            </button>
            <span className="text-sm font-semibold">Visitor Info</span>
            <div className="w-16" />
          </>
        )}
      </header>

      {/* ── Main layout ── */}
      <div className="flex flex-1 min-h-0">

        {/* Sidebar */}
        <aside className={`${mobilePane === "inbox" ? "flex" : "hidden"} md:flex w-full md:w-72 lg:w-80 border-r border-[#1e3a5f] flex-col min-h-0`}>
          {/* Desktop header */}
          <div className="hidden md:flex p-4 border-b border-[#1e3a5f] items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 shrink-0 rounded bg-[#d4af37] text-[#0a1628] font-bold flex items-center justify-center">W</div>
              <div className="min-w-0">
                <div className="font-semibold text-xs truncate">WolvCapital</div>
                <div className="text-[10px] text-[#8aa0c0]">Inbox · {convs.length} {totalUnread > 0 && <span className="bg-red-500 text-white px-1 rounded-full">{totalUnread}</span>}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!subscribed && <button onClick={subscribe} title="Enable alerts" className="text-[10px] bg-[#d4af37] text-[#0a1628] px-2 py-1 rounded font-semibold">🔔</button>}
              {(permission === "granted" || subscribed) && <span className="text-[10px] text-[#10b981]">🔔 On</span>}
              <a href="/knowledge" className="text-[10px] text-[#8aa0c0] hover:text-[#d4af37]">KB</a>
              <button onClick={signOut} className="text-[10px] text-[#8aa0c0] hover:text-[#d4af37]">Sign out</button>
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {convs.map((c) => {
              const v = visitors[c.visitor_id];
              const isActive = c.id === active;
              const timeAgo = c.last_message_at ? formatTime(c.last_message_at) : "";
              return (
                <button key={c.id} onClick={() => openConv(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-[#0a1628] transition-colors active:bg-[#162846] ${isActive ? "bg-[#0f2138]" : "hover:bg-[#0a1628]"}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 shrink-0 rounded-full bg-[#162846] border border-[#1e3a5f] flex items-center justify-center text-[11px] font-semibold text-[#d4af37]">
                        {(v?.name || v?.session_id || "?")[0].toUpperCase()}
                      </div>
                      <span className="font-medium text-xs truncate">{v?.name || v?.email || v?.session_id?.slice(0, 10) || "Visitor"}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {c.status === "human" && <span className="text-[9px] bg-[#d4af37] text-[#0a1628] px-1.5 py-0.5 rounded font-semibold">LIVE</span>}
                      {c.status === "ai" && <span className="text-[9px] bg-[#1e3a5f] text-[#8aa0c0] px-1.5 py-0.5 rounded">AI</span>}
                      {c.status === "closed" && <span className="text-[9px] bg-[#0a1628] text-[#6b7d99] px-1.5 py-0.5 rounded">CLOSED</span>}
                      {c.unread_agent_count > 0 && <span className="w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">{c.unread_agent_count}</span>}
                    </div>
                  </div>
                  <div className="text-[11px] text-[#8aa0c0] truncate pl-9">{c.last_message_preview || "—"}</div>
                  <div className="flex items-center justify-between pl-9 mt-0.5">
                    <span className="text-[10px] text-[#6b7d99] truncate">{v?.country ? `${v.city ? v.city + ", " : ""}${v.country}` : v?.ip ?? ""}</span>
                    <span className="text-[10px] text-[#4a5568] shrink-0">{timeAgo}</span>
                  </div>
                </button>
              );
            })}
            {!convs.length && (
              <div className="flex flex-col items-center justify-center h-40 text-[#6b7d99]">
                <div className="text-2xl mb-2">💬</div>
                <div className="text-xs">No conversations yet</div>
              </div>
            )}
          </div>
        </aside>

        {/* Thread */}
        <main className={`${mobilePane === "thread" ? "flex" : "hidden"} md:flex flex-1 flex-col min-h-0 min-w-0`}>
          {!active && (
            <div className="flex-1 hidden md:flex flex-col items-center justify-center gap-3 text-[#6b7d99]">
              <div className="text-4xl">💬</div>
              <div className="text-sm">Select a conversation</div>
            </div>
          )}
          {active && activeConv && (
            <>
              {/* Thread header - desktop only */}
              <div className="hidden md:flex p-4 border-b border-[#1e3a5f] items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{activeVisitor?.name || activeVisitor?.email || "Anonymous visitor"}</div>
                  <div className="text-[11px] text-[#8aa0c0]">{activeVisitor?.current_page || "Unknown page"}</div>
                </div>
                <button onClick={() => setShowInfo(!showInfo)} className="text-[10px] border border-[#1e3a5f] px-3 py-1.5 rounded text-[#8aa0c0] hover:text-[#d4af37] hover:border-[#d4af37] shrink-0">
                  {showInfo ? "Hide info" : "Visitor info"}
                </button>
              </div>

              {/* Action bar */}
              <div className="px-4 py-2 border-b border-[#1e3a5f] flex flex-wrap gap-2 items-center">
                {activeConv.status === "ai" && (
                  <button onClick={() => setStatus({ data: { conversation_id: active, status: "human" } })}
                    className="text-xs bg-[#d4af37] text-[#0a1628] px-3 py-1.5 rounded font-semibold active:opacity-80">
                    Take over
                  </button>
                )}
                {activeConv.status === "human" && (
                  <button onClick={() => setStatus({ data: { conversation_id: active, status: "ai" } })}
                    className="text-xs bg-[#162846] border border-[#1e3a5f] px-3 py-1.5 rounded text-[#8aa0c0] active:opacity-80">
                    Hand back to AI
                  </button>
                )}
                {activeConv.status !== "closed" && (
                  <button onClick={() => setStatus({ data: { conversation_id: active, status: "closed" } })}
                    className="text-xs text-[#6b7d99] hover:text-red-400 px-3 py-1.5 active:text-red-400">
                    Close
                  </button>
                )}
                <div className="ml-auto text-[10px] text-[#6b7d99]">
                  {activeConv.status === "ai" ? "🤖 AI handling" : activeConv.status === "human" ? "👤 Agent handling" : "🔒 Closed"}
                </div>
              </div>

              {/* Messages */}
              <div ref={msgsRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 flex flex-col">
                {msgs.map((m) => (
                  <div key={m.id} className={`flex flex-col max-w-[85%] ${m.role === "visitor" ? "self-end items-end" : m.role === "system" ? "self-center items-center max-w-full" : "self-start items-start"}`}>
                    {m.role !== "system" && (
                      <div className="text-[10px] text-[#6b7d99] mb-1 px-1">
                        {m.role === "visitor" ? "Visitor" : m.role === "ai" ? "🤖 AI" : "👤 You"} · {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                    <div className={`rounded-2xl px-4 py-2.5 break-words text-[13px] leading-relaxed ${
                      m.role === "visitor" ? "bg-[#162846] border border-[#1e3a5f] rounded-tr-sm" :
                      m.role === "agent" ? "bg-[#d4af37] text-[#0a1628] rounded-tl-sm" :
                      m.role === "ai" ? "bg-[#0f2138] border border-[#1e3a5f] rounded-tl-sm" :
                      "bg-transparent text-[11px] text-[#6b7d99] py-1"
                    }`}>
                      <div className="prose prose-sm prose-invert max-w-none [&_p]:my-0.5 [&_pre]:overflow-x-auto [&_p]:leading-relaxed">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ))}
                {!msgs.length && <div className="flex-1 flex items-center justify-center text-xs text-[#6b7d99]">No messages yet</div>}
              </div>

              {/* Input */}
              <div className="p-3 border-t border-[#1e3a5f] bg-[#06101f]">
                <div className="flex gap-2 items-end">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }}}
                    placeholder={activeConv.status === "ai" ? "AI is handling — tap Take over to reply" : "Reply as agent..."}
                    disabled={activeConv.status !== "human"}
                    className="flex-1 min-w-0 bg-[#0a1628] border border-[#1e3a5f] focus:border-[#d4af37] rounded-xl px-3 py-2.5 text-sm resize-none outline-none disabled:opacity-40 transition-colors"
                    rows={2}
                  />
                  <button
                    onClick={send}
                    disabled={!input.trim() || activeConv.status !== "human"}
                    className="bg-[#d4af37] text-[#0a1628] font-semibold px-4 py-2.5 rounded-xl disabled:opacity-40 shrink-0 active:scale-95 transition-transform"
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          )}
        </main>

        {/* Visitor info panel */}
        {activeVisitor && (mobilePane === "info" || showInfo) && (
          <aside className={`${mobilePane === "info" ? "flex" : "hidden"} md:flex w-full md:w-72 lg:w-80 border-l border-[#1e3a5f] flex-col min-h-0`}>
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <Section title="Visitor">
                <Row k="Name" v={activeVisitor.name || "—"} />
                <Row k="Email" v={activeVisitor.email || "—"} />
                <Row k="IP" v={activeVisitor.ip || "—"} />
                <Row k="Location" v={[activeVisitor.city, activeVisitor.region, activeVisitor.country].filter(Boolean).join(", ") || "—"} />
                <Row k="Timezone" v={activeVisitor.timezone ?? "—"} />
                <Row k="Language" v={activeVisitor.language ?? "—"} />
                <Row k="Returning" v={activeVisitor.is_returning ? "✓ Yes" : "First visit"} />
                <Row k="First seen" v={new Date(activeVisitor.first_seen).toLocaleString()} />
                <Row k="Last seen" v={new Date(activeVisitor.last_seen).toLocaleString()} />
              </Section>
              <Section title="Device">
                <Row k="Browser" v={`${activeVisitor.browser ?? "?"} / ${activeVisitor.os ?? "?"}`} />
                <Row k="Device" v={activeVisitor.device_type ?? "—"} />
                <Row k="Screen" v={activeVisitor.screen_width ? `${activeVisitor.screen_width}×${activeVisitor.screen_height}` : "—"} />
              </Section>
              {(activeVisitor.utm_source || activeVisitor.utm_campaign) && (
                <Section title="Campaign">
                  {activeVisitor.utm_source && <Row k="Source" v={activeVisitor.utm_source} />}
                  {activeVisitor.utm_medium && <Row k="Medium" v={activeVisitor.utm_medium} />}
                  {activeVisitor.utm_campaign && <Row k="Campaign" v={activeVisitor.utm_campaign} />}
                </Section>
              )}
              {activeVisitor.referrer && (
                <Section title="Referrer">
                  <div className="text-[11px] text-[#8aa0c0] break-all">{activeVisitor.referrer}</div>
                </Section>
              )}
              <Section title="Current page">
                <div className="text-[11px] text-[#8aa0c0] break-all">{activeVisitor.current_page || "—"}</div>
              </Section>
              <Section title="Page history">
                <div className="space-y-1">
                  {pageViews.map((p) => (
                    <div key={p.id} className="text-[11px] px-2 py-1.5 rounded bg-[#0a1628] border border-[#0f2138]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#e5e7eb] truncate font-medium">{p.title || new URL(p.url).pathname}</span>
                        <span className="text-[10px] text-[#6b7d99] shrink-0">{new Date(p.viewed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </div>
                  ))}
                  {!pageViews.length && <div className="text-[11px] text-[#6b7d99]">No pages tracked yet</div>}
                </div>
              </Section>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold text-[#d4af37] text-[10px] uppercase tracking-widest mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-[11px]">
      <span className="text-[#6b7d99] shrink-0">{k}</span>
      <span className="text-[#e5e7eb] text-right break-all">{v}</span>
    </div>
  );
}

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
