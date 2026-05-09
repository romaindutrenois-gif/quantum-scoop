import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, RefreshCw, Atom } from "lucide-react";
import { listArticles, refreshArticles } from "@/lib/news.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Quantum Wire — Quantum Computing News Aggregator" },
      {
        name: "description",
        content:
          "The latest quantum computing news, curated and summarized into one sentence each.",
      },
      { property: "og:title", content: "Quantum Wire — Quantum Computing News" },
      {
        property: "og:description",
        content:
          "Daily aggregated quantum computing headlines with one-sentence executive summaries.",
      },
    ],
  }),
  component: Index,
});

function formatRelative(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Index() {
  const list = useServerFn(listArticles);
  const refresh = useServerFn(refreshArticles);
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["articles"],
    queryFn: () => list(),
    refetchOnWindowFocus: false,
  });

  const refreshMutation = useMutation({
    mutationFn: () => refresh(),
    onSuccess: (res) => {
      toast.success(`Refreshed — ${res.inserted} articles updated`);
      qc.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: (err: Error) => {
      toast.error(`Refresh failed: ${err.message}`);
    },
  });

  const articles = data?.articles ?? [];

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-16 sm:pt-24">
        <header className="mb-12 border-b border-border pb-10">
          <div className="mb-6 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
            <Atom className="h-4 w-4" aria-hidden />
            Quantum Wire
          </div>
          <h1 className="font-serif text-5xl leading-[1.05] tracking-tight text-foreground sm:text-6xl">
            Quantum computing,
            <br />
            <span className="italic text-muted-foreground">in one sentence.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
            A focused digest of the most relevant quantum computing news from the
            first two pages of search results, summarized into a single sentence each.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              size="sm"
              className="gap-2"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`}
              />
              {refreshMutation.isPending ? "Refreshing…" : "Refresh now"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Last updated {formatRelative(data?.lastRefreshedAt ?? null)}
            </span>
          </div>
        </header>

        {isLoading && (
          <div className="space-y-10">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                <div className="h-7 w-5/6 animate-pulse rounded bg-muted" />
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <p className="text-sm text-destructive">
            Couldn't load articles. Try refreshing.
          </p>
        )}

        {!isLoading && !isError && articles.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No articles yet. Click <strong>Refresh now</strong> to fetch the latest
              quantum computing news.
            </p>
          </div>
        )}

        <ol className="space-y-12">
          {articles.map((a, idx) => (
            <li key={a.id} className="group">
              <div className="mb-3 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
                <span className="font-mono tabular-nums">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className="h-px flex-1 bg-border" />
                <span>{a.source ?? hostnameOf(a.url)}</span>
              </div>
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <h2 className="font-serif text-2xl font-medium leading-snug text-foreground transition-colors group-hover:text-primary sm:text-[1.7rem]">
                  {a.title}
                  <ExternalLink className="ml-2 inline h-4 w-4 -translate-y-0.5 opacity-0 transition-opacity group-hover:opacity-60" />
                </h2>
              </a>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                {a.summary}
              </p>
            </li>
          ))}
        </ol>

        <footer className="mt-24 border-t border-border pt-8 text-xs text-muted-foreground">
          Refreshed hourly · Powered by AI-grounded search
        </footer>
      </div>
    </main>
  );
}
