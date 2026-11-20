// 共有ページ用：共有ボタンとAI要約
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2200); };
  async function shareIt(url, title) {
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(url); toast("リンクをコピーしました"); } catch { prompt("このリンクをコピーしてください", url); }
  }
  window.TSshare = shareIt;
  let ok = false;
  async function human() {
    if (ok) return true;
    let cfg = {}; try { cfg = await (await fetch("/api/config")).json(); } catch {}
    if (!cfg.turnstile_sitekey) return (ok = true);
    if (!window.turnstile) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const token = await new Promise((res) => { $("#tsBox").innerHTML = ""; window.turnstile.render("#tsBox", { sitekey: cfg.turnstile_sitekey, callback: res, "error-callback": () => res(null) }); });
    if (!token) return false;
    const r = await fetch("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    setTimeout(() => ($("#tsBox").innerHTML = ""), 1500);
    return (ok = r.ok);
  }
  async function summary(id) {
    if (!(await human())) throw new Error("ロボット確認に失敗しました");
    const r = await fetch("/api/summary?id=" + encodeURIComponent(id));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "要約できませんでした");
    return j;
  }
  window.TSsummary = summary;
  window.TSsumHTML = (j) => `<h2>📝 3行要約</h2><ul>${j.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${j.why ? `<h2>💡 なぜ話題？</h2><p>${esc(j.why.replace(/(^|\s)-\s+/g, "$1"))}</p>` : ""}<p class="mtag">${esc(j.note || "")}</p>`;
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-share-url]"); if (b) shareIt(b.dataset.shareUrl, b.dataset.shareTitle); });
  const sb = $("#shareBtn"); if (sb) sb.onclick = () => shareIt(sb.dataset.url, sb.dataset.title);
  const btn = $("#sumBtn"), box = $("#sum");
  if (btn && box) btn.onclick = async () => {
    btn.disabled = true; btn.textContent = "⏳ 要約しています…（10秒ほど）";
    try { box.innerHTML = window.TSsumHTML(await summary(box.dataset.id)); }
    catch (e) { btn.disabled = false; btn.textContent = "📝 AIで3行要約する"; toast(e.message); }
  };
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
