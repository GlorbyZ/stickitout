"""Sticking check for single paradiddles (scope update).

Compares the per-stroke hand assignment with the cyclic pattern RLRR LRLL
(either starting hand, since LRLL RLRR is the same cycle shifted by 4). A small
Viterbi pass follows the pattern stroke by stroke and allows a re-sync (jump to
another position in the cycle) at a cost, so one dropped or extra stroke does
not mark everything after it wrong. Mismatches are reported as wrong-hand
breaks; jumps are reported as re-syncs.

check_sticking(..., pattern="RRLL") checks any full-stroke sticking from app/rudiments.py
instead (either hand leading). The server only uses the paradiddle default; the pattern
argument is for weak labels on demo videos (scripts/youtube_batch.py).
"""
from __future__ import annotations

from . import tuning

PATTERN = "RLRRLRLL"
# The re-sync cost (default 2.0) is a tuning setting: see app/tuning.py.
MIN_STROKES = 8


def applies_to(rudiment: str | None) -> bool:
    name = (rudiment or "").lower()
    return "paradiddle" in name and not any(w in name for w in ("double", "triple", "paradiddle-diddle", "paradiddle diddle"))


def _align(seq: list, pattern: str, resync_cost: float) -> tuple[float, list[int], list[bool]]:
    """Viterbi alignment of the played hands to a cyclic pattern. Returns (cost, positions, jumps)."""
    n, m = len(seq), len(pattern)
    cost = [[0.0] * m for _ in range(n)]
    back = [[(0, False)] * m for _ in range(n)]
    for s in range(m):
        cost[0][s] = float(seq[0][1]["hand"] != pattern[s])
    for i in range(1, n):
        best_prev = min(range(m), key=lambda s: cost[i - 1][s])
        for s in range(m):
            stay = cost[i - 1][(s - 1) % m]
            jump = cost[i - 1][best_prev] + resync_cost
            miss = float(seq[i][1]["hand"] != pattern[s])
            if stay <= jump:
                cost[i][s], back[i][s] = stay + miss, ((s - 1) % m, False)
            else:
                cost[i][s], back[i][s] = jump + miss, (best_prev, True)
    state = min(range(m), key=lambda s: cost[n - 1][s])
    total = cost[n - 1][state]
    path, jumps = [0] * n, [False] * n
    for i in range(n - 1, -1, -1):
        path[i] = state
        if i:
            state, jumps[i] = back[i][state]
    return total, path, jumps


def _orientations(pattern: str) -> list[str]:
    """The pattern and its mirror image (other hand leading), unless the mirror is just a rotation."""
    p = pattern.replace(" ", "")
    mir = p.translate(str.maketrans("RL", "LR"))
    return [pattern] if mir in p + p else [pattern, " ".join(g.translate(str.maketrans("RL", "LR")) for g in pattern.split())]


def check_sticking(strokes: list[dict], rudiment: str | None, pattern: str | None = None) -> dict:
    """Compare detected hands with the paradiddle (default) or with an explicit full-stroke pattern."""
    shown = pattern.strip() if pattern else "RLRR LRLL"
    base = {"checked": False, "rudiment": rudiment, "pattern": shown, "sticking_accuracy_pct": None,
            "strokes_checked": 0, "wrong_hand": 0, "resyncs": 0, "leading_hand": None, "breaks": [], "reason": None}
    if pattern is None and not applies_to(rudiment):
        return {**base, "pattern": None, "reason": "The sticking check covers Single Paradiddle only."}
    if pattern is not None and (not pattern.replace(" ", "") or set(pattern.replace(" ", "")) - {"R", "L"}):
        raise ValueError(f"pattern must be R and L only, got {pattern!r}")
    seq = [(i, s) for i, s in enumerate(strokes) if s["hand"] in ("L", "R")]
    if len(seq) < MIN_STROKES:
        return {**base, "reason": f"Need at least {MIN_STROKES} strokes with a detected hand; found {len(seq)}. "
                                  "Hands come from video, so check framing and light."}

    resync_cost = float(tuning.current().sticking_resync_cost)
    best = None
    for spaced in _orientations(shown):
        flat = spaced.replace(" ", "")
        total, path, jumps = _align(seq, flat, resync_cost)
        if best is None or total < best[0]:
            best = (total, path, jumps, spaced, flat)
    _, path, jumps, spaced, flat = best
    n = len(seq)

    breaks, wrong = [], 0
    for i, (idx, stroke) in enumerate(seq):
        expected = flat[path[i]]
        stroke["expected_hand"] = expected
        if jumps[i]:
            breaks.append({"stroke_index": idx, "t": stroke["t"], "kind": "resync", "expected": None,
                           "played": stroke["hand"], "note": "Pattern restarted here (dropped, extra or unseen stroke)."})
        if stroke["hand"] != expected:
            wrong += 1
            breaks.append({"stroke_index": idx, "t": stroke["t"], "kind": "wrong_hand", "expected": expected,
                           "played": stroke["hand"], "note": f"Expected {expected}, played {stroke['hand']}."})
    # Leading hand: the first hand of the group (space separated) the take started in.
    starts, pos = [], 0
    for g in spaced.split():
        starts.append(pos)
        pos += len(g)
    first_group = max(x for x in starts if x <= path[0])
    return {**base, "checked": True, "sticking_accuracy_pct": round(100.0 * (n - wrong) / n, 2),
            "strokes_checked": n, "wrong_hand": wrong, "resyncs": sum(jumps),
            "leading_hand": flat[first_group], "breaks": breaks}
