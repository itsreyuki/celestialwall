const { z } = require('zod');

const PAGE_CONFIG_VERSION = 1;
const PAGE_LIMITS = Object.freeze({
  elements: 30,
  images: 24,
  animatedElements: 6,
  socialLinks: 12,
  widgets: 6,
  tabs: 5,
  galleryImages: 12,
  effects: 3,
  textLength: 500,
  bioLength: 500,
  guestbookLength: 500
});

const PAGE_UPLOAD_LIMITS = Object.freeze({
  imageBytes: 8 * 1024 * 1024,
  gifBytes: 4 * 1024 * 1024,
  videoBytes: 25 * 1024 * 1024,
  audioBytes: 15 * 1024 * 1024
});

const PAGE_ASSET_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a'
});

const PAGE_RATE_LIMITS = Object.freeze({
  asset: { max: 20, windowMs: 10 * 60 * 1000 },
  create: { max: 10, windowMs: 10 * 60 * 1000 },
  update: { max: 60, windowMs: 60 * 1000 },
  theme: { max: 20, windowMs: 10 * 60 * 1000 },
  publish: { max: 20, windowMs: 10 * 60 * 1000 },
  reaction: { max: 30, windowMs: 60 * 1000 },
  guestbook: { max: 3, windowMs: 5 * 60 * 1000 },
  guestbookManage: { max: 30, windowMs: 60 * 1000 },
  remix: { max: 5, windowMs: 10 * 60 * 1000 }
});

const SAFE_FONTS = ['Cairo', 'Space Grotesk', 'Arial', 'Georgia', 'Times New Roman', 'Verdana'];
const PAGE_VISIBILITIES = ['public', 'unlisted', 'private'];
const SOCIAL_ICON_IDS = [
  'website', 'link', 'discord', 'instagram', 'x', 'youtube', 'twitch', 'spotify',
  'github', 'tiktok', 'facebook', 'snapchat', 'telegram', 'whatsapp', 'linkedin',
  'steam', 'soundcloud', 'reddit', 'pinterest', 'tumblr', 'kick', 'threads',
  'bluesky', 'mastodon', 'behance', 'dribbble', 'medium', 'devto', 'email', 'phone'
];
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'assets', 'auth', 'dashboard', 'editor', 'explore', 'health',
  'login', 'logout', 'me', 'music', 'pages', 'settings', 'signup', 'uploads',
  'vendor', 'socket.io', 'availability', 'favicon.ico', 'robots.txt', 'sitemap.xml'
]);

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const urlSchema = z.string().trim().max(2048).refine((value) => {
  if (/^\/uploads\/pages\/[a-zA-Z0-9/_-]+\.(jpg|jpeg|png|webp|gif|mp4|webm|mp3|ogg|wav|m4a)$/i.test(value)) return true;
  if (/^\/assets\/stickers\/(star|heart|bow|sparkles|cloud|flower|bubble|wings)\.svg$/i.test(value)) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}, 'Use an HTTPS or server-issued Pages asset URL.');
const socialUrlSchema = z.string().trim().max(2048).refine((value) => {
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)) return true;
  if (/^tel:\+?[0-9()\s-]{3,32}$/.test(value)) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}, 'Use an HTTPS link, mailto email address, or telephone link.');
