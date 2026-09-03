const root = document.querySelector('#public-page');
let backgroundVideos = [];
let activeAudio = null;
let pageCleanup = () => {};
let widgetCleanup = () => {};
let renderedPage = null;
let resizeTimer = null;
let renderedMobile = null;

function text(value) { return document.createTextNode(value || ''); }
function assetPosition(asset) { return asset?.crop ? `${asset.crop.x}% ${asset.crop.y}%` : (asset?.position || 'center'); }
function mobileViewport() { return window.matchMedia('(max-width: 700px)').matches; }
function geometry(node, element) {
  const layout = window.CelestiaPageResponsive.resolveElementLayout(element, mobileViewport());
  node.hidden = !layout.visible;
  node.style.left = `${layout.position.x}%`; node.style.top = `${layout.position.y}%`;
  node.style.width = `${layout.size.width}%`; node.style.height = `${layout.size.height}%`; node.style.zIndex = String(element.zIndex);
  node.style.transform = `translate(-50%, -50%) rotate(${element.style.rotation || 0}deg) scale(${layout.scale}) scaleX(${element.style.flipX ? -1 : 1})`;
  node.style.textAlign = layout.alignment || '';
  node.style.color = element.style.color || ''; node.style.backgroundColor = element.style.backgroundColor || ''; node.style.opacity = element.style.opacity ?? '';
  node.style.borderRadius = element.style.borderRadius !== undefined ? `${element.style.borderRadius}px` : '';
  node.style.boxShadow = element.style.shadow === 'strong' ? '0 14px 28px rgba(0,0,0,.5)' : (element.style.shadow === 'soft' ? '0 8px 18px rgba(0,0,0,.3)' : 'none');
  if (element.style.glow) node.style.boxShadow += ', 0 0 20px rgba(241,199,94,.45)';
}
function elementVisualScale(element) {
  return window.CelestiaPageResponsive.elementVisualScale(element, mobileViewport());
}
function applyTextStyle(node, style, scale = 1) {
  node.style.fontFamily = style.fontFamily || 'Cairo'; node.style.fontSize = `${Math.round((style.fontSize || 16) * scale * 10) / 10}px`; node.style.fontWeight = style.fontWeight || '400'; node.style.color = style.color || ''; node.style.textAlign = style.textAlign || ''; node.style.letterSpacing = `${style.letterSpacing || 0}px`; node.style.lineHeight = String(style.lineHeight || 1.4); if (style.effect && style.effect !== 'none') node.classList.add(`effect-${style.effect}`);
}
function scaleWidget(node, element) {
  const scale = elementVisualScale(element);
  const mediaSize = Math.round(70 * scale);
  node.style.fontSize = `${Math.round((element.style.fontSize || 16) * scale * 10) / 10}px`;
  node.style.padding = `${Math.round(Math.max(2, Math.min(48, 12 * scale)))}px`;
  node.style.color = element.style.color || '';
  node.style.background = element.style.backgroundColor || '';
  node.style.borderRadius = `${element.style.borderRadius ?? 14}px`;
  node.querySelectorAll('.widget-favorites figure').forEach((figure) => { figure.style.minWidth = `${mediaSize}px`; });
  node.querySelectorAll('.widget-favorites img').forEach((image) => { image.style.width = `${mediaSize}px`; image.style.height = `${mediaSize}px`; });
  node.querySelectorAll('.widget-gallery.layout-polaroid figure').forEach((figure) => { figure.style.flexBasis = `${Math.round(115 * scale)}px`; });
  node.querySelectorAll('.widget-gallery img').forEach((image) => { image.style.minHeight = `${Math.round(70 * scale)}px`; image.style.maxHeight = `${Math.round(160 * scale)}px`; });
}
function mediaElement(asset, video = false, lazy = false, mobile = false) {
  const media = video ? document.createElement('video') : document.createElement('img');
  media.src = asset.url; media.style.objectFit = asset.fit || 'cover'; media.style.objectPosition = assetPosition(asset);
  if (video) { media.muted = true; media.loop = true; media.autoplay = !mobile; media.preload = mobile ? 'none' : 'metadata'; media.playsInline = true; media.addEventListener('error', () => { media.hidden = true; }, { once: true }); if (!mobile) backgroundVideos.push(media); }
  else { media.alt = ''; media.loading = lazy ? 'lazy' : 'eager'; media.decoding = 'async'; media.sizes = '(max-width: 700px) 92vw, 900px'; media.fetchPriority = lazy ? 'low' : 'high'; media.addEventListener('error', () => { if (!media.src.endsWith('/assets/logo.png')) media.src = '/assets/logo.png'; }, { once: true }); }
  return media;
}
function createBackground(configuration) {
  const background = configuration.background; const holder = document.createElement('div'); holder.className = 'public-background';
  holder.style.background = background.type === 'gradient' ? `linear-gradient(${background.gradient?.angle ?? 135}deg, ${background.gradient?.from || '#100d1d'}, ${background.gradient?.to || '#42266f'})` : (background.color || '#100d1d');
  if (background.asset?.url) { const media = mediaElement(background.asset, background.type === 'video', false, mobileViewport()); media.className = 'public-background-media'; media.style.filter = `blur(${background.blur}px) brightness(${background.brightness})`; if (background.blur) media.style.transform = 'scale(1.05)'; holder.append(media); }
  const overlay = document.createElement('div'); overlay.className = 'public-background-overlay'; overlay.style.background = background.overlayColor || '#000000'; overlay.style.opacity = String(background.overlayOpacity || 0);
  const vignette = document.createElement('div'); vignette.className = 'public-background-vignette'; vignette.style.setProperty('--vignette', String(background.vignette || 0));
  const grain = document.createElement('div'); grain.className = 'public-background-grain'; grain.style.opacity = String(background.grain || 0);
  holder.append(overlay, vignette, grain); return holder;
}
function profileCard(page, configuration, element) {
  const scale = elementVisualScale(element);
  const profile = configuration.profileCard; const card = document.createElement('article'); card.className = 'public-profile-card';
  card.style.background = `color-mix(in srgb, ${profile.backgroundColor} ${Math.round(profile.opacity * 100)}%, transparent)`; card.style.borderColor = profile.borderColor; card.style.borderWidth = `${profile.borderWidth}px`; card.style.borderRadius = `${profile.borderRadius}px`; card.style.padding = `${Math.round(profile.padding * scale)}px`; card.style.width = '100%'; card.style.height = '100%'; card.style.maxWidth = '100%'; card.style.textAlign = profile.alignment; card.style.backdropFilter = profile.glass ? `blur(${profile.blur}px)` : 'none';
  card.style.boxShadow = profile.shadow === 'strong' ? '0 24px 56px rgba(0,0,0,.54)' : (profile.shadow === 'soft' ? '0 14px 34px rgba(0,0,0,.32)' : 'none'); if (profile.glow) card.style.boxShadow += ', 0 0 28px rgba(241,199,94,.35)';
  const banner = configuration.banner;
  if (banner.visible && banner.asset?.url) { const bannerNode = document.createElement('div'); bannerNode.className = 'public-banner'; bannerNode.style.borderRadius = `${banner.borderRadius}px`; bannerNode.append(mediaElement(banner.asset)); card.append(bannerNode); }
  const avatarConfig = configuration.avatar; const avatar = document.createElement('div'); avatar.className = 'public-avatar'; avatar.style.width = `${Math.round(avatarConfig.size * scale)}px`; avatar.style.height = `${Math.round(avatarConfig.size * scale)}px`; avatar.style.borderRadius = avatarConfig.shape === 'circle' ? '50%' : (avatarConfig.shape === 'rounded-square' ? '22%' : '0'); avatar.style.borderColor = avatarConfig.borderColor; avatar.style.borderWidth = `${avatarConfig.borderWidth}px`; avatar.style.boxShadow = avatarConfig.shadow === 'strong' ? '0 12px 26px rgba(0,0,0,.48)' : (avatarConfig.shadow === 'soft' ? '0 7px 18px rgba(0,0,0,.3)' : 'none'); if (avatarConfig.glow) avatar.style.boxShadow += ', 0 0 20px rgba(241,199,94,.42)';
  if (avatarConfig.asset?.url) avatar.append(mediaElement(avatarConfig.asset)); else avatar.append(text((page.displayName || '?').trim().charAt(0).toUpperCase() || '?'));
  const name = document.createElement('h1'); name.textContent = page.displayName; applyTextStyle(name, configuration.typography.displayName, scale); const bio = document.createElement('p'); bio.className = 'public-bio'; bio.textContent = page.bio; applyTextStyle(bio, configuration.typography.bio, scale); card.append(avatar, name, bio); return card;
}
function textElement(element) {
  const fontSize = mobileViewport() && element.mobileOverrides?.fontSize !== undefined ? element.mobileOverrides.fontSize : (element.style.fontSize || 18); const node = document.createElement('div'); node.className = 'public-text'; node.textContent = element.content || ''; node.style.fontFamily = element.style.fontFamily || 'Cairo'; node.style.fontSize = `${fontSize}px`; node.style.fontWeight = element.style.fontWeight || '400'; node.style.textAlign = element.style.textAlign || 'right'; node.style.letterSpacing = `${element.style.letterSpacing || 0}px`; node.style.lineHeight = String(element.style.lineHeight || 1.4); if (element.style.effect && element.style.effect !== 'none') node.classList.add(`effect-${element.style.effect}`); return node;
}
function socialLinks(configuration, element) {
  const scale = elementVisualScale(element); const node = document.createElement('nav'); node.className = 'public-links'; applyTextStyle(node, configuration.typography.link, scale); configuration.socialLinks.filter((link) => link.visible !== false).forEach((link) => { const anchor = document.createElement('a'); const display = link.display || 'both'; anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.style.display = 'inline-flex'; anchor.style.alignItems = 'center'; anchor.style.justifyContent = 'center'; anchor.style.gap = '.45em'; if (display !== 'text') anchor.append(window.CelestiaSocialIcons?.create(link.icon || 'website', link.label) || text('◉')); if (display !== 'icon') anchor.append(text(link.label)); node.append(anchor); }); return node;
}
async function publicRequest(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'تعذر إتمام الطلب.');
  return body;
}
function reactionBar(page) {
  if (!page.reactionsEnabled) return null;
  const node = document.createElement('section'); node.className = 'page-reactions';
  const render = (data) => { node.replaceChildren(); data.allowed.forEach((reaction) => { const button = document.createElement('button'); button.type = 'button'; button.dataset.reaction = reaction; button.setAttribute('aria-pressed', String(data.userReactions.includes(reaction))); button.textContent = `${reaction} ${data.counts[reaction] || 0}`; button.addEventListener('click', async () => { try { const active = button.getAttribute('aria-pressed') !== 'true'; const next = await publicRequest(`/api/pages/${encodeURIComponent(page.slug)}/reactions/${encodeURIComponent(reaction)}`, { method: active ? 'POST' : 'DELETE' }); render({ ...data, ...next }); } catch (error) { node.dataset.error = error.message; } }); node.append(button); }); };
  publicRequest(`/api/pages/${encodeURIComponent(page.slug)}/reactions`).then(render).catch(() => node.remove()); return node;
}
function remixButton(page) {
  if (!page.remixEnabled) return null;
  const node = document.createElement('section'); node.className = 'page-remix';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Remix this page';
  const count = document.createElement('small'); count.textContent = `${page.remixCount || 0} remixes`;
  button.addEventListener('click', async () => {
    const slug = window.prompt('اختر رابط صفحتك الجديد (3-30 حرفًا إنجليزيًا صغيرًا أو أرقامًا أو -)');
    if (!slug) return;
    try { const data = await publicRequest(`/api/pages/${encodeURIComponent(page.slug)}/remix`, { method: 'POST', body: JSON.stringify({ slug }) }); window.location.assign(`/pages/editor?remix=${encodeURIComponent(data.source.slug)}`); }
    catch (error) { node.dataset.error = error.message; }
  });
  node.append(button, count); return node;
}
function guestbookWidget(page, element) {
  const node = document.createElement('section'); node.className = 'public-widget widget-guestbook'; node.setAttribute('aria-label', 'سجل الزوار');
  const title = document.createElement('strong'); title.textContent = 'Guestbook'; const list = document.createElement('div'); list.className = 'guestbook-list'; const form = document.createElement('form'); const input = document.createElement('textarea'); input.maxLength = 500; input.placeholder = 'اكتب رسالة لطيفة…'; input.setAttribute('aria-label', 'رسالتك في سجل الزوار'); const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'إرسال'; form.append(input, submit); node.append(title, list, form);
  let cursor = null; let canManage = false;
  const entryNode = (entry) => { const card = document.createElement('article'); card.className = 'guestbook-entry'; if (entry.hidden) card.classList.add('is-hidden'); const author = document.createElement('strong'); author.textContent = entry.authorName; const content = document.createElement('p'); content.textContent = entry.content; const date = document.createElement('time'); date.dateTime = entry.createdAt; date.textContent = new Date(entry.createdAt).toLocaleDateString('ar'); card.append(author, content, date); if (entry.pinned) { const pin = document.createElement('small'); pin.textContent = 'مثبت'; card.append(pin); } if (entry.ownerReply) { const reply = document.createElement('p'); reply.className = 'owner-reply'; reply.textContent = `رد المالك: ${entry.ownerReply}`; card.append(reply); } if (canManage) { ['pin', 'hide', 'delete', 'reply'].forEach((action) => { const control = document.createElement('button'); control.type = 'button'; control.textContent = action === 'pin' ? 'تثبيت' : action === 'hide' ? 'إخفاء' : action === 'delete' ? 'حذف' : 'رد'; control.addEventListener('click', async () => { const contentValue = action === 'reply' ? window.prompt('الرد', entry.ownerReply || '') : undefined; if (action === 'reply' && contentValue === null) return; try { const result = await publicRequest(`/api/pages/me/guestbook/${entry.id}`, { method: 'PATCH', body: JSON.stringify({ action, value: action === 'pin' ? !entry.pinned : action === 'hide' ? !entry.hidden : undefined, content: contentValue }) }); if (action === 'delete') card.remove(); else card.replaceWith(entryNode(result.entry)); } catch (error) { node.dataset.error = error.message; } }); card.append(control); }); } return card; };
  const load = async (before = null, append = false) => { try { const query = before ? `?before=${encodeURIComponent(before)}` : ''; const data = await publicRequest(`/api/pages/${encodeURIComponent(page.slug)}/guestbook${query}`); canManage = data.canManage; cursor = data.nextCursor; const entries = data.entries.map(entryNode); if (!append) list.replaceChildren(...entries); else list.append(...entries); if (cursor) { const more = document.createElement('button'); more.type = 'button'; more.textContent = 'المزيد'; more.addEventListener('click', () => { more.remove(); load(cursor, true); }); list.append(more); } } catch { form.hidden = true; } };
  form.addEventListener('submit', async (event) => { event.preventDefault(); try { const data = await publicRequest(`/api/pages/${encodeURIComponent(page.slug)}/guestbook`, { method: 'POST', body: JSON.stringify({ content: input.value }) }); input.value = ''; list.prepend(entryNode(data.entry)); } catch (error) { node.dataset.error = error.message; } });
  if (!page.guestbookEnabled) return null; load(); return node;
}
function formatTime(seconds) { return Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00'; }
function musicPlayer(config) {
  if (!config.enabled) return null;
  const hasAudio = Boolean(config.audioUrl);
  const player = document.createElement('section'); player.className = `celestia-player preset-${config.preset}`; player.setAttribute('aria-label', 'مشغل الموسيقى');
  const audio = document.createElement('audio'); if (hasAudio) audio.src = config.audioUrl; audio.preload = 'metadata'; audio.loop = config.loop;
  const cover = document.createElement('img'); cover.className = 'player-cover'; cover.src = config.cover?.url || '/assets/logo.png'; cover.alt = '';
  const details = document.createElement('div'); details.className = 'player-details'; const title = document.createElement('strong'); title.textContent = config.title || 'Untitled'; const artist = document.createElement('span'); artist.textContent = config.artist || 'Celestia'; details.append(title, artist);
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'player-toggle'; toggle.textContent = '▶'; toggle.disabled = !hasAudio; toggle.setAttribute('aria-label', hasAudio ? 'تشغيل الموسيقى' : 'أضف ملفًا صوتيًا لتشغيل الموسيقى');
  const progress = document.createElement('input'); progress.type = 'range'; progress.className = 'player-progress'; progress.min = '0'; progress.max = '100'; progress.value = '0'; progress.disabled = !hasAudio; progress.setAttribute('aria-label', 'تقدم الأغنية');
  const time = document.createElement('span'); time.className = 'player-time'; time.textContent = '0:00';
  const volume = document.createElement('input'); volume.type = 'range'; volume.min = '0'; volume.max = '1'; volume.step = '.05'; volume.value = '1'; volume.className = 'player-volume'; volume.setAttribute('aria-label', 'مستوى الصوت');
  const loop = document.createElement('button'); loop.type = 'button'; loop.className = 'player-loop'; loop.textContent = '↻'; loop.setAttribute('aria-pressed', String(config.loop)); loop.setAttribute('aria-label', 'تكرار');
  const controls = document.createElement('div'); controls.className = 'player-controls'; controls.append(toggle, progress, time, volume, loop); player.append(cover, details, controls, audio);
  const sync = () => { progress.value = String(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0); time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`; toggle.textContent = audio.paused ? '▶' : '❚❚'; toggle.setAttribute('aria-label', audio.paused ? 'تشغيل الموسيقى' : 'إيقاف الموسيقى'); };
  toggle.addEventListener('click', async () => { if (!hasAudio) return; if (audio.paused) { if (activeAudio && activeAudio !== audio) activeAudio.pause(); try { await audio.play(); activeAudio = audio; } catch { return; } } else audio.pause(); sync(); });
  audio.addEventListener('timeupdate', sync); audio.addEventListener('loadedmetadata', sync); audio.addEventListener('play', sync); audio.addEventListener('pause', sync); progress.addEventListener('input', () => { if (audio.duration) audio.currentTime = (Number(progress.value) / 100) * audio.duration; }); volume.addEventListener('input', () => { audio.volume = Number(volume.value); }); loop.addEventListener('click', () => { audio.loop = !audio.loop; loop.setAttribute('aria-pressed', String(audio.loop)); }); return player;
}
function scaleMusicPlayer(player, element) {
  const scale = elementVisualScale(element);
  player.style.fontSize = `${Math.round((element.style.fontSize || 14) * scale * 10) / 10}px`;
  player.style.padding = `${Math.round(Math.max(6, 10 * scale))}px`;
  const cover = player.querySelector('.player-cover');
  const coverSize = Math.round(52 * scale);
  player.style.gridTemplateColumns = `${coverSize}px minmax(0, 1fr)`;
  if (cover) { cover.style.width = `${coverSize}px`; cover.style.height = `${coverSize}px`; }
  const toggle = player.querySelector('.player-toggle'); const loop = player.querySelector('.player-loop');
  if (toggle) { toggle.style.width = `${Math.round(29 * scale)}px`; toggle.style.height = `${Math.round(29 * scale)}px`; }
  if (loop) { loop.style.width = `${Math.round(27 * scale)}px`; loop.style.height = `${Math.round(27 * scale)}px`; }
  const controls = player.querySelector('.player-controls');
  if (controls) controls.style.gridTemplateColumns = `auto minmax(20px,1fr) auto minmax(20px,${Math.round(70 * scale)}px) auto`;
}
function widgetNode(page, element) {
  const data = element.widgetData; const node = document.createElement('section'); node.className = `public-widget widget-${data.kind}`;
  if (data.kind === 'quote') { const quote = document.createElement('blockquote'); quote.textContent = `“${data.text}”`; node.append(quote); if (data.author) { const author = document.createElement('cite'); author.textContent = `— ${data.author}`; node.append(author); } }
  else if (data.kind === 'mood') node.textContent = `${data.icon || '✨'} ${data.text}`;
  else if (data.kind === 'characters' || data.kind === 'games') { const list = document.createElement('div'); list.className = 'widget-favorites'; data.items.forEach((item) => { const card = document.createElement('figure'); const image = mediaElement(item.image, false, true); image.alt = item.name; const label = document.createElement('figcaption'); label.textContent = item.name; card.append(image, label); list.append(card); }); node.append(list); }
  else if (data.kind === 'gallery') { const list = document.createElement('div'); list.className = `widget-gallery layout-${data.layout}`; data.items.forEach((item, index) => { const figure = document.createElement('figure'); const image = mediaElement(item.image, false, index > 2); image.alt = item.caption || ''; figure.append(image); if (item.caption) { const caption = document.createElement('figcaption'); caption.textContent = item.caption; figure.append(caption); } list.append(figure); }); node.append(list); }
  else if (data.kind === 'counter') node.textContent = `${data.label}: ${page.viewsCount || 0}`;
  else if (data.kind === 'clock') { const time = document.createElement('time'); const update = () => { time.textContent = new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit', second: data.showSeconds ? '2-digit' : undefined, hour12: data.format === '12h' }).format(new Date()); }; update(); const interval = window.setInterval(update, data.showSeconds ? 1000 : 30000); const previous = widgetCleanup; widgetCleanup = () => { previous(); clearInterval(interval); }; node.append(time); }
  else if (data.kind === 'countdown') { const value = document.createElement('strong'); const update = () => { const difference = new Date(data.targetDate).getTime() - Date.now(); if (difference <= 0) value.textContent = data.finishedText || 'انتهى'; else { const total = Math.floor(difference / 1000); value.textContent = `${data.title}: ${Math.floor(total / 86400)}d ${Math.floor(total % 86400 / 3600)}h ${Math.floor(total % 3600 / 60)}m`; } }; update(); const interval = window.setInterval(update, 1000); const previous = widgetCleanup; widgetCleanup = () => { previous(); clearInterval(interval); }; node.append(value); }
  else if (data.kind === 'poll') { const question = document.createElement('strong'); question.textContent = data.question; const key = `celestia-page-poll:${page.slug}:${element.id}`; const voted = window.localStorage.getItem(key); node.append(question); data.options.forEach((option) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = option.label; button.disabled = Boolean(voted); button.addEventListener('click', () => { window.localStorage.setItem(key, option.id); node.querySelectorAll('button').forEach((item) => { item.disabled = true; }); }); node.append(button); }); }
  else node.textContent = data.text;
  return node;
}
function renderElement(page, configuration, element) {
  const node = document.createElement('div'); node.className = `public-element public-${element.type}`; if (element.type === 'image' && element.style.animation && element.style.animation !== 'none') node.classList.add(`image-animation-${element.style.animation}`); geometry(node, element);
  if (element.type === 'profile-card') node.append(profileCard(page, configuration, element)); else if (element.type === 'text') node.append(textElement(element)); else if (element.type === 'social-links') node.append(socialLinks(configuration, element)); else if (element.type === 'image') { const image = mediaElement({ url: element.assetUrl, fit: element.style.objectFit || 'cover', position: element.style.objectPosition || 'center' }, false, element.position.y > 62); image.alt = element.name || ''; node.append(image); } else if (element.type === 'widget') { const widget = element.widgetData.kind === 'guestbook' ? guestbookWidget(page, element) : widgetNode(page, element); if (widget) { scaleWidget(widget, element); node.append(widget); } else node.hidden = true; } else if (element.type === 'music') { const player = musicPlayer(configuration.musicPlayer); if (player) { player.style.position = 'static'; player.style.width = '100%'; player.style.maxWidth = 'none'; player.style.height = '100%'; scaleMusicPlayer(player, element); node.append(player); } else node.append(text('Music Player')); } else { const sticker = document.createElement('span'); const fontSize = mobileViewport() && element.mobileOverrides?.fontSize !== undefined ? element.mobileOverrides.fontSize : (element.style.fontSize || 42); sticker.style.fontSize = `${fontSize}px`; sticker.textContent = element.content || '✨'; node.append(sticker); } return node;
}
function entranceScreen(configuration, onEnter) {
  const config = configuration.entranceScreen; if (!config.enabled) return null;
  const screen = document.createElement('button'); screen.type = 'button'; screen.className = `entrance-screen transition-${config.transition}`; screen.style.backgroundColor = config.backgroundColor;
  if (config.background?.url) { const background = mediaElement(config.background); background.className = 'entrance-background'; screen.append(background); }
  const message = document.createElement('span'); message.textContent = config.text || 'اضغط للدخول'; message.style.fontFamily = config.textStyle.fontFamily; message.style.fontSize = `${config.textStyle.fontSize}px`; message.style.fontWeight = config.textStyle.fontWeight; message.style.color = config.textStyle.color; message.style.letterSpacing = `${config.textStyle.letterSpacing}px`; message.style.lineHeight = String(config.textStyle.lineHeight); if (config.textStyle.effect && config.textStyle.effect !== 'none') message.classList.add(`effect-${config.textStyle.effect}`); screen.append(message);
  screen.addEventListener('click', () => { onEnter?.(); if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return screen.remove(); screen.classList.add('is-leaving'); screen.addEventListener('animationend', () => screen.remove(), { once: true }); }); return screen;
}
function enableCursor(configuration, layout) {
  const config = configuration.cursor; const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; const touchDevice = window.matchMedia('(pointer: coarse)').matches;
  if (config.type === 'image' && config.image?.url && !touchDevice) layout.style.cursor = `url("${config.image.url}") 16 16, auto`;
  if (config.trail === 'none' || reduceMotion || touchDevice || navigator.hardwareConcurrency <= 2) return () => { layout.style.cursor = ''; };
  const controller = new AbortController(); let last = null; let frame = 0;
  const renderParticle = () => { frame = 0; if (!last) return; const particle = document.createElement('i'); particle.className = `cursor-particle trail-${config.trail}`; particle.textContent = ({ stars: '★', hearts: '♥', sparkles: '✦', bubbles: '●' })[config.trail]; particle.style.left = `${last.x}px`; particle.style.top = `${last.y}px`; particle.style.color = config.color; layout.append(particle); window.setTimeout(() => particle.remove(), 720); };
  window.addEventListener('pointermove', (event) => { last = { x: event.clientX, y: event.clientY }; if (!frame) frame = requestAnimationFrame(renderParticle); }, { signal: controller.signal, passive: true });
  return () => { controller.abort(); if (frame) cancelAnimationFrame(frame); layout.style.cursor = ''; };
}
function syncBackgroundVideos() { document.documentElement.classList.toggle('celestia-page-hidden', document.hidden); backgroundVideos.forEach((video) => { if (document.hidden) video.pause(); else video.play().catch(() => undefined); }); }
function render(page) {
  renderedPage = page;
  renderedMobile = mobileViewport();
  pageCleanup(); widgetCleanup(); widgetCleanup = () => {}; if (activeAudio) { activeAudio.pause(); activeAudio = null; } document.title = `${page.displayName} | Celestia`; backgroundVideos = [];
  const configuration = page.configuration; const layout = document.createElement('section'); layout.className = 'public-layout'; layout.append(createBackground(configuration));
  const elements = configuration.elements.some((element) => element.type === 'profile-card') ? configuration.elements : [{ id: 'profile-card', type: 'profile-card', position: { x: 50, y: 50 }, size: { width: 72, height: 48 }, zIndex: 1, visible: true, style: {} }, ...configuration.elements];
  const visibleTabs = configuration.tabs.filter((tab) => tab.visible !== false);
  const tabLayer = document.createElement('div'); tabLayer.className = 'public-tab-content'; tabLayer.setAttribute('role', 'tabpanel');
  const nodes = elements.filter((element) => element.visible !== false).sort((first, second) => first.zIndex - second.zIndex).map((element) => ({ element, node: renderElement(page, configuration, element) }));
  nodes.forEach(({ node }) => tabLayer.append(node)); layout.append(tabLayer);
  if (visibleTabs.length) {
    const navigation = document.createElement('nav'); navigation.className = 'public-tabs'; navigation.setAttribute('role', 'tablist'); navigation.setAttribute('aria-label', 'أقسام الصفحة'); let activeTab = visibleTabs[0].id;
    const setTab = (id) => { activeTab = id; const active = visibleTabs.find((tab) => tab.id === id); tabLayer.className = `public-tab-content transition-${active.transition}`; nodes.forEach(({ element, node }) => { const mobileVisible = window.CelestiaPageResponsive.resolveElementLayout(element, mobileViewport()).visible; node.hidden = !mobileVisible || Boolean(element.tabId && element.tabId !== id); }); navigation.querySelectorAll('button').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tabId === id))); };
    visibleTabs.forEach((tab) => { const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'tab'); button.dataset.tabId = tab.id; button.textContent = tab.label; button.addEventListener('click', () => setTab(tab.id)); navigation.append(button); });
    layout.append(navigation); setTab(activeTab);
  } else if (configuration.tabs.length) nodes.forEach(({ element, node }) => { node.hidden = Boolean(element.tabId); });
  if (!elements.some((element) => element.type === 'music' && element.visible !== false)) { const fallbackPlayer = musicPlayer(configuration.musicPlayer); if (fallbackPlayer) layout.append(fallbackPlayer); }
  const reactions = reactionBar(page); if (reactions) layout.append(reactions);
  const remix = remixButton(page); if (remix) layout.append(remix);
  const brand = document.createElement('a'); brand.className = 'public-brand'; brand.href = '/'; brand.textContent = 'CELESTIA PAGES'; layout.append(brand);
  const entrance = entranceScreen(configuration, () => { const audio = layout.querySelector('.celestia-player audio'); audio?.play().catch(() => undefined); }); if (entrance) layout.append(entrance); root.replaceChildren(layout); pageCleanup = enableCursor(configuration, layout); syncBackgroundVideos();
}
async function loadPage() { const slug = window.location.pathname.split('/').filter(Boolean).pop(); const response = await fetch(`/api/pages/${encodeURIComponent(slug)}`); if (!response.ok) throw new Error('هذه الصفحة غير موجودة أو لم تُنشر بعد.'); render((await response.json()).page); }
document.addEventListener('visibilitychange', syncBackgroundVideos); window.addEventListener('pagehide', () => { pageCleanup(); widgetCleanup(); activeAudio?.pause(); }); loadPage().catch((error) => { root.classList.add('public-error'); root.textContent = error.message; });
window.addEventListener('resize', () => { if (!renderedPage || mobileViewport() === renderedMobile) return; window.clearTimeout(resizeTimer); resizeTimer = window.setTimeout(() => render(renderedPage), 150); }, { passive: true });
