require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { Server } = require('socket.io');
const passport = require('./config/passport');
const { initCanvasDatabase, getCanvasState, saveCanvasState } = require('./db');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();
const httpServer = http.createServer(app);
const port = Number(process.env.PORT) || 3000;
const sessionSecret = process.env.SESSION_SECRET || 'development-secret-change-me';

const allowedOrigin = process.env.CLIENT_URL || `http://localhost:${port}`;

app.use(cors({
  origin: allowedOrigin,
  credentials: true
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

const sessionMiddleware = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
});

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

function upsertObject(state, object) {
  const objectId = object?.metadata?.objectId;
  if (!objectId) return appendUniqueObjects(state, [object]);
  const index = state.objects.findIndex((item) => item.metadata?.objectId === objectId);
  if (index === -1) state.objects.push(object);
  else state.objects[index] = object;
}

function removeObject(state, objectId) {
  if (!objectId) return;
  state.objects = state.objects.filter((object) => object.metadata?.objectId !== objectId);
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
  const canUseWall = Boolean(user?.isMember);
  if (canUseWall) {
    connectedUsers.add(socket.id);
  }

  socket.emit('session', {
    authenticated: canUseWall,
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
    persistCanvasMutation((state) => appendUniqueObjects(state, incomingObjects(payload)))
      .then(() => relayToOtherClients('draw', payload))
      .catch((error) => console.error('Unable to persist draw:', error));
  });

  socket.on('add-object', (payload) => {
    if (!canUseWall) return;
    persistCanvasMutation((state) => appendUniqueObjects(state, incomingObjects(payload)))
      .then(() => relayToOtherClients('add-object', payload))
      .catch((error) => console.error('Unable to persist object:', error));
  });

  socket.on('update-object', (payload) => {
    if (!canUseWall || !payload?.object) return;
    persistCanvasMutation((state) => upsertObject(state, payload.object))
      .then(() => relayToOtherClients('update-object', payload))
      .catch((error) => console.error('Unable to persist object update:', error));
  });

  socket.on('remove-object', (payload) => {
    if (!canUseWall || !payload?.objectId) return;
    persistCanvasMutation((state) => removeObject(state, payload.objectId))
      .then(() => relayToOtherClients('remove-object', payload))
      .catch((error) => console.error('Unable to persist object removal:', error));
  });

  socket.on('clear-canvas', (payload = {}) => {
    if (!canUseWall) return;
    persistCanvasMutation((state) => { state.objects = []; })
      .then(() => relayToOtherClients('clear-canvas', payload))
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
    const host = process.env.HOST || '0.0.0.0';
    httpServer.listen(port, host, () => {
      console.log(`Celestial Wall is running at http://${host}:${port}`);
    });
  })
  .catch((error) => {
    console.error('Unable to initialize canvas database:', error);
    process.exitCode = 1;
  });
