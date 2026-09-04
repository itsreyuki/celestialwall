const test = require('node:test');
const assert = require('node:assert/strict');
const { DESIGN_VIEWPORTS, resolveElementLayout, elementVisualScale, contentVisualScale, fitDesignViewport } = require('../public/page-responsive');

test('responsive layout preserves desktop values when no mobile override exists', () => {
  const element = { position: { x: 25, y: 30 }, size: { width: 40, height: 20 }, visible: true };
  assert.deepEqual(resolveElementLayout(element, true), { position: element.position, size: element.size, scale: 1, visible: true, alignment: null });
});

test('responsive layout applies only partial mobile values', () => {
  const element = {
    position: { x: 25, y: 30 }, size: { width: 40, height: 20 }, visible: true,
    mobileOverrides: { mobilePosition: { x: 50, y: 60 }, mobileWidth: 24, mobileScale: 0.8, hideOnMobile: true }
  };
  const layout = resolveElementLayout(element, true);
  assert.deepEqual(layout.position, { x: 50, y: 60 });
  assert.deepEqual(layout.size, { width: 24, height: 20 });
  assert.equal(layout.scale, 0.8);
  assert.equal(layout.visible, false);
});

test('visual content scale follows both element dimensions', () => {
  const element = { type: 'widget', position: { x: 50, y: 50 }, size: { width: 38, height: 16 }, visible: true, widgetData: { kind: 'quote' } };
  assert.equal(elementVisualScale(element, false), 1);
  element.size = { width: 76, height: 32 };
  assert.equal(elementVisualScale(element, false), 2);
  element.size = { width: 76, height: 16 };
  assert.equal(Math.round(elementVisualScale(element, false) * 1000) / 1000, 1.414);
});

test('content-heavy elements stop scaling and use extra room for content', () => {
  const games = { type: 'widget', position: { x: 50, y: 50 }, size: { width: 152, height: 64 }, visible: true, widgetData: { kind: 'games' } };
  const guestbook = { ...games, widgetData: { kind: 'guestbook' } };
  const image = { ...games, type: 'image', widgetData: undefined };
  assert.equal(contentVisualScale(games, false), 1.08);
  assert.equal(contentVisualScale(guestbook, false), 1.05);
  assert.equal(contentVisualScale(image, false), 4);
});

test('published page keeps the exact editor aspect ratio on wider screens', () => {
  const fitted = fitDesignViewport(1920, 900, false);
  assert.deepEqual(DESIGN_VIEWPORTS.desktop, { width: 920, height: 575 });
  assert.equal(fitted.renderedHeight, 900);
  assert.equal(fitted.renderedWidth, 1440);
  assert.equal(fitted.renderedWidth / fitted.renderedHeight, 920 / 575);
});

test('mobile pages use the same 360 by 640 editor viewport', () => {
  const fitted = fitDesignViewport(375, 812, true);
  assert.deepEqual(DESIGN_VIEWPORTS.mobile, { width: 360, height: 640 });
  assert.equal(Math.round(fitted.renderedWidth), 375);
  assert.equal(Math.round(fitted.renderedHeight), 667);
});
