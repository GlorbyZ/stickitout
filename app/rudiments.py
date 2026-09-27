"""The 40 PAS International Drum Rudiments with the sticking the analyzer can check.

A sticking is one full cycle of hands (R and L), groups separated by spaces, and either hand
may lead (the mirror image is also accepted). Only rudiments made of full strokes can be checked:
the analyzer hears one onset per stroke and assigns each to a hand, so grace notes (flams and
drags) and buzz strokes cannot be represented. Those are marked unsupported with the reason
instead of being approximated. This table is used for weak labels on demo videos
(scripts/youtube_batch.py); the production sticking check still covers Single Paradiddle only.
"""
from __future__ import annotations

import re

GRACE = "Has grace notes (flams or drags). The analyzer detects one onset per stroke and merges notes closer than min_ioi_ms, so grace notes cannot be represented yet."
BUZZ = "Buzz (multiple bounce) strokes are not separate onsets, so there is no stroke-by-stroke sticking to check."

# number, name, family, sticking (None when unsupported), aliases, note
_TABLE = [
    (1, "Single Stroke Roll", "Single stroke roll", "R L", ("single strokes", "single stroke"), None),
    (2, "Single Stroke Four", "Single stroke roll", "R L", ("single stroke 4",),
     "Checked as continuous alternation (RLRL RLRL). A player who restarts each group on the same hand as LRLR would show breaks."),
    (3, "Single Stroke Seven", "Single stroke roll", "R L", ("single stroke 7",), "Continuous alternation: RLRLRLR LRLRLRL."),
    (4, "Multiple Bounce Roll", "Multiple bounce roll", None, ("buzz roll", "press roll", "multiple bounce"), BUZZ),
    (5, "Triple Stroke Roll", "Multiple bounce roll", "RRR LLL", ("triple stroke", "triple strokes"), None),
    (6, "Double Stroke Open Roll", "Double stroke roll", "RR LL", ("double stroke roll", "double strokes", "long roll"), None),
    (7, "Five Stroke Roll", "Double stroke roll", "RRLLR LLRRL", ("5 stroke roll",), None),
    (8, "Six Stroke Roll", "Double stroke roll", "R LL RR L", ("6 stroke roll",), None),
    (9, "Seven Stroke Roll", "Double stroke roll", "RRLLRRL LLRRLLR", ("7 stroke roll",), None),
    (10, "Nine Stroke Roll", "Double stroke roll", "RRLLRRLLR LLRRLLRRL", ("9 stroke roll",), None),
    (11, "Ten Stroke Roll", "Double stroke roll", "RRLLRRLL R L", ("10 stroke roll",), None),
    (12, "Eleven Stroke Roll", "Double stroke roll", "RRLLRRLLRRL LLRRLLRRLLR", ("11 stroke roll",), None),
    (13, "Thirteen Stroke Roll", "Double stroke roll", "RRLLRRLLRRLLR LLRRLLRRLLRRL", ("13 stroke roll",), None),
    (14, "Fifteen Stroke Roll", "Double stroke roll", "RRLLRRLLRRLLRRL LLRRLLRRLLRRLLR", ("15 stroke roll",), None),
    (15, "Seventeen Stroke Roll", "Double stroke roll", "RRLLRRLLRRLLRRLLR LLRRLLRRLLRRLLRRL", ("17 stroke roll",), None),
    (16, "Single Paradiddle", "Diddle", "RLRR LRLL", ("paradiddle",), None),
    (17, "Double Paradiddle", "Diddle", "RLRLRR LRLRLL", (), None),
    (18, "Triple Paradiddle", "Diddle", "RLRLRLRR LRLRLRLL", (), None),
    (19, "Single Paradiddle-Diddle", "Diddle", "RLRRLL", ("paradiddle diddle", "paradiddlediddle"), None),
    (20, "Flam", "Flam", None, (), GRACE),
    (21, "Flam Accent", "Flam", None, (), GRACE),
    (22, "Flam Tap", "Flam", None, (), GRACE),
    (23, "Flamacue", "Flam", None, (), GRACE),
    (24, "Flam Paradiddle", "Flam", None, ("flamadiddle",), GRACE),
    (25, "Single Flammed Mill", "Flam", None, ("flammed mill",), GRACE),
    (26, "Flam Paradiddle-Diddle", "Flam", None, ("flam paradiddle diddle",), GRACE),
    (27, "Pataflafla", "Flam", None, ("pata fla fla",), GRACE),
    (28, "Swiss Army Triplet", "Flam", None, (), GRACE),
    (29, "Inverted Flam Tap", "Flam", None, (), GRACE),
    (30, "Flam Drag", "Flam", None, (), GRACE),
    (31, "Drag", "Drag", None, ("ruff",), GRACE),
    (32, "Single Drag Tap", "Drag", None, ("single drag",), GRACE),
    (33, "Double Drag Tap", "Drag", None, ("double drag",), GRACE),
    (34, "Lesson 25", "Drag", None, ("lesson twenty five", "lesson twenty-five"), GRACE),
    (35, "Single Dragadiddle", "Drag", None, ("dragadiddle",), GRACE),
    (36, "Drag Paradiddle #1", "Drag", None, ("drag paradiddle 1", "drag paradiddle no. 1", "drag paradiddle number 1"), GRACE),
    (37, "Drag Paradiddle #2", "Drag", None, ("drag paradiddle 2", "drag paradiddle no. 2", "drag paradiddle number 2"), GRACE),
    (38, "Single Ratamacue", "Drag", None, (), GRACE),
    (39, "Double Ratamacue", "Drag", None, (), GRACE),
    (40, "Triple Ratamacue", "Drag", None, (), GRACE),
]

RUDIMENTS = [
    {"number": n, "name": name, "family": fam, "sticking": st, "supported": st is not None,
     "aliases": list(al), "note": note}
    for n, name, fam, st, al, note in _TABLE
]


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("#", "no")).strip("-")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower().replace("-", " ")).strip()


def find(name: str) -> dict | None:
    """Look a rudiment up by name, alias, slug or PAS number."""
    key = _norm(name)
    for r in RUDIMENTS:
        if key in {_norm(r["name"]), _norm(slug(r["name"])), str(r["number"])} | {_norm(a) for a in r["aliases"]}:
            return r
    return None


def mirror(pattern: str) -> str:
    return pattern.translate(str.maketrans("RL", "LR"))
