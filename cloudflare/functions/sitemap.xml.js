import { loadArchive } from "../lib/archive.js";
export const onRequestGet = async ({ request, env }) => {
  const o = new URL(request.url).origin, d = new Date().toISOString().slice(0, 10);
  const a = env.TS ? Object.values(await loadArchive(env)).slice(0, 1000) : [];
  const urls = [`<url><loc>${o}/</loc><lastmod>${d}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
    ...a.map((i) => `<url><loc>${o}/a/${i.id}</loc>${i.time ? `<lastmod>${new Date(i.time * 1000).toISOString().slice(0, 10)}</lastmod>` : ""}<priority>0.5</priority></url>`)];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
};
