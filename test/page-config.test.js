const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PAGE_LIMITS,
  createDefaultPageConfiguration,
  pageInputSchema,
  validatePageConfiguration
} = require('../services/page-config');

test('the default page configuration is valid', () => {
  const result = validatePageConfiguration(createDefaultPageConfiguration());
  assert.equal(result.success, true);
});

test('configuration rejects unknown properties', () => {
  const config = createDefaultPageConfiguration();
  config.background.untrustedCss = 'body { display: none; }';

  const result = validatePageConfiguration(config);
  assert.equal(result.success, false);
});

test('configuration enforces visual element limits', () => {
  const config = createDefaultPageConfiguration();
  config.elements = Array.from({ length: PAGE_LIMITS.elements + 1 }, (_, index) => ({
    id: `text-${index}`,
    type: 'text',
    position: { x: 50, y: 50 },
    size: { width: 20, height: 10 },
    zIndex: index,
    visible: true,
    style: {},
    content: 'Celestia'
  }));

  const result = validatePageConfiguration(config);
  assert.equal(result.success, false);
});

test('configuration accepts 30 regular elements and limits animated images', () => {
  const config = createDefaultPageConfiguration();
  config.elements = Array.from({ length: PAGE_LIMITS.elements }, (_, index) => ({
    id: `text-${index}`,
    type: 'text',
    position: { x: 50, y: 50 },
    size: { width: 20, height: 10 },
    zIndex: index,
    visible: true,
    style: {},
    content: 'Celestia'
  }));
  assert.equal(validatePageConfiguration(config).success, true);

  config.elements = Array.from({ length: PAGE_LIMITS.animatedElements + 1 }, (_, index) => ({
    id: `image-${index}`,
    type: 'image',
    position: { x: 50, y: 50 },
    size: { width: 20, height: 20 },
    zIndex: index,
    visible: true,
    style: { animation: 'float' },
    assetUrl: '/assets/stickers/star.svg'
  }));
  assert.equal(validatePageConfiguration(config).success, false);
});

test('configuration requires assets for image elements', () => {
  const config = createDefaultPageConfiguration();
  config.elements = [{
    id: 'cover',
    type: 'image',
    position: { x: 50, y: 50 },
    size: { width: 20, height: 20 },
    zIndex: 1,
    visible: true,
    style: {}
  }];

  const result = validatePageConfiguration(config);
  assert.equal(result.success, false);
});

test('configuration accepts bounded widgets and validates tab links', () => {
  const config = createDefaultPageConfiguration();
  config.tabs = [{ id: 'home', label: 'Home', transition: 'fade', visible: true }, { id: 'gallery', label: 'Gallery', transition: 'slide', visible: true }];
  config.elements.push({
    id: 'quote-widget', type: 'widget', widget: 'quote', widgetData: { kind: 'quote', text: 'Celestia', author: 'Lina' },
    position: { x: 50, y: 20 }, size: { width: 40, height: 16 }, zIndex: 2, visible: true, style: {}, tabId: 'home'
  }, {
    id: 'gallery-widget', type: 'widget', widget: 'gallery', widgetData: { kind: 'gallery', layout: 'masonry', items: [{ id: 'gallery-item', image: { url: '/assets/stickers/star.svg', position: 'center', fit: 'cover' }, caption: 'Star' }] },
    position: { x: 50, y: 75 }, size: { width: 55, height: 24 }, zIndex: 3, visible: true, style: {}, tabId: 'gallery'
  });
  assert.equal(validatePageConfiguration(config).success, true);
  config.elements[1].tabId = 'missing';
  assert.equal(validatePageConfiguration(config).success, false);
});

test('configuration accepts partial mobile overrides without duplicating element config', () => {
  const config = createDefaultPageConfiguration();
  config.elements = [{
    id: 'mobile-text', type: 'text', position: { x: 50, y: 50 }, size: { width: 40, height: 10 },
    zIndex: 2, visible: true, style: {}, content: 'Celestia',
    mobileOverrides: { hideOnMobile: true, mobileWidth: 80, mobileScale: 0.9, mobileAlignment: 'center' }
  }];
  assert.equal(validatePageConfiguration(config).success, true);
});

test('mobile overrides reject invalid values', () => {
  const config = createDefaultPageConfiguration();
  config.elements[0].mobileOverrides = { mobileWidth: 0, mobileScale: 3 };
  assert.equal(validatePageConfiguration(config).success, false);
});

test('page input protects reserved and malformed slugs', () => {
  const base = {
    displayName: 'Celestia',
    configuration: createDefaultPageConfiguration()
  };

  assert.equal(pageInputSchema.safeParse({ ...base, slug: 'api' }).success, false);
  assert.equal(pageInputSchema.safeParse({ ...base, slug: 'Not Valid' }).success, false);
  assert.equal(pageInputSchema.safeParse({ ...base, slug: 'celestia-user' }).success, true);
});

test('social links validate display choices and safe link protocols', () => {
  const configuration = createDefaultPageConfiguration();
  configuration.socialLinks = [
    { id: 'discord-link', label: 'Discord', url: 'https://discord.gg/celes', icon: 'discord', display: 'icon', visible: true },
    { id: 'email-link', label: 'Email', url: 'mailto:hello@example.com', icon: 'email', display: 'both', visible: true },
    { id: 'phone-link', label: 'Phone', url: 'tel:+1234567890', icon: 'phone', display: 'text', visible: true }
  ];
  assert.equal(validatePageConfiguration(configuration).success, true);
  configuration.socialLinks[0].url = 'javascript:alert(1)';
  assert.equal(validatePageConfiguration(configuration).success, false);
});

test('social link elements can persist isolated links', () => {
  const configuration = createDefaultPageConfiguration();
  configuration.elements.push({
    id: 'isolated-links', type: 'social-links', position: { x: 50, y: 75 }, size: { width: 48, height: 10 },
    zIndex: 2, visible: true, style: { color: '#f5ce6b' },
    links: [{ id: 'isolated-link', label: 'Discord', url: 'https://discord.gg/celes', icon: 'discord', display: 'both', visible: true }]
  });
  assert.equal(validatePageConfiguration(configuration).success, true);
  configuration.elements[1].links[0].url = 'javascript:alert(1)';
  assert.equal(validatePageConfiguration(configuration).success, false);
});
