"""Pull finished videos from the shared drive into the training dataset.

The share is never modified. A file still being copied (changed in the last 20 seconds)
is skipped until the next run. Each file is imported once.

  $env:CLIP_SHARE = 'D:\path\to\shared\drive\folder'
  $env:DATASET_DIR = 'D:\Stickitout-dataset\clips'
  python -m scripts.import_share

The local server does the same every 30 seconds when CLIP_SHARE is set.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import config, dataset  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-process", action="store_true", help="copy the files only, do not analyse them")
    ap.add_argument("--settle", type=float, default=dataset.SHARE_SETTLE_S)
    a = ap.parse_args(argv)
    if not config.CLIP_SHARE:
        print("CLIP_SHARE is not set. Point it at the shared drive folder.", flush=True)
        return 1
    if not config.CLIP_SHARE.is_dir():
        print(f"Shared drive folder was not found: {config.CLIP_SHARE}", flush=True)
        return 1
    added = dataset.import_from_share(settle_s=a.settle)
    print(f"{len(added)} new clip(s) from {config.CLIP_SHARE}", flush=True)
    for item in added:
        print(f"  {item['clip_id']}  {item['name']}", flush=True)
        if not a.no_process:
            dataset.process(item["clip_id"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
