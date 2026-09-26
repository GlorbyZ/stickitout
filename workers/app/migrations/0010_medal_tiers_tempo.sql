-- 0010: Medal ladder gets Legendary (200) and Insanity (220) above Diamond, anchored on
-- Single Stroke Roll Diamond = 190 BPM held clean for 30 seconds. Every other rudiment's
-- Diamond tempo (bpm_goal) is rescaled off singles by a difficulty ratio; Start BPM scales
-- by the same factor. Lower tiers stay proportional (Bronze 50%, Silver 65%, Gold 80%,
-- Platinum 92% of Diamond). Hand fill drills and feet patterns keep their goals.
-- Stored medals are recomputed from each member's best clean BPM against the new goals.

UPDATE patterns SET bpm_goal = 190, bpm_start = 71 WHERE id = 'rud-single-stroke-roll'; -- Single Stroke Roll: 160 -> 190 (x1.00)
UPDATE patterns SET bpm_goal = 171, bpm_start = 73 WHERE id = 'rud-single-stroke-four'; -- Single Stroke Four: 140 -> 171 (x0.90)
UPDATE patterns SET bpm_goal = 171, bpm_start = 73 WHERE id = 'rud-single-stroke-seven'; -- Single Stroke Seven: 140 -> 171 (x0.90)
UPDATE patterns SET bpm_goal = 144, bpm_start = 72 WHERE id = 'rud-multiple-bounce-roll'; -- Multiple Bounce Roll: 120 -> 144 (x0.76)
UPDATE patterns SET bpm_goal = 152, bpm_start = 70 WHERE id = 'rud-triple-stroke-roll'; -- Triple Stroke Roll: 130 -> 152 (x0.80)
UPDATE patterns SET bpm_goal = 171, bpm_start = 68 WHERE id = 'rud-double-stroke-open-roll'; -- Double Stroke Open Roll: 150 -> 171 (x0.90)
UPDATE patterns SET bpm_goal = 171, bpm_start = 68 WHERE id = 'rud-five-stroke-roll'; -- Five Stroke Roll: 150 -> 171 (x0.90)
UPDATE patterns SET bpm_goal = 162, bpm_start = 69 WHERE id = 'rud-six-stroke-roll'; -- Six Stroke Roll: 140 -> 162 (x0.85)
UPDATE patterns SET bpm_goal = 167, bpm_start = 69 WHERE id = 'rud-seven-stroke-roll'; -- Seven Stroke Roll: 145 -> 167 (x0.88)
UPDATE patterns SET bpm_goal = 163, bpm_start = 70 WHERE id = 'rud-nine-stroke-roll'; -- Nine Stroke Roll: 140 -> 163 (x0.86)
UPDATE patterns SET bpm_goal = 156, bpm_start = 72 WHERE id = 'rud-ten-stroke-roll'; -- Ten Stroke Roll: 130 -> 156 (x0.82)
UPDATE patterns SET bpm_goal = 156, bpm_start = 72 WHERE id = 'rud-eleven-stroke-roll'; -- Eleven Stroke Roll: 130 -> 156 (x0.82)
UPDATE patterns SET bpm_goal = 152, bpm_start = 73 WHERE id = 'rud-thirteen-stroke-roll'; -- Thirteen Stroke Roll: 125 -> 152 (x0.80)
UPDATE patterns SET bpm_goal = 148, bpm_start = 68 WHERE id = 'rud-fifteen-stroke-roll'; -- Fifteen Stroke Roll: 120 -> 148 (x0.78)
UPDATE patterns SET bpm_goal = 144, bpm_start = 69 WHERE id = 'rud-seventeen-stroke-roll'; -- Seventeen Stroke Roll: 115 -> 144 (x0.76)
UPDATE patterns SET bpm_goal = 171, bpm_start = 64 WHERE id = 'rud-single-paradiddle'; -- Single Paradiddle: 160 -> 171 (x0.90)
UPDATE patterns SET bpm_goal = 167, bpm_start = 67 WHERE id = 'rud-double-paradiddle'; -- Double Paradiddle: 150 -> 167 (x0.88)
UPDATE patterns SET bpm_goal = 163, bpm_start = 67 WHERE id = 'rud-triple-paradiddle'; -- Triple Paradiddle: 145 -> 163 (x0.86)
UPDATE patterns SET bpm_goal = 163, bpm_start = 67 WHERE id = 'rud-single-paradiddle-diddle'; -- Single Paradiddle-Diddle: 145 -> 163 (x0.86)
UPDATE patterns SET bpm_goal = 156, bpm_start = 67 WHERE id = 'rud-flam'; -- Flam: 140 -> 156 (x0.82)
UPDATE patterns SET bpm_goal = 152, bpm_start = 65 WHERE id = 'rud-flam-accent'; -- Flam Accent: 140 -> 152 (x0.80)
UPDATE patterns SET bpm_goal = 156, bpm_start = 67 WHERE id = 'rud-flam-tap'; -- Flam Tap: 140 -> 156 (x0.82)
UPDATE patterns SET bpm_goal = 144, bpm_start = 66 WHERE id = 'rud-flamacue'; -- Flamacue: 130 -> 144 (x0.76)
UPDATE patterns SET bpm_goal = 148, bpm_start = 66 WHERE id = 'rud-flam-paradiddle'; -- Flam Paradiddle: 135 -> 148 (x0.78)
UPDATE patterns SET bpm_goal = 144, bpm_start = 66 WHERE id = 'rud-single-flammed-mill'; -- Single Flammed Mill: 130 -> 144 (x0.76)
UPDATE patterns SET bpm_goal = 144, bpm_start = 61 WHERE id = 'rud-flam-paradiddle-diddle'; -- Flam Paradiddle-Diddle: 130 -> 144 (x0.76)
UPDATE patterns SET bpm_goal = 141, bpm_start = 62 WHERE id = 'rud-pataflafla'; -- Pataflafla: 125 -> 141 (x0.74)
UPDATE patterns SET bpm_goal = 152, bpm_start = 65 WHERE id = 'rud-swiss-army-triplet'; -- Swiss Army Triplet: 140 -> 152 (x0.80)
UPDATE patterns SET bpm_goal = 141, bpm_start = 62 WHERE id = 'rud-inverted-flam-tap'; -- Inverted Flam Tap: 125 -> 141 (x0.74)
UPDATE patterns SET bpm_goal = 137, bpm_start = 63 WHERE id = 'rud-flam-drag'; -- Flam Drag: 120 -> 137 (x0.72)
UPDATE patterns SET bpm_goal = 156, bpm_start = 67 WHERE id = 'rud-drag'; -- Drag: 140 -> 156 (x0.82)
UPDATE patterns SET bpm_goal = 152, bpm_start = 68 WHERE id = 'rud-single-drag-tap'; -- Single Drag Tap: 135 -> 152 (x0.80)
UPDATE patterns SET bpm_goal = 143, bpm_start = 69 WHERE id = 'rud-double-drag-tap'; -- Double Drag Tap: 125 -> 143 (x0.75)
UPDATE patterns SET bpm_goal = 148, bpm_start = 68 WHERE id = 'rud-lesson-25'; -- Lesson 25 Two And Three Stroke: 130 -> 148 (x0.78)
UPDATE patterns SET bpm_goal = 143, bpm_start = 63 WHERE id = 'rud-single-dragadiddle'; -- Single Dragadiddle: 125 -> 143 (x0.75)
UPDATE patterns SET bpm_goal = 143, bpm_start = 63 WHERE id = 'rud-drag-paradiddle-1'; -- Drag Paradiddle #1: 125 -> 143 (x0.75)
UPDATE patterns SET bpm_goal = 137, bpm_start = 63 WHERE id = 'rud-drag-paradiddle-2'; -- Drag Paradiddle #2: 120 -> 137 (x0.72)
UPDATE patterns SET bpm_goal = 148, bpm_start = 68 WHERE id = 'rud-single-ratamacue'; -- Single Ratamacue: 130 -> 148 (x0.78)
UPDATE patterns SET bpm_goal = 141, bpm_start = 65 WHERE id = 'rud-double-ratamacue'; -- Double Ratamacue: 120 -> 141 (x0.74)
UPDATE patterns SET bpm_goal = 133, bpm_start = 64 WHERE id = 'rud-triple-ratamacue'; -- Triple Ratamacue: 115 -> 133 (x0.70)
UPDATE patterns SET bpm_goal = 141, bpm_start = 60 WHERE id = 'rud-cheese-paradiddle'; -- Cheese Paradiddle: 130 -> 141 (x0.74)
UPDATE patterns SET bpm_goal = 137, bpm_start = 60 WHERE id = 'rud-cheese-invert'; -- Cheese Invert: 125 -> 137 (x0.72)
UPDATE patterns SET bpm_goal = 141, bpm_start = 60 WHERE id = 'rud-swiss-tap'; -- Swiss Tap: 130 -> 141 (x0.74)
UPDATE patterns SET bpm_goal = 125, bpm_start = 54 WHERE id = 'rud-blue-rudiment'; -- Blue Rudiment: 115 -> 125 (x0.66)
UPDATE patterns SET bpm_goal = 125, bpm_start = 54 WHERE id = 'rud-pataflafla-cheese'; -- Cheese Pataflafla: 115 -> 125 (x0.66)

