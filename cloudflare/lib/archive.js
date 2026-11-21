import { linkRelated } from "./related.js";
// 記事の保管庫（共有ページ用）。KV "archive" に直近の記事を最大 ARCH_MAX 件だけ保存する。
const ARCH_MAX = 1500;
export const validId = (id) => /^[a-z]{2,4}_[A-Za-z0-9]{1,40}$/.test(id || "");
const slim = (i) => ({ id: i.id, title: i.title, title_ja: i.title_ja || "", source: i.source || "", url: i.url || "", disc: i.disc || "",
  cat: i.cat || "", time: i.time || 0, bait: i.bait || {} });

export async function updateArchive(env, news) {
  let a = {};
  try { a = JSON.parse((await env.TS.get("archive")) || "{}"); } catch {}
  const fresh = [];
  for (const i of news || []) if (validId(i.id) && /^https?:\/\//.test(i.url || "")) { if (!a[i.id] || !("prev" in a[i.id] || a[i.id].linked)) fresh.push(i.id); a[i.id] = { ...(a[i.id] || {}), ...slim(i) }; }
  const list = Object.values(a).sort((x, y) => (y.time || 0) - (x.time || 0)).slice(0, ARCH_MAX);
  const kept = Object.fromEntries(list.map((i) => [i.id, i]));
  try { linkRelated(kept, fresh.filter((id) => kept[id])); fresh.forEach((id) => { if (kept[id]) kept[id].linked = 1; }); } catch {}
  await env.TS.put("archive", JSON.stringify(kept));
  // 最新データの各記事に「これまでの流れ」（過去の関連記事）を付ける
  for (const i of news || []) {
    const prev = (kept[i.id]?.prev || []).map((pid) => kept[pid]).filter(Boolean);
    if (prev.length) i.prev = prev.map((p) => ({ id: p.id, t: p.title_ja || p.title, s: p.source, time: p.time }));
  }
  return list.length;
}

export async function loadArchive(env) {
  try { return JSON.parse((await env.TS.get("archive", { cacheTtl: 300 })) || "{}"); } catch { return {}; }
}

export async function getItem(env, id) {
  if (!validId(id) || !env.TS) return null;
  const a = await loadArchive(env);
  if (a[id]) return a[id];
  try { const d = JSON.parse((await env.TS.get("latest", { cacheTtl: 300 })) || "{}"); return (d.news || []).find((i) => i.id === id) || null; } catch { return null; }
}

export async function getSummary(env, id) {
  if (!validId(id) || !env.TS) return null;
  try { return JSON.parse((await env.TS.get("sum:" + id, { cacheTtl: 600 })) || "null"); } catch { return null; }
}
