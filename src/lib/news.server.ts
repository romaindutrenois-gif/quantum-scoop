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

function pick(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function toOneSentence(text: string): string {
  if (!text) return "";
  // Description from Google News is HTML with a list of related links — strip,
  // then keep the first sentence.
  const clean = text.replace(/\s+/g, " ").trim();
  const m = clean.match(/^(.{20,250}?[.!?])(\s|$)/);
  return (m ? m[1] : clean.slice(0, 200)).trim();
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
      title,
      url: link,
      summary: toOneSentence(desc ?? title),
      source: source ?? null,
      published_at: pub ? new Date(pub).toISOString() : null,
    });
    if (articles.length >= 20) break; // first 2 pages worth
  }
  return articles;
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
