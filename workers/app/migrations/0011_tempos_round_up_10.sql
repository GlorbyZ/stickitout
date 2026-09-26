-- 0011: Every tempo sits on a 10, rounded up (values already on a 10 stay).
-- Applies to every pattern that uses medal tiers (hands, feet, four-limb).
-- The app also rounds each tier threshold up to a 10 (ceilTo10 in patterns.ts), so
-- stored medals are recomputed here with the same rule: CAST((x + 9.99999) / 10 AS INTEGER) * 10
-- matches Math.ceil(x / 10) * 10 for these values without relying on SQLite math functions.

UPDATE patterns SET
  bpm_goal = CAST((bpm_goal + 9.99999) / 10 AS INTEGER) * 10,
  bpm_start = CAST((bpm_start + 9.99999) / 10 AS INTEGER) * 10
WHERE bpm_goal > 0 AND bpm_start > 0;

UPDATE pattern_progress SET medal = (
  SELECT CASE
    WHEN pattern_progress.best_bpm IS NULL OR pattern_progress.best_bpm <= 0 THEN 'dirt'
    WHEN pattern_progress.best_bpm >= CAST((p.bpm_goal * (220.0 / 190) + 9.99999) / 10 AS INTEGER) * 10 THEN 'insanity'
    WHEN pattern_progress.best_bpm >= CAST((p.bpm_goal * (200.0 / 190) + 9.99999) / 10 AS INTEGER) * 10 THEN 'legendary'
    WHEN pattern_progress.best_bpm >= CAST((p.bpm_goal * 1.0 + 9.99999) / 10 AS INTEGER) * 10 THEN 'diamond'
    WHEN pattern_progress.best_bpm >= CAST((p.bpm_goal * 0.92 + 9.99999) / 10 AS INTEGER) * 10 THEN 'platinum'
    WHEN pattern_progress.best_bpm >= CAST((p.bpm_goal * 0.8 + 9.99999) / 10 AS INTEGER) * 10 THEN 'gold'
    WHEN pattern_progress.best_bpm >= CAST((p.bpm_goal * 0.65 + 9.99999) / 10 AS INTEGER) * 10 THEN 'silver'
    WHEN pattern_progress.best_bpm >= CAST((p.bpm_goal * 0.5 + 9.99999) / 10 AS INTEGER) * 10 THEN 'bronze'
    ELSE 'dirt'
  END
  FROM patterns p WHERE p.id = pattern_progress.pattern_id
)
WHERE EXISTS (SELECT 1 FROM patterns p WHERE p.id = pattern_progress.pattern_id);
