"""Correct the Drive-ladder labels and analyse every take except bloopers.

Oldest file in a folder is bronze. The last file is the highest medal he reached.
Seven medals fit exactly. Eight files means the last take is a second pass at insanity.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["DATASET_DIR"] = r"D:\Stickitout-dataset\clips"
os.environ["SIO_TEMP_TRAINING"] = "0"

from app import dataset  # noqa: E402
from app.labels import validate  # noqa: E402

dataset.DATASET_DIR = Path(os.environ["DATASET_DIR"])
MEDALS = ("bronze", "silver", "gold", "platinum", "diamond", "legendary", "insanity")


def main() -> int:
    removed = 0
    clips = []
    for folder in sorted(dataset.DATASET_DIR.iterdir()):
        labels_path = folder / "labels.json"
        if not labels_path.exists():
            continue
        data = json.loads(labels_path.read_text(encoding="utf-8"))
        name = (data.get("original_filename") or "").lower()
        if name.startswith("bloopers"):
            shutil.rmtree(folder, ignore_errors=True)
            removed += 1
            continue
        meta = data["meta"]
        note = meta.get("known_mistakes") or ""
        found = re.search(r"order (\d+) of (\d+)", note)
        if found:
            order, total = int(found.group(1)), int(found.group(2))
            medal = MEDALS[min(order, len(MEDALS)) - 1]
            extra = " Second pass at the top medal." if order > len(MEDALS) else ""
            meta["form_comment"] = f"Inferred medal: {medal}.{extra}"
            meta["known_mistakes"] = (
                f"Unlabeled take. Recording order {order} of {total}, read as {medal}. "
                "No clap. The rudiment starts immediately and runs 2 to 4 bars. Front camera. Clean take."
            )
        meta["camera_angle"] = "front"
        meta["take_type"] = "clean"
        meta["clap_t"] = None
        data["meta"] = validate(data)["meta"]
        data["status"] = "draft"
        labels_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        clips.append(data["clip_id"])
    print(f"removed {removed} bloopers, {len(clips)} takes to analyse", flush=True)
    for i, clip_id in enumerate(clips, 1):
        print(f"[{i}/{len(clips)}] {clip_id}", flush=True)
        dataset.process(clip_id)
        status = dataset.read_status(clip_id)
        print(f"  {status.get('state')} {status.get('error') or ''}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
