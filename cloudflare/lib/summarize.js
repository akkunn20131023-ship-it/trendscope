// 記事本文を取得して Workers AI で「3行要約」「なぜ話題？」を作る（KV "sum:<id>" に30日保存）
import { chat } from "./ai.js";
import { getSummary } from "./archive.js";

const UA = "TrendScope-public/1.0 (+https://github.com/akkunn20131023-ship-it/trendscope)";

export class SumError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

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

const unbullet = (l) => l.replace(/^\s*[-・*•]\s*/, "").trim();

export async function summarizeItem(env, item) {
  const saved = await getSummary(env, item.id);
  if (saved) return saved;
  if (!env.AI) throw new SumError(503, "AI要約はまだ準備中です（管理者の設定待ち）");
  const text = await fetchArticle(item.url);
  if (text.length < 200) throw new SumError(422, "元記事の本文を取得できなかったため要約できません。元記事でご確認ください。");
  const prompt = `以下はニュース記事「${item.title}」の本文の抜粋です。本文に書かれている内容だけを使って、日本語で答えてください。推測や誇張は入れないでください。\n` +
    `出力形式（この形式以外は書かない）：\n要約:\n- （1行目・60字以内）\n- （2行目・60字以内）\n- （3行目・60字以内）\nなぜ話題:\n（なぜ注目されているのかを1〜2文、本文から分かる範囲で）\n\n本文:\n${text}`;
  let r;
  try { r = await chat(env.AI, prompt, { max_tokens: 700 }); }
  catch (e) { throw new SumError(503, "AIが混み合っています。少し待ってからお試しください。"); }
  const [a, b = ""] = r.text.split(/なぜ話題[:：]/);
  const lines = (a.match(/^\s*[-・*•]\s*(.+)$/gm) || []).map(unbullet).filter(Boolean).slice(0, 3);
  const why = b.split("\n").map(unbullet).filter(Boolean).join("").slice(0, 300);
  if (!lines.length) throw new SumError(502, "要約を作れませんでした。");
  const res = { id: item.id, lines, why, model: r.model.split("/").pop(), at: Date.now(), note: "AIによる自動要約です。正確な内容は元記事でご確認ください。" };
  try { await env.TS.put("sum:" + item.id, JSON.stringify(res), { expirationTtl: 30 * 86400 }); } catch {}
  return res;
}
