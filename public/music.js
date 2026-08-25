const musicGallery = document.querySelector('#music-gallery');
const musicCount = document.querySelector('#music-count');
const musicComposer = document.querySelector('#music-composer');
const musicMemberGate = document.querySelector('#music-member-gate');
const musicInvite = document.querySelector('#music-invite');
const musicForm = document.querySelector('#music-form');
const musicComment = document.querySelector('#music-comment');
const musicSubmit = document.querySelector('#music-submit');
const musicFormNotice = document.querySelector('#music-form-notice');
const musicSearchForm = document.querySelector('#music-search-form');
const musicSearchQuery = document.querySelector('#music-search-query');
const musicSearchSubmit = document.querySelector('#music-search-submit');
const musicSearchResults = document.querySelector('#music-search-results');
const musicSelected = document.querySelector('#music-selected');
const musicAccount = document.querySelector('#music-account');
const musicLogin = document.querySelector('#music-login');
const musicPlayerDock = document.querySelector('#music-player-dock');
const musicPreviewHost = document.querySelector('#music-preview-host');

let tracks = [];
let searchResults = [];
let selectedVideo = null;
let currentUser = null;
let activeTrackId = null;
let activeYoutubePlayer = null;
let previewTrackId = null;
let progressTimer = null;
let musicSocket = null;
let youtubeReadyResolve;
const youtubeReady = new Promise((resolve) => { youtubeReadyResolve = resolve; });

window.onYouTubeIframeAPIReady = () => youtubeReadyResolve(window.YT);

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function avatarUrl(user) {
  if (!user?.avatar || !user?.id) return '';
  return 'https://cdn.discordapp.com/avatars/' + encodeURIComponent(user.id) + '/' + encodeURIComponent(user.avatar) + '.png?size=64';
}

function formatDate(value) {
  try { return new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' }).format(new Date(value)); } catch { return ''; }
}

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
}

function trackById(id) {
  return tracks.find((track) => track.id === id);
}

function isOwner(track) {
  return Boolean(currentUser?.isMember && track?.author?.id === currentUser.id);
}

function cardMarkup(track) {
  const image = track.artworkUrl ? '<img src="' + escapeHtml(track.artworkUrl) + '" alt="غلاف ' + escapeHtml(track.title) + '" loading="lazy" referrerpolicy="no-referrer" />' : '';
  const remove = isOwner(track) ? '<button class="music-delete" type="button" data-delete-track="' + escapeHtml(track.id) + '">حذف</button>' : '';
  const comment = track.comment ? '<p class="music-comment">' + escapeHtml(track.comment) + '</p>' : '';
  const active = activeTrackId === track.id ? ' is-playing' : '';
  return '<article class="music-card provider-youtube' + active + '" data-track-id="' + escapeHtml(track.id) + '" tabindex="0">'
    + '<div class="music-art">' + image + '<span class="music-provider">YouTube</span>'
    + '<button class="music-play-circle" type="button" data-play-track="' + escapeHtml(track.id) + '" aria-label="تشغيل ' + escapeHtml(track.title) + '"><span>▶</span></button></div>'
    + '<div class="music-card-body"><div class="music-card-heading"><div><h3 class="music-card-title" title="' + escapeHtml(track.title) + '">' + escapeHtml(track.title) + '</h3>'
    + '<p class="music-author">اختارها ' + escapeHtml(track.author?.global_name || track.author?.username || 'عضو سيليستيا') + '</p></div>' + remove + '</div>'
    + comment + '<div class="music-progress" aria-label="تقدم التشغيل"><span class="music-progress-fill"></span></div>'
    + '<div class="music-time-row"><span class="music-current-time">0:00</span><span class="music-duration">--:--</span></div></div></article>';
}

function renderRow(items, reverse = false) {
  if (!items.length) return '';
  const cards = [...items, ...items, ...items].map(cardMarkup).join('');
  return '<div class="music-row' + (reverse ? ' music-row-reverse' : '') + '"><div class="music-row-track">' + cards + '</div></div>';
}

function renderTracks() {
  musicCount.textContent = tracks.length + ' أغنية';
  if (!tracks.length) {
    musicGallery.classList.remove('is-paused', 'is-focused');
    musicGallery.innerHTML = '<div class="music-empty">لا توجد أغنيات بعد — كن أول من يفتح الشباك.</div>';
    return;
  }
  const firstRow = tracks.filter((_, index) => index % 2 === 0);
  const secondRow = tracks.filter((_, index) => index % 2 === 1);
  musicGallery.innerHTML = renderRow(firstRow) + renderRow(secondRow.length ? secondRow : firstRow, true);
  musicGallery.classList.toggle('is-paused', Boolean(activeTrackId));
  musicGallery.classList.toggle('is-focused', Boolean(activeTrackId));
  musicGallery.querySelectorAll('.music-art img').forEach((image) => image.addEventListener('error', () => image.classList.add('broken'), { once: true }));
  updateProgressUi();
}

