const loginView = document.querySelector('#login-view');
const workspace = document.querySelector('#workspace');
const account = document.querySelector('#account');
const canvasElement = document.querySelector('#wall-canvas');
const notice = document.querySelector('#notice');
const toolStatus = document.querySelector('#tool-status');
const imageInput = document.querySelector('#image-input');
const brushColor = document.querySelector('#brush-color');
const brushWidth = document.querySelector('#brush-width');
const zoomInButton = document.querySelector('#zoom-in');
const zoomOutButton = document.querySelector('#zoom-out');
const zoomLevel = document.querySelector('#zoom-level');
const canvasViewport = document.querySelector('.canvas-viewport');
const objectTooltip = document.querySelector('#object-tooltip');
const canvasCard = document.querySelector('.canvas-card');
const imageLoader = document.querySelector('#image-loader');
const imageLoaderLabel = document.querySelector('#image-loader-label');
const presence = document.querySelector('#presence');
const presenceDot = document.querySelector('#presence-dot');
const presenceLabel = document.querySelector('#presence-label');
const presenceCount = document.querySelector('#presence-count');
const membershipGate = document.querySelector('#membership-gate');
const discordInvite = document.querySelector('#discord-invite');
const checkMembershipButton = document.querySelector('#check-membership');
const membershipNotice = document.querySelector('#membership-notice');
const canvasWrap = document.querySelector('.canvas-wrap');

let currentUser = null;
let wallCanvas = null;
let socket = null;
let applyingRemoteChange = false;
let suppressCanvasSync = false;
let remoteChangeQueue = Promise.resolve();
let activeTool = 'draw';
let isPanning = false;
let panStart = null;
let worldWidth = 1200;
let worldHeight = 700;
const EXPANSION_WIDTH = 800;
const EXPANSION_HEIGHT = 500;
const DENSITY_THRESHOLD = 0.55;
const EDGE_MARGIN = 120;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;
const hoverStates = new WeakMap();

function creatorMetadata() {
  return {
    userId: currentUser ? currentUser.id : null,
    username: currentUser ? currentUser.username : null,
    global_name: currentUser ? (currentUser.global_name || currentUser.username) : null
  };
}

