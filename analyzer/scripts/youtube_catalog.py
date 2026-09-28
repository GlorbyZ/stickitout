"""Catalog YouTube demo videos of the 40 PAS rudiments for training (metadata only, no media).

For every rudiment it runs several YouTube searches, with and without the Creative Commons
filter, keeps videos whose title names that rudiment, reads the full metadata of the most
promising ones with yt-dlp (license, formats, channel size) without downloading the video, and
estimates camera angle and hand visibility from the thumbnail with MediaPipe. The license is
always taken from the video's own metadata, never from the search filter.

Writes data/youtube/catalog.csv and catalog.json (committed) and caches raw search results,
metadata and thumbnails under data/youtube/cache/ (not committed).

Usage (analyzer venv, yt-dlp on PATH):
  python -m scripts.youtube_catalog                    all 40 rudiments
  python -m scripts.youtube_catalog --rudiments 16,17  only these PAS numbers
  python -m scripts.youtube_catalog --refresh          ignore cached searches and metadata
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.rudiments import RUDIMENTS, _norm, slug  # noqa: E402

OUT = ROOT / "data" / "youtube"
CACHE = OUT / "cache"
CC_FILTER = "EgIwAQ%253D%253D"          # YouTube search filter: Creative Commons
CC_LICENSE = "Creative Commons Attribution license (reuse allowed)"

# Well known educators, brands and drum corps. A channel also counts as established with
# at least ESTABLISHED_FOLLOWERS subscribers; everything else is listed but ranked lower.
REPUTABLE = [
    "vic firth", "drumeo", "mike johnston", "mikeslessons", "percussive arts society", "bill bachman",
    "rob brown", "jared falk", "drum beats online", "promark", "evans drumheads", "zildjian", "sabian",
    "remo", "tama", "pearl", "yamaha", "ludwig", "dw drums", "modern drummer", "drum magazine",
    "hudson music", "drumchannel", "drum channel", "tommy igoe", "dom famularo", "claus hessler",
    "stephane chamberland", "drumming system", "nate smith", "aaron edgar", "rhythm notes", "180drums",
    "drum lessons with", "stephen taylor", "drum corps international", "dci", "blue devils", "santa clara vanguard",
    "carolina crown", "bluecoats", "boston crusaders", "the cadets", "phantom regiment", "the cavaliers",
    "mandarins", "blue knights", "crossmen", "vanguard", "cadets", "drum guru", "sweetwater", "musicians institute",
    "berklee", "larnell lewis", "domino drums", "drumtalk", "drumstr8", "rudiment ninja", "rudimental",
    "jojo mayer", "gavin harrison", "benny greb", "dennis chambers", "john riley", "drum workshop", "drumset lessons",
    "drum hacks", "pro drum lessons", "drum tips", "free drum lessons", "online drummer",
]
ESTABLISHED_FOLLOWERS = 100_000
COMPILATION = re.compile(r"\b(40|all|essential|every|pas)\b.*\brudiments?\b|\brudiments?\b.*\b(40|all)\b", re.I)
TEMPO = re.compile(r"(?<!\d)(\d{2,3})\s*(?:bpm|b\.p\.m\.?|beats per minute)", re.I)

OTHER_INSTRUMENT = re.compile(r"\b(cajon|darbuka|djembe|tabla|conga|bongo|hand ?drum|finger|rope ?flow|keyboard|guitar|piano|"
                              r"marimba|xylophone|bounce metronome|3d|animation|midi|app|software|tongue drum)\b", re.I)
APPLICATION = re.compile(r"\b(groove|grooves|beat|beats|fill|fills|solo|solos|jam|chops|how to use|using|uses|use a|"
                         r"aplica\w*|performance|church|master of|funk|linear|ostinato|applications?|drum ?set|drum ?kit|"
                         r"kit|hi ?hat|song|cover|around the (drums|kit)|toms?)\b", re.I)


FEET = re.compile(r"\b(double bass|bass drum|kick|pedal|feet|foot|heel|ankle|blast ?beat)\b", re.I)
DRUM_CONTEXT = re.compile(r"drum|snare|rudiment|percussion|stick|practice pad|\bpad\b|batter|bater[ií]a|drumline|trommel|tambor|"
                          r"schlagzeug|ドラム|ルーディメンツ|드럼|鼓|marching|tenor|dci|corps", re.I)


APPLICATION_CJK = re.compile(r"応用|使い方|应用|應用|응용|필인|グルーヴ|フィル")


def drum_context(entry: dict) -> bool:
    """The title, description snippet or channel mentions drums (filters 'Drag Racing', 'Lesson 25' of other courses)."""
    return bool(DRUM_CONTEXT.search(f"{entry.get('title') or ''} {entry.get('description') or ''} {entry.get('channel') or ''}"))


def content_type(title: str, tags: list | None = None) -> str:
    """demo (the rudiment itself on a pad or snare), application (grooves, fills, kit) or other instrument."""
    text = f"{title} {' '.join(tags or [])[:300]}"
    if OTHER_INSTRUMENT.search(title or ""):
        return "other instrument or animation"
    if FEET.search(title or ""):
        return "feet or kit (not hands on a pad)"
    if APPLICATION.search(title or "") or APPLICATION_CJK.search(title or ""):
        return "application (groove, fill or kit)"
    if len(rudiments_named(title or "")) > 1:
        return "several rudiments in one video"
    return "demo"


YTDLP = shutil.which("yt-dlp")


class RateLimited(Exception):
    """YouTube answered 429 or asked to confirm we are not a bot: stop and resume later."""


BLOCKED = 0          # consecutive rate-limit answers


def run_ytdlp(args: list[str], timeout: int = 120) -> str | None:
    """Run yt-dlp politely. Backs off on rate limits and raises RateLimited when they persist.

    Never passes browser cookies or other credentials: if YouTube keeps refusing, the run stops
    and can be resumed later (results are cached).
    """
    global BLOCKED
    for attempt in range(3):
        try:
            p = subprocess.run([YTDLP, *args], capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=timeout)
        except subprocess.TimeoutExpired:
            continue
        if p.returncode == 0 and p.stdout.strip():
            BLOCKED = 0
            return p.stdout
        err = p.stderr or ""
        if "confirm you" in err or "429" in err:
            BLOCKED += 1
            if BLOCKED >= 4:
                raise RateLimited(err.strip().splitlines()[-1][:200])
            time.sleep(90 * BLOCKED)
            continue
        return None                         # private, removed, age restricted, etc.
    return None


def cached(name: str, fn, refresh: bool):
    path = CACHE / name
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    data = fn()
    if data is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")
    return data


def search(query: str, cc: bool, n: int, refresh: bool) -> list[dict]:
    key = hashlib.sha1(f"{query}|{cc}|{n}".encode()).hexdigest()[:16]

    def fetch():
        if cc:
            url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}&sp={CC_FILTER}"
        else:
            url = f"ytsearch{n}:{query}"
        try:
            out = run_ytdlp(["--flat-playlist", "-J", "--playlist-end", str(n), url])
        except RateLimited:
            return None
        if out is None:
            return None
        return {"query": query, "cc": cc, "entries": [
            {k: e.get(k) for k in ("id", "title", "channel", "channel_url", "channel_id", "duration", "view_count",
                                   "channel_is_verified", "description")}
            for e in (json.loads(out).get("entries") or []) if e.get("id")]}
    return (cached(f"search/{key}.json", fetch, refresh) or {"entries": []})["entries"]


def metadata(vid: str, refresh: bool) -> dict | None:
    def fetch():
        out = run_ytdlp(["-j", "--skip-download", "--no-playlist", f"https://www.youtube.com/watch?v={vid}"])
        if out is None:
            return None
        j = json.loads(out)
        fmts = [f for f in j.get("formats") or [] if f.get("vcodec") not in (None, "none") and f.get("height")]
        keep = ("id", "title", "channel", "channel_url", "channel_id", "channel_follower_count", "channel_is_verified",
                "uploader", "duration", "view_count", "like_count", "upload_date", "license", "description", "tags",
                "width", "height", "fps", "thumbnail", "age_limit", "availability", "live_status", "aspect_ratio")
        meta = {k: j.get(k) for k in keep}
        meta["description"] = (meta.get("description") or "")[:3000]
        meta["formats"] = [{"h": f.get("height"), "w": f.get("width"), "fps": f.get("fps"), "vcodec": (f.get("vcodec") or "")[:12],
                            "ext": f.get("ext")} for f in fmts]
        meta["chapters"] = [{"t": c.get("start_time"), "title": c.get("title")} for c in (j.get("chapters") or [])]
        return meta
    return cached(f"meta/{vid}.json", fetch, refresh)


# ---- matching -------------------------------------------------------------------------------

NAMES = []
for r in RUDIMENTS:
    for label in [r["name"], *r["aliases"]]:
        n = _norm(label)
        NAMES.append((n, r["number"]))
NAMES.append(("drag paradiddle", 36))      # "Drag Paradiddle" without a number: the first one
NAMES.sort(key=lambda x: -len(x[0]))       # most specific first ("flam tap" before "flam")
NUMBER_WORDS = {"1": ["1", "one", "no 1", "number 1", "i"], "2": ["2", "two", "no 2", "number 2", "ii"]}


# Names that also mean something outside drumming (or refer to feet): these need drum context.
AMBIGUOUS = {"drag", "ruff", "lesson 25", "lesson twenty five", "flam", "single strokes", "single stroke",
             "double strokes", "long roll", "triple strokes", "triple stroke"}


ABBREV = [(r"\bparadid+le?s?\b", "paradiddle"), (r"\bdid+les?\b", "diddle"), (r"\brolls\b", "roll"),
          (r"\btrpl\b", "triple"), (r"\bdbl\b", "double"), (r"\bsgl\b", "single")]


def _title_norm(title: str) -> str:
    t = _norm(title)
    for pat, rep in ABBREV:
        t = re.sub(pat, rep, t)
    return f" {t} "


def match_label(title: str) -> tuple[int | None, str | None]:
    """(PAS number, matched name) of the most specific rudiment named in a title."""
    t = _title_norm(title)
    for n, number in NAMES:
        if f" {n} " in t:
            return number, n
    return None, None


def rudiments_named(title: str) -> set[int]:
    """Every rudiment a title names (longest names first, each match removed so 'flam tap' is not also 'flam')."""
    t, found = _title_norm(title), set()
    for n, number in NAMES:
        while f" {n} " in t:
            found.add(number)
            t = t.replace(f" {n} ", " | ", 1)
    return found


def match_rudiment(title: str) -> int | None:
    """The PAS number of the most specific rudiment named in a title, or None."""
    return match_label(title)[0]


def is_reputable(channel: str, followers: int | None) -> tuple[bool, str]:
    c = (channel or "").lower()
    for name in REPUTABLE:
        if re.search(rf"(^|\W){re.escape(name)}(\W|$)", c):
            return True, f"known channel ({name})"
    if followers and followers >= ESTABLISHED_FOLLOWERS:
        return True, f"{followers // 1000}k subscribers"
    return False, ""


# ---- thumbnail pose (camera angle and hands) ------------------------------------------------

_POSE = _HANDS = None


def _models():
    global _POSE, _HANDS
    if _POSE is None:
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
        from app.video import ensure_models
        paths = ensure_models()
        _POSE = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(paths["pose"])),
            running_mode=vision.RunningMode.IMAGE, num_poses=1, min_pose_detection_confidence=0.4))
        _HANDS = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(paths["hand"])),
            running_mode=vision.RunningMode.IMAGE, num_hands=2, min_hand_detection_confidence=0.4))
    return _POSE, _HANDS


def view_from_image(path: Path) -> dict:
    """Camera angle and hand visibility guessed from one image (thumbnail or video frame)."""
    import mediapipe as mp
    pose, hands = _models()
    img = mp.Image.create_from_file(str(path))
    p = pose.detect(img)
    h = hands.detect(img)
    n_hands = len(h.hand_landmarks or [])
    if not p.pose_landmarks:
        return {"angle": "hands only" if n_hands else "no player found", "hands_visible": "yes" if n_hands >= 2 else ("one" if n_hands else "no"),
                "shoulder_ratio": None}
    lm = p.pose_landmarks[0]
    vis = lambda i: (lm[i].visibility or 0) >= 0.5
    wrists = sum(vis(i) for i in (15, 16))
    hands_visible = "yes" if (wrists == 2 or n_hands >= 2) else ("one" if (wrists or n_hands) else "no")
    ratio = None
    if vis(11) and vis(12) and (vis(13) or vis(14)):
        sw = math.dist((lm[11].x, lm[11].y), (lm[12].x, lm[12].y))
        arms = [math.dist((lm[s].x, lm[s].y), (lm[e].x, lm[e].y)) for s, e in ((11, 13), (12, 14)) if vis(e)]
        ua = max(arms) if arms else None
        ratio = sw / ua if ua else None
    if ratio is None:
        angle = "unknown"
    elif ratio >= 1.0:
        angle = "front"
    elif ratio >= 0.5:
        angle = "three-quarter"
    else:
        angle = "side"
    return {"angle": angle, "hands_visible": hands_visible, "shoulder_ratio": round(ratio, 2) if ratio else None}


def thumb_view(meta: dict, refresh: bool) -> dict:
    vid = meta["id"]
    path = CACHE / "thumbs" / f"{vid}.jpg"
    if not path.exists() or refresh:
        path.parent.mkdir(parents=True, exist_ok=True)
        for name in ("maxresdefault", "sddefault", "hqdefault"):
            try:
                urllib.request.urlretrieve(f"https://i.ytimg.com/vi/{vid}/{name}.jpg", path)
                if path.stat().st_size > 3000:
                    break
            except Exception:
                continue
    if not path.exists():
        return {"angle": "unknown", "hands_visible": "unknown", "shoulder_ratio": None}
    try:
        return view_from_image(path)
    except Exception as exc:
        return {"angle": "unknown", "hands_visible": "unknown", "shoulder_ratio": None, "error": str(exc)[:80]}


# ---- scoring and rows -------------------------------------------------------------------------

def best_format(meta: dict) -> tuple[int | None, int | None, float | None, bool]:
    fm = [f for f in meta.get("formats") or [] if f["h"] and f["h"] <= 1080 * 1.5]
    if not fm:
        return meta.get("width"), meta.get("height"), meta.get("fps"), False
    top = max(min(f["h"], f["w"] or f["h"]) for f in fm)                # short side, so vertical videos count right
    at_top = [f for f in fm if min(f["h"], f["w"] or f["h"]) == top]
    best = max(at_top, key=lambda f: f["fps"] or 0)
    has60 = any((f["fps"] or 0) >= 50 for f in fm)
    return best["w"], best["h"], best["fps"], has60


def license_short(raw: str | None) -> str:
    if not raw:
        return "Standard"
    return "CC-BY" if "Creative Commons" in raw else raw


def row_for(meta: dict, number: int, hits: list[str], view: dict) -> dict:
    r = next(x for x in RUDIMENTS if x["number"] == number)
    w, h, fps, has60 = best_format(meta)
    rep, why = is_reputable(meta.get("channel") or meta.get("uploader"), meta.get("channel_follower_count"))
    content = content_type(meta.get("title") or "", meta.get("tags"))
    text = f"{meta.get('title', '')}\n{meta.get('description', '')}"
    tempos = sorted({int(m) for m in TEMPO.findall(text) if 30 <= int(m) <= 300})
    title_match = match_rudiment(meta.get("title") or "") == number
    comp = bool(COMPILATION.search(meta.get("title") or "")) and (meta.get("duration") or 0) > 420
    dur = meta.get("duration") or 0
    notes = []
    if comp:
        notes.append("compilation of several rudiments: needs trimming")
    if meta.get("chapters"):
        notes.append(f"{len(meta['chapters'])} chapters")
    if dur and dur < 60:
        notes.append("short")
    if w and h and h > w:
        notes.append("vertical")
    if "click" in text.lower() or "metronome" in text.lower():
        notes.append("mentions click or metronome")
    if meta.get("live_status") not in (None, "not_live"):
        notes.append(f"live: {meta.get('live_status')}")
    score = (3 if rep else 0) + (2 if title_match else 0) + (1 if 20 <= dur <= 720 else 0) \
        + (1 if (h and min(h, w or h) >= 720) else 0) + (1 if has60 else 0) \
        + (1 if view.get("hands_visible") == "yes" else 0) + (0.5 if view.get("angle") in ("side", "three-quarter") else 0) \
        + (0.5 if tempos else 0) + 0.4 * math.log10((meta.get("view_count") or 0) + 1) - (2 if comp else 0) \
        + (1 if content == "demo" else -1 if content.startswith("application") else -4)
    short_side = min(h or 0, w or h or 0)
    gate = []                      # reasons a CC-BY video is not downloaded for training
    if not title_match:
        gate.append("title does not name this rudiment")
    if content != "demo":
        gate.append(content)
    if comp:
        gate.append("compilation")
    if short_side and short_side < 480:
        gate.append(f"only {short_side}p")
    if (fps or 0) < 24:
        gate.append(f"{fps} fps")
    if dur > 1200:
        gate.append("longer than 20 minutes")
    if view.get("hands_visible") in ("no", "unknown") or view.get("angle") == "no player found":
        gate.append("no player or hands in the thumbnail")
    return {
        "rudiment_number": number, "rudiment": r["name"], "rudiment_supported": r["supported"],
        "video_id": meta["id"], "url": f"https://www.youtube.com/watch?v={meta['id']}", "title": meta.get("title"),
        "channel": meta.get("channel") or meta.get("uploader"), "channel_url": meta.get("channel_url"),
        "channel_followers": meta.get("channel_follower_count"), "reputable": "yes" if rep else "no", "reputable_reason": why,
        "license": license_short(meta.get("license")), "license_raw": meta.get("license") or "",
        "duration_s": dur, "width": w, "height": h, "fps": fps, "has_60fps": has60,
        "upload_date": meta.get("upload_date"), "view_count": meta.get("view_count"),
        "camera_angle": view.get("angle"), "hands_visible": view.get("hands_visible"),
        "view_source": view.get("source", "thumbnail (auto)"), "shoulder_ratio": view.get("shoulder_ratio"),
        "stated_tempo_bpm": " ".join(map(str, tempos)), "title_match": title_match, "compilation": comp,
        "content": content, "found_by": "; ".join(sorted(set(hits)))[:300], "notes": "; ".join(notes), "score": round(score, 2),
        "training_ok": license_short(meta.get("license")) == "CC-BY" and not gate,
        "training_skip_reason": "; ".join(gate) if license_short(meta.get("license")) == "CC-BY" else "not Creative Commons (link only)",
    }


def queries_for(r: dict) -> tuple[list[str], list[str]]:
    name = r["name"].replace("#", "")
    cc = [name, f"{name} rudiment", f"{name} drum", f"{name} snare", f"{name} practice pad",
          f"{name} lesson", f"{name} tutorial", f"how to play {name}"] + [f"{a} rudiment" for a in r["aliases"]]
    std = [f"{name} rudiment", f"{name} drum rudiment lesson", f"vic firth {name}", f"{name} rudiment practice pad",
           f"{name} snare drum"] + [f"{a} rudiment" for a in r["aliases"][:2]]
    return cc, std


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rudiments", default="", help="comma separated PAS numbers (default all 40)")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--workers", type=int, default=3, help="parallel searches")
    ap.add_argument("--pace", type=float, default=4.0, help="seconds between metadata requests (be polite)")
    ap.add_argument("--cc-results", type=int, default=40, help="results per Creative Commons search")
    ap.add_argument("--std-results", type=int, default=25, help="results per regular search")
    ap.add_argument("--std-meta", type=int, default=10, help="regular-license videos per rudiment to read full metadata for")
    a = ap.parse_args(argv)
    if not YTDLP:
        print("yt-dlp not found on PATH"); return 2
    wanted = {int(x) for x in a.rudiments.split(",") if x.strip()} or {r["number"] for r in RUDIMENTS}
    rudis = [r for r in RUDIMENTS if r["number"] in wanted]

    # 1. searches
    jobs = []
    for r in rudis:
        cc, std = queries_for(r)
        jobs += [(r["number"], q, True, a.cc_results) for q in cc] + [(r["number"], q, False, a.std_results) for q in std]
    jobs += [(0, q, True, 60) for q in ("40 essential rudiments", "40 drum rudiments", "drum rudiments", "snare rudiments")]
    jobs += [(0, q, True, 100) for q in ("drum rudiment lesson", "rudiment practice pad", "snare drum rudiment",
                                         "marching snare rudiment", "rudiment of the week", "drum rudiment tutorial",
                                         "rudiment slow motion", "hybrid rudiment")]
    jobs += [(0, q, False, 30) for q in ("40 essential rudiments", "PAS 40 international drum rudiments")]
    print(f"{len(jobs)} searches for {len(rudis)} rudiments", flush=True)
    with ThreadPoolExecutor(a.workers) as ex:
        results = list(ex.map(lambda j: (j, search(j[1], j[2], j[3], a.refresh)), jobs))

    pool: dict[tuple[int, str], dict] = {}           # (rudiment, video id) -> info
    cc_claimed: set[str] = set()
    flat: dict[str, dict] = {}
    drum_channels = set()      # channels with at least one clearly drum-related rudiment video
    for _, entries in results:
        for e in entries:
            num, label = match_label(e.get("title") or "")
            if num and label not in AMBIGUOUS and drum_context(e):
                drum_channels.add(e.get("channel_id"))
    for (num, q, cc, _), entries in results:
        for e in entries:
            flat[e["id"]] = e
            m, label = match_label(e.get("title") or "")
            if cc:
                cc_claimed.add(e["id"])
            if m is None or m not in wanted:
                continue
            if not (drum_context(e) or (label not in AMBIGUOUS and e.get("channel_id") in drum_channels)):
                continue
            item = pool.setdefault((m, e["id"]), {"hits": [], "cc_search": False})
            item["hits"].append(f"{'CC ' if cc else ''}'{q}'")
            item["cc_search"] |= cc

    # 2. which videos get full metadata: every CC-filter match, plus the top regular ones per rudiment
    def prelim(vid):
        e = flat[vid]
        rep, _ = is_reputable(e.get("channel"), None)
        return (3 if rep else 0) + 0.4 * math.log10((e.get("view_count") or 0) + 1) + (1 if 20 <= (e.get("duration") or 0) <= 720 else 0)
    need: set[str] = set()
    for r in rudis:
        items = [(vid, it) for (num, vid), it in pool.items() if num == r["number"]]
        need |= {vid for vid, it in items if it["cc_search"]}
        std = sorted((vid for vid, it in items if not it["cc_search"]), key=prelim, reverse=True)
        need |= set(std[:a.std_meta])
    # CC-filter matches first (their license must be confirmed), then the regular ones by promise
    order = sorted(need, key=lambda v: (not any(it["cc_search"] for (n, vid), it in pool.items() if vid == v), -prelim(v)))
    print(f"{len(pool)} title matches, reading metadata for {len(need)} videos", flush=True)
    metas, stopped = {}, None
    for i, vid in enumerate(order, 1):
        was_cached = (CACHE / "meta" / f"{vid}.json").exists() and not a.refresh
        try:
            metas[vid] = metadata(vid, a.refresh)
        except RateLimited as exc:
            stopped = f"stopped after {i - 1} of {len(order)} videos: YouTube rate limit ({exc}). Run again later to resume."
            print(stopped, flush=True)
            break
        if not was_cached:
            time.sleep(a.pace)
        if i % 50 == 0:
            print(f"  metadata {i}/{len(order)}", flush=True)

    # 3. rows (thumbnail pose runs in this thread: MediaPipe is not shared across threads)
    rows = []
    for (num, vid), it in sorted(pool.items()):
        meta = metas.get(vid)
        if not meta:
            continue
        rows.append(row_for(meta, num, it["hits"], {**thumb_view(meta, a.refresh), "source": "thumbnail (auto)"}))
    # a CC search result whose own metadata says Standard is recorded as Standard (the filter is not trusted)
    for row in rows:
        row["cc_search_but_standard"] = row["license"] != "CC-BY" and row["video_id"] in cc_claimed

    # 4. picks: every usable CC-BY video, and the best regular ones, per rudiment
    for r in rudis:
        mine = sorted([x for x in rows if x["rudiment_number"] == r["number"]], key=lambda x: -x["score"])
        std_picks = [x for x in mine if x["license"] != "CC-BY" and not x["compilation"] and x["title_match"]
                     and x["content"] == "demo"][:5]
        for x in mine:
            x["tier"] = "pick" if (x["training_ok"] or x in std_picks) else "also found"
    rows.sort(key=lambda x: (x["rudiment_number"], x["tier"] != "pick", x["license"] != "CC-BY", -x["score"]))

    OUT.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0].keys()) if rows else []
    existing = []
    if wanted != {r["number"] for r in RUDIMENTS} and (OUT / "catalog.json").exists():
        existing = [x for x in json.loads((OUT / "catalog.json").read_text(encoding="utf-8"))["videos"] if x["rudiment_number"] not in wanted]
    allrows = sorted(existing + rows, key=lambda x: (x["rudiment_number"], x["tier"] != "pick", x["license"] != "CC-BY", -x["score"]))
    with open(OUT / "catalog.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(allrows)
    (OUT / "catalog.json").write_text(json.dumps({
        "generated": time.strftime("%Y-%m-%d %H:%M %Z"), "method": "scripts/youtube_catalog.py (metadata only, license from each video's metadata)",
        "metadata_stopped": stopped, "metadata_read": sum(1 for v in metas.values() if v),
        "metadata_wanted": len(order), "title_matches": len(pool),
        "rudiments": RUDIMENTS, "videos": allrows}, indent=1, ensure_ascii=False), encoding="utf-8")
    cc_n = sum(1 for x in allrows if x["license"] == "CC-BY")
    print(f"wrote {len(allrows)} rows ({cc_n} CC-BY) to {OUT / 'catalog.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
