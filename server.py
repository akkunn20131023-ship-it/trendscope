# -*- coding: utf-8 -*-
"""
TrendScope - 世界の面白ニュース収集 ＆ 釣りタイトル冷静判定ツール
Python標準ライブラリのみで動作（pip install 不要・APIキー不要・完全無料）
起動: python server.py  →  http://localhost:8000
"""
import gzip
import hashlib
import html
import json
import os
import re
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import analyzer as az
import geo
import worldlive as wl
import features as ft
import features2 as f2
import features3 as f3
import features4 as f4
import subprocess

if sys.stdout is None or sys.stderr is None:  # pythonw（ウィンドウなし起動）ではログをファイルへ
    os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"), exist_ok=True)
    _lf = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "server.log"), "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = _lf
try:  # Windowsのコンソールで日本語が化けないように
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
STATIC = os.path.join(BASE, "static")
os.makedirs(DATA, exist_ok=True)
NEWS_CACHE_FILE = os.path.join(DATA, "news_cache.json")
TR_CACHE_FILE = os.path.join(DATA, "translations.json")
FAV_FILE = os.path.join(DATA, "favorites.json")

CACHE_TTL = 12 * 60  # 12分
PORT = int(os.environ.get("PORT", "8000"))
UA_BROWSER = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
UA_BOT = "windows:trendscope.local:v1.0 (personal news reader)"


def code_version():
    """ソースの更新日時から版を作る（古いサーバーが残っていたら自動で入れ替えるため）"""
    h = hashlib.md5()
    for root in (BASE, STATIC):
        for fn in sorted(os.listdir(root)):
            if fn.endswith(".py"):
                h.update(f"{fn}:{int(os.path.getmtime(os.path.join(root, fn)))}".encode())
    return h.hexdigest()[:10]


def log(*a):
    line = time.strftime("[%H:%M:%S] ") + " ".join(str(x) for x in a)
    print(line, flush=True)
    try:
        f4.capture_log(line)
    except Exception:
        pass


# ------------------------------------------------------------------ HTTP取得
def http_get(url, timeout=12, ua=UA_BROWSER, accept="*/*", max_bytes=2_000_000, data=None, headers=None):
    host = urllib.parse.urlparse(url).netloc
    if host.endswith(("wikipedia.org", "wikimedia.org", "wikidata.org")):  # Wikimediaは説明的なUAが必須
        ua = "TrendScope/1.0 (personal news reader; local app) Python-urllib"
    h = {"User-Agent": ua, "Accept": accept, "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
         "Accept-Encoding": "gzip"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h, data=data)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read(max_bytes)
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw, r.headers.get_content_charset(), r.geturl()


def get_json(url, **kw):
    raw, cs, _ = http_get(url, accept="application/json", **kw)
    return json.loads(raw.decode(cs or "utf-8", "replace"))


def strip_html(s):
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s or "", flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path)


# ------------------------------------------------------------------ 翻訳（無料・キー不要）
_tr_cache = load_json(TR_CACHE_FILE, {})
_tr_lock = threading.Lock()
_tr_dirty = [False]


