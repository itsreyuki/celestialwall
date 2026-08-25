const musicGallery = document.querySelector('#music-gallery');
const musicCount = document.querySelector('#music-count');
const musicComposer = document.querySelector('#music-composer');
const musicMemberGate = document.querySelector('#music-member-gate');
const musicInvite = document.querySelector('#music-invite');
const musicForm = document.querySelector('#music-form');
const musicUrl = document.querySelector('#music-url');
const musicComment = document.querySelector('#music-comment');
const musicSubmit = document.querySelector('#music-submit');
const musicFormNotice = document.querySelector('#music-form-notice');
const musicAccount = document.querySelector('#music-account');
const musicLogin = document.querySelector('#music-login');
const musicPlayerDock = document.querySelector('#music-player-dock');
const musicPreviewHost = document.querySelector('#music-preview-host');

const providerNames = { youtube: 'YouTube Music', spotify: 'Spotify', soundcloud: 'SoundCloud' };
let tracks = [];
let currentUser = null;
let activeTrackId = null;
let previewTrackId = null;
let musicSocket = null;
let spotifyIframeApi = null;
let activeSpotifyController = null;

window.onSpotifyIframeApiReady = (iframeApi) => {
  spotifyIframeApi = iframeApi;
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function avatarUrl(user) {
  if (!user?.avatar || !user?.id) return '';
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=64`;
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' }).format(new Date(value));
  } catch {
    return '';
  }
}

function trackById(id) {
  return tracks.find((track) => track.id === id);
}

function isOwner(track) {
  return Boolean(currentUser?.isMember && track?.author?.id === currentUser.id);
}

function artwork(track) {
  const image = track.artworkUrl
    ? `<img src="${escapeHtml(track.artworkUrl)}" alt="غلاف ${escapeHtml(track.title)}" loading="lazy" referrerpolicy="no-referrer" />`
    : '';
  return `<div class="music-art">${image}<span class="music-provider">${escapeHtml(providerNames[track.provider] || track.provider)}</span></div>`;
}

function cardMarkup(track) {
  const deleteButton = isOwner(track)
    ? `<button class="music-delete" type="button" data-delete-track="${escapeHtml(track.id)}">حذف</button>`
    : '';
  const comment = track.comment ? `<p class="music-comment">${escapeHtml(track.comment)}</p>` : '<span class="music-comment"></span>';
  const playing = activeTrackId === track.id;
  return `
    <article class="music-card provider-${escapeHtml(track.provider)}${playing ? ' is-playing' : ''}" data-track-id="${escapeHtml(track.id)}" tabindex="0">
      ${artwork(track)}
      <div>
        <h3 class="music-card-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</h3>
        <p class="music-author">اختارها ${escapeHtml(track.author?.global_name || track.author?.username || 'عضو سيليستيا')}</p>
      </div>
      ${comment}
      <div class="music-card-actions">
        <span class="music-date">${escapeHtml(formatDate(track.createdAt))}</span>
        <div>
          ${deleteButton}
          <button class="music-play" type="button" data-play-track="${escapeHtml(track.id)}">${playing ? 'إيقاف' : 'تشغيل'}</button>
        </div>
      </div>
    </article>`;
}

function renderRow(items, reverse = false) {
  if (!items.length) return '';
  const repeated = [...items, ...items, ...items].map(cardMarkup).join('');
  return `<div class="music-row${reverse ? ' music-row-reverse' : ''}"><div class="music-row-track">${repeated}</div></div>`;
}

function renderTracks() {
  musicCount.textContent = `${tracks.length} ${tracks.length === 1 ? 'أغنية' : 'أغنية'}`;
  if (!tracks.length) {
    musicGallery.classList.remove('is-paused', 'is-focused');
    musicGallery.innerHTML = '<div class="music-empty">لا توجد أغنيات بعد — كن أول من يفتح الشباك.</div>';
    return;
  }

  const firstRow = tracks.filter((_, index) => index % 2 === 0);
  const secondRow = tracks.filter((_, index) => index % 2 === 1);
  musicGallery.innerHTML = `${renderRow(firstRow)}${renderRow(secondRow.length ? secondRow : firstRow, true)}`;
  musicGallery.classList.toggle('is-paused', Boolean(activeTrackId));
  musicGallery.classList.toggle('is-focused', Boolean(activeTrackId));
  musicGallery.querySelectorAll('.music-art img').forEach((image) => {
    image.addEventListener('error', () => image.classList.add('broken'), { once: true });
  });
}

function showFormNotice(message = '') {
  musicFormNotice.textContent = message;
  musicFormNotice.hidden = !message;
}

function embedUrl(track, { autoplay = false, preview = false } = {}) {
  if (track.provider === 'youtube') {
    const params = new URLSearchParams({
      autoplay: autoplay ? '1' : '0',
      mute: preview ? '1' : '0',
      controls: preview ? '0' : '1',
      playsinline: '1',
      enablejsapi: '1',
      rel: '0'
    });
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(track.providerId)}?${params}`;
  }
  if (track.provider === 'spotify') {
    return `https://open.spotify.com/embed/track/${encodeURIComponent(track.providerId)}?utm_source=celestialwall`;
  }
  const params = new URLSearchParams({
    url: track.sourceUrl,
    auto_play: autoplay ? 'true' : 'false',
    hide_related: 'true',
    show_comments: 'false',
    visual: preview ? 'false' : 'true',
    color: '8d62e8'
  });
  return `https://w.soundcloud.com/player/?${params}`;
}

