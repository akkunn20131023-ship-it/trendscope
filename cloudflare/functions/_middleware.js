// プレビュー用URL（xxxx.trendscope-e44.pages.dev）は検索結果に出さない＝本番URLだけを載せる
export async function onRequest({ request, next }) {
  const res = await next();
  const host = new URL(request.url).hostname;
  if (host.endsWith(".pages.dev") && host.split(".").length > 3) {
    const r = new Response(res.body, res);
    r.headers.set("X-Robots-Tag", "noindex");
    return r;
  }
  return res;
}