const colorSchema = z.string().trim().regex(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]{1,80}\)|transparent)$/);
const percentageSchema = z.number().finite().min(0).max(100);
const opacitySchema = z.number().finite().min(0).max(1);
const widgetAssetSchema = z.object({
  url: urlSchema,
  position: z.enum(['center', 'top', 'bottom', 'left', 'right']).default('center'),
  fit: z.enum(['cover', 'contain']).default('cover'),
  crop: z.object({ x: percentageSchema, y: percentageSchema }).strict().optional()
}).strict();
const widgetItemSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(80), image: widgetAssetSchema }).strict();
const galleryItemSchema = z.object({ id: idSchema, image: widgetAssetSchema, caption: z.string().trim().max(160).optional() }).strict();
const widgetDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('quote'), text: z.string().trim().min(1).max(280), author: z.string().trim().max(80) }).strict(),
  z.object({ kind: z.literal('mood'), text: z.string().trim().min(1).max(100), icon: z.string().trim().max(12) }).strict(),
  z.object({ kind: z.literal('characters'), items: z.array(widgetItemSchema).min(1).max(6) }).strict(),
  z.object({ kind: z.literal('games'), items: z.array(widgetItemSchema).min(1).max(6) }).strict(),
  z.object({ kind: z.literal('gallery'), items: z.array(galleryItemSchema).min(1).max(PAGE_LIMITS.galleryImages), layout: z.enum(['grid', 'polaroid', 'masonry']) }).strict(),
  z.object({ kind: z.literal('counter'), label: z.string().trim().min(1).max(40) }).strict(),
  z.object({ kind: z.literal('clock'), format: z.enum(['12h', '24h']), showSeconds: z.boolean() }).strict(),
  z.object({ kind: z.literal('countdown'), title: z.string().trim().min(1).max(80), targetDate: z.string().datetime({ offset: true }), finishedText: z.string().trim().max(80) }).strict(),
  z.object({ kind: z.literal('poll'), question: z.string().trim().min(1).max(180), options: z.array(z.object({ id: idSchema, label: z.string().trim().min(1).max(80) }).strict()).min(2).max(4) }).strict(),
  z.object({ kind: z.literal('guestbook'), text: z.string().trim().min(1).max(180) }).strict()
]);

const positionSchema = z.object({
  x: percentageSchema,
  y: percentageSchema
}).strict();

const sizeSchema = z.object({
  width: z.number().finite().min(1).max(100),
  height: z.number().finite().min(1).max(100)
}).strict();

const mobileOverridesSchema = z.object({
  hideOnMobile: z.boolean().optional(),
  mobilePosition: positionSchema.optional(),
  mobileWidth: z.number().finite().min(1).max(100).optional(),
  mobileHeight: z.number().finite().min(1).max(100).optional(),
  mobileScale: z.number().finite().min(0.5).max(2).optional(),
  mobileAlignment: z.enum(['left', 'center', 'right']).optional(),
  position: positionSchema.optional(),
  size: sizeSchema.optional(),
  visible: z.boolean().optional(),
  fontSize: z.number().finite().min(10).max(80).optional()
}).strict();

const elementStyleSchema = z.object({
  color: colorSchema.optional(),
  backgroundColor: colorSchema.optional(),
  opacity: opacitySchema.optional(),
  borderRadius: z.number().finite().min(0).max(100).optional(),
  rotation: z.number().finite().min(-180).max(180).optional(),
  fontFamily: z.enum(SAFE_FONTS).optional(),
  fontSize: z.number().finite().min(10).max(96).optional(),
  fontWeight: z.enum(['400', '500', '600', '700', '800']).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  letterSpacing: z.number().finite().min(-2).max(16).optional(),
  lineHeight: z.number().finite().min(0.8).max(3).optional(),
  effect: z.enum(['none', 'gradient', 'glow', 'shimmer', 'typewriter', 'wave']).optional(),
  flipX: z.boolean().optional(),
  shadow: z.enum(['none', 'soft', 'strong']).optional(),
  glow: z.boolean().optional(),
  animation: z.enum(['none', 'float', 'pulse', 'gentleRotate', 'fade']).optional()
}).strict();

