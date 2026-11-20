# -*- coding: utf-8 -*-
"""
TrendScope 追加機能 第3弾（無料・キー不要。Discord/LINEは自分で発行するURL/トークンのみ）
 1 ライブカメラ  2 大気質  3 ロケット打ち上げ  4 国の統計比較・世界人口
 5 用語解説      6 続報の追跡  7 日本との関係  8 感情マップ
 9 ニュースラジオ(WAV)  10 Discord/LINE通知  11 壁紙モード
13 AI量産記事っぽさ  14 数字のうさんくささ  15 保存庫(全文検索)
"""
import array
import datetime as dt
import json
import math
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import wave

import analyzer as az
import features as ft
import features2 as f2
import geo

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
H = ft.H
cached = ft.cached
log = lambda *a: H.get("log", print)(*a)

ft.DEFAULT_SETTINGS.update({
    "discord_webhook": "", "line_token": "", "line_user_id": "",
    "wallpaper_enabled": False, "wallpaper_interval": 60, "wallpaper_original": "",
    "follow_interval": 30,
})


# ------------------------------------------------------------------ 1. ライブカメラ（YouTubeライブを検索して埋め込み）
LIVECAMS = [
    ("渋谷スクランブル交差点", 35.6595, 139.7005, "Shibuya Scramble Crossing live camera"),
    ("富士山", 35.3606, 138.7274, "Mount Fuji live camera"),
    ("大阪 道頓堀", 34.6687, 135.5013, "Dotonbori Osaka live camera"),
    ("ソウル", 37.5665, 126.978, "Seoul live cam city"),
    ("台北", 25.033, 121.5654, "Taipei live camera"),
    ("シンガポール", 1.2834, 103.8607, "Singapore Marina Bay live cam"),
    ("ドバイ", 25.1972, 55.2744, "Dubai live cam"),
    ("エルサレム 嘆きの壁", 31.7767, 35.2345, "Western Wall Jerusalem live"),
    ("キーウ", 50.4501, 30.5234, "Kyiv live camera"),
    ("ヴェネツィア", 45.4408, 12.3155, "Venice live cam Grand Canal"),
    ("パリ エッフェル塔", 48.8584, 2.2945, "Eiffel Tower live cam"),
    ("ロンドン アビー・ロード", 51.532, -0.1778, "Abbey Road crossing live cam"),
    ("アイスランドの火山", 63.89, -22.27, "Iceland volcano live"),
    ("ニューヨーク タイムズスクエア", 40.758, -73.9855, "Times Square live cam"),
    ("ナイアガラの滝", 43.0962, -79.0377, "Niagara Falls live cam"),
    ("ハワイ ワイキキ", 21.2767, -157.8275, "Waikiki beach live cam"),
    ("シドニー ハーバー", -33.8568, 151.2153, "Sydney Harbour live cam"),
    ("リオデジャネイロ", -22.9711, -43.1822, "Copacabana live cam"),
    ("ケープタウン", -33.9249, 18.4241, "Cape Town live cam"),
    ("宇宙から見た地球（ISS）", 0.0, -160.0, "NASA ISS live earth from space"),
]


def livecams():
    return {"cams": [{"id": i, "name": n, "lat": la, "lon": lo,
                      "search": "https://www.youtube.com/results?search_query=" + urllib.parse.quote(q) + "&sp=EgJAAQ%253D%253D"}
                     for i, (n, la, lo, q) in enumerate(LIVECAMS)]}


def livecam_video(i):
    i = int(i)
    name, _, _, q = LIVECAMS[i]

    def fetch():
        url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(q) + "&sp=EgJAAQ%253D%253D"
        raw, cs, _ = H["http_get"](url, accept="text/html", timeout=15, max_bytes=3_000_000,
                                   headers={"Accept-Language": "ja,en;q=0.8", "Cookie": "CONSENT=YES+1"})
        page = raw.decode(cs or "utf-8", "replace")
        vids, seen = [], set()
        for m in re.finditer(r'"videoRenderer":\{"videoId":"([\w-]{11})"', page):
            vid = m.group(1)
            if vid in seen:
                continue
            seen.add(vid)
            chunk = page[m.end():m.end() + 8000]
            t = re.search(r'"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"', chunk) or \
                re.search(r'"accessibilityData":\{"label":"((?:[^"\\]|\\.)*)"', chunk)
            try:
                title = json.loads('"' + t.group(1) + '"') if t else name
            except Exception:
                title = name
            vids.append({"id": vid, "title": title})
            if len(vids) >= 3:
                break
        if not vids:  # YouTubeの新しいページ形式（lockupViewModel等）にも対応
            for m in re.finditer(r'"(?:videoId|contentId)":"([\w-]{11})"', page):
                vid = m.group(1)
                if vid in seen:
                    continue
                seen.add(vid)
                chunk = page[m.end():m.end() + 6000]
                t = re.search(r'"title":\{"content":"((?:[^"\\]|\\.)*)"', chunk) or \
                    re.search(r'"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"', chunk)
                try:
                    title = json.loads('"' + t.group(1) + '"') if t else name
                except Exception:
                    title = name
                vids.append({"id": vid, "title": title})
                if len(vids) >= 3:
                    break
        return {"name": name, "videos": vids}
    return cached(f"cam:{i}", 1800, fetch, ok=lambda v: bool(v["videos"]))


# ------------------------------------------------------------------ 2. 大気質（Open-Meteo）
def air_quality():
    def fetch():
        cs = ft.CITIES
        q = urllib.parse.urlencode({"latitude": ",".join(str(c[1]) for c in cs), "longitude": ",".join(str(c[2]) for c in cs),
                                    "current": "us_aqi,pm2_5,pm10,ozone,dust", "timezone": "auto"})
        j = H["get_json"]("https://air-quality-api.open-meteo.com/v1/air-quality?" + q, timeout=20)
        j = j if isinstance(j, list) else [j]
        out = []
        for (name, lat, lon), w in zip(cs, j):
            c = w.get("current", {})
            aqi = c.get("us_aqi")
            lv = ("良い" if aqi is None or aqi <= 50 else "普通" if aqi <= 100 else "敏感な人は注意" if aqi <= 150
                  else "健康に悪い" if aqi <= 200 else "非常に悪い" if aqi <= 300 else "危険")
            out.append({"name": name, "lat": lat, "lon": lon, "aqi": aqi, "pm25": c.get("pm2_5"), "pm10": c.get("pm10"),
                        "dust": c.get("dust"), "level": lv})
        return {"cities": out, "note": "米国の大気質指数(AQI)。50以下=良い / 100超=敏感な人は注意 / 150超=健康に悪い"}
    return cached("aq", 1800, fetch)


