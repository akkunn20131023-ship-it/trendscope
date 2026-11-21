// サイト名・カテゴリ（検索エンジン向けの日本語表記をまとめて管理）
export const SITE = "TrendScope JP";
export const SITE_KANA = "トレンドスコープ";
export const ALT_NAMES = ["トレンドスコープ", "トレンドスコープJP", "TrendScope", "盛らない世界ニュース"];
export const CATS = {
  trivia: { ja: "世界の雑学・へぇ〜", desc: "世界の面白い雑学・科学の発見・驚きのニュースを日本語で" },
  tech: { ja: "テック・未来", desc: "海外のテクノロジー・AI・宇宙・未来のニュースを日本語で" },
  game: { ja: "ゲーム・エンタメ", desc: "海外のゲーム・映画・エンタメのニュースを日本語で" },
  bright: { ja: "明るいニュース", desc: "世界の心温まる・明るいニュースを日本語で" },
  world: { ja: "世界ニュース", desc: "世界の政治・経済・社会のニュースを日本語で" },
};
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const LOGO = `<a class="logo" href="/">🌍 <span>TrendScope</span><b class="jp">JP</b></a>`;
export const breadcrumbLD = (origin, list) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: list.map(([name, path], k) => ({ "@type": "ListItem", position: k + 1, name, item: origin + path })) });
export const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
