require('dotenv').config();

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Server } = require('socket.io');
const passport = require('./config/passport');
const { initCanvasDatabase, getDatabasePool, getCanvasState, getUserPageBySlug, listPublishedUserPages, saveCanvasState } = require('./db');
const { RESERVED_SLUGS, slugSchema } = require('./services/page-config');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const musicRoutes = require('./routes/music');
const pagesRoutes = require('./routes/pages');

const app = express();
const httpServer = http.createServer(app);
const port = Number(process.env.PORT) || 3000;
const sessionSecret = process.env.SESSION_SECRET || 'development-secret-change-me';
const databasePool = getDatabasePool();
const isProduction = process.env.NODE_ENV === 'production';
const publicSiteUrl = (process.env.PUBLIC_URL || process.env.CLIENT_URL || 'https://celes.lol').replace(/\/$/, '');

if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production.');
}
if (isProduction && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required in production for persistent Pages data.');
}
if (isProduction && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production for persistent uploads.');
}

app.set('trust proxy', 1);
app.disable('x-powered-by');

const allowedOrigin = process.env.CLIENT_URL || `http://localhost:${port}`;

app.use(cors({
  origin: allowedOrigin,
  credentials: true
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https://discord.com wss: ws:");
  return next();
});
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

const sessionOptions = {
  secret: sessionSecret,
  proxy: true,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
};

if (databasePool) {
  sessionOptions.store = new pgSession({
    pool: databasePool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  });
}

const sessionMiddleware = session(sessionOptions);

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

app.use('/auth', authRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/pages', pagesRoutes);
app.use('/api', apiRoutes);
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '30d', immutable: true }));
app.use('/uploads/music', express.static(path.join(__dirname, 'data', 'music'), {
  fallthrough: false,
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0
}));
app.use('/uploads/pages', express.static(path.join(__dirname, 'data', 'pages'), {
  fallthrough: false,
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0
}));
app.use('/vendor/fabric', express.static(path.join(__dirname, 'node_modules', 'fabric', 'dist')));
app.use('/vendor/socket.io', express.static(path.join(__dirname, 'node_modules', 'socket.io-client', 'dist')));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(?:js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

const publicPageTemplate = fs.readFileSync(path.join(__dirname, 'public', 'page.html'), 'utf8');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function absolutePublicUrl(value) {
  if (typeof value !== 'string' || !value) return `${publicSiteUrl}/assets/logo.png`;
  try {
    return new URL(value, `${publicSiteUrl}/`).protocol === 'https:'
      ? new URL(value, `${publicSiteUrl}/`).toString()
      : `${publicSiteUrl}/assets/logo.png`;
  } catch {
    return `${publicSiteUrl}/assets/logo.png`;
  }
}

function publicPageHtml(page) {
  const configuration = page.configuration || {};
  const description = String(page.bio || `صفحة ${page.displayName} على Celestia Pages`).replace(/\s+/g, ' ').trim().slice(0, 160);
  const image = configuration.banner?.asset?.url || configuration.avatar?.asset?.url || '/assets/logo.png';
  const title = `${page.displayName} | Celestia`;
  const canonical = `${publicSiteUrl}/${encodeURIComponent(page.slug)}`;
  const meta = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="robots" content="${page.visibility === 'public' ? 'index, follow' : 'noindex, nofollow'}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    '<meta property="og:type" content="profile" />',
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(absolutePublicUrl(image))}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(absolutePublicUrl(image))}" />`
  ].join('\n    ');
  return publicPageTemplate.replace('<!-- CELESTIA_PAGE_SEO -->', meta);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/robots.txt', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /auth/\nDisallow: /pages/editor\nSitemap: ${publicSiteUrl}/sitemap.xml\n`);
});

app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const pages = await listPublishedUserPages();
    const urls = [
      `<url><loc>${escapeHtml(`${publicSiteUrl}/`)}</loc></url>`,
      ...pages.map((page) => `<url><loc>${escapeHtml(`${publicSiteUrl}/${encodeURIComponent(page.slug)}`)}</loc>${page.updatedAt ? `<lastmod>${escapeHtml(new Date(page.updatedAt).toISOString())}</lastmod>` : ''}</url>`)
    ];
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  } catch (error) {
    console.error('Sitemap generation failed:', error);
    res.status(503).type('text').send('Sitemap temporarily unavailable.');
  }
});

app.get('/music', (req, res) => res.sendFile(path.join(__dirname, 'public', 'music.html')));
app.get('/pages', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages.html')));
app.get('/pages/editor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages-editor.html')));
app.get('/editor', (req, res) => res.redirect('/pages'));

