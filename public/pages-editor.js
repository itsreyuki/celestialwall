const EditorState = window.CelestiaEditorState;
const editorApp = document.querySelector('#editor-app');
const workspace = document.querySelector('#editor-workspace');
const gate = document.querySelector('#editor-gate');
const preview = document.querySelector('#page-preview');
const layersList = document.querySelector('#layers-list');
const layerCount = document.querySelector('#layer-count');
const inspector = document.querySelector('#inspector');
const designControls = document.querySelector('#design-controls');
const editorSidebar = document.querySelector('.editor-sidebar');
const saveStatus = document.querySelector('#save-status');
const undoButton = document.querySelector('#editor-undo');
const redoButton = document.querySelector('#editor-redo');
const saveButton = document.querySelector('#editor-save');
const publishButton = document.querySelector('#editor-publish');
const deleteButton = document.querySelector('#delete-element');
const publicLink = document.querySelector('#editor-public-link');
const previewLabel = document.querySelector('#preview-label');
const publishStatus = document.querySelector('#page-publish-status');
const desktopPreviewButton = document.querySelector('#preview-desktop');
const mobilePreviewButton = document.querySelector('#preview-mobile');
const socialIcons = window.CelestiaSocialIcons;

let currentPage = null;
let state = null;
let autosaveTimer = null;
let saving = false;
let saveAgain = false;
let saveWaiters = [];
let pointerAction = null;
let activeTabId = null;
let entrancePreviewVisible = true;
let inspectorMode = 'content';
const responsive = window.CelestiaPageResponsive;
const ELEMENT_LIMIT = 30;
const RESIZE_HANDLES = ['nw', 'ne', 'sw', 'se'];
const UPLOAD_LIMITS = { image: 8 * 1024 * 1024, gif: 4 * 1024 * 1024, video: 25 * 1024 * 1024, audio: 15 * 1024 * 1024 };

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
    if (!response.ok) {
      const details = Array.isArray(body.issues) ? body.issues[0]?.message : '';
      throw new Error([body.error || 'تعذر حفظ التغييرات.', details].filter(Boolean).join(' '));
    }
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
  elementNode.style.transform = `translate(-50%, -50%) scale(${layout.scale})`;
  elementNode.style.textAlign = layout.alignment || '';
  elementNode.style.color = element.style.color || '';
  elementNode.style.backgroundColor = element.type === 'profile-card' ? '' : (element.style.backgroundColor || '');
  elementNode.style.opacity = element.style.opacity ?? '';
  elementNode.style.borderRadius = element.style.borderRadius !== undefined ? `${element.style.borderRadius}px` : '';
  const previewRect = preview.getBoundingClientRect();
  if (previewRect.width && previewRect.height) elementNode.dataset.dimensions = `${Math.round(previewRect.width * layout.size.width * layout.scale / 100)} × ${Math.round(previewRect.height * layout.size.height * layout.scale / 100)} px`;
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

function renderEntrancePreview() {
  const config = state.configuration.entranceScreen;
  if (!config.enabled || !entrancePreviewVisible) return;
  const screen = document.createElement('div');
  screen.className = `editor-entrance-preview transition-${config.transition}`;
  screen.style.backgroundColor = config.backgroundColor;
  if (config.background?.url) {
    const image = document.createElement('img');
    image.src = config.background.url;
    image.alt = '';
    image.style.objectFit = config.background.fit || 'cover';
    image.style.objectPosition = assetPosition(config.background);
    screen.append(image);
  }
  const message = document.createElement('span');
  message.textContent = config.text || 'اضغط للدخول';
  applyTextStyle(message, config.textStyle);
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.dataset.dismissEntrancePreview = '';
  dismiss.textContent = 'متابعة التحرير';
  screen.append(message, dismiss);
  preview.append(screen);
}

function elementScale(element, layout) {
  return responsive.elementVisualScale(element, mobilePreviewActive(), layout);
}

function elementFontSize(element, mobile = mobilePreviewActive()) {
  if (mobile && element.mobileOverrides?.fontSize !== undefined) return element.mobileOverrides.fontSize;
  return element.style.fontSize || (element.type === 'sticker' ? 42 : 18);
}

function applyTextStyle(node, style, scale = 1) {
  node.style.fontFamily = style.fontFamily || 'Cairo';
  node.style.fontSize = `${Math.round((style.fontSize || 16) * scale * 10) / 10}px`;
  node.style.fontWeight = style.fontWeight || '400';
  node.style.color = style.color || '';
  node.style.textAlign = style.textAlign || '';
  node.style.letterSpacing = `${style.letterSpacing || 0}px`;
  node.style.lineHeight = String(style.lineHeight || 1.4);
  [...node.classList].filter((name) => name.startsWith('effect-')).forEach((name) => node.classList.remove(name));
  if (style.effect && style.effect !== 'none') node.classList.add(`effect-${style.effect}`);
}

function applyContentScale(elementNode, element, layout) {
  const scale = elementScale(element, layout);
  const profile = elementNode.querySelector('.editor-profile-card');
  if (profile) {
    const config = state.configuration.profileCard;
    const avatar = profile.querySelector('.editor-profile-avatar');
    profile.style.padding = `${Math.round(config.padding * scale)}px`;
    if (avatar) {
      avatar.style.width = `${Math.round(state.configuration.avatar.size * scale)}px`;
      avatar.style.height = `${Math.round(state.configuration.avatar.size * scale)}px`;
    }
    const name = profile.querySelector('h3');
    const bio = profile.querySelector('p');
    if (name) applyTextStyle(name, state.configuration.typography.displayName, scale);
    if (bio) applyTextStyle(bio, state.configuration.typography.bio, scale);
  }

  const textNode = elementNode.querySelector('.editor-text');
  if (textNode) textNode.style.fontSize = `${elementFontSize(element)}px`;

  const socialNode = elementNode.querySelector('.editor-social-links');
  if (socialNode) applyTextStyle(socialNode, state.configuration.typography.link, scale);

  const sticker = elementNode.querySelector('.editor-sticker');
  if (sticker) sticker.style.fontSize = `${elementFontSize(element)}px`;

  const widget = elementNode.querySelector('.editor-widget');
  if (widget) {
    widget.style.fontSize = `${Math.round((element.style.fontSize || 11) * scale * 10) / 10}px`;
    widget.style.padding = `${Math.round(Math.max(2, Math.min(36, 9 * scale)))}px`;
    const mediaSize = Math.max(10, Math.round(48 * scale));
    widget.querySelectorAll('.editor-widget-favorites figure').forEach((figure) => { figure.style.minWidth = `${mediaSize}px`; });
    widget.querySelectorAll('.editor-widget-favorites img').forEach((image) => { image.style.width = `${mediaSize}px`; image.style.height = `${mediaSize}px`; });
    widget.querySelectorAll('.editor-widget-gallery img').forEach((image) => { image.style.minHeight = `${Math.max(8, Math.round(42 * scale))}px`; image.style.maxHeight = `${Math.max(18, Math.round(110 * scale))}px`; });
  }

  const music = elementNode.querySelector('.editor-music');
  if (music) {
    music.style.fontSize = `${Math.round((element.style.fontSize || 14) * scale * 10) / 10}px`;
    const cover = music.querySelector('.editor-music-cover');
    const toggle = music.querySelector('.editor-music-toggle');
    const controlSize = Math.round(30 * scale);
    if (cover) {
      cover.style.width = `${Math.round(38 * scale)}px`;
      cover.style.height = `${Math.round(38 * scale)}px`;
    }
    if (toggle) {
      toggle.style.width = `${controlSize}px`;
      toggle.style.height = `${controlSize}px`;
    }
  }
}

function profileCardNode(element, scale = 1) {
  const config = state.configuration.profileCard;
  const card = document.createElement('article');
  card.className = 'editor-profile-card';
  card.style.background = `color-mix(in srgb, ${config.backgroundColor} ${Math.round(config.opacity * 100)}%, transparent)`;
  card.style.borderColor = config.borderColor;
  card.style.borderWidth = `${config.borderWidth}px`;
  card.style.borderRadius = `${config.borderRadius}px`;
  card.style.padding = `${Math.round(config.padding * scale)}px`;
  card.style.textAlign = config.alignment;
  card.style.width = '100%';
  card.style.height = '100%';
  card.style.maxWidth = '100%';
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
  avatar.style.width = `${Math.round(avatarConfig.size * scale)}px`;
  avatar.style.height = `${Math.round(avatarConfig.size * scale)}px`;
  avatar.style.borderRadius = avatarConfig.shape === 'circle' ? '50%' : (avatarConfig.shape === 'rounded-square' ? '22%' : '0');
  avatar.style.borderColor = avatarConfig.borderColor;
  avatar.style.borderWidth = `${avatarConfig.borderWidth}px`;
  avatar.style.boxShadow = avatarConfig.shadow === 'strong' ? '0 12px 24px rgba(0,0,0,.5)' : (avatarConfig.shadow === 'soft' ? '0 7px 16px rgba(0,0,0,.32)' : 'none');
  if (avatarConfig.glow) avatar.style.boxShadow += ', 0 0 18px rgba(241,199,94,.42)';
  const name = document.createElement('h3');
  name.textContent = currentPage.displayName || 'اسمك';
  const bio = document.createElement('p');
  bio.textContent = currentPage.bio || 'أضف نبذة من صفحة الإدارة.';
  applyTextStyle(name, state.configuration.typography.displayName, scale);
  applyTextStyle(bio, state.configuration.typography.bio, scale);
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
  return { kind: 'guestbook', text: 'اترك رسالة في سجل الزوار.' };
}