function createObjectId() {
  return window.crypto?.randomUUID?.() || `object-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addMetadata(object) {
  if (!object) return object;
  const metadata = { ...(object.metadata || {}) };
  if (!metadata.userId) Object.assign(metadata, creatorMetadata());
  if (!metadata.objectId) metadata.objectId = createObjectId();
  object.set('metadata', metadata);
  return object;
}

function visibleCanvasCenter() {
  const zoom = wallCanvas?.getZoom?.() || 1;
  const viewportRect = canvasViewport.getBoundingClientRect();
  const canvasRect = canvasWrap.getBoundingClientRect();
  return {
    left: Math.min(worldWidth - 20, Math.max(20, (viewportRect.left + viewportRect.width / 2 - canvasRect.left) / zoom)),
    top: Math.min(worldHeight - 20, Math.max(20, (viewportRect.top + viewportRect.height / 2 - canvasRect.top) / zoom))
  };
}

function updateCanvasWrapSize() {
  const zoom = wallCanvas?.getZoom?.() || 1;
  canvasWrap.style.width = `${Math.round(worldWidth * zoom)}px`;
  canvasWrap.style.minWidth = `${Math.round(worldWidth * zoom)}px`;
  canvasWrap.style.height = `${Math.round(worldHeight * zoom)}px`;
  canvasWrap.style.minHeight = `${Math.round(worldHeight * zoom)}px`;
}

function syncCanvasDimensions() {
  if (!wallCanvas) return;
  const zoom = wallCanvas.getZoom() || 1;
  wallCanvas.setDimensions({
    width: Math.round(worldWidth * zoom),
    height: Math.round(worldHeight * zoom)
  });
  updateCanvasWrapSize();
}

function updateZoomLabel() {
  if (!zoomLevel) return;
  const zoom = wallCanvas?.getZoom?.() || 1;
  zoomLevel.value = `${Math.round(zoom * 100)}%`;
  zoomLevel.textContent = zoomLevel.value;
}

function zoomCanvas(delta) {
  if (!wallCanvas) return;
  const currentZoom = wallCanvas.getZoom() || 1;
  const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom + delta));
  if (Math.abs(nextZoom - currentZoom) < 0.001) return;

  const viewportRect = canvasViewport.getBoundingClientRect();
  const canvasRect = canvasWrap.getBoundingClientRect();
  const centerPoint = new fabric.Point(
    viewportRect.left + viewportRect.width / 2 - canvasRect.left,
    viewportRect.top + viewportRect.height / 2 - canvasRect.top
  );

  wallCanvas.zoomToPoint(centerPoint, nextZoom);
  syncCanvasDimensions();
  updateZoomLabel();
  wallCanvas.requestRenderAll();
}

function expandWorld(payload = {}) {
  if (!wallCanvas) return;

  const width = Number(payload.width) || worldWidth + EXPANSION_WIDTH;
  const height = Number(payload.height) || worldHeight + EXPANSION_HEIGHT;
  const shiftX = Number(payload.shiftX) || EXPANSION_WIDTH / 2;
  const shiftY = Number(payload.shiftY) || EXPANSION_HEIGHT / 2;
  if (width <= worldWidth && height <= worldHeight) return;

  wallCanvas.getObjects().forEach((object) => {
    object.set({ left: object.left + shiftX, top: object.top + shiftY });
    object.setCoords();
  });
  worldWidth = width;
  worldHeight = height;
  syncCanvasDimensions();
  const zoom = wallCanvas.getZoom?.() || 1;
  canvasViewport.scrollLeft += shiftX * zoom;
  canvasViewport.scrollTop += shiftY * zoom;
  wallCanvas.requestRenderAll();

  if (!applyingRemoteChange && socket) {
    socket.emit('canvas:expand', { width, height, shiftX, shiftY });
  }
}

function maybeExpandWorld() {
  if (!wallCanvas || applyingRemoteChange) return;
  const objects = wallCanvas.getObjects();
  if (!objects.length) return;

  const bounds = objects.reduce((result, object) => {
    const rect = object.getBoundingRect();
    result.left = Math.min(result.left, rect.left);
    result.top = Math.min(result.top, rect.top);
    result.right = Math.max(result.right, rect.left + rect.width);
    result.bottom = Math.max(result.bottom, rect.top + rect.height);
    return result;
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

  const contentWidth = Math.max(0, bounds.right - bounds.left);
  const contentHeight = Math.max(0, bounds.bottom - bounds.top);
  const coverage = (contentWidth * contentHeight) / (worldWidth * worldHeight);
  const nearEdge = bounds.left <= EDGE_MARGIN
    || bounds.top <= EDGE_MARGIN
    || bounds.right >= worldWidth - EDGE_MARGIN
    || bounds.bottom >= worldHeight - EDGE_MARGIN;

  if (coverage >= DENSITY_THRESHOLD && nearEdge) expandWorld();
}

function isOwnSocketEvent(payload) {
  return Boolean(payload && socket && payload.senderId === socket.id);
}

function serializeObject(object) {
  return object.toObject(['metadata']);
}

function syncObject(object) {
  if (!socket || applyingRemoteChange || suppressCanvasSync || object.type === 'path') return;
  const serializedObject = serializeObject(object);
  socket.emit('add-object', {
    objectType: object.type,
    object: serializedObject,
    objects: [serializedObject]
  });
}

function syncObjectUpdate(object) {
  if (!socket || applyingRemoteChange || suppressCanvasSync || !object?.metadata?.objectId) return;
  socket.emit('update-object', { object: serializeObject(object) });
}

function syncObjectRemoval(object) {
  if (!socket || applyingRemoteChange || suppressCanvasSync || !object?.metadata?.objectId) return;
  socket.emit('remove-object', { objectId: object.metadata.objectId });
}

async function addRemoteObject(serializedObject) {
  if (!wallCanvas || !serializedObject) return;

  try {
    applyingRemoteChange = true;
    const enlivenedObjects = await fabric.util.enlivenObjects([serializedObject]);
    const object = enlivenedObjects[0];
    if (!object) return;
    wallCanvas.add(object);
    wallCanvas.requestRenderAll();
  } catch (error) {
    console.error('Unable to apply remote object:', error);
  } finally {
    applyingRemoteChange = false;
  }
}

async function updateRemoteObject(serializedObject) {
  if (!serializedObject?.metadata?.objectId) return;
  const existing = wallCanvas.getObjects().find(
    (object) => object.metadata?.objectId === serializedObject.metadata.objectId
  );
  if (existing) {
    applyingRemoteChange = true;
    wallCanvas.remove(existing);
    applyingRemoteChange = false;
  }
  await addRemoteObject(serializedObject);
}

function removeRemoteObject(objectId) {
  if (!objectId) return;
  const existing = wallCanvas.getObjects().find((object) => object.metadata?.objectId === objectId);
  if (existing) {
    applyingRemoteChange = true;
    wallCanvas.remove(existing);
    applyingRemoteChange = false;
    wallCanvas.requestRenderAll();
  }
}

function removeRemoteObjects(objectIds) {
  if (!Array.isArray(objectIds)) return;
  objectIds.forEach((objectId) => removeRemoteObject(objectId));
}

function queueRemoteChange(change) {
  remoteChangeQueue = remoteChangeQueue
    .then(change)
    .catch((error) => console.error('Unable to apply remote change:', error));
  return remoteChangeQueue;
}

async function applySavedCanvasState(state) {
  if (!wallCanvas || !state) return;
  applyingRemoteChange = true;
  try {
    worldWidth = Number(state.width) || 1200;
    worldHeight = Number(state.height) || 700;
    syncCanvasDimensions();
    wallCanvas.clear();
    await wallCanvas.loadFromJSON({
      version: state.version || '6.9.1',
      backgroundColor: state.backgroundColor || '#080b12',
      objects: Array.isArray(state.objects) ? state.objects : []
    });
    wallCanvas.backgroundColor = state.backgroundColor || '#080b12';
    wallCanvas.requestRenderAll();

    const objects = wallCanvas.getObjects();
    if (objects.length) {
      const bounds = objects.reduce((result, object) => {
        const rect = object.getBoundingRect();
        result.left = Math.min(result.left, rect.left);
        result.top = Math.min(result.top, rect.top);
        result.right = Math.max(result.right, rect.left + rect.width);
        result.bottom = Math.max(result.bottom, rect.top + rect.height);
        return result;
      }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
      const zoom = wallCanvas.getZoom?.() || 1;
      const viewportPadding = Number.parseFloat(getComputedStyle(canvasViewport).paddingLeft) || 0;
      canvasViewport.scrollLeft = Math.max(0, (bounds.left + (bounds.right - bounds.left) / 2) * zoom - canvasViewport.clientWidth / 2 + viewportPadding);
      canvasViewport.scrollTop = Math.max(0, (bounds.top + (bounds.bottom - bounds.top) / 2) * zoom - canvasViewport.clientHeight / 2 + viewportPadding);
    }
  } finally {
    applyingRemoteChange = false;
  }
}

function tooltipTextFor(object) {
  const metadata = object && object.metadata;
  if (!metadata) return null;

  const nickname = metadata.global_name || metadata.nickname || metadata.username;
  const username = metadata.username || nickname;
  if (!nickname && !username) return null;
  return `${nickname || 'مستخدم'} (${username || 'غير معروف'})`;
}

function positionObjectTooltip(object) {
  if (!wallCanvas || objectTooltip.hidden) return;

  const canvasRect = canvasElement.getBoundingClientRect();
  const viewportRect = canvasViewport.getBoundingClientRect();
  const objectRect = object.getBoundingRect();
  const scaleX = canvasRect.width / wallCanvas.getWidth();
  const scaleY = canvasRect.height / wallCanvas.getHeight();
  const objectRight = canvasRect.left - viewportRect.left + (objectRect.left + objectRect.width) * scaleX;
  const objectTop = canvasRect.top - viewportRect.top + objectRect.top * scaleY;
  const desiredLeft = objectRight + 12;
  const maxLeft = canvasViewport.clientWidth - objectTooltip.offsetWidth - 10;

  objectTooltip.style.left = `${Math.max(10, Math.min(desiredLeft, maxLeft))}px`;
  objectTooltip.style.top = `${Math.max(10, objectTop)}px`;
}

function showObjectTooltip(object) {
  const text = tooltipTextFor(object);
  if (!text) return;

  objectTooltip.textContent = text;
  objectTooltip.hidden = false;
  objectTooltip.classList.add('visible');
  positionObjectTooltip(object);
}

function hideObjectTooltip() {
  if (!objectTooltip) return;
  objectTooltip.classList.remove('visible');
  objectTooltip.hidden = true;
}

function hoverObject(object) {
  if (!object || hoverStates.has(object)) return;

  const original = {
    left: object.left,
    top: object.top,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
    shadow: object.shadow
  };
  hoverStates.set(object, original);

  const duration = 180;
  const easing = fabric.util.ease.easeOutCubic;
  object.set('shadow', new fabric.Shadow({
    color: 'rgba(48, 35, 126, 0.28)',
    blur: 18,
    offsetX: 0,
    offsetY: 9
  }));
  object.animate('top', original.top - 8, {
    duration,
    easing,
    onChange: () => {
      object.setCoords();
      wallCanvas.requestRenderAll();
      positionObjectTooltip(object);
    }
  });
  object.animate('scaleX', original.scaleX * 1.08, { duration, easing });
  object.animate('scaleY', original.scaleY * 1.08, { duration, easing });
  wallCanvas.requestRenderAll();
}

function unhoverObject(object) {
  const original = hoverStates.get(object);
  if (!original) return;

  const duration = 180;
  const easing = fabric.util.ease.easeOutCubic;
  object.animate('left', original.left, { duration, easing });
  object.animate('top', original.top, {
    duration,
    easing,
    onChange: () => {
      object.setCoords();
      wallCanvas.requestRenderAll();
      positionObjectTooltip(object);
    },
    onComplete: () => {
      object.set('shadow', original.shadow);
      object.setCoords();
      wallCanvas.requestRenderAll();
    }
  });
  object.animate('scaleX', original.scaleX, { duration, easing });
  object.animate('scaleY', original.scaleY, { duration, easing });
  hoverStates.delete(object);
  hideObjectTooltip();
}

function initializeCollaboration() {
  if (socket || typeof window.io !== 'function') return;

  socket = window.io({ withCredentials: true });

  socket.on('session', (data) => {
    updatePresence(data.connectedUsers || 0, true);
  });
  socket.on('connect', () => updatePresence(Number(presenceCount.textContent) || 0, true));
  socket.on('disconnect', () => updatePresence(0, false));
  socket.on('presence:update', ({ count }) => updatePresence(count, true));

  socket.on('canvas:state', (state) => {
    queueRemoteChange(() => applySavedCanvasState(state));
  });

  socket.on('draw', (payload) => {
    if (isOwnSocketEvent(payload)) return;
    queueRemoteChange(() => addRemoteObject(payload.object || payload.objects?.[0]));
  });

  socket.on('add-object', (payload) => {
    if (isOwnSocketEvent(payload)) return;
    const objects = payload.objects || (payload.object ? [payload.object] : []);
    objects.forEach((object) => queueRemoteChange(() => addRemoteObject(object)));
  });

  socket.on('update-object', (payload) => {
    if (isOwnSocketEvent(payload)) return;
    queueRemoteChange(() => updateRemoteObject(payload.object));
  });

  socket.on('remove-object', (payload) => {
    if (isOwnSocketEvent(payload)) return;
    queueRemoteChange(async () => removeRemoteObject(payload.objectId));
  });

  socket.on('clear-canvas', (payload) => {
    if (isOwnSocketEvent(payload)) return;
    queueRemoteChange(async () => {
      removeRemoteObjects(payload.objectIds);
    });
  });

  socket.on('permission-denied', ({ action }) => {
    if (action === 'remove-object') showNotice('لا يمكنك حذف إضافة عضو آخر.');
    if (action === 'update-object') showNotice('لا يمكنك تعديل إضافة عضو آخر.');
  });

  socket.on('canvas:expand', (payload) => {
    if (isOwnSocketEvent(payload)) return;
    queueRemoteChange(async () => {
      applyingRemoteChange = true;
      expandWorld(payload);
      applyingRemoteChange = false;
    });
  });

  socket.on('connect_error', (error) => {
    console.error('Socket.IO connection error:', error.message);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isOwnedByCurrentUser(object) {
  return object?.metadata?.userId && object.metadata.userId === currentUser?.id;
}

function avatarUrl(user) {
  if (!user || !user.avatar || !user.id) return '';
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=64`;
}

