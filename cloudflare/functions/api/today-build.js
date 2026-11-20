// 管理用：「今日の5本」をすぐ作り直す（合言葉が必要）
import { json, sameText } from "../../lib/guard.js";
import { maybeBuildToday } from "../../lib/today.js";
export async function onRequestPost({ request, env }) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.UPLOAD_SECRET || !sameText(auth, env.UPLOAD_SECRET)) return json({ error: "unauthorized" }, 401);
  let d = {}; try { d = JSON.parse((await env.TS.get("latest")) || "{}"); } catch {}
  return json(await maybeBuildToday(env, d.news || [], true));
}