function widgetPreview(element) {
  const data = element.widgetData;
  const node = document.createElement('div');
  node.className = `editor-widget widget-${data.kind}`;
  const layout = responsive.resolveElementLayout(element, mobilePreviewActive());
  const scale = elementScale(element, layout);
  node.style.fontSize = `${Math.round((element.style.fontSize || 11) * scale * 10) / 10}px`;
  node.style.padding = `${Math.round(Math.max(2, Math.min(36, 9 * scale)))}px`;
  node.style.color = element.style.color || '';
  node.style.background = element.style.backgroundColor || '';
  node.style.borderRadius = `${element.style.borderRadius ?? 12}px`;
  if (data.kind === 'quote') {
    const quote = document.createElement('blockquote');
    quote.textContent = `“${data.text}”`;
    node.append(quote);
    if (data.author) {
      const author = document.createElement('cite');
      author.textContent = `— ${data.author}`;
      node.append(author);
    }
  } else if (data.kind === 'mood') {
    const icon = document.createElement('b');
    icon.textContent = data.icon || '✨';
    const mood = document.createElement('span');
    mood.textContent = data.text;
    node.append(icon, mood);
  } else if (data.kind === 'characters' || data.kind === 'games') {
    const list = document.createElement('div');
    list.className = 'editor-widget-favorites';
    data.items.forEach((item) => {
      const card = document.createElement('figure');
      const image = document.createElement('img');
      image.src = item.image.url;
      image.alt = '';
      image.style.objectFit = item.image.fit || 'cover';
      image.style.objectPosition = assetPosition(item.image);
      const label = document.createElement('figcaption');
      label.textContent = item.name;
      card.append(image, label);
      list.append(card);
    });
    node.append(list);
  } else if (data.kind === 'gallery') {
    const gallery = document.createElement('div');
    gallery.className = `editor-widget-gallery layout-${data.layout}`;
    data.items.forEach((item) => {
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      image.src = item.image.url;
      image.alt = '';
      image.style.objectFit = item.image.fit || 'cover';
      image.style.objectPosition = assetPosition(item.image);
      figure.append(image);
      if (item.caption) {
        const caption = document.createElement('figcaption');
        caption.textContent = item.caption;
        figure.append(caption);
      }
      gallery.append(figure);
    });
    node.append(gallery);
  } else if (data.kind === 'clock') {
    node.textContent = new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit', second: data.showSeconds ? '2-digit' : undefined, hour12: data.format === '12h' }).format(new Date());
  } else if (data.kind === 'countdown') {
    const difference = Math.max(0, new Date(data.targetDate).getTime() - Date.now());
    const total = Math.floor(difference / 1000);
    const title = document.createElement('strong');
    title.textContent = difference ? data.title : (data.finishedText || 'انتهى');
    const value = document.createElement('span');
    value.textContent = difference ? `${Math.floor(total / 86400)}d ${Math.floor(total % 86400 / 3600)}h ${Math.floor(total % 3600 / 60)}m` : '';
    node.append(title, value);
  } else if (data.kind === 'poll') {
    const question = document.createElement('strong');
    question.textContent = data.question;
    node.append(question);
    data.options.forEach((option) => {
      const button = document.createElement('span');
      button.className = 'editor-poll-option';
      button.textContent = option.label;
      node.append(button);
    });
  } else if (data.kind === 'counter') {
    node.textContent = `${data.label}: ${currentPage.viewsCount || 0}`;
  } else {
    const title = document.createElement('strong');
    title.textContent = 'Guestbook';
    const message = document.createElement('span');
    message.textContent = data.text;
    node.append(title, message);
  }
  return node;
}

function contentNode(element, layout) {
  const scale = elementScale(element, layout);
  if (element.type === 'profile-card') return profileCardNode(element, scale);
  if (element.type === 'text') {
    const node = document.createElement('div');
    node.className = 'editor-text';
    node.textContent = element.content || 'نص جديد';
    node.style.fontSize = `${elementFontSize(element)}px`;
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
    applyTextStyle(node, state.configuration.typography.link, scale);
    const links = state.configuration.socialLinks.length ? state.configuration.socialLinks : [{ label: 'رابطك' }];
    links.filter((link) => link.visible !== false).forEach((link) => {
      const item = document.createElement('span');
      item.className = 'editor-social-link';
      item.style.display = 'inline-flex';
      item.style.alignItems = 'center';
      item.style.gap = '.38em';
      const display = link.display || 'both';
      if (display !== 'text') item.append(socialIcons?.create(link.icon || 'website', link.label) || document.createTextNode('◉'));
      if (display !== 'icon') item.append(document.createTextNode(link.label));
      node.append(item);
    });
    return node;
  }
  if (element.type === 'image') {
    const node = document.createElement('div');
    node.className = 'editor-image';
    node.style.borderRadius = `${element.style.borderRadius ?? 12}px`;
    if (element.assetUrl) {
      const image = document.createElement('img');
      image.src = element.assetUrl;
      image.alt = '';
      image.style.objectFit = element.style.objectFit || 'cover';
      image.style.objectPosition = element.style.objectPosition || 'center';
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
    node.style.fontSize = `${elementFontSize(element)}px`;
    return node;
  }
  if (element.type === 'widget') return widgetPreview(element);
  const node = document.createElement('article');
  node.className = 'editor-music';
  node.style.fontSize = `${Math.round((element.style.fontSize || 14) * scale * 10) / 10}px`;
  const music = state.configuration.musicPlayer;
  const cover = document.createElement('img');
  cover.className = 'editor-music-cover';
  cover.src = music.cover?.url || '/assets/logo.png';
  cover.alt = '';
  const play = document.createElement('b');
  play.className = 'editor-music-toggle';
  play.textContent = '▶';
  play.style.width = `${Math.round(30 * scale)}px`;
  play.style.height = `${Math.round(30 * scale)}px`;
  const details = document.createElement('span');
  details.className = 'editor-music-details';
  const title = document.createElement('strong');
  title.textContent = music.title || 'عنوان الأغنية';
  const artist = document.createElement('small');
  artist.textContent = music.artist || 'الفنان';
  const progress = document.createElement('i');
  progress.className = 'editor-music-progress';
  details.append(title, artist, progress);
  node.append(cover, play, details);
  return node;
}

function contentShell(element, content = contentNode(element, responsive.resolveElementLayout(element, mobilePreviewActive()))) {
  const shell = document.createElement('div');
  shell.className = 'editor-element-content';
  shell.style.transform = `rotate(${element.style.rotation || 0}deg) scaleX(${element.style.flipX ? -1 : 1})`;
  content.style.width = '100%';
  content.style.height = '100%';
  shell.append(content);
  return shell;
}

function renderPreview() {
  preview.replaceChildren();
  renderBackground();
  const tabs = state.configuration.tabs;
  if (!tabs.some((tab) => tab.id === activeTabId)) activeTabId = tabs[0]?.id || null;
  [...state.configuration.elements]
    .sort((first, second) => first.zIndex - second.zIndex)
    .forEach((element) => {
      const layout = responsive.resolveElementLayout(element, mobilePreviewActive());
      const node = document.createElement('div');
      node.className = 'editor-element';
      node.dataset.id = element.id;
      node.dataset.label = elementLabel(element);
      node.tabIndex = 0;
      node.setAttribute('role', 'group');
      node.setAttribute('aria-label', element.name || elementLabel(element));
      node.classList.toggle('is-selected', state.selectedId === element.id);
      node.classList.toggle('is-hidden', !layout.visible);
      const belongsToActiveTab = !tabs.length || !element.tabId || element.tabId === activeTabId;
      node.hidden = !belongsToActiveTab || (mobilePreviewActive() && !layout.visible);
      if (element.type === 'image' && element.style.animation && element.style.animation !== 'none') node.classList.add(`image-animation-${element.style.animation}`);
      applyGeometry(node, element, layout);
      node.append(contentShell(element, contentNode(element, layout)));
      applyContentScale(node, element, layout);
      if (state.selectedId === element.id) {
        RESIZE_HANDLES.forEach((corner) => {
          const handle = document.createElement('button');
          handle.type = 'button';
          handle.className = `resize-handle handle-${corner}`;
          handle.dataset.resizeHandle = corner;
          handle.setAttribute('aria-label', `تغيير الحجم من زاوية ${corner}`);
          node.append(handle);
        });
      }
      preview.append(node);
    });
  if (tabs.length) {
    const navigation = document.createElement('nav');
    navigation.className = 'editor-preview-tabs';
    navigation.setAttribute('aria-label', 'معاينة التبويبات');
    tabs.forEach((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.previewTab = tab.id;
      button.classList.toggle('is-active', tab.id === activeTabId);
      button.classList.toggle('is-hidden-tab', tab.visible === false);
      button.textContent = tab.label;
      navigation.append(button);
    });
    preview.append(navigation);
  }
  const hasMusicElement = state.configuration.elements.some((element) => element.type === 'music' && element.visible !== false);
  if (state.configuration.musicPlayer.enabled && !hasMusicElement) {
    const player = document.createElement('div');
    player.className = `preview-music-player preset-${state.configuration.musicPlayer.preset}`;
    player.textContent = `▶ ${state.configuration.musicPlayer.title || 'عنوان الأغنية'} — ${state.configuration.musicPlayer.artist || 'الفنان'}`;
    preview.append(player);
  }
  renderEntrancePreview();
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
    visibility.setAttribute('aria-label', element.visible ? 'إخفاء العنصر' : 'إظهار العنصر');
    visibility.title = element.visible ? 'إخفاء' : 'إظهار';
    const up = document.createElement('button');
    up.type = 'button';
    up.dataset.action = 'up';
    up.textContent = '↑';
    up.setAttribute('aria-label', 'تحريك الطبقة للأمام');
    const down = document.createElement('button');
    down.type = 'button';
    down.dataset.action = 'down';
    down.textContent = '↓';
    down.setAttribute('aria-label', 'تحريك الطبقة للخلف');
    row.append(selectButton, visibility, up, down);
    layersList.append(row);
  });
}

