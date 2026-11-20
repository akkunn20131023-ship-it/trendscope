// 記事の「3行要約」と「なぜ話題？」（作った結果は30日保存して使い回す）
import { json, limited, verifyCookie } from "../../lib/guard.js";
import { getItem, getSummary, validId } from "../../lib/archive.js";
import { summarizeItem, SumError } from "../../lib/summarize.js";

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!validId(id)) return json({ error: "bad request" }, 400);
  const saved = await getSummary(env, id);
  if (saved) return json(saved, 200, { "Cache-Control": "public, max-age=600" });
  const lim = limited(request, "summary", 8, 60); if (lim) return lim;
  if (!(await verifyCookie(request, env))) return json({ error: "verification required" }, 403);
  const item = await getItem(env, id);
  if (!item) return json({ error: "記事が見つかりません（古くなった可能性があります）" }, 404);
  try { return json(await summarizeItem(env, item)); }
  catch (e) { return json({ error: e.message }, e instanceof SumError ? e.status : 500); }
}
