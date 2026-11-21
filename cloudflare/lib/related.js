// 続報さがし：英語見出しの単語の重なりで、同じ話題の過去記事を見つける
const STOP = new Set(("the a an and or but of to in on at for with from by as is are was were be been being this that these those it its into over after before about than then they them their there here what when where which who whom whose why how will would could should can may might must have has had not no new news says said say report reports reported study studies scientists researchers research found finds find show shows shown first last year years day days week weeks time people man woman men women world just more most also like make makes made get gets got one two three four five six seven eight nine ten million billion first second could your you our out up down off all any some many much very via amid against during while under between what's it's here's don't doesn't can't won't i'm you're we're they're").split(" "));
export function tokens(title) {
  const out = new Map();
  const words = String(title || "").replace(/[’']s\b/g, "").split(/[^A-Za-z0-9\-]+/).filter(Boolean);
  words.forEach((w, k) => {
    const lw = w.toLowerCase().replace(/^-+|-+$/g, "");
    if (lw.length < 3 || STOP.has(lw) || /^\d+$/.test(lw)) return;
    const proper = k > 0 && /^[A-Z][a-z]|^[A-Z]{2,}/.test(w);
    out.set(lw, Math.max(out.get(lw) || 0, proper ? 2 : 1));
  });
  return out;
}

// archive: {id: item}。newIds の各記事に、同じ話題で古い記事を最大3件 prev として付ける
export function linkRelated(archive, newIds) {
  const items = Object.values(archive), tk = new Map(), index = new Map();
  for (const i of items) {
    const t = tokens(i.title); tk.set(i.id, t);
    for (const w of t.keys()) { if (!index.has(w)) index.set(w, []); index.get(w).push(i.id); }
  }
  for (const id of newIds) {
    const me = archive[id], mt = tk.get(id); if (!me || !mt || !me.time) continue;
    const score = new Map(), shared = new Map();
    for (const [w, wt] of mt) {
      const list = index.get(w); if (!list || list.length > 60) continue; // ありふれた単語は無視
      for (const oid of list) {
        if (oid === id) continue;
        const o = archive[oid]; if (!o.time || o.time > me.time - 3600 || o.time < me.time - 14 * 86400) continue;
        score.set(oid, (score.get(oid) || 0) + Math.min(wt, tk.get(oid).get(w)));
        shared.set(oid, (shared.get(oid) || 0) + 1);
      }
    }
    const prev = [...score.entries()].filter(([oid, s]) => shared.get(oid) >= 3 || (shared.get(oid) >= 2 && s >= 4)).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([oid]) => oid);
    if (prev.length) me.prev = prev; else delete me.prev;
  }
}
