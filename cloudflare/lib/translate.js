// 見出しの日本語訳（Cloudflare Workers AI・無料枠内）。訳した結果は KV "trcache2" に保存して再利用する。
import { chat } from "./ai.js";
const MT = "@cf/meta/m2m100-1.2b";
const MAX_NEW = 90;      // 1回のアップロードで新しく訳す最大件数（残りは次回）
const BATCH = 15;
const CACHE_MAX = 3000;

const hasJa = s => /[぀-ヿ一-鿿]/.test(s || "");
const clean = s => { let t = String(s || "").replace(/^\s*\d+\s*[.)：:]\s*/, "").trim();
  if (/^「[^「」]*」$|^『[^『』]*』$|^"[^"]*"$/.test(t)) t = t.slice(1, -1).trim(); // 全体を囲む括弧だけ外す
  return t; };

async function llmBatch(ai, titles) {
  const prompt = "次の英語ニュース見出しを、自然で簡潔な日本語の見出しに翻訳してください。" +
    "誇張や補足は加えず、固有名詞は一般的なカタカナ表記にしてください。" +
    "番号付きで1行ずつ、訳文だけを出力してください。\n\n" +
    titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const r = await chat(ai, prompt, { max_tokens: 2048 });
  const out = {};
  r.text.split("\n").forEach(line => {
    const m = line.match(/^\s*(\d+)\s*[.)：:]\s*(.+)$/);
    if (m) { const k = +m[1] - 1; const v = clean(m[2]); if (titles[k] && hasJa(v) && v.length < 300) out[titles[k]] = v; }
  });
  return out;
}

async function mtOne(ai, t) {
  const r = await ai.run(MT, { text: t, source_lang: "english", target_lang: "japanese" });
  const v = clean(r?.translated_text);
  return hasJa(v) ? v : "";
}

// payload 内の {title, title_ja} を持つ全オブジェクトについて、訳が無いものを埋める
export async function translatePayload(env, payload) {
  if (!env.AI) return { enabled: false };
  const nodes = [];
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === "object") {
      if (typeof o.title === "string" && "title_ja" in o) nodes.push(o);
      Object.values(o).forEach(walk);
    }
  })(payload);
  let cache = {};
  try { cache = JSON.parse(await env.TS.get("trcache2") || "{}"); } catch {}
  const need = [...new Set(nodes.filter(n => !n.title_ja && n.title && !hasJa(n.title)).map(n => n.title))];
  const todo = need.filter(t => !cache[t]).slice(0, MAX_NEW);
  let made = 0;
  if (todo.length) {
    const batches = [];
    for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    const results = await Promise.all(batches.map(b => llmBatch(env.AI, b).catch(() => ({}))));
    results.forEach(r => Object.assign(cache, r));
    // 大きいモデルで訳せなかった分は翻訳専用モデルで（上限あり）
    const miss = todo.filter(t => !cache[t]).slice(0, 20);
    const mt = await Promise.all(miss.map(t => mtOne(env.AI, t).catch(() => "")));
    miss.forEach((t, i) => { if (mt[i]) cache[t] = mt[i]; });
    made = todo.filter(t => cache[t]).length;
  }
  let filled = 0;
  nodes.forEach(n => { if (!n.title_ja && cache[n.title]) { n.title_ja = cache[n.title]; filled++; } });
  if (made) {
    // 今回使った訳を優先して残し、古いものから捨てる
    const keep = {}; need.forEach(t => { if (cache[t]) keep[t] = cache[t]; });
    const rest = Object.entries(cache).filter(([k]) => !(k in keep));
    const merged = Object.fromEntries([...rest.slice(-Math.max(0, CACHE_MAX - Object.keys(keep).length)), ...Object.entries(keep)]);
    await env.TS.put("trcache2", JSON.stringify(merged));
  }
  return { enabled: true, new: made, filled, pending: need.filter(t => !cache[t]).length };
}
