// 検索エンジン向け：トップページに最新の見出し（サイト内の記事ページへのリンク）を直接書き込んで返す
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function onRequestGet({ request, env, next }) {
  const res = await next();
  if (!(res.headers.get("Content-Type") || "").includes("text/html")) return res;
  let html = await res.text();
  const origin = new URL(request.url).origin;
  try {
    // Google Search Console の所有権確認（Cloudflare の環境変数 GOOGLE_SITE_VERIFICATION に content の値を入れる）
    const gsv = String(env.GOOGLE_SITE_VERIFICATION || "").replace(/.*content=["']?([^"'\s>]+).*/, "$1").trim();
    if (/^[A-Za-z0-9_\-]{10,100}$/.test(gsv)) html = html.replace("</head>", `<meta name="google-site-verification" content="${gsv}"></head>`);
    const raw = env.TS ? await env.TS.get("latest", { cacheTtl: 300 }) : null;
    if (raw) {
      const d = JSON.parse(raw), items = (d.news || []).slice(0, 50);
      const link = (i) => `/a/${encodeURIComponent(i.id)}`;
      html = html.replace("<!--SSR-->", `<h2>最新の海外ニュース（日本語訳）</h2><p><a href="/today">☀ 今日の5本（3行要約）</a></p><ul>${items.map((i) => `<li><a href="${link(i)}">${esc(i.title_ja || i.title)}</a> <small>${esc(i.source)}</small></li>`).join("")}</ul>`);
      const top = items.slice(0, 3).map((i) => i.title_ja || i.title).join(" / ");
      if (top) html = html.replace(/(<meta name="description" content=")[^"]*/, `$1海外の面白ニュースを日本語でまとめ読み。見出しの釣り度もAIなしで冷静に判定。いまの話題：${esc(top).slice(0, 90)}`);
      const ld = { "@context": "https://schema.org", "@type": "ItemList", name: "最新の海外ニュース", itemListElement: items.slice(0, 20).map((i, n) => ({ "@type": "ListItem", position: n + 1, url: origin + link(i), name: (i.title_ja || i.title).slice(0, 110) })) };
      html = html.replace("</head>", `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script></head>`);
    }
    html = html.replace("</head>", `<link rel="canonical" href="${origin}/"></head>`);
  } catch {}
  const h = new Headers(res.headers); h.delete("Content-Length"); h.set("Cache-Control", "public, max-age=300");
  return new Response(html, { status: res.status, headers: h });
}
