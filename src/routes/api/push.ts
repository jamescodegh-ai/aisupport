/**
 * Push notification API
 * POST /api/push  { action: "subscribe", subscription: PushSubscription }
 * POST /api/push  { action: "unsubscribe" }
 *
 * Uses Web Push (VAPID). Generate keys once:
 *   npx web-push generate-vapid-keys
 * Then set in env:
 *   VAPID_PUBLIC_KEY=...
 *   VAPID_PRIVATE_KEY=...
 *   VAPID_EMAIL=mailto:you@yourdomain.com
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

function sb() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

async function getAgentId(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const supa = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!);
  const { data } = await supa.auth.getUser(token);
  return data.user?.id ?? null;
}

// Send a web push notification to a single subscription
export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; data?: Record<string, unknown> }
): Promise<boolean> {
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail = process.env.VAPID_EMAIL || "mailto:admin@yourdomain.com";

  if (!vapidPublic || !vapidPrivate) {
    console.warn("[Push] VAPID keys not set — skipping push");
    return false;
  }

  try {
    // Dynamically import web-push (only on server)
    const webpush = await import("web-push");
    webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 }
    );
    return true;
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode;
    // 410 Gone = subscription expired, caller should delete it
    if (status === 410 || status === 404) return false;
    console.error("[Push] send failed:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

// Broadcast to ALL agent subscriptions and log the notification
export async function broadcastNotification(payload: {
  type: "new_visitor" | "new_message" | "escalation";
  title: string;
  body: string;
  conversation_id?: string;
  visitor_id?: string;
  data?: Record<string, unknown>;
}) {
  const supa = sb();

  // Log notification to DB so dashboard can show it
  await supa.from("notifications").insert({
    type: payload.type,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? null,
    conversation_id: payload.conversation_id ?? null,
    visitor_id: payload.visitor_id ?? null,
  });

  // Get all agent push subscriptions
  const { data: subs } = await supa.from("push_subscriptions").select("*");
  if (!subs || subs.length === 0) return;

  const dead: string[] = [];
  await Promise.allSettled(
    subs.map(async (sub) => {
      const ok = await sendPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title: payload.title, body: payload.body, data: payload.data }
      );
      if (!ok) dead.push(sub.endpoint);
    })
  );

  // Clean up dead subscriptions
  if (dead.length > 0) {
    await supa.from("push_subscriptions").delete().in("endpoint", dead);
  }
}

export const Route = createFileRoute("/api/push")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => {
        // Return VAPID public key so client can subscribe
        return Response.json(
          { vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null },
          { headers: cors }
        );
      },
      POST: async ({ request }) => {
        try {
          const agentId = await getAgentId(request.headers.get("authorization"));
          if (!agentId) return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });

          const body = await request.json() as {
            action: "subscribe" | "unsubscribe";
            subscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
          };

          const supa = sb();

          if (body.action === "subscribe" && body.subscription) {
            const { endpoint, keys } = body.subscription;
            await supa.from("push_subscriptions").upsert(
              { agent_id: agentId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
              { onConflict: "endpoint" }
            );
            return Response.json({ ok: true }, { headers: cors });
          }

          if (body.action === "unsubscribe") {
            await supa.from("push_subscriptions").delete().eq("agent_id", agentId);
            return Response.json({ ok: true }, { headers: cors });
          }

          return Response.json({ error: "Bad action" }, { status: 400, headers: cors });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[Push API]", msg);
          return Response.json({ error: msg }, { status: 500, headers: cors });
        }
      },
    },
  },
});
