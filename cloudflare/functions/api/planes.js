// 飛行機の位置（adsb.lol を中継）。回数制限・ロボット対策・入力チェック・15秒キャッシュ
import { json, limited, verifyCookie } from "../../lib/guard.js";

export async function onRequestGet({ request, env, waitUntil }) {
  const lim = limited(request, "planes", 12, 60); if (lim) return lim;
  if (!(await verifyCookie(request, env))) return json({ error: "verification required" }, 403);
  const u = new URL(request.url);
  const lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return json({ error: "bad request" }, 400);
  const la = lat.toFixed(1), lo = lon.toFixed(1);
  const cache = caches.default, key = new Request(`${u.origin}/api/planes?lat=${la}&lon=${lo}`);
  const hit = await cache.match(key); if (hit) return hit;
  for (const src of [`https://api.adsb.lol/v2/point/${la}/${lo}/250`, `https://api.airplanes.live/v2/point/${la}/${lo}/250`]) {
    try {
      const r = await fetch(src, { headers: { "User-Agent": "TrendScope-public/1.0" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      const planes = (j.ac || []).filter((a) => a.lat != null && a.lon != null).slice(0, 800).map((a) => ({
        lat: a.lat, lon: a.lon, track: a.track || 0, call: (a.flight || "").trim(),
        alt_m: typeof a.alt_baro === "number" ? Math.round(a.alt_baro * 0.3048) : 0, spd_kmh: Math.round((a.gs || 0) * 1.852),
      }));
      const res = json({ planes, source: new URL(src).host }, 200, { "Cache-Control": "public, max-age=15" });
      waitUntil(cache.put(key, res.clone()));
      return res;
    } catch {}
  }
  return json({ planes: [], error: "upstream unavailable" }, 502);
}
