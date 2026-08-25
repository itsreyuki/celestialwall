const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

class MusicLinkError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function youtubeApiKey() {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) {
    throw new MusicLinkError('بحث YouTube غير مفعّل بعد. أضف YOUTUBE_API_KEY إلى إعدادات الخادم.', 503);
  }
  return key;
}

async function youtubeRequest(path, params) {
  const url = new URL(`${YOUTUBE_API_BASE}${path}`);
  Object.entries({ ...params, key: youtubeApiKey() }).forEach(([key, value]) => url.searchParams.set(key, value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || 'تعذر الاتصال ببحث YouTube حالياً.';
      throw new MusicLinkError(message, response.status === 403 ? 503 : 502);
    }
    return data;
  } catch (error) {
    if (error instanceof MusicLinkError) throw error;
    throw new MusicLinkError('تعذر الاتصال ببحث YouTube حالياً. حاول مرة أخرى.', 502);
  } finally {
    clearTimeout(timeout);
  }
}

function safeVideoId(videoId) {
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    throw new MusicLinkError('اختر نتيجة صالحة من بحث YouTube.');
  }
  return videoId;
}

function thumbnail(snippet) {
  return snippet?.thumbnails?.high?.url
    || snippet?.thumbnails?.medium?.url
    || snippet?.thumbnails?.default?.url
    || null;
}

async function searchYouTubeVideos(query) {
  const cleanQuery = typeof query === 'string' ? query.trim().replace(/\s+/g, ' ') : '';
  if (cleanQuery.length < 2 || cleanQuery.length > 100) {
    throw new MusicLinkError('اكتب عبارة بحث بين حرفين و100 حرف.');
  }

  const data = await youtubeRequest('/search', {
    part: 'snippet',
    q: cleanQuery,
    type: 'video',
    videoCategoryId: '10',
    videoEmbeddable: 'true',
    maxResults: '8',
    safeSearch: 'moderate'
  });

  return (data.items || [])
    .filter((item) => item.id?.videoId && item.snippet?.title)
    .map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title.trim().slice(0, 240),
      channelTitle: (item.snippet.channelTitle || 'YouTube').trim().slice(0, 160),
      artworkUrl: thumbnail(item.snippet)
    }));
}

async function resolveYouTubeVideo(videoId) {
  const id = safeVideoId(videoId);
  const data = await youtubeRequest('/videos', { part: 'snippet,status', id });
  const item = data.items?.[0];
  if (!item?.snippet?.title || item.status?.embeddable === false) {
    throw new MusicLinkError('هذا الفيديو غير متاح للتشغيل داخل الموقع.', 422);
  }

  return {
    provider: 'youtube',
    providerId: id,
    sourceUrl: `https://www.youtube.com/watch?v=${id}`,
    title: item.snippet.title.trim().slice(0, 240),
    artworkUrl: thumbnail(item.snippet)
  };
}

module.exports = { searchYouTubeVideos, resolveYouTubeVideo, MusicLinkError };
