const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const express = require('express');
const multer = require('multer');
const ffmpegPath = require('ffmpeg-static');
const {
  listMusicTracks,
  getMusicTrackById,
  createMusicTrack,
  deleteMusicTrack
} = require('../db');
const { deleteMusicFiles, storeMusicFiles } = require('../services/music-storage');

const router = express.Router();
const execFileAsync = promisify(execFile);
const uploadDirectory = path.join(os.tmpdir(), 'celestial-music-upload');
const maxMediaBytes = 60 * 1024 * 1024;
const maxPosterBytes = 8 * 1024 * 1024;
const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const mediaMimeTypes = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav',
  'audio/mp4', 'audio/aac', 'audio/flac', 'audio/webm',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'
]);
const imageExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      fs.mkdirSync(uploadDirectory, { recursive: true });
      callback(null, uploadDirectory);
    },
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname || '').slice(0, 12)}`)
  }),
  limits: { files: 2, fileSize: maxMediaBytes },
  fileFilter: (req, file, callback) => {
    const valid = file.fieldname === 'media'
      ? mediaMimeTypes.has(file.mimetype)
      : file.fieldname === 'poster' && imageMimeTypes.has(file.mimetype);
    callback(valid ? null : new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname), valid);
  }
});

function requireMember(req, res, next) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'سجّل الدخول أولاً لإضافة أغنية.' });
  if (!user.isMember) return res.status(403).json({ error: 'الانضمام إلى مجتمع سيليستيا مطلوب للمشاركة.' });
  return next();
}

function cleanupFiles(filePaths) {
  return Promise.all(filePaths.filter(Boolean).map((filePath) => fsp.unlink(filePath).catch(() => undefined)));
}

async function convertToMp3(inputPath, outputPath) {
  const binary = process.env.FFMPEG_PATH || ffmpegPath;
  if (!binary) throw new Error('محول الصوت غير متاح على الخادم حالياً.');
  try {
    await execFileAsync(binary, [
      '-nostdin', '-y', '-i', inputPath,
      '-vn', '-map', '0:a:0?', '-codec:a', 'libmp3lame', '-b:a', '192k', outputPath
    ], { timeout: 120000, maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error('تعذّر تحويل الملف. تأكد أنه يحتوي على مسار صوت صالح.');
  }

  const info = await fsp.stat(outputPath).catch(() => null);
  if (!info?.size) throw new Error('الملف المرفوع لا يحتوي على صوت قابل للتشغيل.');
}

router.get('/tracks', async (req, res, next) => {
  try {
    const tracks = (await listMusicTracks(80)).filter((track) => track.provider === 'local');
    return res.json({ tracks });
  } catch (error) {
    return next(error);
  }
});

router.post('/tracks', requireMember, upload.fields([
  { name: 'media', maxCount: 1 },
  { name: 'poster', maxCount: 1 }
]), async (req, res, next) => {
  const media = req.files?.media?.[0];
  const poster = req.files?.poster?.[0];
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() : '';
  let convertedPath = null;
  let trackId = null;

  try {
    if (!title || title.length > 120) return res.status(400).json({ error: 'اكتب اسم الأغنية (حتى 120 حرفاً).' });
    if (!media || !poster) return res.status(400).json({ error: 'ارفع ملفاً صوتياً أو فيديو، وارفع الغلاف أيضاً.' });
    if (poster.size > maxPosterBytes) return res.status(400).json({ error: 'يجب ألا يتجاوز حجم الغلاف 8MB.' });
    if (comment.length > 500) return res.status(400).json({ error: 'الملاحظة يجب ألا تتجاوز 500 حرف.' });

    trackId = crypto.randomUUID();
    convertedPath = path.join(uploadDirectory, `${trackId}.mp3`);
    await convertToMp3(media.path, convertedPath);

    const files = await storeMusicFiles({
      trackId,
      audioPath: convertedPath,
      posterPath: poster.path,
      posterExtension: imageExtensions[poster.mimetype],
      posterMimeType: poster.mimetype
    });
    const user = req.session.user;
    const track = await createMusicTrack({
      id: trackId,
      sourceUrl: files.sourceUrl,
      provider: 'local',
      providerId: trackId,
      title,
      artworkUrl: files.artworkUrl,
      comment: comment || null,
      author: {
        id: user.id,
        username: user.username,
        global_name: user.global_name || user.username,
        avatar: user.avatar || null
      }
    });

    req.app.get('musicIo')?.emit('music:track-added', { track });
    return res.status(201).json({ track });
  } catch (error) {
    if (trackId) await deleteMusicFiles(trackId).catch(() => undefined);
    return next(error);
  } finally {
    await cleanupFiles([media?.path, poster?.path, convertedPath]);
  }
});

router.delete('/tracks/:id', requireMember, async (req, res, next) => {
  try {
    const track = await getMusicTrackById(req.params.id);
    if (!track || track.provider !== 'local') return res.status(404).json({ error: 'الأغنية غير موجودة.' });
    if (track.author.id !== req.session.user.id) {
      return res.status(403).json({ error: 'لا يمكنك حذف أغنية أضافها عضو آخر.' });
    }

    await deleteMusicTrack(track.id);
    await deleteMusicFiles(track.providerId || track.id);
    req.app.get('musicIo')?.emit('music:track-removed', { id: track.id });
    return res.json({ success: true, id: track.id });
  } catch (error) {
    return next(error);
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'حجم الملف كبير جداً. الحد الأقصى للملف الصوتي أو الفيديو هو 60MB.'
      : 'ارفع ملف صوت أو فيديو صالحاً، وغلافاً بصيغة JPG أو PNG أو WebP.';
    return res.status(400).json({ error: message });
  }
  return next(error);
});

module.exports = router;