function colorValue(value) {
  const hex = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/i.test(hex)) return `#${hex.slice(1).split('').map((part) => part + part).join('')}`;
  const rgba = hex.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgba) return `#${rgba.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
  return '#000000';
}

function field(label, key, value, type = 'text', extra = '') {
  const isColor = type === 'text' && /(?:color|gradient\.(?:from|to))$/i.test(key);
  const inputType = isColor ? 'color' : type;
  const inputValue = isColor ? colorValue(value) : (value ?? '');
  return `<label>${label}<input data-field="${key}" type="${inputType}" value="${escapeHtml(inputValue)}" ${extra} /></label>`;
}

function selectField(label, key, value, options, attribute = 'data-design-field') {
  const choices = options.map(([optionValue, optionLabel]) => `<option value="${optionValue}" ${optionValue === value ? 'selected' : ''}>${optionLabel}</option>`).join('');
  return `<label>${label}<select ${attribute}="${key}">${choices}</select></label>`;
}

function pixelField(label, axis, value) {
  return `<label>${label}<input data-pixel-field="${axis}" type="number" value="${value}" min="24" max="4000" step="1" inputmode="numeric" /></label>`;
}

function renderDesignControls() {
  const background = state.configuration.background;
  const gradient = background.gradient || { from: '#100d1d', to: '#42266f', angle: 135 };
  const asset = background.asset || { position: 'center', fit: 'cover', crop: { x: 50, y: 50 } };
  const removeAsset = background.asset ? '<button type="button" data-background-action="remove-background">إزالة وسائط الخلفية</button>' : '';
  const controls = `${selectField('النوع', 'background.type', background.type, [['solid', 'لون ثابت'], ['gradient', 'تدرج'], ['image', 'صورة'], ['gif', 'GIF'], ['video', 'فيديو']])}${field('لون الخلفية', 'background.color', background.color || '#100d1d', 'text', 'data-design-field="background.color"')}${field('لون التدرج الأول', 'background.gradient.from', gradient.from, 'text', 'data-design-field="background.gradient.from"')}${field('لون التدرج الثاني', 'background.gradient.to', gradient.to, 'text', 'data-design-field="background.gradient.to"')}${field('زاوية التدرج', 'background.gradient.angle', gradient.angle, 'number', 'data-design-field="background.gradient.angle" min="0" max="360"')}<label class="upload-field">رفع صورة أو GIF (8MB) أو فيديو (25MB)<input data-upload="background" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" /></label>${removeAsset}${selectField('الموضع', 'background.asset.position', asset.position, [['center', 'الوسط'], ['top', 'أعلى'], ['bottom', 'أسفل'], ['left', 'يسار'], ['right', 'يمين']])}${selectField('الحجم', 'background.asset.fit', asset.fit, [['cover', 'تغطية'], ['contain', 'احتواء']])}${field('موضع القص أفقيًا', 'background.asset.crop.x', asset.crop?.x ?? 50, 'number', 'data-design-field="background.asset.crop.x" min="0" max="100"')}${field('موضع القص عموديًا', 'background.asset.crop.y', asset.crop?.y ?? 50, 'number', 'data-design-field="background.asset.crop.y" min="0" max="100"')}${field('Blur', 'background.blur', background.blur, 'number', 'data-design-field="background.blur" min="0" max="32"')}${field('Brightness', 'background.brightness', background.brightness, 'number', 'data-design-field="background.brightness" min="0.2" max="1.5" step="0.05"')}${field('لون الطبقة العلوية', 'background.overlayColor', background.overlayColor || '#000000', 'text', 'data-design-field="background.overlayColor"')}${field('شفافية الطبقة', 'background.overlayOpacity', background.overlayOpacity, 'number', 'data-design-field="background.overlayOpacity" min="0" max="1" step="0.05"')}${field('Vignette', 'background.vignette', background.vignette, 'number', 'data-design-field="background.vignette" min="0" max="1" step="0.05"')}${field('Grain', 'background.grain', background.grain, 'number', 'data-design-field="background.grain" min="0" max="1" step="0.05"')}`;
  designControls.innerHTML = `<h3>تصميم الصفحة</h3><details open><summary>الخلفية</summary><div>${controls}</div></details>`;
}

const STICKERS = [
  ['star', 'نجمة'], ['heart', 'قلب'], ['bow', 'فيونكة'], ['sparkles', 'بريق'],
  ['cloud', 'سحابة'], ['flower', 'زهرة'], ['bubble', 'فقاعة'], ['wings', 'أجنحة']
];

function profileInspectorFields() {
  const profile = state.configuration.profileCard;
  const avatar = state.configuration.avatar;
  const banner = state.configuration.banner;
  const identity = `<fieldset class="inspector-group"><legend>المحتوى</legend><label>اسم العرض<input data-page-value="displayName" value="${escapeHtml(currentPage.displayName || '')}" minlength="1" maxlength="120" required /></label><label>النبذة<textarea data-page-value="bio" maxlength="500" rows="4">${escapeHtml(currentPage.bio || '')}</textarea></label></fieldset>`;
  const card = `<fieldset class="inspector-group"><legend>البطاقة</legend>${field('لون البطاقة', 'profileCard.backgroundColor', profile.backgroundColor)}${field('شفافية البطاقة', 'profileCard.opacity', profile.opacity, 'number', 'min="0" max="1" step="0.05"')}${field('Blur البطاقة', 'profileCard.blur', profile.blur, 'number', 'min="0" max="32"')}${field('لون الإطار', 'profileCard.borderColor', profile.borderColor)}${field('سمك الإطار', 'profileCard.borderWidth', profile.borderWidth, 'number', 'min="0" max="8"')}${field('استدارة الحواف', 'profileCard.borderRadius', profile.borderRadius, 'number', 'min="0" max="64"')}${field('المساحة الداخلية', 'profileCard.padding', profile.padding, 'number', 'min="12" max="80"')}<label class="switch-field">Glass<input data-field="profileCard.glass" type="checkbox" ${profile.glass ? 'checked' : ''} /></label><label class="switch-field">Glow<input data-field="profileCard.glow" type="checkbox" ${profile.glow ? 'checked' : ''} /></label>${selectField('الظل', 'profileCard.shadow', profile.shadow, [['none', 'بدون'], ['soft', 'خفيف'], ['strong', 'قوي']], 'data-field')}${selectField('المحاذاة', 'profileCard.alignment', profile.alignment, [['left', 'يسار'], ['center', 'وسط'], ['right', 'يمين']], 'data-field')}</fieldset>`;
  const avatarFields = `<fieldset class="inspector-group"><legend>الصورة الشخصية</legend><label class="upload-field">رفع الصورة الشخصية<input data-upload="avatar" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>${field('حجم الصورة', 'avatar.size', avatar.size, 'number', 'min="48" max="240"')}${selectField('الشكل', 'avatar.shape', avatar.shape, [['circle', 'دائري'], ['rounded-square', 'مربع دائري'], ['square', 'مربع']], 'data-field')}${field('لون الإطار', 'avatar.borderColor', avatar.borderColor)}${field('سمك الإطار', 'avatar.borderWidth', avatar.borderWidth, 'number', 'min="0" max="8"')}${field('موضع القص أفقيًا', 'avatar.asset.crop.x', avatar.asset?.crop?.x ?? 50, 'number', 'min="0" max="100"')}${field('موضع القص عموديًا', 'avatar.asset.crop.y', avatar.asset?.crop?.y ?? 50, 'number', 'min="0" max="100"')}<label class="switch-field">Glow<input data-field="avatar.glow" type="checkbox" ${avatar.glow ? 'checked' : ''} /></label>${selectField('الظل', 'avatar.shadow', avatar.shadow, [['none', 'بدون'], ['soft', 'خفيف'], ['strong', 'قوي']], 'data-field')}</fieldset>`;
  const bannerFields = `<fieldset class="inspector-group"><legend>البانر</legend><label class="switch-field">إظهار البانر<input data-field="banner.visible" type="checkbox" ${banner.visible ? 'checked' : ''} /></label><label class="upload-field">رفع البانر<input data-upload="banner" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>${field('استدارة البانر', 'banner.borderRadius', banner.borderRadius, 'number', 'min="0" max="64"')}${field('موضع القص أفقيًا', 'banner.asset.crop.x', banner.asset?.crop?.x ?? 50, 'number', 'min="0" max="100"')}${field('موضع القص عموديًا', 'banner.asset.crop.y', banner.asset?.crop?.y ?? 50, 'number', 'min="0" max="100"')}</fieldset>`;
  const typography = `<fieldset class="inspector-group"><legend>خط الاسم</legend>${textStyleInspectorFields(state.configuration.typography.displayName, 'typography.displayName')}</fieldset><fieldset class="inspector-group"><legend>خط النبذة</legend>${textStyleInspectorFields(state.configuration.typography.bio, 'typography.bio')}</fieldset>`;
  return `${identity}${card}${avatarFields}${bannerFields}${typography}`;
}

function textStyleInspectorFields(style, prefix) {
  return `${selectField('الخط', `${prefix}.fontFamily`, style.fontFamily || 'Cairo', [['Cairo', 'Cairo'], ['Space Grotesk', 'Space Grotesk'], ['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'], ['Verdana', 'Verdana']], 'data-field')}${field('الحجم', `${prefix}.fontSize`, style.fontSize || 18, 'number', 'min="10" max="96"')}${selectField('الوزن', `${prefix}.fontWeight`, style.fontWeight || '400', [['400', 'عادي'], ['500', 'متوسط'], ['600', 'شبه عريض'], ['700', 'عريض'], ['800', 'ثقيل']], 'data-field')}${field('لون النص', `${prefix}.color`, style.color || '#fff7dc')}${selectField('المحاذاة', `${prefix}.textAlign`, style.textAlign || 'right', [['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']], 'data-field')}${field('تباعد الحروف', `${prefix}.letterSpacing`, style.letterSpacing || 0, 'number', 'min="-2" max="16" step="0.1"')}${field('ارتفاع السطر', `${prefix}.lineHeight`, style.lineHeight || 1.4, 'number', 'min="0.8" max="3" step="0.1"')}${selectField('التأثير', `${prefix}.effect`, style.effect || 'none', [['none', 'بدون'], ['gradient', 'تدرج'], ['glow', 'Glow'], ['shimmer', 'Shimmer'], ['typewriter', 'Typewriter'], ['wave', 'Wave']], 'data-field')}`;
}

function designTextStyleFields(style, prefix) {
  return `${selectField('الخط', `${prefix}.fontFamily`, style.fontFamily, [['Cairo', 'Cairo'], ['Space Grotesk', 'Space Grotesk'], ['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'], ['Verdana', 'Verdana']])}${field('الحجم', `${prefix}.fontSize`, style.fontSize, 'number', `data-design-field="${prefix}.fontSize" min="10" max="96"`)}${selectField('الوزن', `${prefix}.fontWeight`, style.fontWeight, [['400', 'عادي'], ['500', 'متوسط'], ['600', 'شبه عريض'], ['700', 'عريض'], ['800', 'ثقيل']])}${field('اللون', `${prefix}.color`, style.color, 'text', `data-design-field="${prefix}.color"`)}${selectField('المحاذاة', `${prefix}.textAlign`, style.textAlign, [['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']])}${field('تباعد الحروف', `${prefix}.letterSpacing`, style.letterSpacing, 'number', `data-design-field="${prefix}.letterSpacing" min="-2" max="16" step="0.1"`)}${field('ارتفاع السطر', `${prefix}.lineHeight`, style.lineHeight, 'number', `data-design-field="${prefix}.lineHeight" min="0.8" max="3" step="0.1"`)}${selectField('التأثير', `${prefix}.effect`, style.effect, [['none', 'بدون'], ['gradient', 'تدرج'], ['glow', 'Glow'], ['shimmer', 'Shimmer'], ['typewriter', 'Typewriter'], ['wave', 'Wave']])}`;
}

