# -*- coding: utf-8 -*-
"""
TrendScope 追加機能 第2弾（すべて無料・キー不要）
 1 国のプロフィール   2 マーケット   3 祝日・今日は何の日   4 ウィキペディア急上昇
 5 報じ方の比較       6 ファクトチェック検索   7 画像の出どころチェック
13 週間レポート      15 PC起動時の自動起動
"""
import datetime as dt
import html
import ipaddress
import json
import os
import re
import socket
import struct
import sys
import time
import urllib.parse

import analyzer as az
import features as ft
import geo
import worldlive as wl

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
H = ft.H  # http_get / get_json / translate_many / translate_one / translate_to / log
cached = ft.cached

# Wikipedia の日本語記事名（国名の略称と違うもの）
WIKI_JA = {"US": "アメリカ合衆国", "GB": "イギリス", "KR": "大韓民国", "KP": "朝鮮民主主義人民共和国", "CN": "中華人民共和国",
           "TW": "台湾", "CD": "コンゴ民主共和国", "AE": "アラブ首長国連邦", "PS": "パレスチナ国", "CZ": "チェコ", "GL": "グリーンランド",
           "AQ": "南極大陸", "NZ": "ニュージーランド", "ZA": "南アフリカ共和国", "SA": "サウジアラビア", "MM": "ミャンマー"}


# ------------------------------------------------------------------ 1. 国のプロフィール
def country_profile(code, news_items):
    code = (code or "").upper()
    if code not in geo.BY_CODE:
        return {"error": "unknown country"}
    base = geo.BY_CODE[code]

    def fetch():
        out = {"code": code, "ja": base["ja"], "lat": base["lat"], "lon": base["lon"]}
        try:
            j = H["get_json"](f"https://restcountries.com/v3.1/alpha/{code}?fields=name,capital,capitalInfo,population,"
                              "area,currencies,languages,subregion,flags,translations", timeout=15)  # fieldsは最大10個
            j = j[0] if isinstance(j, list) else j
            out.update({
                "name_en": j["name"]["common"], "official_ja": (j.get("translations", {}).get("jpn") or {}).get("official", ""),
                "capital": (j.get("capital") or [""])[0], "capital_ll": (j.get("capitalInfo") or {}).get("latlng"),
                "population": j.get("population"), "area": j.get("area"), "region": j.get("subregion", ""),
                "currencies": [f"{v.get('name')} ({v.get('symbol', '')}, {k})" for k, v in (j.get("currencies") or {}).items()],
                "languages": list((j.get("languages") or {}).values()), "flag": (j.get("flags") or {}).get("svg", ""),
            })
        except Exception as e:
            out["rc_error"] = type(e).__name__
        if out.get("rc_error"):
            try:
                out.update(_wikidata_country(code))
                out.pop("rc_error", None)
            except Exception as e:
                out["wd_error"] = type(e).__name__
        try:
            title = WIKI_JA.get(code, base["ja"])
            w = H["get_json"]("https://ja.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title), timeout=12)
            out["wiki"] = {"extract": w.get("extract", "")[:600], "url": (w.get("content_urls") or {}).get("desktop", {}).get("page", "")}
        except Exception as e:
            out["wiki_error"] = type(e).__name__
        ll = out.get("capital_ll") or [base["lat"], base["lon"]]
        try:
            w = H["get_json"]("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(
                {"latitude": ll[0], "longitude": ll[1], "current": "temperature_2m,weather_code,is_day", "timezone": "auto"}), timeout=12)
            icon, desc = ft.WMO.get(w["current"].get("weather_code"), ("🌡", ""))
            out["weather"] = {"temp": w["current"].get("temperature_2m"), "icon": icon, "desc": desc,
                              "utc_offset": w.get("utc_offset_seconds", 0), "tz": w.get("timezone", "")}
        except Exception:
            pass
        for cur in out.get("currencies") or []:  # 円レートが取れる通貨を探す
            m = re.search(r"\b([A-Z]{3})\)$", cur)
            if not m or m.group(1) == "JPY":
                continue
            try:
                r = H["get_json"](f"https://api.frankfurter.app/latest?from={m.group(1)}&to=JPY", timeout=10)
                out["jpy_rate"] = {"cur": m.group(1), "jpy": r["rates"]["JPY"], "date": r["date"]}
                break
            except Exception:
                continue
        return out

    prof = dict(cached("cty:" + code, 3600, fetch, ok=lambda v: "rc_error" not in v))
    prof["news"] = [{k: it.get(k) for k in ("id", "title_ja", "url", "source", "time")}
                    for it in news_items if code in (it.get("geo") or [])][:8]
    prof["conflicts"] = [c["name"] for c in geo.CONFLICTS if base["ja"] in "".join(c["parties"]) or
                         abs(c["lat"] - base["lat"]) + abs(c["lon"] - base["lon"]) < 6][:3]
    return prof


