// Turnstile（ロボット対策）を検証して、1時間有効の署名つきCookieを発行
import { ip, json, limited, signCookie, turnstileOn } from "../../lib/guard.js";

export async function onRequestPost({ request, env }) {
  const lim = limited(request, "verify", 10, 60); if (lim) return lim;
  if (!turnstileOn(env)) return json({ ok: true, skipped: true });
  let token = ""; try { token = (await request.json()).token || ""; } catch {}
  if (!token || token.length > 4096) return json({ ok: false }, 400);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip(request) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.success) return json({ ok: false }, 403);
  return json({ ok: true }, 200, { "Set-Cookie": `ts_ok=${await signCookie(env, ip(request))}; Path=/api; Max-Age=3600; HttpOnly; Secure; SameSite=Strict` });
}
