const test = require('node:test');
const assert = require('node:assert/strict');
const { createDefaultPageConfiguration, validatePageConfiguration } = require('../services/page-config');
const { THEMES, applyTheme, createRemixConfiguration } = require('../services/page-themes');

test('built-in themes create valid full and style-only configurations', () => {
  assert.equal(THEMES.length, 10);
  const current = createDefaultPageConfiguration();
  current.elements.push({ id: 'personal-image', type: 'image', position: { x: 40, y: 40 }, size: { width: 20, height: 20 }, zIndex: 2, visible: true, style: {}, assetUrl: '/uploads/pages/users/demo/private.png' });
  const styled = applyTheme(current, 'cyber', 'style');
  assert.equal(styled.elements.length, current.elements.length);
  const full = applyTheme(current, 'sakura', 'full');
  assert.equal(full.socialLinks.length, 0);
  assert.equal(validatePageConfiguration(full).success, true);
});

test('remix strips personal media, links, music, gallery, and guestbook content', () => {
  const source = createDefaultPageConfiguration();
  source.background = { ...source.background, type: 'image', asset: { url: '/uploads/pages/users/demo/private.png', position: 'center', fit: 'cover' } };
  source.avatar.asset = { url: '/uploads/pages/users/demo/avatar.png', position: 'center', fit: 'cover' };
  source.socialLinks = [{ id: 'link', label: 'Private', url: 'https://example.com', visible: true }];
  source.musicPlayer = { ...source.musicPlayer, enabled: true, audioUrl: '/uploads/pages/users/demo/song.mp3', title: 'Private track' };
  source.elements.push({ id: 'image', type: 'image', position: { x: 50, y: 20 }, size: { width: 20, height: 20 }, zIndex: 2, visible: true, style: {}, assetUrl: '/uploads/pages/users/demo/private.png' }, { id: 'book', type: 'widget', widget: 'guestbook', widgetData: { kind: 'guestbook', text: 'Private guestbook' }, position: { x: 50, y: 70 }, size: { width: 40, height: 20 }, zIndex: 3, visible: true, style: {} });
  const remix = createRemixConfiguration(source);
  assert.equal(remix.avatar.asset, null);
  assert.equal(remix.socialLinks.length, 0);
  assert.equal(remix.musicPlayer.audioUrl, null);
  assert.equal(remix.elements.some((element) => element.widget === 'guestbook'), false);
  assert.equal(remix.elements.find((element) => element.id === 'image').assetUrl, 'https://celes.lol/assets/logo.png');
  assert.equal(validatePageConfiguration(remix).success, true);
});
