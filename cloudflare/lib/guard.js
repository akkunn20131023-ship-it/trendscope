// 共通：回数制限（ベストエフォート）・ロボット対策Cookie・JSON応答
const enc = new TextEncoder();
const hits = new Map(); // 同じサーバー内での回数カウント（Cloudflareの拠点ごと）

export function ip(request) {
  return request.headers.get("CF-Connecting-IP") || "0.0.0.0";
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

export function limited(request, key, max, windowSec) {
  const now = Date.now(), k = `${key}:${ip(request)}`;
  const e = hits.get(k);
  if (!e || now - e.t > windowSec * 1000) { hits.set(k, { t: now, n: 1 }); }
  else if (++e.n > max) return json({ error: "too many requests" }, 429, { "Retry-After": String(windowSec) });
  if (hits.size > 5000) hits.clear();
  return null;
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function sameText(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const cookieKey = (env) => env.COOKIE_SECRET || env.UPLOAD_SECRET || "dev-only";
export const turnstileOn = (env) => !!env.TURNSTILE_SECRET;

export async function signCookie(env, addr) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${exp}.${await hmac(cookieKey(env), `${exp}.${addr}`)}`;
}

export async function verifyCookie(request, env) {
  if (!turnstileOn(env)) return true;
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)ts_ok=([^;]+)/);
  if (!m) return false;
  const [exp, mac] = m[1].split(".");
  if (!exp || !mac || Number(exp) < Date.now() / 1000) return false;
  return sameText(mac, await hmac(cookieKey(env), `${exp}.${ip(request)}`));
}
