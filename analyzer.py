# -*- coding: utf-8 -*-
"""釣りタイトル 冷静判定エンジン（外部ライブラリ不要）"""
import re

# (正規表現, 重み, カテゴリ, 冷静化で削除してよいか)
JA_PATTERNS = [
    (r"閲覧注意", 18, "恐怖・不安", True),
    (r"衝撃(的)?(の|な)?", 14, "誇張・断定", True),
    (r"驚愕(の)?", 14, "誇張・断定", True),
    (r"ヤバ(すぎる|過ぎる|すぎ|い)?|やば(すぎる|すぎ|い)", 12, "誇張・断定", True),
    (r"神回|神すぎ|神ってる", 10, "誇張・断定", True),
    (r"絶対(に)?", 10, "誇張・断定", True),
    (r"必見", 10, "緊急性", True),
    (r"拡散(希望|して)", 16, "緊急性", True),
    (r"緊急|速報|大至急", 10, "緊急性", True),
    (r"今すぐ(見て|チェック|確認)?|急いで|削除される前に|消される前に", 16, "緊急性", True),
    (r"悲報|朗報", 9, "感情誘導", True),
    (r"大?炎上", 10, "怒り・対立", False),
    (r"ブチギレ|激怒|ガチギレ|発狂|論破|フルボッコ", 14, "怒り・対立", True),
    (r"崩壊|終了のお知らせ|オワコン", 10, "恐怖・不安", False),
    (r"\d+\s*[%％]の人?が知らない|誰も(知らない|教えてくれない)|知らないと(損|ヤバい)", 18, "好奇心ギャップ", True),
    (r"(した|やった|みた|してみた)結果", 12, "好奇心ギャップ", False),
    (r"まさかの|まさか", 12, "好奇心ギャップ", True),
    (r"信じられない|ありえない|あり得ない", 12, "誇張・断定", True),
    (r"鳥肌|号泣|涙腺崩壊|涙が止まらない|震えた|戦慄", 12, "感情誘導", True),
    (r"暴露|禁断|闇が深い|闇|真相|裏側|隠された", 12, "秘密・陰謀", False),
    (r"ガチで|マジで|ガチ", 6, "誇張・断定", True),
    (r"史上最(高|悪|強|大)|過去最(高|悪|大)|最強|最悪", 9, "誇張・断定", False),
    (r"完全(に)?|確定|ついに|とうとう", 6, "誇張・断定", True),
    (r"とんでもない|えげつない|半端ない|ハンパない", 10, "誇張・断定", True),
    (r"爆笑|大爆笑|草不可避|腹筋崩壊", 8, "感情誘導", True),
    (r"恐怖|恐ろしい|怖すぎ|ゾッと", 10, "恐怖・不安", False),
    (r"見ないと損|見逃し厳禁|保存版", 10, "緊急性", True),
    (r"たった\s*\d+|1日\s*\d+\s*分|\d+\s*秒で", 10, "金銭・甘い話", False),
    (r"(月|年|日)?\d+\s*(万|億)\s*円?(稼|儲)|稼げる|儲かる|不労所得", 18, "金銭・甘い話", False),
    (r"無料で|タダで|裏技|秘密の", 8, "金銭・甘い話", False),
    (r"激変|激安|爆益|爆上げ|爆損", 10, "誇張・断定", False),
    (r"(医者|専門家|プロ)が(教える|隠す|驚く)", 12, "秘密・陰謀", False),
    (r"[〜~]?とは[？?]", 6, "好奇心ギャップ", False),
    (r"あなた(は|も|の)", 5, "感情誘導", False),
    (r"[wｗ]{2,}|（笑）|\(笑\)", 5, "感情誘導", True),
]

