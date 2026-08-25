const musicGallery = document.querySelector('#music-gallery');
const musicCount = document.querySelector('#music-count');
const musicComposer = document.querySelector('#music-composer');
const musicMemberGate = document.querySelector('#music-member-gate');
const musicInvite = document.querySelector('#music-invite');
const musicForm = document.querySelector('#music-form');
const musicTitle = document.querySelector('#music-title');
const musicComment = document.querySelector('#music-comment');
const musicMedia = document.querySelector('#music-media');
const musicPoster = document.querySelector('#music-poster');
const musicSubmit = document.querySelector('#music-submit');
const musicFormNotice = document.querySelector('#music-form-notice');
const musicAccount = document.querySelector('#music-account');
const musicLogin = document.querySelector('#music-login');
const musicPlayerDock = document.querySelector('#music-player-dock');

let tracks = [];
let currentUser = null;
let activeTrackId = null;
let activeAudio = null;
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
  const active = activeTrackId === track.id ? ' is-playing' : '';
  return '<article class="music-card provider-local' + active + '" data-track-id="' + escapeHtml(track.id) + '" tabindex="0">'
    + '<div class="music-art">' + image + '<span class="music-provider">CELESTIAL</span>'
    + '<button class="music-play-circle" type="button" data-play-track="' + escapeHtml(track.id) + '" aria-label="تشغيل ' + escapeHtml(track.title) + '"><span>' + (active ? '❚❚' : '▶') + '</span></button></div>'
    + '<div class="music-card-body"><div class="music-card-heading"><div><h3 class="music-card-title" title="' + escapeHtml(track.title) + '">' + escapeHtml(track.title) + '</h3>'
    + '<p class="music-author">أضافها ' + escapeHtml(track.author?.global_name || track.author?.username || 'عضو سيليستيا') + '</p></div>' + remove + '</div>'
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
    musicGallery.innerHTML = '<div class="music-empty">لا توجد أغانٍ بعد — كن أول من يفتح الشباك.</div>';
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

function applyFocus(card) {
  musicGallery.classList.add('is-paused', 'is-focused');
  musicGallery.querySelectorAll('.music-card.is-hovered').forEach((item) => item.classList.remove('is-hovered'));
  card?.classList.add('is-hovered');
}

function clearFocus(card) {
  card?.classList.remove('is-hovered');
  if (activeTrackId) return;
  musicGallery.classList.remove('is-paused', 'is-focused');
}

function updateProgressUi() {
  if (!activeTrackId || !activeAudio) return;
  const duration = Number.isFinite(activeAudio.duration) ? activeAudio.duration : 0;
  const current = activeAudio.currentTime || 0;
  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;
  musicGallery.querySelectorAll('.music-card').forEach((card) => {
    if (card.dataset.trackId !== activeTrackId) return;
    card.querySelector('.music-progress-fill')?.style.setProperty('--progress', progress + '%');
    const now = card.querySelector('.music-current-time');
    const total = card.querySelector('.music-duration');
    if (now) now.textContent = formatTime(current);
    if (total) total.textContent = duration ? formatTime(duration) : '--:--';
  });
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
  musicGallery.classList.remove('is-paused', 'is-focused');
  renderTracks();
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
  activeTrackId = track.id;
  musicGallery.classList.add('is-paused', 'is-focused');
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
  renderTracks();
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
  musicSubmit.disabled = true;
  musicSubmit.textContent = 'جارٍ التحويل والرفع...';
  try {
    const response = await fetch('/api/music/tracks', { method: 'POST', body: new FormData(musicForm) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذّر إضافة الأغنية.');
    upsertTrack(data.track);
    musicForm.reset();
  } catch (error) {
    showFormNotice(error.message || 'تعذّر إضافة الأغنية.');
  } finally {
    musicSubmit.disabled = false;
    musicSubmit.innerHTML = '<span aria-hidden="true">+</span> أضف إلى الشباك';
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
  if (card && musicGallery.contains(card)) applyFocus(card);
});
musicGallery.addEventListener('pointerout', (event) => {
  const card = event.target.closest('.music-card');
  if (card && !card.contains(event.relatedTarget)) clearFocus(card);
});
musicGallery.addEventListener('focusin', (event) => {
  const card = event.target.closest('.music-card');
  if (card) applyFocus(card);
});
musicGallery.addEventListener('focusout', () => {
  window.setTimeout(() => { if (!musicGallery.contains(document.activeElement)) clearFocus(); }, 0);
});

Promise.all([loadSession(), loadTracks()]).finally(initializeRealtime);