# ------------------------------------------------------------------ 3. ロケット打ち上げ予定（Launch Library 2）
def launches():
    def fetch():
        j = H["get_json"]("https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=12&mode=normal", timeout=20)
        out = []
        for l in j.get("results", []):
            pad = l.get("pad") or {}
            loc = pad.get("location") or {}
            img = l.get("image")
            out.append({"name": l.get("name", ""), "net": l.get("net"), "status": (l.get("status") or {}).get("abbrev", ""),
                        "status_name": (l.get("status") or {}).get("name", ""),
                        "provider": (l.get("launch_service_provider") or {}).get("name", ""),
                        "pad": pad.get("name", ""), "location": loc.get("name", ""),
                        "lat": float(pad["latitude"]) if pad.get("latitude") not in (None, "") else None,
                        "lon": float(pad["longitude"]) if pad.get("longitude") not in (None, "") else None,
                        "mission": ((l.get("mission") or {}).get("description") or "")[:300],
                        "image": img.get("image_url") if isinstance(img, dict) else (img or ""),
                        "webcast": bool(l.get("webcast_live"))})
        tr = H["translate_many"]([o["mission"] for o in out if o["mission"]])
        for o in out:
            o["mission_ja"] = tr.get(o["mission"], o["mission"])
        return {"launches": out}
    return cached("launch", 3600, fetch, ok=lambda v: bool(v["launches"]))


# ------------------------------------------------------------------ 4. 国の統計比較・世界人口（世界銀行）
WB_IND = [("SP.POP.TOTL", "人口", "人"), ("NY.GDP.MKTP.CD", "GDP", "米ドル"), ("NY.GDP.PCAP.CD", "1人あたりGDP", "米ドル"),
          ("SP.DYN.LE00.IN", "平均寿命", "歳"), ("IT.NET.USER.ZS", "ネット利用率", "%"), ("SL.UEM.TOTL.ZS", "失業率", "%"),
          ("FP.CPI.TOTL.ZG", "物価上昇率", "%"), ("SP.DYN.TFRT.IN", "合計特殊出生率", "人")]


def wb_compare(codes):
    codes = [c.upper() for c in codes if re.match(r"^[A-Za-z]{2}$", c)][:5]
    if not codes:
        return {"error": "国を選んでください"}
    key = "wb:" + ";".join(sorted(codes))

    def fetch():
        rows = []
        for ind, name, unit in WB_IND:
            vals = {}
            try:
                j = H["get_json"](f"https://api.worldbank.org/v2/country/{';'.join(codes)}/indicator/{ind}?format=json&mrnev=1&per_page=50", timeout=20)
                for r in (j[1] if isinstance(j, list) and len(j) > 1 and j[1] else []):
                    iso = (r.get("country") or {}).get("id", "")
                    code = next((c for c in codes if c == iso or (r.get("countryiso3code") or "")[:2] == c), None)
                    if code is None:  # 世界銀行は2文字コードをcountry.idで返す
                        code = iso
                    if r.get("value") is not None:
                        vals[code] = {"v": r["value"], "year": r.get("date")}
            except Exception as e:
                log("世界銀行API失敗", ind, type(e).__name__)
            rows.append({"ind": ind, "name": name, "unit": unit, "values": vals})
        return {"codes": codes, "names": {c: geo.BY_CODE.get(c, {}).get("ja", c) for c in codes}, "rows": rows,
                "source": "世界銀行 World Development Indicators（各国の最新年）"}
    return cached(key, 86400, fetch, ok=lambda v: any(r["values"] for r in v["rows"]))


def world_population():
    def fetch():
        j = H["get_json"]("https://api.worldbank.org/v2/country/WLD/indicator/SP.POP.TOTL?format=json&mrnev=2", timeout=15)
        d = sorted(j[1], key=lambda r: r["date"])
        y0, p0, y1, p1 = int(d[0]["date"]), d[0]["value"], int(d[1]["date"]), d[1]["value"]
        per_sec = (p1 - p0) / ((y1 - y0) * 365.25 * 86400)
        base = dt.datetime(y1, 7, 1, tzinfo=dt.timezone.utc).timestamp()
        return {"base_pop": p1, "base_time": base, "per_sec": per_sec, "year": y1}
    return cached("wpop", 86400, fetch)


