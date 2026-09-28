"""Copy the local Stickitout Drive download into the training dataset.

Folder name is the rudiment. Files in a folder are recording order, oldest first,
and that order is bronze upward. A short folder stopped before the higher medals.
Eight takes is more than the ladder, so those medals are not guessed.
Bloopers are not a ladder. Labels stay draft because the files themselves are unlabeled.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DATASET_DIR", r"D:\Stickitout-dataset\clips")

from app import dataset  # noqa: E402

MEDALS = ("bronze", "silver", "gold", "platinum", "diamond", "legendary", "insanity")
RUDIMENT = {
    "singles": "Single Stroke Roll",
    "doubles": "Double Stroke Open Roll",
    "five stroke": "Five Stroke Roll",
    "seven stroke roll": "Seven Stroke Roll",
    "nine stroke roll": "Nine Stroke Roll",
    "paradiddles": "Single Paradiddle",
    "double paradiddles": "Double Paradiddle",
    "triple paradiddles": "Triple Paradiddle",
    "flams": "Flam",
}
VIDEO = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}


def main() -> int:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\epicn\Downloads\Stickitout-20260928T034535Z-1-001\Stickitout")
    dataset.DATASET_DIR = Path(os.environ["DATASET_DIR"])
    dataset.DATASET_DIR.mkdir(parents=True, exist_ok=True)
    ledger = dataset._load_share_ledger()
    added = 0
    for folder in sorted(p for p in src.iterdir() if p.is_dir()):
        files = sorted((p for p in folder.iterdir() if p.suffix.lower() in VIDEO), key=lambda p: p.name)
        name = folder.name.strip().lower()
        for i, path in enumerate(files, 1):
            key = f"drive|{path.name}|{path.stat().st_size}"
            if key in ledger["files"]:
                continue
            if name == "bloopers":
                note = "Blooper. Not a medal take. The file name does not say what went wrong."
                meta = {"take_type": "sloppy", "known_mistakes": note}
            else:
                rudiment = RUDIMENT.get(name, folder.name.strip())
                if len(files) <= len(MEDALS):
                    medal = MEDALS[i - 1]
                    missing = ", ".join(MEDALS[len(files):]) or "none"
                    note = (f"Unlabeled file. Recording order {i} of {len(files)}, read as {medal}. "
                            f"Medals not in this folder: {missing}.")
                else:
                    medal = ""
                    note = (f"Unlabeled file. Recording order {i} of {len(files)}. "
                            "More takes than medals, so no medal is assigned.")
                meta = {"rudiment": rudiment, "known_mistakes": note}
                if medal:
                    meta["form_comment"] = f"Inferred medal: {medal}. Confirm before marking done."
            clip_id, dest = dataset.create(f"{folder.name}-{i:02d}-{path.name}", path.suffix.lower(), "share", meta)
            dest.write_bytes(path.read_bytes())
            ledger["files"][key] = {"clip_id": clip_id, "name": path.name}
            dataset._save_share_ledger(ledger)
            added += 1
            print(f"{folder.name} {i}/{len(files)} -> {clip_id}", flush=True)
    print(f"added {added}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
