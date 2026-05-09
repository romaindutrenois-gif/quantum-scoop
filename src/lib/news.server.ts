import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ArticleItem = {
  title: string;
  summary: string;
  url: string;
  source?: string | null;
  published_at?: string | null;
};

// Google News RSS = the simplest no-key crawler that actually returns REAL
// article URLs. Plain google.com search blocks server-side scraping with a
// consent/captcha wall, but the news.google.com RSS endpoint is open.
// We request 2 "pages" worth (~20 items) of "Quantum Computing News".
const FEED_URL =
  "https://news.google.com/rss/search?q=quantum+computing+news&hl=en-US&gl=US&ceid=US:en";

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanText(text: string): string {
  return decodeEntities(text)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  return cleanText(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

function toOneSentence(text: string, fallback: string): string {
  const clean = cleanText(text || fallback);
  const m = clean.match(/^(.{20,250}?[.!?])(\s|$)/);
  return (m ? m[1] : clean.slice(0, 200)).trim();
}

function stripSourceFromTitle(title: string, source?: string | null): string {
  const cleanTitle = cleanText(title);
  if (!source) return cleanTitle;
  return cleanTitle.replace(new RegExp(`\\s+-\\s+${escapeRegExp(source)}$`, "i"), "").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractGoogleNewsId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const parent = parts.at(-2);
    if (parsed.hostname === "news.google.com" && (parent === "articles" || parent === "read")) {
      return parts.at(-1) ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

async function decodeGoogleNewsUrl(url: string): Promise<string> {
  const id = extractGoogleNewsId(url);
  if (!id) return url;

  const pageUrls = [
    `https://news.google.com/articles/${id}`,
    `https://news.google.com/rss/articles/${id}`,
  ];

  for (const pageUrl of pageUrls) {
    try {
      const page = await fetch(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; QuantumNewsBot/1.0; +https://lovable.dev)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!page.ok) continue;

      const html = await page.text();
      const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
      const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
      if (!signature || !timestamp) continue;

      const request = [
        [
          "Fbv4je",
          JSON.stringify([
            "garturlreq",
            [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
            id,
            Number(timestamp),
            signature,
          ]),
        ],
      ];

      const response = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (compatible; QuantumNewsBot/1.0; +https://lovable.dev)",
        },
        body: new URLSearchParams({ "f.req": JSON.stringify(request) }),
      });
      if (!response.ok) continue;

      const text = await response.text();
      const payload = text.split("\n\n")[1] ?? text.replace(/^\)\]\}'\n?/, "");
      const parsed = JSON.parse(payload) as unknown[];
      const result = parsed.find(
        (row): row is [string, string, string] => Array.isArray(row) && row[0] === "wrb.fr" && row[1] === "Fbv4je" && typeof row[2] === "string",
      );
      if (!result) continue;

      const decoded = JSON.parse(result[2]) as unknown[];
      const directUrl = typeof decoded[1] === "string" ? decoded[1] : null;
      if (directUrl?.startsWith("http")) return directUrl;
    } catch {
      continue;
    }
  }

  return url;
}

async function mapWithLimit<T, U>(items: T[], limit: number, mapper: (item: T) => Promise<U>): Promise<U[]> {
  const results: U[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...(await Promise.all(batch.map(mapper))));
  }
  return results;
}

export async function fetchQuantumNewsFromGoogle(): Promise<ArticleItem[]> {
  const res = await fetch(FEED_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; QuantumNewsBot/1.0; +https://lovable.dev)",
      Accept: "application/rss+xml, application/xml, text/xml",
    },
  });
  if (!res.ok) throw new Error(`Google News RSS error ${res.status}`);
  const xml = await res.text();

  const items = xml.split(/<item[\s>]/i).slice(1).map((chunk) => "<item " + chunk);
  const articles: ArticleItem[] = [];
  for (const item of items) {
    const title = pick(item, "title");
    const link = pick(item, "link");
    const desc = pick(item, "description");
    const pub = pick(item, "pubDate");
    const source = pick(item, "source");
    if (!title || !link) continue;
    articles.push({
      title: stripSourceFromTitle(title, source),
      url: link,
      summary: toOneSentence(desc ?? "", stripSourceFromTitle(title, source)),
      source: source ?? null,
      published_at: pub ? new Date(pub).toISOString() : null,
    });
    if (articles.length >= 20) break; // first 2 pages worth
  }
  return mapWithLimit(articles, 4, async (article) => ({
    ...article,
    url: await decodeGoogleNewsUrl(article.url),
  }));
}

export async function refreshArticlesNow(): Promise<{
  inserted: number;
  total: number;
}> {
  let articles: ArticleItem[] = [];
  try {
    articles = await fetchQuantumNewsFromGoogle();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("refresh_log")
      .insert({ status: "error", error: message, inserted_count: 0 });
    throw err;
  }

  const rows = articles.map((a) => ({
    url: a.url,
    title: a.title.trim(),
    summary: a.summary.trim(),
    source: a.source ?? null,
    published_at: a.published_at ?? null,
    fetched_at: new Date().toISOString(),
  }));

  let inserted = 0;
  if (rows.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("articles")
      .upsert(rows, { onConflict: "url", ignoreDuplicates: false })
      .select("id");
    if (error) {
      await supabaseAdmin
        .from("refresh_log")
        .insert({ status: "error", error: error.message, inserted_count: 0 });
      throw error;
    }
    inserted = data?.length ?? 0;
  }

  const { data: keep } = await supabaseAdmin
    .from("articles")
    .select("id")
    .order("fetched_at", { ascending: false })
    .limit(20);
  const keepIds = (keep ?? []).map((r) => r.id);
  if (keepIds.length > 0) {
    await supabaseAdmin
      .from("articles")
      .delete()
      .not("id", "in", `(${keepIds.join(",")})`);
  }

  await supabaseAdmin
    .from("refresh_log")
    .insert({ status: "ok", inserted_count: inserted });

  return { inserted, total: rows.length };
}
