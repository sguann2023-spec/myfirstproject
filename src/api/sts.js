import { http } from '../http';
import { tokenStore } from '../auth';

const BASE_URL = 'https://open.vectcut.com';
const PUBLIC_ENDPOINT = 'https://player.install-ai-guider.top';
const SIGN_EXPIRES_SECONDS = 24 * 60 * 60;

const decodeJwtPayload = (jwtToken) => {
  const parts = String(jwtToken || '').split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch (error) {
    return null;
  }
};

// 回包结构：
// {
//     "bucket_name": "jianying-upload-tmp",
//     "credentials": {
//         "AccessKeyId": "STS.NYYodebjSBz4AQ2mEZDLfHLTu",
//         "AccessKeySecret": "9C2NwmC3UZmW2Lf7LPcu8aN4ZjknhMuc7VQn1G4iDLyR",
//         "Expiration": "2026-01-25T07:22:24Z",
//         "SecurityToken": "CAISrwN1q6Ft5B2yfSjIr5rsJN7Rj7Vy9bjfQ3eDiUUPSMNKp4n/lzz2IHhMfXBhAO8esPkynGlW5/0Tlo5rUZJeSFCBcNN06Z1btB7/MtCY65Xt57UO2JerEGTNVkel0cTZb7yhhhsUsiD2OT7+jSZW7ebQi1zANgXXyfTr5LdjatMIJEbaCRNNGNZRICZ7tcYeLgG/HP2xMxns8A2yaU1zoVhElH9Y46ayydHm3Hi4tlDhzfIPrIncO4Wta9IWXK1ySNCoxud7BICj+Cdb8EpN77wkzv4GqzXGt9eMAl9epgieN+3d/phzKRc+Za8nEakD8qmmzK0h4ubandT9xR9BY7wMDSnUT4z5h4nmYLr1bY5iKumrYiuXi4vSa8bP3ll6MS5BBmRjYME8L3J8MxsoRwzBJ7WvkFKwOV/7EvHUif5uj8colwy2rIHbPT+IWK7czD4cPZYwKlkvMxMGQJBL13vz3mamGnEQ5Nb9Je0bBHg2IqPaLA9EQCYpSP0DCncayydKXgw7KOSZENsPmuFmX7ddqDBhZE+cMNm14Qx3GQIoP/A4mceCN/dJbsEgno37CRqAAR3D0rkZTPeADCmuI3b10bpF3FuNEHvidmcv7uFSg7KDdTgxaqYAeBg1TVLnHSDO8mlc3xQgfX3iCZuIxNOuGSjjNhVXI0YPIPY8Mo+5Hjnr/VhFkQtRomTNVhE487QzLnonZZL8JTazO8En/xfRRQbxGL8HOb8pjIpJO4oY/gEQIAA="
//     },
//     "key_prefix": "koubo/6921810bab8bfad6516eccd1"
// }
export async function getCredentials({ bucket_name = '', folder = '' } = {}) {
  const payload = {};
  if (bucket_name) payload.bucket_name = bucket_name;
  if (folder) payload.folder = folder;
  return http.postJson(`${BASE_URL}/sts/get_credentials`, payload);
}

