const EditorState = window.CelestiaEditorState;
const editorApp = document.querySelector('#editor-app');
const workspace = document.querySelector('#editor-workspace');
const gate = document.querySelector('#editor-gate');
const preview = document.querySelector('#page-preview');
const layersList = document.querySelector('#layers-list');
const layerCount = document.querySelector('#layer-count');
const inspector = document.querySelector('#inspector');
const designControls = document.querySelector('#design-controls');
const saveStatus = document.querySelector('#save-status');
const undoButton = document.querySelector('#editor-undo');
const redoButton = document.querySelector('#editor-redo');
const deleteButton = document.querySelector('#delete-element');
const publicLink = document.querySelector('#editor-public-link');
const previewLabel = document.querySelector('#preview-label');
const desktopPreviewButton = document.querySelector('#preview-desktop');
const mobilePreviewButton = document.querySelector('#preview-mobile');

let currentPage = null;
let state = null;
let autosaveTimer = null;
let saving = false;
let saveAgain = false;
let pointerAction = null;
const responsive = window.CelestiaPageResponsive;

function mobilePreviewActive() {
  return preview.dataset.mode === 'mobile';
}

function clone(value) {
  return structuredClone(value);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function request(url, options = {}) {
  return fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'تعذر حفظ التغييرات.');
    return body;
  });
}

function profileElement() {
  return {
    id: 'profile-card',
    type: 'profile-card',
    position: { x: 50, y: 50 },
    size: { width: 72, height: 48 },
    zIndex: 1,
    visible: true,
    style: {}
  };
}

function ensureProfileCard(configuration) {
  if (configuration.elements.some((element) => element.type === 'profile-card')) return false;
  configuration.elements.unshift(profileElement());
  return true;
}

function selected() {
  return EditorState.selectedElement(state);
}

function elementLabel(element) {
  const labels = {
    'profile-card': 'بطاقة الملف الشخصي',
    text: 'نص',
    'social-links': 'روابط اجتماعية',
    image: 'صورة',
    widget: 'Widget',
    sticker: 'ملصق',
    music: 'مشغل موسيقى'
  };
  return labels[element.type] || element.type;
}

function applyGeometry(elementNode, element, layout = responsive.resolveElementLayout(element, mobilePreviewActive())) {
  elementNode.style.left = `${layout.position.x}%`;
  elementNode.style.top = `${layout.position.y}%`;
  elementNode.style.width = `${layout.size.width}%`;
  elementNode.style.height = `${layout.size.height}%`;
  elementNode.style.zIndex = String(element.zIndex);
  elementNode.style.transform = `translate(-50%, -50%) rotate(${element.style.rotation || 0}deg) scale(${layout.scale}) scaleX(${element.style.flipX ? -1 : 1})`;
  elementNode.style.textAlign = layout.alignment || '';
  elementNode.style.color = element.style.color || '';
  elementNode.style.backgroundColor = element.type === 'profile-card' ? '' : (element.style.backgroundColor || '');
  elementNode.style.opacity = element.style.opacity ?? '';
  elementNode.style.borderRadius = element.style.borderRadius !== undefined ? `${element.style.borderRadius}px` : '';
  elementNode.style.boxShadow = element.style.shadow === 'strong'
    ? '0 14px 28px rgba(0,0,0,.5)'
    : (element.style.shadow === 'soft' ? '0 8px 18px rgba(0,0,0,.3)' : 'none');
  if (element.style.glow) elementNode.style.boxShadow += ', 0 0 20px rgba(241,199,94,.45)';
}

function assetPosition(asset) {
  if (asset?.crop) return `${asset.crop.x}% ${asset.crop.y}%`;
  return asset?.position || 'center';
}

function renderBackground() {
  const background = state.configuration.background;
  const layer = document.createElement('div');
  layer.className = 'preview-background';
  layer.style.background = background.type === 'gradient'
    ? `linear-gradient(${background.gradient?.angle ?? 135}deg, ${background.gradient?.from || '#100d1d'}, ${background.gradient?.to || '#42266f'})`
    : (background.color || '#100d1d');
  preview.append(layer);
  if (background.asset?.url) {
    const media = background.type === 'video' ? document.createElement('video') : document.createElement('img');
    media.className = 'preview-background-media';
    media.src = background.asset.url;
    media.style.objectFit = background.asset.fit || 'cover';
    media.style.objectPosition = assetPosition(background.asset);
    media.style.filter = `blur(${background.blur}px) brightness(${background.brightness})`;
    if (background.blur) media.style.transform = 'scale(1.05)';
    if (media instanceof HTMLVideoElement) {
      media.muted = true;
      media.loop = true;
      media.autoplay = preview.dataset.mode !== 'mobile';
      media.preload = preview.dataset.mode === 'mobile' ? 'metadata' : 'auto';
      media.playsInline = true;
      if (media.autoplay) media.play().catch(() => undefined);
    } else {
      media.alt = '';
    }
    preview.append(media);
  }
  const overlay = document.createElement('div');
  overlay.className = 'preview-background-overlay';
  overlay.style.setProperty('--overlay-color', background.overlayColor || '#000000');
  overlay.style.setProperty('--overlay-opacity', String(background.overlayOpacity || 0));
  const vignette = document.createElement('div');
  vignette.className = 'preview-background-vignette';
  vignette.style.setProperty('--vignette', String(background.vignette || 0));
  const grain = document.createElement('div');
  grain.className = 'preview-background-grain';
  grain.style.setProperty('--grain', String(background.grain || 0));
  preview.append(overlay, vignette, grain);
}

function profileCardNode(element) {
  const config = state.configuration.profileCard;
  const card = document.createElement('article');
  card.className = 'editor-profile-card';
  card.style.background = config.backgroundColor;
  card.style.opacity = String(config.opacity);
  card.style.borderColor = config.borderColor;
  card.style.borderWidth = `${config.borderWidth}px`;
  card.style.borderRadius = `${config.borderRadius}px`;
  card.style.padding = `${config.padding}px`;
  card.style.textAlign = config.alignment;
  card.style.maxWidth = `${config.width}px`;
  card.style.boxShadow = config.shadow === 'strong'
    ? '0 22px 50px rgba(0,0,0,.5)'
    : (config.shadow === 'soft' ? '0 12px 30px rgba(0,0,0,.3)' : 'none');
  if (config.glow) card.style.boxShadow += ', 0 0 24px rgba(241,199,94,.38)';
  if (config.glass) card.style.backdropFilter = `blur(${config.blur}px)`;

  const banner = state.configuration.banner;
  if (banner.visible && banner.asset?.url) {
    const bannerNode = document.createElement('div');
    bannerNode.className = 'editor-profile-banner';
    bannerNode.style.borderRadius = `${banner.borderRadius}px`;
    const image = document.createElement('img');
    image.src = banner.asset.url;
    image.alt = '';
    image.style.objectPosition = assetPosition(banner.asset);
    image.style.objectFit = banner.asset.fit || 'cover';
    bannerNode.append(image);
    card.append(bannerNode);
  }

  const avatar = document.createElement('div');
  avatar.className = 'editor-profile-avatar';
  const asset = state.configuration.avatar.asset;
  if (asset?.url) {
    const image = document.createElement('img');
    image.src = asset.url;
    image.alt = '';
    image.style.objectPosition = assetPosition(asset);
    avatar.append(image);
  } else {
    avatar.textContent = (currentPage.displayName || '?').trim().charAt(0).toUpperCase() || '?';
  }
  const avatarConfig = state.configuration.avatar;
  avatar.style.width = `${avatarConfig.size}px`;
  avatar.style.height = `${avatarConfig.size}px`;
  avatar.style.borderRadius = avatarConfig.shape === 'circle' ? '50%' : (avatarConfig.shape === 'rounded-square' ? '22%' : '0');
  avatar.style.borderColor = avatarConfig.borderColor;
  avatar.style.borderWidth = `${avatarConfig.borderWidth}px`;
  avatar.style.boxShadow = avatarConfig.shadow === 'strong' ? '0 12px 24px rgba(0,0,0,.5)' : (avatarConfig.shadow === 'soft' ? '0 7px 16px rgba(0,0,0,.32)' : 'none');
  if (avatarConfig.glow) avatar.style.boxShadow += ', 0 0 18px rgba(241,199,94,.42)';
  const name = document.createElement('h3');
  name.textContent = currentPage.displayName || 'اسمك';
  const bio = document.createElement('p');
  bio.textContent = currentPage.bio || 'أضف نبذة من صفحة الإدارة.';
  card.append(avatar, name, bio);
  return card;
}