EN_PATTERNS = [
    (r"\byou won'?t believe\b", 22, "好奇心ギャップ", True),
    (r"\bwhat happen(s|ed) next\b", 20, "好奇心ギャップ", True),
    (r"\b(doctors|experts) hate\b|\bthis one (weird )?trick\b", 22, "秘密・陰謀", True),
    (r"\bthey don'?t want you to know\b|\bthe truth about\b|\bexposed\b", 16, "秘密・陰謀", False),
    (r"\bshock(ing|ed)?\b|\bjaw[- ]dropping\b|\bmind[- ]?blowing\b|\bblow your mind\b", 14, "誇張・断定", True),
    (r"\bunbelievable\b|\bincredible\b|\binsane(ly)?\b|\bcrazy\b|\bwild\b", 10, "誇張・断定", True),
    (r"\bepic\b|\bultimate\b|\bbest ever\b|\bworst ever\b|\bof all time\b", 8, "誇張・断定", True),
    (r"\b(slams|destroys|obliterates|owns|blasts|rips into)\b", 14, "怒り・対立", False),
    (r"\bgoes viral\b|\bbreaks the internet\b", 10, "誇張・断定", False),
    (r"\bbreaking\b|\burgent\b|\bmust[- ](see|watch|read)\b|\bbefore it'?s (deleted|too late)\b", 14, "緊急性", True),
    (r"\bterrifying\b|\bhorrifying\b|\bscary\b|\bnightmare\b|\bdevastating\b", 10, "恐怖・不安", False),
    (r"\bgone wrong\b|\bemotional\b|\bheartbreaking\b|\btears\b", 10, "感情誘導", True),
    (r"\bmiracle\b|\bgame[- ]changer\b|\brevolutionary\b", 10, "誇張・断定", False),
    (r"\bsecret(s)?\b|\bhidden\b|\brevealed\b", 8, "秘密・陰謀", False),
    (r"\bhere'?s why\b|\bthis is why\b|\bthe reason (why )?will\b", 10, "好奇心ギャップ", False),
    (r"\b(everyone|nobody|no one) (is|was|knows|expected)\b", 8, "誇張・断定", False),
    (r"\bomg\b|\bwtf\b|\blol\b", 8, "感情誘導", True),
    (r"\bliterally\b|\btotally\b|\bcompletely\b", 4, "誇張・断定", True),
    (r"\b(make|earn) \$?\d[\d,]*k?\b|\bget rich\b|\bfree money\b", 16, "金銭・甘い話", False),
    (r"\bfinally\b", 4, "誇張・断定", False),
    (r"\byou\b", 3, "感情誘導", False),
]

_JA = [(re.compile(p), w, c, r) for p, w, c, r in JA_PATTERNS]
_EN = [(re.compile(p, re.I), w, c, r) for p, w, c, r in EN_PATTERNS]
EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐⭕‼⁉]")
BRACKET_RE = re.compile(r"【[^】]{1,30}】|［[^］]{1,30}］|\[[^\]]{1,30}\]")
CAPS_RE = re.compile(r"\b[A-Z]{4,}\b")
EXCL_RE = re.compile(r"[!！]{1,}")
QUES_RE = re.compile(r"[?？]{1,}")
COMBO_RE = re.compile(r"[!！?？]{2,}")
ELLIPSIS_RE = re.compile(r"(…|\.\.\.|・・・)\s*$")
CAPS_OK = {"NASA", "COVID", "HTML", "HTTP", "JSON", "AMD", "NVIDIA", "USA", "BBC", "FIFA", "NATO",
           "UEFA", "CERN", "IEEE", "OPEC", "LGBT", "ESPN", "TIL", "AMA", "GPU", "CPU", "UNESCO", "WHO"}


def _is_ja(text):
    return bool(re.search(r"[぀-ヿ一-鿿]", text))


