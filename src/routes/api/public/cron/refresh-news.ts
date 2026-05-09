import { createFileRoute } from "@tanstack/react-router";
import { refreshArticlesNow } from "@/lib/news.server";

export const Route = createFileRoute("/api/public/cron/refresh-news")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await refreshArticlesNow();
          return new Response(JSON.stringify({ ok: true, ...result }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