function widgetDefault(kind) {
  const image = { url: 'https://celes.lol/assets/logo.png', position: 'center', fit: 'cover' };
  const id = () => EditorState.createId('item');
  if (kind === 'quote') return { kind, text: 'اكتب اقتباسك هنا', author: '' };
  if (kind === 'mood') return { kind, text: 'مزاج هادئ', icon: '✨' };
  if (kind === 'characters' || kind === 'games') return { kind, items: [{ id: id(), name: kind === 'characters' ? 'شخصيتي المفضلة' : 'لعبتي المفضلة', image }] };
  if (kind === 'gallery') return { kind, items: [{ id: id(), image, caption: '' }], layout: 'grid' };
  if (kind === 'counter') return { kind, label: 'Visitors' };
  if (kind === 'clock') return { kind, format: '24h', showSeconds: false };
  if (kind === 'countdown') return { kind, title: 'الحدث القادم', targetDate: new Date(Date.now() + 86400000).toISOString(), finishedText: 'انتهى الحدث' };
  if (kind === 'poll') return { kind, question: 'ما رأيك؟', options: [{ id: id(), label: 'خيار أول' }, { id: id(), label: 'خيار ثانٍ' }] };
  return { kind: 'guestbook', text: 'سجل الزوار سيتوفر قريبًا.' };
}

function widgetPreview(element) {
  const data = element.widgetData;
  const node = document.createElement('div');
  node.className = `editor-widget widget-${data.kind}`;
  if (data.kind === 'quote') node.textContent = `“${data.text}”${data.author ? ` — ${data.author}` : ''}`;
  else if (data.kind === 'mood') node.textContent = `${data.icon || '✨'} ${data.text}`;
  else if (data.kind === 'characters' || data.kind === 'games') node.textContent = data.items.map((item) => item.name).join(' · ');
  else if (data.kind === 'gallery') node.textContent = `Gallery · ${data.items.length} صور`;
  else if (data.kind === 'clock') node.textContent = new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit', second: data.showSeconds ? '2-digit' : undefined, hour12: data.format === '12h' }).format(new Date());
  else if (data.kind === 'countdown') node.textContent = data.title;
  else if (data.kind === 'poll') node.textContent = data.question;
  else if (data.kind === 'counter') node.textContent = `${data.label}: 0`;
  else node.textContent = data.text;
  return node;
}

function contentNode(element) {
  if (element.type === 'profile-card') return profileCardNode(element);
  if (element.type === 'text') {
    const node = document.createElement('div');
    node.className = 'editor-text';
    node.textContent = element.content || 'نص جديد';
    node.style.fontSize = `${element.style.fontSize || 18}px`;
    node.style.fontFamily = element.style.fontFamily || 'Cairo';
    node.style.fontWeight = element.style.fontWeight || '400';
    node.style.textAlign = element.style.textAlign || 'right';
    node.style.letterSpacing = `${element.style.letterSpacing || 0}px`;
    node.style.lineHeight = String(element.style.lineHeight || 1.4);
    if (element.style.effect && element.style.effect !== 'none') node.classList.add(`effect-${element.style.effect}`);
    return node;
  }
  if (element.type === 'social-links') {
    const node = document.createElement('div');
    node.className = 'editor-social-links';
    const links = state.configuration.socialLinks.length ? state.configuration.socialLinks : [{ label: 'رابطك' }];
    links.filter((link) => link.visible !== false).forEach((link) => {
      const item = document.createElement('span');
      item.className = 'editor-social-link';
      item.textContent = link.label;
      node.append(item);
    });
    return node;
  }
  if (element.type === 'image') {
    const node = document.createElement('div');
    node.className = 'editor-image';
    if (element.assetUrl) {
      const image = document.createElement('img');
      image.src = element.assetUrl;
      image.alt = '';
      node.append(image);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'editor-image-placeholder';
      placeholder.textContent = 'أضف رابط الصورة';
      node.append(placeholder);
    }
    return node;
  }
  if (element.type === 'sticker') {
    const node = document.createElement('div');
    node.className = 'editor-sticker';
    node.textContent = element.content || '✨';
    return node;
  }
  if (element.type === 'widget') return widgetPreview(element);
  const node = document.createElement('div');
  node.className = 'editor-music';
  const play = document.createElement('b');
  play.textContent = '▶';
  const label = document.createElement('span');
  label.textContent = element.content || 'Music Player';
  node.append(play, label);
  return node;
}

function renderPreview() {
  preview.replaceChildren();
  renderBackground();
  [...state.configuration.elements]
    .sort((first, second) => first.zIndex - second.zIndex)
    .forEach((element) => {
      const layout = responsive.resolveElementLayout(element, mobilePreviewActive());
      const node = document.createElement('div');
      node.className = 'editor-element';
      node.dataset.id = element.id;
      node.dataset.label = elementLabel(element);
      node.classList.toggle('is-selected', state.selectedId === element.id);
      node.classList.toggle('is-hidden', !layout.visible);
      node.hidden = mobilePreviewActive() && !layout.visible;
      if (element.type === 'image' && element.style.animation && element.style.animation !== 'none') node.classList.add(`image-animation-${element.style.animation}`);
      applyGeometry(node, element, layout);
      node.append(contentNode(element));
      if (state.selectedId === element.id) {
        const handle = document.createElement('i');
        handle.className = 'resize-handle';
        handle.setAttribute('aria-label', 'تغيير الحجم');
        node.append(handle);
      }
      preview.append(node);
    });
  if (state.configuration.musicPlayer.enabled) {
    const player = document.createElement('div');
    player.className = `preview-music-player preset-${state.configuration.musicPlayer.preset}`;
    player.textContent = `▶ ${state.configuration.musicPlayer.title || 'عنوان الأغنية'} — ${state.configuration.musicPlayer.artist || 'الفنان'}`;
    preview.append(player);
  }
}

