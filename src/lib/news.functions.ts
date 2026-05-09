import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshArticlesNow } from "./news.server";

export const listArticles = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("articles")
    .select("id, url, title, summary, source, published_at, fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);

  const { data: lastRun } = await supabaseAdmin
    .from("refresh_log")
    .select("ran_at, status")
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    articles: data ?? [],
    lastRefreshedAt: lastRun?.ran_at ?? null,
  };
});

export const refreshArticles = createServerFn({ method: "POST" }).handler(async () => {
  const result = await refreshArticlesNow();
  return result;
});
