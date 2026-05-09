## Quantum Computing News Aggregator

A simple, focused page that lists recent quantum computing news. Each item shows a title, a one-sentence summary, and a link to the source. Results are fetched on a schedule and cached, so the page loads instantly.

### User-facing

- Single page at `/` with:
  - Header: "Quantum Computing News" + last-updated timestamp
  - List of article cards (title → external link, one-sentence summary below)
  - Manual "Refresh now" button (re-runs the aggregator on demand)
- Empty / loading / error states
- Clean editorial design (serif display headline, generous spacing, restrained palette)

### How it works

1. **Lovable Cloud** is enabled to provide a database (cache) and scheduling.
2. A scheduled job runs hourly:
   - Calls **Lovable AI Gateway** (Gemini with Google Search grounding) asking for the top quantum computing news from roughly the first two pages of Google results.
   - Model returns structured JSON: `[{ title, summary (1 sentence), url, source, published_at }]`.
   - Job upserts into the `articles` table (dedupe by URL) and trims to the most recent ~20.
3. The page reads from the `articles` table — no live API call on page load.
4. "Refresh now" button triggers the same aggregator on demand.

### Technical details

- **Stack**: TanStack Start (existing), Lovable Cloud (Supabase), Lovable AI Gateway.
- **DB table** `articles`: `id`, `url` (unique), `title`, `summary`, `source`, `published_at`, `fetched_at`. Public read RLS; writes via service role only.
- **Server function** `refreshArticles` (in `src/lib/news.functions.ts`):
  - Calls Gemini via `https://ai.gateway.lovable.dev/v1/chat/completions` with `google/gemini-2.5-flash`, `tools: [{ google_search: {} }]`, and a JSON-schema response format constraining output to the article array.
  - Prompt limits scope to ~20 results (≈ first 2 pages of Google).
  - Upserts results using `supabaseAdmin`.
- **Server function** `listArticles`: returns latest 20 from DB (public).
- **Schedule**: a public route `src/routes/api/public/cron/refresh-news.ts` that calls the refresh logic, protected by a `CRON_SECRET` header. Triggered hourly by pg_cron in the Cloud DB hitting the stable `project--{id}.lovable.app` URL.
- **Frontend** `src/routes/index.tsx`: TanStack Query + `useSuspenseQuery` to read articles; mutation hook for the refresh button.

### Out of scope

- Per-user accounts, saved articles, categories/filters, full-text search.
- Article body scraping (we use the snippet returned by the grounded model as the summary).