# ------------------------------------------------------------------ 5. 用語解説
GLOSSARY = {
    "制裁": "ある国の行動をやめさせるため、他の国々が貿易・金融取引・渡航などを制限する措置。",
    "停戦": "戦っている当事者が、一時的または恒久的に戦闘を止めること。和平合意の前段階のことが多い。",
    "休戦": "戦闘を一時的に止める取り決め。戦争の正式な終結（講和）とは別。",
    "利上げ": "中央銀行が政策金利を上げること。物価上昇（インフレ）を抑える効果がある一方、景気は冷えやすい。",
    "利下げ": "中央銀行が政策金利を下げること。お金を借りやすくして景気を下支えする。",
    "インフレ": "物価が継続的に上がること。同じお金で買える量が減る。",
    "デフレ": "物価が継続的に下がること。景気の停滞と結びつきやすい。",
    "GDP": "国内総生産。一定期間に国内で生み出されたモノやサービスの付加価値の合計で、経済規模の目安。",
    "安保理": "国連安全保障理事会。国際平和を担う国連の機関で、米英仏中露の5常任理事国は拒否権を持つ。",
    "NATO": "北大西洋条約機構。北米と欧州の軍事同盟で、加盟国への攻撃を全体への攻撃とみなす（集団防衛）。",
    "G7": "日米英仏独伊加の主要7か国（＋EU）の枠組み。毎年首脳会議（サミット）を開く。",
    "G20": "G7に中国・インド・ブラジルなど新興国を加えた20の国と地域の枠組み。",
    "IPO": "新規株式公開。企業が初めて株式を証券取引所に上場し、一般の投資家が売買できるようにすること。",
    "上場": "企業の株式が証券取引所で売買できるようになること。",
    "関税": "輸入品にかける税金。自国産業の保護や交渉の材料として使われる。",
    "難民": "迫害や紛争から逃れるため、国境を越えて他国に避難した人。国内にとどまる人は「国内避難民」。",
    "国内避難民": "紛争や災害で住む場所を追われたが、国境は越えずに国内で避難している人。",
    "国際刑事裁判所": "ICC。戦争犯罪・人道に対する罪・ジェノサイドなどを犯した個人を裁く常設の国際裁判所（オランダ・ハーグ）。",
    "国際司法裁判所": "ICJ。国と国の間の紛争を裁く国連の司法機関（オランダ・ハーグ）。",
    "ジェノサイド": "特定の民族・人種・宗教集団などを、意図的に破壊（殺害など）しようとする行為。集団殺害。",
    "半導体": "電気を通したり通さなかったりを制御できる物質で作る電子部品。スマホ・車・AIに欠かせない。",
    "生成AI": "文章・画像・音声などを新しく作り出す人工知能。大量のデータから学習している。",
    "中央銀行": "国の通貨を発行し、金利の調整などで物価や金融の安定を図る銀行（日本は日本銀行）。",
    "FRB": "米連邦準備制度理事会。アメリカの中央銀行にあたり、その金利判断は世界の市場に影響する。",
    "日銀": "日本銀行。日本の中央銀行で、お札の発行や金融政策を担う。",
    "為替介入": "政府・中央銀行が通貨の売買を行い、急激な円安・円高を抑えようとすること。",
    "円安": "円の価値が他の通貨に対して下がること。輸入品が高くなり、輸出企業や訪日旅行には追い風。",
    "円高": "円の価値が他の通貨に対して上がること。海外旅行や輸入品は安くなる。",
    "景気後退": "経済活動が縮小する局面。一般にGDPが2四半期連続でマイナスになると「リセッション」と呼ばれる。",
    "リセッション": "景気後退。経済活動が広い範囲で一定期間縮小すること。",
    "失業率": "働く意思と能力があるのに仕事がない人の割合。",
    "弾劾": "大統領など高官の不正を議会などが追及し、罷免（やめさせること）を求める手続き。",
    "戒厳令": "非常時に軍が治安維持の権限を持ち、市民の自由が大きく制限される状態。",
    "クーデター": "軍などが武力や非合法な手段で政権を奪うこと。",
    "非常事態宣言": "災害や暴動などの非常時に、政府が特別な権限を使えるようにする宣言。",
    "住民投票": "特定の政策や問題について、住民が直接投票して賛否を示す制度。",
    "連立政権": "複数の政党が協力して作る政権。単独で過半数に届かないときに組まれる。",
    "首脳会談": "国のトップ同士が直接会って話し合うこと。",
    "核兵器": "核分裂や核融合のエネルギーを利用した、極めて大きな破壊力を持つ兵器。",
    "濃縮ウラン": "核分裂しやすいウラン235の割合を高めたウラン。低濃縮は原発燃料、高濃縮は核兵器に転用可能。",
    "IAEA": "国際原子力機関。原子力の平和利用を進め、核兵器への転用を監視する国連関連機関。",
    "WHO": "世界保健機関。感染症対策など国際的な保健を担う国連の専門機関。",
    "パンデミック": "感染症が世界的に大流行すること。",
    "気候変動": "温室効果ガスの増加などにより、地球の気温や気象パターンが長期的に変化すること。",
    "COP": "国連気候変動枠組条約の締約国会議。温暖化対策を話し合う年1回の国際会議。",
    "温室効果ガス": "二酸化炭素やメタンなど、地球の熱を逃がしにくくして気温を上げるガス。",
    "エルニーニョ": "太平洋赤道域の海面水温が平年より高くなる現象。世界各地の天候に影響する。",
    "人道回廊": "紛争地から民間人を避難させたり、支援物資を届けたりするための一時的な安全ルート。",
    "無人機": "ドローン。人が乗らずに遠隔操作や自動で飛ぶ航空機。偵察や攻撃にも使われる。",
    "弾道ミサイル": "ロケットで打ち上げられ、放物線を描いて落下するミサイル。射程が長く迎撃が難しい。",
    "巡航ミサイル": "ジェットエンジンで低空を飛び、目標に向かって誘導されるミサイル。",
    "サイバー攻撃": "ネットワークやコンピューターに不正に侵入し、情報を盗んだりシステムを壊したりする攻撃。",
    "ランサムウェア": "データを暗号化して使えなくし、元に戻す代わりに身代金を要求するウイルス。",
    "暗号資産": "仮想通貨。ブロックチェーン技術を使ったデジタルな資産（ビットコインなど）。",
    "ナスダック": "アメリカの株式市場の一つ。IT・ハイテク企業が多く上場している。",
    "株価指数": "複数の企業の株価をまとめて、市場全体の動きを表す数値（日経平均、S&P500など）。",
    "買収": "ある企業が他の企業の株式を取得するなどして経営権を得ること。",
    "独占禁止法": "企業が市場を独占したり、不公正な取引をしたりすることを禁じる法律。",
    "量子コンピューター": "量子力学の性質を使って計算するコンピューター。特定の問題を従来機より圧倒的に速く解ける可能性がある。",
    "オープンソース": "ソフトウェアの設計図（ソースコード）が公開され、誰でも利用・改良できる形態。",
    "スタートアップ": "新しいビジネスで急成長を目指す、創業まもない企業。",
    "OPEC": "石油輸出国機構。主な産油国が原油の生産量などを調整する組織。",
    "物価指数": "モノやサービスの値段の変化を表す指標（消費者物価指数=CPIなど）。",
    "タリバン": "アフガニスタンのイスラム主義勢力。2021年に再び実権を握った。",
    "ハマス": "パレスチナ・ガザ地区を拠点とするイスラム主義組織。",
    "ヒズボラ": "レバノンを拠点とするイスラム教シーア派の政治・武装組織。",
    "フーシ派": "イエメンの武装勢力。首都サヌアを含む北部を支配し、紅海で船舶攻撃を行ってきた。",
}