function stopPreview() {
  previewTrackId = null;
  musicPreviewHost.replaceChildren();
}

function postYouTubeCommand(frame, func, args = []) {
  frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com');
}

function startPreview(track) {
  if (!track || activeTrackId || previewTrackId === track.id || track.provider === 'spotify') return;
  stopPreview();
  previewTrackId = track.id;
  const frame = document.createElement('iframe');
  frame.src = embedUrl(track, { autoplay: true, preview: true });
  frame.allow = 'autoplay; encrypted-media';
  frame.title = '';
  musicPreviewHost.append(frame);

  frame.addEventListener('load', () => {
    if (previewTrackId !== track.id) return;
    if (track.provider === 'youtube') {
      window.setTimeout(() => {
        postYouTubeCommand(frame, 'playVideo');
        postYouTubeCommand(frame, 'setVolume', [15]);
        postYouTubeCommand(frame, 'unMute');
      }, 500);
      return;
    }
    if (track.provider === 'soundcloud' && window.SC?.Widget) {
      const widget = window.SC.Widget(frame);
      widget.bind(window.SC.Widget.Events.READY, () => {
        widget.setVolume(15);
        widget.play();
      });
    }
  }, { once: true });
}

function applyFocus(card) {
  musicGallery.classList.add('is-paused', 'is-focused');
  musicGallery.querySelectorAll('.music-card.is-hovered').forEach((item) => item.classList.remove('is-hovered'));
  card?.classList.add('is-hovered');
}

function clearFocus(card) {
  if (card) card.classList.remove('is-hovered');
  if (activeTrackId) return;
  musicGallery.classList.remove('is-paused', 'is-focused');
  stopPreview();
}

function stopPlayer() {
  activeSpotifyController?.destroy?.();
  activeSpotifyController = null;
  activeTrackId = null;
  musicPlayerDock.hidden = true;
  musicPlayerDock.replaceChildren();
  musicGallery.classList.remove('is-paused', 'is-focused');
  renderTracks();
}

function openPlayer(track) {
  stopPreview();
  activeSpotifyController?.destroy?.();
  activeSpotifyController = null;
  activeTrackId = track.id;
  musicGallery.classList.add('is-paused', 'is-focused');
  const meta = document.createElement('div');
  meta.className = 'music-player-meta';
  meta.innerHTML = `<div><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(providerNames[track.provider] || track.provider)}</span></div><button class="music-player-close" type="button">إيقاف</button>`;
  const playerHost = document.createElement('div');
  if (track.provider === 'spotify' && spotifyIframeApi) {
    playerHost.className = 'music-spotify-host';
    spotifyIframeApi.createController(playerHost, {
      width: '100%',
      height: 152,
      url: track.sourceUrl
    }, (controller) => {
      if (activeTrackId !== track.id) {
        controller.destroy?.();
        return;
      }
      activeSpotifyController = controller;
      controller.play?.();
    });
  } else {
    const frame = document.createElement('iframe');
    frame.className = `music-player-frame ${track.provider}`;
    frame.src = embedUrl(track, { autoplay: true });
    frame.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    frame.title = `مشغل ${track.title}`;
    playerHost.append(frame);
  }
  musicPlayerDock.replaceChildren(meta, playerHost);
  musicPlayerDock.hidden = false;
  renderTracks();
}

function upsertTrack(track) {
  tracks = [track, ...tracks.filter((item) => item.id !== track.id)]
    .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
  renderTracks();
}