def _google_translate(text, tl="ja"):
    url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={tl}&dt=t"
    body = urllib.parse.urlencode({"q": text}).encode()
    raw, _, _ = http_get(url, data=body, timeout=15,
                         headers={"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
    j = json.loads(raw.decode("utf-8"))
    return "".join(seg[0] for seg in j[0] if seg and seg[0])


def _mymemory_translate(text):
    url = "https://api.mymemory.translated.net/get?" + urllib.parse.urlencode(
        {"q": text[:480], "langpair": "en|ja"})
    j = get_json(url, timeout=15)
    return j["responseData"]["translatedText"]


def translate_to(text, tl="en"):
    try:
        return _google_translate(text, tl) or text
    except Exception:
        return text


def translate_one(text):
    text = (text or "").strip()
    if not text:
        return ""
    if az._is_ja(text) and len(re.findall(r"[A-Za-z]", text)) < len(text) * 0.3:
        return text
    with _tr_lock:
        if text in _tr_cache:
            return _tr_cache[text]
    out = None
    for fn in (_google_translate, _mymemory_translate):
        try:
            out = fn(text)
            if out:
                break
        except Exception as e:
            log("翻訳失敗", fn.__name__, type(e).__name__)
    if out:
        with _tr_lock:
            _tr_cache[text] = out
            _tr_dirty[0] = True
    return out or text


def translate_many(texts):
    """まとめて翻訳（改行区切りで束ねて呼び出し回数を削減）"""
    todo = []
    with _tr_lock:
        for t in dict.fromkeys(x.strip() for x in texts if x and x.strip()):
            if t not in _tr_cache and not az._is_ja(t):
                todo.append(t)
    chunks, cur, size = [], [], 0
    for t in todo:
        t1 = t.replace("\n", " ")
        if size + len(t1) > 1800 and cur:
            chunks.append(cur); cur, size = [], 0
        cur.append(t); size += len(t1) + 1
    if cur:
        chunks.append(cur)

    def run(chunk):
        joined = "\n".join(c.replace("\n", " ") for c in chunk)
        try:
            res = _google_translate(joined).split("\n")
            if len(res) == len(chunk):
                with _tr_lock:
                    for src, dst in zip(chunk, res):
                        if dst.strip():
                            _tr_cache[src] = dst.strip()
                    _tr_dirty[0] = True
                return
        except Exception as e:
            log("一括翻訳失敗 → 個別翻訳に切替", type(e).__name__)
        for c in chunk:
            translate_one(c)

    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(run, chunks))
    flush_tr_cache()
    with _tr_lock:
        return {t: _tr_cache.get(t.strip(), t) for t in texts if t}


def flush_tr_cache():
    with _tr_lock:
        if not _tr_dirty[0]:
            return
        if len(_tr_cache) > 8000:  # 肥大化防止
            for k in list(_tr_cache)[:2000]:
                _tr_cache.pop(k, None)
        data = dict(_tr_cache)
        _tr_dirty[0] = False
    save_json(TR_CACHE_FILE, data)


# ------------------------------------------------------------------ ニュースソース
REDDIT_SUBS = [
    ("todayilearned", "trivia", "r/todayilearned"),
    ("interestingasfuck", "trivia", "r/interestingasfuck"),
    ("UpliftingNews", "bright", "r/UpliftingNews"),
    ("technology", "tech", "r/technology"),
    ("gaming", "game", "r/gaming"),
]
RSS_FEEDS = [
    ("https://www.sciencedaily.com/rss/top/science.xml", "trivia", "ScienceDaily"),
    ("https://www.sciencedaily.com/rss/strange_offbeat.xml", "trivia", "ScienceDaily 奇妙な科学"),
    ("https://feeds.bbci.co.uk/news/world/rss.xml", "world", "BBC World"),
    ("https://feeds.bbci.co.uk/news/technology/rss.xml", "tech", "BBC Tech"),
    ("https://www.goodnewsnetwork.org/feed/", "bright", "Good News Network"),
]


def _reddit_items(j, cat, label, limit):
    items = []
    for ch in j["data"]["children"]:
        d = ch["data"]
        if d.get("stickied") or d.get("over_18"):
            continue
        thumb = ""
        try:
            res = d["preview"]["images"][0]["resolutions"]
            thumb = res[min(2, len(res) - 1)]["url"]
        except Exception:
            t = d.get("thumbnail") or ""
            thumb = t if t.startswith("http") else ""
        link = d.get("url_overridden_by_dest") or ""
        items.append({
            "id": "rd_" + d["id"], "title": d["title"], "desc": (d.get("selftext") or "")[:400],
            "url": "https://www.reddit.com" + d["permalink"],
            "ext_url": link if link and "reddit.com" not in link and "redd.it" not in link else "",
            "score": d.get("score", 0), "comments": d.get("num_comments", 0),
            "time": d.get("created_utc", 0), "thumb": thumb, "cat": cat, "source": label,
        })
        if len(items) >= limit:
            break
    return items


def fetch_reddit(sub, cat, label, limit=15):
    """JSON(www) → JSON(old) → RSS の順に試す。429が出たら少し待って次へ"""
    attempts = [
        ("json", f"https://www.reddit.com/r/{sub}/hot.json?limit={limit + 5}&raw_json=1", UA_BOT),
        ("json", f"https://old.reddit.com/r/{sub}/hot.json?limit={limit + 5}&raw_json=1", UA_BROWSER),
        ("rss", f"https://www.reddit.com/r/{sub}/.rss", UA_BROWSER),
        ("rss", f"https://old.reddit.com/r/{sub}/.rss", UA_BOT),
    ]
    last = None
    for kind, url, ua in attempts:
        try:
            if kind == "json":
                items = _reddit_items(get_json(url, ua=ua), cat, label, limit)
            else:
                items = parse_feed(url, cat, label, ua=ua, limit=limit)
            if items:
                return items
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429:
                time.sleep(2.5)
        except Exception as e:
            last = e
        time.sleep(0.8)
    raise RuntimeError(f"Reddit取得失敗: {type(last).__name__} {getattr(last, 'code', '')}".strip())


def fetch_all_reddit():
    """Redditは同時アクセスに厳しいので1つずつ間隔を空けて取得"""
    out = []
    for i, (sub, cat, label) in enumerate(REDDIT_SUBS):
        if i:
            time.sleep(1.5)
        t0 = time.time()
        try:
            items = fetch_reddit(sub, cat, label)
            out.append((label, items, None, time.time() - t0))
        except Exception as e:
            out.append((label, [], str(e)[:120], time.time() - t0))
    return out


def fetch_hn(limit=20):
    ids = get_json("https://hacker-news.firebaseio.com/v0/topstories.json")[:limit]

    def one(i):
        try:
            return get_json(f"https://hacker-news.firebaseio.com/v0/item/{i}.json", timeout=8)
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=10) as ex:
        res = list(ex.map(one, ids))
    out = []
    for d in res:
        if not d or not d.get("title"):
            continue
        out.append({
            "id": f"hn_{d['id']}", "title": d["title"], "desc": strip_html(d.get("text", ""))[:400],
            "url": f"https://news.ycombinator.com/item?id={d['id']}", "ext_url": d.get("url", ""),
            "score": d.get("score", 0), "comments": d.get("descendants", 0),
            "time": d.get("time", 0), "thumb": "", "cat": "tech", "source": "Hacker News",
        })
    return out


def _ts(s):
    if not s:
        return 0
    from email.utils import parsedate_to_datetime
    from datetime import datetime
    try:
        return parsedate_to_datetime(s).timestamp()
    except Exception:
        pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0


def parse_feed(url, cat, label, ua=UA_BROWSER, limit=15):
    raw, _, _ = http_get(url, ua=ua, accept="application/rss+xml, application/atom+xml, application/xml, text/xml")
    root = ET.fromstring(raw)
    out = []
    ns = {"a": "http://www.w3.org/2005/Atom", "media": "http://search.yahoo.com/mrss/"}
    entries = root.findall(".//item") or root.findall(".//a:entry", ns)
    for e in entries[:limit]:
        def t(tag):
            el = e.find(tag) if not tag.startswith("a:") else e.find(tag, ns)
            return (el.text or "") if el is not None and el.text else ""
        title = strip_html(t("title") or t("a:title"))
        link = t("link")
        if not link:
            le = e.find("a:link", ns)
            link = le.get("href") if le is not None else ""
        desc = strip_html(t("description") or t("a:summary") or t("a:content"))
        if "reddit.com" in url:
            desc = re.sub(r"submitted by .*$", "", desc).strip()
        thumb = ""
        for mt in ("media:thumbnail", "media:content"):
            m = e.find(mt, ns)
            if m is not None and m.get("url"):
                thumb = m.get("url"); break
        if not thumb:
            enc = e.find("enclosure")
            if enc is not None and (enc.get("type") or "").startswith("image"):
                thumb = enc.get("url", "")
        if not title:
            continue
        out.append({
            "id": "rss_" + hashlib.md5((link or title).encode("utf-8")).hexdigest()[:12], "title": title, "desc": desc[:400],
            "url": link, "ext_url": "", "score": 0, "comments": 0,
            "time": _ts(t("pubDate") or t("a:updated") or t("a:published")),
            "thumb": thumb, "cat": cat, "source": label,
        })
    return out


# ------------------------------------------------------------------ 収集＆キャッシュ
_news = load_json(NEWS_CACHE_FILE, {"items": [], "sources": [], "updated": 0})
for _it in _news.get("items", []):
    _it["geo"] = geo.locate(_it.get("title", "") + " " + _it.get("desc", "")[:300], _it.get("title_ja", ""))  # 辞書の改善を反映
_news_lock = threading.Lock()
_refreshing = threading.Event()


