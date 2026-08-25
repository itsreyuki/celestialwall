const express = require('express');
const {
  listMusicTracks,
  getMusicTrackById,
  createMusicTrack,
  deleteMusicTrack
} = require('../db');
const { searchYouTubeVideos, resolveYouTubeVideo, MusicLinkError } = require('../services/music-resolver');

const router = express.Router();

function requireMember(req, res, next) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'سجّل الدخول أولاً لإضافة أغنية.' });
  if (!user.isMember) return res.status(403).json({ error: 'الانضمام إلى مجتمع سيليستيا مطلوب للمشاركة.' });
  return next();
}

router.get('/tracks', async (req, res, next) => {
  try {
    const tracks = (await listMusicTracks(80)).filter((track) => track.provider === 'youtube');
    return res.json({ tracks });
  } catch (error) {
    return next(error);
  }
});

router.get('/search', requireMember, async (req, res, next) => {
  try {
    const results = await searchYouTubeVideos(req.query.q);
    return res.json({ results });
  } catch (error) {
    if (error instanceof MusicLinkError) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

router.post('/tracks', requireMember, async (req, res, next) => {
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() : '';
  if (comment.length > 500) return res.status(400).json({ error: 'التعليق يجب ألا يتجاوز 500 حرف.' });

  try {
    const music = await resolveYouTubeVideo(req.body.videoId);
    const user = req.session.user;
    const track = await createMusicTrack({
      sourceUrl: music.sourceUrl,
      provider: music.provider,
      providerId: music.providerId,
      title: music.title,
      artworkUrl: music.artworkUrl,
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
    if (error instanceof MusicLinkError) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

router.delete('/tracks/:id', requireMember, async (req, res, next) => {
  try {
    const track = await getMusicTrackById(req.params.id);
    if (!track) return res.status(404).json({ error: 'الأغنية غير موجودة.' });
    if (track.author.id !== req.session.user.id) {
      return res.status(403).json({ error: 'لا يمكنك حذف أغنية أضافها عضو آخر.' });
    }

    await deleteMusicTrack(track.id);
    req.app.get('musicIo')?.emit('music:track-removed', { id: track.id });
    return res.json({ success: true, id: track.id });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