function renderLayers() {
  const elements = [...state.configuration.elements].sort((first, second) => second.zIndex - first.zIndex);
  layerCount.textContent = `${elements.length} عناصر`;
  layersList.replaceChildren();
  elements.forEach((element) => {
    const row = document.createElement('div');
    row.className = `layer-row${state.selectedId === element.id ? ' is-selected' : ''}`;
    row.dataset.id = element.id;
    row.draggable = true;
    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'layer-select';
    selectButton.dataset.action = 'select';
    selectButton.textContent = element.name || elementLabel(element);
    const visibility = document.createElement('button');
    visibility.type = 'button';
    visibility.dataset.action = 'visibility';
    visibility.textContent = element.visible ? '◉' : '○';
    const up = document.createElement('button');
    up.type = 'button';
    up.dataset.action = 'up';
    up.textContent = '↑';
    const down = document.createElement('button');
    down.type = 'button';
    down.dataset.action = 'down';
    down.textContent = '↓';
    row.append(selectButton, visibility, up, down);
    layersList.append(row);
  });
}

function field(label, key, value, type = 'text', extra = '') {
  return `<label>${label}<input data-field="${key}" type="${type}" value="${escapeHtml(value ?? '')}" ${extra} /></label>`;
}

function selectField(label, key, value, options, attribute = 'data-design-field') {
  const choices = options.map(([optionValue, optionLabel]) => `<option value="${optionValue}" ${optionValue === value ? 'selected' : ''}>${optionLabel}</option>`).join('');
  return `<label>${label}<select ${attribute}="${key}">${choices}</select></label>`;
}

function renderDesignControls() {
  const background = state.configuration.background;
  const gradient = background.gradient || { from: '#100d1d', to: '#42266f', angle: 135 };
  const asset = background.asset || { position: 'center', fit: 'cover', crop: { x: 50, y: 50 } };
  designControls.innerHTML = `<h3>تصميم الصفحة</h3><details open><summary>الخلفية</summary><div>${selectField('النوع', 'background.type', background.type, [['solid', 'لون ثابت'], ['gradient', 'تدرج'], ['image', 'صورة'], ['gif', 'GIF'], ['video', 'فيديو']])}${field('لون الخلفية', 'background.color', background.color || '#100d1d', 'text', 'data-design-field="background.color"')}${field('لون التدرج الأول', 'background.gradient.from', gradient.from, 'text', 'data-design-field="background.gradient.from"')}${field('لون التدرج الثاني', 'background.gradient.to', gradient.to, 'text', 'data-design-field="background.gradient.to"')}${field('زاوية التدرج', 'background.gradient.angle', gradient.angle, 'number', 'data-design-field="background.gradient.angle" min="0" max="360"')}<label class="upload-field">رفع صورة أو GIF أو فيديو<input data-upload="background" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" /></label>${selectField('الموضع', 'background.asset.position', asset.position, [['center', 'الوسط'], ['top', 'أعلى'], ['bottom', 'أسفل'], ['left', 'يسار'], ['right', 'يمين']])}${selectField('الحجم', 'background.asset.fit', asset.fit, [['cover', 'تغطية'], ['contain', 'احتواء']])}${field('Blur', 'background.blur', background.blur, 'number', 'data-design-field="background.blur" min="0" max="32"')}${field('Brightness', 'background.brightness', background.brightness, 'number', 'data-design-field="background.brightness" min="0.2" max="1.5" step="0.05"')}${field('لون الطبقة العلوية', 'background.overlayColor', background.overlayColor || '#000000', 'text', 'data-design-field="background.overlayColor"')}${field('شفافية الطبقة', 'background.overlayOpacity', background.overlayOpacity, 'number', 'data-design-field="background.overlayOpacity" min="0" max="1" step="0.05"')}${field('Vignette', 'background.vignette', background.vignette, 'number', 'data-design-field="background.vignette" min="0" max="1" step="0.05"')}${field('Grain', 'background.grain', background.grain, 'number', 'data-design-field="background.grain" min="0" max="1" step="0.05"')}</div></details>`;
}

const STICKERS = [
  ['star', 'نجمة'], ['heart', 'قلب'], ['bow', 'فيونكة'], ['sparkles', 'بريق'],
  ['cloud', 'سحابة'], ['flower', 'زهرة'], ['bubble', 'فقاعة'], ['wings', 'أجنحة']
];

function profileInspectorFields() {
  const profile = state.configuration.profileCard;
  const avatar = state.configuration.avatar;
  const banner = state.configuration.banner;
  return `${field('لون البطاقة', 'profileCard.backgroundColor', profile.backgroundColor)}${field('شفافية البطاقة', 'profileCard.opacity', profile.opacity, 'number', 'min="0" max="1" step="0.05"')}${field('Blur البطاقة', 'profileCard.blur', profile.blur, 'number', 'min="0" max="32"')}${field('لون الإطار', 'profileCard.borderColor', profile.borderColor)}${field('سمك الإطار', 'profileCard.borderWidth', profile.borderWidth, 'number', 'min="0" max="8"')}${field('استدارة الحواف', 'profileCard.borderRadius', profile.borderRadius, 'number', 'min="0" max="64"')}${field('عرض البطاقة', 'profileCard.width', profile.width, 'number', 'min="280" max="900"')}${field('المساحة الداخلية', 'profileCard.padding', profile.padding, 'number', 'min="12" max="80"')}<label class="switch-field">Glass<input data-field="profileCard.glass" type="checkbox" ${profile.glass ? 'checked' : ''} /></label><label class="switch-field">Glow<input data-field="profileCard.glow" type="checkbox" ${profile.glow ? 'checked' : ''} /></label>${selectField('الظل', 'profileCard.shadow', profile.shadow, [['none', 'بدون'], ['soft', 'خفيف'], ['strong', 'قوي']], 'data-field')}${selectField('المحاذاة', 'profileCard.alignment', profile.alignment, [['left', 'يسار'], ['center', 'وسط'], ['right', 'يمين']], 'data-field')}<label class="upload-field">رفع الصورة الشخصية<input data-upload="avatar" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>${field('حجم الصورة', 'avatar.size', avatar.size, 'number', 'min="48" max="240"')}${selectField('الشكل', 'avatar.shape', avatar.shape, [['circle', 'دائري'], ['rounded-square', 'مربع دائري'], ['square', 'مربع']], 'data-field')}${field('لون إطار الصورة', 'avatar.borderColor', avatar.borderColor)}${field('سمك إطار الصورة', 'avatar.borderWidth', avatar.borderWidth, 'number', 'min="0" max="8"')}${field('موضع قص الصورة أفقيًا', 'avatar.asset.crop.x', avatar.asset?.crop?.x ?? 50, 'number', 'min="0" max="100"')}${field('موضع قص الصورة عموديًا', 'avatar.asset.crop.y', avatar.asset?.crop?.y ?? 50, 'number', 'min="0" max="100"')}<label class="switch-field">Glow للصورة<input data-field="avatar.glow" type="checkbox" ${avatar.glow ? 'checked' : ''} /></label>${selectField('ظل الصورة', 'avatar.shadow', avatar.shadow, [['none', 'بدون'], ['soft', 'خفيف'], ['strong', 'قوي']], 'data-field')}<label class="switch-field">إظهار البانر<input data-field="banner.visible" type="checkbox" ${banner.visible ? 'checked' : ''} /></label><label class="upload-field">رفع البانر<input data-upload="banner" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>${field('استدارة البانر', 'banner.borderRadius', banner.borderRadius, 'number', 'min="0" max="64"')}${field('موضع قص البانر أفقيًا', 'banner.asset.crop.x', banner.asset?.crop?.x ?? 50, 'number', 'min="0" max="100"')}${field('موضع قص البانر عموديًا', 'banner.asset.crop.y', banner.asset?.crop?.y ?? 50, 'number', 'min="0" max="100"')}`;
}