app.get('/:slug', async (req, res, next) => {
  const parsed = slugSchema.safeParse(req.params.slug);
  if (!parsed.success || RESERVED_SLUGS.has(req.params.slug.toLowerCase())) return next();

  try {
    const page = await getUserPageBySlug(parsed.data);
    if (!page || !page.published || page.visibility === 'private') {
      return res.status(404).send('Page not found.');
    }
    return res.type('html').send(publicPageHtml(page));
  } catch (error) {
    return next(error);
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    return next();
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err?.type === 'entity.too.large' || err?.status === 413) return res.status(413).json({ error: 'Request payload is too large.' });
  if (err instanceof URIError) return res.status(400).json({ error: 'Malformed request.' });
  res.status(500).json({ error: 'حدث خطأ داخلي في الخادم.' });
});

const io = new Server(httpServer, {
  maxHttpBufferSize: 5e6,
  cors: {
    origin: allowedOrigin,
    credentials: true
  }
});
const musicIo = io.of('/music');

const connectedUsers = new Set();
let canvasWriteQueue = Promise.resolve();
const TEXT_PLACEHOLDER = 'اكتب هنا...';
const TEXT_EDIT_TIMEOUT = 5 * 60 * 1000;
const textExpiryTimers = new Map();

function persistCanvasMutation(mutator) {
  const operation = canvasWriteQueue.then(async () => {
    const state = getCanvasState();
    mutator(state);
    return saveCanvasState(state);
  });
  canvasWriteQueue = operation.catch((error) => {
    console.error('Canvas persistence error:', error);
  });
  return operation;
}

function incomingObjects(payload) {
  if (Array.isArray(payload?.objects)) return payload.objects;
  return payload?.object ? [payload.object] : [];
}

function appendUniqueObjects(state, objects) {
  const existingIds = new Set(
    state.objects.map((object) => object.metadata?.objectId).filter(Boolean)
  );

  objects.forEach((object) => {
    const objectId = object?.metadata?.objectId;
    if (objectId && existingIds.has(objectId)) return;
    state.objects.push(object);
    if (objectId) existingIds.add(objectId);
  });
}

function isTextObject(object) {
  return ['i-text', 'text', 'textbox'].includes(object?.type);
}

function isDrawingObject(object) {
  return object?.type === 'path';
}

function serializedBounds(object, padding = 10) {
  const scaleX = Math.abs(Number(object?.scaleX) || 1);
  const scaleY = Math.abs(Number(object?.scaleY) || 1);
  const width = Math.max(1, Math.abs(Number(object?.width) || 0) * scaleX) + padding * 2;
  const height = Math.max(1, Math.abs(Number(object?.height) || 0) * scaleY) + padding * 2;
  let left = Number(object?.left) || 0;
  let top = Number(object?.top) || 0;

  if (object?.originX === 'center') left -= width / 2;
  if (object?.originX === 'right') left -= width;
  if (object?.originY === 'center') top -= height / 2;
  if (object?.originY === 'bottom') top -= height;

  return { left, top, right: left + width, bottom: top + height };
}

function objectsOverlap(first, second) {
  const firstBounds = serializedBounds(first);
  const secondBounds = serializedBounds(second);
  return firstBounds.left < secondBounds.right
    && firstBounds.right > secondBounds.left
    && firstBounds.top < secondBounds.bottom
    && firstBounds.bottom > secondBounds.top;
}

function hasForeignOverlap(state, object, userId, acceptedTypes) {
  const objectId = object?.metadata?.objectId;
  return state.objects.some((candidate) => (
    candidate.metadata?.userId !== userId
    && candidate.metadata?.objectId !== objectId
    && acceptedTypes(candidate)
    && objectsOverlap(object, candidate)
  ));
}

function hasForeignDrawingOverlap(state, object, userId) {
  return isDrawingObject(object)
    && hasForeignOverlap(state, object, userId, isDrawingObject);
}

function hasForeignTextPlacementOverlap(state, object, userId) {
  return isTextObject(object)
    && hasForeignOverlap(state, object, userId, (candidate) => isDrawingObject(candidate) || isTextObject(candidate));
}

function userMetadata(user) {
  return {
    userId: user.id,
    username: user.username,
    global_name: user.global_name || user.username
  };
}

