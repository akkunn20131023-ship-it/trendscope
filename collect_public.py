# -*- coding: utf-8 -*-
"""
GitHub Actions 用：ニュースを集めて公開版（Cloudflare Pages）へ送る
環境変数: PUBLIC_SITE_URL（https://〜.pages.dev） / UPLOAD_SECRET / PUBLIC_TRANSLATE（1=翻訳を公開, 0=原文のみ）
"""
import os
import sys
import time

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
import server  # noqa: E402  (起動処理は main() にあるので import だけでは起動しない)
import features as ft  # noqa: E402
import features4 as f4  # noqa: E402


def main():
    url = os.environ.get("PUBLIC_SITE_URL", "").strip()
    secret = os.environ.get("UPLOAD_SECRET", "").strip()
    if not url or not secret:
        print("PUBLIC_SITE_URL と UPLOAD_SECRET を GitHub の Secrets に設定してください")
        return 1
    ft.H.update(http_get=server.http_get, get_json=server.get_json, translate_many=server.translate_many,
                log=server.log, translate_one=server.translate_one, translate_to=server.translate_to)
    tr = os.environ.get("PUBLIC_TRANSLATE", "1") != "0"
    orig = ft.settings
    ft.settings = lambda: {**orig(), "public_translate": tr}
    t0 = time.time()
    server.refresh_news(force=True)
    server.flush_tr_cache()
    n = len(server._news.get("items", []))
    print(f"収集: {n}件 ({time.time() - t0:.0f}秒)")
    for s in server._news.get("sources", []):
        print(("  OK " if s["ok"] else "  NG ") + f"{s['name']}: {s['count']}件 {s.get('error') or ''}")
    if n == 0:
        print("ニュースが0件のため送信しません")
        return 1
    res = f4.publish(server.public_payload(), url=url, secret=secret)
    print("送信:", res)
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
