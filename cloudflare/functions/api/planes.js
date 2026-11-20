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
  const errors = [];
  const ok = (planes, source) => {
    const res = json({ planes, source }, 200, { "Cache-Control": "public, max-age=15" });
    waitUntil(cache.put(key, res.clone()));
    return res;
  };
  for (const src of [`https://api.adsb.lol/v2/point/${la}/${lo}/250`, `https://api.airplanes.live/v2/point/${la}/${lo}/250`]) {
    try {
      const r = await fetch(src, { headers: { "User-Agent": "TrendScope-public/1.0 (+https://github.com/akkunn20131023-ship-it/trendscope)", Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) { errors.push(`${new URL(src).host}: HTTP ${r.status}`); continue; }
      const j = await r.json();
      return ok((j.ac || []).filter((a) => a.lat != null && a.lon != null).slice(0, 800).map((a) => ({
        lat: a.lat, lon: a.lon, track: a.track || 0, call: (a.flight || "").trim(),
        alt_m: typeof a.alt_baro === "number" ? Math.round(a.alt_baro * 0.3048) : 0, spd_kmh: Math.round((a.gs || 0) * 1.852),
      })), new URL(src).host);
    } catch (e) { errors.push(`${new URL(src).host}: ${e.name}`); }
  }
  // 予備：OpenSky Network（範囲は中心から約±2.2度）
  try {
    const d = 2.2, q = `lamin=${lat - d}&lamax=${lat + d}&lomin=${lon - d * 1.3}&lomax=${lon + d * 1.3}`;
    const r = await fetch(`https://opensky-network.org/api/states/all?${q}`, { headers: { "User-Agent": "TrendScope-public/1.0" }, signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const j = await r.json();
      return ok((j.states || []).filter((s) => s[5] != null && s[6] != null).slice(0, 800).map((s) => ({
        lat: s[6], lon: s[5], track: s[10] || 0, call: (s[1] || "").trim(), alt_m: Math.round(s[7] || 0), spd_kmh: Math.round((s[9] || 0) * 3.6),
      })), "opensky-network.org");
    }
    errors.push(`opensky: HTTP ${r.status}`);
  } catch (e) { errors.push(`opensky: ${e.name}`); }
  return json({ planes: [], error: "upstream unavailable", detail: errors }, 502);
}