function showFormNotice(message = '') {
  musicFormNotice.textContent = message;
  musicFormNotice.hidden = !message;
}

function setSelectedVideo(video) {
  selectedVideo = video;
  if (!video) {
    musicSelected.hidden = true;
    musicSelected.replaceChildren();
    musicSubmit.disabled = true;
    musicSubmit.innerHTML = '<span aria-hidden="true">+</span> اختر أغنية أولاً';
    return;
  }
  const image = video.artworkUrl ? '<img src="' + escapeHtml(video.artworkUrl) + '" alt="" />' : '';
  musicSelected.hidden = false;
  musicSelected.innerHTML = image + '<div><strong>' + escapeHtml(video.title) + '</strong><span>' + escapeHtml(video.channelTitle) + '</span></div>'
    + '<button type="button" data-clear-selection aria-label="إلغاء اختيار الأغنية">×</button>';
  musicSubmit.disabled = false;
  musicSubmit.innerHTML = '<span aria-hidden="true">+</span> أضف الأغنية';
}

function renderSearchResults() {
  if (!searchResults.length) {
    musicSearchResults.innerHTML = '<p class="music-search-empty">لم نجد نتائج موسيقية مطابقة.</p>';
  } else {
    musicSearchResults.innerHTML = searchResults.map((result) => {
      const image = result.artworkUrl ? '<img src="' + escapeHtml(result.artworkUrl) + '" alt="" loading="lazy" />' : '<span class="music-search-placeholder">▶</span>';
      return '<button class="music-search-result" type="button" data-video-id="' + escapeHtml(result.videoId) + '">'
        + image + '<span><strong>' + escapeHtml(result.title) + '</strong><small>' + escapeHtml(result.channelTitle) + '</small></span><i>اختيار</i></button>';
    }).join('');
  }
  musicSearchResults.hidden = false;
}

async function searchVideos(event) {
  event.preventDefault();
  showFormNotice();
  musicSearchSubmit.disabled = true;
  musicSearchSubmit.textContent = 'جارٍ البحث...';
  try {
    const response = await fetch('/api/music/search?q=' + encodeURIComponent(musicSearchQuery.value));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر إجراء البحث.');
    searchResults = Array.isArray(data.results) ? data.results : [];
    renderSearchResults();
  } catch (error) {
    musicSearchResults.hidden = true;
    showFormNotice(error.message || 'تعذر إجراء البحث.');
  } finally {
    musicSearchSubmit.disabled = false;
    musicSearchSubmit.textContent = 'بحث';
  }
}

function stopPreview() {
  previewTrackId = null;
  musicPreviewHost.replaceChildren();
}

function startPreview(track) {
  if (!track || activeTrackId || previewTrackId === track.id) return;
  stopPreview();
  previewTrackId = track.id;
  const params = new URLSearchParams({ autoplay: '1', mute: '1', controls: '0', playsinline: '1', enablejsapi: '1', rel: '0' });
  const frame = document.createElement('iframe');
  frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(track.providerId) + '?' + params;
  frame.allow = 'autoplay; encrypted-media';
  frame.title = '';
  musicPreviewHost.append(frame);
  frame.addEventListener('load', () => {
    if (previewTrackId !== track.id) return;
    const command = (func, args = []) => frame.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      'https://www.youtube-nocookie.com'
    );
    window.setTimeout(() => {
      command('playVideo');
      command('setVolume', [15]);
      command('unMute');
    }, 450);
  }, { once: true });
}

function applyFocus(card) {
  musicGallery.classList.add('is-paused', 'is-focused');
  musicGallery.querySelectorAll('.music-card.is-hovered').forEach((item) => item.classList.remove('is-hovered'));
  card?.classList.add('is-hovered');
}

function clearFocus(card) {
  card?.classList.remove('is-hovered');
  if (activeTrackId) return;
  musicGallery.classList.remove('is-paused', 'is-focused');
  stopPreview();
}

function stopProgressTimer() {
  if (progressTimer) window.clearInterval(progressTimer);
  progressTimer = null;
}

function updateProgressUi() {
  if (!activeTrackId || !activeYoutubePlayer?.getCurrentTime) return;
  const current = activeYoutubePlayer.getCurrentTime();
  const duration = activeYoutubePlayer.getDuration();
  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;
  musicGallery.querySelectorAll('.music-card').forEach((card) => {
    if (card.dataset.trackId !== activeTrackId) return;
    card.querySelector('.music-progress-fill')?.style.setProperty('--progress', progress + '%');
    const now = card.querySelector('.music-current-time');
    const total = card.querySelector('.music-duration');
    if (now) now.textContent = formatTime(current);
    if (total) total.textContent = duration ? formatTime(duration) : '--:--';
  });
}

function startProgressTimer() {
  stopProgressTimer();
  updateProgressUi();
  progressTimer = window.setInterval(updateProgressUi, 500);
}

