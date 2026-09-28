"""Rudiment table, the pattern sticking check, and the YouTube training helpers (no network)."""
import numpy as np
import pytest

from app import rudiments, sticking
from app.rudiments import RUDIMENTS, find, mirror


def strokes(hands, step=0.1):
    return [{"t": i * step, "hand": h} for i, h in enumerate(hands)]


def cycle(pattern, n, offset=0, flip=False):
    p = pattern.replace(" ", "")
    if flip:
        p = mirror(p)
    return list((p * (n // len(p) + 3))[offset:offset + n])


def test_table_has_all_40_pas_rudiments():
    assert [r["number"] for r in RUDIMENTS] == list(range(1, 41))
    assert len({r["name"] for r in RUDIMENTS}) == 40
    for r in RUDIMENTS:
        if r["supported"]:
            assert set(r["sticking"].replace(" ", "")) <= {"R", "L"}
        else:
            assert r["sticking"] is None and r["note"], r["name"]
    # every flam and drag rudiment is marked unsupported rather than approximated
    assert all(not r["supported"] for r in RUDIMENTS if r["family"] in ("Flam", "Drag"))
    assert not find("Multiple Bounce Roll")["supported"]
    assert sum(r["supported"] for r in RUDIMENTS) == 18


def test_find_by_alias_number_and_slug():
    assert find("paradiddle")["number"] == 16
    assert find("5 stroke roll")["number"] == 7
    assert find("drag-paradiddle-no2")["number"] == 37
    assert find("31")["name"] == "Drag"
    assert find("not a rudiment") is None


@pytest.mark.parametrize("r", [r for r in RUDIMENTS if r["supported"]], ids=lambda r: r["name"])
def test_pattern_check_accepts_either_lead(r):
    p = r["sticking"]
    n = max(40, 3 * len(p.replace(" ", "")))
    for flip in (False, True):
        res = sticking.check_sticking(strokes(cycle(p, n, offset=3, flip=flip)), r["name"], pattern=p)
        assert res["checked"] and res["sticking_accuracy_pct"] == 100.0 and res["resyncs"] == 0, (r["name"], flip, res)


def test_pattern_check_finds_wrong_hands_and_default_is_unchanged():
    hands = cycle("RR LL", 40)
    hands[10] = "L" if hands[10] == "R" else "R"
    res = sticking.check_sticking(strokes(hands), "Double Stroke Open Roll", pattern="RR LL")
    assert res["wrong_hand"] == 1 and res["sticking_accuracy_pct"] == 97.5
    # without a pattern the server behaviour is the same as before: paradiddle only
    assert not sticking.check_sticking(strokes(hands), "Double Stroke Open Roll")["checked"]
    assert sticking.check_sticking(strokes(cycle("RLRR LRLL", 32)), "Single Paradiddle")["pattern"] == "RLRR LRLL"
    with pytest.raises(ValueError):
        sticking.check_sticking(strokes(hands), "x", pattern="RXL")


def test_catalog_title_matching_and_content():
    from scripts import youtube_catalog as yc
    assert yc.match_rudiment("Flam Tap - Drum Rudiment Lesson (Drumeo)") == 22
    assert yc.match_rudiment("Single Paradiddle-Diddle | Vic Firth") == 19
    assert yc.match_rudiment("Drag Paradiddle #2") == 37
    assert yc.match_rudiment("Five Stroke Roll") == 7 and yc.match_rudiment("5 stroke roll") == 7
    assert yc.match_rudiment("How to hold drumsticks") is None
    assert yc.match_rudiment("Alex Barberis Drag Paradiddle") == 36          # not the plain paradiddle
    assert yc.match_rudiment("FLAM PARADIDLE-DIDLE RUDIMENT") == 26           # common misspelling
    assert yc.rudiments_named("Trpl Paradiddle + Dbl Paradiddle + Sgl Paradiddle") == {16, 17, 18}
    assert yc.rudiments_named("Flam Tap") == {22}                             # not also 'flam'
    assert yc.content_type("Single paradiddle & double paradiddle") == "several rudiments in one video"
    assert yc.content_type("Swiss Army Tripletの使い方").startswith("application")
    assert yc.content_type("How to Play Paradiddle on Cajon").startswith("other")
    assert yc.content_type("Funky paradiddle groove").startswith("application")
    assert yc.content_type("Paradiddle rudiment 96 to 200 bpm") == "demo"
    assert yc.license_short("Creative Commons Attribution license (reuse allowed)") == "CC-BY"
    assert yc.license_short(None) == "Standard"
    w, h, fps, has60 = yc.best_format({"formats": [{"h": 1080, "w": 1920, "fps": 30}, {"h": 720, "w": 1280, "fps": 60},
                                                   {"h": 1080, "w": 1920, "fps": 60}]})
    assert (h, fps, has60) == (1080, 60, True)


def test_batch_segment_finder_picks_the_playing():
    from scripts.youtube_batch import find_segment
    rng = np.random.default_rng(0)
    talk = np.sort(rng.uniform(0, 20, 30))                  # irregular onsets while talking
    play = 25 + np.arange(0, 16, 0.125)                     # 16th notes at 120 BPM from 25 s
    start, length, info = find_segment(np.concatenate([talk, play]), 60.0, 16.0)
    assert 23.0 <= start <= 27.0 and length == 16.0 and info["regular"] > 0.9
    assert find_segment(play - 25, 10.0, 16.0)[:2] == (0.0, 10.0)