function typographyInspectorFields(element) {
  const style = element.style;
  return `${selectField('الخط', 'style.fontFamily', style.fontFamily || 'Cairo', [['Cairo', 'Cairo'], ['Space Grotesk', 'Space Grotesk'], ['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'], ['Verdana', 'Verdana']], 'data-field')}${field('الحجم', 'style.fontSize', style.fontSize || 18, 'number', 'min="10" max="96"')}${selectField('الوزن', 'style.fontWeight', style.fontWeight || '400', [['400', 'عادي'], ['500', 'متوسط'], ['600', 'شبه عريض'], ['700', 'عريض'], ['800', 'ثقيل']], 'data-field')}${field('لون النص', 'style.color', style.color || '#fff7dc')}${selectField('المحاذاة', 'style.textAlign', style.textAlign || 'right', [['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']], 'data-field')}${field('تباعد الحروف', 'style.letterSpacing', style.letterSpacing || 0, 'number', 'min="-2" max="16" step="0.1"')}${field('ارتفاع السطر', 'style.lineHeight', style.lineHeight || 1.4, 'number', 'min="0.8" max="3" step="0.1"')}${selectField('التأثير', 'style.effect', style.effect || 'none', [['none', 'بدون'], ['gradient', 'تدرج'], ['glow', 'Glow'], ['shimmer', 'Shimmer'], ['typewriter', 'Typewriter'], ['wave', 'Wave']], 'data-field')}`;
}

function widgetInspectorFields(element) {
  const data = element.widgetData;
  if (data.kind === 'quote') return `${field('النص', 'widgetData.text', data.text)}${field('الكاتب', 'widgetData.author', data.author)}`;
  if (data.kind === 'mood') return `${field('المزاج', 'widgetData.text', data.text)}${field('الأيقونة', 'widgetData.icon', data.icon)}`;
  if (data.kind === 'characters' || data.kind === 'games') return data.items.map((item, index) => `${field('الاسم', `widgetData.items.${index}.name`, item.name)}${field('رابط الصورة', `widgetData.items.${index}.image.url`, item.image.url, 'url')}<label class="upload-field">رفع صورة<input data-upload="widget-image" data-widget-index="${index}" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>`).join('') + `<button type="button" data-widget-action="item">+ إضافة</button>`;
  if (data.kind === 'gallery') return `${selectField('التخطيط', 'widgetData.layout', data.layout, [['grid', 'Grid'], ['polaroid', 'Polaroid'], ['masonry', 'Masonry']], 'data-field')}${data.items.map((item, index) => `${field('رابط الصورة', `widgetData.items.${index}.image.url`, item.image.url, 'url')}${field('التعليق', `widgetData.items.${index}.caption`, item.caption || '')}<label class="upload-field">رفع صورة<input data-upload="widget-image" data-widget-index="${index}" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>`).join('')}<button type="button" data-widget-action="item">+ إضافة صورة</button>`;
  if (data.kind === 'counter') return field('العنوان', 'widgetData.label', data.label);
  if (data.kind === 'clock') return `${selectField('النظام', 'widgetData.format', data.format, [['12h', '12 ساعة'], ['24h', '24 ساعة']], 'data-field')}<label class="switch-field">الثواني<input data-field="widgetData.showSeconds" type="checkbox" ${data.showSeconds ? 'checked' : ''} /></label>`;
  if (data.kind === 'countdown') return `${field('العنوان', 'widgetData.title', data.title)}${field('الموعد', 'widgetData.targetDate', data.targetDate.slice(0, 16), 'datetime-local')}${field('بعد الانتهاء', 'widgetData.finishedText', data.finishedText)}`;
  if (data.kind === 'poll') return `${field('السؤال', 'widgetData.question', data.question)}${data.options.map((option, index) => field('خيار', `widgetData.options.${index}.label`, option.label)).join('')}<button type="button" data-widget-action="option">+ خيار</button>`;
  return field('النص', 'widgetData.text', data.text);
}

function renderMobileInspector() {
  const element = selected();
  if (!element) {
    inspector.innerHTML = '<p>Select an element to edit its mobile layout.</p>';
    return;
  }
  const overrides = element.mobileOverrides || {};
  const enabled = element.mobileOverrides !== undefined;
  const toggle = `<label class="switch-field mobile-override-toggle">Mobile override<input data-mobile-override-toggle type="checkbox" ${enabled ? 'checked' : ''} /></label>`;
  if (!enabled) {
    inspector.innerHTML = `${toggle}<p class="inspector-hint">Enable this override to change only this element on mobile. Desktop settings stay unchanged.</p>`;
    return;
  }
  const layout = responsive.resolveElementLayout(element, true);
  const position = layout.position;
  inspector.innerHTML = `${toggle}<label class="switch-field">Hide on mobile<input data-field="mobileOverrides.hideOnMobile" type="checkbox" ${overrides.hideOnMobile ? 'checked' : ''} /></label>${field('Mobile X', 'mobileOverrides.mobilePosition.x', position.x, 'number', 'min="0" max="100" step="0.1"')}${field('Mobile Y', 'mobileOverrides.mobilePosition.y', position.y, 'number', 'min="0" max="100" step="0.1"')}${field('Mobile width', 'mobileOverrides.mobileWidth', layout.size.width, 'number', 'min="1" max="100" step="0.1"')}${field('Mobile height', 'mobileOverrides.mobileHeight', layout.size.height, 'number', 'min="1" max="100" step="0.1"')}${field('Mobile scale', 'mobileOverrides.mobileScale', overrides.mobileScale ?? 1, 'number', 'min="0.5" max="2" step="0.05"')}${selectField('Mobile alignment', 'mobileOverrides.mobileAlignment', overrides.mobileAlignment || 'right', [['right', 'Right'], ['center', 'Center'], ['left', 'Left']], 'data-field')}<div class="inspect-actions"><button type="button" data-inspector-action="duplicate">Duplicate</button><button type="button" data-inspector-action="delete">Delete</button></div>`;
}