def score_text(text):
    """テキストの釣り度を採点。spans は元テキスト上の位置。"""
    text = text or ""
    hits, spans, cats = [], [], {}
    score = 0
    pats = _JA + _EN if _is_ja(text) else _EN + _JA
    used = []
    for rx, w, cat, removable in pats:
        for m in rx.finditer(text):
            if any(m.start() < e and s < m.end() for s, e in used):
                continue
            used.append((m.start(), m.end()))
            spans.append({"start": m.start(), "end": m.end(), "label": cat, "removable": removable})
            hits.append(m.group(0))
            score += w
            cats[cat] = cats.get(cat, 0) + w

    reasons = []
    excl = sum(len(m.group(0)) for m in EXCL_RE.finditer(text))
    ques = sum(len(m.group(0)) for m in QUES_RE.finditer(text))
    if excl >= 2:
        score += min(20, excl * 4); reasons.append(f"感嘆符「!」が{excl}個（感情をあおる記号の多用）")
        cats["記号の多用"] = cats.get("記号の多用", 0) + min(20, excl * 4)
    elif excl == 1:
        score += 3
    if ques >= 2:
        score += min(14, ques * 4); reasons.append(f"疑問符「?」が{ques}個（答えを隠して興味を引く形）")
        cats["記号の多用"] = cats.get("記号の多用", 0) + min(14, ques * 4)
    for m in COMBO_RE.finditer(text):
        spans.append({"start": m.start(), "end": m.end(), "label": "記号の多用", "removable": True})
    caps = [c for c in CAPS_RE.findall(text) if c not in CAPS_OK]
    if caps:
        score += min(18, 6 * len(caps)); reasons.append(f"全部大文字の強調語: {', '.join(caps[:4])}")
        for m in CAPS_RE.finditer(text):
            if m.group(0) not in CAPS_OK:
                spans.append({"start": m.start(), "end": m.end(), "label": "大文字強調", "removable": False})
    emojis = EMOJI_RE.findall(text)
    if len(emojis) >= 2:
        score += min(15, 4 * len(emojis)); reasons.append(f"絵文字が{len(emojis)}個")
    brackets = BRACKET_RE.findall(text)
    if brackets:
        score += min(16, 8 * len(brackets)); reasons.append(f"見出しの隅付き括弧で強調: {' '.join(brackets[:3])}")
        for m in BRACKET_RE.finditer(text):
            spans.append({"start": m.start(), "end": m.end(), "label": "括弧で強調", "removable": True})
    if ELLIPSIS_RE.search(text):
        score += 10; reasons.append("「…」で終わる（続きが気になる寸止め型）")
    if re.search(r"(結果|すると|その後|なんと)[…、。]*$|\b(what|why|how)\b.*\?$", text, re.I):
        score += 6; reasons.append("結論を隠して最後まで言わない構成")

    for cat, w in sorted(cats.items(), key=lambda x: -x[1]):
        if cat in ("記号の多用",):
            continue
        words = [text[s["start"]:s["end"]] for s in spans if s["label"] == cat]
        if words:
            reasons.insert(0, f"{cat}: 「{'」「'.join(dict.fromkeys(words))}」")

    score = max(0, min(100, score))
    spans.sort(key=lambda s: s["start"])
    return {"score": score, "stars": to_stars(score), "spans": spans, "reasons": reasons,
            "categories": cats}


def to_stars(score):
    if score < 12: return 1
    if score < 30: return 2
    if score < 50: return 3
    if score < 70: return 4
    return 5


STAR_LABEL = {1: "冷静・ほぼ事実", 2: "やや演出あり", 3: "釣り気味", 4: "かなり釣り", 5: "完全に釣り"}


def calm_title(text, spans):
    """釣り部分を取り除いて落ち着いた見出しに整形"""
    out, last = [], 0
    for s in sorted(spans, key=lambda x: x["start"]):
        if s["start"] < last:
            continue
        out.append(text[last:s["start"]])
        if not s["removable"]:
            out.append(text[s["start"]:s["end"]])
        last = s["end"]
    out.append(text[last:])
    t = "".join(out)
    t = EMOJI_RE.sub("", t)
    t = re.sub(r"[!！]+", "", t)
    t = re.sub(r"[?？]{2,}", "？", t)
    t = re.sub(r"(…|\.\.\.|・・・)+\s*$", "", t)
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"^[\s、。,:：\-—|｜/]+|[\s、,:：\-—|｜/]+$", "", t)
    return t.strip()


# ---------- タイトルと本文のギャップ判定 ----------
EN_STOP = set("""the a an and or but of to in on for with at by from is are was were be been this that these those
it its as about into after before over under than then just have has had will would can could should what why how
who when where which your you they them their our we he she his her not no yes new more most very really here there
says said say get gets got make makes made one two three year years day days""".split())


