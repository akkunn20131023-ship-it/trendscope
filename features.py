# -*- coding: utf-8 -*-
"""
TrendScope 追加機能（すべて無料・キー不要）
 1 アラート＋Windows/Mac通知   2 日本との温度差   3 報道件数の時系列
 4 船(AIS)＋海の要衝          5 災害(NASA EONET)・天気   6 世界時計(天気APIの時差)
 7 朝のブリーフィング          9 スマホ(LAN)アクセス設定
10 YouTubeサムネ取得           11 判定履歴・釣りランキング
"""
import datetime as dt
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

import geo

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
CONFIG_FILE = os.path.join(BASE, "config.json")
ALERT_EVENTS = os.path.join(DATA, "alert_events.json")
ALERT_SEEN = os.path.join(DATA, "alert_seen.json")
HISTORY_FILE = os.path.join(DATA, "history.json")
BRIEF_DIR = os.path.join(DATA, "briefings")
JST = dt.timezone(dt.timedelta(hours=9))

H = {}  # server.py から http_get / get_json / translate_many / log を注入


def _j(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


_cache, _clock = {}, threading.Lock()


def cached(key, ttl, fn, ok=None):
    """ttl秒キャッシュ。ok(結果)がFalseなら（取得失敗など）60秒で再取得する"""
    now = time.time()
    with _clock:
        hit = _cache.get(key)
        if hit and now - hit[0] < hit[2]:
            return hit[1]
    v = fn()
    good = True
    try:
        good = ok(v) if ok else True
    except Exception:
        pass
    with _clock:
        _cache[key] = (now, v, ttl if good else 60)
    return v


# ------------------------------------------------------------------ 設定
DEFAULT_SETTINGS = {
    "odpt_key": "",
    "alerts": [
        {"type": "keyword", "value": "Nintendo", "on": True},
        {"type": "quake", "min": 6.0, "on": True},
    ],
    "notify_desktop": True,
    "briefing_enabled": False,
    "briefing_time": "07:30",
    "briefing_open_browser": True,
    "lan_access": False,
    "tts_rate": 1.1,
}


def settings():
    s = dict(DEFAULT_SETTINGS)
    s.update({k: v for k, v in _j(CONFIG_FILE, {}).items() if not k.startswith("_")})
    return s


def save_settings(new):
    cur = _j(CONFIG_FILE, {})
    for k in DEFAULT_SETTINGS:
        if k in new:
            cur[k] = new[k]
    cur.setdefault("_odpt_help", "東京メトロ・都営の列車位置を出すには https://developer.odpt.org/ で無料登録してキーを odpt_key に")
    _save(CONFIG_FILE, cur)
    return settings()


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # 実際には送信しない（自分のLAN IPを知るだけ）
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ------------------------------------------------------------------ 1. デスクトップ通知
def _xml_esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def desktop_notify(title, body):
    if not settings().get("notify_desktop", True):
        return
    try:
        if sys.platform == "win32":
            env = dict(os.environ, TS_T=_xml_esc(title)[:120], TS_B=_xml_esc(body)[:300])
            ps = (
                "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null;"
                "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] > $null;"
                "$x = New-Object Windows.Data.Xml.Dom.XmlDocument;"
                "$x.LoadXml(\"<toast><visual><binding template='ToastGeneric'><text>$($env:TS_T)</text><text>$($env:TS_B)</text></binding></visual></toast>\");"
                "$n = [Windows.UI.Notifications.ToastNotification]::new($x);"
                "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("
                "'{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($n)"
            )
            subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                             env=env, creationflags=0x08000000, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif sys.platform == "darwin":
            t = title.replace('"', "'"); b = body.replace('"', "'")
            subprocess.Popen(["osascript", "-e", f'display notification "{b}" with title "{t}"'])
    except Exception as e:
        H["log"]("通知に失敗", e)


# ------------------------------------------------------------------ 1. アラート
_alert_lock = threading.Lock()


def alert_events(since=0):
    ev = _j(ALERT_EVENTS, [])
    return [e for e in ev if e["time"] > since]


def _push_event(kind, title, body, url, rule):
    with _alert_lock:
        ev = _j(ALERT_EVENTS, [])
        ev.append({"id": f"{int(time.time()*1000)}", "time": time.time(), "kind": kind, "title": title,
                   "body": body, "url": url, "rule": rule})
        _save(ALERT_EVENTS, ev[-200:])
    desktop_notify(f"🔔 TrendScope: {rule}", title)


def _rule_label(r):
    return f"キーワード「{r['value']}」" if r["type"] == "keyword" else f"地震 M{r.get('min', 6)}以上" + (
        f"（{r['region']}）" if r.get("region") else "")


def check_news_alerts(items):
    rules = [r for r in settings()["alerts"] if r.get("on", True) and r["type"] == "keyword" and r.get("value")]
    seen = set(_j(ALERT_SEEN, []))
    first_run = not seen
    new_seen = set(seen)
    for it in items:
        key = "n:" + it["id"]
        new_seen.add(key)
        if key in seen or first_run:
            continue  # 初回は既存記事で通知を乱発しない
        text = " ".join([it.get("title", ""), it.get("title_ja", ""), it.get("desc", "")[:300]]).lower()
        for r in rules:
            if r["value"].lower() in text:
                _push_event("news", it.get("title_ja") or it["title"], it.get("source", ""), it.get("url"), _rule_label(r))
                break
    _save(ALERT_SEEN, list(new_seen)[-5000:])


def check_quake_alerts(quakes):
    rules = [r for r in settings()["alerts"] if r.get("on", True) and r["type"] == "quake"]
    if not rules:
        return
    seen = set(_j(ALERT_SEEN, []))
    new_seen = set(seen)
    for q in quakes:
        key = "q:" + q["id"]
        new_seen.add(key)
        if key in seen or time.time() - q["time"] > 6 * 3600:
            continue
        for r in rules:
            reg = (r.get("region") or "").lower()
            if q["mag"] >= float(r.get("min", 6)) and (not reg or reg in (q["place"] + q.get("place_ja", "")).lower()):
                _push_event("quake", f"M{q['mag']:.1f} {q.get('place_ja') or q['place']}",
                            "津波情報あり" if q.get("tsunami") else "", q.get("url"), _rule_label(r))
                break
    _save(ALERT_SEEN, list(new_seen)[-5000:])


# ------------------------------------------------------------------ RSS共通
def parse_rss(url, limit=60):
    raw, _, _ = H["http_get"](url, accept="application/rss+xml, application/xml, text/xml", timeout=15)
    root = ET.fromstring(raw)
    ns = {"a": "http://www.w3.org/2005/Atom"}
    out = []
    for it in (root.findall(".//item") or root.findall(".//a:entry", ns))[:limit]:
        title = (it.findtext("title") or it.findtext("a:title", namespaces=ns) or "").strip()
        link = it.findtext("link") or ""
        if not link:
            le = it.find("a:link", ns)
            link = le.get("href") if le is not None else ""
        src = it.find("source")
        name = (src.text or "").strip() if src is not None and src.text else ""
        if name and title.endswith(" - " + name):
            title = title[: -len(name) - 3]
        pub = it.findtext("pubDate") or it.findtext("a:updated", namespaces=ns) or ""
        try:
            ts = parsedate_to_datetime(pub).timestamp()
        except Exception:
            try:
                ts = dt.datetime.fromisoformat(pub.replace("Z", "+00:00")).timestamp()
            except Exception:
                ts = 0
        out.append({"title": title, "url": link, "source": name, "time": ts,
                    "source_url": src.get("url", "") if src is not None else ""})
    return out


def gnews(query, lang="en", days=3, limit=100):
    loc = {"en": ("en-US", "US", "US:en"), "ja": ("ja", "JP", "JP:ja")}[lang]
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": f"{query} when:{days}d", "hl": loc[0], "gl": loc[1], "ceid": loc[2]})
    return parse_rss(url, limit)


# ------------------------------------------------------------------ 2. 日本との温度差
JP_FEEDS = [
    ("Yahoo!ニュース 主要", "https://news.yahoo.co.jp/rss/topics/top-picks.xml"),
    ("Yahoo!ニュース 国際", "https://news.yahoo.co.jp/rss/topics/world.xml"),
    ("Yahoo!ニュース IT", "https://news.yahoo.co.jp/rss/topics/it.xml"),
    ("Yahoo!ニュース 科学", "https://news.yahoo.co.jp/rss/topics/science.xml"),
    ("NHK 主要", "https://www3.nhk.or.jp/rss/news/cat0.xml"),
    ("NHK 国際", "https://www3.nhk.or.jp/rss/news/cat6.xml"),
    ("Googleニュース 日本", "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja"),
    ("Googleニュース 国際(日本語)", "https://news.google.com/rss/headlines/section/topic/WORLD?hl=ja&gl=JP&ceid=JP:ja"),
]
JA_ALIASES = {"US": ["米国", "米", "アメリカ", "トランプ"], "GB": ["英国", "英", "イギリス"], "RU": ["ロシア", "露", "プーチン"],
              "CN": ["中国", "中", "習近平"], "KR": ["韓国", "韓"], "KP": ["北朝鮮"], "UA": ["ウクライナ", "ゼレンスキー"],
              "IL": ["イスラエル"], "PS": ["ガザ", "パレスチナ", "ハマス"], "FR": ["フランス", "仏"], "DE": ["ドイツ", "独"],
              "IN": ["インド"], "TW": ["台湾"], "IR": ["イラン"], "SD": ["スーダン"], "JP": ["日本", "政府", "首相"]}


def jp_headlines():
    def fetch():
        items, status = [], []
        for name, url in JP_FEEDS:
            try:
                got = parse_rss(url, 60)
                for g in got:
                    g["feed"] = name
                items += got
                status.append({"name": name, "ok": True, "count": len(got)})
            except Exception as e:
                status.append({"name": name, "ok": False, "error": type(e).__name__})
        seen, uniq = set(), []
        for i in items:
            k = re.sub(r"\s", "", i["title"])[:40]
            if k and k not in seen:
                seen.add(k); uniq.append(i)
        return {"items": uniq, "status": status}
    return cached("jp", 900, fetch)


def _jp_count(names, titles):
    n, hits = 0, []
    for t in titles:
        if any((len(a) >= 2 and a in t) or (len(a) == 1 and re.search(a + r"[・、大首政軍外中]", t)) for a in names):
            n += 1
            if len(hits) < 3:
                hits.append(t)
    return n, hits


def compare(news_items, geo_summary_fn, digest_fn):
    jp = jp_headlines()
    titles = [i["title"] for i in jp["items"]]
    total_f, total_j = max(1, len(news_items)), max(1, len(titles))
    rows = []
    for c in geo_summary_fn()["countries"]:
        if c["code"] == "JP":
            continue
        names = [c["ja"]] + JA_ALIASES.get(c["code"], [])
        jn, hits = _jp_count(names, titles)
        fn = len(c["items"])
        rows.append({"topic": c["ja"], "kind": "国", "foreign": fn, "japan": jn,
                     "foreign_pct": round(fn / total_f * 100, 1), "japan_pct": round(jn / total_j * 100, 1),
                     "foreign_example": c["items"][0]["title_ja"], "japan_examples": hits})
    for k in digest_fn().get("keywords", [])[:10]:
        ja = k["ja"].strip()
        if len(ja) < 2 or any(r["topic"] == ja for r in rows):
            continue
        core = re.sub(r"(大統領|首相|氏|国王|議長|長官)$", "", ja)
        jn, hits = _jp_count(list({ja, core}), titles)
        ex = next((it["title_ja"] for it in news_items if k["en"] in it["title"]), "")
        rows.append({"topic": ja, "kind": "キーワード", "foreign": k["count"], "japan": jn,
                     "foreign_pct": round(k["count"] / total_f * 100, 1), "japan_pct": round(jn / total_j * 100, 1),
                     "foreign_example": ex, "japan_examples": hits})
    for r in rows:
        r["gap"] = round(r["foreign_pct"] - r["japan_pct"], 1)
    quiet = sorted([r for r in rows if r["foreign"] >= 1 and r["japan"] <= 1], key=lambda r: -r["foreign"])[:10]
    both = sorted([r for r in rows if r["japan"] >= 2], key=lambda r: -(r["japan"] + r["foreign"]))[:10]
    jp_only = []  # 日本だけで話題になっている国
    covered = {r["topic"] for r in rows}
    for code, c in geo.BY_CODE.items():
        if code == "JP" or c["ja"] in covered:
            continue
        jn, hits = _jp_count([c["ja"]] + JA_ALIASES.get(code, []), titles)
        if jn >= 2:
            jp_only.append({"topic": c["ja"], "japan": jn, "japan_examples": hits})
    jp_only.sort(key=lambda r: -r["japan"])
    return {"quiet_in_japan": quiet, "both": both, "japan_only": jp_only[:8],
            "jp_total": len(titles), "foreign_total": len(news_items), "jp_status": jp["status"],
            "jp_latest": jp["items"][:30]}


# ------------------------------------------------------------------ 3. 時系列（海外 vs 日本の報道件数・7日）
def timeline(key, query_en, query_ja):
    def fetch():
        days = [(dt.datetime.now(JST) - dt.timedelta(days=i)).strftime("%m/%d") for i in range(6, -1, -1)]
        res = {}
        for lang, q in (("en", query_en), ("ja", query_ja)):
            cnt = {d: 0 for d in days}
            try:
                for a in gnews(q, lang, days=7, limit=100):
                    if a["time"]:
                        d = dt.datetime.fromtimestamp(a["time"], JST).strftime("%m/%d")
                        if d in cnt:
                            cnt[d] += 1
                res[lang] = [cnt[d] for d in days]
            except Exception as e:
                res[lang] = None
                res[lang + "_error"] = type(e).__name__
        en = res.get("en") or []
        trend = ""
        if en and sum(en[:-2]) > 0:
            recent, before = sum(en[-2:]) / 2, sum(en[:-2]) / 5
            if recent > before * 1.8 and recent >= 4:
                trend = "急増中"
            elif recent < before * 0.5:
                trend = "減少"
        return {"days": days, "foreign": res.get("en"), "japan": res.get("ja"), "trend": trend,
                "note": "Googleニュースの検索結果件数（最大100件/言語）。報道の盛り上がりの目安です"}
    return cached("tl:" + key, 1800, fetch)


# ------------------------------------------------------------------ 4. 船（フィンランド Digitraffic AIS）＋海の要衝
CHOKEPOINTS = [
    {"id": "suez", "name": "スエズ運河", "lat": 30.6, "lon": 32.33, "query": "Suez Canal shipping", "ja": "スエズ運河",
     "desc": "地中海と紅海を結ぶ運河。世界の海上貿易の約1割が通る。"},
    {"id": "bab", "name": "バブ・エル・マンデブ海峡（紅海）", "lat": 12.6, "lon": 43.3, "query": "Red Sea shipping Houthi", "ja": "紅海 船舶",
     "desc": "紅海の出入口。フーシ派の船舶攻撃で多くの船が喜望峰回りに迂回した。"},
    {"id": "hormuz", "name": "ホルムズ海峡", "lat": 26.57, "lon": 56.25, "query": "Strait of Hormuz tanker", "ja": "ホルムズ海峡",
     "desc": "ペルシャ湾の出口。日本が輸入する原油の大部分が通過する。"},
    {"id": "malacca", "name": "マラッカ海峡", "lat": 2.5, "lon": 101.2, "query": "Strait of Malacca shipping", "ja": "マラッカ海峡",
     "desc": "インド洋と太平洋を結ぶ最短ルート。東アジア向け物流の大動脈。"},
    {"id": "panama", "name": "パナマ運河", "lat": 9.08, "lon": -79.68, "query": "Panama Canal shipping", "ja": "パナマ運河",
     "desc": "大西洋と太平洋を結ぶ運河。渇水による通航制限が話題になった。"},
    {"id": "bosporus", "name": "ボスポラス海峡", "lat": 41.12, "lon": 29.07, "query": "Bosphorus shipping Black Sea", "ja": "ボスポラス海峡",
     "desc": "黒海と地中海を結ぶ。ウクライナ・ロシアの穀物/原油輸送に関わる。"},
    {"id": "taiwan", "name": "台湾海峡", "lat": 24.3, "lon": 119.6, "query": "Taiwan Strait", "ja": "台湾海峡",
     "desc": "東アジアの重要航路。軍事的緊張がたびたび報じられる。"},
]
SHIP_TYPES = {range(60, 70): "旅客船", range(70, 80): "貨物船", range(80, 90): "タンカー", range(30, 31): "漁船",
              range(31, 33): "曳船", range(52, 53): "曳船", range(36, 37): "帆船", range(37, 38): "プレジャーボート"}
_vessels = {"t": 0, "map": {}}


def ships():
    def fetch():
        hdr = {"Digitraffic-User": "TrendScope/1.0"}
        raw, cs, _ = H["http_get"]("https://meri.digitraffic.fi/api/ais/v1/locations", accept="application/json",
                                   headers=hdr, timeout=25, max_bytes=40_000_000)
        j = json.loads(raw.decode(cs or "utf-8"))
        if time.time() - _vessels["t"] > 3600:  # 船名・船種は1時間に1回
            try:
                raw2, cs2, _ = H["http_get"]("https://meri.digitraffic.fi/api/ais/v1/vessels", accept="application/json",
                                             headers=hdr, timeout=30, max_bytes=40_000_000)
                _vessels["map"] = {v["mmsi"]: (v.get("name", ""), v.get("shipType", 0), v.get("destination", ""))
                                   for v in json.loads(raw2.decode(cs2 or "utf-8"))}
                _vessels["t"] = time.time()
            except Exception as e:
                H["log"]("船名取得失敗", type(e).__name__)
        now_ms = time.time() * 1000
        out = []
        for f in j.get("features", []):
            p, g = f["properties"], f["geometry"]["coordinates"]
            if now_ms - p.get("timestampExternal", now_ms) > 30 * 60 * 1000:
                continue
            name, st, dest = _vessels["map"].get(f.get("mmsi") or p.get("mmsi"), ("", 0, ""))
            kind = next((v for r, v in SHIP_TYPES.items() if st in r), "その他")
            sog = p.get("sog", 0) or 0
            sog = 0 if sog >= 102 else sog  # 102.3 = 速度不明
            cog = p.get("cog", 0) or 0
            out.append({"id": f.get("mmsi") or p.get("mmsi"), "lat": g[1], "lon": g[0], "sog": sog,
                        "cog": 0 if cog >= 360 else cog, "name": name.strip(), "kind": kind, "dest": (dest or "").strip()})
        out.sort(key=lambda s: -s["sog"])
        return {"ships": out[:2500], "total": len(out), "area": "バルト海周辺（フィンランド運輸局のAIS公開データ）"}
    return cached("ships", 60, fetch)


# ------------------------------------------------------------------ 5. 災害（NASA EONET）・天気
EONET_JA = {"wildfires": ("🔥", "山火事"), "severeStorms": ("🌀", "台風・暴風雨"), "volcanoes": ("🌋", "火山"),
            "seaLakeIce": ("🧊", "海氷・氷山"), "floods": ("🌊", "洪水"), "earthquakes": ("📳", "地震"),
            "drought": ("🏜", "干ばつ"), "dustHaze": ("🌫", "砂塵・煙霧"), "landslides": ("⛰", "地すべり"),
            "snow": ("❄", "大雪"), "tempExtremes": ("🌡", "異常気温"), "manmade": ("🏭", "人為的災害"), "waterColor": ("💧", "水質変化")}


def disasters():
    def fetch():
        j = H["get_json"]("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=400", timeout=25)
        out = []
        for e in j.get("events", []):
            cat = (e.get("categories") or [{}])[0].get("id", "")
            geoms = e.get("geometry") or []
            if not geoms:
                continue
            track = []
            for g in geoms:
                if g.get("type") == "Point":
                    track.append([g["coordinates"][1], g["coordinates"][0]])
                elif g.get("type") == "Polygon":
                    ring = g["coordinates"][0]
                    track.append([sum(p[1] for p in ring) / len(ring), sum(p[0] for p in ring) / len(ring)])
            last = geoms[-1]
            icon, ja = EONET_JA.get(cat, ("⚠", cat))
            out.append({"id": e["id"], "title": e.get("title", ""), "cat": cat, "cat_ja": ja, "icon": icon,
                        "lat": track[-1][0], "lon": track[-1][1], "track": track[-40:] if cat == "severeStorms" else [],
                        "date": last.get("date", ""), "mag": last.get("magnitudeValue"), "mag_unit": last.get("magnitudeUnit") or "",
                        "url": (e.get("sources") or [{}])[0].get("url", "")})
        tr = H["translate_many"]([o["title"] for o in out if o["cat"] != "wildfires"][:150])
        for o in out:
            o["title_ja"] = tr.get(o["title"], o["title"])
        return {"events": out, "counts": {c: sum(1 for o in out if o["cat"] == c) for c in {o["cat"] for o in out}}}
    return cached("eonet", 1200, fetch)


CITIES = [("東京", 35.68, 139.69), ("ソウル", 37.57, 126.98), ("北京", 39.9, 116.4), ("香港", 22.32, 114.17),
          ("シンガポール", 1.35, 103.82), ("バンコク", 13.75, 100.5), ("ニューデリー", 28.61, 77.21), ("ドバイ", 25.2, 55.27),
          ("モスクワ", 55.75, 37.62), ("キーウ", 50.45, 30.52), ("イスタンブール", 41.01, 28.98), ("カイロ", 30.04, 31.24),
          ("ナイロビ", -1.29, 36.82), ("ヨハネスブルグ", -26.2, 28.05), ("ラゴス", 6.52, 3.38), ("パリ", 48.86, 2.35),
          ("ロンドン", 51.51, -0.13), ("ベルリン", 52.52, 13.4), ("レイキャビク", 64.15, -21.94), ("ニューヨーク", 40.71, -74.0),
          ("ワシントン", 38.9, -77.04), ("シカゴ", 41.88, -87.63), ("ロサンゼルス", 34.05, -118.24), ("メキシコシティ", 19.43, -99.13),
          ("サンパウロ", -23.55, -46.63), ("ブエノスアイレス", -34.6, -58.38), ("リマ", -12.05, -77.04), ("シドニー", -33.87, 151.21),
          ("オークランド", -36.85, 174.76), ("ホノルル", 21.31, -157.86), ("アンカレッジ", 61.22, -149.9), ("ジャカルタ", -6.2, 106.85)]
WMO = {0: ("☀", "快晴"), 1: ("🌤", "晴れ"), 2: ("⛅", "くもり時々晴れ"), 3: ("☁", "くもり"), 45: ("🌫", "霧"), 48: ("🌫", "霧"),
       51: ("🌦", "霧雨"), 53: ("🌦", "霧雨"), 55: ("🌦", "霧雨"), 61: ("🌧", "雨"), 63: ("🌧", "雨"), 65: ("🌧", "大雨"),
       66: ("🌧", "着氷性の雨"), 67: ("🌧", "着氷性の雨"), 71: ("🌨", "雪"), 73: ("🌨", "雪"), 75: ("❄", "大雪"), 77: ("🌨", "霧雪"),
       80: ("🌦", "にわか雨"), 81: ("🌧", "にわか雨"), 82: ("⛈", "激しいにわか雨"), 85: ("🌨", "にわか雪"), 86: ("❄", "にわか雪"),
       95: ("⛈", "雷雨"), 96: ("⛈", "雷雨・ひょう"), 99: ("⛈", "激しい雷雨")}


def weather():
    def fetch():
        q = urllib.parse.urlencode({"latitude": ",".join(str(c[1]) for c in CITIES),
                                    "longitude": ",".join(str(c[2]) for c in CITIES),
                                    "current": "temperature_2m,weather_code,wind_speed_10m,is_day", "timezone": "auto"})
        j = H["get_json"]("https://api.open-meteo.com/v1/forecast?" + q, timeout=20)
        j = j if isinstance(j, list) else [j]
        out = []
        for (name, lat, lon), w in zip(CITIES, j):
            cur = w.get("current", {})
            icon, desc = WMO.get(cur.get("weather_code"), ("🌡", ""))
            out.append({"name": name, "lat": lat, "lon": lon, "temp": cur.get("temperature_2m"), "icon": icon,
                        "desc": desc, "wind": cur.get("wind_speed_10m"), "is_day": cur.get("is_day", 1),
                        "utc_offset": w.get("utc_offset_seconds", 0), "tz": w.get("timezone_abbreviation", "")})
        return {"cities": out}
    return cached("wx", 900, fetch)


# ------------------------------------------------------------------ 7. 朝のブリーフィング
def briefing_loop(refresh_fn, digest_fn, port_ref):
    done = ""
    while True:
        try:
            s = settings()
            now = dt.datetime.now()
            today = now.strftime("%Y-%m-%d")
            if s.get("briefing_enabled") and now.strftime("%H:%M") >= s.get("briefing_time", "07:30") and done != today:
                path = os.path.join(BRIEF_DIR, today + ".json")
                if not os.path.exists(path):
                    run_briefing(refresh_fn, digest_fn, port_ref, open_browser=s.get("briefing_open_browser", True))
                done = today
        except Exception as e:
            H["log"]("ブリーフィング失敗", e)
        time.sleep(30)


def run_briefing(refresh_fn, digest_fn, port_ref, open_browser=True):
    os.makedirs(BRIEF_DIR, exist_ok=True)
    refresh_fn(True)
    d = digest_fn()
    today = dt.datetime.now().strftime("%Y-%m-%d")
    _save(os.path.join(BRIEF_DIR, today + ".json"), d)
    top = [c["items"][0]["title_ja"] for c in d.get("categories", {}).values() if c.get("items")][:3]
    desktop_notify("☀ 今朝の世界ブリーフィング", " / ".join(top)[:250])
    if open_browser:
        import webbrowser
        webbrowser.open(f"http://localhost:{port_ref[0]}/?view=digest&brief=1")
    return d


def briefings_list():
    try:
        return sorted([f[:-5] for f in os.listdir(BRIEF_DIR) if f.endswith(".json")], reverse=True)[:30]
    except Exception:
        return []


def briefing_get(date):
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date or ""):
        return None
    return _j(os.path.join(BRIEF_DIR, date + ".json"), None)