def _wikidata_country(code):
    q = """SELECT ?cLabel ?pop ?area ?capLabel ?capCoord ?curLabel ?curCode ?langLabel ?subLabel WHERE {
      ?c wdt:P297 "%s". OPTIONAL{?c wdt:P1082 ?pop} OPTIONAL{?c wdt:P2046 ?area}
      OPTIONAL{?c wdt:P36 ?cap. OPTIONAL{?cap wdt:P625 ?capCoord}} OPTIONAL{?c wdt:P38 ?cur. OPTIONAL{?cur wdt:P498 ?curCode}}
      OPTIONAL{?c wdt:P37 ?lang} OPTIONAL{?c wdt:P361 ?sub}
      SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". } } LIMIT 80""" % code
    j = H["get_json"]("https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q, "format": "json"}), timeout=20)
    rows = j["results"]["bindings"]
    if not rows:
        raise ValueError("no data")
    v = lambda r, k: r.get(k, {}).get("value")
    pops = [float(v(r, "pop")) for r in rows if v(r, "pop")]
    areas = [float(v(r, "area")) for r in rows if v(r, "area")]
    caps = list(dict.fromkeys(v(r, "capLabel") for r in rows if v(r, "capLabel")))
    coord = next((v(r, "capCoord") for r in rows if v(r, "capCoord")), "")
    m = re.match(r"Point\(([-\d.]+) ([-\d.]+)\)", coord or "")
    curs = list(dict.fromkeys(f"{v(r, 'curLabel')} ({v(r, 'curCode')})" if v(r, "curCode") else v(r, "curLabel")
                              for r in rows if v(r, "curLabel")))
    langs = list(dict.fromkeys(v(r, "langLabel") for r in rows if v(r, "langLabel")))
    return {"official_ja": v(rows[0], "cLabel") or "", "capital": caps[0] if caps else "",
            "capital_ll": [float(m.group(2)), float(m.group(1))] if m else None,
            "population": int(max(pops)) if pops else None, "area": max(areas) if areas else None,
            "currencies": curs[:2], "languages": langs[:5],
            "flag": f"https://flagcdn.com/w160/{code.lower()}.png", "source": "Wikidata"}


# ------------------------------------------------------------------ 2. マーケット
MARKETS = [("^N225", "日経平均", ""), ("^GSPC", "S&P500", ""), ("^DJI", "NYダウ", ""), ("JPY=X", "ドル/円", "円"),
           ("EURJPY=X", "ユーロ/円", "円"), ("CL=F", "原油(WTI)", "$"), ("GC=F", "金", "$"), ("BTC-USD", "ビットコイン", "$")]


def markets():
    def fetch():
        out = []
        for sym, name, unit in MARKETS:
            row = {"sym": sym, "name": name, "unit": unit}
            try:
                j = H["get_json"]("https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(sym) +
                                  "?range=1mo&interval=1d", timeout=12)
                r = j["chart"]["result"][0]
                closes = [c for c in r["indicators"]["quote"][0]["close"] if c is not None]
                meta = r["meta"]
                price = meta.get("regularMarketPrice") or closes[-1]
                prev = meta.get("chartPreviousClose") if len(closes) < 2 else closes[-2]
                row.update(price=price, change=price - prev, pct=(price - prev) / prev * 100 if prev else 0,
                           spark=[round(c, 4) for c in closes[-22:]], time=meta.get("regularMarketTime"))
            except Exception as e:
                row["error"] = type(e).__name__
            out.append(row)
        # 為替は欧州中央銀行の参考レートで補完
        if any(r.get("error") for r in out if r["sym"] in ("JPY=X", "EURJPY=X")):
            try:
                f = H["get_json"]("https://api.frankfurter.app/latest?from=USD&to=JPY,EUR", timeout=10)
                for r in out:
                    if r["sym"] == "JPY=X" and r.get("error"):
                        r.update(price=f["rates"]["JPY"], change=0, pct=0, spark=[], note="ECB参考レート", error=None)
                    if r["sym"] == "EURJPY=X" and r.get("error"):
                        r.update(price=f["rates"]["JPY"] / f["rates"]["EUR"], change=0, pct=0, spark=[], note="ECB参考レート", error=None)
            except Exception:
                pass
        return {"markets": out, "updated": time.time(),
                "note": "Yahoo!ファイナンスの公開データ（遅延あり）。投資判断には使わないでください"}
    return cached("mkt", 300, fetch, ok=lambda v: any(m.get("price") is not None for m in v["markets"]))


# ------------------------------------------------------------------ 3. 祝日・今日は何の日
def holidays():
    def fetch():
        out = {"today": [], "upcoming": []}
        try:
            j = H["get_json"]("https://date.nager.at/api/v3/NextPublicHolidaysWorldwide", timeout=15)
            today = dt.date.today().isoformat()
            names = H["translate_many"]([x["name"] for x in j][:120])
            for x in j:
                c = geo.BY_CODE.get(x["countryCode"])
                row = {"date": x["date"], "code": x["countryCode"], "country": c["ja"] if c else x["countryCode"],
                       "name": names.get(x["name"], x["localName"]), "local": x.get("localName", ""),
                       "lat": c["lat"] if c else None, "lon": c["lon"] if c else None}
                (out["today"] if x["date"] == today else out["upcoming"]).append(row)
        except Exception as e:
            out["error"] = type(e).__name__
        try:
            now = dt.datetime.now()
            j = H["get_json"](f"https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/{now.month:02d}/{now.day:02d}", timeout=15)
            ev = (j.get("selected") or [])[:12]
            tr = H["translate_many"]([e.get("text", "") for e in ev])
            out["onthisday"] = [{"year": e.get("year"), "text": tr.get(e.get("text", ""), e.get("text", "")),
                                 "url": ((e.get("pages") or [{}])[0].get("content_urls") or {}).get("desktop", {}).get("page", "")}
                                for e in ev]
        except Exception as e:
            out["onthisday"] = []
            out["otd_error"] = type(e).__name__
        return out
    return cached("hol", 3600, fetch, ok=lambda v: "error" not in v)


# ------------------------------------------------------------------ 4. ウィキペディア急上昇
def wiki_trending():
    def fetch():
        out = {}
        d = dt.datetime.utcnow() - dt.timedelta(hours=6)
        for lang in ("ja", "en"):
            try:
                j = H["get_json"](f"https://{lang}.wikipedia.org/api/rest_v1/feed/featured/{d:%Y/%m/%d}", timeout=20)
                arts = (j.get("mostread") or {}).get("articles", [])
                rows = [{"title": a.get("normalizedtitle") or a.get("title", "").replace("_", " "), "views": a.get("views", 0),
                         "desc": a.get("description", ""), "extract": (a.get("extract") or "")[:240],
                         "thumb": (a.get("thumbnail") or {}).get("source", ""),
                         "url": (a.get("content_urls") or {}).get("desktop", {}).get("page", ""),
                         "trend": [v.get("views", 0) for v in (a.get("view_history") or [])][-5:]}
                        for a in arts[:25]]
                if lang == "en":
                    tr = H["translate_many"]([r["title"] for r in rows] + [r["extract"] for r in rows if r["extract"]])
                    for r in rows:
                        r["title_ja"] = tr.get(r["title"], r["title"])
                        r["extract_ja"] = tr.get(r["extract"], r["extract"])
                out[lang] = rows
            except Exception as e:
                out[lang] = []
                out[lang + "_error"] = type(e).__name__
        out["date"] = d.strftime("%Y-%m-%d")
        return out
    return cached("wiki", 1800, fetch, ok=lambda v: bool(v.get("ja") or v.get("en")))


# ------------------------------------------------------------------ 5. 報じ方の比較
LOADED = {  # 立場で言い方が変わりやすい語
    "invasion": "侵攻", "special military operation": "特別軍事作戦", "terrorist": "テロリスト", "terror": "テロ",
    "militant": "武装勢力", "militants": "武装勢力", "fighters": "戦闘員", "rebels": "反政府勢力", "insurgents": "反乱勢力",
    "regime": "体制（否定的）", "junta": "軍事政権", "occupation": "占領", "occupied": "占領下の", "liberation": "解放",
    "liberated": "解放した", "annexation": "併合", "massacre": "虐殺", "genocide": "ジェノサイド", "clashes": "衝突",
    "war crimes": "戦争犯罪", "martyr": "殉教者", "aggression": "侵略", "provocation": "挑発", "crackdown": "弾圧",
    "riots": "暴動", "protesters": "抗議者", "slams": "非難（強）", "condemns": "非難", "vows": "誓う", "claims": "と主張",
    "alleged": "とされる", "so-called": "いわゆる", "propaganda": "プロパガンダ", "hostages": "人質", "prisoners": "囚人",
}


def _key_query(title):
    terms = [t for t in az.key_terms(title) if not t.isdigit()]
    caps = [w for w in re.findall(r"\b[A-Z][a-zA-Z\-]{2,}\b", title) if w.lower() not in az.EN_STOP]
    seen, pick = set(), []
    for w in caps + terms:
        if w.lower() not in seen:
            seen.add(w.lower()); pick.append(w)
    pick = pick[:5]
    return " ".join(pick) or title[:80]


def framing(title_en, title_ja=""):
    q = _key_query(title_en)
    key = "frm:" + q

    def fetch():
        arts, seen_outlet = [], set()
        try:
            for a in ft.gnews(q, "en", days=4, limit=60):
                o = a["source"] or "?"
                if o in seen_outlet:
                    continue
                seen_outlet.add(o)
                arts.append({**a, "lang": "en"})
        except Exception as e:
            H["log"]("報じ方比較 英語検索失敗", type(e).__name__)
        if title_ja:
            jq = " ".join(re.findall(r"[゠-ヿ]{2,}|[一-鿿]{2,}", title_ja)[:4])
            if jq:
                try:
                    for a in ft.gnews(jq, "ja", days=4, limit=20)[:6]:
                        if a["source"] not in seen_outlet:
                            seen_outlet.add(a["source"])
                            arts.append({**a, "lang": "ja"})
                except Exception:
                    pass
        arts = arts[:16]
        tr = H["translate_many"]([a["title"] for a in arts if a["lang"] == "en"])
        rows = []
        for a in arts:
            low = a["title"].lower()
            words = [f"{w}（{j}）" for w, j in LOADED.items() if re.search(r"\b" + re.escape(w) + r"\b", low)]
            sc = az.score_text(a["title"])
            dom = urllib.parse.urlparse(a.get("source_url") or "").netloc
            rows.append({"outlet": a["source"], "country": wl.outlet_country(dom) or ("日本" if a["lang"] == "ja" else ""),
                         "title": a["title"], "title_ja": tr.get(a["title"], a["title"]) if a["lang"] == "en" else a["title"],
                         "url": a["url"], "loaded": words, "bait": sc["score"], "lang": a["lang"], "time": a["time"]})
        allw = {}
        for r in rows:
            for w in r["loaded"]:
                allw[w] = allw.get(w, 0) + 1
        return {"query": q, "rows": rows, "loaded_summary": sorted(allw.items(), key=lambda x: -x[1])[:10],
                "note": "同じ出来事を報じた各メディアの見出しを並べています。赤字は立場によって選ばれやすい言葉です"}
    return cached(key, 900, fetch, ok=lambda v: bool(v["rows"]))


# ------------------------------------------------------------------ 6. ファクトチェック検索
FC_SITES_JA = ["factcheckcenter.jp", "infact.press", "fij.info", "litera.jp"]
FC_SITES_EN = ["snopes.com", "factcheck.org", "politifact.com", "fullfact.org", "reuters.com/fact-check",
               "apnews.com/ap-fact-check", "factcheck.afp.com", "leadstories.com", "checkyourfact.com"]


def factcheck(text):
    text = (text or "").strip()[:200]
    if not text:
        return {"error": "検索する文を入れてください"}

    def fetch():
        ja_text = text if az._is_ja(text) else H["translate_one"](text)
        en_text = text if not az._is_ja(text) else H["translate_to"](text, "en")
        ja_list = [w for w in re.findall(r"[\u30a0-\u30ffー]{2,}|[\u4e00-\u9fff]{2,}|[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*", ja_text) if len(w) >= 2][:5]
        ja_terms = " ".join(ja_list) or ja_text[:40]
        en_terms = _key_query(en_text)
        res = []
        for lang, terms, sites in (("ja", ja_terms, FC_SITES_JA), ("en", en_terms, FC_SITES_EN)):
            q = f"{terms} (" + " OR ".join("site:" + s for s in sites) + ")"
            try:
                for a in ft.gnews(q, lang, days=365, limit=15):
                    res.append({**a, "lang": lang})
            except Exception as e:
                H["log"]("ファクトチェック検索失敗", lang, type(e).__name__)
        en_list = [w.lower() for w in en_terms.split() if len(w) >= 3]
        def relevant(r):  # 検索語を見出しに含むものだけ残す（サイトのお知らせ等を除外）
            t = r["title"].lower()
            words = [w.lower() for w in ja_list] if r["lang"] == "ja" else en_list
            hit = sum(1 for w in words if w in t)
            return hit >= (1 if len(words) <= 2 else 2)
        res = [r for r in res if relevant(r)]
        tr = H["translate_many"]([r["title"] for r in res if r["lang"] == "en"])
        for r in res:
            r["title_ja"] = tr.get(r["title"], r["title"]) if r["lang"] == "en" else r["title"]
            low = r["title"].lower()
            r["verdict"] = ("誤り" if re.search(r"\bfalse\b|誤り|虚偽|デマ|fake|incorrect|misleading|根拠なし|不正確", low)
                            else "正確" if re.search(r"\btrue\b|正確|事実", low) else "")
        return {"query_ja": ja_terms, "query_en": en_terms, "results": res[:20],
                "note": "国内外のファクトチェック団体の検証記事を探しています。見つからない＝正しい、ではありません"}
    return cached("fc:" + text, 3600, fetch, ok=lambda v: bool(v["results"]))


# ------------------------------------------------------------------ 7. 画像の出どころチェック
def _public_url(url):
    p = urllib.parse.urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        return False
    try:
        for info in socket.getaddrinfo(p.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
    except Exception:
        return False
    return True


def _exif(raw):
    out = {}
    i = raw.find(b"Exif\x00\x00")
    if i < 0:
        return out
    t = raw[i + 6:i + 6 + 200000]
    if len(t) < 8:
        return out
    en = "<" if t[:2] == b"II" else ">"

    def ifd(off):
        tags = {}
        try:
            n = struct.unpack(en + "H", t[off:off + 2])[0]
            for k in range(min(n, 200)):
                e = t[off + 2 + k * 12: off + 14 + k * 12]
                tag, typ, cnt = struct.unpack(en + "HHI", e[:8])
                val = e[8:12]
                if typ == 2:  # ASCII
                    vo = struct.unpack(en + "I", val)[0] if cnt > 4 else None
                    s = (t[vo:vo + cnt] if vo is not None else val[:cnt]).split(b"\x00")[0]
                    tags[tag] = s.decode("utf-8", "replace").strip()
                elif typ == 4:
                    tags[tag] = struct.unpack(en + "I", val)[0]
                elif typ == 3:
                    tags[tag] = struct.unpack(en + "H", val[:2])[0]
        except Exception:
            pass
        return tags
    first = struct.unpack(en + "I", t[4:8])[0]
    t0 = ifd(first)
    names = {0x010F: "メーカー", 0x0110: "機種", 0x0131: "編集ソフト", 0x0132: "更新日時", 0x013B: "作者", 0x8298: "著作権"}
    for k, n in names.items():
        if t0.get(k):
            out[n] = t0[k]
    if 0x8769 in t0:
        ex = ifd(t0[0x8769])
        if ex.get(0x9003):
            out["撮影日時"] = ex[0x9003]
    if 0x8825 in t0:
        out["位置情報(GPS)"] = "あり（撮影場所が記録されています）"
    return out


def _dims(raw):
    try:
        if raw[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", raw[16:24])
        if raw[:6] in (b"GIF87a", b"GIF89a"):
            return struct.unpack("<HH", raw[6:10])
        if raw[:2] == b"\xff\xd8":
            i = 2
            while i < len(raw) - 9:
                if raw[i] != 0xFF:
                    i += 1; continue
                m = raw[i + 1]
                if m in (0xC0, 0xC1, 0xC2):
                    h_, w_ = struct.unpack(">HH", raw[i + 5:i + 9])
                    return w_, h_
                i += 2 + struct.unpack(">H", raw[i + 2:i + 4])[0]
        if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" and raw[12:16] == b"VP8X":
            return 1 + int.from_bytes(raw[24:27], "little"), 1 + int.from_bytes(raw[27:30], "little")
    except Exception:
        pass
    return None


def image_fetch(url):
    if not _public_url(url):
        return None, None
    try:
        raw, _, final = H["http_get"](url, accept="image/*", timeout=15, max_bytes=10_000_000)
    except Exception:
        raw, _, final = H["http_get"](url, accept="image/*", timeout=15, max_bytes=10_000_000,
                                      ua="TrendScope/1.0 (image origin checker)")
    return raw, final


def image_check(url):
    if not _public_url(url):
        return {"error": "このURLは確認できません（http/httpsの公開URLを入れてください）"}
    try:
        raw, final = image_fetch(url)
    except Exception as e:
        return {"error": f"画像を取得できませんでした（{type(e).__name__}）"}
    kind = ("JPEG" if raw[:2] == b"\xff\xd8" else "PNG" if raw[:4] == b"\x89PNG" else "GIF" if raw[:3] == b"GIF"
            else "WebP" if raw[8:12] == b"WEBP" else "")
    if not kind:
        return {"error": "画像ファイルではないようです。画像そのもののURL（右クリック→画像アドレスをコピー）を貼ってください"}
    q = urllib.parse.quote(url, safe="")
    ex = _exif(raw) if kind == "JPEG" else {}
    hints = []
    if not ex:
        hints.append("撮影情報(EXIF)がありません。SNSに投稿された画像は通常消されるので珍しくありません")
    if ex.get("編集ソフト"):
        hints.append(f"編集ソフト「{ex['編集ソフト']}」の記録があります（加工・保存し直された可能性）")
    if ex.get("撮影日時"):
        hints.append(f"撮影日時は {ex['撮影日時']}。話題の出来事の日付と合っているか確認しましょう")
    dims = _dims(raw)
    if dims and max(dims) < 500:
        hints.append("解像度が低めです。何度も転載・圧縮された画像の可能性があります")
    return {"ok": True, "url": final, "format": kind, "bytes": len(raw), "size": dims, "exif": ex, "hints": hints,
            "search": [
                {"name": "Google レンズ", "url": f"https://lens.google.com/uploadbyurl?url={q}"},
                {"name": "Bing ビジュアル検索", "url": f"https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:{q}"},
                {"name": "TinEye（最初に出た日を探すのに強い）", "url": f"https://tineye.com/search?url={q}"},
                {"name": "Yandex 画像検索", "url": f"https://yandex.com/images/search?rpt=imageview&url={q}"},
            ]}


# ------------------------------------------------------------------ 13. 週間レポート（ブラウザでPDF保存）
def weekly_report(history_fn):
    dates = ft.briefings_list()[:7]
    days = [(d, ft.briefing_get(d) or {}) for d in sorted(dates)]
    countries, keywords, picks, conflicts = {}, {}, [], {}
    for d, b in days:
        for c in b.get("top_countries", []):
            countries[c["ja"]] = countries.get(c["ja"], 0) + c["count"]
        for k in b.get("keywords", []):
            keywords[k["ja"]] = keywords.get(k["ja"], 0) + k["count"]
        for c in b.get("conflicts_in_news", []):
            conflicts[c["name"]] = conflicts.get(c["name"], 0) + c["count"]
        for cat in (b.get("categories") or {}).values():
            if cat.get("items"):
                picks.append((d, cat["label"], cat["items"][0]))
    hist = history_fn()
    esc = html.escape
    top_c = sorted(countries.items(), key=lambda x: -x[1])[:10]
    mx = max([v for _, v in top_c] or [1])
    rows_c = "".join(f'<tr><td>{esc(k)}</td><td><div class="b" style="width:{v/mx*100:.0f}%"></div></td><td>{v}</td></tr>' for k, v in top_c)
    kw = " ".join(f'<span class="chip">{esc(k)} {v}</span>' for k, v in sorted(keywords.items(), key=lambda x: -x[1])[:20])
    cf = "".join(f"<li>{esc(k)}（{v}件）</li>" for k, v in sorted(conflicts.items(), key=lambda x: -x[1])[:8])
    pk = "".join(f'<li><b>{esc(d[5:])}</b> [{esc(l)}] {esc(i.get("title_ja", ""))} <span class="s">— {esc(i.get("source", ""))}</span></li>' for d, l, i in picks[-24:])
    rk = "".join(f"<tr><td>{esc(r['site'])}</td><td>{r['avg']}</td><td>{r['count']}</td></tr>" for r in hist["ranking"][:10])
    period = f"{days[0][0]} 〜 {days[-1][0]}" if days else "（ブリーフィングがまだありません）"
    body = f"""<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>TrendScope 週間レポート {period}</title>
<style>body{{font-family:"Yu Gothic UI","Hiragino Sans",sans-serif;max-width:860px;margin:30px auto;color:#1a1d24;padding:0 20px;line-height:1.7}}
h1{{font-size:24px;margin:0}}h2{{font-size:17px;border-left:5px solid #3b7ddd;padding-left:8px;margin-top:28px}}
.s{{color:#777;font-size:12px}}table{{border-collapse:collapse;width:100%;font-size:14px}}td,th{{padding:5px 8px;border-bottom:1px solid #e3e6ec;text-align:left}}
.b{{height:10px;background:linear-gradient(90deg,#3b7ddd,#3fc1a5);border-radius:5px}}.chip{{display:inline-block;border:1px solid #cdd3dd;border-radius:999px;padding:1px 10px;margin:3px;font-size:13px}}
li{{margin:4px 0}}.bar{{position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:1px solid #eee;display:flex;gap:8px}}
button{{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid #3b7ddd;background:#3b7ddd;color:#fff;cursor:pointer}}
@media print{{.bar{{display:none}}body{{margin:0}}}}</style></head><body>
<div class="bar"><button onclick="print()">🖨 PDFで保存（印刷→「PDFに保存」）</button><button onclick="location.href='/'" style="background:#fff;color:#3b7ddd">← TrendScopeに戻る</button></div>
<h1>🌍 TrendScope 週間レポート</h1><div class="s">{period} ・ ブリーフィング{len(days)}日分から自動作成 ・ 作成 {time.strftime('%Y-%m-%d %H:%M')}</div>
<h2>📍 今週よく話題になった国</h2><table>{rows_c or '<tr><td>データなし</td></tr>'}</table>
<h2>🔑 今週のキーワード</h2><div>{kw or 'データなし'}</div>
<h2>⚔ 紛争関連の報道</h2><ul>{cf or '<li>データなし</li>'}</ul>
<h2>📰 毎日のピックアップ</h2><ul>{pk or '<li>データなし（⚙設定で朝のブリーフィングをオンにすると毎日たまります）</li>'}</ul>
<h2>🧊 判定した見出しの釣りランキング</h2><table><tr><th>サイト/チャンネル</th><th>平均釣り度</th><th>判定数</th></tr>{rk or '<tr><td colspan=3>データなし</td></tr>'}</table>
<p class="s">TrendScope — 無料データ（各ニュースサイトRSS・Googleニュース・Wikimedia等）から自動生成。内容は各元記事でご確認ください。</p></body></html>"""
    os.makedirs(os.path.join(DATA, "reports"), exist_ok=True)
    with open(os.path.join(DATA, "reports", f"weekly_{time.strftime('%Y%m%d')}.html"), "w", encoding="utf-8") as f:
        f.write(body)
    return body


# ------------------------------------------------------------------ 15. PC起動時に自動起動（Windows）
def _startup_path():
    return os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup", "TrendScope.vbs")


def autostart_get():
    return {"supported": sys.platform == "win32", "enabled": sys.platform == "win32" and os.path.exists(_startup_path())}


def autostart_set(on):
    if sys.platform != "win32":
        return {"supported": False, "enabled": False}
    p = _startup_path()
    if on:
        pyw = os.path.join(BASE, ".venv", "Scripts", "pythonw.exe")
        if not os.path.exists(pyw):
            pyw = sys.executable.replace("python.exe", "pythonw.exe")
        srv = os.path.join(BASE, "server.py")
        vbs = (f'Set sh = CreateObject("WScript.Shell")\r\nsh.CurrentDirectory = "{BASE}"\r\n'
               f'sh.Run """{pyw}"" ""{srv}"" --tray --no-browser", 0, False\r\n')
        with open(p, "w", encoding="utf-16") as f:
            f.write(vbs)
    elif os.path.exists(p):
        os.remove(p)
    return autostart_get()