UPDATE pattern_progress SET medal = (
  SELECT CASE
    WHEN pattern_progress.best_bpm IS NULL OR pattern_progress.best_bpm <= 0 THEN 'dirt'
    WHEN pattern_progress.best_bpm >= ROUND(p.bpm_goal * (220.0 / 190)) THEN 'insanity'
    WHEN pattern_progress.best_bpm >= ROUND(p.bpm_goal * (200.0 / 190)) THEN 'legendary'
    WHEN pattern_progress.best_bpm >= ROUND(p.bpm_goal * 1.0) THEN 'diamond'
    WHEN pattern_progress.best_bpm >= ROUND(p.bpm_goal * 0.92) THEN 'platinum'
    WHEN pattern_progress.best_bpm >= ROUND(p.bpm_goal * 0.8) THEN 'gold'
    WHEN pattern_progress.best_bpm >= ROUND(p.bpm_goal * 0.65) THEN 'silver'
    WHEN pattern_progress.best_bpm >= ROUND(p.bpm_goal * 0.5) THEN 'bronze'
    ELSE 'dirt'
  END
  FROM patterns p WHERE p.id = pattern_progress.pattern_id
)
WHERE EXISTS (SELECT 1 FROM patterns p WHERE p.id = pattern_progress.pattern_id);
