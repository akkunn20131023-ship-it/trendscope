// 記事ごとの共有ページ（SNSで貼るとカード表示される・検索エンジンにも載る）
import { getItem, getSummary } from "../../lib/archive.js";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STAR = (n) => "★".repeat(n) + "☆".repeat(5 - n);

export async function onRequestGet({ params, request, env }) {
  const origin = new URL(request.url).origin;
  const item = await getItem(env, params.id);
  if (!item) {
    return new Response(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>記事が見つかりません — TrendScope</title><link rel="stylesheet" href="/style.css?v=3"></head><body><main class="wrap share"><h1>記事が見つかりません</h1><p>古くなって保管期間を過ぎた可能性があります。</p><p><a class="btn" href="/">TrendScope のトップへ</a></p></main></body></html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  const sum = await getSummary(env, item.id);
  const title = item.title_ja || item.title;
  const stars = Math.max(1, Math.min(5, item.bait?.stars || 1));
  const desc = sum?.lines?.length ? sum.lines.join(" ") : `${item.source}のニュース「${item.title}」。見出しの煽り度は${STAR(stars)}（TrendScope 自動判定）。`;
  const url = `${origin}/a/${item.id}`;
  const when = item.time ? new Date(item.time * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "";
  const ld = { "@context": "https://schema.org", "@type": "NewsArticle", headline: title.slice(0, 110), inLanguage: "ja", url, mainEntityOfPage: url, isBasedOn: item.url, ...(item.time ? { datePublished: new Date(item.time * 1000).toISOString() } : {}), publisher: { "@type": "Organization", name: "TrendScope" } };
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} — TrendScope</title>
<meta name="description" content="${esc(desc.slice(0, 160))}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="TrendScope">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc.slice(0, 200))}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${origin}/icon-512.png">
<meta name="twitter:card" content="summary"><meta name="theme-color" content="#0d1016">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/style.css?v=3">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head><body>
<header><div class="wrap hrow"><a class="logo" href="/">🌍 <span>TrendScope</span></a></div></header>
<main class="wrap share">
  <article class="card"><div class="cb">
    <div class="meta"><span class="src">${esc(item.source)}</span><span>${esc(when)}</span><span class="badge b${stars}">煽り ${STAR(stars)}</span></div>
    <h1 class="tja">${esc(title)}</h1>${item.title_ja && item.title_ja !== item.title ? `<p class="ten">${esc(item.title)}</p>` : ""}
    <section class="sum" id="sum" data-id="${esc(item.id)}">${sum ? `<h2>📝 3行要約</h2><ul>${sum.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${sum.why ? `<h2>💡 なぜ話題？</h2><p>${esc(sum.why.replace(/(^|\s)-\s+/g, "$1"))}</p>` : ""}<p class="mtag">${esc(sum.note)}</p>` : `<button class="btn" id="sumBtn">📝 AIで3行要約する</button>`}</section>
    <div class="acts"><a class="ib" href="${esc(item.url)}" target="_blank" rel="noopener nofollow">元記事を読む ↗</a><button class="ib" id="shareBtn" data-url="${esc(url)}" data-title="${esc(title)}">🔗 共有</button><a class="ib" href="/">ほかのニュースを見る</a></div>
  </div></article>
  <p class="mtag">見出しの日本語訳・要約・煽り度は機械による自動処理です。記事の内容・正確性は元記事でご確認ください。</p>
</main>
<div id="tsBox"></div><div class="toast" id="toast"></div>
<script src="/share.js?v=3"></script>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
