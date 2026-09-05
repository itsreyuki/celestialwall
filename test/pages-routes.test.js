const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const pagesRouter = require('../routes/pages');

function userHeader(id) {
  return JSON.stringify({ id, username: `user-${id}`, global_name: `User ${id}` });
}

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const value = req.get('x-test-user');
    req.session = value ? { user: JSON.parse(value) } : {};
    next();
  });
  app.use('/api/pages', pagesRouter);
  app.use((error, req, res, next) => {
    res.status(500).json({ error: error.message });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    request: async (path, options = {}, userId = null) => {
      const { form, ...fetchOptions } = options;
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        ...fetchOptions,
        headers: {
          ...(fetchOptions.body && !form ? { 'Content-Type': 'application/json' } : {}),
          ...(userId ? { 'x-test-user': userHeader(userId) } : {}),
          ...(fetchOptions.headers || {})
        }
      });
      return { response, body: await response.json() };
    }
  };
}

test('Celestia Pages protects slugs, drafts, and ownership', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const ownerId = `owner-${suffix}`;
  const otherId = `other-${suffix}`;
  const invalidId = `invalid-${suffix}`;
  const slug = `page-${suffix}`;

  let result = await server.request('/api/pages', { method: 'POST', body: JSON.stringify({ slug }) });
  assert.equal(result.response.status, 401);

  result = await server.request('/api/pages/availability/api');
  assert.deepEqual(result.body, { valid: false, available: false, reason: 'invalid' });

  result = await server.request('/api/pages/availability/not_valid');
  assert.deepEqual(result.body, { valid: false, available: false, reason: 'invalid' });

  result = await server.request('/api/pages', { method: 'POST', body: JSON.stringify({ slug: 'bad_slug' }) }, invalidId);
  assert.equal(result.response.status, 400);

  result = await server.request('/api/pages', { method: 'POST', body: JSON.stringify({ slug }) }, ownerId);
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.page.slug, slug);
  assert.equal(result.body.page.published, false);
  const ownerPage = result.body.page;

  const upload = new FormData();
  upload.append('purpose', 'background');
  upload.append('asset', new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'background.png');
  result = await server.request('/api/pages/assets', { method: 'POST', body: upload, form: true }, ownerId);
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  assert.match(result.body.asset.url, /^\/uploads\/pages\//);

  const invalidUpload = new FormData();
  invalidUpload.append('purpose', 'background');
  invalidUpload.append('asset', new Blob([Buffer.from('not-a-png')], { type: 'image/png' }), 'invalid.png');
  result = await server.request('/api/pages/assets', { method: 'POST', body: invalidUpload, form: true }, ownerId);
  assert.equal(result.response.status, 400);

  const audioUpload = new FormData();
  audioUpload.append('purpose', 'music-audio');
  audioUpload.append('asset', new Blob([Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0])], { type: 'audio/mpeg' }), 'song.mp3');
  result = await server.request('/api/pages/assets', { method: 'POST', body: audioUpload, form: true }, ownerId);
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  assert.match(result.body.asset.url, /\.mp3$/);

  ownerPage.configuration.background.type = 'image';
  ownerPage.configuration.background.asset = result.body.asset;
  result = await server.request('/api/pages/me', { method: 'PATCH', body: JSON.stringify({ configuration: ownerPage.configuration }) }, ownerId);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.page.configuration.background.asset.url, ownerPage.configuration.background.asset.url);

  result = await server.request(`/api/pages/availability/${slug}`);
  assert.deepEqual(result.body, { valid: true, available: false, slug });

  result = await server.request('/api/pages', { method: 'POST', body: JSON.stringify({ slug }) }, otherId);
  assert.equal(result.response.status, 409);

  result = await server.request('/api/pages/me', { method: 'PATCH', body: JSON.stringify({ displayName: 'Not the owner' }) }, otherId);
  assert.equal(result.response.status, 404);

  result = await server.request(`/api/pages/${slug}`);
  assert.equal(result.response.status, 404);

  result = await server.request('/api/pages/me/publish', { method: 'POST', body: '{}' }, ownerId);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.page.published, true);

  result = await server.request(`/api/pages/${slug}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.page.slug, slug);
  assert.equal(result.body.page.configuration.configVersion, 1);

  result = await server.request('/api/pages/me', { method: 'PATCH', body: JSON.stringify({ remixEnabled: true }) }, ownerId);
  assert.equal(result.response.status, 200);
  const remixSlug = `remix-${suffix}`;
  result = await server.request(`/api/pages/${slug}/remix`, { method: 'POST', body: JSON.stringify({ slug: remixSlug }) }, otherId);
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.page.slug, remixSlug);
  assert.equal(result.body.page.configuration.musicPlayer.audioUrl, null);
  assert.equal(result.body.page.configuration.socialLinks.length, 0);

  result = await server.request(`/api/pages/${slug}/reactions/%E2%9D%A4%EF%B8%8F`, { method: 'POST', body: '{}' });
  assert.equal(result.response.status, 401);
  result = await server.request(`/api/pages/${slug}/reactions/%E2%9D%A4%EF%B8%8F`, { method: 'POST', body: '{}' }, otherId);
  assert.equal(result.body.counts['❤️'], 1);
  result = await server.request(`/api/pages/${slug}/reactions/%E2%9D%A4%EF%B8%8F`, { method: 'POST', body: '{}' }, otherId);
  assert.equal(result.body.counts['❤️'], 1);
  result = await server.request(`/api/pages/${slug}/reactions/%E2%9D%A4%EF%B8%8F`, { method: 'DELETE' }, otherId);
  assert.equal(result.body.counts['❤️'] || 0, 0);

  result = await server.request('/api/pages/me/unpublish', { method: 'POST', body: '{}' }, ownerId);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.page.published, false);

  result = await server.request(`/api/pages/${slug}`);
  assert.equal(result.response.status, 404);
});
