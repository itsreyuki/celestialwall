const fs = require('fs/promises');
const path = require('path');

const bucket = process.env.SUPABASE_PAGES_BUCKET || 'celestia-pages';
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const localDirectory = path.join(__dirname, '..', 'data', 'pages');
let bucketReady = null;

function storageError(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function usesSupabaseStorage() {
  return Boolean(supabaseUrl && serviceKey);
}

function headers(contentType) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...(contentType ? { 'Content-Type': contentType } : {})
  };
}

async function ensureBucket() {
  if (bucketReady) return bucketReady;
  bucketReady = ensureBucketRequest().catch((error) => {
    bucketReady = null;
    throw error;
  });
  return bucketReady;
}

async function ensureBucketRequest() {
  const current = await fetch(`${supabaseUrl}/storage/v1/bucket/${bucket}`, { headers: headers() });
  if (current.ok) return;
  if (current.status !== 404) throw storageError('Unable to access Pages storage.');

  const created = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: headers('application/json'),
    body: JSON.stringify({ id: bucket, name: bucket, public: true })
  });
  if (!created.ok) throw storageError('Unable to create Pages storage bucket.');
}

async function storePageAsset({ userId, assetId, filePath, extension, mimeType }) {
  const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
  const objectPath = `users/${safeUserId}/${assetId}.${extension}`;

  if (usesSupabaseStorage()) {
    await ensureBucket();
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: { ...headers(mimeType), 'x-upsert': 'true', 'Cache-Control': 'public, max-age=31536000, immutable' },
      body: await fs.readFile(filePath)
    });
    if (!response.ok) throw storageError('Unable to upload the Pages asset.');
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
  }

  if (process.env.NODE_ENV === 'production') {
    throw storageError('Configure Supabase Storage before uploading Pages assets in production.');
  }

  const destination = path.join(localDirectory, objectPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(filePath, destination);
  return `/uploads/pages/${objectPath}`;
}

module.exports = { storePageAsset, usesSupabaseStorage };
