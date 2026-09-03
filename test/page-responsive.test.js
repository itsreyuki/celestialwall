const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveElementLayout, elementVisualScale } = require('../public/page-responsive');

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
