import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { seedKnowledge, clearKnowledge, crawlSite, upsertSite } from "@/lib/ai.functions";

export const Route = createFileRoute("/knowledge")({
  head: () => ({ meta: [{ title: "Knowledge Base — WolvCapital" }] }),
  component: KB,
});

type Site = { id: string; slug: string; name: string; domain: string | null };

function KB() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteSlug, setSiteSlug] = useState<string>("wolvcapital");
  const [url, setUrl] = useState("https://wolvcapital.com");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const seed = useServerFn(seedKnowledge);
  const clear = useServerFn(clearKnowledge);
  const crawl = useServerFn(crawlSite);
  const saveSite = useServerFn(upsertSite);
  const [crawlUrl, setCrawlUrl] = useState("https://wolvcapital.com");
  const [crawlLimit, setCrawlLimit] = useState(50);
  const [replace, setReplace] = useState(true);

  // new-site form
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [newDomain, setNewDomain] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate({ to: "/auth" });
      else {
        const token = data.session.access_token;
        setAuthToken(token);
        setAuthed(true);
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

  async function refreshSites() {
    const { data } = await supabase.from("sites").select("id, slug, name, domain").order("created_at", { ascending: true });
    setSites((data ?? []) as Site[]);
  }
  async function refreshCount() {
    const site = sites.find((s) => s.slug === siteSlug);
    const q = supabase.from("kb_chunks").select("*", { count: "exact", head: true });
    const { count: c } = site ? await q.eq("site_id", site.id) : await q;
    setCount(c ?? 0);
  }
  useEffect(() => { if (authed) refreshSites(); }, [authed]);
  useEffect(() => { if (authed && sites.length) refreshCount(); /* eslint-disable-next-line */ }, [authed, sites, siteSlug]);

  async function add() {
    if (!content.trim()) return;
    setBusy(true); setMsg("");
    try {
      const r = await seed({ data: { site: siteSlug, entries: [{ url, title, content }] } });
      setMsg(`Inserted ${r.inserted} chunk(s) into "${siteSlug}".`);
      setContent("");
      refreshCount();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function wipe() {
    if (!confirm(`Clear knowledge base for site "${siteSlug}"?`)) return;
    await clear({ data: { site: siteSlug } });
    refreshCount();
  }

  async function runCrawl() {
    setBusy(true); setMsg(`Crawling for "${siteSlug}" — this can take a few minutes...`);
    try {
      const r = await crawl({ data: { url: crawlUrl, site: siteSlug, limit: crawlLimit, replace } });
      setMsg(`Crawled ${r.pages} page(s), inserted ${r.inserted} chunk(s) into "${siteSlug}".`);
      refreshCount();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Crawl failed"); }
    finally { setBusy(false); }
  }

  async function addSite() {
    if (!newSlug || !newName) return;
    setBusy(true); setMsg("");
    try {
      await saveSite({ data: { slug: newSlug, name: newName, domain: newDomain || undefined } });
      setNewSlug(""); setNewName(""); setNewDomain("");
      await refreshSites();
      setSiteSlug(newSlug);
      setMsg(`Site "${newSlug}" saved.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  if (!authed) return null;
  const currentSite = sites.find((s) => s.slug === siteSlug);

  return (
    <div className="min-h-screen bg-[#06101f] text-white p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-semibold text-[#d4af37]">Knowledge Base</h1>
          <a href="/dashboard" className="text-xs text-[#8aa0c0] hover:text-[#d4af37]">← Dashboard</a>
        </div>

        <div className="bg-[#0a1628] border border-[#1e3a5f] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[#d4af37] mb-2">Site</h2>
          <p className="text-xs text-[#8aa0c0] mb-3">Each site has its own knowledge base. The widget passes its <code className="text-[#d4af37]">data-site</code> slug; the AI only answers from that site's KB.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={siteSlug} onChange={(e) => setSiteSlug(e.target.value)} className="bg-[#162846] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm">
              {sites.map((s) => <option key={s.id} value={s.slug}>{s.name} ({s.slug})</option>)}
            </select>
            {currentSite?.domain && <span className="text-xs text-[#8aa0c0]">domain: {currentSite.domain}</span>}
          </div>
          <details className="mt-4">
            <summary className="text-xs text-[#8aa0c0] cursor-pointer hover:text-[#d4af37]">+ Add new site</summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input value={newSlug} onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="slug (e.g. acme)" className="bg-[#162846] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm" />
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Display name" className="bg-[#162846] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm" />
              <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="domain (acme.com)" className="bg-[#162846] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm" />
            </div>
            <button onClick={addSite} disabled={busy || !newSlug || !newName} className="mt-2 bg-[#d4af37] text-[#0a1628] font-semibold px-3 py-1.5 rounded-lg text-xs disabled:opacity-50">Save site</button>
          </details>
          {currentSite && (
            <div className="mt-4 text-xs text-[#8aa0c0]">
              Embed snippet:
              <pre className="mt-1 bg-[#06101f] border border-[#1e3a5f] rounded p-2 overflow-x-auto text-[11px] text-[#e5e7eb]">{`<script src="${typeof window !== "undefined" ? window.location.origin : ""}/widget.js" data-site="${currentSite.slug}" async></script>`}</pre>
            </div>
          )}
        </div>

        <div className="bg-[#0a1628] border border-[#1e3a5f] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[#d4af37] mb-2">Auto-crawl with Firecrawl</h2>
          <p className="text-xs text-[#8aa0c0] mb-4">Crawl a site, extract main content, embed all pages into <b>{siteSlug}</b>'s knowledge base.</p>
          <div className="space-y-2">
            <input value={crawlUrl} onChange={(e) => setCrawlUrl(e.target.value)} placeholder="https://example.com" className="w-full bg-[#162846] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm" />
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-xs text-[#8aa0c0]">Page limit
                <input type="number" min={1} max={200} value={crawlLimit} onChange={(e) => setCrawlLimit(parseInt(e.target.value || "50"))} className="ml-2 w-20 bg-[#162846] border border-[#1e3a5f] rounded px-2 py-1 text-sm" />
              </label>
              <label className="text-xs text-[#8aa0c0] flex items-center gap-1">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace existing for this site
              </label>
              <button onClick={runCrawl} disabled={busy} className="ml-auto bg-[#d4af37] text-[#0a1628] font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50">{busy ? "Working..." : "Crawl & embed"}</button>
            </div>
          </div>
        </div>

        <div className="bg-[#0a1628] border border-[#1e3a5f] rounded-xl p-5">
          <div className="text-xs text-[#8aa0c0] mb-3">Stored chunks for <b className="text-white">{siteSlug}</b>: <b className="text-white">{count}</b></div>
          <p className="text-xs text-[#8aa0c0] mb-4">Paste content (FAQs, About, Services, etc.) for this site. The AI uses semantic search over these chunks.</p>
          <div className="space-y-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Source URL" className="w-full bg-[#162846] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm" />
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. 'Fee Structure')" className="w-full bg-[#162846] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm" />
            <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Content..." rows={10} className="w-full bg-[#162846] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm font-mono" />
            <div className="flex gap-2">
              <button onClick={add} disabled={busy} className="bg-[#d4af37] text-[#0a1628] font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50">{busy ? "Embedding..." : "Add to KB"}</button>
              <button onClick={wipe} className="text-xs text-red-400 hover:text-red-300 px-3">Clear "{siteSlug}"</button>
            </div>
            {msg && <div className="text-xs text-[#8aa0c0]">{msg}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