def collect_all():
    jobs = [("hn", fetch_hn, "Hacker News")]
    jobs += [(f"rss:{l}", (lambda u=u, c=c, l=l: parse_feed(u, c, l)), l) for u, c, l in RSS_FEEDS]
    results, status = [], []
    prev = {}
    for it in _news.get("items", []):
        prev.setdefault(it["source"], []).append(it)

    def run(job):
        key, fn, label = job
        t0 = time.time()
        try:
            return [(label, fn(), None, time.time() - t0)]
        except Exception as e:
            return [(label, [], f"{type(e).__name__}: {str(e)[:120]}", time.time() - t0)]

    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(fetch_all_reddit)] + [ex.submit(run, j) for j in jobs]
        rows = [r for f in futs for r in f.result()]
    for label, items, err, dt in rows:
        reused = False
        if not items and prev.get(label):  # 失敗したソースは前回の結果を使い回す
            items, reused = prev[label], True
        status.append({"name": label, "ok": err is None and bool(items), "count": len(items),
                       "error": err, "sec": round(dt, 1), "reused": reused})
        log(f"{'OK ' if not err else 'NG '} {label}: {len(items)}件 {'(前回分を表示) ' if reused else ''}{err or ''}")
        results.append(items)

    # ソースごとに交互に並べて偏りを防ぐ
    merged, seen = [], set()
    i = 0
    while any(i < len(r) for r in results):
        for r in results:
            if i < len(r) and r[i]["id"] not in seen:
                seen.add(r[i]["id"]); merged.append(r[i])
        i += 1

    # 翻訳
    texts = [it["title"] for it in merged] + [it["desc"][:300] for it in merged if it["desc"]]
    t0 = time.time()
    tr = translate_many(texts)
    log(f"翻訳完了 {len(texts)}件 {time.time() - t0:.1f}秒")
    for it in merged:
        it["title_ja"] = tr.get(it["title"], it["title"])
        it["desc_ja"] = tr.get(it["desc"][:300], "") if it["desc"] else ""
        res = az.score_text(it["title"])
        it["bait"] = {"score": res["score"], "stars": res["stars"], "label": az.STAR_LABEL[res["stars"]],
                      "reasons": res["reasons"][:3]}
        it["translated"] = it["title_ja"] != it["title"]
        it["geo"] = geo.locate(it["title"] + " " + it["desc"][:300], it["title_ja"])
    return {"items": merged, "sources": status, "updated": time.time()}


def refresh_news(force=False):
    with _news_lock:
        fresh = time.time() - _news.get("updated", 0) < CACHE_TTL and _news.get("items")
        if fresh and not force:
            return _news
        data = collect_all()
        if data["items"]:
            _news.clear(); _news.update(data)
            save_json(NEWS_CACHE_FILE, _news)
            try:
                f3.archive_add(data["items"])
            except Exception as e:
                log("保存庫への追加エラー", e)
            try:
                ft.check_news_alerts(data["items"])
            except Exception as e:
                log("アラート判定エラー", e)
        else:
            _news["sources"] = data["sources"]
        return _news


def background_loop():
    n = 0
    while True:
        try:
            refresh_news()
        except Exception:
            traceback.print_exc()
        if n % 5 == 0:  # 5分ごとに地震アラート判定
            try:
                ft.check_quake_alerts(quakes_payload()["quakes"])
            except Exception as e:
                log("地震アラート判定エラー", type(e).__name__)
        n += 1
        time.sleep(60)


# ------------------------------------------------------------------ URL解析
class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta, self.title, self.paras = {}, "", []
        self._in_title = self._in_p = False
        self._skip = 0
        self._buf = []
        self.h1 = ""
        self._in_h1 = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style", "noscript", "nav", "footer", "header", "aside", "form"):
            self._skip += 1
        elif tag == "meta":
            k = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
            if k and a.get("content"):
                self.meta.setdefault(k, a["content"])
        elif tag == "title":
            self._in_title = True
        elif tag == "h1":
            self._in_h1 = True
        elif tag == "p" and not self._skip:
            self._in_p, self._buf = True, []

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "nav", "footer", "header", "aside", "form"):
            self._skip = max(0, self._skip - 1)
        elif tag == "title":
            self._in_title = False
        elif tag == "h1":
            self._in_h1 = False
        elif tag == "p" and self._in_p:
            self._in_p = False
            txt = re.sub(r"\s+", " ", "".join(self._buf)).strip()
            if len(txt) >= 40:
                self.paras.append(txt)

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._in_h1 and not self.h1.strip():
            self.h1 += data
        if self._in_p and not self._skip:
            self._buf.append(data)


