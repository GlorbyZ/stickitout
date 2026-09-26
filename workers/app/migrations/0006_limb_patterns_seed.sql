-- Foot and four-limb technique patterns. Short drills, not a groove curriculum.
-- R right hand, L left hand, K kick, H hi-hat foot.
-- vex_feet is the lower voice (kick and hi-hat foot); vex_notes is the hand voice.

INSERT OR IGNORE INTO patterns
  (id, slug, title, discipline, family, level, sticking, vex_notes, vex_feet, bpm_start, bpm_goal, tier, sort_index, notes)
VALUES
  -- Feet: beginner
  ('lmb-kick-singles', 'kick-singles', 'Kick Singles', 'feet', 'singles', 'beginner',
   'K K K K', NULL, 'f4/8, f4, f4, f4, f4, f4, f4, f4', 55, 130, 'free', 10, 'Even kick singles. Heel up, let the beater rebound.'),
  ('lmb-foot-alternate', 'foot-alternate', 'Kick And Hi-Hat Foot', 'feet', 'singles', 'beginner',
   'K H K H', NULL, 'f4/8, e4, f4, e4, f4, e4, f4, e4', 55, 120, 'free', 20, 'Alternate the two feet. Keep both weighted the same.'),
  ('lmb-kick-doubles', 'kick-doubles', 'Kick Doubles', 'feet', 'doubles', 'beginner',
   'K K  K K', NULL, 'f4/16, f4, f4, f4, f4, f4, f4, f4', 50, 120, 'free', 30, 'Two per stroke. Slide or rebound, pick one and stay with it.'),
  ('lmb-hihat-quarters', 'hihat-foot-quarters', 'Hi-Hat Foot Quarters', 'feet', 'singles', 'beginner',
   'H H H H', NULL, 'e4/4, e4, e4, e4', 60, 140, 'free', 40, 'Steady left foot under everything. Build the time feel.'),

  -- Feet: intermediate
  ('lmb-heel-toe', 'heel-toe-doubles', 'Heel-Toe Doubles', 'feet', 'heel-toe', 'intermediate',
   'K K  K K', NULL, 'f4/16, f4, f4, f4, f4, f4, f4, f4', 50, 125, 'member', 50, 'Heel drops for the first note, toe snaps the second.'),
  ('lmb-kick-triplets', 'kick-triplets', 'Kick Triplets', 'feet', 'triplets', 'intermediate',
   'K K K', NULL, 'f4/8, f4, f4, f4, f4, f4', 50, 115, 'member', 60, 'Three kicks per beat. Watch the third note flamming.'),
  ('lmb-foot-paradiddle', 'foot-paradiddle', 'Foot Paradiddle', 'feet', 'diddle', 'intermediate',
   'K H K K  H K H H', NULL, 'f4/16, e4, f4, f4, e4, f4, e4, e4', 50, 115, 'member', 70, 'Paradiddle sticking played with both feet.'),
  ('lmb-kick-five-stroke', 'kick-five-stroke', 'Kick Five Stroke', 'feet', 'doubles', 'intermediate',
   'K K H H K', NULL, 'f4/16, f4, e4, e4, f4/8', 50, 110, 'member', 80, 'Five stroke roll shape, feet only.'),

  -- Four-limb: beginner
  ('lmb-krrk', 'k-r-r-k', 'K R R K', 'four-limb', 'linear', 'beginner',
   'K R R K', 'r5/16, c5, c5, r5', 'f4/16, r4, r4, f4', 55, 130, 'free', 100, 'Kick, two hands, kick. The first four-limb pattern to own.'),
  ('lmb-rklk', 'r-k-l-k', 'R K L K', 'four-limb', 'linear', 'beginner',
   'R K L K', 'c5/16, r5, c5, r5', 'r4/16, f4, r4, f4', 55, 130, 'free', 110, 'Hand foot hand foot. Perfectly even spacing.'),
  ('lmb-krlr', 'k-r-l-r', 'K R L R', 'four-limb', 'linear', 'beginner',
   'K R L R', 'r5/16, c5, c5, c5', 'f4/16, r4, r4, r4', 55, 130, 'free', 120, 'Kick leads, three hands follow.'),
  ('lmb-rlkk', 'r-l-k-k', 'R L K K', 'four-limb', 'linear', 'beginner',
   'R L K K', 'c5/16, c5, r5, r5', 'r4/16, r4, f4, f4', 55, 125, 'free', 130, 'Hands then feet. Good for fill endings.'),

  -- Four-limb: intermediate
  ('lmb-linear-rlk', 'linear-r-l-k', 'Linear Singles R L K', 'four-limb', 'linear', 'intermediate',
   'R L K', 'c5/8, c5, r5', 'r4/8, r4, f4', 55, 125, 'member', 140, 'Three limb triplet. Nothing lands together.'),
  ('lmb-krkl', 'k-r-k-l', 'K R K L', 'four-limb', 'linear', 'intermediate',
   'K R K L', 'r5/16, c5, r5, c5', 'f4/16, r4, f4, r4', 55, 125, 'member', 150, 'Kick on every other note.'),
  ('lmb-rkrlkl', 'r-k-r-l-k-l', 'R K R L K L', 'four-limb', 'linear', 'intermediate',
   'R K R L K L', 'c5/8, r5, c5, c5, r5, c5', 'r4/8, f4, r4, r4, f4, r4', 50, 120, 'member', 160, 'Six note linear phrase, alternating lead.'),
  ('lmb-foot-under-eighths', 'foot-under-eighths', 'Foot Under Eighths', 'four-limb', 'linear', 'intermediate',
   'R L R L over K H', 'c5/8, c5, c5, c5, c5, c5, c5, c5', 'f4/4, e4, f4, e4', 50, 120, 'member', 170, 'Hands keep 8ths while the feet trade quarters.'),

  -- Four-limb: advanced (pro)
  ('lmb-linear-six', 'linear-six-grouping', 'Linear Six Grouping', 'four-limb', 'linear', 'advanced',
   'R L K R L K', 'c5/16, c5, r5, c5, c5, r5', 'r4/16, r4, f4, r4, r4, f4', 50, 115, 'pro', 200, 'Six note grouping that shifts against the beat.'),
  ('lmb-double-kick-fill', 'double-kick-into-fill', 'Double Kick Into Fill', 'four-limb', 'linear', 'advanced',
   'K K R L K K L R', 'r5/16, r5, c5, c5, r5, r5, c5, c5', 'f4/16, f4, r4, r4, f4, f4, r4, r4', 45, 110, 'pro', 210, 'Kick doubles feeding hand pairs. Keep the kicks matched.'),
  ('lmb-krrk-diddle', 'k-r-r-k-diddle', 'K R R K With Diddles', 'four-limb', 'diddle', 'advanced',
   'K R R K K L L K', 'r5/16, c5, c5, r5, r5, c5, c5, r5', 'f4/16, r4, r4, f4, f4, r4, r4, f4', 45, 110, 'pro', 220, 'K R R K on both hand leads, doubles on the feet.'),
  ('lmb-herta-foot', 'herta-with-foot', 'Herta With Foot', 'four-limb', 'linear', 'advanced',
   'K R L R', 'r5/16, c5, c5, c5', 'f4/16, r4, r4, r4', 45, 115, 'pro', 230, 'Four note burst, kick on the front. Fast and even.');
