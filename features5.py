# -*- coding: utf-8 -*-
"""
TrendScope 追加機能 第5弾：事故・通行止め（無料・キー不要）
 - ドイツの高速道路（Autobahn GmbH 公式オープンAPI）：事故・大きな渋滞・通行止め。解除予定時刻つき
 - 日本：Googleニュースの「通行止め・事故」報道を都道府県の位置に表示（公式の規制データは無料公開されていないため）
"""
import datetime as dt
import hashlib
import json
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

import features as ft

H = ft.H
AB = "https://verkehr.autobahn.de/o/autobahn/"
UA = "TrendScope/1.0 (+https://github.com/akkunn20131023-ship-it/trendscope)"


def _berlin_offset(y, mo, d, hh):
    """ドイツの時差（夏時間：3月最終日曜〜10月最終日曜は+2、それ以外+1）"""
    def last_sunday(month):
        x = dt.date(y, month, 31)
        return x - dt.timedelta(days=(x.weekday() + 1) % 7)
    day = dt.date(y, mo, d)
    s, e = last_sunday(3), last_sunday(10)
    summer = (s < day < e) or (day == s and hh >= 3) or (day == e and hh < 3)
    return 2 if summer else 1


def _de_time(dd, mm, yy, hh, mi):
    y = 2000 + int(yy)
    off = _berlin_offset(y, int(mm), int(dd), int(hh))
    t = dt.datetime(y, int(mm), int(dd), int(hh), int(mi), tzinfo=dt.timezone.utc) - dt.timedelta(hours=off)
    return int(t.timestamp())


RANGE = re.compile(r"(\d{2})\.(\d{2})\.(\d{2})\s+(?:um\s+)?(\d{1,2}):(\d{2}).{0,20}?bis\s+(?:zum\s+)?(\d{2})\.(\d{2})\.(\d{2})\s+(?:um\s+)?(\d{1,2}):(\d{2})")
WORDS = [("Vollsperrung", "全面通行止め"), ("gesperrt", "通行止め"), ("Unfall", "事故"), ("Bergungsarbeiten", "事故車の撤去作業"),
         ("Fahrstreifen", "車線規制"), ("Stau", "渋滞"), ("Stillstand", "停止"), ("Baustelle", "工事"),
         ("Fahrbahninstandsetzung", "路面補修"), ("Brückenarbeiten", "橋の工事"), ("Gefahr", "危険"),
         ("Glätte", "路面凍結"), ("Schnee", "雪"), ("Nebel", "霧"), ("Personen auf der Fahrbahn", "道路上に人"),
         ("Gegenstände auf der Fahrbahn", "道路上に落下物"), ("liegengebliebenes Fahrzeug", "故障車"), ("Falschfahrer", "逆走車")]


def _ja_tags(text):
    tags = []
    for de, ja in WORDS:
        if de.lower() in text.lower() and ja not in tags:
            tags.append(ja)
    if "通行止め" in tags and ("全面通行止め" in tags or "車線規制" in tags):
        tags.remove("通行止め")  # 「車線が閉鎖」は通行止めではない
    return tags[:5]