const pageElementSchema = z.object({
  id: idSchema,
  type: z.enum(['profile-card', 'text', 'social-links', 'image', 'sticker', 'decoration', 'widget', 'music']),
  position: positionSchema,
  size: sizeSchema,
  zIndex: z.number().int().min(0).max(100),
  visible: z.boolean(),
  style: elementStyleSchema,
  mobileOverrides: mobileOverridesSchema.optional(),
  tabId: idSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  content: z.string().max(PAGE_LIMITS.textLength).optional(),
  assetUrl: urlSchema.optional(),
  widget: z.enum(['quote', 'mood', 'characters', 'games', 'gallery', 'counter', 'clock', 'countdown', 'poll', 'guestbook']).optional(),
  widgetData: widgetDataSchema.optional()
}).strict().superRefine((element, context) => {
  if (element.type === 'image' && !element.assetUrl) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Image elements require assetUrl.', path: ['assetUrl'] });
  }
  if (element.type === 'sticker' && !element.assetUrl && !element.content) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Sticker elements require content or assetUrl.', path: ['content'] });
  }
  if (element.type === 'text' && !element.content) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Text elements require content.', path: ['content'] });
  }
  if (element.type === 'widget' && (!element.widget || !element.widgetData || element.widget !== element.widgetData.kind)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Widget elements require matching widget data.', path: ['widgetData'] });
  }
});

const textStyleSchema = z.object({
  fontFamily: z.enum(SAFE_FONTS),
  fontSize: z.number().finite().min(10).max(96),
  fontWeight: z.enum(['400', '500', '600', '700', '800']),
  color: colorSchema,
  textAlign: z.enum(['left', 'center', 'right']),
  letterSpacing: z.number().finite().min(-2).max(16),
  lineHeight: z.number().finite().min(0.8).max(3),
  effect: z.enum(['none', 'gradient', 'glow', 'shimmer', 'typewriter', 'wave'])
}).strict();

const assetSchema = z.object({
  url: urlSchema,
  position: z.enum(['center', 'top', 'bottom', 'left', 'right']).default('center'),
  fit: z.enum(['cover', 'contain']).default('cover'),
  crop: z.object({ x: percentageSchema, y: percentageSchema }).strict().optional()
}).strict();

const socialLinkSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(80),
  url: socialUrlSchema,
  icon: z.enum(SOCIAL_ICON_IDS).default('website'),
  display: z.enum(['text', 'icon', 'both']).default('both'),
  visible: z.boolean().default(true)
}).strict();

const tabSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(40),
  transition: z.enum(['fade', 'slide', 'blur']),
  visible: z.boolean().default(true)
}).strict();

const effectSchema = z.object({
  type: z.enum(['vignette', 'grain', 'glow', 'particles', 'floating-shapes']),
  intensity: z.number().finite().min(0).max(1)
}).strict();

