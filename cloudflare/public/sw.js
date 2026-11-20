// TrendScope のオフライン対応（前回のニュースを電波が弱くても表示できるように）
const V = "ts-v3";
const SHELL = ["/", "/style.css?v=3", "/app.js?v=3", "/favicon.svg", "/manifest.webmanifest", "/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const netFirst = async (req, key) => {
  const c = await caches.open(V);
  try { const r = await fetch(req); if (r.ok) c.put(key || req, r.clone()); return r; }
  catch { const hit = await c.match(key || req); if (hit) return hit; throw new Error("offline"); }
};
self.addEventListener("fetch", (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname === "/api/data") return e.respondWith(netFirst(req, "/api/data"));
  if (u.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    if (u.pathname === "/" || u.pathname === "/index.html") return e.respondWith(netFirst(req, "/"));
    return e.respondWith(fetch(req).catch(() => caches.match("/")));
  }
  if (SHELL.includes(u.pathname + u.search) || /\.(png|svg)$/.test(u.pathname)) {
    e.respondWith(caches.open(V).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
