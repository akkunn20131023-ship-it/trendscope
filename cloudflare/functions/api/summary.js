// 記事の「3行要約」と「なぜ話題？」を Workers AI で作る（作った結果は30日保存して使い回す）
import { json, limited, verifyCookie } from "../../lib/guard.js";
import { getItem, getSummary, validId } from "../../lib/archive.js";

const MODEL = "@cf/google/gemma-3-12b-it";
const UA = "TrendScope-public/1.0 (+https://github.com/akkunn20131023-ship-it/trendscope)";

function extractText(html) {
  const meta = (html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]*content=["']([^"']{20,})["']/i) || [])[1] || "";
  const body = html.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, " ");
  const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter((t) => t.length > 40);
  const dec = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  return dec([meta, ...paras].join("\n")).slice(0, 6000);
}

async function fetchArticle(url) {
  if (!/^https?:\/\//.test(url)) return "";
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!r.ok || !(r.headers.get("Content-Type") || "").includes("html")) return "";
    const buf = await r.arrayBuffer();
    return extractText(new TextDecoder().decode(buf.slice(0, 1500000)));
  } catch { return ""; }
}

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!validId(id)) return json({ error: "bad request" }, 400);
  const saved = await getSummary(env, id);
  if (saved) return json(saved, 200, { "Cache-Control": "public, max-age=600" });
  const lim = limited(request, "summary", 8, 60); if (lim) return lim;
  if (!(await verifyCookie(request, env))) return json({ error: "verification required" }, 403);
  if (!env.AI) return json({ error: "AI要約はまだ準備中です（管理者の設定待ち）" }, 503);
  const item = await getItem(env, id);
  if (!item) return json({ error: "記事が見つかりません（古くなった可能性があります）" }, 404);
  const text = await fetchArticle(item.url);
  if (text.length < 200) return json({ error: "元記事の本文を取得できなかったため要約できません。元記事でご確認ください。" }, 422);
  const prompt = `以下はニュース記事「${item.title}」の本文の抜粋です。本文に書かれている内容だけを使って、日本語で答えてください。推測や誇張は入れないでください。\n` +
    `出力形式（この形式以外は書かない）：\n要約:\n- （1行目・60字以内）\n- （2行目・60字以内）\n- （3行目・60字以内）\nなぜ話題:\n（なぜ注目されているのかを1〜2文、本文から分かる範囲で）\n\n本文:\n${text}`;
  let out = "";
  try { const r = await env.AI.run(MODEL, { messages: [{ role: "user", content: prompt }], max_tokens: 600, temperature: 0.2 }); out = String(r?.response || ""); }
  catch (e) { return json({ error: "AIが混み合っています。少し待ってからお試しください。" }, 503); }
  const lines = (out.split(/なぜ話題[:：]/)[0].match(/^\s*[-・*]\s*(.+)$/gm) || []).map((l) => l.replace(/^\s*[-・*]\s*/, "").trim()).filter(Boolean).slice(0, 3);
  const why = ((out.split(/なぜ話題[:：]/)[1] || "").trim().split("\n").filter((l) => l.trim()).join(" ")).slice(0, 300);
  if (!lines.length) return json({ error: "要約を作れませんでした。" }, 502);
  const res = { id, lines, why, at: Date.now(), note: "AIによる自動要約です。正確な内容は元記事でご確認ください。" };
  try { await env.TS.put("sum:" + id, JSON.stringify(res), { expirationTtl: 30 * 86400 }); } catch {}
  return json(res);
}
