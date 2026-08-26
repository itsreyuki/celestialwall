const musicGallery = document.querySelector('#music-gallery');
const musicCount = document.querySelector('#music-count');
const musicComposer = document.querySelector('#music-composer');
const musicOpenComposer = document.querySelector('#music-open-composer');
const musicCloseComposer = document.querySelector('#music-close-composer');
const musicMemberGate = document.querySelector('#music-member-gate');
const musicInvite = document.querySelector('#music-invite');
const musicForm = document.querySelector('#music-form');
const musicTitle = document.querySelector('#music-title');
const musicComment = document.querySelector('#music-comment');
const musicMedia = document.querySelector('#music-media');
const musicPoster = document.querySelector('#music-poster');
const musicSubmit = document.querySelector('#music-submit');
const musicFormNotice = document.querySelector('#music-form-notice');
const musicUploadProgress = document.querySelector('#music-upload-progress');
const musicUploadStatus = document.querySelector('#music-upload-status');
const musicUploadPercent = document.querySelector('#music-upload-percent');
const musicUploadProgressFill = document.querySelector('#music-upload-progress-fill');
const musicAccount = document.querySelector('#music-account');
const musicLogin = document.querySelector('#music-login');
const musicPlayerDock = document.querySelector('#music-player-dock');

let tracks = [];
let currentUser = null;
let activeTrackId = null;
let activeAudio = null;
let previewTrackId = null;
let previewAudio = null;
let previewEchoAudio = null;
let previewEnabled = true;
let musicSocket = null;

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function avatarUrl(user) {
  if (!user?.avatar || !user?.id) return '';
  return 'https://cdn.discordapp.com/avatars/' + encodeURIComponent(user.id) + '/' + encodeURIComponent(user.avatar) + '.png?size=64';
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
  const image = track.artworkUrl ? '<img src="' + escapeHtml(track.artworkUrl) + '" alt="غلاف ' + escapeHtml(track.title) + '" loading="lazy" />' : '';
  const remove = isOwner(track) ? '<button class="music-delete" type="button" data-delete-track="' + escapeHtml(track.id) + '">حذف</button>' : '';
  const comment = track.comment ? '<p class="music-comment">' + escapeHtml(track.comment) + '</p>' : '';
  return '<article class="music-card provider-local" data-track-id="' + escapeHtml(track.id) + '" tabindex="0">'
    + '<div class="music-art">' + image + '<span class="music-provider">CELESTIAL</span>'
    + '<button class="music-play-circle" type="button" data-play-track="' + escapeHtml(track.id) + '" aria-label="تشغيل ' + escapeHtml(track.title) + '"><span>▶</span></button></div>'
    + '<div class="music-card-body"><div class="music-card-heading"><div><h3 class="music-card-title" title="' + escapeHtml(track.title) + '">' + escapeHtml(track.title) + '</h3>'
    + '<p class="music-author">أضافها ' + escapeHtml(track.author?.global_name || track.author?.username || 'عضو سيليستيا') + '</p></div>' + remove + '</div>'
    + comment + '<div class="music-progress" aria-label="تقدم التشغيل"><span class="music-progress-fill"></span></div>'
    + '<div class="music-time-row"><span class="music-current-time">0:00</span><span class="music-duration">--:--</span></div></div></article>';
}

function renderRow(items, reverse = false) {
  if (!items.length) return '';
  const groupWidth = Math.max(1, items.length) * 288;
  const repeats = Math.max(8, Math.ceil((window.innerWidth * 2) / groupWidth) * 2);
  const cards = Array.from({ length: repeats }, () => items).flat().map(cardMarkup).join('');
  return '<div class="music-row' + (reverse ? ' music-row-reverse' : '') + '"><div class="music-row-track">' + cards + '</div></div>';
}

