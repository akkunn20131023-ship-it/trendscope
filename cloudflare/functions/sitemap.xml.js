export const onRequestGet = ({ request }) => {
  const o = new URL(request.url).origin, d = new Date().toISOString().slice(0, 10);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${o}/</loc><lastmod>${d}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url></urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
};
