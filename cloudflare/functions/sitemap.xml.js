import { loadArchive } from "../lib/archive.js";
import { loadToday } from "../lib/today.js";
import { CATS } from "../lib/site.js";
export const onRequestGet = async ({ request, env }) => {
  const o = new URL(request.url).origin, d = new Date().toISOString().slice(0, 10);
  const a = env.TS ? Object.values(await loadArchive(env)).slice(0, 1000) : [];
  const { idx } = env.TS ? await loadToday(env) : { idx: [] };
  const urls = [`<url><loc>${o}/</loc><lastmod>${d}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${o}/today</loc><lastmod>${d}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`,
    ...Object.keys(CATS).map((k) => `<url><loc>${o}/c/${k}</loc><lastmod>${d}</lastmod><changefreq>hourly</changefreq><priority>0.8</priority></url>`),
    ...idx.map((x) => `<url><loc>${o}/today/${x}</loc><lastmod>${x}</lastmod><priority>0.6</priority></url>`),
    ...a.map((i) => `<url><loc>${o}/a/${i.id}</loc>${i.time ? `<lastmod>${new Date(i.time * 1000).toISOString().slice(0, 10)}</lastmod>` : ""}<priority>0.5</priority></url>`)];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
};
