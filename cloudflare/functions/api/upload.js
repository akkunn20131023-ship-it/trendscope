// TrendScope（PC または GitHub Actions）からニュースデータを受け取り KV に保存（合言葉が必要）
import { json, limited, sameText } from "../../lib/guard.js";
import { translatePayload } from "../../lib/translate.js";
import { updateArchive } from "../../lib/archive.js";

const ALLOW = ["meta", "news", "digest", "geo", "conflicts", "emotions", "patterns", "markets", "holidays", "launches", "wiki", "compare"];

export async function onRequestPost({ request, env }) {
  const lim = limited(request, "upload", 10, 60); if (lim) return lim;
  if (!env.TS) return json({ error: "KV（変数名 TS）が設定されていません" }, 500);
  if (!env.UPLOAD_SECRET || env.UPLOAD_SECRET.length < 16) return json({ error: "UPLOAD_SECRET が未設定（16文字以上）" }, 500);
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!sameText(auth, env.UPLOAD_SECRET)) return json({ error: "unauthorized" }, 401);
  const text = await request.text();
  if (text.length > 8 * 1024 * 1024) return json({ error: "too large" }, 413);
  let d; try { d = JSON.parse(text); } catch { return json({ error: "invalid json" }, 400); }
  if (!d || !Array.isArray(d.news) || !d.meta) return json({ error: "invalid payload" }, 400);
  const clean = Object.fromEntries(Object.entries(d).filter(([k]) => ALLOW.includes(k)));
  let tr = { enabled: false };
  try { tr = await translatePayload(env, clean); } catch (e) { tr = { enabled: !!env.AI, error: String(e).slice(0, 200) }; }
  clean.meta.ai_translate = tr.enabled;
  await env.TS.put("latest", JSON.stringify(clean));
  let archived = 0; try { archived = await updateArchive(env, clean.news); } catch {}
  return json({ stored: true, items: clean.news.length, at: Date.now(), translate: tr, archived });
}
