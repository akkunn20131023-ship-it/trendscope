import { json } from "../../lib/guard.js";
export const onRequestGet = ({ env }) => json({ turnstile_sitekey: env.TURNSTILE_SITEKEY || "" }, 200, { "Cache-Control": "public, max-age=300" });
