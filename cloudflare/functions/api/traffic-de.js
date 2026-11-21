// ドイツ高速道路の事故・通行止め（6分割で取得し、各10分キャッシュ。無料プランの外部アクセス回数上限に収めるため）
import { json, limited } from "../../lib/guard.js";
import { roads, roadItems } from "../../lib/autobahn.js";
export const PARTS = 6;

export async function onRequestGet({ request, waitUntil }) {
  const u = new URL(request.url), part = Number(u.searchParams.get("part"));
  if (!Number.isInteger(part) || part < 0 || part >= PARTS) return json({ error: "bad request" }, 400);
  const cache = caches.default, key = new Request(`${u.origin}/api/traffic-de?part=${part}`);
  const hit = await cache.match(key); if (hit) return hit;
  const lim = limited(request, "traffic", 30, 60); if (lim) return lim;
  let list = [];
  try { list = await roads(); } catch (e) { return json({ error: "取得に失敗しました", detail: String(e).slice(0, 100) }, 502); }
  const mine = list.filter((_, k) => k % PARTS === part).slice(0, 22); // 1回あたり外部アクセス最大 1+44 回
  const items = [];
  for (let k = 0; k < mine.length; k += 6) {
    const res = await Promise.all(mine.slice(k, k + 6).map((r) => roadItems(r).catch(() => [])));
    res.forEach((a) => items.push(...a));
  }
  const res = json({ part, roads: mine, items, at: Date.now() }, 200, { "Cache-Control": "public, max-age=600" });
  waitUntil(cache.put(key, res.clone()));
  return res;
}
