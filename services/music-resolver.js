const PROVIDERS = {
  youtube: 'YouTube Music',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud'
};

class MusicLinkError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new MusicLinkError('تعذر قراءة بيانات هذه الأغنية من المنصة.', 422);
    return response.json();
  } catch (error) {
    if (error instanceof MusicLinkError) throw error;
    throw new MusicLinkError('تعذر الاتصال بالمنصة حالياً. حاول مرة أخرى.', 502);
  } finally {
    clearTimeout(timeout);
  }
}

function cleanUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw new MusicLinkError('أدخل رابط أغنية صحيحاً.');
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new MusicLinkError('الرابط غير صالح.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new MusicLinkError('استخدم رابط HTTPS مباشر من منصة موسيقى مدعومة.');
  }
  return url;
}

function isHost(url, hosts) {
  return hosts.includes(url.hostname.toLowerCase());
}

function resolveYouTube(url) {
  if (!isHost(url, ['music.youtube.com', 'www.youtube.com', 'youtube.com', 'youtu.be', 'www.youtu.be'])) return null;
  const videoId = url.hostname.endsWith('youtu.be')
    ? url.pathname.split('/').filter(Boolean)[0]
    : url.searchParams.get('v');
  if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    throw new MusicLinkError('استخدم رابط فيديو YouTube Music واحداً.');
  }
  return {
    provider: 'youtube',
    providerId: videoId,
    sourceUrl: `https://music.youtube.com/watch?v=${videoId}`,
    metadataUrl: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
    artworkUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  };
}

function resolveSpotify(url) {
  if (!isHost(url, ['open.spotify.com'])) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const trackIndex = segments.indexOf('track');
  const trackId = trackIndex >= 0 ? segments[trackIndex + 1] : null;
  if (!trackId || !/^[A-Za-z0-9]{10,64}$/.test(trackId)) {
    throw new MusicLinkError('استخدم رابط أغنية Spotify واحداً.');
  }
  const sourceUrl = `https://open.spotify.com/track/${trackId}`;
  return {
    provider: 'spotify',
    providerId: trackId,
    sourceUrl,
    metadataUrl: `https://open.spotify.com/oembed?url=${encodeURIComponent(sourceUrl)}`,
    artworkUrl: null
  };
}

function resolveSoundCloud(url) {
  if (!isHost(url, ['soundcloud.com', 'www.soundcloud.com'])) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new MusicLinkError('استخدم رابط مقطع SoundCloud واحداً.');
  const sourceUrl = `https://soundcloud.com/${parts.slice(0, 2).map(encodeURIComponent).join('/')}`;
  return {
    provider: 'soundcloud',
    providerId: parts.slice(0, 2).join('/'),
    sourceUrl,
    metadataUrl: `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(sourceUrl)}`,
    artworkUrl: null
  };
}

async function resolveMusicLink(input) {
  const url = cleanUrl(input);
  const parsed = resolveYouTube(url) || resolveSpotify(url) || resolveSoundCloud(url);
  if (!parsed) throw new MusicLinkError('المنصات المدعومة هي YouTube Music وSpotify وSoundCloud فقط.');

  const metadata = await fetchJson(parsed.metadataUrl);
  const title = typeof metadata.title === 'string' ? metadata.title.trim().slice(0, 240) : '';
  if (!title) throw new MusicLinkError('لم نتمكن من قراءة اسم الأغنية من الرابط.', 422);

  return {
    ...parsed,
    providerName: PROVIDERS[parsed.provider],
    title,
    artworkUrl: typeof metadata.thumbnail_url === 'string' && metadata.thumbnail_url.startsWith('https://')
      ? metadata.thumbnail_url
      : parsed.artworkUrl
  };
}

module.exports = { resolveMusicLink, MusicLinkError, PROVIDERS };
