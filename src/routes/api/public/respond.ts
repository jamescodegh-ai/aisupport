import { createFileRoute } from "@tanstack/react-router";
import { respondToConversation } from "@/lib/ai.functions";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export const Route = createFileRoute("/api/public/respond")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        try {
          const { conversation_id } = (await request.json()) as { conversation_id: string };
          const r = await respondToConversation({ data: { conversation_id } });
          return Response.json(r, { headers: cors });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("respond error", msg);
          return Response.json({ error: msg }, { status: 500, headers: cors });
        }
      },
    },
  },
});
