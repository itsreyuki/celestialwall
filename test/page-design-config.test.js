const test = require('node:test');
const assert = require('node:assert/strict');
const { createDefaultPageConfiguration, validatePageConfiguration } = require('../services/page-config');

test('design configuration accepts background media, avatar, banner, and typography presets', () => {
  const configuration = createDefaultPageConfiguration();
  configuration.background = {
    type: 'video',
    color: '#100d1d',
    gradient: { from: '#100d1d', to: '#42266f', angle: 135 },
    asset: { url: 'https://cdn.example.com/background.mp4', position: 'center', fit: 'cover', crop: { x: 50, y: 50 } },
    blur: 3,
    brightness: 0.7,
    overlayColor: '#000000',
    overlayOpacity: 0.35,
    vignette: 0.25,
    grain: 0.08
  };
  configuration.avatar.asset = { url: 'https://cdn.example.com/avatar.webp', position: 'center', fit: 'cover', crop: { x: 45, y: 40 } };
  configuration.banner = { asset: { url: 'https://cdn.example.com/banner.gif', position: 'top', fit: 'cover', crop: { x: 50, y: 25 } }, borderRadius: 18, visible: true };
  configuration.musicPlayer = {
    enabled: true,
    audioUrl: '/uploads/pages/users/test/song.mp3',
    cover: { url: 'https://cdn.example.com/cover.webp', position: 'center', fit: 'cover' },
    title: 'Celestia', artist: 'Lina', loop: true, preset: 'vinyl'
  };
  configuration.entranceScreen.enabled = true;
  configuration.entranceScreen.text = 'Ø§Ø¶ØºØ· Ù„Ù„Ø¯Ø®ÙˆÙ„';
  configuration.cursor = { type: 'default', image: null, trail: 'sparkles', color: '#f5ce6b' };
  configuration.elements.push({
    id: 'intro-text',
    type: 'text',
    position: { x: 50, y: 18 },
    size: { width: 55, height: 12 },
    zIndex: 4,
    visible: true,
    style: { fontFamily: 'Cairo', fontSize: 26, fontWeight: '700', color: '#fff7dc', textAlign: 'center', letterSpacing: 1, lineHeight: 1.4, effect: 'glow' },
    content: 'أهلاً بك'
  });

  assert.equal(validatePageConfiguration(configuration).success, true);
});

test('design configuration rejects unsafe media URLs', () => {
  const configuration = createDefaultPageConfiguration();
  configuration.background.asset = { url: 'javascript:alert(1)', position: 'center', fit: 'cover' };
  assert.equal(validatePageConfiguration(configuration).success, false);
});