function typographyInspectorFields(element) {
  return textStyleInspectorFields(element.style, 'style');
}

function widgetInspectorFields(element) {
  const data = element.widgetData;
  const appearance = `<fieldset class="inspector-group"><legend>مظهر الـ Widget</legend>${field('حجم النص (px)', 'style.fontSize', element.style.fontSize || 11, 'number', 'min="10" max="96" step="0.5"')}${field('لون النص', 'style.color', element.style.color || '#fff4d4')}${field('لون الخلفية', 'style.backgroundColor', element.style.backgroundColor || '#1c1231')}${field('استدارة الحواف', 'style.borderRadius', element.style.borderRadius ?? 12, 'number', 'min="0" max="100"')}<label class="switch-field">توهج<input data-field="style.glow" type="checkbox" ${element.style.glow ? 'checked' : ''} /></label>${selectField('الظل', 'style.shadow', element.style.shadow || 'none', [['none', 'بدون'], ['soft', 'خفيف'], ['strong', 'قوي']], 'data-field')}</fieldset>`;
  let controls = '';
  if (data.kind === 'quote') controls = `${field('النص', 'widgetData.text', data.text)}${field('الكاتب', 'widgetData.author', data.author)}`;
  else if (data.kind === 'mood') controls = `${field('المزاج', 'widgetData.text', data.text)}${field('الأيقونة', 'widgetData.icon', data.icon)}`;
  if (data.kind === 'characters' || data.kind === 'games') {
    const items = data.items.map((item, index) => `<fieldset class="widget-item-fields"><legend>${data.kind === 'characters' ? 'شخصية' : 'لعبة'} ${index + 1}</legend>${field('الاسم', `widgetData.items.${index}.name`, item.name)}${field('رابط الصورة', `widgetData.items.${index}.image.url`, item.image.url, 'url')}<label class="upload-field">رفع صورة<input data-upload="widget-image" data-widget-index="${index}" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label><button type="button" data-widget-action="remove-item" data-widget-index="${index}" ${data.items.length === 1 ? 'disabled' : ''}>حذف</button></fieldset>`).join('');
    controls = `${items}<button type="button" data-widget-action="item" ${data.items.length >= 6 ? 'disabled' : ''}>+ إضافة</button>`;
  }
  else if (data.kind === 'gallery') {
    const items = data.items.map((item, index) => `<fieldset class="widget-item-fields"><legend>صورة ${index + 1}</legend>${field('رابط الصورة', `widgetData.items.${index}.image.url`, item.image.url, 'url')}${field('التعليق', `widgetData.items.${index}.caption`, item.caption || '')}<label class="upload-field">رفع صورة<input data-upload="widget-image" data-widget-index="${index}" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label><button type="button" data-widget-action="remove-item" data-widget-index="${index}" ${data.items.length === 1 ? 'disabled' : ''}>حذف</button></fieldset>`).join('');
    controls = `${selectField('التخطيط', 'widgetData.layout', data.layout, [['grid', 'Grid'], ['polaroid', 'Polaroid'], ['masonry', 'Masonry']], 'data-field')}${items}<button type="button" data-widget-action="item" ${data.items.length >= 12 ? 'disabled' : ''}>+ إضافة صورة</button>`;
  }
  else if (data.kind === 'counter') controls = field('العنوان', 'widgetData.label', data.label);
  else if (data.kind === 'clock') controls = `${selectField('النظام', 'widgetData.format', data.format, [['12h', '12 ساعة'], ['24h', '24 ساعة']], 'data-field')}<label class="switch-field">الثواني<input data-field="widgetData.showSeconds" type="checkbox" ${data.showSeconds ? 'checked' : ''} /></label>`;
  else if (data.kind === 'countdown') controls = `${field('العنوان', 'widgetData.title', data.title)}${field('الموعد', 'widgetData.targetDate', data.targetDate.slice(0, 16), 'datetime-local')}${field('بعد الانتهاء', 'widgetData.finishedText', data.finishedText)}`;
  else if (data.kind === 'poll') {
    const options = data.options.map((option, index) => `<fieldset class="widget-item-fields"><legend>خيار ${index + 1}</legend>${field('النص', `widgetData.options.${index}.label`, option.label)}<button type="button" data-widget-action="remove-option" data-widget-index="${index}" ${data.options.length <= 2 ? 'disabled' : ''}>حذف</button></fieldset>`).join('');
    controls = `${field('السؤال', 'widgetData.question', data.question)}${options}<button type="button" data-widget-action="option" ${data.options.length >= 4 ? 'disabled' : ''}>+ خيار</button>`;
  }
  else if (!controls) controls = field('النص', 'widgetData.text', data.text);
  return `${controls}${appearance}`;
}

function socialLinksInspectorFields() {
  const iconOptions = socialIcons?.options || [['website', 'Website'], ['link', 'Link']];
  const links = state.configuration.socialLinks;
  const fields = links.map((link, index) => {
    const remove = `<button type="button" data-social-action="remove" data-social-index="${index}" ${links.length === 1 ? 'disabled' : ''}>Remove link</button>`;
    return `<fieldset class="social-link-fields"><legend>Link ${index + 1}</legend>${field('Label', `socialLinks.${index}.label`, link.label)}${field('URL', `socialLinks.${index}.url`, link.url, 'url')}${selectField('Icon', `socialLinks.${index}.icon`, link.icon || 'website', iconOptions, 'data-field')}${selectField('Display', `socialLinks.${index}.display`, link.display || 'both', [['both', 'Text and icon'], ['text', 'Text only'], ['icon', 'Icon only']], 'data-field')}<label class="switch-field">Visible<input data-field="socialLinks.${index}.visible" type="checkbox" ${link.visible !== false ? 'checked' : ''} /></label>${remove}</fieldset>`;
  }).join('');
  return `${fields}<button type="button" data-social-action="add" ${links.length >= 12 ? 'disabled' : ''}>+ Add link</button>`;
}

function renderMobileInspector() {
  const element = selected();
  const modeTabs = '<div class="inspector-mode-tabs"><button type="button" data-inspector-mode="content">المحتوى</button><button type="button" data-inspector-mode="mobile" class="is-active">تخطيط الجوال</button></div>';
  if (!element) {
    inspector.innerHTML = `${modeTabs}<p>اختر عنصرًا لتعديل تخطيطه على الجوال.</p>`;
    return;
  }
  const overrides = element.mobileOverrides || {};
  const enabled = element.mobileOverrides !== undefined;
  const toggle = `<label class="switch-field mobile-override-toggle">Mobile override<input data-mobile-override-toggle type="checkbox" ${enabled ? 'checked' : ''} /></label>`;
  if (!enabled) {
    inspector.innerHTML = `${modeTabs}${toggle}<p class="inspector-hint">فعّل التخصيص لتغيير هذا العنصر على الجوال فقط، دون تعديل تصميم سطح المكتب.</p>`;
    return;
  }
  const layout = responsive.resolveElementLayout(element, true);
  const position = layout.position;
  const fontSize = ['text', 'sticker'].includes(element.type)
    ? field('حجم المحتوى على الجوال', 'mobileOverrides.fontSize', overrides.fontSize ?? elementFontSize(element, false), 'number', 'min="10" max="96" step="0.5"')
    : '';
  const duplicateDisabled = element.type === 'profile-card' || element.type === 'music' || state.configuration.elements.length >= ELEMENT_LIMIT;
  const deleteDisabled = element.type === 'profile-card';
  inspector.innerHTML = `${modeTabs}${toggle}<label class="switch-field">إخفاء على الجوال<input data-field="mobileOverrides.hideOnMobile" type="checkbox" ${overrides.hideOnMobile ? 'checked' : ''} /></label>${field('الموضع الأفقي', 'mobileOverrides.mobilePosition.x', position.x, 'number', 'min="0" max="100" step="0.1"')}${field('الموضع العمودي', 'mobileOverrides.mobilePosition.y', position.y, 'number', 'min="0" max="100" step="0.1"')}${field('العرض', 'mobileOverrides.mobileWidth', layout.size.width, 'number', 'min="1" max="100" step="0.1"')}${field('الارتفاع', 'mobileOverrides.mobileHeight', layout.size.height, 'number', 'min="1" max="100" step="0.1"')}${field('المقياس', 'mobileOverrides.mobileScale', overrides.mobileScale ?? 1, 'number', 'min="0.5" max="2" step="0.05"')}${fontSize}${selectField('المحاذاة', 'mobileOverrides.mobileAlignment', overrides.mobileAlignment || 'right', [['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']], 'data-field')}<div class="inspect-actions"><button type="button" data-inspector-action="duplicate" ${duplicateDisabled ? 'disabled' : ''}>نسخ</button><button type="button" data-inspector-action="delete" ${deleteDisabled ? 'disabled' : ''}>حذف</button></div>`;
}

