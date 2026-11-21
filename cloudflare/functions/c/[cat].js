// カテゴリ別の一覧ページ（日本語の検索キーワードで見つけてもらうための入口）
import { loadArchive } from "../../lib/archive.js";
import { SITE, SITE_KANA, CATS, esc, LOGO, breadcrumbLD, ld } from "../../lib/site.js";

export async function onRequestGet({ params, request, env }) {
  const origin = new URL(request.url).origin, key = params.cat, cat = CATS[key];
  if (!cat) return new Response("not found", { status: 404 });
  const arch = env.TS ? await loadArchive(env) : {};
  const items = Object.values(arch).filter((i) => i.cat === key).sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 80);
  const url = `${origin}/c/${key}`;
  const title = `${cat.ja}の海外ニュース一覧（日本語訳）｜${SITE}`;
  const desc = `${cat.desc}。${items.slice(0, 3).map((i) => i.title_ja || i.title).join(" / ")}`.slice(0, 160);
  const other = Object.entries(CATS).filter(([k]) => k !== key);
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${SITE}"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${origin}/icon-512.png">
<meta name="twitter:card" content="summary"><meta name="theme-color" content="#0d1016">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/style.css?v=8">
${ld(breadcrumbLD(origin, [[SITE, "/"], [cat.ja, `/c/${key}`]]))}
${ld({ "@context": "https://schema.org", "@type": "CollectionPage", name: title, inLanguage: "ja", url, isPartOf: { "@type": "WebSite", name: SITE, url: origin + "/" } })}
</head><body>
<header><div class="wrap hrow">${LOGO}</div></header>
<main class="wrap share">
  <nav class="crumb"><a href="/">${SITE}</a> › ${esc(cat.ja)}</nav>
  <h1 class="t5h">${esc(cat.ja)}の海外ニュース</h1>
  <p class="mtag">${esc(cat.desc)}。見出しは日本語に訳し、煽り・釣り度を自動で判定しています（${SITE_KANA}）。</p>
  <ul class="clist">${items.map((i) => `<li><a href="/a/${esc(i.id)}">${esc(i.title_ja || i.title)}</a><span class="mtag">${esc(i.source)}${i.time ? "・" + new Date(i.time * 1000).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : ""}</span></li>`).join("") || "<li>まだ記事がありません</li>"}</ul>
  <h2 class="t5p">ほかのジャンル</h2><p class="t5past">${other.map(([k, c]) => `<a href="/c/${k}">${esc(c.ja)}</a>`).join("")}<a href="/today">☀ 今日の5本</a></p>
</main>
<div id="tsBox"></div><div class="toast" id="toast"></div><script src="/share.js?v=8"></script>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=600" } });
}
