// 検索エンジン向け：トップページに最新の見出しを直接書き込んで返す
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function onRequestGet({ request, env, next }) {
  const res = await next();
  if (!(res.headers.get("Content-Type") || "").includes("text/html")) return res;
  let html = await res.text();
  try {
    const raw = env.TS ? await env.TS.get("latest", { cacheTtl: 300 }) : null;
    if (raw) {
      const d = JSON.parse(raw), items = (d.news || []).slice(0, 40);
      html = html.replace("<!--SSR-->", `<h2>最新の世界のニュース</h2><ul>${items.map((i) => `<li><a href="${esc(i.url)}" rel="nofollow noopener">${esc(i.title_ja || i.title)}</a> <small>${esc(i.source)}</small></li>`).join("")}</ul>`);
      const top = items.slice(0, 3).map((i) => i.title_ja || i.title).join(" / ");
      if (top) html = html.replace(/(<meta name="description" content=")[^"]*/, `$1世界の最新ニュースを日本語で：${esc(top).slice(0, 120)}`);
      html = html.replace("</head>", `<link rel="canonical" href="${new URL(request.url).origin}/"></head>`);
    }
  } catch {}
  const h = new Headers(res.headers); h.delete("Content-Length"); h.set("Cache-Control", "public, max-age=300");
  return new Response(html, { status: res.status, headers: h });
}