def decode_html(raw, cs):
    if not cs:
        m = re.search(rb'<meta[^>]+charset=["\']?([\w\-]+)', raw[:4000], re.I)
        cs = m.group(1).decode() if m else "utf-8"
    for enc in (cs, "utf-8", "cp932", "euc-jp"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return raw.decode("utf-8", "replace")


def fetch_page_info(url):
    host = urllib.parse.urlparse(url).netloc.lower()
    info = {"url": url, "title": "", "description": "", "body": "", "site": host, "kind": "web"}

    if "youtube.com" in host or "youtu.be" in host:
        info["kind"] = "youtube"
        try:
            o = get_json("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(url, safe=""))
            info["title"], info["site"] = o.get("title", ""), "YouTube / " + o.get("author_name", "")
        except Exception as e:
            log("YouTube oEmbed失敗", e)
    if host.endswith(("twitter.com", "x.com")):
        info["kind"] = "x"
        try:
            o = get_json("https://publish.twitter.com/oembed?omit_script=1&url=" +
                         urllib.parse.quote(url.replace("x.com", "twitter.com"), safe=""))
            txt = strip_html(re.sub(r"&mdash;.*$", "", o.get("html", ""), flags=re.S))
            info.update(title=txt[:200], body=txt, site="X / " + o.get("author_name", ""))
            return info
        except Exception as e:
            log("X oEmbed失敗", e)

    raw, cs, final = http_get(url, accept="text/html,application/xhtml+xml", max_bytes=1_500_000)
    page = decode_html(raw, cs)
    p = PageParser()
    try:
        p.feed(page)
    except Exception:
        pass
    m = p.meta
    info["title"] = info["title"] or html.unescape(m.get("og:title") or m.get("twitter:title") or p.title or p.h1).strip()
    info["description"] = html.unescape(m.get("og:description") or m.get("description") or m.get("twitter:description") or "").strip()
    if info["kind"] == "youtube":
        dm = re.search(r'"shortDescription":"(.*?)(?<!\\)"', page)
        if dm:
            try:
                info["description"] = json.loads('"' + dm.group(1) + '"')[:1500]
            except Exception:
                pass
    info["site"] = info["site"] if info["kind"] != "web" else (m.get("og:site_name") or host)
    body = " ".join(p.paras[:8])
    if info["kind"] == "youtube":
        body = info["description"]
    info["body"] = (body if len(body) > len(info["description"]) else
                    (info["description"] + " " + body)).strip()[:3000]
    info["url"] = final
    return info


def analyze(inp):
    inp = (inp or "").strip()
    if not inp:
        return {"error": "テキストかURLを入力してください"}
    url_m = re.match(r"^(https?://\S+)$", inp) or (re.match(r"^((?:www\.)?[\w\-]+\.[a-z]{2,}/\S*)$", inp, re.I))
    page = None
    if url_m:
        url = url_m.group(1)
        if not url.startswith("http"):
            url = "https://" + url
        try:
            page = fetch_page_info(url)
        except urllib.error.HTTPError as e:
            return {"error": f"ページを取得できませんでした（HTTP {e.code}）。見出しを直接貼り付けて判定してください。"}
        except Exception as e:
            return {"error": f"ページを取得できませんでした（{type(e).__name__}）。見出しを直接貼り付けて判定してください。"}
        title = page["title"] or url
        body = page["body"]
    else:
        lines = [l for l in inp.splitlines() if l.strip()]
        title = lines[0] if lines else inp
        body = " ".join(lines[1:]) if len(lines) > 1 else ""
        if len(title) > 160 and not body:  # 長いSNS投稿は全体を本文として扱う
            body = inp

    t_res = az.score_text(title)
    whole = az.score_text(inp) if not page and len(inp) > len(title) else t_res
    base = max(t_res["score"], int(whole["score"] * 0.8))
    gap = az.gap_analysis(title, body, t_res) if (page or body) else {"available": False, "gap": 0, "notes": [
        "本文がないため、見出しの言葉づかいだけで判定しています（URLを貼ると本文とのズレも判定します）"]}
    final = min(100, int(base + gap["gap"] * 0.5)) if gap["available"] else base
    stars = az.to_stars(final)

    calm = az.calm_title(title, t_res["spans"])
    calm_note = ""
    if len(calm) < max(6, len(title) * 0.3):
        calm_note = "見出しのほとんどが煽り表現で、具体的な情報がほぼ含まれていません"
    summary_src = body or (page["description"] if page else "")
    summary = az.factual_summary(summary_src) if summary_src else ""
    title_ja = translate_one(title) if not az._is_ja(title) else ""
    calm_ja = translate_one(calm) if calm and not az._is_ja(calm) else ""
    summary_ja = translate_one(summary[:1200]) if summary and not az._is_ja(summary) else summary
    reasons = t_res["reasons"] or (["目立った煽り表現は見つかりませんでした"])
    if whole is not t_res and whole["score"] > t_res["score"]:
        reasons += [r for r in whole["reasons"] if r not in reasons][:3]

    res = {
        "input_type": page["kind"] if page else "text",
        "yt_id": ft.yt_id(page["url"]) if page and page["kind"] == "youtube" else "",
        "page": {k: page[k] for k in ("url", "site", "title", "description")} if page else None,
        "title": title, "title_ja": title_ja,
        "spans": t_res["spans"],
        "score": final, "title_score": t_res["score"], "stars": stars,
        "label": az.STAR_LABEL[stars],
        "reasons": reasons,
        "categories": t_res["categories"],
        "gap": gap,
        "calm_title": calm, "calm_title_ja": calm_ja, "calm_note": calm_note,
        "summary": summary_ja or summary,
        "verdict": az.verdict_text(stars, gap["available"], gap["gap"]),
    }
    try:
        res["ai_check"] = f3.ai_check(body if len(body or "") >= 200 else (inp if len(inp) >= 200 else ""))
        res["numbers"] = f3.numbers_check(title, body)
    except Exception as e:
        log("AI/数字チェックエラー", e)
    try:
        ft.history_add(res, inp)
    except Exception as e:
        log("履歴保存エラー", e)
    return res


# ------------------------------------------------------------------ 世界マップ用API
def geo_summary():
    items = _news.get("items", [])
    by = {}
    for it in items:
        for i, c in enumerate(it.get("geo") or []):
            b = by.setdefault(c, {**geo.BY_CODE[c], "items": [], "score": 0})
            b["items"].append({k: it.get(k) for k in ("id", "title_ja", "title", "url", "ext_url", "source", "cat", "time")})
            b["score"] += 1 if i == 0 else 0.5
    countries = sorted(by.values(), key=lambda x: -x["score"])
    flows = {}
    for it in items:
        hq = geo.SOURCE_HQ.get(it["source"])
        if not hq or not it.get("geo"):
            continue
        k = (it["source"].split(" ")[0] if not it["source"].startswith("r/") else "Reddit", it["geo"][0])
        f = flows.setdefault(k, {"source": k[0], "hq": hq[0], "from": [hq[1], hq[2]],
                                 "to": [geo.BY_CODE[k[1]]["lat"], geo.BY_CODE[k[1]]["lon"]],
                                 "country": geo.BY_CODE[k[1]]["ja"], "count": 0})
        f["count"] += 1
    hqs = {}
    for name, (label, lat, lon) in geo.SOURCE_HQ.items():
        key = "Reddit" if name.startswith("r/") else name.split(" ")[0]
        h = hqs.setdefault(key, {"name": key, "label": label, "lat": lat, "lon": lon, "count": 0})
        h["count"] += sum(1 for it in items if it["source"] == name)
    unlocated = sum(1 for it in items if not it.get("geo"))
    return {"countries": countries, "flows": list(flows.values()), "hqs": list(hqs.values()),
            "unlocated": unlocated, "total": len(items)}


CONFLICT_CODES = {
    "ru-ua": ["UA", "RU"], "sudan": ["SD"], "gaza": ["PS"], "drc": ["CD"], "myanmar": ["MM"],
    "sahel": ["ML", "BF", "NE"], "haiti": ["HT"], "somalia": ["SO"], "nigeria": ["NG"], "yemen": ["YE"],
    "pak": ["PK", "AF"], "in-pk": ["IN", "PK"], "il-lb": ["LB"], "il-ir": ["IR"], "syria": ["SY"],
    "ethiopia": ["ET"], "ssudan": ["SS"], "moz": ["MZ"], "th-kh": ["TH", "KH"], "colombia": ["CO"],
    "mexico": ["MX"], "venezuela": ["VE"],
}


CONFLICT_WORDS = re.compile(r"\b(war|wars|attack\w*|strike[sd]?|airstrike\w*|military|troops|army|fighting|fight|clash\w*|border|"
                            r"ceasefire|truce|peace|killed|kill\w*|dead|deaths|bomb\w*|missile\w*|drone\w*|shell\w*|rebel\w*|militan\w*|"
                            r"insurgen\w*|gang\w*|siege\w*|besieged|hostage\w*|refugee\w*|displaced|genocide|invasion|offensive|front|"
                            r"sanction\w*|nuclear|junta|coup|terror\w*|violence|soldiers?|weapons?|massacre|crisis)\b", re.I)


def conflicts_payload():
    items = _news.get("items", [])
    out = []
    for c in geo.CONFLICTS:
        codes = CONFLICT_CODES.get(c["id"], [])
        rel = [it for it in items if set(it.get("geo") or []) & set(codes) and CONFLICT_WORDS.search(it["title"] + " " + it.get("desc", "")[:400])]
        out.append({**{k: v for k, v in c.items() if k != "query"}, "level_ja": geo.LEVEL_JA[c["level"]],
                    "news_count": len(rel),
                    "news": [{k: it.get(k) for k in ("title_ja", "title", "url", "source")} for it in rel[:5]]})
    return {"conflicts": out, "note": "2026年11月時点の編集リストです。最新状況は各地域の「最新報道」で確認してください。"}


def quakes_payload():
    d = wl.quakes(get_json)
    places = [q["place"] for q in d["quakes"][:80]]
    tr = translate_many(places) if places else {}
    for q in d["quakes"]:
        q["place_ja"] = tr.get(q["place"], q["place"])
    return d


def summarize(url, fallback=""):
    body, title, site = "", "", ""
    if url:
        try:
            info = fetch_page_info(url)
            body, title, site = info["body"], info["title"], info["site"]
        except Exception as e:
            log("要約用の取得失敗", url, type(e).__name__)
    if len(body) < 120 and fallback:
        body = (body + " " + fallback).strip()
    if len(body) < 40:
        return {"ok": False, "error": "本文を取得できませんでした（動画・画像のみのページや有料記事の可能性）"}
    body = re.sub(r"(?:^|\s)(Watch|WATCH|Listen|LISTEN|Image source|Getty Images)[:：][^.?!]*[.?!]", " ", body)
    src = az.factual_summary(body, max_sent=4)
    ja = translate_one(src[:1500]) if not az._is_ja(src) else src
    pts = [p.strip() for p in re.split(r"(?<=[。！？])", ja) if len(p.strip()) > 6][:3]
    if not pts:
        pts = [ja[:200]]
    return {"ok": True, "points": pts, "title": title, "title_ja": translate_one(title) if title else "",
            "site": site, "chars": len(body)}


MONTHS = set("january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday".split())
STOP_DIGEST = az.EN_STOP | set("""that's it's people world first could after year years over says said like make made
using used than more most much many some time when what show shows just into against been being their there where which
while about every other only also back still found finds study research scientists new""".split())


def digest():
    items = _news.get("items", [])
    gs = geo_summary()
    top_countries = [{"ja": c["ja"], "code": c["code"], "count": len(c["items"]),
                      "headline": c["items"][0]["title_ja"]} for c in gs["countries"][:8]]
    freq, srcs = {}, {}
    corpus = " ".join(it["title"] + " " + it["desc"] for it in items)
    lower_words = set(re.findall(r"\b[a-z][a-z\-]{3,}\b", corpus))
    for it in items:
        for w in set(re.findall(r"\b[A-Z][a-zA-Z\-]{3,}\b", it["title"])):
            lw = w.lower()
            # 普通の単語（小文字でも使われる語）・月/曜日・ストップワードは除外 → 固有名詞が残る
            if lw in STOP_DIGEST or lw in MONTHS or w.isupper() or lw in lower_words or it["title"].startswith(w):
                continue
            freq[w] = freq.get(w, 0) + 1
            srcs.setdefault(w, set()).add(it["source"])
    kws = [w for w, n in sorted(freq.items(), key=lambda x: (-len(srcs[x[0]]), -x[1])) if n >= 2][:12]
    trk = translate_many(kws) if kws else {}
    cats = {}
    for cat, label in (("world", "世界ニュース"), ("tech", "テック・未来"), ("trivia", "雑学・へぇ〜"),
                       ("bright", "明るいニュース"), ("game", "ゲーム・エンタメ")):
        L = [it for it in items if it["cat"] == cat]
        L.sort(key=lambda x: ((x.get("bait") or {}).get("stars", 1) >= 4, -(x.get("score") or 0), -(x.get("time") or 0)))
        if L:
            cats[cat] = {"label": label, "items": [{k: it.get(k) for k in ("id", "title_ja", "title", "desc_ja", "url", "ext_url", "source", "bait")}
                                                    for it in L[:4]]}
    stars = [(it.get("bait") or {}).get("stars", 1) for it in items]
    cp = conflicts_payload()["conflicts"]
    hot = sorted([c for c in cp if c["news_count"]], key=lambda c: -c["news_count"])[:5]
    return {"updated": _news.get("updated"), "total": len(items), "top_countries": top_countries,
            "keywords": [{"en": k, "ja": trk.get(k, k), "count": freq[k]} for k in kws],
            "categories": cats,
            "bait_stats": {str(i): stars.count(i) for i in range(1, 6)},
            "conflicts_in_news": [{"name": c["name"], "level_ja": c["level_ja"], "count": c["news_count"],
                                   "headline": c["news"][0]["title_ja"] if c["news"] else ""} for c in hot]}


# ------------------------------------------------------------------ お気に入り
_fav_lock = threading.Lock()


def favorites():
    return load_json(FAV_FILE, [])


def toggle_fav(item):
    with _fav_lock:
        favs = favorites()
        ids = [f["id"] for f in favs]
        if item["id"] in ids:
            favs = [f for f in favs if f["id"] != item["id"]]
            on = False
        else:
            item["saved_at"] = time.time()
            favs.insert(0, item)
            on = True
        save_json(FAV_FILE, favs)
        return on, favs


# ------------------------------------------------------------------ Webサーバー
class Handler(BaseHTTPRequestHandler):
    server_version = "TrendScope/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        headers = dict(headers or {})
        if code == 200 and headers.pop("_etag", None):
            tag = '"' + hashlib.md5(body).hexdigest()[:16] + '"'
            headers["ETag"] = tag
            if self.headers.get("If-None-Match") == tag:
                self.send_response(304)
                self.send_header("ETag", tag)
                self.end_headers()
                return
        if len(body) > 1024 and "gzip" in (self.headers.get("Accept-Encoding") or "") and \
                any(t in ctype for t in ("json", "text", "javascript", "css", "svg")):
            body = gzip.compress(body, 5)
            headers["Content-Encoding"] = "gzip"
            headers["Vary"] = "Accept-Encoding"
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache" if "ETag" in headers else "no-store")
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            if u.path in ("/", "/index.html"):
                with open(os.path.join(STATIC, "index.html"), "rb") as f:
                    return self._send(200, f.read(), "text/html; charset=utf-8", {"_etag": 1})
            if u.path == "/api/news":
                if q.get("refresh") == ["1"] or not _news.get("items"):
                    d = refresh_news(force=q.get("refresh") == ["1"])
                else:
                    d = _news  # 古くても即返す（裏で自動更新中）
                return self._send(200, {**d, "ttl": CACHE_TTL, "now": time.time()})
            if u.path == "/api/favorites":
                return self._send(200, favorites())
            if u.path == "/api/ping":
                return self._send(200, {"app": "trendscope", "ok": True, "version": VERSION})
            f = lambda k, d=None: (q.get(k) or [d])[0]
            if u.path == "/api/geo":
                return self._send(200, geo_summary())
            if u.path == "/api/conflicts":
                return self._send(200, conflicts_payload())
            if u.path == "/api/conflict_news":
                c = next((c for c in geo.CONFLICTS if c["id"] == f("id")), None)
                if not c:
                    return self._send(404, {"error": "unknown conflict"})
                try:
                    return self._send(200, wl.conflict_news(get_json, c, translate_many, http_get))
                except Exception as e:
                    rel = conflicts_payload()["conflicts"]
                    rel = next((x for x in rel if x["id"] == c["id"]), {"news": []})
                    return self._send(200, {"articles": [{"title_ja": n["title_ja"], "url": n["url"], "domain": n["source"], "country": ""} for n in rel["news"]],
                                            "origins": {}, "error": f"世界報道DB(GDELT)に接続できませんでした（{type(e).__name__}）。収集済みニュースから表示しています"})
            if u.path == "/api/planes":
                return self._send(200, wl.planes(get_json, float(f("lat", 35.6)), float(f("lon", 139.7)), float(f("r", 250))))
            if u.path == "/api/trains":
                return self._send(200, wl.trains(get_json, http_get))
            if u.path == "/api/quakes":
                return self._send(200, quakes_payload())
            if u.path == "/api/iss":
                return self._send(200, wl.iss(get_json))
            if u.path == "/api/summary":
                return self._send(200, summarize(f("url", ""), f("fallback", "")))
            if u.path == "/api/digest":
                return self._send(200, digest())
            if u.path.startswith("/static/"):
                fn = os.path.basename(u.path)
                fp = os.path.join(STATIC, fn)
                if not re.match(r"^[\w\-.]+\.(js|css|png|svg|ico)$", fn) or not os.path.isfile(fp):
                    return self._send(404, {"error": "not found"})
                ctype = {"js": "application/javascript", "css": "text/css", "png": "image/png", "svg": "image/svg+xml",
                         "ico": "image/x-icon"}[fn.rsplit(".", 1)[1]] + ("; charset=utf-8" if fn.endswith(("js", "css")) else "")
                with open(fp, "rb") as fh:
                    return self._send(200, fh.read(), ctype, {"_etag": 1})
            if u.path == "/api/settings":
                st = ft.settings()
                return self._send(200, {**st, "lan_ip": ft.lan_ip(), "port": PORT_REF[0], "lan_active": HOST_REF[0] == "0.0.0.0",
                                        "briefings": ft.briefings_list()})
            if u.path == "/api/alerts":
                return self._send(200, {"events": ft.alert_events(float(f("since", 0)))})
            if u.path == "/api/compare":
                return self._send(200, ft.compare(_news.get("items", []), geo_summary, digest))
            if u.path == "/api/timeline":
                kind, cid = f("kind", "conflict"), f("id", "")
                src = geo.CONFLICTS if kind == "conflict" else ft.CHOKEPOINTS
                c = next((x for x in src if x["id"] == cid), None)
                if not c:
                    return self._send(404, {"error": "unknown"})
                ja = c.get("ja") or re.sub(r"（.*?）", "", c["name"]).replace("情勢", "").strip()
                return self._send(200, ft.timeline(kind + cid, c["query"], ja))
            if u.path == "/api/chokepoints":
                return self._send(200, {"chokepoints": ft.CHOKEPOINTS})
            if u.path == "/api/topic_news":
                c = next((x for x in ft.CHOKEPOINTS if x["id"] == f("id")), None)
                if not c:
                    return self._send(404, {"error": "unknown"})
                return self._send(200, wl.conflict_news(get_json, {"id": "cp-" + c["id"], "query": c["query"]}, translate_many, http_get))
            if u.path == "/api/ships":
                return self._send(200, ft.ships())
            if u.path == "/api/disasters":
                return self._send(200, ft.disasters())
            if u.path == "/api/weather":
                return self._send(200, ft.weather())
            if u.path == "/api/briefings":
                return self._send(200, {"dates": ft.briefings_list()})
            if u.path == "/api/briefing":
                b = ft.briefing_get(f("date", ""))
                return self._send(200 if b else 404, b or {"error": "not found"})
            if u.path == "/api/thumb":
                img = ft.thumb_bytes(f("id", ""))
                if not img:
                    return self._send(404, {"error": "サムネイルを取得できませんでした"})
                return self._send(200, img, "image/jpeg")
            if u.path == "/api/history":
                return self._send(200, ft.history())
            if u.path == "/api/country":
                return self._send(200, f2.country_profile(f("code", ""), _news.get("items", [])))
            if u.path == "/api/countries":
                return self._send(200, sorted(geo.BY_CODE.values(), key=lambda c: c["ja"]))
            if u.path == "/api/markets":
                return self._send(200, f2.markets())
            if u.path == "/api/holidays":
                return self._send(200, f2.holidays())
            if u.path == "/api/wiki_trending":
                return self._send(200, f2.wiki_trending())
            if u.path == "/api/framing":
                it = next((x for x in _news.get("items", []) if x["id"] == f("id")), None)
                t_en = it["title"] if it else f("q", "")
                t_ja = it.get("title_ja", "") if it else ""
                if not t_en:
                    return self._send(400, {"error": "記事が見つかりません"})
                if az._is_ja(t_en):
                    t_ja, t_en = t_en, translate_to(t_en, "en")
                return self._send(200, f2.framing(t_en, t_ja))
            if u.path == "/api/factcheck":
                return self._send(200, f2.factcheck(f("q", "")))
            if u.path == "/api/image_check":
                return self._send(200, f2.image_check(f("url", "")))
            if u.path == "/api/image_proxy":
                raw, _ = f2.image_fetch(f("url", ""))
                if not raw:
                    return self._send(404, {"error": "not found"})
                return self._send(200, raw, "image/jpeg" if raw[:2] == b"\xff\xd8" else "image/png" if raw[:4] == b"\x89PNG" else "image/gif" if raw[:3] == b"GIF" else "image/webp")
            if u.path == "/report/weekly":
                return self._send(200, f2.weekly_report(ft.history), "text/html; charset=utf-8")
            if u.path == "/api/autostart":
                return self._send(200, f2.autostart_get())
            if u.path == "/api/logs":
                return self._send(200, f4.logs())
            if u.path == "/api/publish/status":
                return self._send(200, f4.publish_status())
            if u.path in ("/pub/api/data", "/api/publish/preview"):
                return self._send(200, public_payload())
            if u.path == "/pub" or u.path.startswith("/pub/"):
                rel = u.path[5:] or "index.html"
                fp = os.path.normpath(os.path.join(BASE, "cloudflare", "public", rel))
                if not fp.startswith(os.path.join(BASE, "cloudflare", "public")) or not os.path.isfile(fp):
                    return self._send(404, {"error": "not found"})
                ext = fp.rsplit(".", 1)[-1]
                ct = {"html": "text/html; charset=utf-8", "js": "application/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
                      "json": "application/json", "svg": "image/svg+xml", "png": "image/png", "txt": "text/plain; charset=utf-8",
                      "xml": "application/xml"}.get(ext, "application/octet-stream")
                with open(fp, "rb") as fh:
                    return self._send(200, fh.read(), ct, {"_etag": 1})
            if u.path == "/api/livecams":
                return self._send(200, f3.livecams())
            if u.path == "/api/livecam":
                return self._send(200, f3.livecam_video(int(f("i", 0))))
            if u.path == "/api/air":
                return self._send(200, f3.air_quality())
            if u.path == "/api/launches":
                return self._send(200, f3.launches())
            if u.path == "/api/wb":
                return self._send(200, f3.wb_compare((f("codes", "") or "").split(",")))
            if u.path == "/api/wpop":
                return self._send(200, f3.world_population())
            if u.path == "/api/define":
                return self._send(200, f3.define(f("q", "")))
            if u.path == "/api/glossary":
                return self._send(200, {"terms": f3.glossary_terms(), "dict": f3.GLOSSARY})
            if u.path == "/api/follows":
                return self._send(200, {"follows": f3.follows()})
            if u.path == "/api/japan_relation":
                return self._send(200, f3.japan_relation(f("code", ""), _news.get("items", [])))
            if u.path == "/api/emotions":
                return self._send(200, f3.emotions(_news.get("items", [])))
            if u.path == "/api/radio/script":
                cats = [c for c in (f("cats", "") or "").split(",") if c]
                return self._send(200, {"script": f3.radio_script(digest(), cats or None)})
            if u.path == "/api/radio/file":
                cats = [c for c in (f("cats", "") or "").split(",") if c]
                path, err = f3.radio_wav(f3.radio_script(digest(), cats or None))
                if err:
                    return self._send(500, {"error": err})
                with open(path, "rb") as fh:
                    return self._send(200, fh.read(), "audio/wav",
                                      {"Content-Disposition": f'attachment; filename="{os.path.basename(path)}"'})
            if u.path == "/api/wallpaper/preview":
                png, err = wallpaper_render()
                if err:
                    return self._send(500, {"error": err})
                with open(png, "rb") as fh:
                    return self._send(200, fh.read(), "image/png")
            if u.path == "/api/archive":
                return self._send(200, f3.archive_search(f("q", ""), f("cat", ""), int(f("days", 0) or 0)))
            return self._send(404, {"error": "not found"})
        except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError) as e:
            log(f"外部データ取得失敗 {u.path}: {type(e).__name__}")
            return self._send(502, {"error": f"外部サービスに接続できませんでした（{type(e).__name__}）"})
        except Exception as e:
            traceback.print_exc()
            return self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        try:
            if u.path == "/api/update":
                if self.client_address[0] != "127.0.0.1":
                    return self._send(403, {"error": "このPCからのみ実行できます"})
                n = int(self.headers.get("Content-Length") or 0)
                if n > 30_000_000:
                    return self._send(413, {"error": "ファイルが大きすぎます"})
                res = f4.update_from_zip(self.rfile.read(n))
                self._send(200, res)
                if res.get("ok"):
                    threading.Timer(1.0, restart_self).start()
                return
            b = self._body()
            if u.path == "/api/analyze":
                return self._send(200, analyze(b.get("input", "")))
            if u.path == "/api/settings":
                return self._send(200, ft.save_settings(b))
            if u.path == "/api/alerts/test":
                ft.desktop_notify("🔔 TrendScope テスト通知", "デスクトップ通知はこのように表示されます")
                return self._send(200, {"ok": True})
            if u.path == "/api/score_text":
                r = az.score_text(b.get("text", ""))
                return self._send(200, {"score": r["score"], "stars": r["stars"], "reasons": r["reasons"]})
            if u.path == "/api/autostart" and self.client_address[0] == "127.0.0.1":
                return self._send(200, f2.autostart_set(bool(b.get("on"))))
            if u.path == "/api/follow":
                return self._send(200, {"follows": f3.follow_add(b.get("item") or {})})
            if u.path == "/api/unfollow":
                return self._send(200, {"follows": f3.follow_remove(b.get("id", ""))})
            if u.path == "/api/follow/check":
                return self._send(200, {"follows": f3.follow_check()})
            if u.path == "/api/notify/test":
                sent = f3.notify_external("🔔 TrendScope テスト通知", "この通知が届いていれば設定は成功です")
                return self._send(200, {"sent": sent})
            if u.path == "/api/wallpaper" and self.client_address[0] == "127.0.0.1":
                return self._send(200, f3.wallpaper_enable(bool(b.get("on")), wallpaper_render))
            if u.path == "/api/ai_check":
                return self._send(200, f3.ai_check(b.get("text", "")))
            if u.path == "/api/publish":
                return self._send(200, f4.publish(public_payload()))
            if u.path == "/api/history/clear":
                ft.history_clear()
                return self._send(200, {"ok": True})
            if u.path == "/api/briefing/run":
                d = ft.run_briefing(refresh_news, digest, PORT_REF, open_browser=False)
                return self._send(200, {"ok": True, "date": time.strftime("%Y-%m-%d"), "digest": d})
            if u.path == "/api/restart" and self.client_address[0] == "127.0.0.1":
                self._send(200, {"ok": True})
                restart_self()
                return
            if u.path == "/api/shutdown" and self.client_address[0] == "127.0.0.1":
                self._send(200, {"ok": True})
                log("新しいバージョンに入れ替えるため終了します")
                threading.Timer(0.3, lambda: os._exit(0)).start()
                return
            if u.path == "/api/favorites":
                on, favs = toggle_fav(b["item"])
                return self._send(200, {"saved": on, "favorites": favs})
            return self._send(404, {"error": "not found"})
        except Exception as e:
            traceback.print_exc()
            return self._send(500, {"error": f"{type(e).__name__}: {e}"})


def port_is_ours(port):
    """自分(TrendScope)なら版を返す。違うアプリなら None"""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=2) as r:
            j = json.loads(r.read())
            return (j.get("version") or "old") if j.get("app") == "trendscope" else None
    except Exception:
        return None