const pageConfigurationSchema = z.object({
  configVersion: z.literal(PAGE_CONFIG_VERSION),
  background: z.object({
    type: z.enum(['solid', 'gradient', 'image', 'gif', 'video']),
    color: colorSchema.optional(),
    gradient: z.object({ from: colorSchema, to: colorSchema, angle: z.number().finite().min(0).max(360) }).strict().optional(),
    asset: assetSchema.optional(),
    blur: z.number().finite().min(0).max(32),
    brightness: z.number().finite().min(0.2).max(1.5),
    overlayColor: colorSchema.optional(),
    overlayOpacity: opacitySchema,
    vignette: opacitySchema,
    grain: opacitySchema
  }).strict(),
  profileCard: z.object({
    backgroundColor: colorSchema,
    opacity: opacitySchema,
    glass: z.boolean(),
    blur: z.number().finite().min(0).max(32),
    borderColor: colorSchema,
    borderWidth: z.number().finite().min(0).max(8),
    borderRadius: z.number().finite().min(0).max(64),
    shadow: z.enum(['none', 'soft', 'strong']),
    glow: z.boolean(),
    width: z.number().finite().min(280).max(900),
    padding: z.number().finite().min(12).max(80),
    alignment: z.enum(['left', 'center', 'right'])
  }).strict(),
  avatar: z.object({
    asset: assetSchema.nullable(),
    size: z.number().finite().min(48).max(240),
    shape: z.enum(['circle', 'rounded-square', 'square']),
    position: z.object({ x: percentageSchema, y: percentageSchema }).strict(),
    borderColor: colorSchema,
    borderWidth: z.number().finite().min(0).max(8),
    glow: z.boolean(),
    shadow: z.enum(['none', 'soft', 'strong'])
  }).strict(),
  banner: z.object({
    asset: assetSchema.nullable(),
    borderRadius: z.number().finite().min(0).max(64),
    visible: z.boolean().default(false)
  }).strict(),
  typography: z.object({
    displayName: textStyleSchema,
    bio: textStyleSchema,
    link: textStyleSchema
  }).strict(),
  socialLinks: z.array(socialLinkSchema).max(PAGE_LIMITS.socialLinks),
  galleryImages: z.array(assetSchema).max(PAGE_LIMITS.galleryImages),
  elements: z.array(pageElementSchema).max(PAGE_LIMITS.elements),
  musicPlayer: z.object({
    enabled: z.boolean(),
    audioUrl: urlSchema.nullable(),
    cover: assetSchema.nullable(),
    title: z.string().trim().max(120),
    artist: z.string().trim().max(120),
    loop: z.boolean(),
    preset: z.enum(['minimal', 'glass', 'cd', 'vinyl', 'cassette', 'pixel'])
  }).strict(),
  entranceScreen: z.object({
    enabled: z.boolean(),
    backgroundColor: colorSchema,
    background: assetSchema.nullable(),
    text: z.string().trim().max(120),
    textStyle: textStyleSchema,
    transition: z.enum(['fade', 'blurFade', 'zoomFade', 'pixelLike'])
  }).strict(),
  cursor: z.object({
    type: z.enum(['default', 'image']),
    image: assetSchema.nullable(),
    trail: z.enum(['none', 'stars', 'hearts', 'sparkles', 'bubbles']),
    color: colorSchema
  }).strict(),
  reactionPresets: z.array(z.enum(['❤️', '⭐', '🎀', '🔥'])).min(1).max(4).refine((items) => new Set(items).size === items.length),
  effects: z.array(effectSchema).max(PAGE_LIMITS.effects),
  tabs: z.array(tabSchema).max(PAGE_LIMITS.tabs),
  desktop: z.object({
    contentWidth: z.number().finite().min(280).max(1200),
    verticalAlignment: z.enum(['top', 'center', 'bottom'])
  }).strict(),
  mobileOverrides: z.object({
    hideBanner: z.boolean(),
    contentWidth: z.number().finite().min(280).max(600)
  }).strict()
}).strict().superRefine((configuration, context) => {
  const counts = configuration.elements.reduce((result, element) => {
    result[element.type] = (result[element.type] || 0) + 1;
    return result;
  }, {});
  const widgetImageCount = configuration.elements.reduce((total, element) => {
    if (element.type !== 'widget') return total;
    if (['characters', 'games', 'gallery'].includes(element.widgetData.kind)) return total + element.widgetData.items.length;
    return total;
  }, 0);
  const imageCount = (counts.image || 0) + configuration.galleryImages.length + widgetImageCount;

  if (imageCount > PAGE_LIMITS.images) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `A page can contain at most ${PAGE_LIMITS.images} images.`, path: ['elements'] });
  }
  if ((counts.widget || 0) > PAGE_LIMITS.widgets) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `A page can contain at most ${PAGE_LIMITS.widgets} widgets.`, path: ['elements'] });
  }
  const animatedCount = configuration.elements.filter((element) => element.style.animation && element.style.animation !== 'none').length;
  if (animatedCount > PAGE_LIMITS.animatedElements) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `A page can contain at most ${PAGE_LIMITS.animatedElements} animated elements.`, path: ['elements'] });
  }
  const tabIds = new Set(configuration.tabs.map((tab) => tab.id));
  configuration.elements.forEach((element, index) => {
    if (element.tabId && !tabIds.has(element.tabId)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Element tab must exist.', path: ['elements', index, 'tabId'] });
  });
});

const slugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/, 'Use 3-30 lowercase letters, numbers, or hyphens.').refine(
  (slug) => slug.length >= 3 && !RESERVED_SLUGS.has(slug),
  'This page slug is unavailable.'
);

