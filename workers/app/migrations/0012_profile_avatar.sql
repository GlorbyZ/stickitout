-- Profile photo stored in R2. The key is avatars/{personId}.{ext}.
ALTER TABLE people ADD COLUMN avatar_key TEXT;