def _line(geom, n=24):
    pts = (geom or {}).get("coordinates") or []
    if not pts or not isinstance(pts[0], list):
        return []
    step = max(1, len(pts) // n)
    out = [[round(p[1], 5), round(p[0], 5)] for p in pts[::step]]
    last = [round(pts[-1][1], 5), round(pts[-1][0], 5)]
    if out[-1] != last:
        out.append(last)
    return out


def _de_item(x, kind_hint):
    desc = "\n".join(x.get("description") or [])
    c = x.get("coordinate") or {}
    try:
        lat, lon = float(c.get("lat")), float(c.get("long"))
    except (TypeError, ValueError):
        return None
    start = end = None
    m = RANGE.search(desc)
    if m:
        g = m.groups()
        start, end = _de_time(*g[0:5]), _de_time(*g[5:10])
    if x.get("startTimestamp"):
        try:
            start = int(dt.datetime.fromisoformat(x["startTimestamp"].replace("Z", "+00:00")).timestamp())
        except ValueError:
            pass
    tags = _ja_tags(desc + " " + x.get("title", ""))
    accident = "事故" in tags or "Unfall" in desc
    blocked = str(x.get("isBlocked")) == "true" or "全面通行止め" in tags
    if kind_hint == "closure":
        kind = "closure"
    elif accident:
        kind = "accident"
    elif blocked:
        kind = "closure"
    else:
        kind = "jam"
    delay = int(x["delayTimeValue"]) if str(x.get("delayTimeValue", "")).isdigit() else None
    speed = int(x["averageSpeed"]) if str(x.get("averageSpeed", "")).isdigit() else None
    title = x.get("title", "")
    road, _, section = title.partition("|")
    return {"id": x.get("identifier", "")[:80], "kind": kind, "country": "DE", "lat": round(lat, 5), "lon": round(lon, 5),
            "road": road.strip(), "section": section.strip(), "dir": (x.get("subtitle") or "").strip(),
            "start": start, "end": end, "delay": delay, "speed": speed, "blocked": blocked, "tags": tags,
            "line": _line(x.get("geometry")), "src": "Autobahn GmbH"}


def _fetch_road(road):
    out = []
    for svc, hint in (("warning", "warning"), ("closure", "closure")):
        try:
            j = H["get_json"](AB + urllib.parse.quote(road) + "/services/" + svc, timeout=15)
        except Exception:
            continue
        for x in j.get(svc, []) or []:
            if x.get("future") is True:
                continue
            it = _de_item(x, hint)
            if not it:
                continue
            now = time.time()
            if it["end"] and it["end"] < now:
                continue
            if hint == "closure":
                # 工事の車線規制は件数が多いので、全面通行止め（またはまもなく解除されるもの）だけ
                if not (it["blocked"] or (it["end"] and it["end"] - now < 6 * 3600)):
                    continue
            elif it["kind"] == "jam" and (it["delay"] or 0) < 15:
                continue
            out.append(it)
    return out


def germany():
    def fetch():
        roads = (H["get_json"](AB, timeout=15) or {}).get("roads", [])
        roads = [r.strip() for r in roads if re.match(r"^A\s?\d+$", r.strip())][:130]
        items = []
        with ThreadPoolExecutor(max_workers=6) as ex:
            for lst in ex.map(_fetch_road, roads):
                items.extend(lst)
        seen, uniq = set(), []
        for it in items:
            if it["id"] in seen:
                continue
            seen.add(it["id"])
            uniq.append(it)
        order = {"accident": 0, "closure": 1, "jam": 2}
        uniq.sort(key=lambda i: (order[i["kind"]], -(i["delay"] or 0)))
        return uniq[:260]
    return ft.cached("traffic_de", 900, fetch, ok=lambda v: len(v) > 0)


# ---------------------------------------------------------------- 日本：報道ベース
PREF = {"北海道": (43.06, 141.35), "青森": (40.82, 140.74), "岩手": (39.70, 141.15), "宮城": (38.27, 140.87), "秋田": (39.72, 140.10),
        "山形": (38.24, 140.36), "福島": (37.75, 140.47), "茨城": (36.34, 140.45), "栃木": (36.57, 139.88), "群馬": (36.39, 139.06),
        "埼玉": (35.86, 139.65), "千葉": (35.61, 140.12), "東京": (35.69, 139.69), "神奈川": (35.45, 139.64), "新潟": (37.90, 139.02),
        "富山": (36.70, 137.21), "石川": (36.59, 136.63), "福井": (36.07, 136.22), "山梨": (35.66, 138.57), "長野": (36.65, 138.18),
        "岐阜": (35.39, 136.72), "静岡": (34.98, 138.38), "愛知": (35.18, 136.91), "三重": (34.73, 136.51), "滋賀": (35.00, 135.87),
        "京都": (35.02, 135.76), "大阪": (34.69, 135.52), "兵庫": (34.69, 135.18), "奈良": (34.69, 135.83), "和歌山": (34.23, 135.17),
        "鳥取": (35.50, 134.24), "島根": (35.47, 133.05), "岡山": (34.66, 133.93), "広島": (34.40, 132.46), "山口": (34.19, 131.47),
        "徳島": (34.07, 134.56), "香川": (34.34, 134.04), "愛媛": (33.84, 132.77), "高知": (33.56, 133.53), "福岡": (33.61, 130.42),
        "佐賀": (33.25, 130.30), "長崎": (32.74, 129.87), "熊本": (32.79, 130.74), "大分": (33.24, 131.61), "宮崎": (31.91, 131.42),
        "鹿児島": (31.56, 130.56), "沖縄": (26.21, 127.68)}
# よく出る道路名・地名 → 都道府県
PLACE = {"首都高": "東京", "東名": "静岡", "新東名": "静岡", "名神": "滋賀", "新名神": "三重", "中央道": "山梨", "関越": "群馬",
         "東北道": "栃木", "常磐道": "茨城", "北陸道": "富山", "山陽道": "岡山", "九州道": "福岡", "阪神高速": "大阪",
         "名古屋": "愛知", "横浜": "神奈川", "札幌": "北海道", "仙台": "宮城", "神戸": "兵庫", "博多": "福岡", "那覇": "沖縄"}
JP_Q = "(通行止め OR 通行止 OR 事故 渋滞 OR 通行規制 OR 運転見合わせ) when:1d"


def _pref_of(title):
    for p in sorted(PREF, key=len, reverse=True):
        if p in title:
            return p
    for k, p in PLACE.items():
        if k in title:
            return p
    return None


def _jp_eta(title):
    if re.search(r"解除|再開|復旧", title) and not re.search(r"見込み|予定|めど|見通し", title):
        return {"status": "解除済み"}
    m = re.search(r"(?:\d{1,2}日(?:の)?)?(?:午前|午後)?\d{1,2}時(?:\d{1,2}分|半)?(?:ごろ|頃)?(?:に|まで)?.{0,6}(?:解除|再開)", title)
    if m:
        return {"status": "解除見込みあり", "text": m.group(0)}
    if re.search(r"解除の?(?:見通し|めど)(?:は)?(?:立って|たって)いない|見通し立たず", title):
        return {"status": "解除の見通しなし"}
    return {}


def japan():
    def fetch():
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": JP_Q, "hl": "ja", "gl": "JP", "ceid": "JP:ja"})
        raw, _, _ = H["http_get"](url, accept="application/rss+xml", timeout=15)
        root = ET.fromstring(raw)
        out, seen = [], set()
        for it in root.iter("item"):
            title = (it.findtext("title") or "").strip()
            if not re.search(r"通行止|事故|規制|渋滞|運転見合わせ", title):
                continue
            base = re.sub(r"\s+-\s+[^-]+$", "", title)
            if base[:30] in seen:
                continue
            seen.add(base[:30])
            pref = _pref_of(base)
            if not pref:
                continue
            src = (it.find("source").text if it.find("source") is not None else "") or ""
            try:
                ts = int(dt.datetime.strptime(it.findtext("pubDate"), "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=dt.timezone.utc).timestamp())
            except Exception:
                ts = None
            kind = "closure" if re.search(r"通行止|運転見合わせ", base) else "accident" if "事故" in base else "jam"
            lat, lon = PREF[pref]
            out.append({"id": "jp" + hashlib.md5(base.encode("utf-8")).hexdigest()[:10], "kind": kind, "country": "JP", "lat": lat, "lon": lon,
                        "pref": pref, "title": base[:140], "source": src[:40], "url": it.findtext("link") or "", "time": ts,
                        "eta": _jp_eta(base), "src": "報道（Googleニュース）"})
            if len(out) >= 60:
                break
        return out
    return ft.cached("traffic_jp", 900, fetch, ok=lambda v: isinstance(v, list))


def traffic():
    de, jp = [], []
    try:
        de = germany()
    except Exception as e:
        H.get("log", print)(f"交通情報(ドイツ)の取得に失敗: {type(e).__name__}")
    try:
        jp = japan()
    except Exception as e:
        H.get("log", print)(f"交通情報(日本)の取得に失敗: {type(e).__name__}")
    return {"updated": time.time(), "de": de, "jp": jp,
            "note": "ドイツの高速道路は Autobahn GmbH の公式データ。日本は公式の規制データが無料公開されていないため、報道の見出しを都道府県の位置に表示しています。"}