function renderInspector() {
  if (mobilePreviewActive()) {
    renderMobileInspector();
    return;
  }
  const element = selected();
  if (!element) {
    inspector.innerHTML = '<p>اختر عنصرًا لتعديل خصائصه.</p>';
    return;
  }

  const visibility = `<label class="switch-field">ظاهر<input data-field="visible" type="checkbox" ${element.visible ? 'checked' : ''} /></label>`;
  const geometry = `${field('الموضع الأفقي', 'position.x', element.position.x, 'number', 'min="0" max="100" step="0.1"')}${field('الموضع العمودي', 'position.y', element.position.y, 'number', 'min="0" max="100" step="0.1"')}${field('العرض', 'size.width', element.size.width, 'number', 'min="1" max="100" step="0.1"')}${field('الارتفاع', 'size.height', element.size.height, 'number', 'min="1" max="100" step="0.1"')}`;
  let content = '';

  if (element.type === 'profile-card') {
    const profile = state.configuration.profileCard;
    content = `${field('لون البطاقة', 'profileCard.backgroundColor', profile.backgroundColor, 'text')}${field('استدارة الحواف', 'profileCard.borderRadius', profile.borderRadius, 'number', 'min="0" max="64"')}${field('المساحة الداخلية', 'profileCard.padding', profile.padding, 'number', 'min="12" max="80"')}`;
  } else if (element.type === 'text' || element.type === 'sticker' || element.type === 'music') {
    content = `<label>المحتوى<textarea data-field="content" maxlength="500" rows="3">${escapeHtml(element.content || '')}</textarea></label>${field('لون النص', 'style.color', element.style.color || '#fff7dc', 'text')}`;
  } else if (element.type === 'image') {
    content = `${field('رابط الصورة HTTPS', 'assetUrl', element.assetUrl || '', 'url')}${field('استدارة الحواف', 'style.borderRadius', element.style.borderRadius || 12, 'number', 'min="0" max="100"')}`;
  } else if (element.type === 'social-links') {
    const link = state.configuration.socialLinks[0] || { label: 'رابط جديد', url: 'https://example.com' };
    content = `${field('اسم الرابط', 'social.label', link.label)}${field('رابط HTTPS', 'social.url', link.url, 'url')}`;
  } else if (element.type === 'widget') {
    content = widgetInspectorFields(element);
  }

  const tab = state.configuration.tabs.length
    ? selectField('التبويب', 'tabId', element.tabId || state.configuration.tabs[0].id, state.configuration.tabs.map((item) => [item.id, item.label]), 'data-field')
    : '';

  if (element.type === 'profile-card') content = profileInspectorFields();
  if (element.type === 'text') content += typographyInspectorFields(element);
  if (element.type === 'image') content += `${field('اسم الطبقة', 'name', element.name || '')}${field('الدوران', 'style.rotation', element.style.rotation || 0, 'number', 'min="-180" max="180"')}${field('الشفافية', 'style.opacity', element.style.opacity ?? 1, 'number', 'min="0" max="1" step="0.05"')}<label class="switch-field">قلب أفقي<input data-field="style.flipX" type="checkbox" ${element.style.flipX ? 'checked' : ''} /></label><label class="switch-field">توهج<input data-field="style.glow" type="checkbox" ${element.style.glow ? 'checked' : ''} /></label>${selectField('الظل', 'style.shadow', element.style.shadow || 'none', [['none', 'بدون'], ['soft', 'خفيف'], ['strong', 'قوي']], 'data-field')}${selectField('الحركة', 'style.animation', element.style.animation || 'none', [['none', 'بدون'], ['float', 'طفو'], ['pulse', 'نبض'], ['gentleRotate', 'دوران لطيف'], ['fade', 'تلاشي']], 'data-field')}`;
  if (element.type === 'image') content += '<label class="upload-field">رفع صورة<input data-upload="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>';
  inspector.innerHTML = `${visibility}${geometry}${tab}${content}<div class="inspect-actions"><button type="button" data-inspector-action="duplicate">نسخ</button><button type="button" data-inspector-action="delete">حذف</button></div>`;
}

function renderStickerLibrary() {
  designControls.insertAdjacentHTML('beforeend', `<details id="sticker-library"><summary>مكتبة الزينة</summary><div class="sticker-library">${STICKERS.map(([name, label]) => `<button type="button" data-sticker="${name}" aria-label="${label}"><img src="/assets/stickers/${name}.svg" alt="" /><span>${label}</span></button>`).join('')}</div></details>`);
}

function renderWidgetLibrary() {
  const widgets = [['quote', 'Quote'], ['mood', 'Mood'], ['characters', 'Characters'], ['games', 'Games'], ['gallery', 'Gallery'], ['counter', 'Counter'], ['clock', 'Clock'], ['countdown', 'Countdown'], ['poll', 'Poll'], ['guestbook', 'Guestbook']];
  designControls.insertAdjacentHTML('beforeend', `<details id="widget-library"><summary>Widgets</summary><div class="widget-library">${widgets.map(([kind, label]) => `<button type="button" data-widget-add="${kind}">${label}</button>`).join('')}</div></details>`);
}

function renderExperienceControls() {
  const music = state.configuration.musicPlayer;
  const entrance = state.configuration.entranceScreen;
  const cursor = state.configuration.cursor;
  designControls.insertAdjacentHTML('beforeend', `<details><summary>الموسيقى</summary><div><label class="switch-field">تفعيل المشغل<input data-design-field="musicPlayer.enabled" type="checkbox" ${music.enabled ? 'checked' : ''} /></label><label class="upload-field">رفع ملف صوتي (MP3, OGG, WAV, M4A — حتى 15MB)<input data-upload="music-audio" type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/x-wav,audio/mp4" /></label><label class="upload-field">رفع الغلاف<input data-upload="music-cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>${field('العنوان', 'musicPlayer.title', music.title, 'text', 'data-design-field="musicPlayer.title" maxlength="120"')}${field('الفنان', 'musicPlayer.artist', music.artist, 'text', 'data-design-field="musicPlayer.artist" maxlength="120"')}<label class="switch-field">تكرار<input data-design-field="musicPlayer.loop" type="checkbox" ${music.loop ? 'checked' : ''} /></label>${selectField('النمط', 'musicPlayer.preset', music.preset, [['minimal', 'Minimal'], ['glass', 'Glass'], ['cd', 'CD'], ['vinyl', 'Vinyl'], ['cassette', 'Cassette'], ['pixel', 'Pixel']])}</div></details><details><summary>شاشة الدخول</summary><div><label class="switch-field">تفعيل شاشة الدخول<input data-design-field="entranceScreen.enabled" type="checkbox" ${entrance.enabled ? 'checked' : ''} /></label><label class="upload-field">صورة شاشة الدخول<input data-upload="entrance-background" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>${field('لون الخلفية', 'entranceScreen.backgroundColor', entrance.backgroundColor, 'text', 'data-design-field="entranceScreen.backgroundColor"')}${field('النص', 'entranceScreen.text', entrance.text, 'text', 'data-design-field="entranceScreen.text" maxlength="120"')}${field('حجم النص', 'entranceScreen.textStyle.fontSize', entrance.textStyle.fontSize, 'number', 'data-design-field="entranceScreen.textStyle.fontSize" min="10" max="96"')}${field('لون النص', 'entranceScreen.textStyle.color', entrance.textStyle.color, 'text', 'data-design-field="entranceScreen.textStyle.color"')}${selectField('الانتقال', 'entranceScreen.transition', entrance.transition, [['fade', 'Fade'], ['blurFade', 'Blur fade'], ['zoomFade', 'Zoom fade'], ['pixelLike', 'Pixel like']])}</div></details><details><summary>المؤشر</summary><div>${selectField('نوع المؤشر', 'cursor.type', cursor.type, [['default', 'الافتراضي'], ['image', 'صورة مخصصة']])}<label class="upload-field">صورة مؤشر مخصصة<input data-upload="cursor-image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>${selectField('أثر المؤشر', 'cursor.trail', cursor.trail, [['none', 'بدون'], ['stars', 'نجوم'], ['hearts', 'قلوب'], ['sparkles', 'بريق'], ['bubbles', 'فقاعات']])}${field('لون الأثر', 'cursor.color', cursor.color, 'text', 'data-design-field="cursor.color"')}</div></details>`);
}

function renderTabsControls() {
  const tabs = state.configuration.tabs;
  designControls.insertAdjacentHTML('beforeend', `<details><summary>التبويبات</summary><div class="tabs-editor-list">${tabs.map((tab, index) => `${field('الاسم', `tabs.${index}.label`, tab.label, 'text', `data-design-field="tabs.${index}.label" maxlength="40"`)}${selectField('الانتقال', `tabs.${index}.transition`, tab.transition, [['fade', 'Fade'], ['slide', 'Slide'], ['blur', 'Blur']])}<button type="button" data-tab-remove="${tab.id}">حذف ${tab.label}</button>`).join('')}<button type="button" data-tab-add ${tabs.length >= 5 ? 'disabled' : ''}>+ إضافة تبويب</button></div></details>`);
}

