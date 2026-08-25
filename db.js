const { Pool } = require('pg');

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

module.exports = {
  initCanvasDatabase,
  getDatabasePool,
  getCanvasState,
  saveCanvasState,
  saveUser
};
