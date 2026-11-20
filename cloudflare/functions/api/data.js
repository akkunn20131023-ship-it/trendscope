// 公開データを配信。Cloudflareのキャッシュに5分置いて、KVの読み込み回数を節約
import { json, limited } from "../../lib/guard.js";

export async function onRequestGet({ request, env, waitUntil }) {
  const lim = limited(request, "data", 60, 60); if (lim) return lim;
  const cache = caches.default, key = new Request(new URL("/api/data", request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const data = env.TS ? await env.TS.get("latest") : null;
  if (!data) return json({ error: "まだデータがありません" }, 503, { "Cache-Control": "no-store" });
  const res = new Response(data, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  waitUntil(cache.put(key, res.clone()));
  return res;
}