function renderCommunityControls() {
  const presets = state.configuration.reactionPresets;
  designControls.insertAdjacentHTML('beforeend', `<details><summary>التفاعل والمفكرة</summary><div><label class="switch-field">تفعيل التفاعلات<input data-page-field="reactionsEnabled" type="checkbox" ${currentPage.reactionsEnabled ? 'checked' : ''} /></label><div class="reaction-presets">${['❤️', '⭐', '🎀', '🔥'].map((reaction) => `<button type="button" data-reaction-preset="${reaction}" aria-pressed="${presets.includes(reaction)}">${reaction}</button>`).join('')}</div><label class="switch-field">فتح سجل الزوار<input data-page-field="guestbookEnabled" type="checkbox" ${currentPage.guestbookEnabled ? 'checked' : ''} /></label><label class="switch-field">السماح بالـ Remix<input data-page-field="remixEnabled" type="checkbox" ${currentPage.remixEnabled ? 'checked' : ''} /></label></div></details>`);
}

function renderThemeControls() {
  const themes = ['soft-pink', 'dreamcore', 'dark-anime', 'cyber', 'webcore', 'y2k', 'minimal-glass', 'sakura', 'space', 'scrapbook'];
  designControls.insertAdjacentHTML('beforeend', `<details><summary>Built-in Themes</summary><div class="theme-library">${themes.map((theme) => `<div><b>${theme.replace(/-/g, ' ')}</b><span><button type="button" data-theme="${theme}" data-theme-mode="style">ألوان فقط</button><button type="button" data-theme="${theme}" data-theme-mode="full">تصميم كامل</button></span></div>`).join('')}</div></details>`);
}

function renderAll() {
  renderPreview();
  renderLayers();
  renderDesignControls();
  renderStickerLibrary();
  renderWidgetLibrary();
  renderExperienceControls();
  renderTabsControls();
  renderCommunityControls();
  renderThemeControls();
  renderInspector();
  undoButton.disabled = state.historyIndex === 0;
  redoButton.disabled = state.historyIndex >= state.history.length - 1;
  deleteButton.disabled = selected()?.type === 'profile-card' || !selected();
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  saveStatus.textContent = 'بانتظار الحفظ';
  saveStatus.className = 'save-status is-saving';
  autosaveTimer = setTimeout(saveConfiguration, 850);
}

async function saveConfiguration() {
  if (!state) return;
  if (saving) {
    saveAgain = true;
    return;
  }
  saving = true;
  const snapshot = clone(state.configuration);
  saveStatus.textContent = 'جارٍ الحفظ';
  saveStatus.className = 'save-status is-saving';
  try {
    const data = await request('/api/pages/me', { method: 'PATCH', body: JSON.stringify({ configuration: snapshot }) });
    currentPage = { ...currentPage, ...data.page };
    saveStatus.textContent = 'محفوظ';
    saveStatus.className = 'save-status';
  } catch (error) {
    saveStatus.textContent = 'فشل الحفظ';
    saveStatus.className = 'save-status is-error';
  } finally {
    saving = false;
    if (saveAgain || JSON.stringify(snapshot) !== JSON.stringify(state.configuration)) {
      saveAgain = false;
      scheduleAutosave();
    }
  }
}

function commitChange() {
  EditorState.pushHistory(state);
  renderAll();
  scheduleAutosave();
}

function selectElement(id) {
  state.selectedId = id;
  renderAll();
}

function addElement(type) {
  if (state.configuration.elements.length >= 30) return;
  const tabId = state.configuration.tabs[0]?.id;
  if (type === 'social-links') {
    if (!state.configuration.socialLinks.length) state.configuration.socialLinks.push({ id: EditorState.createId('link'), label: 'رابط جديد', url: 'https://example.com', visible: true });
    EditorState.addElement(state, { type, size: { width: 48, height: 10 }, tabId });
  } else if (type === 'text') {
    EditorState.addElement(state, { type, content: 'اكتب هنا...', size: { width: 38, height: 12 }, style: { color: '#fff7dc', fontSize: 20 }, tabId });
  } else if (type === 'image') {
    EditorState.addElement(state, { type, assetUrl: 'https://celes.lol/assets/logo.png', size: { width: 24, height: 24 }, tabId });
  } else if (type === 'sticker') {
    EditorState.addElement(state, { type, content: '✨', size: { width: 14, height: 16 }, tabId });
  } else if (type === 'music') {
    EditorState.addElement(state, { type, content: 'مشغل موسيقى', size: { width: 35, height: 11 }, tabId });
  }
  renderAll();
  scheduleAutosave();
}

function addSticker(name) {
  if (state.configuration.elements.length >= 30) return;
  EditorState.addElement(state, {
    type: 'image',
    name: `Sticker: ${name}`,
    assetUrl: `/assets/stickers/${name}.svg`,
    size: { width: 14, height: 14 },
    style: { borderRadius: 0, shadow: 'none', glow: false, animation: 'none' },
    tabId: state.configuration.tabs[0]?.id
  });
  renderAll();
  scheduleAutosave();
}

function addWidget(kind) {
  if (state.configuration.elements.length >= 30 || state.configuration.elements.filter((item) => item.type === 'widget').length >= 6) return;
  EditorState.addElement(state, { type: 'widget', widget: kind, widgetData: widgetDefault(kind), name: `Widget: ${kind}`, size: { width: 38, height: kind === 'gallery' ? 30 : 16 }, tabId: state.configuration.tabs[0]?.id });
  renderAll();
  scheduleAutosave();
}

function addTab() {
  if (state.configuration.tabs.length >= 5) return;
  const tab = { id: EditorState.createId('tab'), label: `Tab ${state.configuration.tabs.length + 1}`, transition: 'fade', visible: true };
  state.configuration.tabs.push(tab);
  state.configuration.elements.forEach((element) => { if (!element.tabId) element.tabId = tab.id; });
  commitChange();
}

function removeTab(id) {
  if (state.configuration.tabs.length < 2) return;
  state.configuration.tabs = state.configuration.tabs.filter((tab) => tab.id !== id);
  const fallback = state.configuration.tabs[0].id;
  state.configuration.elements.forEach((element) => { if (element.tabId === id) element.tabId = fallback; });
  commitChange();
}

function setNested(target, path, value) {
  const keys = path.split('.');
  let current = target;
  keys.slice(0, -1).forEach((key) => {
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  });
  current[keys.at(-1)] = value;
}

function inputValue(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'number') return Number(input.value);
  return input.value;
}

function applyInspectorChange(input) {
  const element = selected();
  if (!element || !input.dataset.field) return;
  const key = input.dataset.field;
  let value = inputValue(input);
  if (key === 'widgetData.targetDate' && input.value) value = new Date(input.value).toISOString();
  if (key.startsWith('profileCard.')) setNested(state.configuration, key, value);
  else if (key.startsWith('avatar.') || key.startsWith('banner.')) {
    if (key.includes('.asset.') && !state.configuration[key.split('.')[0]].asset) return;
    setNested(state.configuration, key, value);
  }
  else if (key.startsWith('social.')) {
    if (!state.configuration.socialLinks.length) state.configuration.socialLinks.push({ id: EditorState.createId('link'), label: 'رابط جديد', url: 'https://example.com', visible: true });
    state.configuration.socialLinks[0][key.split('.')[1]] = value;
  } else {
    if (key.startsWith('mobileOverrides.mobilePosition.')) {
      element.mobileOverrides ||= {};
      element.mobileOverrides.mobilePosition ||= clone(element.position);
    }
    setNested(element, key, value);
  }
  commitChange();
}