function renderTracks() {
  musicCount.textContent = tracks.length + ' أغنية';
  if (!tracks.length) {
    musicGallery.classList.remove('is-paused', 'is-focused');
    musicGallery.innerHTML = '<div class="music-empty">لا توجد أغانٍ بعد — كن أول من يفتح الشباك.</div>';
    return;
  }
  const firstRow = tracks.filter((_, index) => index % 2 === 0);
  const secondRow = tracks.filter((_, index) => index % 2 === 1);
  musicGallery.innerHTML = renderRow(firstRow) + renderRow(secondRow.length ? secondRow : firstRow, true);
  musicGallery.querySelectorAll('.music-art img').forEach((image) => image.addEventListener('error', () => image.classList.add('broken'), { once: true }));
  updateProgressUi();
}

function showFormNotice(message = '') {
  musicFormNotice.textContent = message;
  musicFormNotice.hidden = !message;
}

function setUploadProgress(percent, status) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  musicUploadProgress.hidden = false;
  musicUploadProgressFill.style.width = value + '%';
  musicUploadPercent.textContent = Math.round(value) + '%';
  if (status) musicUploadStatus.textContent = status;
}

function uploadTrack(formData) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/music/tracks');
    request.responseType = 'json';
    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      // Leave a little space while the server converts the upload and saves it.
      const percent = Math.min(90, (event.loaded / event.total) * 90);
      setUploadProgress(percent, 'جارٍ رفع الملف...');
    });
    request.upload.addEventListener('load', () => setUploadProgress(92, 'تم الرفع، جارٍ تحويل الصوت وحفظه...'));
    request.addEventListener('load', () => {
      const data = request.response || (() => {
        try { return JSON.parse(request.responseText); } catch { return {}; }
      })();
      if (request.status >= 200 && request.status < 300) {
        setUploadProgress(100, 'اكتمل الحفظ.');
        return resolve(data);
      }
      return reject(new Error(data?.error || 'تعذّر إضافة الأغنية.'));
    });
    request.addEventListener('error', () => reject(new Error('تعذّر الاتصال بالخادم أثناء رفع الملف.')));
    request.send(formData);
  });
}

function applyFocus(card) {
  musicGallery.classList.add('is-paused', 'is-focused');
  musicGallery.querySelectorAll('.music-card.is-hovered').forEach((item) => item.classList.remove('is-hovered'));
  card?.classList.add('is-hovered');
}

function stopPreview() {
  previewAudio?.pause();
  previewEchoAudio?.pause();
  previewAudio = null;
  previewEchoAudio = null;
  previewTrackId = null;
}

function unlockPreviewAudio() {
  previewEnabled = true;
}

// Hover alone cannot start audio in modern browsers. A normal click or touch unlocks
// previews once, then native audio elements can play quietly on later hovers.
document.addEventListener('pointerdown', unlockPreviewAudio, { passive: true });
document.addEventListener('keydown', unlockPreviewAudio, { passive: true });

function startPreview(track) {
  if (!previewEnabled || !track || previewTrackId === track.id || (activeAudio && !activeAudio.paused)) return;
  stopPreview();
  previewTrackId = track.id;
  previewAudio = new Audio(track.sourceUrl);
  previewEchoAudio = new Audio(track.sourceUrl);
  previewAudio.preload = 'metadata';
  previewEchoAudio.preload = 'metadata';
  previewAudio.volume = 0.22;
  previewEchoAudio.volume = 0.07;
  previewAudio.addEventListener('ended', stopPreview, { once: true });
  const playFromMiddle = () => {
    if (previewTrackId !== track.id || !previewAudio) return;
    const duration = Number.isFinite(previewAudio.duration) ? previewAudio.duration : 0;
    const middle = duration > 2 ? Math.min(duration - 1, duration * 0.5) : 0;
    previewAudio.currentTime = middle;
    if (previewEchoAudio) {
      previewEchoAudio.currentTime = duration > 2 ? Math.min(duration - 0.1, middle + 0.16) : 0;
    }
    // A second, softly delayed native player creates a reliable echo effect.
    Promise.all([previewAudio.play(), previewEchoAudio?.play()])
      .catch(stopPreview);
  };
  if (previewAudio.readyState >= 1) playFromMiddle();
  else previewAudio.addEventListener('loadedmetadata', playFromMiddle, { once: true });
}

