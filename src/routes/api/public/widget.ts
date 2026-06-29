// Public CORS-enabled endpoint for the embedded widget (multi-site)
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { broadcastNotification } from "@/routes/api/push";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

function sb() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

function parseUA(ua: string) {
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" : "Other";
  const os =
    /Windows/.test(ua) ? "Windows" :
    /Mac OS X/.test(ua) ? "macOS" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad/.test(ua) ? "iOS" :
    /Linux/.test(ua) ? "Linux" : "Other";

  // Device type from UA
  const device_type =
    /Mobi|Android|iPhone|iPod/.test(ua) ? "mobile" :
    /iPad|Tablet/.test(ua) ? "tablet" : "desktop";

  return { browser, os, device_type };
}

// Extract UTM params from URL
function parseUtm(url?: string) {
  if (!url) return {};
  try {
    const u = new URL(url);
    return {
      utm_source: u.searchParams.get("utm_source") ?? undefined,
      utm_medium: u.searchParams.get("utm_medium") ?? undefined,
      utm_campaign: u.searchParams.get("utm_campaign") ?? undefined,
      utm_term: u.searchParams.get("utm_term") ?? undefined,
      utm_content: u.searchParams.get("utm_content") ?? undefined,
    };
  } catch {
    return {};
  }
}

// Geo lookup — tries multiple providers with fallback
async function geoLookup(ip: string | null): Promise<{
  country?: string; city?: string; region?: string; timezone?: string;
}> {
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168") || ip.startsWith("10.")) {
    return {};
  }
  // Primary: ip-api.com (free, no key needed, 45 req/min)
  try {
    const r = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,timezone`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (r.ok) {
      const j = await r.json();
      if (j.status === "success") {
        return {
          country: j.country ?? undefined,
          city: j.city ?? undefined,
          region: j.regionName ?? undefined,
          timezone: j.timezone ?? undefined,
        };
      }
    }
  } catch { /* fall through to backup */ }

  // Fallback: ipapi.co
  try {
    const r = await fetch(`https://ipapi.co/${ip}/json/`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const j = await r.json();
      return {
        country: j.country_name ?? undefined,
        city: j.city ?? undefined,
        region: j.region ?? undefined,
        timezone: j.timezone ?? undefined,
      };
    }
  } catch { /* give up */ }

  return {};
}

function hostFromUrl(url?: string): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

async function resolveSiteId(supa: ReturnType<typeof sb>, siteSlug?: string, currentPage?: string): Promise<string | null> {
  if (siteSlug) {
    const { data } = await supa.from("sites").select("id").eq("slug", siteSlug).maybeSingle();
    if (data) return data.id;
  }
  const host = hostFromUrl(currentPage);
  if (host) {
    const { data } = await supa.from("sites").select("id").eq("domain", host).maybeSingle();
    if (data) return data.id;
  }
  // Fall back to default
  const { data: def } = await supa.from("sites").select("id").eq("slug", "wolvcapital").maybeSingle();
  return def?.id ?? null;
}

type Action =
  | {
      action: "init";
      session_id: string;
      site?: string;
      current_page?: string;
      referrer?: string;
      name?: string;
      email?: string;
      // Phase 2 fields sent from widget JS
      language?: string;
      timezone?: string;
      screen_width?: number;
      screen_height?: number;
    }
  | { action: "track"; session_id: string; current_page: string; title?: string; referrer?: string }
  | { action: "send"; conversation_id: string; content: string }
  | { action: "history"; conversation_id: string }
  | { action: "human"; conversation_id: string }
  | { action: "identify"; visitor_id: string; name?: string; email?: string };