const pageInputSchema = z.object({
  slug: slugSchema,
  displayName: z.string().trim().min(1).max(120),
  bio: z.string().max(PAGE_LIMITS.bioLength).default(''),
  visibility: z.enum(PAGE_VISIBILITIES).default('private'),
  published: z.boolean().default(false),
  reactionsEnabled: z.boolean().default(true),
  guestbookEnabled: z.boolean().default(false),
  remixEnabled: z.boolean().default(false),
  entranceEnabled: z.boolean().default(false),
  configuration: pageConfigurationSchema
}).strict();

function createDefaultPageConfiguration() {
  return {
    configVersion: PAGE_CONFIG_VERSION,
    background: { type: 'solid', color: '#100d1d', gradient: { from: '#100d1d', to: '#42266f', angle: 135 }, blur: 0, brightness: 1, overlayColor: '#000000', overlayOpacity: 0, vignette: 0, grain: 0 },
    profileCard: { backgroundColor: 'rgba(19, 15, 34, 0.92)', opacity: 1, glass: true, blur: 16, borderColor: '#f5ce6b', borderWidth: 1, borderRadius: 24, shadow: 'soft', glow: false, width: 560, padding: 28, alignment: 'center' },
    avatar: { asset: null, size: 112, shape: 'circle', position: { x: 50, y: 50 }, borderColor: '#f5ce6b', borderWidth: 2, glow: false, shadow: 'soft' },
    banner: { asset: null, borderRadius: 20, visible: false },
    typography: {
      displayName: { fontFamily: 'Cairo', fontSize: 32, fontWeight: '700', color: '#fff7dc', textAlign: 'center', letterSpacing: 0, lineHeight: 1.3, effect: 'none' },
      bio: { fontFamily: 'Cairo', fontSize: 16, fontWeight: '400', color: '#ded4f5', textAlign: 'center', letterSpacing: 0, lineHeight: 1.7, effect: 'none' },
      link: { fontFamily: 'Space Grotesk', fontSize: 15, fontWeight: '600', color: '#f5ce6b', textAlign: 'center', letterSpacing: 0, lineHeight: 1.4, effect: 'none' }
    },
    socialLinks: [],
    galleryImages: [],
    elements: [{
      id: 'profile-card',
      type: 'profile-card',
      position: { x: 50, y: 50 },
      size: { width: 72, height: 48 },
      zIndex: 1,
      visible: true,
      style: {}
    }],
    musicPlayer: { enabled: false, audioUrl: null, cover: null, title: '', artist: '', loop: false, preset: 'glass' },
    entranceScreen: { enabled: false, backgroundColor: '#100d1d', background: null, text: '', textStyle: { fontFamily: 'Cairo', fontSize: 24, fontWeight: '700', color: '#fff7dc', textAlign: 'center', letterSpacing: 0, lineHeight: 1.4, effect: 'none' }, transition: 'fade' },
    cursor: { type: 'default', image: null, trail: 'none', color: '#f5ce6b' },
    reactionPresets: ['❤️', '⭐', '🎀', '🔥'],
    effects: [],
    tabs: [],
    desktop: { contentWidth: 560, verticalAlignment: 'center' },
    mobileOverrides: { hideBanner: false, contentWidth: 360 }
  };
}

function parsePageConfiguration(configuration) {
  return pageConfigurationSchema.parse(configuration);
}

function validatePageConfiguration(configuration) {
  return pageConfigurationSchema.safeParse(configuration);
}

/** @typedef {z.infer<typeof pageConfigurationSchema>} PageConfiguration */
/** @typedef {z.infer<typeof pageInputSchema>} UserPageInput */

module.exports = {
  PAGE_CONFIG_VERSION,
  PAGE_LIMITS,
  PAGE_UPLOAD_LIMITS,
  PAGE_ASSET_TYPES,
  PAGE_RATE_LIMITS,
  PAGE_VISIBILITIES,
  SOCIAL_ICON_IDS,
  RESERVED_SLUGS,
  pageConfigurationSchema,
  pageInputSchema,
  slugSchema,
  createDefaultPageConfiguration,
  parsePageConfiguration,
  validatePageConfiguration
};