function updatePresence(count, online) {
  presence.hidden = false;
  presence.classList.toggle('online', online);
  presenceDot.classList.toggle('online', online);
  presenceDot.classList.toggle('offline', !online);
  presenceLabel.textContent = online ? 'متصلون الآن' : 'غير متصل';
  presenceCount.textContent = online ? String(count || 0) : '—';
}

function setImageLoading(loading, message = 'جارٍ تجهيز الصورة...') {
  imageLoaderLabel.textContent = message;
  imageLoader.hidden = !loading;
}

let toolbarTimer;
function wakeToolbar() {
  canvasCard.classList.add('toolbar-awake');
  window.clearTimeout(toolbarTimer);
  toolbarTimer = window.setTimeout(() => canvasCard.classList.remove('toolbar-awake'), 5200);
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => { notice.hidden = true; }, 4500);
}

function showMembershipMessage(message) {
  membershipNotice.textContent = message;
  membershipNotice.hidden = false;
}

async function verifyMembership() {
  checkMembershipButton.disabled = true;
  checkMembershipButton.textContent = 'جارٍ التحقق...';
  membershipNotice.hidden = true;

  try {
    const response = await fetch('/auth/check-membership', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر التحقق من العضوية.');

    if (data.isMember) {
      window.location.reload();
      return;
    }
    showMembershipMessage('لم نجد حسابك في السيرفر بعد. انضم أولاً ثم حاول مرة أخرى.');
  } catch (error) {
    showMembershipMessage(error.message || 'تعذر التحقق من العضوية حالياً.');
  } finally {
    checkMembershipButton.disabled = false;
    checkMembershipButton.textContent = 'تحققت من الانضمام';
  }
}

function renderAccount(user) {
  const avatar = avatarUrl(user);
  const avatarMarkup = avatar
    ? `<img class="account-avatar" src="${avatar}" alt="" />`
    : '<span class="account-avatar"></span>';

  account.innerHTML = `
    <span class="account-name">${avatarMarkup}<span>${escapeHtml(user.global_name || user.username)}</span></span>
    <button id="logout" class="logout-button" type="button">تسجيل الخروج</button>`;
  account.hidden = false;

  document.querySelector('#logout').addEventListener('click', async () => {
    const response = await fetch('/auth/logout', { method: 'POST' });
    if (response.ok) window.location.reload();
  });
}

function configureBrush() {
  if (!wallCanvas) return;
  wallCanvas.freeDrawingBrush.color = brushColor.value;
  wallCanvas.freeDrawingBrush.width = Number(brushWidth.value);
}

function updateObjectInteractivity(selectable) {
  wallCanvas.selection = selectable;
  wallCanvas.forEachObject((object) => {
    object.selectable = selectable;
    object.evented = selectable;
  });
}

function setTool(tool) {
  activeTool = tool;
  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === tool);
  });

  if (!wallCanvas) return;
  wallCanvas.isDrawingMode = tool === 'draw';
  updateObjectInteractivity(tool === 'select');
  wallCanvas.skipTargetFind = tool === 'pan';
  canvasViewport.classList.toggle('pan-ready', tool === 'pan');
  wallCanvas.defaultCursor = tool === 'draw' ? 'crosshair' : ['select', 'pan'].includes(tool) ? 'grab' : 'default';

  const status = {
    draw: 'القلم مفعل — ارسم بحرية',
    select: 'التحديد مفعل — اسحب وعدّل الكائنات',
    pan: 'التحريك مفعل — اسحب لتحريك اللوحة',
    text: 'تمت إضافة النص في منتصف اللوحة'
  };
  toolStatus.textContent = status[tool] || status.draw;
  configureBrush();
}