function removeTrack(id) {
  if (activeTrackId === id) stopPlayer();
  tracks = tracks.filter((track) => track.id !== id);
  renderTracks();
}

async function deleteTrack(id) {
  const response = await fetch(`/api/music/tracks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await response.json();
  if (!response.ok) return window.alert(data.error || 'تعذر حذف الأغنية.');
  removeTrack(data.id);
}

async function submitTrack(event) {
  event.preventDefault();
  showFormNotice();
  musicSubmit.disabled = true;
  musicSubmit.textContent = 'جارٍ إضافة الأغنية...';
  try {
    const response = await fetch('/api/music/tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: musicUrl.value, comment: musicComment.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر إضافة الأغنية.');
    upsertTrack(data.track);
    musicForm.reset();
  } catch (error) {
    showFormNotice(error.message || 'تعذر إضافة الأغنية.');
  } finally {
    musicSubmit.disabled = false;
    musicSubmit.innerHTML = '<span aria-hidden="true">+</span> أضف الأغنية';
  }
}

function renderAccount() {
  if (!currentUser) return;
  const avatar = avatarUrl(currentUser);
  musicAccount.innerHTML = `
    <span class="account-name">${avatar ? `<img class="account-avatar" src="${avatar}" alt="" />` : '<span class="account-avatar"></span>'}<span>${escapeHtml(currentUser.global_name || currentUser.username)}</span></span>
    <button id="music-logout" class="logout-button" type="button">تسجيل الخروج</button>`;
  musicAccount.hidden = false;
  musicLogin.hidden = true;
  document.querySelector('#music-logout').addEventListener('click', async () => {
    const response = await fetch('/auth/logout', { method: 'POST' });
    if (response.ok) window.location.reload();
  });
}

async function loadSession() {
  try {
    const response = await fetch('/auth/me', { credentials: 'same-origin' });
    const data = await response.json();
    currentUser = data.authenticated ? data.user : null;
    if (currentUser) renderAccount();
    musicComposer.hidden = !currentUser?.isMember;
    musicMemberGate.hidden = Boolean(currentUser?.isMember);
    musicInvite.href = data.inviteUrl || 'https://discord.gg/celes';
  } catch {
    musicComposer.hidden = true;
    musicMemberGate.hidden = false;
  }
}

async function loadTracks() {
  try {
    const response = await fetch('/api/music/tracks');
    const data = await response.json();
    tracks = Array.isArray(data.tracks) ? data.tracks : [];
    renderTracks();
  } catch {
    musicGallery.innerHTML = '<div class="music-empty">تعذر تحميل الأغاني حالياً. حاول تحديث الصفحة.</div>';
  }
}

function initializeRealtime() {
  if (typeof window.io !== 'function') return;
  musicSocket = window.io('/music', { withCredentials: true });
  musicSocket.on('music:track-added', ({ track }) => track && upsertTrack(track));
  musicSocket.on('music:track-removed', ({ id }) => id && removeTrack(id));
}

musicForm.addEventListener('submit', submitTrack);
musicPlayerDock.addEventListener('click', (event) => {
  if (event.target.closest('.music-player-close')) stopPlayer();
});
musicGallery.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete-track]');
  if (deleteButton) return deleteTrack(deleteButton.dataset.deleteTrack);
  const playButton = event.target.closest('[data-play-track]');
  if (!playButton) return;
  const track = trackById(playButton.dataset.playTrack);
  if (!track) return;
  if (activeTrackId === track.id) return stopPlayer();
  openPlayer(track);
});
musicGallery.addEventListener('pointerover', (event) => {
  const card = event.target.closest('.music-card');
  if (!card || !musicGallery.contains(card)) return;
  applyFocus(card);
  startPreview(trackById(card.dataset.trackId));
});
musicGallery.addEventListener('pointerout', (event) => {
  const card = event.target.closest('.music-card');
  if (!card || card.contains(event.relatedTarget)) return;
  clearFocus(card);
});
musicGallery.addEventListener('focusin', (event) => {
  const card = event.target.closest('.music-card');
  if (!card) return;
  applyFocus(card);
  startPreview(trackById(card.dataset.trackId));
});
musicGallery.addEventListener('focusout', () => {
  window.setTimeout(() => {
    if (!musicGallery.contains(document.activeElement)) clearFocus();
  }, 0);
});

Promise.all([loadSession(), loadTracks()]).finally(initializeRealtime);