# ------------------------------------------------------------------ 10. YouTubeサムネ
def yt_id(url):
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|live/)([\w-]{11})", url or "")
    return m.group(1) if m else ""


def thumb_bytes(vid):
    if not re.match(r"^[\w-]{11}$", vid or ""):
        return None
    for q in ("maxresdefault", "hqdefault"):
        try:
            raw, _, _ = H["http_get"](f"https://i.ytimg.com/vi/{vid}/{q}.jpg", accept="image/*", timeout=10, max_bytes=3_000_000)
            if len(raw) > 2000:
                return raw
        except Exception:
            continue
    return None


# ------------------------------------------------------------------ 11. 判定履歴・釣りランキング
_hist_lock = threading.Lock()


def history_add(res, inp):
    if res.get("error"):
        return
    site = ""
    if res.get("page"):
        site = res["page"].get("site") or ""
        if site.startswith(("YouTube / ", "X / ")):
            site = site.split(" / ", 1)[1] + (" (YouTube)" if site.startswith("YouTube") else " (X)")
    rec = {"time": time.time(), "input": inp[:300], "title": res.get("title", "")[:200], "title_ja": res.get("title_ja", "")[:200],
           "site": site or "（テキスト入力）", "kind": res.get("input_type"), "score": res.get("score", 0),
           "stars": res.get("stars", 1), "url": (res.get("page") or {}).get("url", "")}
    with _hist_lock:
        h = _j(HISTORY_FILE, [])
        h = [x for x in h if not (x["input"] == rec["input"])]
        h.insert(0, rec)
        _save(HISTORY_FILE, h[:500])


def history():
    h = _j(HISTORY_FILE, [])
    agg = {}
    for x in h:
        if x["site"] == "（テキスト入力）":
            continue
        a = agg.setdefault(x["site"], {"site": x["site"], "count": 0, "total": 0, "max": 0, "worst": ""})
        a["count"] += 1
        a["total"] += x["score"]
        if x["score"] >= a["max"]:
            a["max"], a["worst"] = x["score"], x["title_ja"] or x["title"]
    rank = []
    for a in agg.values():
        a["avg"] = round(a["total"] / a["count"], 1)
        rank.append(a)
    rank.sort(key=lambda a: (-a["avg"], -a["count"]))
    return {"history": h[:100], "ranking": rank[:20], "total": len(h)}


def history_clear():
    with _hist_lock:
        _save(HISTORY_FILE, [])