function renderInspector() {
  if (mobilePreviewActive() && inspectorMode === 'mobile') {
    renderMobileInspector();
    return;
  }
  const modeTabs = mobilePreviewActive() ? '<div class="inspector-mode-tabs"><button type="button" data-inspector-mode="content" class="is-active">المحتوى</button><button type="button" data-inspector-mode="mobile">تخطيط الجوال</button></div>' : '';
  const element = selected();
  if (!element) {
    inspector.innerHTML = `${modeTabs}<p>اختر عنصرًا لتعديل خصائصه.</p>`;
    return;
  }

  const visibility = `<label class="switch-field">ظاهر<input data-field="visible" type="checkbox" ${element.visible ? 'checked' : ''} /></label>`;
  const previewRect = preview.getBoundingClientRect();
  const layout = responsive.resolveElementLayout(element, mobilePreviewActive());
  const pixelWidth = Math.round(previewRect.width * layout.size.width * layout.scale / 100);
  const pixelHeight = Math.round(previewRect.height * layout.size.height * layout.scale / 100);
  const positionPrefix = mobilePreviewActive() && element.mobileOverrides ? 'mobileOverrides.mobilePosition' : 'position';
  const sizeWidthKey = mobilePreviewActive() && element.mobileOverrides ? 'mobileOverrides.mobileWidth' : 'size.width';
  const sizeHeightKey = mobilePreviewActive() && element.mobileOverrides ? 'mobileOverrides.mobileHeight' : 'size.height';
  const geometry = `<fieldset class="inspector-group geometry-fields"><legend>الموضع والحجم</legend><div class="geometry-readout">الحجم المرئي: ${pixelWidth} × ${pixelHeight} px</div><div class="geometry-pixel-grid">${pixelField('العرض (px)', 'width', pixelWidth)}${pixelField('الارتفاع (px)', 'height', pixelHeight)}</div>${field('الموضع الأفقي (%)', `${positionPrefix}.x`, layout.position.x, 'number', 'min="0" max="100" step="0.1"')}${field('الموضع العمودي (%)', `${positionPrefix}.y`, layout.position.y, 'number', 'min="0" max="100" step="0.1"')}${field('العرض (%)', sizeWidthKey, layout.size.width, 'number', 'min="1" max="100" step="0.1"')}${field('الارتفاع (%)', sizeHeightKey, layout.size.height, 'number', 'min="1" max="100" step="0.1"')}</fieldset>`;
  let content = '';

  if (element.type === 'profile-card') {
    const profile = state.configuration.profileCard;
    content = `${field('لون البطاقة', 'profileCard.backgroundColor', profile.backgroundColor, 'text')}${field('استدارة الحواف', 'profileCard.borderRadius', profile.borderRadius, 'number', 'min="0" max="64"')}${field('المساحة الداخلية', 'profileCard.padding', profile.padding, 'number', 'min="12" max="80"')}`;
  } else if (element.type === 'text' || element.type === 'sticker') {
    content = `<label>المحتوى<textarea data-field="content" minlength="1" maxlength="500" rows="3" required>${escapeHtml(element.content || '')}</textarea></label>${field('لون النص', 'style.color', element.style.color || '#fff7dc', 'text')}${element.type === 'sticker' ? field('حجم الملصق (px)', 'style.fontSize', element.style.fontSize || 42, 'number', 'min="10" max="96" step="0.5"') : ''}`;
  } else if (element.type === 'music') {
    const music = state.configuration.musicPlayer;
    const removeAudio = music.audioUrl ? '<button type="button" data-music-action="remove-audio">إزالة الملف الصوتي</button>' : '';
    const removeCover = music.cover ? '<button type="button" data-music-action="remove-cover">إزالة الغلاف</button>' : '';
    content = `<label class="switch-field">تفعيل المشغل<input data-field="musicPlayer.enabled" type="checkbox" ${music.enabled ? 'checked' : ''} /></label><label class="upload-field">رفع الملف الصوتي<input data-upload="music-audio" type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/x-wav,audio/mp4" /></label>${removeAudio}<label class="upload-field">رفع غلاف الأغنية<input data-upload="music-cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>${removeCover}${field('اسم الأغنية', 'musicPlayer.title', music.title, 'text', 'maxlength="120"')}${field('الفنان', 'musicPlayer.artist', music.artist, 'text', 'maxlength="120"')}${field('حجم محتوى المشغل (px)', 'style.fontSize', element.style.fontSize || 14, 'number', 'min="10" max="96" step="0.5"')}<label class="switch-field">تكرار<input data-field="musicPlayer.loop" type="checkbox" ${music.loop ? 'checked' : ''} /></label>${selectField('شكل المشغل', 'musicPlayer.preset', music.preset, [['minimal', 'Minimal'], ['glass', 'Glass'], ['cd', 'CD'], ['vinyl', 'Vinyl'], ['cassette', 'Cassette'], ['pixel', 'Pixel']], 'data-field')}`;
  } else if (element.type === 'image') {
    content = `${field('رابط الصورة HTTPS', 'assetUrl', element.assetUrl || '', 'url')}${field('استدارة الحواف', 'style.borderRadius', element.style.borderRadius || 12, 'number', 'min="0" max="100"')}${selectField('ملاءمة الصورة', 'style.objectFit', element.style.objectFit || 'cover', [['cover', 'تغطية'], ['contain', 'احتواء']], 'data-field')}${selectField('موضع الصورة', 'style.objectPosition', element.style.objectPosition || 'center', [['center', 'الوسط'], ['top', 'أعلى'], ['bottom', 'أسفل'], ['left', 'يسار'], ['right', 'يمين']], 'data-field')}`;
  } else if (element.type === 'social-links') {
    content = `${socialLinksInspectorFields()}<fieldset class="inspector-group"><legend>تنسيق الروابط</legend>${textStyleInspectorFields(state.configuration.typography.link, 'typography.link')}</fieldset>`;
  } else if (element.type === 'widget') {
    content = widgetInspectorFields(element);
  }

  const tab = state.configuration.tabs.length
    ? selectField('التبويب', 'tabId', element.tabId || state.configuration.tabs[0].id, state.configuration.tabs.map((item) => [item.id, item.label]), 'data-field')
    : '';

  if (element.type === 'profile-card') content = profileInspectorFields();
  if (element.type === 'text') content += typographyInspectorFields(element);
  if (element.type === 'image') content += `${field('الدوران', 'style.rotation', element.style.rotation || 0, 'number', 'min="-180" max="180"')}${field('الشفافية', 'style.opacity', element.style.opacity ?? 1, 'number', 'min="0" max="1" step="0.05"')}<label class="switch-field">قلب أفقي<input data-field="style.flipX" type="checkbox" ${element.style.flipX ? 'checked' : ''} /></label><label class="switch-field">توهج<input data-field="style.glow" type="checkbox" ${element.style.glow ? 'checked' : ''} /></label>${selectField('الظل', 'style.shadow', element.style.shadow || 'none', [['none', 'بدون'], ['soft', 'خفيف'], ['strong', 'قوي']], 'data-field')}${selectField('الحركة', 'style.animation', element.style.animation || 'none', [['none', 'بدون'], ['float', 'طفو'], ['pulse', 'نبض'], ['gentleRotate', 'دوران لطيف'], ['fade', 'تلاشي']], 'data-field')}`;
  if (element.type === 'image') content += '<label class="upload-field">رفع صورة<input data-upload="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>';
  const layerName = element.type === 'profile-card' ? '' : field('اسم الطبقة', 'name', element.name || '');
  const duplicateDisabled = element.type === 'profile-card' || element.type === 'music' || state.configuration.elements.length >= ELEMENT_LIMIT;
  const deleteDisabled = element.type === 'profile-card';
  inspector.innerHTML = `${modeTabs}${visibility}${layerName}${geometry}${tab}${content}<div class="inspect-actions"><button type="button" data-inspector-action="duplicate" ${duplicateDisabled ? 'disabled' : ''}>نسخ</button><button type="button" data-inspector-action="delete" ${deleteDisabled ? 'disabled' : ''}>حذف</button></div>`;
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
  const musicControls = `<details><summary>الموسيقى</summary><div><label class="switch-field">تفعيل المشغل<input data-design-field="musicPlayer.enabled" type="checkbox" ${music.enabled ? 'checked' : ''} /></label><label class="upload-field">رفع ملف صوتي (MP3, OGG, WAV, M4A — حتى 15MB)<input data-upload="music-audio" type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/x-wav,audio/mp4" /></label>${music.audioUrl ? '<button type="button" data-music-action="remove-audio">إزالة الملف الصوتي</button>' : ''}<label class="upload-field">رفع الغلاف<input data-upload="music-cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>${music.cover ? '<button type="button" data-music-action="remove-cover">إزالة الغلاف</button>' : ''}${field('العنوان', 'musicPlayer.title', music.title, 'text', 'data-design-field="musicPlayer.title" maxlength="120"')}${field('الفنان', 'musicPlayer.artist', music.artist, 'text', 'data-design-field="musicPlayer.artist" maxlength="120"')}<label class="switch-field">تكرار<input data-design-field="musicPlayer.loop" type="checkbox" ${music.loop ? 'checked' : ''} /></label>${selectField('النمط', 'musicPlayer.preset', music.preset, [['minimal', 'Minimal'], ['glass', 'Glass'], ['cd', 'CD'], ['vinyl', 'Vinyl'], ['cassette', 'Cassette'], ['pixel', 'Pixel']])}</div></details>`;
  const entranceControls = `<details><summary>شاشة الدخول</summary><div><label class="switch-field">تفعيل شاشة الدخول<input data-design-field="entranceScreen.enabled" type="checkbox" ${entrance.enabled ? 'checked' : ''} /></label>${entrance.enabled ? '<button type="button" data-experience-action="preview-entrance">معاينة شاشة الدخول</button>' : ''}<label class="upload-field">صورة شاشة الدخول<input data-upload="entrance-background" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>${entrance.background ? '<button type="button" data-experience-action="remove-entrance-background">إزالة الصورة</button>' : ''}${field('لون الخلفية', 'entranceScreen.backgroundColor', entrance.backgroundColor, 'text', 'data-design-field="entranceScreen.backgroundColor"')}${field('النص', 'entranceScreen.text', entrance.text, 'text', 'data-design-field="entranceScreen.text" maxlength="120"')}${designTextStyleFields(entrance.textStyle, 'entranceScreen.textStyle')}${selectField('الانتقال', 'entranceScreen.transition', entrance.transition, [['fade', 'Fade'], ['blurFade', 'Blur fade'], ['zoomFade', 'Zoom fade'], ['pixelLike', 'Pixel like']])}</div></details>`;
  const cursorControls = `<details><summary>المؤشر</summary><div>${selectField('نوع المؤشر', 'cursor.type', cursor.type, [['default', 'الافتراضي'], ['image', 'صورة مخصصة']])}<label class="upload-field">صورة مؤشر مخصصة<input data-upload="cursor-image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>${cursor.image ? '<button type="button" data-experience-action="remove-cursor-image">إزالة صورة المؤشر</button>' : ''}${selectField('أثر المؤشر', 'cursor.trail', cursor.trail, [['none', 'بدون'], ['stars', 'نجوم'], ['hearts', 'قلوب'], ['sparkles', 'بريق'], ['bubbles', 'فقاعات']])}${field('لون الأثر', 'cursor.color', cursor.color, 'text', 'data-design-field="cursor.color"')}</div></details>`;
  designControls.insertAdjacentHTML('beforeend', `${musicControls}${entranceControls}${cursorControls}`);
}

