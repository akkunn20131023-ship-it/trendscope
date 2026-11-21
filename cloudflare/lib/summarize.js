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

// 見出しと本文の答え合わせ：見出しが中身をどれくらい正確に表しているか
const VERDICTS = [["見出しどおり", 1], ["少し盛っている", 2], ["かなり盛っている", 3], ["見出しと中身が違う", 4]];
export async function gapCheck(env, { title, url }) {
  if (!env.AI) throw new SumError(503, "AI機能はまだ準備中です");
  const page = await fetchPage(url);
  if (!page || page.text.length < 200) throw new SumError(422, "記事の本文を取得できなかったため、答え合わせできません。");
  const t = title || page.title;
  if (!t) throw new SumError(422, "見出しが分かりませんでした。");
  const prompt = `ニュースの見出しと本文を比べて、見出しが本文の内容をどれだけ正確に表しているかを判定してください。本文に書かれていることだけを根拠にしてください。\n` +
    `出力形式（この形式以外は書かない）：\n判定: （「見出しどおり」「少し盛っている」「かなり盛っている」「見出しと中身が違う」のどれか1つ）\n理由: （1〜2文の日本語）\n要約:\n- （本文の要点1・60字以内）\n- （要点2）\n- （要点3）\n\n見出し: ${t}\n\n本文:\n${page.text}`;
  let r;
  try { r = await chat(env.AI, prompt, { max_tokens: 700 }); } catch { throw new SumError(503, "AIが混み合っています。少し待ってからお試しください。"); }
  const txt = r.text;
  const vline = (txt.match(/判定[:：]\s*(.+)/) || [])[1] || "";
  const v = VERDICTS.find(([k]) => vline.includes(k)) || VERDICTS.find(([k]) => txt.includes(k));
  if (!v) throw new SumError(502, "判定できませんでした。");
  const reason = ((txt.match(/理由[:：]\s*([\s\S]*?)(?:\n\s*要約[:：]|$)/) || [])[1] || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const lines = ((txt.split(/要約[:：]/)[1] || "").match(/^\s*[-・*•]\s*(.+)$/gm) || []).map(unbullet).filter(Boolean).slice(0, 3);
  return { title: t, verdict: v[0], level: v[1], reason, lines, at: Date.now(), note: "AIによる自動判定です。最終的には元記事でご確認ください。" };
}

async function fetchPage(url) {
  if (!/^https?:\/\//.test(url || "")) return null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!r.ok || !(r.headers.get("Content-Type") || "").includes("html")) return null;
    const html = new TextDecoder().decode((await r.arrayBuffer()).slice(0, 1500000));
    const title = ((html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim().slice(0, 300);
    return { title, text: extractText(html) };
  } catch { return null; }
}
