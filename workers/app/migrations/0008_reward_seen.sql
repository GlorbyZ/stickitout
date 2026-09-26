-- Existing rewards were already on the page, so they start seen.
-- New earns leave seen_at empty until the member opens the popup.

ALTER TABLE streak_rewards ADD COLUMN seen_at TEXT;
UPDATE streak_rewards SET seen_at = earned_at WHERE seen_at IS NULL;
