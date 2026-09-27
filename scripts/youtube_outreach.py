"""Permission-request list: the best non-Creative-Commons demos per rudiment, grouped by creator.

Reads data/youtube/catalog.json and writes data/youtube/outreach.csv and outreach.md. Nothing is
sent: this is a list for a person to review before anyone contacts a creator.

Usage: python -m scripts.youtube_outreach [--per-rudiment 3]
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "youtube"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--per-rudiment", type=int, default=3)
    a = ap.parse_args(argv)
    cat = json.loads((OUT / "catalog.json").read_text(encoding="utf-8"))
    videos = [v for v in cat["videos"] if v["license"] != "CC-BY" and v["title_match"] and v["content"] == "demo"
              and not v["compilation"] and v["reputable"] == "yes"]
    per = defaultdict(list)
    for v in sorted(videos, key=lambda v: -v["score"]):
        if len(per[v["rudiment_number"]]) < a.per_rudiment:
            per[v["rudiment_number"]].append(v)
    creators = defaultdict(lambda: {"videos": [], "channel_url": "", "followers": None, "reason": ""})
    for num, vs in per.items():
        for v in vs:
            c = creators[v["channel"]]
            c["videos"].append(v)
            c["channel_url"] = v["channel_url"] or c["channel_url"]
            c["followers"] = v["channel_followers"] or c["followers"]
            c["reason"] = v["reputable_reason"]
    ranked = sorted(creators.items(), key=lambda kv: (-len({x["rudiment_number"] for x in kv[1]["videos"]}), -(kv[1]["followers"] or 0)))
    with open(OUT / "outreach.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["creator", "channel_url", "subscribers", "rudiments_covered", "rudiment", "title", "url", "fps", "height",
                    "camera_angle_auto", "hands_visible_auto"])
        for name, c in ranked:
            for v in sorted(c["videos"], key=lambda v: v["rudiment_number"]):
                w.writerow([name, c["channel_url"], c["followers"], len({x["rudiment_number"] for x in c["videos"]}), v["rudiment"],
                            v["title"], v["url"], v["fps"], v["height"], v["camera_angle"], v["hands_visible"]])
    lines = ["# Permission-request list (non Creative Commons)", "",
             "Best standard-license demos per rudiment (up to "
             f"{a.per_rudiment} each, reputable channels, title names the rudiment, a pad or snare demo), grouped by creator. "
             "These are links only: nothing was downloaded and nobody has been contacted.", ""]
    for name, c in ranked:
        rud = sorted({x["rudiment_number"] for x in c["videos"]})
        subs = f"{c['followers']:,} subscribers" if c["followers"] else "subscribers unknown"
        lines += [f"## {name}", "", f"{c['channel_url']} ({subs}, {len(rud)} rudiments)", ""]
        for v in sorted(c["videos"], key=lambda v: v["rudiment_number"]):
            lines.append(f"- {v['rudiment_number']}. {v['rudiment']}: [{v['title']}]({v['url']}) ({v['height']}p, {v['fps']} fps)")
        lines.append("")
    (OUT / "outreach.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"{len(ranked)} creators, {sum(len(c['videos']) for _, c in ranked)} videos, {len(per)} rudiments")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
