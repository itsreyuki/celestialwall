require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Server } = require('socket.io');
const passport = require('./config/passport');
const { initCanvasDatabase, getDatabasePool, getCanvasState, saveCanvasState } = require('./db');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();
const httpServer = http.createServer(app);
const port = Number(process.env.PORT) || 3000;
const sessionSecret = process.env.SESSION_SECRET || 'development-secret-change-me';
const databasePool = getDatabasePool();

// Render terminates HTTPS at its proxy and forwards the request to Node over HTTP.
// Trusting the proxy allows express-session to set secure cookies correctly.
app.set('trust proxy', 1);

const allowedOrigin = process.env.CLIENT_URL || `http://localhost:${port}`;

app.use(cors({
  origin: allowedOrigin,
  credentials: true
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

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
app.use('/api', apiRoutes);
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/vendor/fabric', express.static(path.join(__dirname, 'node_modules', 'fabric', 'dist')));
app.use('/vendor/socket.io', express.static(path.join(__dirname, 'node_modules', 'socket.io-client', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    return next();
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ داخلي في الخادم.' });
});

const io = new Server(httpServer, {
  maxHttpBufferSize: 5e6,
  cors: {
    origin: allowedOrigin,
    credentials: true
  }
});

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

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, () => {
    passport.initialize()(socket.request, {}, () => {
      passport.session()(socket.request, {}, next);
    });
  });
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

    // broadcast يستثني socket المرسل، وsenderId يضيف طبقة حماية للعميل.
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

// يتيح لمسار API نشر الرسائل الجديدة لجميع العملاء المتصلين.
app.set('io', io);

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