function addTextAtCenter() {
  if (!wallCanvas) return;
  const center = visibleCanvasCenter();
  const text = addMetadata(new fabric.IText('اكتب هنا...', {
    left: center.left,
    top: center.top,
    fill: brushColor.value,
    fontFamily: 'Cairo, Arial, sans-serif',
    fontSize: 34,
    fontWeight: '600',
    textAlign: 'right',
    direction: 'rtl',
    originX: 'center',
    originY: 'center',
    padding: 6
  }));

  wallCanvas.add(text);
  wallCanvas.setActiveObject(text);
  setTool('select');
  text.enterEditing();
  text.selectAll();
  wallCanvas.requestRenderAll();
}

async function addImage(file) {
  if (!file || !wallCanvas) return;
  if (!file.type.startsWith('image/')) {
    showNotice('يرجى اختيار ملف صورة صالح.');
    return;
  }

  setImageLoading(true, file.size > 1024 * 1024 ? 'جارٍ معالجة الصورة الكبيرة...' : 'جارٍ تجهيز الصورة...');
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const image = await fabric.Image.fromURL(dataUrl);
    const maxWidth = 440;
    if (image.width > maxWidth) image.scaleToWidth(maxWidth);
    const center = visibleCanvasCenter();
    image.set({
      left: center.left - image.getScaledWidth() / 2,
      top: center.top - image.getScaledHeight() / 2
    });
    wallCanvas.add(addMetadata(image));
    wallCanvas.setActiveObject(image);
    wallCanvas.requestRenderAll();
    setTool('select');
  } catch (error) {
    console.error(error);
    showNotice('تعذر تحميل الصورة.');
  } finally {
    setImageLoading(false);
  }
}

