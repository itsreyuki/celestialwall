const loginSection = document.querySelector('#pages-login');
const dashboard = document.querySelector('#pages-dashboard');
const createForm = document.querySelector('#page-create-form');
const slugInput = document.querySelector('#page-slug');
const slugStatus = document.querySelector('#slug-status');
const panel = document.querySelector('#page-panel');
const detailsForm = document.querySelector('#page-details-form');
const displayNameInput = document.querySelector('#page-display-name');
const bioInput = document.querySelector('#page-bio');
const reactionsEnabledInput = document.querySelector('#page-reactions-enabled');
const remixEnabledInput = document.querySelector('#page-remix-enabled');
const pageState = document.querySelector('#page-state');
const pageUrl = document.querySelector('#page-url');
const pageViews = document.querySelector('#page-views');
const publishButton = document.querySelector('#page-publish');
const unpublishButton = document.querySelector('#page-unpublish');
const pageNotice = document.querySelector('#page-notice');

let currentPage = null;
let availabilityTimer = null;

function setNotice(target, message = '', type = '') {
  target.textContent = message;
  target.className = `pages-status${type ? ` is-${type}` : ''}`;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'تعذر إتمام الطلب.');
  return body;
}

function renderPage() {
  createForm.hidden = Boolean(currentPage);
  panel.hidden = !currentPage;
  if (!currentPage) return;

  const url = `${window.location.origin}/${currentPage.slug}`;
  pageUrl.href = url;
  pageUrl.textContent = url.replace(/^https?:\/\//, '');
  pageViews.textContent = `${currentPage.viewsCount || 0} مشاهدة`;
  displayNameInput.value = currentPage.displayName || '';
  bioInput.value = currentPage.bio || '';
  reactionsEnabledInput.checked = Boolean(currentPage.reactionsEnabled);
  remixEnabledInput.checked = Boolean(currentPage.remixEnabled);
  pageState.textContent = currentPage.published ? 'منشورة للعامة' : 'مسودة';
  pageState.classList.toggle('is-published', currentPage.published);
  publishButton.hidden = currentPage.published;
  unpublishButton.hidden = !currentPage.published;
}

async function loadDashboard() {
  const auth = await request('/auth/me');
  if (!auth.authenticated) {
    loginSection.hidden = false;
    return;
  }

  dashboard.hidden = false;
  const data = await request('/api/pages/me');
  currentPage = data.page;
  renderPage();
}

async function checkAvailability() {
  const value = slugInput.value.trim();
  if (!value) return setNotice(slugStatus);
  try {
    const data = await request(`/api/pages/availability/${encodeURIComponent(value)}`);
    if (!data.valid) return setNotice(slugStatus, 'الرابط غير صالح أو محجوز.', 'error');
    return setNotice(slugStatus, data.available ? 'هذا الرابط متاح.' : 'هذا الرابط مستخدم.', data.available ? 'success' : 'error');
  } catch (error) {
    setNotice(slugStatus, error.message, 'error');
  }
}

slugInput.addEventListener('input', () => {
  clearTimeout(availabilityTimer);
  availabilityTimer = setTimeout(checkAvailability, 300);
});

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setNotice(slugStatus);
  try {
    const data = await request('/api/pages', { method: 'POST', body: JSON.stringify({ slug: slugInput.value.trim() }) });
    currentPage = data.page;
    setNotice(pageNotice, 'تم إنشاء المسودة.', 'success');
    renderPage();
  } catch (error) {
    setNotice(slugStatus, error.message, 'error');
  }
});

detailsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await request('/api/pages/me', { method: 'PATCH', body: JSON.stringify({ displayName: displayNameInput.value, bio: bioInput.value, reactionsEnabled: reactionsEnabledInput.checked, remixEnabled: remixEnabledInput.checked }) });
    currentPage = data.page;
    renderPage();
    setNotice(pageNotice, 'تم حفظ التعديلات.', 'success');
  } catch (error) {
    setNotice(pageNotice, error.message, 'error');
  }
});

publishButton.addEventListener('click', async () => {
  try {
    const data = await request('/api/pages/me/publish', { method: 'POST', body: '{}' });
    currentPage = data.page;
    renderPage();
    setNotice(pageNotice, 'صفحتك منشورة الآن.', 'success');
  } catch (error) {
    setNotice(pageNotice, error.message, 'error');
  }
});

unpublishButton.addEventListener('click', async () => {
  try {
    const data = await request('/api/pages/me/unpublish', { method: 'POST', body: '{}' });
    currentPage = data.page;
    renderPage();
    setNotice(pageNotice, 'أصبحت الصفحة مسودة وغير عامة.', 'success');
  } catch (error) {
    setNotice(pageNotice, error.message, 'error');
  }
});

loadDashboard().catch((error) => {
  loginSection.hidden = false;
  setNotice(pageNotice, error.message, 'error');
});