export const Route = createFileRoute("/api/public/widget")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as Action;
          const supa = sb();

          // ── IP extraction: prefer real visitor IP headers ──
          const ip =
            request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-real-ip") ||
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            null;

          const ua = request.headers.get("user-agent") || "";

          // ─────────────────── INIT ───────────────────
          if (body.action === "init") {
            let site_id: string | null = null;
            try {
              site_id = await resolveSiteId(supa, body.site, body.current_page);
            } catch { /* non-fatal */ }

            const { browser, os, device_type } = parseUA(ua);
            const utms = parseUtm(body.current_page);

            // Check for existing visitor
            const { data: existing } = await supa
              .from("visitors")
              .select("*")
              .eq("session_id", body.session_id)
              .maybeSingle();

            let visitor = existing;

            if (!visitor) {
              // New visitor — geo lookup + full insert
              const geo = await geoLookup(ip);

              const ins = await supa.from("visitors").insert({
                session_id: body.session_id,
                ip,
                user_agent: ua,
                browser,
                os,
                current_page: body.current_page,
                referrer: body.referrer,
                name: body.name,
                email: body.email,
                site_id,
                // Geo
                country: geo.country,
                city: geo.city,
                region: geo.region,
                timezone: body.timezone ?? geo.timezone,
                // Client-side fields
                language: body.language,
                screen_width: body.screen_width,
                screen_height: body.screen_height,
                // UTM
                ...utms,
                // Returning visitor check — false for brand new session
                is_returning: false,
              }).select().single();

              if (ins.error) throw new Error(ins.error.message);
              visitor = ins.data;
              // 🔔 Instant push — new visitor arrived
              broadcastNotification({
                type: "new_visitor",
                title: "New Visitor",
                body: `${geo.country ? `${geo.city ?? ""} ${geo.country} · ` : ""}${browser} / ${os} — ${body.current_page ?? "unknown page"}`,
                visitor_id: visitor!.id,
                data: { session_id: body.session_id, current_page: body.current_page },
              }).catch(() => {}); // fire-and-forget
            } else {
              // Returning visitor — update last_seen + page + geo if missing
              const geoNeeded = !existing.country;
              const geo = geoNeeded ? await geoLookup(ip) : {};

              await supa.from("visitors").update({
                last_seen: new Date().toISOString(),
                is_returning: true,
                ...(body.current_page ? { current_page: body.current_page } : {}),
                ...(body.name && !existing.name ? { name: body.name } : {}),
                ...(body.email && !existing.email ? { email: body.email } : {}),
                ...(site_id && !existing.site_id ? { site_id } : {}),
                // Fill in geo if it was missing
                ...(geo.country ? { country: geo.country } : {}),
                ...(geo.city ? { city: geo.city } : {}),
                ...(geo.region ? { region: geo.region } : {}),
                ...(geo.timezone ? { timezone: geo.timezone } : {}),
                // Fill language/screen if missing
                ...(!existing.language && body.language ? { language: body.language } : {}),
                ...(!existing.screen_width && body.screen_width ? { screen_width: body.screen_width } : {}),
                ...(!existing.screen_height && body.screen_height ? { screen_height: body.screen_height } : {}),
              }).eq("id", existing.id);
            }

            // Page view
            if (body.current_page) {
              await (supa.from("page_views") as any).insert({
                visitor_id: visitor!.id,
                url: body.current_page,
                referrer: body.referrer,
              });
            }

            // Conversation — reuse open one or create
            const { data: convExisting } = await supa
              .from("conversations")
              .select("*")
              .eq("visitor_id", visitor!.id)
              .neq("status", "closed")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            let conversation = convExisting;
            if (!conversation) {
              const ic = await supa.from("conversations").insert({ visitor_id: visitor!.id, site_id }).select().single();
              if (ic.error) throw new Error(ic.error.message);
              conversation = ic.data;
            } else if (site_id && !conversation.site_id) {
              await supa.from("conversations").update({ site_id }).eq("id", conversation.id);
            }

            return Response.json(
              {
                visitor,
                conversation,
                site_id,
                supabase: { url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_PUBLISHABLE_KEY },
              },
              { headers: corsHeaders }
            );
          }

          // ─────────────────── TRACK ───────────────────
          if (body.action === "track") {
            const { data: v } = await supa.from("visitors").select("id").eq("session_id", body.session_id).maybeSingle();
            if (!v) return Response.json({ ok: false, error: "visitor_not_found" }, { headers: corsHeaders });
            await supa.from("visitors").update({
              current_page: body.current_page,
              last_seen: new Date().toISOString(),
            }).eq("id", v.id);
            await (supa.from("page_views") as any).insert({
              visitor_id: v.id,
              url: body.current_page,
              title: body.title,
              referrer: body.referrer,
            });
            return Response.json({ ok: true }, { headers: corsHeaders });
          }

          // ─────────────────── IDENTIFY ───────────────────
          if (body.action === "identify") {
            await supa.from("visitors").update({
              ...(body.name ? { name: body.name } : {}),
              ...(body.email ? { email: body.email } : {}),
            }).eq("id", body.visitor_id);
            return Response.json({ ok: true }, { headers: corsHeaders });
          }

          // ─────────────────── SEND ───────────────────
          if (body.action === "send") {
            const ins = await supa
              .from("messages")
              .insert({ conversation_id: body.conversation_id, role: "visitor", content: body.content })
              .select()
              .single();
            if (ins.error) throw new Error(ins.error.message);

            // 🔔 Instant push — new message from visitor
            broadcastNotification({
              type: "new_message",
              title: "New Message",
              body: body.content.slice(0, 100),
              conversation_id: body.conversation_id,
              data: { conversation_id: body.conversation_id },
            }).catch(() => {}); // fire-and-forget

            // Invoke AI responder — errors are caught so visitor still gets their message receipt
            try {
              const { respondToConversation } = await import("@/lib/ai.functions");
              await respondToConversation({ data: { conversation_id: body.conversation_id } });
            } catch (e) {
              console.error("AI respond failed", e instanceof Error ? e.message : String(e));
              // AI failed — escalate to human automatically
              try {
                // Don't escalate on WebSocket/realtime errors - AI still works
              console.error("AI respond error (non-fatal):", msg);
              } catch { /* best effort */ }
            }

            return Response.json({ message: ins.data }, { headers: corsHeaders });
          }

          // ─────────────────── HISTORY ───────────────────
          if (body.action === "history") {
            const { data, error } = await supa
              .from("messages")
              .select("*")
              .eq("conversation_id", body.conversation_id)
              .order("created_at", { ascending: true });
            if (error) throw new Error(error.message);
            return Response.json({ messages: data ?? [] }, { headers: corsHeaders });
          }

          // ─────────────────── HUMAN ───────────────────
          if (body.action === "human") {
            await supa.from("conversations").update({ status: "human" }).eq("id", body.conversation_id);
            await supa.from("messages").insert({
              conversation_id: body.conversation_id,
              role: "system",
              content: "Visitor requested a human agent.",
            });
            return Response.json({ ok: true }, { headers: corsHeaders });
          }

          return new Response("Bad action", { status: 400, headers: corsHeaders });

        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("widget error", msg);

          // Detect Supabase unavailability specifically
          const isSupabaseDown = msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("network");
          return Response.json(
            {
              error: msg,
              type: isSupabaseDown ? "service_unavailable" : "error",
              retry: isSupabaseDown,
            },
            { status: 500, headers: corsHeaders }
          );
        }
      },
    },
  },
});