export async function getCurrentAuthUserId() {
  try {
    const accessToken = await tokenStore.ensureValidAccessToken();
    return String(decodeJwtPayload(accessToken)?.sub || '').trim();
  } catch (error) {
    return '';
  }
}

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const hmacSha1Base64 = async (m, s) => { 
  const e = new TextEncoder(); 
  const k = await crypto.subtle.importKey('raw', e.encode(s), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']); 
  const sig = await crypto.subtle.sign('HMAC', k, e.encode(m)); 
  return btoa(String.fromCharCode(...new Uint8Array(sig))); 
};
const makePolicyBase64 = (min = 30, p = 'uploads/', st = '') => { 
  const exp = new Date(Date.now() + min * 60 * 1000).toISOString(); 
  const conditions = [
    ['starts-with', '$key', p],
    ['content-length-range', 0, MAX_FILE_SIZE],
    { success_action_status: '200' },
    ['starts-with', '$Content-Type', '']
  ];
  if (st) conditions.push({ 'x-oss-security-token': st });
  const policy = { expiration: exp, conditions };
  return btoa(JSON.stringify(policy)); 
};
const buildKeyPrefix = (kraw) => { 
  const v = kraw || 'uploads'; 
  return v.endsWith('/') ? v : `${v}/`; 
};
const detectExt = (file) => { 
  const nameExtMatch = (file?.name || '').match(/\.[a-zA-Z0-9]+$/); 
  const extByName = nameExtMatch ? nameExtMatch[0] : ''; 
  const t = file?.type || ''; 
  const ext = extByName || (t.includes('jpeg') ? '.jpg' : t.includes('png') ? '.png' : t.includes('webp') ? '.webp' : t.includes('gif') ? '.gif' : t.includes('mp4') ? '.mp4' : t.includes('mpeg') ? '.mp3' : t.includes('wav') ? '.wav' : ''); 
  return { ext, t }; 
};
const buildPublicUrl = (bucket, publicEndpoint, defaultHost, key) => { 
  const pe = (publicEndpoint || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''); 
  if (!pe) 
    return `${defaultHost}/${key}`; 
  const isCname = !pe.includes('aliyuncs.com') && !pe.includes('oss-'); 
  return isCname ? `https://${pe}/${key}` : `https://${bucket}.${pe}/${key}`; 
};
const fetchPublicEndpoint = async () => PUBLIC_ENDPOINT;
const buildSignedPublicUrl = async (bucket, publicEndpoint, key, ak, sk, st, uploadHost) => { const pe = (publicEndpoint || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''); const isOfficial = pe.includes('aliyuncs.com') || pe.includes('oss-'); const expires = Math.floor(Date.now()/1000) + SIGN_EXPIRES_SECONDS; const canonicalResource = `/${bucket}/${key}${st ? `?security-token=${st}` : ''}`; const str = `GET\n\n\n${expires}\n${canonicalResource}`; const sig = await hmacSha1Base64(str, sk); const base = pe ? (isOfficial ? `https://${bucket}.${pe}/${key}` : `https://${pe}/${key}`) : `${uploadHost}/${key}`; const qs = `OSSAccessKeyId=${encodeURIComponent(ak)}&Expires=${expires}&Signature=${encodeURIComponent(sig)}${st ? `&security-token=${encodeURIComponent(st)}` : ''}`; return `${base}?${qs}`; };
const createProgressTicker = (onProgress, file) => {
  if (typeof onProgress !== 'function') return { done: () => {}, fail: () => {} };
  let percent = 0;
  onProgress({ percent }, file);
  const timer = setInterval(() => {
    if (percent >= 95) {
      clearInterval(timer);
      return;
    }
    percent += percent < 70 ? 8 : percent < 85 ? 3 : 1;
    if (percent > 95) percent = 95;
    onProgress({ percent }, file);
  }, 250);
  return {
    done: () => { clearInterval(timer); onProgress({ percent: 100 }, file); },
    fail: () => { clearInterval(timer); }
  };
};

export async function uploadPresetCover(file, { userId, presetId } = {}) {
  if (!file) throw new Error('MISSING_FILE');
  if (!userId || !presetId) throw new Error('MISSING_USER_OR_PRESET');
  if (file.size > MAX_FILE_SIZE) throw new Error('FILE_TOO_LARGE');
  const resp = await getCredentials({ bucket_name: 'oss-hangzhou-mp4', folder: 'preset' });
  const bucket = (resp && resp.bucket_name) || 'oss-hangzhou-mp4';
  const region = (resp && resp.region) || 'oss-cn-hangzhou';
  const endpoint = (resp && resp.endpoint) ? String(resp.endpoint).replace(/^https?:\/\//, '') : `${region}.aliyuncs.com`;
  const uploadHost = `https://${bucket}.${endpoint}`;
  const creds = resp && resp.credentials ? resp.credentials : {};
  const ak = creds.AccessKeyId || '';
  const sk = creds.AccessKeySecret || '';
  const st = creds.SecurityToken || '';
  if (!ak || !sk) throw new Error('STS_INVALID');
  const { ext, t } = detectExt(file);
  const keyPrefix = `preset/${userId}/${presetId}/`;
  const randomSuffix = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const key = `${keyPrefix}${presetId}_${randomSuffix}${ext || '.jpg'}`;
  const p64 = makePolicyBase64(30, keyPrefix, st);
  const sig = await hmacSha1Base64(p64, sk);
  const form = new FormData();
  form.append('key', key);
  form.append('policy', p64);
  form.append('OSSAccessKeyId', ak);
  form.append('x-oss-security-token', st);
  form.append('success_action_status', '200');
  form.append('Signature', sig);
  form.append('Content-Type', t || 'application/octet-stream');
  form.append('file', file);
  console.log('[uploadPresetCover] start', {
    userId,
    presetId,
    keyPrefix,
    key,
    bucket,
    endpoint,
    size: file?.size || 0,
    type: t || '',
  });
  const res = await fetch(uploadHost, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.log('[uploadPresetCover] failed', { status: res.status, body, key });
    throw new Error(`UPLOAD_FAILED:${res.status}:${body}`);
  }
  const publicEndpoint = await fetchPublicEndpoint();
  const publicUrl = buildPublicUrl(bucket, publicEndpoint, uploadHost, key);
  console.log('[uploadPresetCover] success', { key, publicUrl });
  return { objectKey: key, publicUrl };
}

export async function uploadDigitalHumanAvatarCover(file, { userId = '' } = {}) {
  if (!file) throw new Error('MISSING_FILE');
  if (file.size > MAX_FILE_SIZE) throw new Error('FILE_TOO_LARGE');

  const resolvedUserId = String(userId || await getCurrentAuthUserId()).trim();
  if (!resolvedUserId) throw new Error('MISSING_USER_ID');

  const resp = await getCredentials({ bucket_name: 'oss-hangzhou-mp4', folder: 'digital_human' });
  const bucket = (resp && resp.bucket_name) || 'oss-hangzhou-mp4';
  const region = (resp && resp.region) || 'oss-cn-hangzhou';
  const endpoint = (resp && resp.endpoint) ? String(resp.endpoint).replace(/^https?:\/\//, '') : `${region}.aliyuncs.com`;
  const uploadHost = `https://${bucket}.${endpoint}`;
  const creds = resp && resp.credentials ? resp.credentials : {};
  const ak = creds.AccessKeyId || '';
  const sk = creds.AccessKeySecret || '';
  const st = creds.SecurityToken || '';

  if (!ak || !sk) throw new Error('STS_INVALID');

  const { ext, t } = detectExt(file);
  const keyPrefix = `digital_human/${resolvedUserId}/`;
  const randomSuffix = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const key = `${keyPrefix}avatar_cover_${randomSuffix}${ext || '.jpg'}`;
  const p64 = makePolicyBase64(30, keyPrefix, st);
  const sig = await hmacSha1Base64(p64, sk);
  const form = new FormData();
  form.append('key', key);
  form.append('policy', p64);
  form.append('OSSAccessKeyId', ak);
  form.append('x-oss-security-token', st);
  form.append('success_action_status', '200');
  form.append('Signature', sig);
  form.append('Content-Type', t || 'application/octet-stream');
  form.append('file', file);

  const res = await fetch(uploadHost, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`UPLOAD_FAILED:${res.status}:${body}`);
  }

  const publicEndpoint = await fetchPublicEndpoint();
  const publicUrl = buildPublicUrl(bucket, publicEndpoint, uploadHost, key);
  return { objectKey: key, publicUrl };
}

export async function uploadPresetMaterialsJson(materialsList, { materialsUrl = '', userId = '', presetId = '' } = {}) {
  if (!Array.isArray(materialsList)) throw new Error('MATERIALS_INVALID');
  const normalizedUrl = String(materialsUrl || '').split('?')[0];
  let objectKey = '';
  try {
    if (normalizedUrl) objectKey = String(new URL(normalizedUrl).pathname || '').replace(/^\/+/, '');
  } catch {}
  if (!objectKey && userId && presetId) objectKey = `preset/${userId}/${presetId}/materials.json`;
  if (!objectKey) throw new Error('MATERIALS_URL_INVALID');
  const keyPrefix = objectKey.slice(0, objectKey.lastIndexOf('/') + 1);
  const resp = await getCredentials({ bucket_name: 'oss-hangzhou-mp4', folder: 'preset' });
  const bucket = (resp && resp.bucket_name) || 'oss-hangzhou-mp4';
  const region = (resp && resp.region) || 'oss-cn-hangzhou';
  const endpoint = (resp && resp.endpoint) ? String(resp.endpoint).replace(/^https?:\/\//, '') : `${region}.aliyuncs.com`;
  const uploadHost = `https://${bucket}.${endpoint}`;
  const creds = resp && resp.credentials ? resp.credentials : {};
  const ak = creds.AccessKeyId || '';
  const sk = creds.AccessKeySecret || '';
  const st = creds.SecurityToken || '';
  if (!ak || !sk) throw new Error('STS_INVALID');
  const p64 = makePolicyBase64(30, keyPrefix, st);
  const sig = await hmacSha1Base64(p64, sk);
  const form = new FormData();
  form.append('key', objectKey);
  form.append('policy', p64);
  form.append('OSSAccessKeyId', ak);
  form.append('x-oss-security-token', st);
  form.append('success_action_status', '200');
  form.append('Signature', sig);
  form.append('Content-Type', 'application/json');
  form.append('file', new Blob([JSON.stringify(materialsList, null, 2)], { type: 'application/json' }));
  console.log('[uploadPresetMaterialsJson] start', { objectKey, keyPrefix, bucket, endpoint, count: materialsList.length });
  const res = await fetch(uploadHost, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.log('[uploadPresetMaterialsJson] failed', { status: res.status, body, objectKey });
    throw new Error(`UPLOAD_FAILED:${res.status}:${body}`);
  }
  const publicEndpoint = await fetchPublicEndpoint();
  const publicUrl = normalizedUrl || buildPublicUrl(bucket, publicEndpoint, uploadHost, objectKey);
  console.log('[uploadPresetMaterialsJson] success', { objectKey, publicUrl });
  return { objectKey, publicUrl };
}

export async function uploadToOSS(file) {
  if (file && file.size > MAX_FILE_SIZE) { throw new Error('FILE_TOO_LARGE'); }
  const resp = await getCredentials();
  const bucket = (resp && resp.bucket_name) || 'jianying-upload-tmp';
  const region = (resp && resp.region) || 'oss-cn-hangzhou';
  const uploadHost = `https://${bucket}.${region}.aliyuncs.com`;
  const creds = resp && resp.credentials ? resp.credentials : {};
  const ak = creds.AccessKeyId || '';
  const sk = creds.AccessKeySecret || '';
  const st = creds.SecurityToken || '';
  const kp = buildKeyPrefix(resp && resp.key_prefix);
  const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const { ext, t } = detectExt(file);
  const key = `${kp}vectcut_koubo_tmp_file_${uuid}${ext}`;
  const p64 = makePolicyBase64(30, kp, st);
  const sig = await hmacSha1Base64(p64, sk);
  const form = new FormData();
  form.append('key', key);
  form.append('policy', p64);
  form.append('OSSAccessKeyId', ak);
  form.append('x-oss-security-token', st);
  form.append('success_action_status', '200');
  form.append('Signature', sig);
  form.append('Content-Type', t || 'application/octet-stream');
  form.append('file', file);
  const res = await fetch(uploadHost, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`UPLOAD_FAILED:${res.status}:${body}`);
  }
  const publicEndpoint = await fetchPublicEndpoint();
  const publicUrl = buildPublicUrl(bucket, publicEndpoint, uploadHost, key);
  const signedPublicUrl = await buildSignedPublicUrl(bucket, publicEndpoint, key, ak, sk, st, uploadHost);
  console.log('publicUrl', publicUrl);
  return { objectKey: key, publicUrl, signedPublicUrl };
}

export async function uploadToOSSWithProgress(file, onProgress) {
  if (file && file.size > MAX_FILE_SIZE) { throw new Error('FILE_TOO_LARGE'); }
  const resp = await getCredentials();
  const bucket = (resp && resp.bucket_name) || 'jianying-upload-tmp';
  const region = (resp && resp.region) || 'oss-cn-hangzhou';
  const uploadHost = `https://${bucket}.${region}.aliyuncs.com`;
  const creds = resp && resp.credentials ? resp.credentials : {};
  const ak = creds.AccessKeyId || '';
  const sk = creds.AccessKeySecret || '';
  const st = creds.SecurityToken || '';
  const kp = buildKeyPrefix(resp && resp.key_prefix);
  const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const { ext, t } = detectExt(file);
  const key = `${kp}vectcut_koubo_tmp_file_${uuid}${ext}`;
  const p64 = makePolicyBase64(30, kp, st);
  const sig = await hmacSha1Base64(p64, sk);
  const form = new FormData();
  form.append('key', key);
  form.append('policy', p64);
  form.append('OSSAccessKeyId', ak);
  form.append('x-oss-security-token', st);
  form.append('success_action_status', '200');
  form.append('Signature', sig);
  form.append('Content-Type', t || 'application/octet-stream');
  form.append('file', file);
  const progressTicker = createProgressTicker(onProgress, file);
  const res = await fetch(uploadHost, { method: 'POST', body: form });
  if (!res.ok) {
    progressTicker.fail();
    const body = await res.text().catch(() => '');
    throw new Error(`UPLOAD_FAILED:${res.status}:${body}`);
  }
  progressTicker.done();
  const publicEndpoint = await fetchPublicEndpoint();
  const publicUrl = buildPublicUrl(bucket, publicEndpoint, uploadHost, key);
  const signedPublicUrl = await buildSignedPublicUrl(bucket, publicEndpoint, key, ak, sk, st, uploadHost);
  console.log('publicUrl', publicUrl);
  return { objectKey: key, publicUrl, signedPublicUrl };
}
