// 見出しと中身の答え合わせ（記事ID または URL）。結果は保存して使い回す
import { json, limited, verifyCookie } from "../../lib/guard.js";
import { getItem, validId } from "../../lib/archive.js";
import { gapCheck, SumError } from "../../lib/summarize.js";

async function sha(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join(""); }

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams, id = q.get("id") || "", url = (q.get("url") || "").trim();
  let key, item = null;
  if (id) { if (!validId(id)) return json({ error: "bad request" }, 400); key = "gap:" + id; }
  else if (/^https?:\/\/[^\s]{4,490}$/.test(url)) {
    let u; try { u = new URL(url); } catch { return json({ error: "URLが正しくありません" }, 400); }
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)|\.local$/.test(u.hostname)) return json({ error: "このURLは使えません" }, 400);
    key = "gapu:" + (await sha(u.href));
  } else return json({ error: "記事IDかURLを指定してください" }, 400);
  try { const saved = await env.TS.get(key, { cacheTtl: 600 }); if (saved) return json(JSON.parse(saved)); } catch {}
  const lim = limited(request, "gap", 6, 60); if (lim) return lim;
  if (!(await verifyCookie(request, env))) return json({ error: "verification required" }, 403);
  if (id) { item = await getItem(env, id); if (!item) return json({ error: "記事が見つかりません" }, 404); }
  try {
    const res = await gapCheck(env, item ? { title: item.title, url: item.url } : { url });
    try { await env.TS.put(key, JSON.stringify(res), { expirationTtl: 30 * 86400 }); } catch {}
    return json(res);
  } catch (e) { return json({ error: e.message }, e instanceof SumError ? e.status : 500); }
}
