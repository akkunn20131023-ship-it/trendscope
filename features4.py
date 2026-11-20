# -*- coding: utf-8 -*-
"""
TrendScope 第4弾: 安定化（ログ・アップデート）と 公開版（Netlify）へのデータ送信
"""
import io
import json
import os
import re
import shutil
import threading
import time
import urllib.request
import zipfile
from collections import deque

import analyzer as az
import features as ft
import geo

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
H = ft.H

ft.DEFAULT_SETTINGS.update({
    "public_site_url": "", "public_upload_secret": "", "public_translate": True, "public_auto": False,
})

# ------------------------------------------------------------------ C. ログ（画面で見られるように最近の行を保持）
LOGS = deque(maxlen=400)


def capture_log(line):
    LOGS.append(line)


def logs():
    return {"lines": list(LOGS)}


# ------------------------------------------------------------------ C. zipからアップデート
KEEP = ("data/", ".venv/", "config.json", "__pycache__/")


def update_from_zip(raw):
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except Exception:
        return {"ok": False, "error": "zipファイルではありません"}
    names = z.namelist()
    srv = [n for n in names if n.endswith("server.py") and n.count("/") <= 1]
    if not srv:
        return {"ok": False, "error": "TrendScope の zip ではないようです（server.py が見つかりません）"}
    prefix = srv[0][: -len("server.py")]  # "TrendScope/" など
    backup = os.path.join(DATA, "backup_" + time.strftime("%Y%m%d_%H%M%S"))
    os.makedirs(backup, exist_ok=True)
    written = 0
    for n in names:
        if not n.startswith(prefix) or n.endswith("/"):
            continue
        rel = n[len(prefix):]
        if not rel or rel.startswith(KEEP) or ".." in rel or rel.startswith("/"):
            continue
        dst = os.path.join(BASE, *rel.split("/"))
        if os.path.exists(dst):
            os.makedirs(os.path.dirname(os.path.join(backup, rel)), exist_ok=True)
            shutil.copy2(dst, os.path.join(backup, rel))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with z.open(n) as src, open(dst, "wb") as out:
            out.write(src.read())
        written += 1
    return {"ok": True, "files": written, "backup": os.path.basename(backup)}


# ------------------------------------------------------------------ 公開版へ送るデータ（個人情報・本文は含めない）
def _item_public(it, translate):
    return {"id": it["id"], "title": it["title"], "title_ja": it.get("title_ja", "") if translate else "",
            "source": it.get("source", ""), "url": it.get("ext_url") or it.get("url", ""), "disc": it.get("url", ""),
            "cat": it.get("cat", ""), "time": it.get("time", 0), "geo": it.get("geo") or [],
            "bait": {k: (it.get("bait") or {}).get(k) for k in ("stars", "score", "label")}}


def build_public_payload(news, digest_fn, geo_fn, conflicts_fn, emotions_fn, extras):
    s = ft.settings()
    tr = bool(s.get("public_translate", True))
    items = [_item_public(i, tr) for i in news.get("items", [])]
    d = digest_fn()
    for c in (d.get("categories") or {}).values():
        c["items"] = [_item_public(i, tr) if "source" in i else i for i in c.get("items", [])]
        for i in c["items"]:
            i.pop("desc_ja", None)
    if not tr:
        d["top_countries"] = [{**c, "headline": ""} for c in d.get("top_countries", [])]
        d["conflicts_in_news"] = [{**c, "headline": ""} for c in d.get("conflicts_in_news", [])]
    g = geo_fn()
    for c in g.get("countries", []):
        c["items"] = [{"title_ja": i.get("title_ja", "") if tr else "", "title": i.get("title", ""), "url": i.get("ext_url") or i.get("url"),
                       "source": i.get("source"), "cat": i.get("cat"), "time": i.get("time")} for i in c["items"]]
    cf = conflicts_fn()
    for c in cf.get("conflicts", []):
        c["news"] = [{"title_ja": n.get("title_ja", "") if tr else "", "url": n.get("url"), "source": n.get("source")} for n in c.get("news", [])]
    em = emotions_fn()
    payload = {
        "meta": {"updated": news.get("updated"), "built": time.time(), "count": len(items), "translate": tr,
                 "sources": [{"name": x["name"], "ok": x["ok"], "count": x["count"]} for x in news.get("sources", [])]},
        "news": items, "digest": d, "geo": {"countries": g.get("countries", []), "flows": g.get("flows", []), "hqs": g.get("hqs", [])},
        "conflicts": cf, "emotions": {"total": em["total"], "countries": em["countries"], "items": em["items"], "colors": em["colors"]},
        "patterns": analyzer_patterns(),
    }
    for k, fn in extras.items():
        try:
            payload[k] = fn()
        except Exception as e:
            payload[k] = {"error": type(e).__name__}
    return payload


def analyzer_patterns():
    """公開版のブラウザ内「釣り判定」用に、判定ルールをJSONで渡す"""
    pats = [[p, w, c, r, "ja"] for p, w, c, r in az.JA_PATTERNS] + [[p, w, c, r, "en"] for p, w, c, r in az.EN_PATTERNS]
    return {"patterns": pats, "labels": az.STAR_LABEL, "caps_ok": sorted(az.CAPS_OK)}


_pub = {"last": 0, "last_result": None}


def publish(payload, url=None, secret=None):
    s = ft.settings()
    url = (url or s.get("public_site_url") or "").rstrip("/")
    secret = secret or s.get("public_upload_secret") or ""
    if not url.startswith("https://") or not secret:
        return {"ok": False, "error": "⚙設定で公開サイトのURL（https://〜）とアップロード用の合言葉を入れてください"}
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url + "/api/upload", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + secret,
                                          "User-Agent": "TrendScope-publisher/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.loads(r.read().decode("utf-8") or "{}")
        out = {"ok": True, "bytes": len(body), "at": time.time(), **res}
    except urllib.error.HTTPError as e:
        out = {"ok": False, "error": f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}"}
    except Exception as e:
        out = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    _pub["last"], _pub["last_result"] = time.time(), out
    H["log"]("公開版の更新", "成功" if out.get("ok") else "失敗", out.get("error", ""))
    return out


def publish_status():
    return {"last": _pub["last"], "result": _pub["last_result"]}


def publish_loop(build_fn):
    time.sleep(120)
    while True:
        try:
            if ft.settings().get("public_auto") and time.time() - _pub["last"] > 3600:
                publish(build_fn())
        except Exception as e:
            H["log"]("公開版の自動更新エラー", e)
        time.sleep(300)