function ownedObject(object, user, existingObject = null) {
  const copy = structuredClone(object);
  copy.metadata = { ...(copy.metadata || {}), ...userMetadata(user) };
  if (isTextObject(copy)) {
    const isPlaceholder = copy.text === TEXT_PLACEHOLDER;
    const existingExpiry = Number(existingObject?.metadata?.textExpiresAt) || 0;
    copy.metadata.textPending = isPlaceholder && (existingObject?.metadata?.textPending !== false);
    if (copy.metadata.textPending) {
      copy.metadata.textExpiresAt = existingExpiry > Date.now()
        ? existingExpiry
        : Date.now() + TEXT_EDIT_TIMEOUT;
    } else {
      delete copy.metadata.textExpiresAt;
    }
  }
  return copy;
}

function ownedObjects(payload, user) {
  return incomingObjects(payload)
    .filter(Boolean)
    .map((object) => ownedObject(object, user));
}

function removeObjectOwnedBy(state, objectId, userId) {
  const index = state.objects.findIndex((object) => object.metadata?.objectId === objectId);
  if (index === -1 || state.objects[index].metadata?.userId !== userId) return false;
  state.objects.splice(index, 1);
  return true;
}

function updateObjectOwnedBy(state, object, userId) {
  const objectId = object?.metadata?.objectId;
  const index = state.objects.findIndex((item) => item.metadata?.objectId === objectId);
  if (!objectId || index === -1 || state.objects[index].metadata?.userId !== userId) return false;
  state.objects[index] = object;
  return true;
}

function clearTextExpiry(objectId) {
  const timer = textExpiryTimers.get(objectId);
  if (timer) clearTimeout(timer);
  textExpiryTimers.delete(objectId);
}

function scheduleTextExpiry(object) {
  const objectId = object?.metadata?.objectId;
  const expiresAt = Number(object?.metadata?.textExpiresAt) || 0;
  clearTextExpiry(objectId);
  if (!objectId || !object?.metadata?.textPending || !expiresAt) return;

  const delay = Math.max(0, expiresAt - Date.now());
  const timer = setTimeout(() => {
    textExpiryTimers.delete(objectId);
    let removed = false;
    persistCanvasMutation((state) => {
      const index = state.objects.findIndex((item) => item.metadata?.objectId === objectId);
      const candidate = state.objects[index];
      if (index === -1 || !candidate?.metadata?.textPending || Number(candidate.metadata.textExpiresAt) > Date.now()) return;
      state.objects.splice(index, 1);
      removed = true;
    })
      .then(() => {
        if (removed) io.emit('remove-object', { objectId, reason: 'text-expired' });
      })
      .catch((error) => console.error('Unable to expire placeholder text:', error));
  }, delay);
  textExpiryTimers.set(objectId, timer);
}

function broadcastPresence() {
  io.emit('presence:update', { count: connectedUsers.size });
}

function applySocketSession(socket, next) {
  sessionMiddleware(socket.request, {}, () => {
    passport.initialize()(socket.request, {}, () => {
      passport.session()(socket.request, {}, next);
    });
  });
}

io.use(applySocketSession);
musicIo.use(applySocketSession);

musicIo.on('connection', (socket) => {
  const user = socket.request.session?.user || socket.request.user;
  socket.emit('music:session', { canContribute: Boolean(user?.isMember) });
});