function destroyActivePlayer() {
  stopProgressTimer();
  activeYoutubePlayer?.destroy?.();
  activeYoutubePlayer = null;
}

function stopPlayer() {
  destroyActivePlayer();
  activeTrackId = null;
  musicPlayerDock.hidden = true;
  musicPlayerDock.replaceChildren();
  musicGallery.classList.remove('is-paused', 'is-focused');
  renderTracks();
}

function mountYoutubePlayer(host, track) {
  if (!window.YT?.Player || activeTrackId !== track.id) return;
  activeYoutubePlayer = new window.YT.Player(host, {
    videoId: track.providerId,
    playerVars: { autoplay: 1, playsinline: 1, rel: 0, origin: window.location.origin },
    events: {
      onReady: ({ target }) => { if (activeTrackId === track.id) target.playVideo(); },
      onStateChange: ({ data }) => {
        if (activeTrackId !== track.id) return;
        if (data === window.YT.PlayerState.PLAYING) startProgressTimer();
        if (data === window.YT.PlayerState.PAUSED || data === window.YT.PlayerState.ENDED) {
          stopProgressTimer();
          updateProgressUi();
        }
      }
    }
  });
}

function openPlayer(track) {
  stopPreview();
  destroyActivePlayer();
  activeTrackId = track.id;
  musicGallery.classList.add('is-paused', 'is-focused');
  const meta = document.createElement('div');
  meta.className = 'music-player-meta';
  meta.innerHTML = '<div><strong>' + escapeHtml(track.title) + '</strong><span>YouTube</span></div><button class="music-player-close" type="button">إيقاف</button>';
  const host = document.createElement('div');
  host.className = 'music-youtube-host';
  host.id = 'youtube-player-' + track.id;
  musicPlayerDock.replaceChildren(meta, host);
  musicPlayerDock.hidden = false;
  renderTracks();
  if (window.YT?.Player) mountYoutubePlayer(host, track);
  else youtubeReady.then(() => mountYoutubePlayer(host, track));
}

function upsertTrack(track) {
  if (track.provider !== 'youtube') return;
  tracks = [track, ...tracks.filter((item) => item.id !== track.id)].sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
  renderTracks();
}

function removeTrack(id) {
  if (activeTrackId === id) stopPlayer();
  tracks = tracks.filter((track) => track.id !== id);
  renderTracks();
}

async function deleteTrack(id) {
  const response = await fetch('/api/music/tracks/' + encodeURIComponent(id), { method: 'DELETE' });
  const data = await response.json();
  if (!response.ok) return window.alert(data.error || 'تعذر حذف الأغنية.');
  removeTrack(data.id);
}

async function submitTrack(event) {
  event.preventDefault();
  if (!selectedVideo) return showFormNotice('ابحث عن أغنية واخترها أولاً.');
  showFormNotice();
  musicSubmit.disabled = true;
  musicSubmit.textContent = 'جارٍ إضافة الأغنية...';
  try {
    const response = await fetch('/api/music/tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: selectedVideo.videoId, comment: musicComment.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر إضافة الأغنية.');
    upsertTrack(data.track);
    musicComment.value = '';
    setSelectedVideo(null);
  } catch (error) {
    showFormNotice(error.message || 'تعذر إضافة الأغنية.');
  } finally {
    if (!selectedVideo) return;
    musicSubmit.disabled = false;
    musicSubmit.innerHTML = '<span aria-hidden="true">+</span> أضف الأغنية';
  }
}

function renderAccount() {
  if (!currentUser) return;
  const avatar = avatarUrl(currentUser);
  const avatarMarkup = avatar ? '<img class="account-avatar" src="' + avatar + '" alt="" />' : '<span class="account-avatar"></span>';
  musicAccount.innerHTML = '<span class="account-name">' + avatarMarkup + '<span>' + escapeHtml(currentUser.global_name || currentUser.username) + '</span></span>'
    + '<button id="music-logout" class="logout-button" type="button">تسجيل الخروج</button>';
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
    tracks = Array.isArray(data.tracks) ? data.tracks.filter((track) => track.provider === 'youtube') : [];
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

musicSearchForm.addEventListener('submit', searchVideos);
musicSearchResults.addEventListener('click', (event) => {
  const button = event.target.closest('[data-video-id]');
  if (!button) return;
  const result = searchResults.find((item) => item.videoId === button.dataset.videoId);
  if (!result) return;
  setSelectedVideo(result);
  musicSearchResults.hidden = true;
});
musicSelected.addEventListener('click', (event) => {
  if (event.target.closest('[data-clear-selection]')) setSelectedVideo(null);
});
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
  window.setTimeout(() => { if (!musicGallery.contains(document.activeElement)) clearFocus(); }, 0);
});

Promise.all([loadSession(), loadTracks()]).finally(initializeRealtime);