def try_shutdown(port):
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/shutdown", data=b"{}", method="POST")
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        pass
    for _ in range(20):
        time.sleep(0.25)
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return True
    return False


def wallpaper_render():
    try:
        mk = f2.markets()
    except Exception:
        mk = {}
    try:
        wx = ft.weather()
    except Exception:
        wx = {}
    return f3.wallpaper_render(digest(), geo_summary(), geo.CONFLICTS, mk, wx)


def public_compare():
    try:
        c = ft.compare(_news.get("items", []), geo_summary, digest)
    except Exception:
        return {}
    strip = lambda rows: [{k: v for k, v in r.items() if k not in ("japan_examples", "foreign_example")} for r in rows]
    return {"quiet_in_japan": strip(c["quiet_in_japan"]), "both": strip(c["both"]), "japan_only": strip(c["japan_only"]),
            "jp_total": c["jp_total"], "foreign_total": c["foreign_total"]}


def public_payload():
    return f4.build_public_payload(_news, digest, geo_summary, conflicts_payload, lambda: f3.emotions(_news.get("items", [])),
                                   {"markets": f2.markets, "holidays": f2.holidays, "launches": f3.launches,
                                    "wiki": f2.wiki_trending, "compare": public_compare})


VERSION = code_version()
PORT_REF = [PORT]
HOST_REF = ["127.0.0.1"]


