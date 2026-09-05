CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_pages (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
  slug TEXT NOT NULL CHECK (slug = LOWER(slug) AND slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  display_name VARCHAR(120) NOT NULL CHECK (CHAR_LENGTH(BTRIM(display_name)) > 0),
  bio VARCHAR(500) NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'unlisted', 'private')),
  published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  reactions_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  remix_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  entrance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config_version SMALLINT NOT NULL DEFAULT 1 CHECK (config_version = 1),
  configuration JSONB NOT NULL CHECK (jsonb_typeof(configuration) = 'object' AND configuration->>'configVersion' = '1'),
  views_count BIGINT NOT NULL DEFAULT 0 CHECK (views_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_pages_published_at_check CHECK ((published = FALSE AND published_at IS NULL) OR (published = TRUE AND published_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_pages_user_id_unique ON user_pages (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_pages_slug_lower_unique ON user_pages (LOWER(slug));
CREATE INDEX IF NOT EXISTS user_pages_public_lookup_idx ON user_pages (slug) WHERE published = TRUE AND visibility = 'public';

CREATE TABLE IF NOT EXISTS page_reactions (
  id UUID PRIMARY KEY,
  page_id UUID NOT NULL REFERENCES user_pages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
  reaction VARCHAR(32) NOT NULL CHECK (CHAR_LENGTH(BTRIM(reaction)) BETWEEN 1 AND 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT page_reactions_unique_reaction UNIQUE (page_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS page_reactions_page_id_idx ON page_reactions (page_id);

CREATE TABLE IF NOT EXISTS page_remixes (
  id UUID PRIMARY KEY,
  source_page_id UUID NOT NULL REFERENCES user_pages(id) ON DELETE CASCADE,
  remix_page_id UUID NOT NULL UNIQUE REFERENCES user_pages(id) ON DELETE CASCADE,
  remixer_user_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT page_remixes_no_self_reference CHECK (source_page_id <> remix_page_id)
);

CREATE INDEX IF NOT EXISTS page_remixes_source_page_id_idx ON page_remixes (source_page_id);
