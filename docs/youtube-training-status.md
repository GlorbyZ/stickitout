# YouTube training: status (paused 2026-09-26, 11:21 PM MT)

Work stopped early at the parent's request. Nothing was contacted, no cookies were used, and only CC-BY videos are ever downloaded.

## Done
- Rudiment table for all 40 PAS rudiments in `app/rudiments.py`: 18 have a sticking, and 22 (the buzz roll, flams and drags) are marked unsupported. `check_sticking(..., pattern=...)` accepts either hand leading, and production behaviour is unchanged.
- Catalog (`scripts/youtube_catalog.py`): 610 searches, all 40 rudiments searched, with metadata read one video at a time (4 s apart).
  - `data/youtube/catalog.csv` and `catalog.json` hold 682 rows: 283 CC-BY and 399 Standard. Every license was read from the video's own metadata.
  - CC-BY exists for 39 rudiments. Lesson 25 has none.
  - From the earlier pass, 105 CC-BY videos passed the automatic gate (demo, 480p or better, 24 fps or better, player and hands visible). Flams, drags and rolls 10 to 18 are thin.
- Downloads: 1 test clip (iaV1SDyJoQ0). Clips analysed: 1.

## Early accuracy finding
In the test clip (paradiddle) the video matched only 20.6% of the audio hits. Sticking scored 80.4%, but shuffled hands scored 79.0%, so the result is at chance. With a resync cost of 2.0, random hands already score about 79% on paradiddles, which means the earlier 83% to 96% sticking results are weak evidence. `strict_pct` in the batch script measures sticking without resyncs. No thresholds were changed.

## Resume
1. Rebuild the catalog from the cache using the newer matching code: `.venv\Scripts\python.exe -m scripts.youtube_catalog`.
2. Downloads need about 11 GB and C: has only 3.4 GB free, so point them at D: (44 GB free): `$env:SIO_YOUTUBE_DIR="D:\Stickitout-dataset\youtube"; python -m scripts.youtube_download --include-thumb-fail`. Then delete the old test clip and its rows in downloads.csv and attribution.csv.
3. Review the check frames by eye and write `data/youtube/review.csv` (video_id, verdict, angle, hands, note).
4. Run `python -m scripts.youtube_batch`, then `python -m scripts.youtube_outreach`.
5. Write `docs/youtube-training.md` and update the README.
