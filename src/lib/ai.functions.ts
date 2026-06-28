// AI auto-responder and knowledge ingestion
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateText } from "ai";
import type { Database } from "@/integrations/supabase/types";
import { getChatModel, embedText } from "@/lib/ai-gateway.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function sb() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

function buildSystemPrompt(siteName: string, siteDomain: string | null) {
  const where = siteDomain ? `${siteName} on ${siteDomain}` : siteName;
  return `You are the ${siteName} assistant on ${where}.

Tone: professional, warm, concise. Never give specific financial advice or guarantee returns.

Rules:
- Answer questions about ${siteName} using only the provided KNOWLEDGE BASE snippets. Cite naturally.
- If the answer isn't in the knowledge base, say so briefly and offer to connect them with a human agent.
- If the user expresses frustration, asks for a human, mentions a complaint, account issue, compliance, legal, or any specific account/transaction matter, end your reply with the token [ESCALATE] on its own line.
- Never invent product details, fees, returns, or contact info. If unknown, say so.
- Keep replies under 4 short paragraphs. Use markdown for structure when helpful.`;
}

export const respondToConversation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ conversation_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const supa = sb();

    const { data: conv } = await supa.from("conversations").select("*").eq("id", data.conversation_id).single();
    if (!conv) throw new Error("Conversation not found");
    if (conv.status !== "ai") return { skipped: true, reason: "not_ai" };

    // Load site for branded persona + KB scoping
    let siteName = "WolvCapital";
    let siteDomain: string | null = "wolvcapital.com";
    if (conv.site_id) {
      const { data: site } = await supa.from("sites").select("name, domain").eq("id", conv.site_id).maybeSingle();
      if (site) { siteName = site.name; siteDomain = site.domain; }
    }

    const { data: msgs } = await supa
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", data.conversation_id)
      .order("created_at", { ascending: true })
      .limit(30);

    const lastUser = [...(msgs ?? [])].reverse().find((m) => m.role === "visitor");
    if (!lastUser) return { skipped: true, reason: "no_user_message" };

    // RAG retrieval
    let context = "";
    try {
      const queryEmbedding = await embedText(lastUser.content);
      if (!queryEmbedding.length) throw new Error("empty embedding");
      const { data: chunks } = await supa.rpc("match_kb", {
        query_embedding: queryEmbedding as unknown as string,
        match_count: 5,
        _site_id: conv.site_id ?? undefined,
      });
      if (chunks && chunks.length) {
        context = chunks
          .map((c, i) => `[${i + 1}] ${c.title ?? c.url}\n${c.content}`)
          .join("\n\n---\n\n");
      }
    } catch (e) {
      console.error("RAG retrieval failed:", e);
    }

    // Get model — Groq first, Ollama fallback
    const { model, provider } = getChatModel();
    console.log(`[AI] Using provider: ${provider}`);

    const chatMessages = (msgs ?? []).map((m) => ({
      role: m.role === "visitor" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    const SYS = buildSystemPrompt(siteName, siteDomain);
    const system = context
      ? `${SYS}\n\nKNOWLEDGE BASE:\n${context}`
      : `${SYS}\n\n(No knowledge base context available for this query.)`;

    try {
      const { text } = await generateText({ model, system, messages: chatMessages });

      const escalate = /\[ESCALATE\]/i.test(text);
      const clean = text.replace(/\[ESCALATE\]/gi, "").trim();

      await supa.from("messages").insert({
        conversation_id: data.conversation_id,
        role: "ai",
        content: clean || "Let me connect you with an agent.",
      });

      if (escalate) {
        await supa.from("conversations").update({ status: "human" }).eq("id", data.conversation_id);
        await supa.from("messages").insert({
          conversation_id: data.conversation_id,
          role: "system",
          content: "Conversation escalated to human agent.",
        });
      }

      return { ok: true, escalated: escalate, provider };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("AI error:", msg);
      await supa.from("messages").insert({
        conversation_id: data.conversation_id,
        role: "system",
        content: "AI assistant is temporarily unavailable. An agent will respond shortly.",
      });
      await supa.from("conversations").update({ status: "human" }).eq("id", data.conversation_id);
      return { ok: false, error: msg };
    }
  });

// ── Knowledge base ingestion ────────────────────────────────────────────────

function chunkText(text: string, max = 1200): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + max));
    i += max;
  }
  return out;
}

async function resolveSiteIdBySlug(
  client: { from: (t: "sites") => unknown },
  slug?: string | null,
): Promise<string | null> {
  const s = (slug || "wolvcapital").trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await (client.from("sites") as any).select("id").eq("slug", s).maybeSingle();
  return r?.data?.id ?? null;
}

const SeedInput = z.object({
  site: z.string().optional(),
  entries: z.array(z.object({ url: z.string(), title: z.string().optional(), content: z.string().min(20) })).min(1),
});

