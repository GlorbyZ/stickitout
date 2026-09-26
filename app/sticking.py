"""Sticking check for single paradiddles (scope update).

Compares the per-stroke hand assignment with the cyclic pattern RLRR LRLL
(either starting hand, since LRLL RLRR is the same cycle shifted by 4). A small
Viterbi pass follows the pattern stroke by stroke and allows a re-sync (jump to
another position in the cycle) at a cost, so one dropped or extra stroke does
not mark everything after it wrong. Mismatches are reported as wrong-hand
breaks; jumps are reported as re-syncs.
"""
from __future__ import annotations

from . import tuning

PATTERN = "RLRRLRLL"
# The re-sync cost (default 2.0) is a tuning setting: see app/tuning.py.
MIN_STROKES = 8


def applies_to(rudiment: str | None) -> bool:
    name = (rudiment or "").lower()
    return "paradiddle" in name and not any(w in name for w in ("double", "triple", "paradiddle-diddle", "paradiddle diddle"))


def check_sticking(strokes: list[dict], rudiment: str | None) -> dict:
    base = {"checked": False, "rudiment": rudiment, "pattern": "RLRR LRLL", "sticking_accuracy_pct": None,
            "strokes_checked": 0, "wrong_hand": 0, "resyncs": 0, "leading_hand": None, "breaks": [], "reason": None}
    if not applies_to(rudiment):
        return {**base, "pattern": None, "reason": "The sticking check covers Single Paradiddle only."}
    seq = [(i, s) for i, s in enumerate(strokes) if s["hand"] in ("L", "R")]
    if len(seq) < MIN_STROKES:
        return {**base, "reason": f"Need at least {MIN_STROKES} strokes with a detected hand; found {len(seq)}. "
                                  "Hands come from video, so check framing and light."}

    resync_cost = float(tuning.current().sticking_resync_cost)
    n, m = len(seq), len(PATTERN)
    cost = [[0.0] * m for _ in range(n)]
    back = [[(0, False)] * m for _ in range(n)]
    for s in range(m):
        cost[0][s] = float(seq[0][1]["hand"] != PATTERN[s])
    for i in range(1, n):
        best_prev = min(range(m), key=lambda s: cost[i - 1][s])
        for s in range(m):
            stay = cost[i - 1][(s - 1) % m]
            jump = cost[i - 1][best_prev] + resync_cost
            miss = float(seq[i][1]["hand"] != PATTERN[s])
            if stay <= jump:
                cost[i][s], back[i][s] = stay + miss, ((s - 1) % m, False)
            else:
                cost[i][s], back[i][s] = jump + miss, (best_prev, True)
    state = min(range(m), key=lambda s: cost[n - 1][s])
    path, jumps = [0] * n, [False] * n
    for i in range(n - 1, -1, -1):
        path[i] = state
        if i:
            state, jumps[i] = back[i][state]

    breaks, wrong = [], 0
    for i, (idx, stroke) in enumerate(seq):
        expected = PATTERN[path[i]]
        stroke["expected_hand"] = expected
        if jumps[i]:
            breaks.append({"stroke_index": idx, "t": stroke["t"], "kind": "resync", "expected": None,
                           "played": stroke["hand"], "note": "Pattern restarted here (dropped, extra or unseen stroke)."})
        if stroke["hand"] != expected:
            wrong += 1
            breaks.append({"stroke_index": idx, "t": stroke["t"], "kind": "wrong_hand", "expected": expected,
                           "played": stroke["hand"], "note": f"Expected {expected}, played {stroke['hand']}."})
    first_group = path[0] - path[0] % 4
    return {**base, "checked": True, "sticking_accuracy_pct": round(100.0 * (n - wrong) / n, 2),
            "strokes_checked": n, "wrong_hand": wrong, "resyncs": sum(jumps),
            "leading_hand": PATTERN[first_group], "breaks": breaks}