io.on('connection', (socket) => {
  const user = socket.request.session?.user || socket.request.user;
  const isGuestView = socket.handshake.auth?.viewOnly === true || socket.handshake.auth?.viewOnly === 'true';
  const canUseWall = Boolean(user?.isMember) && !isGuestView;
  if (canUseWall) {
    connectedUsers.add(socket.id);
  }

  socket.emit('session', {
    authenticated: canUseWall,
    viewOnly: isGuestView,
    user: canUseWall ? { id: user.id, username: user.username, avatar: user.avatar } : null,
    connectedUsers: connectedUsers.size
  });
  canvasWriteQueue.then(() => socket.emit('canvas:state', getCanvasState()));
  if (canUseWall) broadcastPresence();

  const relayToOtherClients = (eventName, payload) => {
    if (!canUseWall || !payload || typeof payload !== 'object') return;

    socket.broadcast.emit(eventName, {
      ...payload,
      senderId: socket.id
    });
  };

  socket.on('draw', (payload) => {
    if (!canUseWall) return;
    const objects = ownedObjects(payload, user);
    if (!objects.length) return;
    let acceptedObjects = [];
    persistCanvasMutation((state) => {
      acceptedObjects = objects.filter((object) => !hasForeignDrawingOverlap(state, object, user.id));
      appendUniqueObjects(state, acceptedObjects);
    })
      .then(() => {
        if (!acceptedObjects.length) return socket.emit('permission-denied', { action: 'draw-overlap' });
        acceptedObjects.forEach(scheduleTextExpiry);
        return relayToOtherClients('draw', { ...payload, object: acceptedObjects[0], objects: acceptedObjects });
      })
      .catch((error) => console.error('Unable to persist draw:', error));
  });

  socket.on('add-object', (payload) => {
    if (!canUseWall) return;
    const objects = ownedObjects(payload, user);
    if (!objects.length) return;
    let acceptedObjects = [];
    persistCanvasMutation((state) => {
      acceptedObjects = objects.filter((object) => !hasForeignTextPlacementOverlap(state, object, user.id));
      appendUniqueObjects(state, acceptedObjects);
    })
      .then(() => {
        if (!acceptedObjects.length) return socket.emit('permission-denied', { action: 'place-text' });
        acceptedObjects.forEach(scheduleTextExpiry);
        return relayToOtherClients('add-object', { ...payload, object: acceptedObjects[0], objects: acceptedObjects });
      })
      .catch((error) => console.error('Unable to persist object:', error));
  });

  socket.on('update-object', (payload) => {
    if (!canUseWall || !payload?.object) return;
    let updated = false;
    let object = null;
    let overlapBlocked = false;
    persistCanvasMutation((state) => {
      const existing = state.objects.find((item) => item.metadata?.objectId === payload.object.metadata?.objectId);
      object = ownedObject(payload.object, user, existing);
      overlapBlocked = hasForeignDrawingOverlap(state, object, user.id)
        || hasForeignTextPlacementOverlap(state, object, user.id);
      updated = !overlapBlocked && updateObjectOwnedBy(state, object, user.id);
    })
      .then(() => {
        if (overlapBlocked) return socket.emit('permission-denied', { action: 'place-text' });
        if (!updated) return socket.emit('permission-denied', { action: 'update-object' });
        scheduleTextExpiry(object);
        return relayToOtherClients('update-object', { ...payload, object });
      })
      .catch((error) => console.error('Unable to persist object update:', error));
  });

  socket.on('remove-object', (payload) => {
    if (!canUseWall || !payload?.objectId) return;
    let removed = false;
    persistCanvasMutation((state) => { removed = removeObjectOwnedBy(state, payload.objectId, user.id); })
      .then(() => {
        if (!removed) return socket.emit('permission-denied', { action: 'remove-object' });
        clearTextExpiry(payload.objectId);
        return relayToOtherClients('remove-object', payload);
      })
      .catch((error) => console.error('Unable to persist object removal:', error));
  });

  socket.on('clear-canvas', (payload = {}) => {
    if (!canUseWall) return;
    let objectIds = [];
    persistCanvasMutation((state) => {
      objectIds = state.objects
        .filter((object) => object.metadata?.userId === user.id)
        .map((object) => object.metadata?.objectId)
        .filter(Boolean);
      state.objects = state.objects.filter((object) => object.metadata?.userId !== user.id);
    })
      .then(() => {
        if (!objectIds.length) return;
        objectIds.forEach(clearTextExpiry);
        return relayToOtherClients('clear-canvas', { ...payload, objectIds });
      })
      .catch((error) => console.error('Unable to persist clear:', error));
  });

  socket.on('canvas:expand', (payload) => {
    if (!canUseWall) return;
    const width = Number(payload?.width);
    const height = Number(payload?.height);
    const shiftX = Number(payload?.shiftX) || 0;
    const shiftY = Number(payload?.shiftY) || 0;
    if (!width || !height) return;

    persistCanvasMutation((state) => {
      state.width = Math.max(state.width, width);
      state.height = Math.max(state.height, height);
      state.objects.forEach((object) => {
        object.left = (object.left || 0) + shiftX;
        object.top = (object.top || 0) + shiftY;
      });
    })
      .then(() => relayToOtherClients('canvas:expand', payload))
      .catch((error) => console.error('Unable to persist canvas expansion:', error));
  });

  socket.on('disconnect', () => {
    if (connectedUsers.delete(socket.id)) broadcastPresence();
  });
});

app.set('io', io);
app.set('musicIo', musicIo);

initCanvasDatabase()
  .then(() => {
    getCanvasState().objects.forEach(scheduleTextExpiry);
    const host = process.env.HOST || '0.0.0.0';
    httpServer.listen(port, host, () => {
      console.log(`Celestial Wall is running at http://${host}:${port}`);
    });
  })
  .catch((error) => {
    console.error('Unable to initialize canvas database:', error);
    process.exitCode = 1;
  });