function pointerPosition(event) {
  return {
    x: event.clientX ?? event.touches?.[0]?.clientX ?? 0,
    y: event.clientY ?? event.touches?.[0]?.clientY ?? 0
  };
}

function handleCanvasMouseDown(event) {
  if (activeTool !== 'pan' && (activeTool !== 'select' || event.target)) return;
  const point = pointerPosition(event.e);
  isPanning = true;
  panStart = {
    x: point.x,
    y: point.y,
    scrollLeft: canvasViewport.scrollLeft,
    scrollTop: canvasViewport.scrollTop
  };
  canvasViewport.classList.add('is-panning');
  wallCanvas.selection = false;
  event.e.preventDefault();
}

function handleCanvasMouseMove(event) {
  if (!isPanning || !panStart) return;
  const point = pointerPosition(event.e);
  const maxScrollLeft = Math.max(0, canvasViewport.scrollWidth - canvasViewport.clientWidth);
  const maxScrollTop = Math.max(0, canvasViewport.scrollHeight - canvasViewport.clientHeight);
  canvasViewport.scrollLeft = Math.max(0, Math.min(maxScrollLeft, panStart.scrollLeft - (point.x - panStart.x)));
  canvasViewport.scrollTop = Math.max(0, Math.min(maxScrollTop, panStart.scrollTop - (point.y - panStart.y)));
}

