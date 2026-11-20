// 「今日の5本」：毎朝6時（日本時間）以降の最初のアップロードで、その日の注目5本を要約つきで作る
import { summarizeItem } from "./summarize.js";

export const jst = (t = Date.now()) => new Date(t + 9 * 3600 * 1000);
export const jstDate = (t) => jst(t).toISOString().slice(0, 10);
export const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

function pickCandidates(news) {
  const now = Date.now() / 1000;
  const ok = (news || []).filter((i) => /^https?:\/\//.test(i.url || "") && (i.bait?.stars || 1) <= 2 && (!i.time || now - i.time < 36 * 3600));
  const byCat = {};
  ok.forEach((i) => (byCat[i.cat || "other"] ||= []).push(i));
  const cats = Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length);
  const out = [];
  for (let round = 0; out.length < 12 && round < 6; round++)
    for (const c of cats) { const i = byCat[c][round]; if (i && out.length < 12) out.push(i); }
  return out;
}

export async function maybeBuildToday(env, news, force = false) {
  if (!env.TS || !env.AI) return { skipped: "no AI" };
  const date = jstDate();
  if (!force && jst().getUTCHours() < 6) return { skipped: "before 6am" };
  if (!force && (await env.TS.get("today:" + date))) return { skipped: "exists" };
  const cands = pickCandidates(news), items = [];
  for (let k = 0; k < cands.length && items.length < 5; k += 5) {
    const group = cands.slice(k, k + (5 - items.length) + 1);
    const res = await Promise.all(group.map((i) => summarizeItem(env, i).then((s) => ({ i, s })).catch(() => null)));
    for (const r of res) if (r && items.length < 5 && !items.some((x) => x.id === r.i.id))
      items.push({ id: r.i.id, title: r.i.title, title_ja: r.i.title_ja || "", source: r.i.source, url: r.i.url, cat: r.i.cat, time: r.i.time, bait: r.i.bait, lines: r.s.lines, why: r.s.why });
  }
  if (items.length < 3) return { skipped: "not enough", got: items.length };
  await env.TS.put("today:" + date, JSON.stringify({ date, built: Date.now(), items }), { expirationTtl: 120 * 86400 });
  let idx = []; try { idx = JSON.parse((await env.TS.get("today:index")) || "[]"); } catch {}
  idx = [date, ...idx.filter((d) => d !== date)].slice(0, 60);
  await env.TS.put("today:index", JSON.stringify(idx));
  return { built: date, items: items.length };
}

export async function loadToday(env, date) {
  let idx = []; try { idx = JSON.parse((await env.TS.get("today:index", { cacheTtl: 300 })) || "[]"); } catch {}
  const d = date || idx[0];
  if (!d) return { idx, day: null };
  let day = null; try { day = JSON.parse((await env.TS.get("today:" + d, { cacheTtl: 300 })) || "null"); } catch {}
  return { idx, day };
}
