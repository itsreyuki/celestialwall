const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const multer = require('multer');
const {
  createUserPage,
  createPageRemix,
  addPageReaction,
  removePageReaction,
  getPageReactionSummary,
  getPageRemixCount,
  getUserPageBySlug,
  getUserPageByUserId,
  recordUserPageView,
  updateUserPage
} = require('../db');
const { THEMES, applyTheme, createRemixConfiguration } = require('../services/page-themes');
const {
  createDefaultPageConfiguration,
  RESERVED_SLUGS,
  slugSchema,
  PAGE_UPLOAD_LIMITS,
  PAGE_ASSET_TYPES,
  PAGE_RATE_LIMITS
} = require('../services/page-config');
const { storePageAsset } = require('../services/page-storage');

const router = express.Router();
const uploadDirectory = path.join(os.tmpdir(), 'celestia-pages-upload');
const REACTION_PRESETS = new Set(['❤️', '⭐', '🎀', '🔥']);
const ASSET_PURPOSES = Object.freeze({
  background: new Set(['image', 'video']),
  avatar: new Set(['image']),
  banner: new Set(['image']),
  image: new Set(['image']),
  'music-audio': new Set(['audio']),
  'music-cover': new Set(['image']),
  'entrance-background': new Set(['image']),
  'cursor-image': new Set(['image']),
  'widget-image': new Set(['image'])
});
const mutationRate = new Map();
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      fs.mkdirSync(uploadDirectory, { recursive: true });
      callback(null, uploadDirectory);
    },
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname || '').slice(0, 12)}`)
  }),
  limits: { files: 1, fields: 2, parts: 3, fieldSize: 16 * 1024, fileSize: PAGE_UPLOAD_LIMITS.videoBytes },
  fileFilter: (req, file, callback) => callback(Object.hasOwn(PAGE_ASSET_TYPES, file.mimetype) ? null : new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname), Object.hasOwn(PAGE_ASSET_TYPES, file.mimetype))
});

function sessionUser(req) {
  return req.session?.user || req.user || null;
}

function requireUser(req, res, next) {
  if (!sessionUser(req)?.id) {
    return res.status(401).json({ error: 'You must sign in first.' });
  }
  return next();
}

async function publishedPage(slug) {
  const page = await getUserPageBySlug(slug);
  return page && page.published && page.visibility !== 'private' ? page : null;
}

function allowMutation(key, limit, windowMs) {
  const now = Date.now();
  const recent = (mutationRate.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    mutationRate.set(key, recent);
    return false;
  }
  recent.push(now);
  mutationRate.set(key, recent);
  if (mutationRate.size > 5000) {
    for (const [entryKey, timestamps] of mutationRate) {
      if (!timestamps.some((timestamp) => now - timestamp < windowMs)) mutationRate.delete(entryKey);
    }
  }
  return true;
}

function requireMutationRate(limit, windowMs, label) {
  return (req, res, next) => {
    const userId = sessionUser(req)?.id || req.ip || 'anonymous';
    if (!allowMutation(`${label}:${userId}`, limit, windowMs)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return next();
  };
}

function pageInputForUser(user, page, changes = {}) {
  const configuration = changes.configuration ?? page?.configuration ?? createDefaultPageConfiguration();
  return {
    slug: changes.slug ?? page?.slug,
    displayName: changes.displayName ?? page?.displayName ?? user.global_name ?? user.username ?? user.id,
    bio: changes.bio ?? page?.bio ?? '',
    visibility: changes.visibility ?? page?.visibility ?? 'private',
    published: changes.published ?? page?.published ?? false,
    reactionsEnabled: changes.reactionsEnabled ?? page?.reactionsEnabled ?? true,
    remixEnabled: changes.remixEnabled ?? page?.remixEnabled ?? false,
    entranceEnabled: changes.entranceEnabled ?? (changes.configuration ? Boolean(configuration.entranceScreen?.enabled) : (page?.entranceEnabled ?? false)),
    configuration
  };
}

function ownerPageResponse(page) {
  return { page };
}

async function publicPageResponse(page) {
  const configuration = page.configuration || {};
  return {
    page: {
      slug: page.slug,
      displayName: page.displayName,
      bio: page.bio,
      publishedAt: page.publishedAt,
      viewsCount: page.viewsCount || 0,
      reactionsEnabled: page.reactionsEnabled,
      remixEnabled: page.remixEnabled,
      remixCount: await getPageRemixCount(page.id),
      avatarUrl: configuration.avatar?.asset?.url || null,
      configuration,
      socialLinks: Array.isArray(configuration.socialLinks)
        ? configuration.socialLinks.filter((link) => link.visible !== false).map((link) => ({
          label: link.label,
          url: link.url,
          icon: link.icon || 'website'
        }))
        : []
    }
  };
}

async function hasExpectedSignature(file) {
  const handle = await fsp.open(file.path, 'r');
  try {
    const buffer = Buffer.alloc(32);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    if (file.mimetype === 'image/jpeg') return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    if (file.mimetype === 'image/png') return header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (file.mimetype === 'image/gif') return header.subarray(0, 6).toString('ascii') === 'GIF87a' || header.subarray(0, 6).toString('ascii') === 'GIF89a';
    if (file.mimetype === 'image/webp') return header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
    if (file.mimetype === 'video/mp4') return header.subarray(4, 8).toString('ascii') === 'ftyp';
    if (file.mimetype === 'video/webm') return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (file.mimetype === 'audio/mpeg') return header.subarray(0, 3).toString('ascii') === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
    if (file.mimetype === 'audio/ogg') return header.subarray(0, 4).toString('ascii') === 'OggS';
    if (file.mimetype === 'audio/wav' || file.mimetype === 'audio/x-wav') return header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WAVE';
    if (file.mimetype === 'audio/mp4') return header.subarray(4, 8).toString('ascii') === 'ftyp';
    return false;
  } finally {
    await handle.close();
  }
}

function validationError(res, error) {
  if (error?.name === 'ZodError') {
    return res.status(400).json({ error: 'Invalid page data.', issues: error.issues });
  }
  if (error?.code === '23505') {
    return res.status(409).json({ error: 'This page link is already in use.' });
  }
  throw error;
}

router.get('/availability/:slug', async (req, res, next) => {
  const parsed = slugSchema.safeParse(req.params.slug);
  if (!parsed.success) {
    return res.json({ valid: false, available: false, reason: 'invalid' });
  }

  try {
    const page = await getUserPageBySlug(parsed.data);
    return res.json({ valid: true, available: !page, slug: parsed.data });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireUser, async (req, res, next) => {
  try {
    const page = await getUserPageByUserId(sessionUser(req).id);
    return res.json({ page });
  } catch (error) {
    return next(error);
  }
});

router.post('/assets', requireUser, requireMutationRate(PAGE_RATE_LIMITS.asset.max, PAGE_RATE_LIMITS.asset.windowMs, 'asset'), upload.single('asset'), async (req, res, next) => {
  const file = req.file;
  try {
    if (!file || !PAGE_ASSET_TYPES[file.mimetype]) return res.status(400).json({ error: 'Upload a supported image, GIF, video, or audio file.' });
    const purpose = req.body?.purpose;
    const mediaKind = file.mimetype.startsWith('image/') ? 'image' : (file.mimetype.startsWith('video/') ? 'video' : 'audio');
    if (!Object.hasOwn(ASSET_PURPOSES, purpose) || !ASSET_PURPOSES[purpose].has(mediaKind)) return res.status(400).json({ error: 'This file type cannot be used for the selected Pages asset.' });
    if (file.mimetype.startsWith('image/') && file.size > PAGE_UPLOAD_LIMITS.imageBytes) return res.status(400).json({ error: 'Images must be 8MB or smaller.' });
    if (file.mimetype === 'image/gif' && file.size > PAGE_UPLOAD_LIMITS.gifBytes) return res.status(400).json({ error: 'GIF files must be 4MB or smaller.' });
    if (file.mimetype.startsWith('video/') && file.size > PAGE_UPLOAD_LIMITS.videoBytes) return res.status(400).json({ error: 'Videos must be 25MB or smaller.' });
    if (file.mimetype.startsWith('audio/') && file.size > PAGE_UPLOAD_LIMITS.audioBytes) return res.status(400).json({ error: 'Audio files must be 15MB or smaller.' });
    if (!await hasExpectedSignature(file)) return res.status(400).json({ error: 'The uploaded file does not match its declared media type.' });

    const url = await storePageAsset({
      userId: sessionUser(req).id,
      assetId: crypto.randomUUID(),
      filePath: file.path,
      extension: PAGE_ASSET_TYPES[file.mimetype],
      mimeType: file.mimetype
    });
    return res.status(201).json({
      asset: { url, position: 'center', fit: 'cover', crop: { x: 50, y: 50 } },
      mediaType: file.mimetype.startsWith('video/') ? 'video' : (file.mimetype === 'image/gif' ? 'gif' : 'image')
    });
  } catch (error) {
    return next(error);
  } finally {
    if (file?.path) await fsp.unlink(file.path).catch(() => undefined);
  }
});

router.post('/', requireUser, requireMutationRate(PAGE_RATE_LIMITS.create.max, PAGE_RATE_LIMITS.create.windowMs, 'page-create'), async (req, res, next) => {
  const user = sessionUser(req);
  try {
    const existing = await getUserPageByUserId(user.id);
    if (existing) return res.status(409).json({ error: 'You already have a page.' });

    const page = await createUserPage(user.id, pageInputForUser(user, null, {
      slug: req.body?.slug,
      displayName: req.body?.displayName
    }));
    return res.status(201).json(ownerPageResponse(page));
  } catch (error) {
    try {
      return validationError(res, error);
    } catch (unhandledError) {
      return next(unhandledError);
    }
  }
});

router.patch('/me', requireUser, requireMutationRate(PAGE_RATE_LIMITS.update.max, PAGE_RATE_LIMITS.update.windowMs, 'page-update'), async (req, res, next) => {
  const user = sessionUser(req);
  try {
    const page = await getUserPageByUserId(user.id);
    if (!page) return res.status(404).json({ error: 'Create a page before editing it.' });

    const updated = await updateUserPage(user.id, pageInputForUser(user, page, req.body || {}));
    return res.json(ownerPageResponse(updated));
  } catch (error) {
    try {
      return validationError(res, error);
    } catch (unhandledError) {
      return next(unhandledError);
    }
  }
});

router.get('/themes', (req, res) => res.json({ themes: THEMES }));

router.post('/me/theme', requireUser, requireMutationRate(PAGE_RATE_LIMITS.theme.max, PAGE_RATE_LIMITS.theme.windowMs, 'theme'), async (req, res, next) => {
  try {
    const page = await getUserPageByUserId(sessionUser(req).id);
    if (!page) return res.status(404).json({ error: 'Create a page before choosing a theme.' });
    if (!THEMES.some((theme) => theme.id === req.body?.theme)) return res.status(400).json({ error: 'Unknown theme.' });
    const mode = req.body?.mode === 'full' ? 'full' : 'style';
    const configuration = applyTheme(page.configuration, req.body?.theme, mode);
    const updated = await updateUserPage(sessionUser(req).id, pageInputForUser(sessionUser(req), page, { configuration }));
    return res.json({ page: updated });
  } catch (error) {
    try { return validationError(res, error); } catch (unhandledError) { return next(unhandledError); }
  }
});

router.post('/me/publish', requireUser, requireMutationRate(PAGE_RATE_LIMITS.publish.max, PAGE_RATE_LIMITS.publish.windowMs, 'publish'), async (req, res, next) => {
  const user = sessionUser(req);
  try {
    const page = await getUserPageByUserId(user.id);
    if (!page) return res.status(404).json({ error: 'Create a page before publishing it.' });

    const updated = await updateUserPage(user.id, pageInputForUser(user, page, {
      published: true,
      visibility: page.visibility === 'private' ? 'public' : page.visibility
    }));
    return res.json(ownerPageResponse(updated));
  } catch (error) {
    return next(error);
  }
});

router.post('/me/unpublish', requireUser, requireMutationRate(PAGE_RATE_LIMITS.publish.max, PAGE_RATE_LIMITS.publish.windowMs, 'unpublish'), async (req, res, next) => {
  const user = sessionUser(req);
  try {
    const page = await getUserPageByUserId(user.id);
    if (!page) return res.status(404).json({ error: 'Page not found.' });

    const updated = await updateUserPage(user.id, pageInputForUser(user, page, { published: false }));
    return res.json(ownerPageResponse(updated));
  } catch (error) {
    return next(error);
  }
});

router.get('/:slug/reactions', async (req, res, next) => {
  try {
    const page = await publishedPage(req.params.slug);
    if (!page || !page.reactionsEnabled) return res.status(404).json({ error: 'Reactions are unavailable.' });
    const summary = await getPageReactionSummary(page.id, sessionUser(req)?.id || null);
    return res.json({ allowed: page.configuration.reactionPresets, ...summary });
  } catch (error) { return next(error); }
});

router.post('/:slug/reactions/:reaction', requireUser, requireMutationRate(PAGE_RATE_LIMITS.reaction.max, PAGE_RATE_LIMITS.reaction.windowMs, 'reaction'), async (req, res, next) => {
  try {
    const page = await publishedPage(req.params.slug);
    const reaction = decodeURIComponent(req.params.reaction);
    if (!page || !page.reactionsEnabled || !REACTION_PRESETS.has(reaction) || !page.configuration.reactionPresets.includes(reaction)) return res.status(404).json({ error: 'Reaction is unavailable.' });
    const summary = await addPageReaction({ pageId: page.id, userId: sessionUser(req).id, reaction });
    return res.json({ active: true, ...summary });
  } catch (error) { return next(error); }
});

router.delete('/:slug/reactions/:reaction', requireUser, requireMutationRate(PAGE_RATE_LIMITS.reaction.max, PAGE_RATE_LIMITS.reaction.windowMs, 'reaction-remove'), async (req, res, next) => {
  try {
    const page = await publishedPage(req.params.slug);
    const reaction = decodeURIComponent(req.params.reaction);
    if (!page || !REACTION_PRESETS.has(reaction)) return res.status(404).json({ error: 'Reaction is unavailable.' });
    const summary = await removePageReaction({ pageId: page.id, userId: sessionUser(req).id, reaction });
    return res.json({ active: false, ...summary });
  } catch (error) { return next(error); }
});

router.post('/:slug/remix', requireUser, requireMutationRate(PAGE_RATE_LIMITS.remix.max, PAGE_RATE_LIMITS.remix.windowMs, 'remix'), async (req, res, next) => {
  try {
    const source = await publishedPage(req.params.slug);
    const user = sessionUser(req);
    if (!source || !source.remixEnabled) return res.status(404).json({ error: 'Remixing is unavailable for this page.' });
    if (source.userId === user.id) return res.status(400).json({ error: 'You cannot remix your own page.' });
    if (await getUserPageByUserId(user.id)) return res.status(409).json({ error: 'You already have a Celestia Page.' });
    const page = await createUserPage(user.id, pageInputForUser(user, null, {
      slug: req.body?.slug,
      configuration: createRemixConfiguration(source.configuration),
      remixEnabled: false,
      entranceEnabled: false
    }));
    await createPageRemix({ sourcePageId: source.id, remixPageId: page.id, remixerUserId: user.id });
    return res.status(201).json({ page, source: { slug: source.slug, displayName: source.displayName } });
  } catch (error) {
    try { return validationError(res, error); } catch (unhandledError) { return next(unhandledError); }
  }
});

router.get('/:slug', async (req, res, next) => {
  if (RESERVED_SLUGS.has(req.params.slug.toLowerCase())) return res.status(404).json({ error: 'Page not found.' });
  try {
    const page = await getUserPageBySlug(req.params.slug);
    if (!page || !page.published || page.visibility === 'private') {
      return res.status(404).json({ error: 'Page not found.' });
    }
    const viewedPage = await recordUserPageView(page.slug);
    return res.json(await publicPageResponse(viewedPage || page));
  } catch (error) {
    return next(error);
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Pages assets must be 25MB or smaller.' : 'Use supported image, video, or audio files only.' });
  }
  if (error?.expose) return res.status(error.status || 500).json({ error: error.message });
  return next(error);
});

module.exports = router;
