const fs = require('fs/promises');
const path = require('path');

const bucket = process.env.SUPABASE_PAGES_BUCKET || process.env.SUPABASE_MUSIC_BUCKET || 'celestia-pages';
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

async function storageRequest(url, options, failureMessage) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw storageError('تعذّر الاتصال بمساحة تخزين Supabase. حاول مرة أخرى بعد قليل.');
  }
  if (!response.ok) {
    const statusMessage = response.status === 401 || response.status === 403
      ? 'تحقّق من أن SUPABASE_SERVICE_ROLE_KEY هو مفتاح Service Role الصحيح.'
      : failureMessage;
    throw storageError(statusMessage, response.status >= 500 ? 503 : 422);
  }
  return response;
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
  let current;
  try {
    current = await fetch(`${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers: headers() });
  } catch {
    throw storageError('تعذّر الاتصال بمساحة تخزين Supabase. حاول مرة أخرى بعد قليل.');
  }
  if (current.ok) return;
  if (current.status === 401 || current.status === 403) throw storageError('تحقّق من أن SUPABASE_SERVICE_ROLE_KEY هو مفتاح Service Role الصحيح.', 422);
  if (current.status !== 404) throw storageError('تعذّر الوصول إلى مساحة تخزين صور Celestia Pages.');

  await storageRequest(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: headers('application/json'),
    body: JSON.stringify({ id: bucket, name: bucket, public: true })
  }, 'تعذّر إنشاء مساحة تخزين Celestia Pages في Supabase.');
}

async function storePageAsset({ userId, assetId, filePath, extension, mimeType }) {
  const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
  const objectPath = `users/${safeUserId}/${assetId}.${extension}`;

  if (usesSupabaseStorage()) {
    await ensureBucket();
    await storageRequest(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`, {
      method: 'POST',
      headers: { ...headers(mimeType), 'x-upsert': 'true', 'Cache-Control': 'public, max-age=31536000, immutable' },
      body: await fs.readFile(filePath)
    }, 'تعذّر رفع الصورة إلى Supabase. تحقّق من سعة التخزين وإعدادات الـBucket.');
    return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
  }

  if (process.env.NODE_ENV === 'production') {
    throw storageError('أضف SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY لتفعيل رفع صور Celestia Pages.');
  }

  const destination = path.join(localDirectory, objectPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(filePath, destination);
  return `/uploads/pages/${objectPath}`;
}

module.exports = { storePageAsset, usesSupabaseStorage };
