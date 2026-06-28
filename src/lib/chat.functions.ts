// Visitor / conversation server functions (anon-callable)
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

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
    /Safari\//.test(ua) ? "Safari" :
    "Other";
  const os =
    /Windows/.test(ua) ? "Windows" :
    /Mac OS X/.test(ua) ? "macOS" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad/.test(ua) ? "iOS" :
    /Linux/.test(ua) ? "Linux" : "Other";
  return { browser, os };
}

async function geoLookup(ip: string | null) {
  if (!ip || ip === "127.0.0.1" || ip.startsWith("::")) return {};
  try {
    const r = await fetch(`https://ipapi.co/${ip}/json/`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return {};
    const j = await r.json();
    return { country: j.country_name, city: j.city, region: j.region };
  } catch {
    return {};
  }
}

const RegisterInput = z.object({
  session_id: z.string().min(8),
  current_page: z.string().optional(),
  referrer: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
});

export const registerVisitor = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RegisterInput.parse(d))
  .handler(async ({ data }) => {
    const req = getRequest();
    const ip =
      req?.headers.get("cf-connecting-ip") ||
      req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null;
    const ua = req?.headers.get("user-agent") || "";
    const { browser, os } = parseUA(ua);
    const supa = sb();

    const { data: existing } = await supa.from("visitors").select("*").eq("session_id", data.session_id).maybeSingle();
    let visitor = existing;
    if (!visitor) {
      const geo = await geoLookup(ip);
      const { data: created, error } = await supa
        .from("visitors")
        .insert({
          session_id: data.session_id,
          ip,
          user_agent: ua,
          browser,
          os,
          current_page: data.current_page,
          referrer: data.referrer,
          name: data.name,
          email: data.email,
          ...geo,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      visitor = created;
    } else {
      await supa.from("visitors").update({
        last_seen: new Date().toISOString(),
        ...(data.current_page ? { current_page: data.current_page } : {}),
        ...(data.name && !visitor.name ? { name: data.name } : {}),
        ...(data.email && !visitor.email ? { email: data.email } : {}),
      }).eq("id", visitor.id);
    }

    if (data.current_page) {
      await supa.from("page_views").insert({
        visitor_id: visitor.id,
        url: data.current_page,
        referrer: data.referrer,
      });
    }

    // ensure conversation
    const { data: conv } = await supa
      .from("conversations")
      .select("*")
      .eq("visitor_id", visitor.id)
      .neq("status", "closed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let conversation = conv;
    if (!conversation) {
      const { data: c, error } = await supa
        .from("conversations")
        .insert({ visitor_id: visitor.id })
        .select()
        .single();
      if (error) throw new Error(error.message);
      conversation = c;
    }

    return { visitor, conversation };
  });

const TrackInput = z.object({
  session_id: z.string(),
  current_page: z.string(),
  title: z.string().optional(),
  referrer: z.string().optional(),
});

export const trackPage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TrackInput.parse(d))
  .handler(async ({ data }) => {
    const supa = sb();
    const { data: v } = await supa.from("visitors").select("id").eq("session_id", data.session_id).maybeSingle();
    if (!v) return { ok: false };
    await supa.from("visitors").update({ current_page: data.current_page, last_seen: new Date().toISOString() }).eq("id", v.id);
    await supa.from("page_views").insert({
      visitor_id: v.id,
      url: data.current_page,
      title: data.title,
      referrer: data.referrer,
    });
    return { ok: true };
  });

const SendInput = z.object({
  conversation_id: z.string().uuid(),
  content: z.string().min(1).max(4000),
});

export const sendVisitorMessage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SendInput.parse(d))
  .handler(async ({ data }) => {
    const supa = sb();
    const { data: msg, error } = await supa
      .from("messages")
      .insert({ conversation_id: data.conversation_id, role: "visitor", content: data.content })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { message: msg };
  });

export const requestHumanAgent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ conversation_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const supa = sb();
    await supa.from("conversations").update({ status: "human" }).eq("id", data.conversation_id);
    await supa.from("messages").insert({
      conversation_id: data.conversation_id,
      role: "system",
      content: "Visitor requested a human agent.",
    });
    return { ok: true };
  });