function applyDesignChange(input) {
  const key = input.dataset.designField;
  if (!key) return;
  if (key.startsWith('background.asset.') && !state.configuration.background.asset) return;
  setNested(state.configuration, key, inputValue(input));
  commitChange();
}

async function updatePageSetting(input) {
  const key = input.dataset.pageField;
  if (!key) return;
  try {
    const data = await request('/api/pages/me', { method: 'PATCH', body: JSON.stringify({ [key]: input.checked }) });
    currentPage = { ...currentPage, ...data.page };
    renderAll();
  } catch (error) {
    saveStatus.textContent = error.message;
    saveStatus.className = 'save-status is-error';
  }
}

async function applyBuiltInTheme(theme, mode) {
  const hasContent = state.configuration.elements.length > 1 || state.configuration.socialLinks.length || state.configuration.avatar.asset || state.configuration.banner.asset || state.configuration.musicPlayer.audioUrl;
  if (mode === 'full' && hasContent && !window.confirm('سيستبدل التصميم الكامل العناصر والروابط والوسائط الحالية. هل تريد المتابعة؟')) return;
  try {
    const data = await request('/api/pages/me/theme', { method: 'POST', body: JSON.stringify({ theme, mode }) });
    currentPage = data.page;
    state = EditorState.createState(clone(currentPage.configuration));
    renderAll();
    saveStatus.textContent = 'تم تطبيق القالب';
  } catch (error) {
    saveStatus.textContent = error.message;
    saveStatus.className = 'save-status is-error';
  }
}

async function uploadAsset(input) {
  const file = input.files?.[0];
  const purpose = input.dataset.upload;
  if (!file || !purpose) return;
  saveStatus.textContent = 'جارٍ الرفع';
  saveStatus.className = 'save-status is-saving';
  const form = new FormData();
  form.append('asset', file);
  form.append('purpose', purpose === 'image' ? 'image' : purpose);
  try {
    const response = await fetch('/api/pages/assets', { method: 'POST', credentials: 'same-origin', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'تعذر رفع الملف.');
    if (purpose === 'background') {
      state.configuration.background.asset = data.asset;
      state.configuration.background.type = data.mediaType;
    } else if (purpose === 'avatar') {
      state.configuration.avatar.asset = data.asset;
    } else if (purpose === 'banner') {
      state.configuration.banner.asset = data.asset;
      state.configuration.banner.visible = true;
    } else if (purpose === 'image') {
      const element = selected();
      if (element?.type === 'image') element.assetUrl = data.asset.url;
    } else if (purpose === 'music-audio') {
      state.configuration.musicPlayer.audioUrl = data.asset.url;
      state.configuration.musicPlayer.enabled = true;
    } else if (purpose === 'music-cover') {
      state.configuration.musicPlayer.cover = data.asset;
    } else if (purpose === 'entrance-background') {
      state.configuration.entranceScreen.background = data.asset;
    } else if (purpose === 'cursor-image') {
      state.configuration.cursor.image = data.asset;
      state.configuration.cursor.type = 'image';
    } else if (purpose === 'widget-image') {
      const element = selected();
      const index = Number(input.dataset.widgetIndex);
      if (element?.type === 'widget' && Number.isInteger(index) && element.widgetData.items?.[index]) element.widgetData.items[index].image = data.asset;
    }
    commitChange();
  } catch (error) {
    saveStatus.textContent = error.message;
    saveStatus.className = 'save-status is-error';
  }
}

function deleteSelected() {
  const before = state.historyIndex;
  EditorState.deleteSelected(state);
  if (state.historyIndex === before) return;
  renderAll();
  scheduleAutosave();
}

function duplicateSelected() {
  const before = state.historyIndex;
  EditorState.duplicateSelected(state);
  if (state.historyIndex === before) return;
  renderAll();
  scheduleAutosave();
}

function onPointerDown(event) {
  const elementNode = event.target.closest('.editor-element');
  if (!elementNode) return;
  const element = state.configuration.elements.find((item) => item.id === elementNode.dataset.id);
  if (!element) return;
  event.preventDefault();
  if (state.selectedId !== element.id) selectElement(element.id);
  const rect = preview.getBoundingClientRect();
  const layout = responsive.resolveElementLayout(element, mobilePreviewActive());
  pointerAction = {
    id: element.id,
    mode: event.target.closest('.resize-handle') ? 'resize' : 'drag',
    startX: event.clientX,
    startY: event.clientY,
    width: rect.width,
    height: rect.height,
    position: clone(layout.position),
    size: clone(layout.size),
    changed: false
  };
  preview.setPointerCapture(event.pointerId);
  elementNode.classList.add('is-dragging');
}

function onPointerMove(event) {
  if (!pointerAction) return;
  const element = state.configuration.elements.find((item) => item.id === pointerAction.id);
  if (!element) return;
  const deltaX = ((event.clientX - pointerAction.startX) / pointerAction.width) * 100;
  const deltaY = ((event.clientY - pointerAction.startY) / pointerAction.height) * 100;
  const mobile = mobilePreviewActive();
  if (pointerAction.mode === 'drag') {
    const x = Math.max(0, Math.min(100, pointerAction.position.x + deltaX));
    const y = Math.max(0, Math.min(100, pointerAction.position.y + deltaY));
    if (mobile) {
      element.mobileOverrides ||= {};
      element.mobileOverrides.mobilePosition = { x, y };
    } else {
      element.position.x = x;
      element.position.y = y;
    }
  } else {
    const width = Math.max(1, Math.min(100, pointerAction.size.width + deltaX));
    const height = Math.max(1, Math.min(100, pointerAction.size.height + deltaY));
    if (mobile) {
      element.mobileOverrides ||= {};
      element.mobileOverrides.mobileWidth = width;
      element.mobileOverrides.mobileHeight = height;
    } else {
      element.size.width = width;
      element.size.height = height;
    }
  }
  pointerAction.changed = true;
  const node = preview.querySelector(`[data-id="${pointerAction.id}"]`);
  if (node) applyGeometry(node, element, responsive.resolveElementLayout(element, mobile));
}

function onPointerUp(event) {
  if (!pointerAction) return;
  const action = pointerAction;
  pointerAction = null;
  if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId);
  preview.querySelector(`[data-id="${action.id}"]`)?.classList.remove('is-dragging');
  if (!action.changed) return;
  EditorState.pushHistory(state);
  renderLayers();
  renderInspector();
  scheduleAutosave();
}

let draggedLayerId = null;