export const seedKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SeedInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdminRow } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    const { data: isAgentRow } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "agent" });
    if (!isAdminRow && !isAgentRow) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const site_id = await resolveSiteIdBySlug(supabaseAdmin, data.site);

    let inserted = 0;
    for (const entry of data.entries) {
      const chunks = chunkText(entry.content);
      for (const chunk of chunks) {
        try {
          const embedding = await embedText(chunk);
          await supabaseAdmin.from("kb_chunks").insert({
            url: entry.url,
            title: entry.title,
            content: chunk,
            embedding: embedding as unknown as string,
            site_id,
          });
          inserted++;
        } catch (e) {
          console.error("embed/insert failed:", e);
        }
      }
    }
    return { inserted };
  });

export const clearKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ site: z.string().optional() }).optional().parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdminRow } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdminRow) throw new Error("Admin only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data?.site) {
      const site_id = await resolveSiteIdBySlug(supabaseAdmin, data.site);
      if (site_id) await supabaseAdmin.from("kb_chunks").delete().eq("site_id", site_id);
    } else {
      await supabaseAdmin.from("kb_chunks").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }
    return { ok: true };
  });

const CrawlInput = z.object({
  url: z.string().url(),
  site: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  replace: z.boolean().default(false),
});

export const crawlSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CrawlInput.parse(d))
  .handler(async ({ data, context }) => {
    const fcKey = process.env.FIRECRAWL_API_KEY;
    if (!fcKey) throw new Error("Missing FIRECRAWL_API_KEY");

    const { data: isAdminRow } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    const { data: isAgentRow } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "agent" });
    if (!isAdminRow && !isAgentRow) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const Firecrawl = (await import("@mendable/firecrawl-js")).default;
    const fc = new Firecrawl({ apiKey: fcKey });

    const site_id = await resolveSiteIdBySlug(supabaseAdmin, data.site);
    if (!site_id) throw new Error(`Site not found: ${data.site || "wolvcapital"}.`);

    if (data.replace) {
      await supabaseAdmin.from("kb_chunks").delete().eq("site_id", site_id);
    }

    const result = await fc.crawlUrl(data.url, {
      limit: data.limit,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      pollInterval: 2,
      timeout: 300,
    });

    type Doc = { markdown?: string; metadata?: { title?: string; sourceURL?: string; url?: string } };
    const docs: Doc[] = (result as { data?: Doc[] }).data ?? [];

    if (!result || !result.success) throw new Error(result?.error || "Firecrawl crawl failed");
    let pages = 0;
    let inserted = 0;
    for (const doc of docs) {
      const md = doc.markdown?.trim();
      if (!md || md.length < 40) continue;
      const url = doc.metadata?.sourceURL ?? doc.metadata?.url ?? data.url;
      const title = doc.metadata?.title;
      pages++;
      for (const chunk of chunkText(md)) {
        try {
          const embedding = await embedText(chunk);
          await supabaseAdmin.from("kb_chunks").insert({
            url, title, content: chunk,
            embedding: embedding as unknown as string,
            site_id,
          });
          inserted++;
        } catch (e) {
          console.error("embed/insert failed:", e);
        }
      }
    }
    return { pages, inserted };
  });

// ── Site management ────────────────────────────────────────────────────────

const UpsertSiteInput = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, dashes"),
  name: z.string().min(1),
  domain: z.string().optional(),
});

export const upsertSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpsertSiteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAg } = await context.supabase.rpc("is_agent", { _user_id: context.userId });
    if (!isAg) throw new Error("Forbidden");
    const { error, data: row } = await context.supabase
      .from("sites")
      .upsert({ slug: data.slug, name: data.name, domain: data.domain || null }, { onConflict: "slug" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { site: row };
  });

// ── Agent actions ──────────────────────────────────────────────────────────

export const agentReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversation_id: z.string().uuid(), content: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAg } = await context.supabase.rpc("is_agent", { _user_id: context.userId });
    if (!isAg) throw new Error("Forbidden");
    const { error } = await context.supabase.from("messages").insert({
      conversation_id: data.conversation_id,
      role: "agent",
      agent_id: context.userId,
      content: data.content,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setConversationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversation_id: z.string().uuid(), status: z.enum(["ai", "human", "closed"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAg } = await context.supabase.rpc("is_agent", { _user_id: context.userId });
    if (!isAg) throw new Error("Forbidden");
    const patch: { status: "ai" | "human" | "closed"; assigned_agent_id?: string | null } = { status: data.status };
    if (data.status === "human") patch.assigned_agent_id = context.userId;
    if (data.status === "ai") patch.assigned_agent_id = null;
    await context.supabase.from("conversations").update(patch).eq("id", data.conversation_id);
    await context.supabase.from("messages").insert({
      conversation_id: data.conversation_id,
      role: "system",
      content:
        data.status === "human" ? "An agent has joined the conversation."
        : data.status === "ai" ? "Handed back to AI assistant."
        : "Conversation closed.",
    });
    // If handing back to AI, trigger AI to respond to last visitor message
    if (data.status === "ai") {
      try {
        await respondToConversation({ data: { conversation_id: data.conversation_id } });
      } catch(e) { console.error("AI trigger after handback failed:", e); }
    }
    return { ok: true };
  });

export const markConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversation_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAg } = await context.supabase.rpc("is_agent", { _user_id: context.userId });
    if (!isAg) throw new Error("Forbidden");
    await context.supabase.from("conversations").update({ unread_agent_count: 0 }).eq("id", data.conversation_id);
    return { ok: true };
  });