def restart_self():
    """設定変更（スマホアクセス等）を反映するため、新しいウィンドウで起動し直す"""
    log("再起動します…")
    args = [sys.executable, os.path.join(BASE, "server.py"), "--no-browser", "--wait-port"] + (["--tray"] if "--tray" in sys.argv else [])
    kw = {"cwd": BASE}
    if sys.platform == "win32":
        kw["creationflags"] = 0x08000000 if "pythonw" in sys.executable.lower() else 0x00000010  # 窓なし / 新しいコンソール
    subprocess.Popen(args, **kw)
    threading.Timer(0.5, lambda: os._exit(0)).start()


def main():
    no_browser = "--no-browser" in sys.argv
    port = PORT
    ft.H.update(http_get=http_get, get_json=get_json, translate_many=translate_many, log=log,
                translate_one=translate_one, translate_to=translate_to)
    if "--wait-port" in sys.argv:  # 再起動時は古いプロセスが終わるのを待つ
        for _ in range(40):
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", port)) != 0:
                    break
            time.sleep(0.25)
    for _ in range(20):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                break
        ver = port_is_ours(port)
        if ver == VERSION:
            log(f"すでに起動中です → http://localhost:{port}")
            if not no_browser:
                webbrowser.open(f"http://localhost:{port}")
            return
        if ver and try_shutdown(port):  # 古い版が動いていたら入れ替える
            log("古いバージョンを終了しました。新しいバージョンで起動します")
            break
        port += 1
    host = "0.0.0.0" if ft.settings().get("lan_access") else "127.0.0.1"
    HOST_REF[0], PORT_REF[0] = host, port
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    url = f"http://localhost:{port}"
    print("=" * 56)
    print("  TrendScope 起動しました  →  " + url)
    if host == "0.0.0.0":
        print(f"  📱 スマホから: http://{ft.lan_ip()}:{port}  （同じWi-Fiに接続）")
    print("  止めるときはこのウィンドウを閉じるか Ctrl+C")
    print("=" * 56, flush=True)
    threading.Thread(target=background_loop, daemon=True).start()
    threading.Thread(target=ft.briefing_loop, args=(refresh_news, digest, PORT_REF), daemon=True).start()
    threading.Thread(target=f3.follow_loop, daemon=True).start()
    threading.Thread(target=f4.publish_loop, args=(public_payload,), daemon=True).start()
    threading.Thread(target=f3.wallpaper_loop, args=(wallpaper_render,), daemon=True).start()
    try:
        f3.archive_add(_news.get("items", []))
    except Exception as e:
        log("保存庫の初期化エラー", e)
    if "--tray" in sys.argv and sys.platform == "win32":
        try:
            import tray
            t = tray.Tray(PORT_REF, restart_self, lambda: os._exit(0), tray.make_icon(os.path.join(DATA, "trendscope.ico")))
            t.start()
            log("タスクトレイに常駐しました")
        except Exception as e:
            log("タスクトレイを作れませんでした", e)
    if not no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        flush_tr_cache()


if __name__ == "__main__":
    main()