function renderTabsControls() {
  const tabs = state.configuration.tabs;
  designControls.insertAdjacentHTML('beforeend', `<details><summary>التبويبات</summary><div class="tabs-editor-list">${tabs.map((tab, index) => `<fieldset class="inspector-group"><legend>تبويب ${index + 1}</legend>${field('الاسم', `tabs.${index}.label`, tab.label, 'text', `data-design-field="tabs.${index}.label" minlength="1" maxlength="40" required`)}${selectField('الانتقال', `tabs.${index}.transition`, tab.transition, [['fade', 'Fade'], ['slide', 'Slide'], ['blur', 'Blur']])}<label class="switch-field">ظاهر<input data-design-field="tabs.${index}.visible" type="checkbox" ${tab.visible !== false ? 'checked' : ''} /></label><button type="button" data-tab-remove="${tab.id}">حذف ${tab.label}</button></fieldset>`).join('')}<button type="button" data-tab-add ${tabs.length >= 5 ? 'disabled' : ''}>+ إضافة تبويب</button></div></details>`);
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
  const openSections = new Set([...designControls.querySelectorAll('details[open] summary')].map((summary) => summary.textContent));
  const sidebarScroll = editorSidebar.scrollTop;
  renderPreview();
  renderLayers();
  renderDesignControls();
  renderStickerLibrary();
  renderWidgetLibrary();
  renderExperienceControls();
  renderTabsControls();
  renderCommunityControls();
  renderThemeControls();
  designControls.querySelectorAll('details').forEach((details) => {
    if (openSections.has(details.querySelector('summary')?.textContent)) details.open = true;
  });
  renderInspector();
  undoButton.disabled = state.historyIndex === 0;
  redoButton.disabled = state.historyIndex >= state.history.length - 1;
  deleteButton.disabled = selected()?.type === 'profile-card' || !selected();
  editorSidebar.scrollTop = sidebarScroll;
  publishButton.textContent = currentPage.published ? 'إلغاء النشر' : 'نشر الصفحة';
  publishButton.classList.toggle('is-published', currentPage.published);
  publishStatus.textContent = currentPage.published ? ' · منشورة' : ' · مسودة';
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  saveStatus.textContent = 'بانتظار الحفظ';
  saveStatus.className = 'save-status is-saving';
  saveStatus.removeAttribute('title');
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    saveConfiguration();
  }, 850);
}

async function saveConfiguration() {
  if (!state) return;
  if (saving) {
    saveAgain = true;
    return;
  }
  saving = true;
  saveButton.disabled = true;
  const snapshot = clone(state.configuration);
  saveStatus.textContent = 'جارٍ الحفظ';
  saveStatus.className = 'save-status is-saving';
  try {
    const data = await request('/api/pages/me', { method: 'PATCH', body: JSON.stringify({ configuration: snapshot }) });
    currentPage = { ...currentPage, ...data.page };
    saveStatus.textContent = 'محفوظ';
    saveStatus.className = 'save-status';
    saveStatus.removeAttribute('title');
    return true;
  } catch (error) {
    saveStatus.textContent = 'فشل الحفظ';
    saveStatus.className = 'save-status is-error';
    saveStatus.title = error.message;
    return false;
  } finally {
    saving = false;
    saveButton.disabled = false;
    saveWaiters.splice(0).forEach((resolve) => resolve());
    if (saveAgain || JSON.stringify(snapshot) !== JSON.stringify(state.configuration)) {
      saveAgain = false;
      scheduleAutosave();
    }
  }
}

function saveNow() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  return saveConfiguration();
}

function commitChange() {
  EditorState.pushHistory(state);
  renderAll();
  scheduleAutosave();
}

function openSettingsPanel() {
  if (!window.matchMedia('(max-width: 800px)').matches) return;
  editorApp.dataset.panel = 'settings';
  document.querySelectorAll('[data-panel-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.panelTab === 'settings');
  });
}

function selectElement(id) {
  state.selectedId = id;
  const element = selected();
  if (element?.tabId) activeTabId = element.tabId;
  openSettingsPanel();
  renderAll();
}

function addElement(type) {
  if (state.configuration.elements.length >= ELEMENT_LIMIT) {
    saveStatus.textContent = `الحد ${ELEMENT_LIMIT} عنصرًا`;
    saveStatus.className = 'save-status is-error';
    return;
  }
  if (type === 'music') {
    const existing = state.configuration.elements.find((element) => element.type === type);
    if (existing) {
      selectElement(existing.id);
      saveStatus.textContent = 'المشغل موجود';
      return;
    }
  }
  const tabId = activeTabId || state.configuration.tabs[0]?.id;
  if (type === 'social-links') {
    if (!state.configuration.socialLinks.length) state.configuration.socialLinks.push({ id: EditorState.createId('link'), label: 'رابط جديد', url: 'https://example.com', icon: 'website', display: 'both', visible: true });
    EditorState.addElement(state, { type, size: { width: 48, height: 10 }, tabId });
  } else if (type === 'text') {
    EditorState.addElement(state, { type, content: 'اكتب هنا...', size: { width: 38, height: 12 }, style: { color: '#fff7dc', fontSize: 20 }, tabId });
  } else if (type === 'image') {
    EditorState.addElement(state, { type, assetUrl: 'https://celes.lol/assets/logo.png', size: { width: 24, height: 24 }, tabId });
  } else if (type === 'sticker') {
    EditorState.addElement(state, { type, content: '✨', size: { width: 14, height: 16 }, tabId });
  } else if (type === 'music') {
    state.configuration.musicPlayer.enabled = true;
    EditorState.addElement(state, { type, content: 'مشغل موسيقى', size: { width: 35, height: 11 }, tabId });
  }
  openSettingsPanel();
  renderAll();
  scheduleAutosave();
  if (type === 'image') requestAnimationFrame(() => inspector.querySelector('[data-upload="image"]')?.click());
}

function addSticker(name) {
  if (state.configuration.elements.length >= ELEMENT_LIMIT) return;
  EditorState.addElement(state, {
    type: 'image',
    name: `Sticker: ${name}`,
    assetUrl: `/assets/stickers/${name}.svg`,
    size: { width: 14, height: 14 },
    style: { borderRadius: 0, shadow: 'none', glow: false, animation: 'none' },
    tabId: activeTabId || state.configuration.tabs[0]?.id
  });
  openSettingsPanel();
  renderAll();
  scheduleAutosave();
}

function addWidget(kind) {
  if (state.configuration.elements.length >= ELEMENT_LIMIT || state.configuration.elements.filter((item) => item.type === 'widget').length >= 6) return;
  EditorState.addElement(state, { type: 'widget', widget: kind, widgetData: widgetDefault(kind), name: `Widget: ${kind}`, size: { width: 38, height: kind === 'gallery' ? 30 : 16 }, tabId: activeTabId || state.configuration.tabs[0]?.id });
  openSettingsPanel();
  renderAll();
  scheduleAutosave();
}

function addTab() {
  if (state.configuration.tabs.length >= 5) return;
  const tab = { id: EditorState.createId('tab'), label: `Tab ${state.configuration.tabs.length + 1}`, transition: 'fade', visible: true };
  state.configuration.tabs.push(tab);
  state.configuration.elements.forEach((element) => { if (!element.tabId) element.tabId = tab.id; });
  activeTabId = tab.id;
  commitChange();
}

function removeTab(id) {
  state.configuration.tabs = state.configuration.tabs.filter((tab) => tab.id !== id);
  const fallback = state.configuration.tabs[0]?.id;
  if (activeTabId === id) activeTabId = fallback || null;
  state.configuration.elements.forEach((element) => {
    if (element.tabId !== id) return;
    if (fallback) element.tabId = fallback;
    else delete element.tabId;
  });
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
  if (input.type === 'number') return input.value === '' ? null : Number(input.value);
  return input.value;
}

function refreshPreviewElement(element) {
  const node = preview.querySelector(`[data-id="${CSS.escape(element.id)}"]`);
  if (!node) return;
  const layout = responsive.resolveElementLayout(element, mobilePreviewActive());
  const oldContent = node.querySelector(':scope > .editor-element-content');
  const nextContent = contentShell(element, contentNode(element, layout));
  if (oldContent) oldContent.replaceWith(nextContent);
  else node.prepend(nextContent);
  applyGeometry(node, element, layout);
  applyContentScale(node, element, layout);
}

function refreshAffectedElements(key, element) {
  let affected = [element];
  if (key.startsWith('profileCard.') || key.startsWith('avatar.') || key.startsWith('banner.') || key.startsWith('typography.displayName') || key.startsWith('typography.bio')) {
    affected = state.configuration.elements.filter((item) => item.type === 'profile-card');
  } else if (key.startsWith('socialLinks.') || key.startsWith('typography.link')) {
    affected = state.configuration.elements.filter((item) => item.type === 'social-links');
  } else if (key.startsWith('musicPlayer.')) {
    affected = state.configuration.elements.filter((item) => item.type === 'music');
  }
  affected.forEach(refreshPreviewElement);
}

