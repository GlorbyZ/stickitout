-- PAS 40 International Drum Rudiments plus hybrids, discipline = hands.
-- vex_notes is a VexFlow EasyScore rhythm line; sticking is the source of truth
-- for hand assignment and always renders as text.
-- Lowercase letters are grace notes (flams and drags).

INSERT OR IGNORE INTO patterns
  (id, slug, title, discipline, family, level, sticking, vex_notes, vex_feet, bpm_start, bpm_goal, tier, sort_index, notes)
VALUES
  -- Roll rudiments: single stroke
  ('rud-single-stroke-roll', 'single-stroke-roll', 'Single Stroke Roll', 'hands', 'roll', 'beginner',
   'R L R L R L R L', 'c5/8, c5, c5, c5, c5, c5, c5, c5', NULL, 60, 160, 'free', 10, 'Even singles. Same height, same sound.'),
  ('rud-single-stroke-four', 'single-stroke-four', 'Single Stroke Four', 'hands', 'roll', 'intermediate',
   'R L R L', 'c5/8, c5/8, c5/8, c5/4', NULL, 60, 140, 'member', 20, 'Four singles into an accent.'),
  ('rud-single-stroke-seven', 'single-stroke-seven', 'Single Stroke Seven', 'hands', 'roll', 'intermediate',
   'R L R L R L R', 'c5/8, c5, c5, c5, c5, c5, c5/4', NULL, 60, 140, 'member', 30, 'Six singles into a seventh accent.'),

  -- Roll rudiments: multiple bounce
  ('rud-multiple-bounce-roll', 'multiple-bounce-roll', 'Multiple Bounce Roll', 'hands', 'roll', 'intermediate',
   'R L R L', 'c5/8, c5, c5, c5, c5, c5, c5, c5', NULL, 60, 120, 'member', 40, 'Buzz roll. Let the stick bounce, keep the sound flat.'),
  ('rud-triple-stroke-roll', 'triple-stroke-roll', 'Triple Stroke Roll', 'hands', 'roll', 'intermediate',
   'R R R L L L', 'c5/8, c5, c5, c5, c5, c5', NULL, 60, 130, 'member', 50, 'Three per hand, evenly spaced.'),

  -- Roll rudiments: double stroke
  ('rud-double-stroke-open-roll', 'double-stroke-open-roll', 'Double Stroke Open Roll', 'hands', 'roll', 'beginner',
   'R R L L R R L L', 'c5/8, c5, c5, c5, c5, c5, c5, c5', NULL, 60, 150, 'free', 60, 'Open doubles. Both notes matched.'),
  ('rud-five-stroke-roll', 'five-stroke-roll', 'Five Stroke Roll', 'hands', 'roll', 'beginner',
   'R R L L R', 'c5/16, c5, c5, c5, c5/8', NULL, 60, 150, 'free', 70, 'Two doubles into an accent.'),
  ('rud-six-stroke-roll', 'six-stroke-roll', 'Six Stroke Roll', 'hands', 'roll', 'intermediate',
   'R L L R R L', 'c5/8, c5/16, c5, c5, c5, c5/8', NULL, 60, 140, 'member', 80, 'Accent, doubles, accent.'),
  ('rud-seven-stroke-roll', 'seven-stroke-roll', 'Seven Stroke Roll', 'hands', 'roll', 'beginner',
   'R R L L R R L', 'c5/16, c5, c5, c5, c5, c5, c5/8', NULL, 60, 145, 'free', 90, 'Three doubles into an accent.'),
  ('rud-nine-stroke-roll', 'nine-stroke-roll', 'Nine Stroke Roll', 'hands', 'roll', 'beginner',
   'R R L L R R L L R', 'c5/16, c5, c5, c5, c5, c5, c5, c5, c5/8', NULL, 60, 140, 'free', 100, 'Four doubles into an accent.'),
  ('rud-ten-stroke-roll', 'ten-stroke-roll', 'Ten Stroke Roll', 'hands', 'roll', 'advanced',
   'R R L L R R L L R L', 'c5/16, c5, c5, c5, c5, c5, c5, c5, c5/8, c5/8', NULL, 60, 130, 'member', 110, 'Four doubles into two singles.'),
  ('rud-eleven-stroke-roll', 'eleven-stroke-roll', 'Eleven Stroke Roll', 'hands', 'roll', 'advanced',
   'R R L L R R L L R R L', 'c5/16, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5/8', NULL, 60, 130, 'member', 120, 'Five doubles into an accent.'),
  ('rud-thirteen-stroke-roll', 'thirteen-stroke-roll', 'Thirteen Stroke Roll', 'hands', 'roll', 'advanced',
   'R R L L R R L L R R L L R', 'c5/16, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5/8', NULL, 60, 125, 'member', 130, 'Six doubles into an accent.'),
  ('rud-fifteen-stroke-roll', 'fifteen-stroke-roll', 'Fifteen Stroke Roll', 'hands', 'roll', 'advanced',
   'R R L L R R L L R R L L R R L', 'c5/16, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5/8', NULL, 55, 120, 'member', 140, 'Seven doubles into an accent.'),
  ('rud-seventeen-stroke-roll', 'seventeen-stroke-roll', 'Seventeen Stroke Roll', 'hands', 'roll', 'advanced',
   'R R L L R R L L R R L L R R L L R', 'c5/16, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5, c5/8', NULL, 55, 115, 'member', 150, 'Eight doubles into an accent.'),

  -- Diddle rudiments
  ('rud-single-paradiddle', 'single-paradiddle', 'Single Paradiddle', 'hands', 'diddle', 'beginner',
   'R L R R  L R L L', 'c5/16, c5, c5, c5, c5, c5, c5, c5', NULL, 60, 160, 'free', 160, 'The one everything else is built on.'),
  ('rud-double-paradiddle', 'double-paradiddle', 'Double Paradiddle', 'hands', 'diddle', 'beginner',
   'R L R L R R  L R L R L L', 'c5/8, c5, c5, c5, c5, c5', NULL, 60, 150, 'free', 170, 'Six notes, sits in triplets.'),
  ('rud-triple-paradiddle', 'triple-paradiddle', 'Triple Paradiddle', 'hands', 'diddle', 'beginner',
   'R L R L R L R R  L R L R L R L L', 'c5/16, c5, c5, c5, c5, c5, c5, c5', NULL, 60, 145, 'free', 180, 'Eight notes per hand lead.'),
  ('rud-single-paradiddle-diddle', 'single-paradiddle-diddle', 'Single Paradiddle-Diddle', 'hands', 'diddle', 'intermediate',
   'R L R R L L', 'c5/8, c5, c5, c5, c5, c5', NULL, 60, 145, 'member', 190, 'Stays on one hand lead. Great for grooves.'),

  -- Flam rudiments
  ('rud-flam', 'flam', 'Flam', 'hands', 'flam', 'beginner',
   'lR', 'c5/4, c5/4, c5/4, c5/4', NULL, 60, 140, 'free', 200, 'Grace note just before the main note. One sound, not two.'),
  ('rud-flam-accent', 'flam-accent', 'Flam Accent', 'hands', 'flam', 'beginner',
   'lR L R  rL R L', 'c5/8, c5, c5, c5, c5, c5', NULL, 60, 140, 'free', 210, 'Flam on the downbeat of each triplet.'),
  ('rud-flam-tap', 'flam-tap', 'Flam Tap', 'hands', 'flam', 'beginner',
   'lR R  rL L', 'c5/16, c5, c5, c5, c5, c5, c5, c5', NULL, 60, 140, 'free', 220, 'Flam then a tap with the same hand.'),
  ('rud-flamacue', 'flamacue', 'Flamacue', 'hands', 'flam', 'intermediate',
   'lR L R rL', 'c5/16, c5, c5, c5, c5/8', NULL, 60, 130, 'member', 230, 'Accent on the second note, not the flam.'),
  ('rud-flam-paradiddle', 'flam-paradiddle', 'Flam Paradiddle', 'hands', 'flam', 'intermediate',
   'lR L R R  rL R L L', 'c5/16, c5, c5, c5, c5, c5, c5, c5', NULL, 60, 135, 'member', 240, 'Paradiddle with a flam on the lead.'),
  ('rud-single-flammed-mill', 'single-flammed-mill', 'Single Flammed Mill', 'hands', 'flam', 'intermediate',
   'lR R L R  rL L R L', 'c5/16, c5, c5, c5, c5, c5, c5, c5', NULL, 60, 130, 'member', 250, 'Inverted paradiddle with a flam.'),
  ('rud-flam-paradiddle-diddle', 'flam-paradiddle-diddle', 'Flam Paradiddle-Diddle', 'hands', 'flam', 'advanced',
   'lR L R R L L', 'c5/8, c5, c5, c5, c5, c5', NULL, 55, 130, 'member', 260, 'Flam into paradiddle-diddle.'),
  ('rud-pataflafla', 'pataflafla', 'Pataflafla', 'hands', 'flam', 'advanced',
   'lR L R rL', 'c5/16, c5, c5, c5', NULL, 55, 125, 'member', 270, 'Flams on the outside notes.'),
  ('rud-swiss-army-triplet', 'swiss-army-triplet', 'Swiss Army Triplet', 'hands', 'flam', 'intermediate',
   'lR R L', 'c5/8, c5, c5', NULL, 60, 140, 'member', 280, 'Flam, same-hand tap, other hand. Fast triplet feel.'),
  ('rud-inverted-flam-tap', 'inverted-flam-tap', 'Inverted Flam Tap', 'hands', 'flam', 'advanced',
   'lR rL', 'c5/8, c5, c5, c5', NULL, 55, 125, 'member', 290, 'Alternating flams with the taps inverted.'),
  ('rud-flam-drag', 'flam-drag', 'Flam Drag', 'hands', 'flam', 'advanced',
   'lR rrL R', 'c5/8, c5, c5', NULL, 55, 120, 'member', 300, 'Flam, drag, accent.'),

  -- Drag rudiments
  ('rud-drag', 'drag', 'Drag', 'hands', 'drag', 'beginner',
   'llR', 'c5/4, c5/4, c5/4, c5/4', NULL, 60, 140, 'free', 310, 'Two grace notes into the main note.'),
  ('rud-single-drag-tap', 'single-drag-tap', 'Single Drag Tap', 'hands', 'drag', 'beginner',
   'llR L', 'c5/8, c5/8, c5/8, c5/8', NULL, 60, 135, 'free', 320, 'Drag then a tap.'),
  ('rud-double-drag-tap', 'double-drag-tap', 'Double Drag Tap', 'hands', 'drag', 'intermediate',
   'llR llR L', 'c5/8, c5, c5', NULL, 60, 125, 'member', 330, 'Two drags into a tap.'),
  ('rud-lesson-25', 'lesson-25', 'Lesson 25 Two And Three Stroke', 'hands', 'drag', 'intermediate',
   'llR L R', 'c5/8, c5, c5', NULL, 60, 130, 'member', 340, 'Drag into two singles.'),
  ('rud-single-dragadiddle', 'single-dragadiddle', 'Single Dragadiddle', 'hands', 'drag', 'advanced',
   'R rrR L R R', 'c5/16, c5, c5, c5', NULL, 55, 125, 'member', 350, 'Paradiddle with a drag inside it.'),
  ('rud-drag-paradiddle-1', 'drag-paradiddle-1', 'Drag Paradiddle #1', 'hands', 'drag', 'advanced',
   'R llR L R R', 'c5/8, c5/16, c5, c5, c5', NULL, 55, 125, 'member', 360, 'Accent, drag, paradiddle.'),
  ('rud-drag-paradiddle-2', 'drag-paradiddle-2', 'Drag Paradiddle #2', 'hands', 'drag', 'advanced',
   'R R llR L R R', 'c5/8, c5, c5/16, c5, c5, c5', NULL, 55, 120, 'member', 370, 'Two accents, drag, paradiddle.'),
  ('rud-single-ratamacue', 'single-ratamacue', 'Single Ratamacue', 'hands', 'drag', 'intermediate',
   'llR L R L', 'c5/8, c5, c5, c5', NULL, 60, 130, 'member', 380, 'Drag into three singles, accent on the last.'),
  ('rud-double-ratamacue', 'double-ratamacue', 'Double Ratamacue', 'hands', 'drag', 'advanced',
   'llR llR L R L', 'c5/8, c5, c5, c5, c5', NULL, 55, 120, 'member', 390, 'Two drags into the ratamacue.'),
  ('rud-triple-ratamacue', 'triple-ratamacue', 'Triple Ratamacue', 'hands', 'drag', 'advanced',
   'llR llR llR L R L', 'c5/8, c5, c5, c5, c5, c5', NULL, 55, 115, 'member', 400, 'Three drags into the ratamacue.'),

  -- Hybrids (pro tier)
  ('rud-cheese-paradiddle', 'cheese-paradiddle', 'Cheese Paradiddle', 'hands', 'hybrid', 'advanced',
   'lRL R R  rLR L L', 'c5/16, c5, c5, c5, c5, c5, c5, c5', NULL, 55, 130, 'pro', 500, 'Flam with a diddled grace note inside a paradiddle.'),
  ('rud-cheese-invert', 'cheese-invert', 'Cheese Invert', 'hands', 'hybrid', 'advanced',
   'lRL R L  rLR L R', 'c5/16, c5, c5, c5, c5, c5, c5, c5', NULL, 55, 125, 'pro', 510, 'Cheese on the inverted paradiddle.'),
  ('rud-swiss-tap', 'swiss-tap', 'Swiss Tap', 'hands', 'hybrid', 'advanced',
   'lR R L L', 'c5/16, c5, c5, c5', NULL, 55, 130, 'pro', 520, 'Swiss army triplet with an added tap.'),
  ('rud-blue-rudiment', 'blue-rudiment', 'Blue Rudiment', 'hands', 'hybrid', 'advanced',
   'llR L llR L R', 'c5/8, c5, c5, c5, c5', NULL, 50, 115, 'pro', 530, 'Drag pattern from the drum corps world.'),
  ('rud-pataflafla-cheese', 'cheese-pataflafla', 'Cheese Pataflafla', 'hands', 'hybrid', 'advanced',
   'lRL R L rLR', 'c5/16, c5, c5, c5', NULL, 50, 115, 'pro', 540, 'Pataflafla with diddled grace notes.');
