# -*- coding: utf-8 -*-
"""世界のリアルタイム情報（飛行機・電車・地震・ISS・紛争ニュース）  ※すべて無料・登録不要"""
import json
import math
import os
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE, "config.json")
DATA = os.path.join(BASE, "data")

_cache = {}
_lock = threading.Lock()


def cached(key, ttl, fn):
    """同じリクエストをttl秒キャッシュ（無料APIに負荷をかけないため）"""
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (now, val)
        if len(_cache) > 300:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:100]:
                _cache.pop(k, None)
    return val


def load_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


# ------------------------------------------------------------------ 飛行機
def planes(get_json, lat, lon, radius_km):
    """地図中心付近の飛行機。adsb.lol → airplanes.live → OpenSky の順に試す"""
    radius_nm = max(20, min(250, int(radius_km / 1.852)))
    la, lo = round(lat, 1), round(lon, 1)
    key = f"pl:{la}:{lo}:{radius_nm // 25}"

    def fetch():
        errors = []
        for name, url in (
            ("adsb.lol", f"https://api.adsb.lol/v2/point/{la}/{lo}/{radius_nm}"),
            ("airplanes.live", f"https://api.airplanes.live/v2/point/{la}/{lo}/{radius_nm}"),
        ):
            try:
                j = get_json(url, timeout=12)
                ac = j.get("ac") or j.get("aircraft") or []
                out = []
                for a in ac:
                    if a.get("lat") is None or a.get("lon") is None:
                        continue
                    alt = a.get("alt_baro")
                    out.append({
                        "id": a.get("hex"), "call": (a.get("flight") or "").strip(),
                        "lat": a["lat"], "lon": a["lon"], "track": a.get("track") or 0,
                        "alt_m": int(alt * 0.3048) if isinstance(alt, (int, float)) else 0,
                        "ground": alt == "ground",
                        "spd_kmh": int((a.get("gs") or 0) * 1.852), "type": a.get("t") or "",
                        "reg": a.get("r") or "", "desc": a.get("desc") or "",
                    })
                return {"source": name, "planes": out, "radius_km": int(radius_nm * 1.852)}
            except Exception as e:
                errors.append(f"{name}: {type(e).__name__}")
        # 最終手段: OpenSky（匿名は1日400クレジットまで）
        try:
            d = radius_km / 111.0
            q = urllib.parse.urlencode({"lamin": lat - d, "lamax": lat + d,
                                        "lomin": lon - d / max(0.2, math.cos(math.radians(lat))),
                                        "lomax": lon + d / max(0.2, math.cos(math.radians(lat)))})
            j = get_json("https://opensky-network.org/api/states/all?" + q, timeout=15)
            out = []
            for s in j.get("states") or []:
                if s[5] is None or s[6] is None:
                    continue
                out.append({"id": s[0], "call": (s[1] or "").strip(), "lat": s[6], "lon": s[5],
                            "track": s[10] or 0, "alt_m": int(s[7] or 0), "ground": bool(s[8]),
                            "spd_kmh": int((s[9] or 0) * 3.6), "type": "", "reg": "", "desc": s[2] or ""})
            return {"source": "OpenSky", "planes": out, "radius_km": int(radius_km)}
        except Exception as e:
            errors.append(f"OpenSky: {type(e).__name__}")
        return {"source": None, "planes": [], "error": " / ".join(errors)}

    return cached(key, 12, fetch)


# ------------------------------------------------------------------ 電車
_odpt_stations = {}


