// Workers AI の文章生成。アカウントで使えるモデルを順に試し、使えたものを覚えておく。
const MODELS = [
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/meta/llama-3.1-8b-instruct-fast",
];
let good = null;
const denied = new Set();

export async function chat(ai, prompt, { max_tokens = 1024, temperature = 0.2 } = {}) {
  const order = good ? [good, ...MODELS.filter((m) => m !== good)] : MODELS;
  let last = null;
  for (const m of order) {
    if (denied.has(m)) continue;
    try {
      const r = await ai.run(m, { messages: [{ role: "user", content: prompt }], max_tokens, temperature });
      let t = r?.response ?? r?.choices?.[0]?.message?.content ?? "";
      if (typeof t !== "string") t = JSON.stringify(t);
      t = t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (!t) throw new Error("empty response");
      good = m;
      return { text: t, model: m };
    } catch (e) {
      last = e;
      const msg = String(e?.message || e);
      if (/5018|not allowed|5007|No such model|not found/i.test(msg)) denied.add(m); // このアカウントでは使えない
      else if (m === good) good = null;
    }
  }
  throw last || new Error("no model available");
}