function applyInspectorChange(input, record = true) {
  const element = selected();
  if (!element || !input.dataset.field) return;
  const key = input.dataset.field;
  let value = inputValue(input);
  if (value === null || (typeof value === 'number' && !Number.isFinite(value)) || !input.checkValidity()) return;
  const mobile = key.startsWith('mobileOverrides.');
  const initialLayout = responsive.resolveElementLayout(element, mobile);
  const initialFontSize = elementFontSize(element, mobile);
  if (key === 'widgetData.targetDate' && input.value) value = new Date(input.value).toISOString();
  if (key.startsWith('profileCard.') || key.startsWith('musicPlayer.') || key.startsWith('typography.')) setNested(state.configuration, key, value);
  else if (key.startsWith('avatar.') || key.startsWith('banner.')) {
    if (key.includes('.asset.') && !state.configuration[key.split('.')[0]].asset) return;
    setNested(state.configuration, key, value);
  }
  else if (key.startsWith('socialLinks.')) setNested(state.configuration, key, value);
  else {
    if (key.startsWith('mobileOverrides.mobilePosition.')) {
      element.mobileOverrides ||= {};
      element.mobileOverrides.mobilePosition ||= clone(element.position);
    }
    if (key === 'name' && !String(value).trim()) delete element.name;
    else setNested(element, key, value);
    if (key === 'tabId') activeTabId = value;
    const changesSize = key === 'size.width' || key === 'size.height' || key === 'mobileOverrides.mobileWidth' || key === 'mobileOverrides.mobileHeight';
    if (changesSize && (element.type === 'text' || element.type === 'sticker')) {
      const nextLayout = responsive.resolveElementLayout(element, mobile);
      const fontSize = EditorState.resizedFontSize(initialFontSize, initialLayout.size, nextLayout.size);
      if (mobile) element.mobileOverrides.fontSize = fontSize;
      else element.style.fontSize = fontSize;
    }
  }
  if (record) commitChange();
  else refreshAffectedElements(key, element);
}

function applyPixelGeometryChange(input) {
  const element = selected();
  const rect = preview.getBoundingClientRect();
  const pixels = Number(input.value);
  if (!element || !input.dataset.pixelField || !Number.isFinite(pixels) || !input.checkValidity() || !rect.width || !rect.height) return;
  const mobile = mobilePreviewActive() && element.mobileOverrides !== undefined;
  const initialLayout = responsive.resolveElementLayout(element, mobile);
  const initialFontSize = elementFontSize(element, mobile);
  const scale = initialLayout.scale || 1;
  const percentage = input.dataset.pixelField === 'width'
    ? pixels / rect.width * 100 / scale
    : pixels / rect.height * 100 / scale;
  const nextSize = { ...initialLayout.size, [input.dataset.pixelField]: Math.max(1, Math.min(100, percentage)) };
  if (mobile) {
    element.mobileOverrides ||= {};
    if (input.dataset.pixelField === 'width') element.mobileOverrides.mobileWidth = nextSize.width;
    else element.mobileOverrides.mobileHeight = nextSize.height;
  } else {
    element.size = nextSize;
  }
  if (element.type === 'text' || element.type === 'sticker') {
    const fontSize = EditorState.resizedFontSize(initialFontSize, initialLayout.size, nextSize);
    if (mobile) element.mobileOverrides.fontSize = fontSize;
    else element.style.fontSize = fontSize;
  }
  commitChange();
}

async function updatePageValue(input) {
  const key = input.dataset.pageValue;
  if (!key || !input.checkValidity()) return;
  const value = input.value.trim();
  if (key === 'displayName' && !value) return;
  saveStatus.textContent = 'جارٍ الحفظ';
  saveStatus.className = 'save-status is-saving';
  try {
    if (saving) await new Promise((resolve) => saveWaiters.push(resolve));
    const configurationSaved = await saveNow();
    if (configurationSaved === false) throw new Error('احفظ تعديلات التصميم قبل تحديث بيانات الصفحة.');
    const data = await request('/api/pages/me', { method: 'PATCH', body: JSON.stringify({ [key]: value }) });
    currentPage = { ...currentPage, ...data.page };
    saveStatus.textContent = 'محفوظ';
    saveStatus.className = 'save-status';
  } catch (error) {
    saveStatus.textContent = 'فشل الحفظ';
    saveStatus.className = 'save-status is-error';
    saveStatus.title = error.message;
  }
}

async function togglePublish() {
  publishButton.disabled = true;
  try {
    const saved = await saveNow();
    if (saved === false) throw new Error('تعذر نشر تغييرات لم تُحفظ.');
    const action = currentPage.published ? 'unpublish' : 'publish';
    const data = await request(`/api/pages/me/${action}`, { method: 'POST', body: '{}' });
    currentPage = { ...currentPage, ...data.page };
    renderAll();
    saveStatus.textContent = currentPage.published ? 'تم النشر' : 'عادت مسودة';
    saveStatus.className = 'save-status';
  } catch (error) {
    saveStatus.textContent = error.message;
    saveStatus.className = 'save-status is-error';
  } finally {
    publishButton.disabled = false;
  }
}

function applyDesignChange(input) {
  const key = input.dataset.designField;
  if (!key || !input.checkValidity()) return;
  if (key.startsWith('background.asset.') && !state.configuration.background.asset) return;
  const value = inputValue(input);
  if (value === null || (typeof value === 'number' && !Number.isFinite(value))) return;
  setNested(state.configuration, key, value);
  if (key === 'entranceScreen.enabled') entrancePreviewVisible = Boolean(value);
  if (key === 'background.asset.position') {
    const positions = { center: { x: 50, y: 50 }, top: { x: 50, y: 0 }, bottom: { x: 50, y: 100 }, left: { x: 0, y: 50 }, right: { x: 100, y: 50 } };
    state.configuration.background.asset.crop = positions[value];
  }
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

function uploadForm(form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/pages/assets');
    xhr.timeout = 120000;
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    xhr.addEventListener('load', () => {
      const data = (() => { try { return JSON.parse(xhr.responseText || '{}'); } catch { return {}; } })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'تعذر رفع الملف.'));
    });
    xhr.addEventListener('error', () => reject(new Error('انقطع الاتصال أثناء رفع الملف.')));
    xhr.addEventListener('timeout', () => reject(new Error('استغرق رفع الملف وقتًا طويلًا. حاول مرة أخرى.')));
    xhr.send(form);
  });
}

async function uploadAsset(input) {
  const file = input.files?.[0];
  const purpose = input.dataset.upload;
  if (!file || !purpose) return;
  const mediaKind = file.type === 'image/gif' ? 'gif' : (file.type.startsWith('image/') ? 'image' : (file.type.startsWith('video/') ? 'video' : 'audio'));
  if (file.size > UPLOAD_LIMITS[mediaKind]) {
    saveStatus.textContent = 'الملف أكبر من الحد';
    saveStatus.className = 'save-status is-error';
    input.value = '';
    return;
  }
  const targetId = state.selectedId;
  const widgetIndex = Number(input.dataset.widgetIndex);
  input.disabled = true;
  saveStatus.textContent = 'رفع 0%';
  saveStatus.className = 'save-status is-saving';
  const form = new FormData();
  form.append('asset', file);
  form.append('purpose', purpose === 'image' ? 'image' : purpose);
  try {
    const data = await uploadForm(form, (percentage) => {
      saveStatus.textContent = percentage === 100 ? 'جارٍ المعالجة' : `رفع ${percentage}%`;
    });
    if (purpose === 'background') {
      state.configuration.background.asset = data.asset;
      state.configuration.background.type = data.mediaType;
    } else if (purpose === 'avatar') {
      state.configuration.avatar.asset = data.asset;
    } else if (purpose === 'banner') {
      state.configuration.banner.asset = data.asset;
      state.configuration.banner.visible = true;
    } else if (purpose === 'image') {
      const element = state.configuration.elements.find((item) => item.id === targetId);
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
      const element = state.configuration.elements.find((item) => item.id === targetId);
      if (element?.type === 'widget' && Number.isInteger(widgetIndex) && element.widgetData.items?.[widgetIndex]) element.widgetData.items[widgetIndex].image = data.asset;
    }
    commitChange();
  } catch (error) {
    saveStatus.textContent = error.message;
    saveStatus.className = 'save-status is-error';
  } finally {
    input.disabled = false;
    input.value = '';
  }
}

function removeConfiguredAsset(action) {
  if (action === 'remove-audio') state.configuration.musicPlayer.audioUrl = null;
  else if (action === 'remove-cover') state.configuration.musicPlayer.cover = null;
  else if (action === 'remove-background') {
    delete state.configuration.background.asset;
    state.configuration.background.type = 'solid';
  }
  else if (action === 'remove-entrance-background') state.configuration.entranceScreen.background = null;
  else if (action === 'remove-cursor-image') {
    state.configuration.cursor.image = null;
    state.configuration.cursor.type = 'default';
  } else return false;
  commitChange();
  return true;
}

function deleteSelected() {
  const before = state.historyIndex;
  EditorState.deleteSelected(state);
  if (state.historyIndex === before) return;
  renderAll();
  scheduleAutosave();
}

function duplicateSelected() {
  if (state.configuration.elements.length >= ELEMENT_LIMIT || selected()?.type === 'music') {
    saveStatus.textContent = selected()?.type === 'music' ? 'يوجد مشغل واحد فقط' : `الحد ${ELEMENT_LIMIT} عنصرًا`;
    saveStatus.className = 'save-status is-error';
    return;
  }
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
  const mobile = mobilePreviewActive();
  const layout = responsive.resolveElementLayout(element, mobile);
  const resizeHandle = event.target.closest('[data-resize-handle]')?.dataset.resizeHandle;
  pointerAction = {
    id: element.id,
    mode: resizeHandle ? 'resize' : 'drag',
    handle: resizeHandle,
    startX: event.clientX,
    startY: event.clientY,
    width: rect.width,
    height: rect.height,
    layout: { position: clone(layout.position), size: clone(layout.size) },
    fontSize: elementFontSize(element, mobile),
    mobile,
    changed: false
  };
  preview.setPointerCapture(event.pointerId);
  preview.querySelector(`[data-id="${element.id}"]`)?.classList.add('is-dragging');
}