document.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => addElement(button.dataset.add)));
document.querySelector('[data-show-stickers]').addEventListener('click', () => {
  editorApp.dataset.panel = 'settings';
  document.querySelectorAll('[data-panel-tab]').forEach((item) => item.classList.toggle('is-active', item.dataset.panelTab === 'settings'));
  designControls.querySelector('#sticker-library')?.setAttribute('open', '');
  designControls.querySelector('#sticker-library')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
document.querySelector('[data-show-widgets]').addEventListener('click', () => {
  editorApp.dataset.panel = 'settings';
  document.querySelectorAll('[data-panel-tab]').forEach((item) => item.classList.toggle('is-active', item.dataset.panelTab === 'settings'));
  designControls.querySelector('#widget-library')?.setAttribute('open', '');
  designControls.querySelector('#widget-library')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
layersList.addEventListener('click', (event) => {
  const row = event.target.closest('.layer-row');
  const action = event.target.dataset.action;
  if (!row || !action) return;
  const id = row.dataset.id;
  if (action === 'select') return selectElement(id);
  if (action === 'visibility') {
    EditorState.updateElement(state, id, (element) => { element.visible = !element.visible; });
  } else if (action === 'up') {
    EditorState.setLayer(state, id, 1);
  } else if (action === 'down') {
    EditorState.setLayer(state, id, -1);
  }
  renderAll();
  scheduleAutosave();
});
layersList.addEventListener('dragstart', (event) => {
  const row = event.target.closest('.layer-row');
  if (!row) return;
  draggedLayerId = row.dataset.id;
  row.classList.add('is-dragging');
  event.dataTransfer.effectAllowed = 'move';
});
layersList.addEventListener('dragover', (event) => {
  const row = event.target.closest('.layer-row');
  if (!row || !draggedLayerId) return;
  event.preventDefault();
  row.classList.add('is-drop-target');
  event.dataTransfer.dropEffect = 'move';
});
layersList.addEventListener('dragleave', (event) => event.target.closest('.layer-row')?.classList.remove('is-drop-target'));
layersList.addEventListener('dragend', () => {
  draggedLayerId = null;
  layersList.querySelectorAll('.is-dragging, .is-drop-target').forEach((row) => row.classList.remove('is-dragging', 'is-drop-target'));
});
layersList.addEventListener('drop', (event) => {
  const target = event.target.closest('.layer-row');
  if (!target || !draggedLayerId || target.dataset.id === draggedLayerId) return;
  event.preventDefault();
  const ids = [...layersList.querySelectorAll('.layer-row')].map((row) => row.dataset.id);
  const from = ids.indexOf(draggedLayerId);
  const to = ids.indexOf(target.dataset.id);
  ids.splice(from, 1);
  ids.splice(to, 0, draggedLayerId);
  EditorState.setOrder(state, ids);
  draggedLayerId = null;
  renderAll();
  scheduleAutosave();
});
inspector.addEventListener('change', (event) => {
  if (event.target.dataset.upload) return uploadAsset(event.target);
  return applyInspectorChange(event.target);
});
designControls.addEventListener('change', (event) => {
  if (event.target.dataset.upload) return uploadAsset(event.target);
  if (event.target.dataset.pageField) return updatePageSetting(event.target);
  return applyDesignChange(event.target);
});
designControls.addEventListener('click', (event) => {
  const sticker = event.target.closest('[data-sticker]');
  if (sticker) addSticker(sticker.dataset.sticker);
  const widget = event.target.closest('[data-widget-add]');
  if (widget) addWidget(widget.dataset.widgetAdd);
  const reaction = event.target.closest('[data-reaction-preset]');
  if (reaction) {
    const value = reaction.dataset.reactionPreset;
    const presets = state.configuration.reactionPresets;
    if (presets.includes(value) && presets.length > 1) state.configuration.reactionPresets = presets.filter((item) => item !== value);
    else if (!presets.includes(value)) state.configuration.reactionPresets.push(value);
    commitChange();
  }
  const theme = event.target.closest('[data-theme]');
  if (theme) applyBuiltInTheme(theme.dataset.theme, theme.dataset.themeMode);
  if (event.target.closest('[data-tab-add]')) addTab();
  const remove = event.target.closest('[data-tab-remove]');
  if (remove) removeTab(remove.dataset.tabRemove);
});
inspector.addEventListener('click', (event) => {
  const mobileToggle = event.target.closest('[data-mobile-override-toggle]');
  if (mobileToggle) {
    const element = selected();
    if (!element) return;
    if (mobileToggle.checked) element.mobileOverrides ||= {};
    else delete element.mobileOverrides;
    commitChange();
    return;
  }
  const action = event.target.dataset.inspectorAction;
  if (action === 'delete') deleteSelected();
  if (action === 'duplicate') duplicateSelected();
  const widgetAction = event.target.dataset.widgetAction;
  const element = selected();
  if (!widgetAction || element?.type !== 'widget') return;
  const data = element.widgetData;
  if (widgetAction === 'item' && (data.kind === 'characters' || data.kind === 'games') && data.items.length < 6) data.items.push({ id: EditorState.createId('item'), name: 'عنصر جديد', image: { url: 'https://celes.lol/assets/logo.png', position: 'center', fit: 'cover' } });
  if (widgetAction === 'item' && data.kind === 'gallery' && data.items.length < 12) data.items.push({ id: EditorState.createId('item'), image: { url: 'https://celes.lol/assets/logo.png', position: 'center', fit: 'cover' }, caption: '' });
  if (widgetAction === 'option' && data.kind === 'poll' && data.options.length < 4) data.options.push({ id: EditorState.createId('option'), label: 'خيار جديد' });
  commitChange();
});
deleteButton.addEventListener('click', deleteSelected);
undoButton.addEventListener('click', () => { if (EditorState.undo(state)) { renderAll(); scheduleAutosave(); } });
redoButton.addEventListener('click', () => { if (EditorState.redo(state)) { renderAll(); scheduleAutosave(); } });
preview.addEventListener('pointerdown', onPointerDown);
preview.addEventListener('pointermove', onPointerMove);
preview.addEventListener('pointerup', onPointerUp);
preview.addEventListener('pointercancel', onPointerUp);
desktopPreviewButton.addEventListener('click', () => {
  editorApp.dataset.preview = 'desktop';
  preview.dataset.mode = 'desktop';
  previewLabel.textContent = 'معاينة سطح المكتب';
  desktopPreviewButton.classList.add('is-active');
  mobilePreviewButton.classList.remove('is-active');
  renderAll();
});
mobilePreviewButton.addEventListener('click', () => {
  editorApp.dataset.preview = 'mobile';
  preview.dataset.mode = 'mobile';
  previewLabel.textContent = 'معاينة الجوال';
  mobilePreviewButton.classList.add('is-active');
  desktopPreviewButton.classList.remove('is-active');
  renderAll();
});
document.querySelectorAll('[data-panel-tab]').forEach((button) => button.addEventListener('click', () => {
  editorApp.dataset.panel = button.dataset.panelTab;
  document.querySelectorAll('[data-panel-tab]').forEach((item) => item.classList.toggle('is-active', item === button));
}));

async function initializeEditor() {
  const auth = await request('/auth/me');
  if (!auth.authenticated) {
    window.location.assign('/pages');
    return;
  }
  const data = await request('/api/pages/me');
  if (!data.page) {
    gate.hidden = false;
    return;
  }
  currentPage = data.page;
  const configuration = clone(currentPage.configuration);
  const profileWasAdded = ensureProfileCard(configuration);
  state = EditorState.createState(configuration);
  publicLink.href = `/${currentPage.slug}`;
  publicLink.textContent = `celes.lol/${currentPage.slug}`;
  workspace.hidden = false;
  renderAll();
  if (profileWasAdded) scheduleAutosave();
}

initializeEditor().catch(() => {
  gate.hidden = false;
  gate.querySelector('p').textContent = 'تعذر فتح المحرر الآن. حاول مجددًا لاحقًا.';
});