def trains(get_json, http_get):
    def fetch():
        out, status = [], []
        # フィンランド鉄道（Digitraffic: 全列車のGPS位置を無料公開）
        try:
            raw, cs, _ = http_get("https://rata.digitraffic.fi/api/v1/train-locations/latest/",
                                  accept="application/json", headers={"Digitraffic-User": "TrendScope/1.0"},
                                  timeout=15)
            j = json.loads(raw.decode(cs or "utf-8"))
            for t in j:
                c = (t.get("location") or {}).get("coordinates")
                if not c:
                    continue
                out.append({"id": f"fi{t['trainNumber']}", "name": f"VR {t['trainNumber']}列車",
                            "lat": c[1], "lon": c[0], "spd_kmh": t.get("speed", 0),
                            "country": "フィンランド", "op": "VR（フィンランド鉄道）"})
            status.append({"name": "フィンランド鉄道 (Digitraffic)", "ok": True, "count": len(j)})
        except Exception as e:
            status.append({"name": "フィンランド鉄道 (Digitraffic)", "ok": False, "error": type(e).__name__})

        # 日本：公共交通オープンデータ(ODPT)のキーがあれば東京メトロ・都営の列車位置
        key = load_config().get("odpt_key", "").strip()
        if key:
            try:
                out += odpt_trains(get_json, key)
                status.append({"name": "東京の地下鉄 (ODPT)", "ok": True,
                               "count": sum(1 for t in out if t["country"] == "日本")})
            except Exception as e:
                status.append({"name": "東京の地下鉄 (ODPT)", "ok": False, "error": f"{type(e).__name__}: {e}"[:120]})
        else:
            status.append({"name": "日本の列車 (ODPT)", "ok": False,
                           "error": "config.json に無料のODPTキーを設定すると表示されます"})
        return {"trains": out, "status": status}

    return cached("trains", 20, fetch)


ODPT_OPERATORS = ["odpt.Operator:TokyoMetro", "odpt.Operator:Toei"]
ODPT_BASE = "https://api.odpt.org/api/v4/"


