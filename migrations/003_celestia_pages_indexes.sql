CREATE INDEX IF NOT EXISTS page_reactions_page_user_idx
  ON page_reactions (page_id, user_id);

CREATE INDEX IF NOT EXISTS user_pages_updated_at_public_idx
  ON user_pages (updated_at DESC)
  WHERE published = TRUE AND visibility = 'public';