function onPointerMove(event) {
  if (!pointerAction) return;
  const element = state.configuration.elements.find((item) => item.id === pointerAction.id);
  if (!element) return;
  const deltaX = ((event.clientX - pointerAction.startX) / pointerAction.width) * 100;
  const deltaY = ((event.clientY - pointerAction.startY) / pointerAction.height) * 100;
  const mobile = pointerAction.mobile;
  let nextLayout;
  if (pointerAction.mode === 'drag') {
    const scale = responsive.resolveElementLayout(element, mobile).scale || 1;
    nextLayout = EditorState.moveLayout(pointerAction.layout, { x: deltaX, y: deltaY }, {}, scale);
    if (mobile) {
      element.mobileOverrides ||= {};
      element.mobileOverrides.mobilePosition = nextLayout.position;
    } else {
      element.position = nextLayout.position;
    }
  } else {
    const rect = preview.getBoundingClientRect();
    const scale = responsive.resolveElementLayout(element, mobile).scale || 1;
    nextLayout = EditorState.resizeLayoutByDelta(pointerAction.layout, { x: deltaX, y: deltaY }, pointerAction.handle, {
      width: Math.max(1, (24 / rect.width) * 100),
      height: Math.max(1, (24 / rect.height) * 100)
    }, scale);
    if (mobile) {
      element.mobileOverrides ||= {};
      element.mobileOverrides.mobilePosition = nextLayout.position;
      element.mobileOverrides.mobileWidth = nextLayout.size.width;
      element.mobileOverrides.mobileHeight = nextLayout.size.height;
    } else {
      element.position = nextLayout.position;
      element.size = nextLayout.size;
    }
    if (element.type === 'text' || element.type === 'sticker') {
      const fontSize = EditorState.resizedFontSize(pointerAction.fontSize, pointerAction.layout.size, nextLayout.size);
      if (mobile) element.mobileOverrides.fontSize = fontSize;
      else element.style.fontSize = fontSize;
    }
  }
  pointerAction.changed = true;
  const node = preview.querySelector(`[data-id="${pointerAction.id}"]`);
  if (node) {
    const layout = responsive.resolveElementLayout(element, mobile);
    applyGeometry(node, element, layout);
    applyContentScale(node, element, layout);
  }
}

function onPointerUp(event) {
  if (!pointerAction) return;
  const action = pointerAction;
  pointerAction = null;
  if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId);
  preview.querySelector(`[data-id="${action.id}"]`)?.classList.remove('is-dragging');
  if (!action.changed) return;
  EditorState.pushHistory(state);
  renderAll();
  scheduleAutosave();
}

let keyboardCommitTimer = null;

function finishKeyboardChange() {
  if (!keyboardCommitTimer) return;
  clearTimeout(keyboardCommitTimer);
  keyboardCommitTimer = null;
  EditorState.pushHistory(state);
  renderAll();
  scheduleAutosave();
}

function nudgeSelected(deltaX, deltaY) {
  const element = selected();
  if (!element) return;
  const mobile = mobilePreviewActive();
  const layout = responsive.resolveElementLayout(element, mobile);
  const next = EditorState.moveLayout(layout, { x: deltaX, y: deltaY }, {}, layout.scale);
  if (next.position.x === layout.position.x && next.position.y === layout.position.y) return;
  if (mobile) {
    element.mobileOverrides ||= {};
    element.mobileOverrides.mobilePosition = next.position;
  } else {
    element.position = next.position;
  }
  const node = preview.querySelector(`[data-id="${element.id}"]`);
  if (node) applyGeometry(node, element, responsive.resolveElementLayout(element, mobile));
  renderInspector();
  clearTimeout(keyboardCommitTimer);
  keyboardCommitTimer = setTimeout(finishKeyboardChange, 180);
}

function isEditingField(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function setPreviewMode(mode) {
  const mobile = mode === 'mobile';
  editorApp.dataset.preview = mode;
  preview.dataset.mode = mode;
  previewLabel.textContent = mobile ? 'معاينة الجوال' : 'معاينة سطح المكتب';
  desktopPreviewButton.classList.toggle('is-active', !mobile);
  mobilePreviewButton.classList.toggle('is-active', mobile);
  if (state) renderAll();
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
  if (event.target.dataset.pageValue) return updatePageValue(event.target);
  if (event.target.dataset.pixelField) return applyPixelGeometryChange(event.target);
  return applyInspectorChange(event.target);
});
inspector.addEventListener('input', (event) => {
  const input = event.target;
  if (input.dataset.pageValue) {
    currentPage[input.dataset.pageValue] = input.value;
    state.configuration.elements.filter((element) => element.type === 'profile-card').forEach(refreshPreviewElement);
    return;
  }
  if (!input.dataset.field || !['text', 'url', 'color'].includes(input.type) && input.tagName !== 'TEXTAREA') return;
  applyInspectorChange(input, false);
});
designControls.addEventListener('change', (event) => {
  if (event.target.dataset.upload) return uploadAsset(event.target);
  if (event.target.dataset.pageField) return updatePageSetting(event.target);
  return applyDesignChange(event.target);
});
designControls.addEventListener('click', (event) => {
  const mediaAction = event.target.closest('[data-music-action], [data-experience-action], [data-background-action]');
  if (mediaAction?.dataset.experienceAction === 'preview-entrance') {
    entrancePreviewVisible = true;
    renderPreview();
    return;
  }
  if (mediaAction && removeConfiguredAsset(mediaAction.dataset.musicAction || mediaAction.dataset.experienceAction || mediaAction.dataset.backgroundAction)) return;
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
  const mode = event.target.closest('[data-inspector-mode]');
  if (mode) {
    inspectorMode = mode.dataset.inspectorMode;
    renderInspector();
    return;
  }
  const musicAction = event.target.closest('[data-music-action]');
  if (musicAction && removeConfiguredAsset(musicAction.dataset.musicAction)) return;
  const socialAction = event.target.closest('[data-social-action]');
  if (socialAction) {
    if (socialAction.dataset.socialAction === 'add' && state.configuration.socialLinks.length < 12) {
      state.configuration.socialLinks.push({ id: EditorState.createId('link'), label: 'رابط جديد', url: 'https://example.com', icon: 'website', display: 'both', visible: true });
    } else if (socialAction.dataset.socialAction === 'remove') {
      state.configuration.socialLinks.splice(Number(socialAction.dataset.socialIndex), 1);
    }
    commitChange();
    return;
  }
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
  const widgetIndex = Number(event.target.closest('[data-widget-index]')?.dataset.widgetIndex);
  if (widgetAction === 'item' && (data.kind === 'characters' || data.kind === 'games') && data.items.length < 6) data.items.push({ id: EditorState.createId('item'), name: 'عنصر جديد', image: { url: 'https://celes.lol/assets/logo.png', position: 'center', fit: 'cover' } });
  if (widgetAction === 'item' && data.kind === 'gallery' && data.items.length < 12) data.items.push({ id: EditorState.createId('item'), image: { url: 'https://celes.lol/assets/logo.png', position: 'center', fit: 'cover' }, caption: '' });
  if (widgetAction === 'option' && data.kind === 'poll' && data.options.length < 4) data.options.push({ id: EditorState.createId('option'), label: 'خيار جديد' });
  if (widgetAction === 'remove-item' && Number.isInteger(widgetIndex) && Array.isArray(data.items) && data.items.length > 1) data.items.splice(widgetIndex, 1);
  if (widgetAction === 'remove-option' && Number.isInteger(widgetIndex) && data.kind === 'poll' && data.options.length > 2) data.options.splice(widgetIndex, 1);
  commitChange();
});
deleteButton.addEventListener('click', deleteSelected);
saveButton.addEventListener('click', saveNow);
publishButton.addEventListener('click', togglePublish);
undoButton.addEventListener('click', () => { if (EditorState.undo(state)) { renderAll(); scheduleAutosave(); } });
redoButton.addEventListener('click', () => { if (EditorState.redo(state)) { renderAll(); scheduleAutosave(); } });
preview.addEventListener('pointerdown', onPointerDown);
preview.addEventListener('pointermove', onPointerMove);
preview.addEventListener('pointerup', onPointerUp);
preview.addEventListener('pointercancel', onPointerUp);
preview.addEventListener('click', (event) => {
  if (event.target.closest('[data-dismiss-entrance-preview]')) {
    entrancePreviewVisible = false;
    renderPreview();
    return;
  }
  const tab = event.target.closest('[data-preview-tab]');
  if (!tab) return;
  activeTabId = tab.dataset.previewTab;
  const element = selected();
  if (element?.tabId && element.tabId !== activeTabId) state.selectedId = state.configuration.elements.find((item) => item.tabId === activeTabId)?.id || null;
  renderAll();
});
preview.addEventListener('focusin', (event) => {
  const element = event.target.closest('.editor-element');
  if (element && state.selectedId !== element.dataset.id) selectElement(element.dataset.id);
});
desktopPreviewButton.addEventListener('click', () => setPreviewMode('desktop'));
mobilePreviewButton.addEventListener('click', () => setPreviewMode('mobile'));
document.querySelectorAll('[data-panel-tab]').forEach((button) => button.addEventListener('click', () => {
  editorApp.dataset.panel = button.dataset.panelTab;
  document.querySelectorAll('[data-panel-tab]').forEach((item) => item.classList.toggle('is-active', item === button));
}));
if ('ResizeObserver' in window) {
  new ResizeObserver(() => {
    if (!state || pointerAction) return;
    state.configuration.elements.forEach((element) => {
      const node = preview.querySelector(`[data-id="${element.id}"]`);
      if (node) applyGeometry(node, element, responsive.resolveElementLayout(element, mobilePreviewActive()));
    });
  }).observe(preview);
}
document.addEventListener('keydown', (event) => {
  if (!state || isEditingField(event.target)) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === 's') {
    event.preventDefault();
    finishKeyboardChange();
    saveNow();
    return;
  }
  if (command && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    finishKeyboardChange();
    const changed = event.shiftKey ? EditorState.redo(state) : EditorState.undo(state);
    if (changed) { renderAll(); scheduleAutosave(); }
    return;
  }
  if (command && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    finishKeyboardChange();
    if (EditorState.redo(state)) { renderAll(); scheduleAutosave(); }
    return;
  }
  if (command && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    finishKeyboardChange();
    duplicateSelected();
    return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    finishKeyboardChange();
    deleteSelected();
    return;
  }
  const step = event.shiftKey ? 2 : .5;
  const directions = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (directions[event.key]) {
    event.preventDefault();
    nudgeSelected(...directions[event.key]);
  }
});
window.addEventListener('beforeunload', (event) => {
  if (!autosaveTimer && !saving) return;
  event.preventDefault();
  event.returnValue = '';
});

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
  if (window.matchMedia('(max-width: 800px)').matches) setPreviewMode('mobile');
  else renderAll();
  if (profileWasAdded) scheduleAutosave();
}

initializeEditor().catch(() => {
  gate.hidden = false;
  gate.querySelector('p').textContent = 'تعذر فتح المحرر الآن. حاول مجددًا لاحقًا.';
});