function handleCanvasMouseUp() {
  if (!isPanning) return;
  isPanning = false;
  panStart = null;
  canvasViewport.classList.remove('is-panning');
  if (activeTool === 'select') wallCanvas.selection = true;
}

function initializeCanvas() {
  if (wallCanvas) return;
  wallCanvas = new fabric.Canvas(canvasElement, {
    width: 1200,
    height: 700,
    backgroundColor: '#080b12',
    isDrawingMode: true,
    preserveObjectStacking: true,
    selection: true
  });
  updateCanvasWrapSize();
  updateZoomLabel();
  wallCanvas.freeDrawingBrush = new fabric.PencilBrush(wallCanvas);
  wallCanvas.on('object:added', ({ target }) => {
    addMetadata(target);
    syncObject(target);
    maybeExpandWorld();
  });
  wallCanvas.on('object:modified', ({ target }) => {
    syncObjectUpdate(target);
    maybeExpandWorld();
  });
  wallCanvas.on('object:removed', ({ target }) => {
    syncObjectRemoval(target);
  });
  wallCanvas.on('path:created', ({ path }) => {
    addMetadata(path);
    if (!socket || applyingRemoteChange) return;
    socket.emit('draw', {
      eventType: 'path:created',
      coordinates: path.path,
      color: path.stroke,
      thickness: path.strokeWidth,
      object: serializeObject(path),
      objects: [serializeObject(path)]
    });
  });
  wallCanvas.on('mouse:over', ({ target }) => {
    if (!target) return;
    showObjectTooltip(target);
    hoverObject(target);
  });
  wallCanvas.on('mouse:out', ({ target }) => {
    if (!target) return;
    unhoverObject(target);
  });
  wallCanvas.on('mouse:down', handleCanvasMouseDown);
  wallCanvas.on('mouse:move', handleCanvasMouseMove);
  wallCanvas.on('mouse:up', handleCanvasMouseUp);
  configureBrush();
  setTool('draw');
}

