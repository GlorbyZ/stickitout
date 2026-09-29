"""Rudiments we have recorded takes for, and how a take of each one should be read.

Anything not in this list is not offered on Analyze. The sticking, the note spacing,
and the sentence we lead with all come from here.
"""
from __future__ import annotations

TRAINED = (
    {
        "name": "Single Stroke Roll",
        "kind": "singles",
        "subdivision": 4,
        "play": "Singles: one hand, then the other, even. Both sticks the same height.",
    },
    {
        "name": "Double Stroke Open Roll",
        "kind": "doubles",
        "subdivision": 4,
        "play": "Doubles: two notes on the right, two on the left. Both notes of each double should sound the same.",
    },
    {
        "name": "Five Stroke Roll",
        "kind": "roll",
        "subdivision": 4,
        "play": "Five stroke roll: two doubles and a tap, then the other way. The tap is the note that turns it around.",
    },
    {
        "name": "Seven Stroke Roll",
        "kind": "roll",
        "subdivision": 4,
        "play": "Seven stroke roll: three doubles and a tap. Keep the doubles even and let the tap land on the click.",
    },
    {
        "name": "Nine Stroke Roll",
        "kind": "roll",
        "subdivision": 4,
        "play": "Nine stroke roll: four doubles and a tap. The doubles stay matched, and the tap is the release.",
    },
    {
        "name": "Single Paradiddle",
        "kind": "paradiddle",
        "subdivision": 4,
        "positions": True,
        "play": "Single paradiddle: single, single, double. The double is the note that switches hands.",
    },
    {
        "name": "Double Paradiddle",
        "kind": "paradiddle",
        "subdivision": 4,
        "play": "Double paradiddle: four singles, then a double. The double still has to sound like two even notes.",
    },
    {
        "name": "Triple Paradiddle",
        "kind": "paradiddle",
        "subdivision": 4,
        "play": "Triple paradiddle: six singles, then a double. Don't let the long run of singles rush into the double.",
    },
    {
        "name": "Flam",
        "kind": "flam",
        "subdivision": 4,
        "play": "A flam is a light grace note tucked into the main note. It should sound like one fat note, not two even hits.",
    },
)


def profile(name: str | None) -> dict | None:
    key = (name or "").strip().lower()
    for item in TRAINED:
        if item["name"].lower() == key:
            return item
    return None


def names() -> list[str]:
    return [item["name"] for item in TRAINED]