function clearFocus(card) {
  card?.classList.remove('is-hovered');
  musicGallery.classList.remove('is-paused', 'is-focused');
  stopPreview();
}

function updateProgressUi() {
  if (!activeTrackId || !activeAudio) return;
  const duration = Number.isFinite(activeAudio.duration) ? activeAudio.duration : 0;
  const current = activeAudio.currentTime || 0;
  const range = musicPlayerDock.querySelector('.music-player-seek');
  const now = musicPlayerDock.querySelector('.music-player-current');
  const total = musicPlayerDock.querySelector('.music-player-duration');
  if (range) range.value = duration ? String((current / duration) * 100) : '0';
  if (now) now.textContent = formatTime(current);
  if (total) total.textContent = duration ? formatTime(duration) : '--:--';
}

function stopPlayer() {
  activeAudio?.pause();
  activeAudio = null;
  activeTrackId = null;
  musicPlayerDock.hidden = true;
  musicPlayerDock.replaceChildren();
}

function setPlayerButton(isPlaying) {
  const button = musicPlayerDock.querySelector('.music-player-toggle');
  if (button) {
    button.textContent = isPlaying ? '❚❚' : '▶';
    button.setAttribute('aria-label', isPlaying ? 'إيقاف مؤقت' : 'تشغيل');
  }
}

function openPlayer(track) {
  if (activeTrackId === track.id && activeAudio) {
    if (activeAudio.paused) activeAudio.play().catch(() => undefined);
    else activeAudio.pause();
    return;
  }

  activeAudio?.pause();
  stopPreview();
  activeTrackId = track.id;
  const image = track.artworkUrl ? '<img src="' + escapeHtml(track.artworkUrl) + '" alt="" />' : '';
  musicPlayerDock.innerHTML = '<div class="music-player-summary"><div class="music-player-art">' + image + '</div><div><strong>' + escapeHtml(track.title) + '</strong><span>أضافها ' + escapeHtml(track.author?.global_name || track.author?.username || 'عضو سيليستيا') + '</span></div></div>'
    + '<div class="music-player-controls"><button class="music-player-toggle" type="button" aria-label="إيقاف مؤقت">❚❚</button><div class="music-player-timeline"><input class="music-player-seek" type="range" min="0" max="100" value="0" step="0.1" aria-label="تقدم الأغنية" /><div><span class="music-player-current">0:00</span><span class="music-player-duration">--:--</span></div></div><button class="music-player-close" type="button">إيقاف</button></div>';
  musicPlayerDock.hidden = false;
  activeAudio = new Audio(track.sourceUrl);
  activeAudio.preload = 'metadata';
  activeAudio.addEventListener('timeupdate', updateProgressUi);
  activeAudio.addEventListener('loadedmetadata', updateProgressUi);
  activeAudio.addEventListener('play', () => { setPlayerButton(true); updateProgressUi(); });
  activeAudio.addEventListener('pause', () => { setPlayerButton(false); updateProgressUi(); });
  activeAudio.addEventListener('ended', () => stopPlayer());
  activeAudio.addEventListener('error', () => showFormNotice('تعذّر تشغيل هذا الملف.'));
  activeAudio.play().catch(() => setPlayerButton(false));
}

function upsertTrack(track) {
  if (track.provider !== 'local') return;
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
  if (!response.ok) return window.alert(data.error || 'تعذّر حذف الأغنية.');
  removeTrack(data.id);
}

async function submitTrack(event) {
  event.preventDefault();
  if (!musicTitle.value.trim() || !musicMedia.files[0] || !musicPoster.files[0]) {
    return showFormNotice('اسم الأغنية وملفها وغلافها حقول مطلوبة.');
  }
  showFormNotice();
  setUploadProgress(0, 'جارٍ تجهيز الملف...');
  musicSubmit.disabled = true;
  musicSubmit.textContent = 'جارٍ التحويل والرفع...';
  try {
    const data = await uploadTrack(new FormData(musicForm));
    upsertTrack(data.track);
    musicForm.reset();
    setComposerOpen(false);
  } catch (error) {
    showFormNotice(error.message || 'تعذّر إضافة الأغنية.');
  } finally {
    musicSubmit.disabled = false;
    musicSubmit.innerHTML = '<span aria-hidden="true">+</span> أضف إلى الشباك';
    window.setTimeout(() => { musicUploadProgress.hidden = true; }, 900);
  }
}