function deleteSelected() {
  if (!wallCanvas) return;
  const selectedObjects = wallCanvas.getActiveObjects();
  if (!selectedObjects.length) {
    showNotice('حدد كائناً واحداً على الأقل لحذفه.');
    setTool('select');
    return;
  }

  const ownedObjects = selectedObjects.filter(isOwnedByCurrentUser);
  if (!ownedObjects.length) {
    showNotice('لا يمكنك حذف إضافات الأعضاء الآخرين.');
    wallCanvas.discardActiveObject();
    return;
  }

  wallCanvas.discardActiveObject();
  ownedObjects.forEach((object) => wallCanvas.remove(object));
  wallCanvas.requestRenderAll();
}

function clearCanvas() {
  if (!wallCanvas) return;
  const ownedObjects = wallCanvas.getObjects().filter(isOwnedByCurrentUser);
  if (!ownedObjects.length) {
    showNotice('لا توجد إضافات خاصة بك لمسحها.');
    return;
  }
  if (!window.confirm('هل تريد مسح كل إضافاتك من اللوحة؟')) return;
  const objectIds = ownedObjects.map((object) => object.metadata?.objectId).filter(Boolean);
  suppressCanvasSync = true;
  wallCanvas.discardActiveObject();
  ownedObjects.forEach((object) => wallCanvas.remove(object));
  wallCanvas.requestRenderAll();
  hideObjectTooltip();
  suppressCanvasSync = false;
  if (socket && objectIds.length) socket.emit('clear-canvas', { eventType: 'clear-canvas', objectIds });
}

async function loadSession() {
  const response = await fetch('/auth/me', { credentials: 'same-origin' });
  const data = await response.json();
  currentUser = data.authenticated ? data.user : null;

  if (!currentUser) {
    loginView.hidden = false;
    membershipGate.hidden = true;
    workspace.hidden = true;
    account.hidden = true;
    presence.hidden = true;
    return;
  }

  loginView.hidden = true;
  renderAccount(currentUser);

  if (!currentUser.isMember) {
    membershipGate.hidden = false;
    workspace.hidden = true;
    presence.hidden = true;
    discordInvite.href = data.inviteUrl || 'https://discord.gg/celes';
    return;
  }

  membershipGate.hidden = true;
  workspace.hidden = false;
  presence.hidden = false;
  updatePresence(0, false);
  initializeCanvas();
  initializeCollaboration();
}

document.querySelectorAll('[data-tool]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.tool === 'image') {
      imageInput.click();
      return;
    }
    if (button.dataset.tool === 'text') {
      addTextAtCenter();
      return;
    }
    setTool(button.dataset.tool);
  });
});

imageInput.addEventListener('change', (event) => {
  addImage(event.target.files[0]);
  event.target.value = '';
});
brushColor.addEventListener('input', configureBrush);
brushWidth.addEventListener('input', configureBrush);
document.querySelector('#clear-canvas').addEventListener('click', clearCanvas);
document.querySelector('#delete-selected').addEventListener('click', deleteSelected);
zoomInButton.addEventListener('click', () => zoomCanvas(ZOOM_STEP));
zoomOutButton.addEventListener('click', () => zoomCanvas(-ZOOM_STEP));
checkMembershipButton.addEventListener('click', verifyMembership);
['mouseenter', 'mousemove', 'focusin', 'touchstart'].forEach((eventName) => {
  canvasCard.addEventListener(eventName, wakeToolbar, { passive: true });
});
window.addEventListener('scroll', wakeToolbar, { passive: true });
wakeToolbar();

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Delete' || !wallCanvas || wallCanvas.getActiveObject()?.isEditing) return;
  const activeObject = wallCanvas.getActiveObject();
  if (activeObject) {
    if (!isOwnedByCurrentUser(activeObject)) {
      showNotice('لا يمكنك حذف إضافة عضو آخر.');
      wallCanvas.discardActiveObject();
      return;
    }
    wallCanvas.remove(activeObject);
    wallCanvas.discardActiveObject();
    wallCanvas.requestRenderAll();
  }
});

if (typeof fabric === 'undefined') {
  showNotice('تعذر تحميل Fabric.js. تأكد من تشغيل npm install.');
} else {
  loadSession().catch((error) => {
    console.error(error);
    showNotice('تعذر التحقق من جلسة تسجيل الدخول.');
  });
}