def _odpt_station_map(get_json, key):
    if _odpt_stations:
        return _odpt_stations
    path = os.path.join(DATA, "odpt_stations.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            _odpt_stations.update(json.load(f))
            if _odpt_stations:
                return _odpt_stations
    except Exception:
        pass
    for op in ODPT_OPERATORS:
        url = ODPT_BASE + "odpt:Station?" + urllib.parse.urlencode({"odpt:operator": op, "acl:consumerKey": key})
        for s in get_json(url, timeout=30):
            if s.get("geo:lat"):
                _odpt_stations[s["owl:sameAs"]] = [s["geo:lat"], s["geo:long"],
                                                   (s.get("odpt:stationTitle") or {}).get("ja") or s.get("dc:title", "")]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(_odpt_stations, f, ensure_ascii=False)
    return _odpt_stations


def odpt_trains(get_json, key):
    st = _odpt_station_map(get_json, key)
    out = []
    for op in ODPT_OPERATORS:
        url = ODPT_BASE + "odpt:Train?" + urllib.parse.urlencode({"odpt:operator": op, "acl:consumerKey": key})
        for t in get_json(url, timeout=20):
            a, b = st.get(t.get("odpt:fromStation") or ""), st.get(t.get("odpt:toStation") or "")
            if not a:
                continue
            lat, lon = (a[0], a[1]) if not b else ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            line = (t.get("odpt:railway") or "").split(":")[-1].replace(".", " ")
            where = f"{a[2]}→{b[2]} 走行中" if b else f"{a[2]}駅 停車中"
            out.append({"id": t.get("owl:sameAs"), "name": f"{line} {t.get('odpt:trainNumber', '')}",
                        "lat": lat, "lon": lon, "spd_kmh": None, "country": "日本",
                        "op": op.split(":")[-1], "where": where,
                        "delay": int((t.get("odpt:delay") or 0) / 60)})
    return out


# ------------------------------------------------------------------ 地震・ISS
def quakes(get_json):
    def fetch():
        j = get_json("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", timeout=15)
        out = []
        for f in j.get("features", []):
            p, g = f["properties"], f["geometry"]["coordinates"]
            out.append({"id": f["id"], "mag": p.get("mag") or 0, "place": p.get("place") or "",
                        "time": (p.get("time") or 0) / 1000, "lat": g[1], "lon": g[0], "depth": g[2],
                        "url": p.get("url"), "tsunami": p.get("tsunami", 0)})
        out.sort(key=lambda q: -q["mag"])
        return {"quakes": out}
    return cached("quakes", 120, fetch)


def iss(get_json):
    def fetch():
        try:
            j = get_json("https://api.wheretheiss.at/v1/satellites/25544", timeout=8)
            return {"lat": j["latitude"], "lon": j["longitude"], "alt_km": int(j["altitude"]),
                    "spd_kmh": int(j["velocity"])}
        except Exception:
            j = get_json("http://api.open-notify.org/iss-now.json", timeout=8)
            p = j["iss_position"]
            return {"lat": float(p["latitude"]), "lon": float(p["longitude"]), "alt_km": 420, "spd_kmh": 27600}
    return cached("iss", 4, fetch)


# ------------------------------------------------------------------ 紛争地域の最新報道（GDELT：世界中の報道を集計する無料DB）
_gdelt_lock = threading.Lock()
_gdelt_last = [0.0]


def _gdelt(get_json, url):
    """GDELTは「5秒に1回まで」の制限があるので順番待ち＋1回だけ再試行"""
    with _gdelt_lock:
        for attempt in range(2):
            wait = 5.5 - (time.time() - _gdelt_last[0])
            if wait > 0:
                time.sleep(wait)
            _gdelt_last[0] = time.time()
            try:
                return get_json(url, timeout=20)
            except Exception as e:
                if attempt == 1:
                    raise
                time.sleep(1)


OUTLET_COUNTRY = {
    "reuters.com": "英国", "bbc.com": "英国", "bbc.co.uk": "英国", "theguardian.com": "英国", "ft.com": "英国",
    "independent.co.uk": "英国", "telegraph.co.uk": "英国", "economist.com": "英国", "skynews.com": "英国",
    "apnews.com": "米国", "cnn.com": "米国", "nytimes.com": "米国", "washingtonpost.com": "米国", "wsj.com": "米国",
    "npr.org": "米国", "foxnews.com": "米国", "nbcnews.com": "米国", "cbsnews.com": "米国", "abcnews.go.com": "米国",
    "bloomberg.com": "米国", "politico.com": "米国", "axios.com": "米国", "newsweek.com": "米国", "usatoday.com": "米国",
    "aljazeera.com": "カタール", "france24.com": "フランス", "lemonde.fr": "フランス", "dw.com": "ドイツ",
    "euronews.com": "フランス", "kyivindependent.com": "ウクライナ", "ukrinform.net": "ウクライナ",
    "kyivpost.com": "ウクライナ", "pravda.com.ua": "ウクライナ", "tass.com": "ロシア", "rt.com": "ロシア",
    "themoscowtimes.com": "ロシア(在外)", "meduza.io": "ロシア(在外)", "timesofisrael.com": "イスラエル",
    "jpost.com": "イスラエル", "haaretz.com": "イスラエル", "ynetnews.com": "イスラエル", "aa.com.tr": "トルコ",
    "dailysabah.com": "トルコ", "thehindu.com": "インド", "ndtv.com": "インド", "hindustantimes.com": "インド",
    "timesofindia.indiatimes.com": "インド", "dawn.com": "パキスタン", "scmp.com": "香港", "globaltimes.cn": "中国",
    "xinhuanet.com": "中国", "news.cn": "中国", "japantimes.co.jp": "日本", "nhk.or.jp": "日本", "kyodonews.net": "日本",
    "abc.net.au": "オーストラリア", "cbc.ca": "カナダ", "arabnews.com": "サウジアラビア", "thenationalnews.com": "UAE",
    "sudantribune.com": "スーダン", "radiotamazuj.org": "南スーダン", "allafrica.com": "アフリカ各国",
    "news24.com": "南アフリカ", "premiumtimesng.com": "ナイジェリア", "irrawaddy.com": "ミャンマー",
    "bangkokpost.com": "タイ", "khmertimeskh.com": "カンボジア", "un.org": "国連", "reliefweb.int": "国連",
}
TLD_COUNTRY = {"uk": "英国", "jp": "日本", "in": "インド", "au": "オーストラリア", "ca": "カナダ", "de": "ドイツ",
               "fr": "フランス", "ru": "ロシア", "ua": "ウクライナ", "il": "イスラエル", "tr": "トルコ", "pk": "パキスタン",
               "ng": "ナイジェリア", "za": "南アフリカ", "ke": "ケニア", "sg": "シンガポール", "ph": "フィリピン",
               "my": "マレーシア", "th": "タイ", "kr": "韓国", "cn": "中国", "hk": "香港", "tw": "台湾", "ie": "アイルランド",
               "nz": "ニュージーランド", "br": "ブラジル", "mx": "メキシコ", "es": "スペイン", "it": "イタリア", "qa": "カタール",
               "ae": "UAE", "sa": "サウジアラビア", "eg": "エジプト", "lb": "レバノン", "ir": "イラン", "co": "コロンビア"}
GDELT_COUNTRY_JA = {"United States": "米国", "United Kingdom": "英国", "India": "インド", "Australia": "オーストラリア",
                    "Canada": "カナダ", "Israel": "イスラエル", "Ukraine": "ウクライナ", "Russia": "ロシア", "Qatar": "カタール",
                    "Germany": "ドイツ", "France": "フランス", "Pakistan": "パキスタン", "Nigeria": "ナイジェリア",
                    "South Africa": "南アフリカ", "Japan": "日本", "China": "中国", "Turkey": "トルコ", "Kenya": "ケニア"}


def outlet_country(domain):
    d = (domain or "").lower().replace("www.", "")
    for k, v in OUTLET_COUNTRY.items():
        if d == k or d.endswith("." + k):
            return v
    tld = d.rsplit(".", 1)[-1] if "." in d else ""
    return TLD_COUNTRY.get(tld, "")


def _google_news(http_get, query):
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": query + " when:3d", "hl": "en-US", "gl": "US", "ceid": "US:en"})
    raw, _, _ = http_get(url, accept="application/rss+xml, application/xml", timeout=15)
    root = ET.fromstring(raw)
    out = []
    for it in root.findall(".//item")[:15]:
        title = (it.findtext("title") or "").strip()
        src = it.find("source")
        name = (src.text or "").strip() if src is not None else ""
        dom = urllib.parse.urlparse(src.get("url", "")).netloc if src is not None else ""
        if name and title.endswith(" - " + name):
            title = title[: -len(name) - 3]
        out.append({"title": title, "url": it.findtext("link"), "domain": name or dom,
                    "country": outlet_country(dom), "time": it.findtext("pubDate") or ""})
    return out


def conflict_news(get_json, conflict, translate_many, http_get=None):
    """GDELT（世界の報道DB）→ だめなら Google News RSS で直近3日の報道を集める"""
    def fetch():
        out, via, err = [], "", ""
        try:
            q = urllib.parse.urlencode({"query": conflict["query"] + " sourcelang:english", "mode": "artlist",
                                        "maxrecords": 15, "format": "json", "timespan": "3d", "sort": "datedesc"})
            j = _gdelt(get_json, "https://api.gdeltproject.org/api/v2/doc/doc?" + q)
            for a in j.get("articles") or []:
                c = a.get("sourcecountry") or ""
                out.append({"title": (a.get("title") or "").strip(), "url": a.get("url"), "domain": a.get("domain"),
                            "country": GDELT_COUNTRY_JA.get(c, c) or outlet_country(a.get("domain")),
                            "time": a.get("seendate", "")})
            via = "GDELT"
        except Exception as e:
            err = type(e).__name__
        if not out and http_get:
            out = _google_news(http_get, conflict["query"])
            via = "Google News"
        seen, uniq = set(), []
        for o in out:
            k = o["title"].lower()[:60]
            if o["title"] and k not in seen:
                seen.add(k); uniq.append(o)
        uniq = uniq[:10]
        tr = translate_many([o["title"] for o in uniq]) if uniq else {}
        origins = {}
        for o in uniq:
            o["title_ja"] = tr.get(o["title"], o["title"])
            if o["country"]:
                origins[o["country"]] = origins.get(o["country"], 0) + 1
        return {"articles": uniq, "origins": origins, "via": via, "gdelt_error": err}
    return cached("cn:" + conflict["id"], 900, fetch)
