const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { pageInputSchema, parsePageConfiguration, createDefaultPageConfiguration, PAGE_WIDGET_TYPES } = require('./services/page-config');

const CANVAS_ID = 'main-wall';
const defaultCanvasState = {
  version: '6.9.1',
  width: 1200,
  height: 700,
  backgroundColor: '#080b12',
  objects: []
};

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: Number(process.env.DATABASE_POOL_MAX) || 5
    })
  : null;

let canvasState = structuredClone(defaultCanvasState);
let musicTracks = [];
let userPages = [];
let pageReactions = [];
let pageRemixes = [];

function normalizeCanvasState(state) {
  return {
    ...structuredClone(defaultCanvasState),
    ...(state || {}),
    objects: Array.isArray(state?.objects) ? structuredClone(state.objects) : []
  };
}

async function initCanvasDatabase() {
  if (!pool) {
    console.warn('DATABASE_URL is not configured; using in-memory development storage.');
    canvasState = structuredClone(defaultCanvasState);
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_state (
      id TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      discord_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      global_name TEXT,
      avatar TEXT,
      is_member BOOLEAN NOT NULL DEFAULT FALSE,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS global_name TEXT,
      ADD COLUMN IF NOT EXISTS avatar TEXT,
      ADD COLUMN IF NOT EXISTS is_member BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS music_tracks (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artwork_url TEXT,
      comment TEXT,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      global_name TEXT,
      avatar TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await runMigrations();

  const result = await pool.query('SELECT state FROM canvas_state WHERE id = $1', [CANVAS_ID]);
  if (!result.rows.length) {
    canvasState = structuredClone(defaultCanvasState);
    await pool.query(
      'INSERT INTO canvas_state (id, state) VALUES ($1, $2::jsonb)',
      [CANVAS_ID, JSON.stringify(canvasState)]
    );
    return;
  }

  canvasState = normalizeCanvasState(result.rows[0].state);
}

async function runMigrations() {
  if (!pool) return { skipped: true, applied: [] };

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrations = [{
    id: '001_celestia_pages',
    file: path.join(__dirname, 'migrations', '001_celestia_pages.sql')
  }, {
    id: '003_celestia_pages_indexes',
    file: path.join(__dirname, 'migrations', '003_celestia_pages_indexes.sql')
  }, {
    id: '004_remove_page_widgets',
    file: path.join(__dirname, 'migrations', '004_remove_page_widgets.sql')
  }];
  const applied = [];

  for (const migration of migrations) {
    const existing = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [migration.id]);
    if (existing.rowCount) continue;

    const sql = await fs.readFile(migration.file, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      await client.query('COMMIT');
      applied.push(migration.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return { skipped: false, applied };
}

function getDatabasePool() {
  return pool;
}

function getCanvasState() {
  return structuredClone(canvasState);
}

async function saveCanvasState(nextState) {
  canvasState = normalizeCanvasState(nextState);
  if (!pool) return getCanvasState();

  await pool.query(`
    INSERT INTO canvas_state (id, state, updated_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE
    SET state = EXCLUDED.state, updated_at = NOW()
  `, [CANVAS_ID, JSON.stringify(canvasState)]);

  return getCanvasState();
}

async function saveUser(user) {
  if (!pool || !user?.id) return;

  await pool.query(`
    INSERT INTO users (discord_id, username, global_name, avatar, is_member, first_seen, last_seen)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    ON CONFLICT (discord_id) DO UPDATE SET
      username = EXCLUDED.username,
      global_name = EXCLUDED.global_name,
      avatar = EXCLUDED.avatar,
      is_member = EXCLUDED.is_member,
      last_seen = NOW()
  `, [
    user.id,
    user.username || user.id,
    user.global_name || user.username || user.id,
    user.avatar || null,
    Boolean(user.isMember)
  ]);
}

function normalizeMusicTrack(track) {
  const author = track.author || {};
  return {
    id: track.id,
    sourceUrl: track.source_url || track.sourceUrl,
    provider: track.provider,
    providerId: track.provider_id || track.providerId,
    title: track.title,
    artworkUrl: track.artwork_url || track.artworkUrl || null,
    comment: track.comment || null,
    author: {
      id: track.user_id || track.userId || author.id,
      username: track.username || author.username,
      global_name: track.global_name || track.globalName || author.global_name || author.globalName || track.username || author.username,
      avatar: track.avatar || author.avatar || null
    },
    createdAt: track.created_at instanceof Date ? track.created_at.toISOString() : (track.created_at || track.createdAt)
  };
}

async function listMusicTracks(limit = 80) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 80, 100));
  if (!pool) return structuredClone(musicTracks.slice(0, safeLimit));

  const result = await pool.query(`
    SELECT id, source_url, provider, provider_id, title, artwork_url, comment,
      user_id, username, global_name, avatar, created_at
    FROM music_tracks
    ORDER BY created_at DESC
    LIMIT $1
  `, [safeLimit]);
  return result.rows.map(normalizeMusicTrack);
}

async function getMusicTrackById(id) {
  if (!pool) return structuredClone(musicTracks.find((track) => track.id === id) || null);

  const result = await pool.query(`
    SELECT id, source_url, provider, provider_id, title, artwork_url, comment,
      user_id, username, global_name, avatar, created_at
    FROM music_tracks
    WHERE id = $1
  `, [id]);
  return result.rows[0] ? normalizeMusicTrack(result.rows[0]) : null;
}

async function createMusicTrack(track) {
  const payload = {
    id: crypto.randomUUID(),
    ...track,
    createdAt: new Date().toISOString()
  };

  if (!pool) {
    const stored = normalizeMusicTrack(payload);
    musicTracks.unshift(stored);
    return structuredClone(stored);
  }

  const result = await pool.query(`
    INSERT INTO music_tracks (
      id, source_url, provider, provider_id, title, artwork_url, comment,
      user_id, username, global_name, avatar
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id, source_url, provider, provider_id, title, artwork_url, comment,
      user_id, username, global_name, avatar, created_at
  `, [
    payload.id,
    payload.sourceUrl,
    payload.provider,
    payload.providerId,
    payload.title,
    payload.artworkUrl,
    payload.comment,
    payload.author.id,
    payload.author.username,
    payload.author.global_name,
    payload.author.avatar
  ]);
  return normalizeMusicTrack(result.rows[0]);
}

async function deleteMusicTrack(id) {
  if (!pool) {
    const index = musicTracks.findIndex((track) => track.id === id);
    if (index === -1) return false;
    musicTracks.splice(index, 1);
    return true;
  }

  const result = await pool.query('DELETE FROM music_tracks WHERE id = $1', [id]);
  return result.rowCount > 0;
}

function mergePageConfiguration(base, value) {
  if (!value || typeof value !== 'object') return structuredClone(base);
  const result = structuredClone(base);
  Object.keys(base).forEach((key) => {
    if (!(key in value)) return;
    if (Array.isArray(base[key])) result[key] = structuredClone(value[key]);
    else if (base[key] && typeof base[key] === 'object' && value[key] && typeof value[key] === 'object') result[key] = mergePageConfiguration(base[key], value[key]);
    else result[key] = value[key];
  });
  return result;
}

function normalizePageConfiguration(configuration) {
  const legacy = structuredClone(configuration || {});
  if (Array.isArray(legacy.tabs)) legacy.tabs = legacy.tabs.map((tab) => ({ id: tab.id, label: tab.label, transition: tab.transition || 'fade', visible: tab.visible !== false }));
  if (Array.isArray(legacy.elements)) legacy.elements = legacy.elements.filter((element) => element.type !== 'widget' || PAGE_WIDGET_TYPES.includes(element.widgetData?.kind));
  const normalized = mergePageConfiguration(createDefaultPageConfiguration(), legacy);
  if (legacy.musicPlayer?.sourceUrl && !legacy.musicPlayer.audioUrl) normalized.musicPlayer.audioUrl = legacy.musicPlayer.sourceUrl;
  if (legacy.cursor?.type === 'dot' || legacy.cursor?.type === 'sparkle') {
    normalized.cursor.type = 'default';
    normalized.cursor.trail = legacy.cursor.type === 'sparkle' ? 'sparkles' : 'bubbles';
  }
  if (legacy.entranceScreen?.title && !legacy.entranceScreen.text) normalized.entranceScreen.text = legacy.entranceScreen.title;
  return normalized;
}

function normalizeUserPage(page) {
  if (!page) return null;

  return {
    id: page.id,
    userId: page.user_id || page.userId,
    slug: page.slug,
    displayName: page.display_name || page.displayName,
    bio: page.bio,
    visibility: page.visibility,
    published: Boolean(page.published),
    publishedAt: page.published_at instanceof Date ? page.published_at.toISOString() : (page.published_at || page.publishedAt || null),
    reactionsEnabled: Boolean(page.reactions_enabled ?? page.reactionsEnabled),
    remixEnabled: Boolean(page.remix_enabled ?? page.remixEnabled),
    entranceEnabled: Boolean(page.entrance_enabled ?? page.entranceEnabled),
    configVersion: Number(page.config_version || page.configVersion),
    configuration: normalizePageConfiguration(page.configuration),
    viewsCount: Number(page.views_count ?? page.viewsCount ?? 0),
    createdAt: page.created_at instanceof Date ? page.created_at.toISOString() : (page.created_at || page.createdAt),
    updatedAt: page.updated_at instanceof Date ? page.updated_at.toISOString() : (page.updated_at || page.updatedAt)
  };
}

function createPagePayload(userId, input, id = crypto.randomUUID()) {
  if (!userId || typeof userId !== 'string') throw new TypeError('A Discord user ID is required.');

  const data = pageInputSchema.parse(input);
  const now = new Date().toISOString();
  return {
    id,
    userId,
    slug: data.slug,
    displayName: data.displayName,
    bio: data.bio,
    visibility: data.visibility,
    published: data.published,
    publishedAt: data.published ? now : null,
    reactionsEnabled: data.reactionsEnabled,
    remixEnabled: data.remixEnabled,
    entranceEnabled: data.entranceEnabled,
    configVersion: data.configuration.configVersion,
    configuration: parsePageConfiguration(data.configuration),
    viewsCount: 0,
    createdAt: now,
    updatedAt: now
  };
}

async function getUserPageByUserId(userId) {
  if (!pool) return structuredClone(userPages.find((page) => page.userId === userId) || null);

  const result = await pool.query('SELECT * FROM user_pages WHERE user_id = $1', [userId]);
  return normalizeUserPage(result.rows[0]);
}

async function getUserPageBySlug(slug) {
  if (typeof slug !== 'string') return null;
  const normalizedSlug = slug.trim().toLowerCase();
  if (!pool) return structuredClone(userPages.find((page) => page.slug === normalizedSlug) || null);

  const result = await pool.query('SELECT * FROM user_pages WHERE slug = $1', [normalizedSlug]);
  return normalizeUserPage(result.rows[0]);
}

async function listPublishedUserPages() {
  if (!pool) {
    return userPages
      .filter((page) => page.published && page.visibility === 'public')
      .map((page) => ({ slug: page.slug, updatedAt: page.updatedAt }));
  }
  const result = await pool.query('SELECT slug, updated_at FROM user_pages WHERE published = TRUE AND visibility = \'public\' ORDER BY updated_at DESC');
  return result.rows.map((row) => ({
    slug: row.slug,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  }));
}

async function recordUserPageView(slug) {
  if (!pool) {
    userPages = userPages.map((item) => item.slug === slug && item.published && item.visibility === 'public'
      ? { ...item, viewsCount: (item.viewsCount || 0) + 1 }
      : item);
    return structuredClone(userPages.find((item) => item.slug === slug && item.published && item.visibility === 'public') || null);
  }
  const result = await pool.query('UPDATE user_pages SET views_count = views_count + 1 WHERE slug = $1 AND published = TRUE AND visibility = \'public\' RETURNING *', [slug]);
  return normalizeUserPage(result.rows[0]);
}

async function createUserPage(userId, input) {
  const payload = createPagePayload(userId, input);
  if (!pool) {
    if (userPages.some((page) => page.userId === userId || page.slug === payload.slug)) {
      const error = new Error('A page already exists for this user or slug.');
      error.code = '23505';
      throw error;
    }
    userPages.push(payload);
    return structuredClone(payload);
  }

  const result = await pool.query(`
    INSERT INTO user_pages (
      id, user_id, slug, display_name, bio, visibility, published, published_at,
      reactions_enabled, remix_enabled, entrance_enabled,
      config_version, configuration, views_count, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, NOW(), NOW()
    )
    RETURNING *
  `, [
    payload.id, payload.userId, payload.slug, payload.displayName, payload.bio,
    payload.visibility, payload.published, payload.publishedAt, payload.reactionsEnabled,
    payload.remixEnabled, payload.entranceEnabled,
    payload.configVersion, JSON.stringify(payload.configuration), payload.viewsCount
  ]);
  return normalizeUserPage(result.rows[0]);
}

async function updateUserPage(userId, input) {
  const current = await getUserPageByUserId(userId);
  if (!current) return null;

  const payload = createPagePayload(userId, input, current.id);
  payload.createdAt = current.createdAt;
  payload.viewsCount = current.viewsCount;
  payload.publishedAt = payload.published ? (current.publishedAt || payload.updatedAt) : null;

  if (!pool) {
    const duplicate = userPages.find((page) => page.slug === payload.slug && page.id !== current.id);
    if (duplicate) {
      const error = new Error('This page slug is already in use.');
      error.code = '23505';
      throw error;
    }
    userPages = userPages.map((page) => page.id === current.id ? payload : page);
    return structuredClone(payload);
  }

  const result = await pool.query(`
    UPDATE user_pages
    SET slug = $2, display_name = $3, bio = $4, visibility = $5, published = $6,
      published_at = $7, reactions_enabled = $8, remix_enabled = $9,
      entrance_enabled = $10, config_version = $11,
      configuration = $12::jsonb, updated_at = NOW()
    WHERE user_id = $1
    RETURNING *
  `, [
    userId, payload.slug, payload.displayName, payload.bio, payload.visibility,
    payload.published, payload.publishedAt, payload.reactionsEnabled,
    payload.remixEnabled, payload.entranceEnabled,
    payload.configVersion, JSON.stringify(payload.configuration)
  ]);
  return normalizeUserPage(result.rows[0]);
}

async function getPageReactionSummary(pageId, userId = null) {
  if (!pool) {
    const rows = pageReactions.filter((item) => item.pageId === pageId);
    const counts = rows.reduce((result, item) => ({ ...result, [item.reaction]: (result[item.reaction] || 0) + 1 }), {});
    return { counts, userReactions: userId ? rows.filter((item) => item.userId === userId).map((item) => item.reaction) : [] };
  }
  const [countsResult, userResult] = await Promise.all([
    pool.query('SELECT reaction, COUNT(*)::int AS count FROM page_reactions WHERE page_id = $1 GROUP BY reaction', [pageId]),
    userId ? pool.query('SELECT reaction FROM page_reactions WHERE page_id = $1 AND user_id = $2', [pageId, userId]) : Promise.resolve({ rows: [] })
  ]);
  return { counts: Object.fromEntries(countsResult.rows.map((row) => [row.reaction, Number(row.count)])), userReactions: userResult.rows.map((row) => row.reaction) };
}

async function addPageReaction({ pageId, userId, reaction }) {
  if (!pool) {
    if (!pageReactions.some((item) => item.pageId === pageId && item.userId === userId && item.reaction === reaction)) pageReactions.push({ id: crypto.randomUUID(), pageId, userId, reaction });
    return getPageReactionSummary(pageId, userId);
  }
  await pool.query('INSERT INTO page_reactions (id, page_id, user_id, reaction) VALUES ($1, $2, $3, $4) ON CONFLICT (page_id, user_id, reaction) DO NOTHING', [crypto.randomUUID(), pageId, userId, reaction]);
  return getPageReactionSummary(pageId, userId);
}

async function removePageReaction({ pageId, userId, reaction }) {
  if (!pool) { pageReactions = pageReactions.filter((item) => item.pageId !== pageId || item.userId !== userId || item.reaction !== reaction); return getPageReactionSummary(pageId, userId); }
  await pool.query('DELETE FROM page_reactions WHERE page_id = $1 AND user_id = $2 AND reaction = $3', [pageId, userId, reaction]);
  return getPageReactionSummary(pageId, userId);
}

async function createPageRemix({ sourcePageId, remixPageId, remixerUserId }) {
  const record = { id: crypto.randomUUID(), sourcePageId, remixPageId, remixerUserId, createdAt: new Date().toISOString() };
  if (!pool) { pageRemixes.push(record); return structuredClone(record); }
  const result = await pool.query(`INSERT INTO page_remixes (id, source_page_id, remix_page_id, remixer_user_id)
    VALUES ($1, $2, $3, $4) RETURNING *`, [record.id, sourcePageId, remixPageId, remixerUserId]);
  return result.rows[0];
}

async function getPageRemixCount(sourcePageId) {
  if (!pool) return pageRemixes.filter((item) => item.sourcePageId === sourcePageId).length;
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM page_remixes WHERE source_page_id = $1', [sourcePageId]);
  return Number(result.rows[0].count);
}

module.exports = {
  initCanvasDatabase,
  runMigrations,
  getDatabasePool,
  getCanvasState,
  saveCanvasState,
  saveUser,
  listMusicTracks,
  getMusicTrackById,
  createMusicTrack,
  deleteMusicTrack,
  getUserPageByUserId,
  getUserPageBySlug,
  listPublishedUserPages,
  recordUserPageView,
  createUserPage,
  updateUserPage,
  getPageReactionSummary,
  addPageReaction,
  removePageReaction,
  createPageRemix,
  getPageRemixCount
};
