// 記事の保管庫（共有ページ用）。KV "archive" に直近の記事を最大 ARCH_MAX 件だけ保存する。
const ARCH_MAX = 1500;
export const validId = (id) => /^[a-z]{2,4}_[A-Za-z0-9]{1,40}$/.test(id || "");
const slim = (i) => ({ id: i.id, title: i.title, title_ja: i.title_ja || "", source: i.source || "", url: i.url || "", disc: i.disc || "",
  cat: i.cat || "", time: i.time || 0, bait: i.bait || {} });

export async function updateArchive(env, news) {
  let a = {};
  try { a = JSON.parse((await env.TS.get("archive")) || "{}"); } catch {}
  for (const i of news || []) if (validId(i.id) && /^https?:\/\//.test(i.url || "")) a[i.id] = { ...(a[i.id] || {}), ...slim(i) };
  const list = Object.values(a).sort((x, y) => (y.time || 0) - (x.time || 0)).slice(0, ARCH_MAX);
  await env.TS.put("archive", JSON.stringify(Object.fromEntries(list.map((i) => [i.id, i]))));
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
