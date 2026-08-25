const fs = require('fs/promises');
const path = require('path');

const bucket = process.env.SUPABASE_MUSIC_BUCKET || 'celestial-music';
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const localDirectory = path.join(__dirname, '..', 'data', 'music');
const coverExtensions = ['jpg', 'jpeg', 'png', 'webp'];

function usesSupabaseStorage() {
  return Boolean(supabaseUrl && supabaseServiceKey);
}

function storageHeaders(contentType) {
  return {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
    ...(contentType ? { 'Content-Type': contentType } : {})
  };
}

async function ensureBucket() {
  const response = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...storageHeaders('application/json'), 'x-upsert': 'true' },
    body: JSON.stringify({ id: bucket, name: bucket, public: true })
  });

  // 409 is expected after the first creation, and is safe to ignore.
  if (!response.ok && response.status !== 409) {
    throw new Error('تعذّر تجهيز مساحة تخزين الموسيقى في Supabase.');
  }
}

async function uploadToSupabase(objectPath, filePath, mimeType) {
  await ensureBucket();
  const body = await fs.readFile(filePath);
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: { ...storageHeaders(mimeType), 'x-upsert': 'true' },
    body
  });
  if (!response.ok) throw new Error('تعذّر رفع ملف الموسيقى إلى Supabase.');
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
}

async function copyToLocal(objectPath, filePath) {
  const destination = path.join(localDirectory, objectPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(filePath, destination);
  return `/uploads/music/${objectPath}`;
}

async function storeMusicFiles({ trackId, audioPath, posterPath, posterExtension, posterMimeType }) {
  const audioObjectPath = `tracks/${trackId}.mp3`;
  const artworkObjectPath = `covers/${trackId}.${posterExtension}`;

  if (usesSupabaseStorage()) {
    const [sourceUrl, artworkUrl] = await Promise.all([
      uploadToSupabase(audioObjectPath, audioPath, 'audio/mpeg'),
      uploadToSupabase(artworkObjectPath, posterPath, posterMimeType)
    ]);
    return { sourceUrl, artworkUrl };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('أضف SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY لتخزين ملفات الموسيقى بشكل دائم.');
  }

  const [sourceUrl, artworkUrl] = await Promise.all([
    copyToLocal(audioObjectPath, audioPath),
    copyToLocal(artworkObjectPath, posterPath)
  ]);
  return { sourceUrl, artworkUrl };
}

async function deleteMusicFiles(trackId) {
  const objectPaths = [
    `tracks/${trackId}.mp3`,
    ...coverExtensions.map((extension) => `covers/${trackId}.${extension}`)
  ];

  if (usesSupabaseStorage()) {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: storageHeaders('application/json'),
      body: JSON.stringify({ prefixes: objectPaths })
    });
    if (!response.ok) console.warn('Unable to remove music files from Supabase storage.');
    return;
  }

  await Promise.all(objectPaths.map((objectPath) => (
    fs.unlink(path.join(localDirectory, objectPath)).catch(() => undefined)
  )));
}

module.exports = {
  deleteMusicFiles,
  storeMusicFiles,
  usesSupabaseStorage
};
