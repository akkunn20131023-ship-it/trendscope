// 「今日の5本」ページのHTML
import { loadToday, validDate, jstDate } from "./today.js";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STAR = (n) => "★".repeat(n) + "☆".repeat(5 - n);
const WD = "日月火水木金土";
const jpDate = (d) => { const [y, m, dd] = d.split("-").map(Number); return `${m}月${dd}日（${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}）`; };

export async function todayPage(request, env, date) {
  const origin = new URL(request.url).origin;
  if (date && !validDate(date)) date = null;
  const { idx, day } = env.TS ? await loadToday(env, date) : { idx: [], day: null };
  const isToday = day && day.date === jstDate();
  const heading = day ? `☀ ${isToday ? "今日" : jpDate(day.date)}の5本` : "☀ 今日の5本";
  const url = day ? (date ? `${origin}/today/${day.date}` : `${origin}/today`) : `${origin}/today`;
  const desc = day ? `${jpDate(day.date)}の世界の注目ニュース5本を3行要約で。` + day.items.map((i) => i.title_ja || i.title).join(" / ").slice(0, 120) : "世界の注目ニュース5本を、毎朝3行要約でお届けします。";
  const body = day ? day.items.map((i, n) => {
    const s = Math.max(1, Math.min(5, i.bait?.stars || 1)), t = i.title_ja || i.title;
    return `<article class="card t5"><div class="cb">
      <div class="meta"><span class="t5n">${n + 1}</span><span class="src">${esc(i.source)}</span><span class="badge b${s}">釣り ${STAR(s)}</span></div>
      <h2 class="tja"><a href="/a/${esc(i.id)}">${esc(t)}</a></h2>${i.title_ja && i.title_ja !== i.title ? `<p class="ten">${esc(i.title)}</p>` : ""}
      <ul class="t5l">${i.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      ${i.why ? `<details><summary>💡 なぜ話題？</summary><p>${esc(i.why)}</p></details>` : ""}
      <div class="acts"><a class="ib" href="${esc(i.url)}" target="_blank" rel="noopener nofollow">元記事 ↗</a><button class="ib" data-share-url="${origin}/a/${esc(i.id)}" data-share-title="${esc(t)}">🔗 共有</button></div>
    </div></article>`;
  }).join("") : `<div class="card"><div class="cb"><p>今日の5本は、毎朝6時ごろに用意されます。もう少しお待ちください。</p><p><a class="btn" href="/">最新ニュースを見る</a></p></div></div>`;
  const past = idx.filter((d) => !day || d !== day.date).slice(0, 14);
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(heading)}${day ? ` ${esc(jpDate(day.date))}` : ""} — TrendScope</title>
<meta name="description" content="${esc(desc.slice(0, 160))}"><link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="TrendScope">
<meta property="og:title" content="${esc(heading)}${day ? ` ${esc(jpDate(day.date))}` : ""}｜盛らない世界ニュース"><meta property="og:description" content="${esc(desc.slice(0, 200))}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${origin}/icon-512.png">
<meta name="twitter:card" content="summary"><meta name="theme-color" content="#0d1016">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/style.css?v=4">
</head><body>
<header><div class="wrap hrow"><a class="logo" href="/">🌍 <span>TrendScope</span></a></div></header>
<main class="wrap share">
  <h1 class="t5h">${esc(heading)}</h1>
  <p class="mtag">${day ? `${esc(jpDate(day.date))}・朝1分で世界のいまをチェック。` : ""}要約はAIによる自動処理です。正確な内容は元記事でご確認ください。</p>
  ${body}
  <div class="acts" style="margin:14px 0"><a class="btn" href="/">ほかのニュースも見る</a>${day ? `<button class="ib" data-share-url="${esc(url)}" data-share-title="${esc(heading)}">🔗 このページを共有</button>` : ""}</div>
  ${past.length ? `<h2 class="t5p">📚 過去の5本</h2><p class="t5past">${past.map((d) => `<a href="/today/${d}">${esc(jpDate(d))}</a>`).join("")}</p>` : ""}
</main>
<div id="tsBox"></div><div class="toast" id="toast"></div>
<script src="/share.js?v=4"></script>
</body></html>`;
  return new Response(html, { status: day || !date ? 200 : 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