def key_terms(text):
    if _is_ja(text):
        terms = re.findall(r"[゠-ヿー]{2,}|[一-鿿]{2,}|[A-Za-z][A-Za-z0-9]{2,}", text)
    else:
        terms = [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z'\-]{3,}", text) if w.lower() not in EN_STOP]
    hype = set()
    for rx, *_ in _JA + _EN:
        for m in rx.finditer(text):
            hype.add(m.group(0).lower())
    return list(dict.fromkeys(t for t in terms if t.lower() not in hype))


def _norm_num(n):
    return n.replace(",", "").replace("，", "")


def gap_analysis(title, body, title_res):
    body = body or ""
    if len(body.strip()) < 60:
        return {"available": False, "gap": 0, "notes": ["本文がほとんど取得できなかったため、見出しのみで判定しています"]}
    notes = []
    terms = key_terms(title)
    bl = body.lower()

    def found(t):
        if t.lower() in bl:
            return True
        if _is_ja(t) and len(t) >= 3:  # 日本語は部分一致（2文字）も許容
            return any(t[i:i + 2] in body for i in range(len(t) - 1))
        if not _is_ja(t) and len(t) > 5:
            return t.lower()[:5] in bl
        return False

    covered = [t for t in terms if found(t)]
    coverage = len(covered) / len(terms) if terms else 1.0
    missing_terms = [t for t in terms if t not in covered][:6]
    gap = (1 - coverage) * 45
    if terms:
        notes.append(f"見出しの重要語のうち本文で確認できたのは {len(covered)}/{len(terms)} 語（{int(coverage*100)}%）")
    if missing_terms and coverage < 0.7:
        notes.append(f"本文に出てこない見出しの言葉: {', '.join(missing_terms)}")

    nums = [_norm_num(n) for n in re.findall(r"\d[\d,，]*(?:\.\d+)?", title)]
    bodyn = _norm_num(body)
    missing_nums = [n for n in nums if n not in bodyn]
    if missing_nums:
        gap += min(30, 15 * len(missing_nums))
        notes.append(f"見出しの数字 {', '.join(missing_nums)} の根拠が本文冒頭に見当たらない")

    body_res = score_text(body[:1500])
    body_density = body_res["score"] * min(1.0, 400 / max(len(body), 1)) if body_res["score"] else 0
    diff = title_res["score"] - body_density
    if title_res["score"] >= 30 and diff > 20:
        gap += min(30, diff * 0.5)
        notes.append("見出しは強い言葉なのに本文は落ち着いた内容（見出しだけ盛っている可能性）")
    elif title_res["score"] >= 30:
        notes.append("本文も同じくらい強い表現を使っている（記事全体が釣り調）")
    if coverage >= 0.7 and not missing_nums and diff <= 20:
        notes.append("見出しと本文の内容はおおむね一致しています")
    gap = int(max(0, min(100, gap)))
    return {"available": True, "gap": gap, "coverage": round(coverage, 2), "notes": notes,
            "body_score": body_res["score"]}


def split_sentences(text):
    parts = re.split(r"(?<=[。！？!?])\s*|(?<=\.)\s+(?=[A-Z\"'“])", text)
    return [p.strip() for p in parts if len(p.strip()) >= 15]


def factual_summary(body, max_sent=3):
    """釣りが少ない文を優先して冒頭から抜き出す抽出型要約"""
    sents = split_sentences(body or "")[:12]
    picked = []
    for s in sents:
        r = score_text(s)
        if r["score"] < 30:
            picked.append(calm_title(s, r["spans"]))
        if len(picked) >= max_sent:
            break
    if not picked and sents:
        picked = [calm_title(s, score_text(s)["spans"]) for s in sents[:max_sent]]
    return " ".join(picked)


def verdict_text(stars, gap_av, gap):
    if stars <= 1:
        base = "落ち着いた見出しです。内容をそのまま受け取ってOK。"
    elif stars == 2:
        base = "少し演出はありますが、許容範囲です。"
    elif stars == 3:
        base = "釣り気味です。見出しより中身は地味な可能性があります。"
    elif stars == 4:
        base = "かなり釣り寄り。感情を動かす言葉が多いので一呼吸おいて。"
    else:
        base = "典型的な釣りです。見出しの印象は割り引いて読みましょう。"
    if gap_av and gap >= 50:
        base += " 見出しと本文のズレも大きめです。"
    return base
