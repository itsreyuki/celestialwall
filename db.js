const { Pool } = require('pg');
const crypto = require('crypto');

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

module.exports = {
  initCanvasDatabase,
  getDatabasePool,
  getCanvasState,
  saveCanvasState,
  saveUser,
  listMusicTracks,
  getMusicTrackById,
  createMusicTrack,
  deleteMusicTrack
};
