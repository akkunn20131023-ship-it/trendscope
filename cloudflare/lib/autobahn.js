// ドイツ高速道路（Autobahn GmbH 公式オープンAPI）の事故・渋滞・通行止めを日本語向けに整形
const AB = "https://verkehr.autobahn.de/o/autobahn/";
const UA = "TrendScope-public/1.0 (+https://github.com/akkunn20131023-ship-it/trendscope)";
const WORDS = [["Vollsperrung", "全面通行止め"], ["gesperrt", "通行止め"], ["Unfall", "事故"], ["Bergungsarbeiten", "事故車の撤去作業"],
  ["Fahrstreifen", "車線規制"], ["Stau", "渋滞"], ["Stillstand", "停止"], ["Baustelle", "工事"], ["Fahrbahninstandsetzung", "路面補修"],
  ["Brückenarbeiten", "橋の工事"], ["Gefahr", "危険"], ["Glätte", "路面凍結"], ["Schnee", "雪"], ["Nebel", "霧"],
  ["Personen auf der Fahrbahn", "道路上に人"], ["Gegenstände auf der Fahrbahn", "道路上に落下物"], ["liegengebliebenes Fahrzeug", "故障車"], ["Falschfahrer", "逆走車"]];
const RANGE = /(\d{2})\.(\d{2})\.(\d{2})\s+(?:um\s+)?(\d{1,2}):(\d{2})[\s\S]{0,20}?bis\s+(?:zum\s+)?(\d{2})\.(\d{2})\.(\d{2})\s+(?:um\s+)?(\d{1,2}):(\d{2})/;

function berlinOffset(y, mo, d, hh) {
  const lastSun = (m) => { const x = new Date(Date.UTC(y, m, 0)); return x.getUTCDate() - x.getUTCDay(); }; // m: 3=3月
  const s = lastSun(3), e = lastSun(10);
  const summer = (mo > 3 && mo < 10) || (mo === 3 && (d > s || (d === s && hh >= 3))) || (mo === 10 && (d < e || (d === e && hh < 3)));
  return summer ? 2 : 1;
}
const deTime = (dd, mm, yy, hh, mi) => { const y = 2000 + +yy; return Math.round(Date.UTC(y, +mm - 1, +dd, +hh - berlinOffset(y, +mm, +dd, +hh), +mi) / 1000); };

function tagsOf(text) {
  const low = text.toLowerCase(), tags = [];
  for (const [de, ja] of WORDS) if (low.includes(de.toLowerCase()) && !tags.includes(ja)) tags.push(ja);
  if (tags.includes("通行止め") && (tags.includes("全面通行止め") || tags.includes("車線規制"))) tags.splice(tags.indexOf("通行止め"), 1);
  return tags.slice(0, 5);
}
function line(geom, n = 24) {
  const pts = geom?.coordinates || []; if (!pts.length || !Array.isArray(pts[0])) return [];
  const step = Math.max(1, Math.floor(pts.length / n)), r = (v) => Math.round(v * 1e5) / 1e5;
  const out = pts.filter((_, k) => k % step === 0).map((p) => [r(p[1]), r(p[0])]);
  const last = pts[pts.length - 1]; out.push([r(last[1]), r(last[0])]);
  return out;
}
function item(x, hint) {
  const desc = (x.description || []).join("\n"), c = x.coordinate || {};
  const lat = +c.lat, lon = +c.long; if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let start = null, end = null;
  const m = desc.match(RANGE); if (m) { start = deTime(...m.slice(1, 6)); end = deTime(...m.slice(6, 11)); }
  if (x.startTimestamp) { const t = Date.parse(x.startTimestamp); if (t) start = Math.round(t / 1000); }
  const tags = tagsOf(desc + " " + (x.title || ""));
  const accident = tags.includes("事故") || /Unfall/.test(desc);
  const blocked = String(x.isBlocked) === "true" || tags.includes("全面通行止め");
  const kind = hint === "closure" ? "closure" : accident ? "accident" : blocked ? "closure" : "jam";
  const num = (v) => (/^\d+$/.test(String(v ?? "")) ? +v : null);
  const [road, ...sec] = String(x.title || "").split("|");
  return { id: String(x.identifier || "").slice(0, 80), kind, country: "DE", lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5,
    road: road.trim(), section: sec.join("|").trim(), dir: String(x.subtitle || "").trim(), start, end,
    delay: num(x.delayTimeValue), speed: num(x.averageSpeed), blocked, tags, line: line(x.geometry), src: "Autobahn GmbH" };
}
async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(10000), cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
export async function roads() {
  const j = await getJSON(AB);
  return (j.roads || []).map((r) => r.trim()).filter((r) => /^A\s?\d+$/.test(r)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
}
export async function roadItems(road, dbg) {
  const out = [], now = Date.now() / 1000;
  for (const svc of ["warning", "closure"]) {
    let j; try { j = await getJSON(AB + encodeURIComponent(road) + "/services/" + svc); } catch (e) { dbg?.errors.push(`${road}/${svc}: ${e.message}`); continue; }
    if (dbg) { dbg.raw[svc] = (dbg.raw[svc] || 0) + (j[svc] || []).length; const b = (j[svc] || []).find((x) => x.future !== true && String(x.isBlocked) === "true"); if (b && dbg.samples.length < 3) dbg.samples.push((b.description || []).slice(0, 4)); }
    for (const x of j[svc] || []) {
      if (x.future === true) continue;
      const it = item(x, svc); if (!it) continue;
      if (it.end && it.end < now) continue;
      if (svc === "closure") { if (!(it.blocked || (it.end && it.end - now < 6 * 3600))) continue; }
      else if (it.kind === "jam" && (it.delay || 0) < 15) continue;
      out.push(it);
    }
  }
  return out;
}
export { item as _item, berlinOffset as _bo };