def define(term):
    term = (term or "").strip()[:40]
    if not term:
        return {"error": "empty"}
    if term in GLOSSARY:
        return {"term": term, "text": GLOSSARY[term], "source": "TrendScope用語集"}

    def fetch():
        lang = "ja" if az._is_ja(term) else "en"
        try:
            j = H["get_json"](f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(term.replace(" ", "_")), timeout=10)
            text = j.get("extract", "")
            if lang == "en" and text:
                text = H["translate_one"](text[:600])
            if text and j.get("type") != "disambiguation":
                return {"term": term, "text": text[:400], "source": "Wikipedia",
                        "url": (j.get("content_urls") or {}).get("desktop", {}).get("page", "")}
        except Exception:
            pass
        try:  # 見出し語が無ければ検索
            s = H["get_json"]("https://ja.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
                {"action": "query", "list": "search", "srsearch": term, "format": "json", "srlimit": 1}), timeout=10)
            hit = s["query"]["search"][0]["title"]
            j = H["get_json"]("https://ja.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(hit), timeout=10)
            return {"term": hit, "text": j.get("extract", "")[:400], "source": "Wikipedia",
                    "url": (j.get("content_urls") or {}).get("desktop", {}).get("page", "")}
        except Exception:
            return {"term": term, "text": "", "error": "説明が見つかりませんでした"}
    return cached("def:" + term, 86400, fetch, ok=lambda v: bool(v.get("text")))


def glossary_terms():
    return sorted(GLOSSARY, key=len, reverse=True)


# ------------------------------------------------------------------ 6. 続報の追跡
FOLLOW_FILE = os.path.join(DATA, "follows.json")
_follow_lock = threading.Lock()


def follows():
    return ft._j(FOLLOW_FILE, [])


def follow_add(item):
    title = item.get("title") or ""
    if az._is_ja(title):
        title = H["translate_to"](title, "en")
    q = f2._key_query(title)
    with _follow_lock:
        fs = follows()
        if any(f["id"] == item.get("id") for f in fs):
            return fs
        fs.insert(0, {"id": item.get("id") or str(int(time.time())), "title_ja": item.get("title_ja") or item.get("title", ""),
                      "query": q, "url": item.get("url", ""), "created": time.time(), "last_check": 0, "seen": [], "hits": []})
        ft._save(FOLLOW_FILE, fs[:30])
    threading.Thread(target=follow_check, kwargs={"only": item.get("id"), "first": True}, daemon=True).start()
    return follows()


def follow_remove(fid):
    with _follow_lock:
        fs = [f for f in follows() if f["id"] != fid]
        ft._save(FOLLOW_FILE, fs)
    return fs


def follow_check(only=None, first=False):
    fs = follows()
    changed = False
    for f in fs:
        if only and f["id"] != only:
            continue
        try:
            arts = ft.gnews(f["query"], "en", days=2, limit=20)
        except Exception as e:
            log("続報チェック失敗", type(e).__name__)
            continue
        new = [a for a in arts if a["url"] not in f["seen"] and a["time"] > f["created"] - (86400 if first else 0)]
        f["seen"] = (f["seen"] + [a["url"] for a in arts])[-200:]
        f["last_check"] = time.time()
        if new and not first:
            tr = H["translate_many"]([a["title"] for a in new[:5]])
            for a in new[:5]:
                hit = {"title": a["title"], "title_ja": tr.get(a["title"], a["title"]), "url": a["url"], "source": a["source"], "time": a["time"]}
                f["hits"].insert(0, hit)
            f["hits"] = f["hits"][:30]
            ft._push_event("follow", f"{tr.get(new[0]['title'], new[0]['title'])}", f"{len(new)}件の新しい報道",
                           new[0]["url"], f"続報: {f['title_ja'][:24]}")
        changed = True
    if changed:
        with _follow_lock:
            cur = {f["id"]: f for f in follows()}
            for f in fs:
                if f["id"] in cur:
                    cur[f["id"]] = f
            ft._save(FOLLOW_FILE, list(cur.values()))
    return follows()


def follow_loop():
    time.sleep(60)
    while True:
        try:
            if follows():
                follow_check()
        except Exception as e:
            log("続報ループエラー", e)
        time.sleep(max(10, int(ft.settings().get("follow_interval", 30))) * 60)


# ------------------------------------------------------------------ 7. 日本との関係
TOKYO = (35.68, 139.69)


def _dist(a, b):
    R = 6371
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h_ = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h_))


