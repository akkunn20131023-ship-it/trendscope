// 「今日の5本」と「今日の穴場」をJSONで（トップ画面のダイジェスト用）
import { json } from "../../lib/guard.js";
import { loadToday } from "../../lib/today.js";
export async function onRequestGet({ env }) {
  if (!env.TS) return json({ day: null });
  const { day } = await loadToday(env);
  return json({ day }, 200, { "Cache-Control": "public, max-age=300" });
}