function setComposerOpen(isOpen) {
  if (!currentUser?.isMember) return;
  musicComposer.hidden = !isOpen;
  musicOpenComposer.hidden = false;
  musicOpenComposer.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) {
    window.setTimeout(() => musicComposer.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
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
    musicComposer.hidden = true;
    musicOpenComposer.hidden = !currentUser?.isMember;
    musicMemberGate.hidden = Boolean(currentUser?.isMember);
    musicInvite.href = data.inviteUrl || 'https://discord.gg/celes';
  } catch {
    musicComposer.hidden = true;
    musicOpenComposer.hidden = true;
    musicMemberGate.hidden = false;
  }
}

async function loadTracks() {
  try {
    const response = await fetch('/api/music/tracks');
    const data = await response.json();
    tracks = Array.isArray(data.tracks) ? data.tracks.filter((track) => track.provider === 'local') : [];
    renderTracks();
  } catch {
    musicGallery.innerHTML = '<div class="music-empty">تعذّر تحميل الأغاني حالياً. حاول تحديث الصفحة.</div>';
  }
}

function initializeRealtime() {
  if (typeof window.io !== 'function') return;
  musicSocket = window.io('/music', { withCredentials: true });
  musicSocket.on('music:track-added', ({ track }) => track && upsertTrack(track));
  musicSocket.on('music:track-removed', ({ id }) => id && removeTrack(id));
}

musicForm.addEventListener('submit', submitTrack);
musicOpenComposer.addEventListener('click', () => setComposerOpen(true));
musicCloseComposer.addEventListener('click', () => setComposerOpen(false));
musicPlayerDock.addEventListener('click', (event) => {
  if (event.target.closest('.music-player-close')) return stopPlayer();
  if (event.target.closest('.music-player-toggle')) {
    if (activeAudio?.paused) activeAudio.play().catch(() => undefined);
    else activeAudio?.pause();
  }
});
musicPlayerDock.addEventListener('input', (event) => {
  if (!event.target.matches('.music-player-seek') || !activeAudio || !Number.isFinite(activeAudio.duration)) return;
  activeAudio.currentTime = (Number(event.target.value) / 100) * activeAudio.duration;
  updateProgressUi();
});
musicGallery.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete-track]');
  if (deleteButton) return deleteTrack(deleteButton.dataset.deleteTrack);
  const playButton = event.target.closest('[data-play-track]');
  if (!playButton) return;
  const track = trackById(playButton.dataset.playTrack);
  if (track) openPlayer(track);
});
musicGallery.addEventListener('pointerover', (event) => {
  const card = event.target.closest('.music-card');
  if (card && musicGallery.contains(card)) {
    applyFocus(card);
    startPreview(trackById(card.dataset.trackId));
  }
});
musicGallery.addEventListener('pointerout', (event) => {
  const card = event.target.closest('.music-card');
  if (card && !card.contains(event.relatedTarget)) clearFocus(card);
});
musicGallery.addEventListener('focusin', (event) => {
  const card = event.target.closest('.music-card');
  if (card) {
    applyFocus(card);
    startPreview(trackById(card.dataset.trackId));
  }
});
musicGallery.addEventListener('focusout', () => {
  window.setTimeout(() => { if (!musicGallery.contains(document.activeElement)) clearFocus(); }, 0);
});

let galleryResizeTimer = null;
window.addEventListener('resize', () => {
  window.clearTimeout(galleryResizeTimer);
  galleryResizeTimer = window.setTimeout(renderTracks, 180);
}, { passive: true });

Promise.all([loadSession(), loadTracks()]).finally(initializeRealtime);