def japan_relation(code, news_items):
    code = (code or "").upper()
    c = geo.BY_CODE.get(code)
    if not c or code == "JP":
        return {"error": "対象外"}
    prof = f2.country_profile(code, news_items)
    ll = prof.get("capital_ll") or [c["lat"], c["lon"]]
    km = _dist(TOKYO, ll)
    out = {"code": code, "ja": c["ja"], "km": round(km), "flight_h": round(km / 820 + 0.5, 1),
           "time_diff_h": None, "jpy_rate": prof.get("jpy_rate"),
           "mofa": "https://www.anzen.mofa.go.jp/"}
    if prof.get("weather"):
        out["time_diff_h"] = round((prof["weather"]["utc_offset"] - 9 * 3600) / 3600, 1)
    names = [c["ja"]] + ft.JA_ALIASES.get(code, [])
    try:
        jp = ft.jp_headlines()
        n, hits = ft._jp_count(names, [i["title"] for i in jp["items"]])
        out["jp_news"] = {"count": n, "examples": hits, "total": len(jp["items"])}
    except Exception:
        pass

    def wiki():
        try:
            s = H["get_json"]("https://ja.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
                {"action": "query", "list": "search", "srsearch": f"日本 {c['ja']} 関係 intitle:関係", "format": "json", "srlimit": 5}), timeout=10)
            titles = [x["title"] for x in s["query"]["search"]]
            t = next((x for x in titles if "関係" in x and ("日" in x or "日本" in x)), titles[0] if titles else None)
            if not t:
                return {}
            j = H["get_json"]("https://ja.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(t), timeout=10)
            return {"title": t, "extract": j.get("extract", "")[:500],
                    "url": (j.get("content_urls") or {}).get("desktop", {}).get("page", "")}
        except Exception:
            return {}
    out["wiki"] = cached("jrel:" + code, 86400, wiki, ok=lambda v: bool(v))
    return out


# ------------------------------------------------------------------ 8. 感情マップ
EMO = {
    "明るい": r"\b(win|wins|won|record|breakthrough|success\w*|celebrat\w*|rescu\w*|saved?|cure[sd]?|hope\w*|joy\w*|happ\w+|peace|award\w*|boost\w*|recover\w*|help\w*|kind\w*|donat\w*|reunit\w*|thriv\w*|restor\w*|heal\w*|best|good)\b",
    "暗い": r"\b(death|deaths|dead|dies|died|kill\w*|crash\w*|disaster\w*|loss\w*|fail\w*|declin\w*|drop\w*|layoff\w*|recession|flood\w*|wildfire\w*|quake|earthquake|crisis|sick\w*|disease|collaps\w*|famine|tragic|grief|mourn\w*|victims?)\b",
    "怒り": r"\b(slam\w*|outrage\w*|furious|fury|protest\w*|condemn\w*|accus\w*|blame\w*|backlash|riot\w*|clash\w*|sanction\w*|ban\w*|boycott\w*|anger|angry|row|feud|attack\w*|war|strike\w*)\b",
    "驚き": r"\b(surpris\w*|unexpected\w*|shock\w*|stun\w*|myster\w*|strange|weird|bizarre|odd|first-ever|reveal\w*|discover\w*|unusual|rare|giant|ancient|secret\w*|incredible)\b",
    "不安": r"\b(fear\w*|threat\w*|warn\w*|risk\w*|danger\w*|panic\w*|alarm\w*|terror\w*|scare\w*|worr\w*|concern\w*|uncertain\w*|tension\w*|escalat\w*|nuclear)\b",
}
_EMO_RX = {k: re.compile(v, re.I) for k, v in EMO.items()}
EMO_COLOR = {"明るい": "#46d39a", "暗い": "#8a9bb5", "怒り": "#ff5d6c", "驚き": "#ffd34d", "不安": "#b18cff", "中立": "#5b6b84"}


def emotion_of(text):
    sc = {k: len(rx.findall(text or "")) for k, rx in _EMO_RX.items()}
    best = max(sc, key=sc.get)
    return (best if sc[best] > 0 else "中立"), sc


def emotions(news_items):
    total = {k: 0 for k in list(EMO) + ["中立"]}
    by_c = {}
    items = []
    for it in news_items:
        e, sc = emotion_of(it["title"] + " " + it.get("desc", "")[:200])
        total[e] += 1
        items.append({"id": it["id"], "emo": e})
        for c in (it.get("geo") or [])[:1]:
            b = by_c.setdefault(c, {k: 0 for k in total})
            b[e] += 1
    countries = []
    for c, b in by_c.items():
        top = max((k for k in b if k != "中立"), key=lambda k: b[k])
        top = top if b[top] > 0 else "中立"
        countries.append({**geo.BY_CODE[c], "emo": top, "counts": b, "n": sum(b.values()), "color": EMO_COLOR[top]})
    return {"total": total, "countries": countries, "items": items, "colors": EMO_COLOR,
            "note": "英語の見出しに含まれる言葉から機械的に分類した目安です"}


# ------------------------------------------------------------------ 9. ニュースラジオ（Windows標準の音声合成でWAV作成＋BGM）
def radio_script(digest, cats=None):
    hr = dt.datetime.now().hour
    greet = "おはようございます" if hr < 11 else "こんにちは" if hr < 18 else "こんばんは"
    lines = [f"{greet}。トレンドスコープ、世界のニュースラジオです。{dt.datetime.now():%m月%d日 %H時%M分}時点のニュースをお届けします。"]
    for k, c in (digest.get("categories") or {}).items():
        if cats and k not in cats:
            continue
        lines.append(f"まずは、{c['label']}です。" if len(lines) == 1 else f"続いて、{c['label']}です。")
        for i in c["items"][:3]:
            lines.append(i["title_ja"] + "。")
            if i.get("desc_ja"):
                lines.append(i["desc_ja"][:120] + "。")
    if digest.get("top_countries"):
        lines.append("いま話題の国は、" + "、".join(x["ja"] for x in digest["top_countries"][:3]) + "でした。")
    lines.append("以上、トレンドスコープのニュースラジオでした。良い一日を。")
    return "\n".join(lines)


def _pad(nframes, rate):
    """やさしいコード進行のBGM（自作の正弦波。著作権の心配なし）"""
    chords = [(261.6, 329.6, 392.0), (220.0, 261.6, 329.6), (174.6, 220.0, 261.6), (196.0, 246.9, 293.7)]
    seg = rate * 4
    out = array.array("h", [0]) * nframes
    for n in range(nframes):
        ch = chords[(n // seg) % 4]
        pos = (n % seg) / seg
        env = min(1, pos * 4) * min(1, (1 - pos) * 4)
        t = n / rate
        v = sum(math.sin(2 * math.pi * f * t) + 0.5 * math.sin(2 * math.pi * f * 1.003 * t) for f in ch) / 4.5
        out[n] = int(v * env * 1400)
    return out


def radio_wav(text):
    if sys.platform != "win32":
        return None, "WAVファイルの作成はWindowsのみ対応です（ブラウザでの再生はどの環境でも使えます）"
    os.makedirs(os.path.join(DATA, "radio"), exist_ok=True)
    txt = os.path.join(DATA, "radio", "script.txt")
    voice = os.path.join(DATA, "radio", "voice.wav")
    out = os.path.join(DATA, "radio", f"news_radio_{time.strftime('%Y%m%d_%H%M')}.wav")
    with open(txt, "w", encoding="utf-8-sig") as f:
        f.write(text)
    ps = ("Add-Type -AssemblyName System.Speech;"
          "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
          "$v=$s.GetInstalledVoices()|?{$_.VoiceInfo.Culture.Name -eq 'ja-JP'}|select -First 1;"
          "if($v){$s.SelectVoice($v.VoiceInfo.Name)};$s.Rate=1;"
          "$fmt=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono);"
          f"$s.SetOutputToWaveFile('{voice}',$fmt);"
          f"$s.Speak([IO.File]::ReadAllText('{txt}'));$s.Dispose()")
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                       capture_output=True, timeout=300, creationflags=0x08000000)
    if not os.path.exists(voice) or os.path.getsize(voice) < 1000:
        return None, "音声合成に失敗しました（Windowsの日本語音声が必要です）: " + r.stderr.decode("cp932", "replace")[:200]
    with wave.open(voice, "rb") as w:
        rate, frames = w.getframerate(), w.readframes(w.getnframes())
    sp = array.array("h", frames)
    lead = rate * 3  # 頭とお尻にBGMだけの部分
    total = len(sp) + lead * 2
    bgm = _pad(total, rate)
    mix = array.array("h", bgm)
    for i, v in enumerate(sp):
        mix[i + lead] = max(-32768, min(32767, int(v * 0.95 + bgm[i + lead] * 0.6)))
    for i in range(rate * 2):  # フェードアウト
        k = total - rate * 2 + i
        mix[k] = int(mix[k] * (1 - i / (rate * 2)))
    with wave.open(out, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(mix.tobytes())
    try:
        os.remove(voice)
    except Exception:
        pass
    return out, None


# ------------------------------------------------------------------ 10. Discord / LINE 通知
def notify_external(title, body="", url=""):
    s = ft.settings()
    msg = f"{title}\n{body}".strip() + (f"\n{url}" if url else "")
    sent = []
    if s.get("discord_webhook", "").startswith("https://discord.com/api/webhooks/") or s.get("discord_webhook", "").startswith("https://discordapp.com/api/webhooks/"):
        try:
            req = urllib.request.Request(s["discord_webhook"], data=json.dumps({"content": msg[:1900], "username": "TrendScope"}).encode(),
                                         headers={"Content-Type": "application/json", "User-Agent": "TrendScope/1.0"})
            urllib.request.urlopen(req, timeout=10).read()
            sent.append("Discord")
        except Exception as e:
            log("Discord通知失敗", e)
    if s.get("line_token") and s.get("line_user_id"):
        try:
            req = urllib.request.Request("https://api.line.me/v2/bot/message/push",
                                         data=json.dumps({"to": s["line_user_id"], "messages": [{"type": "text", "text": msg[:4900]}]}).encode(),
                                         headers={"Content-Type": "application/json", "Authorization": "Bearer " + s["line_token"]})
            urllib.request.urlopen(req, timeout=10).read()
            sent.append("LINE")
        except Exception as e:
            log("LINE通知失敗", e)
    return sent


_orig_push = ft._push_event


def _push_and_send(kind, title, body, url, rule):
    _orig_push(kind, title, body, url, rule)
    threading.Thread(target=notify_external, args=(f"🔔 {rule}", f"{title}\n{body}".strip(), url or ""), daemon=True).start()


ft._push_event = _push_and_send
_orig_brief = ft.run_briefing


def _brief_and_send(refresh_fn, digest_fn, port_ref, open_browser=True):
    d = _orig_brief(refresh_fn, digest_fn, port_ref, open_browser)
    lines = ["☀ 今朝の世界ブリーフィング"]
    for c in (d.get("categories") or {}).values():
        if c.get("items"):
            lines.append(f"【{c['label']}】{c['items'][0]['title_ja']}")
    threading.Thread(target=notify_external, args=("\n".join(lines),), daemon=True).start()
    return d


ft.run_briefing = _brief_and_send


# ------------------------------------------------------------------ 11. 壁紙モード（Windows）
def _screen_size():
    try:
        import ctypes
        u = ctypes.windll.user32
        u.SetProcessDPIAware()
        return u.GetSystemMetrics(0), u.GetSystemMetrics(1)
    except Exception:
        return 1920, 1080


def wallpaper_render(digest, geo_sum, conflicts, markets, weather):
    if sys.platform != "win32":
        return None, "壁紙モードはWindowsのみ対応です"
    w, h = _screen_size()
    os.makedirs(os.path.join(DATA, "wallpaper"), exist_ok=True)
    js = os.path.join(DATA, "wallpaper", "data.json")
    png = os.path.join(DATA, "wallpaper", "trendscope_wallpaper.png")
    three = [c["items"][0]["title_ja"] for k, c in (digest.get("categories") or {}).items() if c.get("items") and k in ("world", "tech", "trivia")][:3]
    tokyo = next((c for c in (weather or {}).get("cities", []) if c["name"] == "東京"), None)
    data = {
        "w": w, "h": h, "date": time.strftime("%Y年%m月%d日 %H:%M 更新"),
        "three": three, "countries": [[c["lat"], c["lon"], len(c["items"]), c["ja"]] for c in geo_sum.get("countries", [])[:40]],
        "all": [[c["lat"], c["lon"]] for c in geo.BY_CODE.values()],
        "conflicts": [[c["lat"], c["lon"], c["name"], c["level"]] for c in conflicts],
        "markets": [f"{m['name']} {m['price']:,.2f} ({m['pct']:+.2f}%)" for m in (markets or {}).get("markets", []) if m.get("price") is not None][:6],
        "weather": f"東京 {tokyo['icon']} {tokyo['temp']}℃ {tokyo['desc']}" if tokyo else "",
        "keywords": [k["ja"] for k in digest.get("keywords", [])[:8]],
        "out": png,
    }
    with open(js, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    ps = r"""
Add-Type -AssemblyName System.Drawing
$d = Get-Content -Raw -Encoding UTF8 '%s' | ConvertFrom-Json
$W=[int]$d.w; $H=[int]$d.h
$bmp = New-Object System.Drawing.Bitmap $W,$H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode='AntiAlias'; $g.TextRenderingHint='AntiAliasGridFit'
$r = New-Object System.Drawing.Rectangle 0,0,$W,$H
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $r,([System.Drawing.Color]::FromArgb(255,10,14,22)),([System.Drawing.Color]::FromArgb(255,16,24,40)),90
$g.FillRectangle($bg,$r)
$mx=[int]($W*0.04); $my=[int]($H*0.18); $mw=[int]($W*0.62); $mh=[int]($mw/2)
function P($lat,$lon){ return @(($mx + ($lon+180)/360*$mw), ($my + (90-$lat)/180*$mh)) }
$dot = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70,120,150,200))
foreach($c in $d.all){ $p=P $c[0] $c[1]; $g.FillEllipse($dot,$p[0]-3,$p[1]-3,6,6) }
foreach($c in $d.countries){ $p=P $c[0] $c[1]; $s=[Math]::Min(46,10+[Math]::Sqrt($c[2])*9); $b=New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(110,91,157,255)); $g.FillEllipse($b,$p[0]-$s/2,$p[1]-$s/2,$s,$s) }
foreach($c in $d.conflicts){ $p=P $c[0] $c[1]; $col= if($c[3] -eq 'war'){[System.Drawing.Color]::FromArgb(230,255,59,79)}elseif($c[3] -eq 'high'){[System.Drawing.Color]::FromArgb(220,255,107,61)}else{[System.Drawing.Color]::FromArgb(180,255,181,71)}; $b=New-Object System.Drawing.SolidBrush $col; $g.FillEllipse($b,$p[0]-6,$p[1]-6,12,12) }
$fn='Yu Gothic UI'
$white=[System.Drawing.Brushes]::White
$sub=New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,151,163,184))
$acc=New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,126,224,195))
$g.DrawString('TrendScope', (New-Object System.Drawing.Font $fn,([int]($H*0.034)),([System.Drawing.FontStyle]::Bold)), $acc, $mx, [int]($H*0.05))
$g.DrawString($d.date, (New-Object System.Drawing.Font $fn,([int]($H*0.015))), $sub, $mx, [int]($H*0.11))
$x=[int]($W*0.69); $y=[int]($H*0.18); $tw=[int]($W*0.28)
$f1=New-Object System.Drawing.Font $fn,([int]($H*0.019)),([System.Drawing.FontStyle]::Bold)
$f2=New-Object System.Drawing.Font $fn,([int]($H*0.0165))
$g.DrawString('いまの世界を3行で', $f1, $acc, $x, $y); $y+=[int]($H*0.045)
$i=1; foreach($t in $d.three){ $rc=New-Object System.Drawing.RectangleF $x,$y,$tw,([int]($H*0.09)); $g.DrawString("$i. $t", $f2, $white, $rc); $y+=[int]($H*0.095); $i++ }
$y+=[int]($H*0.01); $g.DrawString('マーケット', $f1, $acc, $x, $y); $y+=[int]($H*0.04)
foreach($m in $d.markets){ $g.DrawString($m, $f2, $white, $x, $y); $y+=[int]($H*0.03) }
if($d.weather){ $y+=[int]($H*0.015); $g.DrawString($d.weather, $f2, $white, $x, $y); $y+=[int]($H*0.04) }
if($d.keywords.Count -gt 0){ $g.DrawString(('キーワード: ' + ($d.keywords -join '・')), $f2, $sub, (New-Object System.Drawing.RectangleF $x,$y,$tw,([int]($H*0.08)))) }
$ly=$my+$mh+[int]($H*0.02); $fs=[int]($H*0.016)
$g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220,91,157,255))),$mx,$ly+4,$fs,$fs); $g.DrawString('ニュースの話題地', $f2, $sub, ($mx+$fs+6), $ly)
$g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230,255,59,79))),($mx+[int]($W*0.11)),$ly+4,$fs,$fs); $g.DrawString('紛争・対立地域', $f2, $sub, ($mx+[int]($W*0.11)+$fs+6), $ly)
$bmp.Save($d.out,[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
""" % js
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                       capture_output=True, timeout=120, creationflags=0x08000000)
    if not os.path.exists(png):
        return None, "壁紙画像を作れませんでした: " + r.stderr.decode("cp932", "replace")[:300]
    return png, None


def wallpaper_get_current():
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(520)
        ctypes.windll.user32.SystemParametersInfoW(0x0073, 520, buf, 0)
        return buf.value
    except Exception:
        return ""


def wallpaper_set(path):
    import ctypes
    return bool(ctypes.windll.user32.SystemParametersInfoW(0x0014, 0, path, 0x01 | 0x02))


def wallpaper_enable(on, render_fn):
    s = ft.settings()
    if sys.platform != "win32":
        return {"ok": False, "error": "Windowsのみ対応です"}
    if on:
        cur = wallpaper_get_current()
        if cur and "trendscope_wallpaper" not in cur:
            ft.save_settings({"wallpaper_original": cur})
        png, err = render_fn()
        if err:
            return {"ok": False, "error": err}
        wallpaper_set(png)
        ft.save_settings({"wallpaper_enabled": True})
    else:
        orig = s.get("wallpaper_original", "")
        if orig and os.path.exists(orig):
            wallpaper_set(orig)
        ft.save_settings({"wallpaper_enabled": False})
    return {"ok": True, "enabled": on}


def wallpaper_loop(render_fn):
    last = 0
    while True:
        try:
            s = ft.settings()
            if s.get("wallpaper_enabled") and sys.platform == "win32" and time.time() - last > int(s.get("wallpaper_interval", 60)) * 60:
                png, err = render_fn()
                if png:
                    wallpaper_set(png)
                last = time.time()
        except Exception as e:
            log("壁紙更新エラー", e)
        time.sleep(60)


# ------------------------------------------------------------------ 13. AI量産記事っぽさ
AI_PHRASES_EN = ["in today's fast-paced world", "it's important to note", "it is important to note", "delve", "in conclusion",
                 "navigating the", "tapestry", "ever-evolving", "landscape of", "a testament to", "plays a crucial role",
                 "in the realm of", "unlock the", "game-changer", "seamless", "embark on", "furthermore", "moreover",
                 "it is worth noting", "as an ai", "in summary", "whether you're", "look no further", "elevate your"]
AI_PHRASES_JA = ["いかがでしたか", "と言えるでしょう", "ではないでしょうか", "について解説します", "結論から言うと", "まとめると",
                 "重要なポイント", "注目が集まっています", "することが重要です", "ご紹介します", "見ていきましょう", "について詳しく",
                 "様々な", "さまざまな", "幅広い", "といえます", "必要があります", "おすすめです"]


def ai_check(text):
    text = (text or "").strip()
    if len(text) < 200:
        return {"available": False, "note": "200文字以上の本文があると判定できます"}
    low = text.lower()
    is_ja = az._is_ja(text)
    sents = [s for s in re.split(r"(?<=[。！？.!?])\s*", text) if len(s.strip()) > 5]
    notes, score = [], 0
    phrases = AI_PHRASES_JA if is_ja else AI_PHRASES_EN
    found = [p for p in phrases if p in low]
    if found:
        score += min(35, 7 * len(found))
        notes.append(f"量産記事でよく見る決まり文句: 「{'」「'.join(found[:6])}」")
    if len(sents) >= 6:
        lens = [len(s) for s in sents]
        mean = sum(lens) / len(lens)
        sd = (sum((l - mean) ** 2 for l in lens) / len(lens)) ** 0.5
        cv = sd / mean if mean else 0
        if cv < 0.35:
            score += 15
            notes.append(f"文の長さが不自然にそろっている（ばらつき {cv:.2f}）")
    toks = re.findall(r"[぀-ヿ一-鿿]{2}|[a-z']+", low)
    grams = {}
    for i in range(len(toks) - 3):
        g = " ".join(toks[i:i + 4])
        grams[g] = grams.get(g, 0) + 1
    rep = sorted([(g, n) for g, n in grams.items() if n >= 3], key=lambda x: -x[1])
    if rep:
        score += min(15, 5 * len(rep))
        notes.append("同じ言い回しの繰り返しが多い")
    nums = len(re.findall(r"\d", text)) / max(1, len(text)) * 1000
    if nums < 3:
        score += 12
        notes.append("具体的な数字がほとんどない")
    srcs = re.search(r"according to|said|told|reported|によると|と述べ|と話|と発表|によれば|出典|引用", low)
    if not srcs:
        score += 15
        notes.append("誰が言ったか・どこの情報か（出典や発言者）が書かれていない")
    quotes = re.search(r"「[^」]{5,}」と|\"[^\"]{10,}\"", text)
    if not quotes:
        score += 5
    score = min(100, score)
    lv = "低い" if score < 25 else "やや高い" if score < 50 else "高い"
    return {"available": True, "score": score, "level": lv, "notes": notes or ["目立った特徴は見つかりませんでした"],
            "note": "あくまで文章の特徴からの目安です。AIが書いたかどうかを確実に判定するものではありません"}


# ------------------------------------------------------------------ 14. 数字のうさんくささ
NUM_RX = re.compile(r"(\d[\d,，.]*)\s*(倍|%|％|パーセント|万|億|兆|x\b|times\b|percent\b|fold\b)", re.I)


def numbers_check(title, body):
    claims = [m.group(0) for m in NUM_RX.finditer(title or "")]
    if not claims:
        return {"available": False}
    body = body or ""
    notes = []
    for c in claims[:4]:
        num = re.sub(r"[,，]", "", re.match(r"[\d,，.]+", c).group(0))
        found = num in re.sub(r"[,，]", "", body)
        base = re.search(r"前年|前月|昨年|比べ|比で|から\s*\d|同期比|compared|from \d|year-on-year|year over year|than (last|the previous)|since \d{4}", body, re.I)
        period = re.search(r"\d{4}年|\d+月|\d+年間|週間|か月|in \d{4}|last year|this year|quarter|四半期", body, re.I)
        n = f"見出しの「{c}」: " + ("本文にも同じ数字あり" if found else "⚠ 本文冒頭に同じ数字が見当たらない")
        if not base:
            n += "／⚠ 何と比べた数字か（比較の基準）が書かれていない"
        if not period:
            n += "／期間の記載が見当たらない"
        notes.append(n)
    if any("倍" in c or "times" in c.lower() or "fold" in c.lower() for c in claims):
        notes.append("「〇倍」は元の数が小さいと大きく見えます（例: 1件→3件でも3倍）。元の数を確認しましょう")
    if any("%" in c or "％" in c or "percent" in c.lower() for c in claims):
        notes.append("「〇%」はパーセント（割合）か、パーセントポイント（差）かで意味が変わります")
    return {"available": True, "claims": claims, "notes": notes}


# ------------------------------------------------------------------ 15. 保存庫（SQLite全文検索）
DB = os.path.join(DATA, "archive.db")
_db_lock = threading.Lock()
_fts = {"ok": None}


def _conn():
    c = sqlite3.connect(DB, timeout=10, check_same_thread=False)
    c.execute("""CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, title TEXT, title_ja TEXT, desc TEXT, desc_ja TEXT,
                 url TEXT, ext_url TEXT, source TEXT, cat TEXT, time REAL, geo TEXT, bait INTEGER, saved REAL)""")
    if _fts["ok"] is None:
        try:
            c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(title, title_ja, desc, desc_ja, source, content='items', content_rowid='rowid', tokenize='trigram')")
            c.execute("""CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
                         INSERT INTO items_fts(rowid,title,title_ja,desc,desc_ja,source) VALUES(new.rowid,new.title,new.title_ja,new.desc,new.desc_ja,new.source); END""")
            _fts["ok"] = True
        except Exception as e:
            log("全文検索(FTS5 trigram)が使えないため通常検索にします", e)
            _fts["ok"] = False
    return c


def archive_add(items):
    with _db_lock:
        c = _conn()
        c.executemany("INSERT OR IGNORE INTO items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      [(i["id"], i.get("title", ""), i.get("title_ja", ""), i.get("desc", ""), i.get("desc_ja", ""), i.get("url", ""),
                        i.get("ext_url", ""), i.get("source", ""), i.get("cat", ""), i.get("time") or time.time(),
                        ",".join(i.get("geo") or []), (i.get("bait") or {}).get("stars", 1), time.time()) for i in items])
        c.commit()
        c.close()


def archive_search(q="", cat="", days=0, limit=100):
    q = (q or "").strip()
    with _db_lock:
        c = _conn()
        where, args = [], []
        if cat:
            where.append("i.cat=?"); args.append(cat)
        if days:
            where.append("i.time>?"); args.append(time.time() - int(days) * 86400)
        if q and _fts["ok"] and len(q) >= 3:
            sql = "SELECT i.* FROM items_fts f JOIN items i ON i.rowid=f.rowid WHERE items_fts MATCH ?" + "".join(" AND " + w for w in where)
            args = ['"' + q.replace('"', '""') + '"'] + args
        else:
            if q:
                where.append("(i.title LIKE ? OR i.title_ja LIKE ? OR i.desc LIKE ? OR i.desc_ja LIKE ?)")
                args += [f"%{q}%"] * 4
            sql = "SELECT i.* FROM items i" + (" WHERE " + " AND ".join(where) if where else "")
        sql += " ORDER BY i.time DESC LIMIT ?"
        args.append(int(limit))
        cols = ["id", "title", "title_ja", "desc", "desc_ja", "url", "ext_url", "source", "cat", "time", "geo", "bait", "saved"]
        try:
            rows = [dict(zip(cols, r)) for r in c.execute(sql, args).fetchall()]
        except sqlite3.OperationalError as e:
            log("保存庫検索エラー", e)
            rows = []
        total = c.execute("SELECT COUNT(*), MIN(time), MAX(time) FROM items").fetchone()
        c.close()
    for r in rows:
        r["geo"] = [g for g in (r["geo"] or "").split(",") if g]
    return {"results": rows, "total": total[0], "oldest": total[1], "newest": total[2], "fts": bool(_fts["ok"])}
