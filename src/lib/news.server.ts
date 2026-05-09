import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ArticleItem = {
  title: string;
  summary: string;
  url: string;
  source?: string | null;
  published_at?: string | null;
};

const SYSTEM_PROMPT = `You are a news aggregator. Given a topic, return the most relevant recent news articles you would find on the first two pages of a Google News search for that topic. Prefer reputable sources, dedupe by URL, and write a concise one-sentence executive summary for each.`;

const USER_PROMPT = `Find the most relevant recent news articles about quantum computing.

Constraints:
- Limit to results that would appear on roughly the first two Google search results pages (about 15 to 20 articles maximum).
- Each article must have a real, working URL.
- The "summary" must be exactly one sentence (about 20 to 30 words) capturing the core news.
- Prefer articles published in the last 30 days.
- Skip duplicates and aggregator pages.

Return ONLY a JSON object with shape: { "articles": [ { "title": string, "summary": string, "url": string, "source": string, "published_at": string | null } ] }
"published_at" should be ISO 8601 if known, otherwise null.`;

export async function fetchQuantumNewsFromAI(): Promise<ArticleItem[]> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_PROMPT },
      ],
      tools: [{ google_search: {} }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI gateway error [${res.status}]: ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";

  // Extract JSON object from the content (model may wrap with markdown fences)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI response did not contain JSON");
  }
  let parsed: { articles?: ArticleItem[] };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error("Failed to parse AI JSON response");
  }

  const articles = Array.isArray(parsed.articles) ? parsed.articles : [];
  return articles
    .filter(
      (a) =>
        a &&
        typeof a.title === "string" &&
        typeof a.summary === "string" &&
        typeof a.url === "string" &&
        /^https?:\/\//i.test(a.url),
    )
    .slice(0, 25);
}

export async function refreshArticlesNow(): Promise<{
  inserted: number;
  total: number;
}> {
  let articles: ArticleItem[] = [];
  try {
    articles = await fetchQuantumNewsFromAI();
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

  // Trim to most recent 20 by fetched_at
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
