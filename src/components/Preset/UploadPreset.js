import { createPreset as createPresetApi, updatePreset as updatePresetApi } from '../../api/preset';
import logger from '../../shared/logger';

const OSS_CONFIG = {
  bucket_name: 'oss-hangzhou-mp4',
  endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
  public_endpoint: 'https://player.install-ai-guider.top',
};


const req = (name) => {
  if (!window.require) throw new Error('当前环境不支持 Node API');
  return window.require(name);
};

const decodeJwtPayload = (jwtToken) => {
  const { Buffer } = req('buffer');
  const parts = String(jwtToken || '').split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
};

const extractUserIdFromToken = (jwtToken) => {
  try {
    return decodeJwtPayload(jwtToken)?.sub || null;
  } catch {
    return null;
  }
};

const hmacSha1Base64 = (secret, input) => req('crypto').createHmac('sha1', secret).update(input, 'utf8').digest('base64');

const generateOssSignature = (accessKeyId, accessKeySecret, method, contentType, resource, securityToken = '', contentMd5 = '') => {
  const date = new Date().toUTCString();
  const canonicalizedHeaders = securityToken ? `x-oss-security-token:${securityToken}\n` : '';
  const stringToSign = `${method}\n${contentMd5}\n${contentType}\n${date}\n${canonicalizedHeaders}/${resource}`;
  const signature = hmacSha1Base64(accessKeySecret, stringToSign);
  return { authorization: `OSS ${accessKeyId}:${signature}`, date, token: securityToken };
};

const nodePut = (urlStr, headers, bodyBuffer) =>
  new Promise((resolve, reject) => {
    const { URL } = req('url');
    const urlObj = new URL(urlStr);
    const transport = req(urlObj.protocol === 'https:' ? 'https' : 'http');
    const request = transport.request(
      urlObj,
      { method: 'PUT', headers },
      (response) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode || 0,
            headers: response.headers || {},
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    request.on('error', reject);
    request.write(bodyBuffer);
    request.end();
  });

const uploadFileToOSS = async (localFile, objectName, accessKeyId, accessKeySecret, securityToken, contentType, type, region, bucket, endpoint) => {
  const fs = req('fs');
  const path = req('path');
  if (!fs.existsSync(localFile) || !fs.statSync(localFile).isFile()) {
    logger.warn('[UploadPreset] uploadFileToOSS:missing_local_file', { localFile, objectName });
    return null;
  }
  if (type === 'VOLC') throw new Error('当前前端JS实现暂不支持 VOLC/TOS 上传');
  const size = fs.statSync(localFile).size;
  logger.info('[UploadPreset] uploadFileToOSS:start', { localFile, objectName, contentType, size, type, region, bucket, endpoint });

  const finalBucket = bucket || OSS_CONFIG.bucket_name;
  const finalEndpoint = (endpoint || OSS_CONFIG.endpoint).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const host = `${finalBucket}.${finalEndpoint}`;
  const resource = `${finalBucket}/${objectName}`;
  const { authorization, date, token } = generateOssSignature(accessKeyId, accessKeySecret, 'PUT', contentType, resource, securityToken);
  const body = fs.readFileSync(localFile);
  const url = `https://${host}/${objectName}`;
  const headers = {
    Host: host,
    Date: date,
    'Content-Type': contentType,
    'Content-Length': String(body.length),
    Authorization: authorization,
  };
  if (token) headers['x-oss-security-token'] = token;

  const res = await nodePut(url, headers, body);
  if (res.statusCode === 200) {
    const publicEndpoint = (OSS_CONFIG.public_endpoint || '').replace(/\/+$/, '');
    const finalUrl = publicEndpoint ? `${publicEndpoint}/${objectName}` : url;
    logger.info('[UploadPreset] uploadFileToOSS:success', { objectName, finalUrl });
    return finalUrl;
  }
  logger.error('[UploadPreset] uploadFileToOSS:failed', { objectName, statusCode: res.statusCode, body: res.body });
  return null;
};

const createPreset = async (group_id) => {
  logger.info('[UploadPreset] createPreset:start', { group_id: group_id || '' });
  const data = await createPresetApi({ group_id });
  logger.info('[UploadPreset] createPreset:response', { success: !!data?.success, hasData: !!data?.data, message: data?.message });
  if (data?.success && data?.data) return data.data;
  return null;
};

const updatePreset = async (payload) => {
  logger.info('[UploadPreset] updatePreset:start', { presetId: payload?.preset_id });
  const data = await updatePresetApi(payload);
  logger.info('[UploadPreset] updatePreset:response', { presetId: payload?.preset_id, success: !!data?.success, message: data?.message });
  return !!data?.success;
};

const resolvePresetPlaceholderPath = (localPath, localFolder) => {
  try {
    if (!localPath) return localPath;
    const fs = req('fs');
    const path = req('path');
    const raw = String(localPath);
    if (fs.existsSync(raw)) return raw;
    const normalizedPath = raw.replace(/\\/g, '/');
    if (!normalizedPath.includes('/Resources/')) return raw;
    const normalizedFolder = String(localFolder || '').replace(/\\/g, '/');
    const combIdx = normalizedFolder.lastIndexOf('/Combination');
    if (combIdx === -1) return raw;
    const presetRoot = normalizedFolder.slice(0, combIdx + '/Combination'.length);
    const resourcesTail = normalizedPath.slice(normalizedPath.indexOf('/Resources/'));
    const candidate = path.join(presetRoot, resourcesTail.replace(/^\/+/, ''));
    return fs.existsSync(candidate) ? candidate : raw;
  } catch {
    return localPath;
  }
};

const scanDraftMaterials = (draftFolder) => {
  const fs = req('fs');
  const path = req('path');
  const draftContentPath = path.join(draftFolder, 'preset_draft', 'draft_content.json');
  if (!fs.existsSync(draftContentPath)) return [];
  const draftContent = JSON.parse(fs.readFileSync(draftContentPath, 'utf-8'));
  const draftMaterials = {};
  ((draftContent?.materials?.drafts) || []).forEach((d) => {
    const m = d?.draft?.materials || {};
    Object.entries(m).forEach(([k, v]) => {
      if (Array.isArray(v)) draftMaterials[k] = (draftMaterials[k] || []).concat(v);
    });
  });
  const materialKeys = { audio: 'audios', video: 'videos', text: 'texts' };
  const counters = { audio: 1, video: 1, text: 1, image: 1 };
  const list = [];
  Object.entries(materialKeys).forEach(([type, key]) => {
    (draftMaterials[key] || []).forEach((material) => {
      let finalType = type;
      if (key === 'videos') finalType = material?.type === 'photo' ? 'image' : 'video';
      let content = '';
      if (finalType === 'text') {
        const raw = material?.content || '{}';
        try {
          const parsed = JSON.parse(raw);
          content = typeof parsed === 'object' ? (parsed?.text || '') : raw;
        } catch {
          content = raw;
        }
      } else {
        const itemPath = material?.path || material?.remote_url;
        if (finalType === 'video' && (!itemPath || String(itemPath).trim() === '')) return;
        content = resolvePresetPlaceholderPath(itemPath, draftFolder);
      }
      list.push({ id: material?.id, content, name: `${finalType}${counters[finalType]++}`, type: finalType });
    });
  });
  return list;
};

const saveMaterialsToJson = (materialsList, outputFile) => {
  req('fs').writeFileSync(outputFile, JSON.stringify(materialsList, null, 2), 'utf-8');
  return 0;
};

const scanAndSaveMaterials = (draftFolder, outputFile) => {
  const list = scanDraftMaterials(draftFolder);
  if (!list.length) return 1;
  return saveMaterialsToJson(list, outputFile);
};

const uploadMaterialJsonToOss = async (jsonFilePath, userId, presetId, akid, aks, token, type, region, bucket, endpoint) => {
  const fs = req('fs');
  if (!jsonFilePath || !fs.existsSync(jsonFilePath)) return null;
  const objectName = `preset/${userId}/${presetId}/materials.json`;
  return uploadFileToOSS(jsonFilePath, objectName, akid, aks, token, 'application/json', type, region, bucket, endpoint);
};

const randomHex = () => {
  const c = req('crypto');
  return c.randomUUID ? c.randomUUID().replace(/-/g, '') : c.randomBytes(16).toString('hex');
};

export async function uploadFolderZipToOSS(localFolder, { description, name, tags, materialJson, group_id } = {}) {
  const fs = req('fs');
  const path = req('path');
  const fse = req('fs-extra');
  const AdmZip = req('adm-zip');
  const processMod = req('process');
  logger.info('[UploadPreset] uploadFolderZipToOSS:start', { localFolder, name, hasDescription: !!description, tagsCount: Array.isArray(tags) ? tags.length : 0, materialJsonType: Array.isArray(materialJson) ? 'array' : typeof materialJson });

  if (!localFolder || !fs.existsSync(localFolder) || !fs.statSync(localFolder).isDirectory()) {
    throw new Error(`本地文件夹不存在或不是目录: ${localFolder}`);
  }

  const traceId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  logger.info('[UploadPreset] uploadFolderZipToOSS:trace_start', { traceId, localFolder, group_id: group_id || '' });

  const token = await (await import('../../auth')).tokenStore.ensureValidAccessToken();
  if (!token) throw new Error('登录已失效，请重新登录');

  const userId = extractUserIdFromToken(token);
  if (!userId) throw new Error('无法从JWT中提取用户ID');

  const resultData = await createPreset(group_id);
  if (!resultData) {
    logger.error('[UploadPreset] createPreset:empty_result');
    throw new Error('创建预设ID或获取凭证失败');
  }

  const presetId = resultData.preset_id;
  const akid = resultData.AccessKeyId;
  const aks = resultData.AccessKeySecret;
  const securityToken = resultData.SecurityToken;
  const type = resultData.type;
  const region = resultData.region;
  const bucket = resultData.bucket;
  const endpoint = resultData.endpoint;
  logger.info('[UploadPreset] credential_ready', { presetId, userId, type, region, bucket, endpoint });

  const folderName = path.basename(path.resolve(localFolder));
  const tmpDir = path.join(processMod.cwd(), 'tmp_upload');
  fse.ensureDirSync(tmpDir);

  let materialJsonToUpload = materialJson;
  if (!materialJsonToUpload) {
    const tempJsonPath = path.join(tmpDir, `${presetId}_scanned_materials.json`);
    if (scanAndSaveMaterials(localFolder, tempJsonPath) === 0) materialJsonToUpload = tempJsonPath;
  } else if (Array.isArray(materialJsonToUpload)) {
    const tempJsonPath = path.join(tmpDir, `${presetId}_provided_materials.json`);
    fs.writeFileSync(tempJsonPath, JSON.stringify(materialJsonToUpload, null, 2), 'utf-8');
    materialJsonToUpload = tempJsonPath;
  }
  logger.info('[UploadPreset] material_json:prepared', {
    traceId,
    presetId,
    materialJsonMode: Array.isArray(materialJson) ? 'array' : (materialJson ? 'path' : 'scan'),
    materialJsonToUpload,
  });

  const tempProcessingFolder = path.join(tmpDir, `${folderName}_processing_${presetId}`);
  if (fs.existsSync(tempProcessingFolder)) fse.removeSync(tempProcessingFolder);
  fse.copySync(localFolder, tempProcessingFolder);
  logger.info('[UploadPreset] workspace:prepared', { traceId, presetId, tmpDir, tempProcessingFolder });

  const draftContentPath = path.join(tempProcessingFolder, 'preset_draft', 'draft_content.json');
  if (fs.existsSync(draftContentPath)) {
    const draftContent = JSON.parse(fs.readFileSync(draftContentPath, 'utf-8'));
    let modified = false;
    const draftsList = draftContent?.materials?.drafts || [];
    const audios = [];
    const videos = [];
    draftsList.forEach((d) => {
      const m = d?.draft?.materials || {};
      if (Array.isArray(m.audios)) audios.push(...m.audios);
      if (Array.isArray(m.videos)) videos.push(...m.videos);
    });
    logger.info('[UploadPreset] draft_materials:collected', { traceId, presetId, draftCount: draftsList.length, audioCount: audios.length, videoCount: videos.length });

    for (const audio of audios) {
      const real = resolvePresetPlaceholderPath(audio?.path, localFolder);
      if (real && fs.existsSync(real)) {
        const filename = path.basename(real);
        const objectName = `preset/${userId}/${presetId}/${filename}`;
        const remoteUrl = await uploadFileToOSS(real, objectName, akid, aks, securityToken, 'audio/mpeg', type, region, bucket, endpoint);
        if (remoteUrl) {
          const ext = path.extname(filename);
          audio.remote_url = remoteUrl;
          audio.material_name = `${randomHex()}${ext}`;
          audio.name = `${randomHex()}${ext}`;
          modified = true;
        }
      }
    }

    for (const video of videos) {
      const real = resolvePresetPlaceholderPath(video?.path, localFolder);
      if (real && fs.existsSync(real)) {
        const filename = path.basename(real);
        const objectName = `preset/${userId}/${presetId}/${filename}`;
        const remoteUrl = await uploadFileToOSS(real, objectName, akid, aks, securityToken, 'video/mp4', type, region, bucket, endpoint);
        if (remoteUrl) {
          const ext = path.extname(filename);
          video.remote_url = remoteUrl;
          video.material_name = `${randomHex()}${ext}`;
          video.name = `${randomHex()}${ext}`;
          modified = true;
        }
      }
    }

    if (modified) fs.writeFileSync(draftContentPath, JSON.stringify(draftContent, null, 4), 'utf-8');
  }

  const zipPath = path.join(tmpDir, `${folderName}_${presetId}.zip`);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  logger.info('[UploadPreset] zip:start', { tempProcessingFolder, zipPath });
  const zip = new AdmZip();
  zip.addLocalFolder(tempProcessingFolder);
  zip.writeZip(zipPath);
  logger.info('[UploadPreset] zip:done', { zipPath, zipSize: fs.existsSync(zipPath) ? fs.statSync(zipPath).size : 0 });
  if (fs.existsSync(tempProcessingFolder)) fse.removeSync(tempProcessingFolder);

  const zipObjectName = `preset/${userId}/${presetId}/${presetId}.zip`;
  const zipUrl = await uploadFileToOSS(zipPath, zipObjectName, akid, aks, securityToken, 'application/zip', type, region, bucket, endpoint);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (!zipUrl) throw new Error('上传zip文件失败');
  logger.info('[UploadPreset] zip:uploaded', { traceId, presetId, zipObjectName, zipUrl });

  let materialJsonOssUrl = null;
  if (materialJsonToUpload) {
    materialJsonOssUrl = await uploadMaterialJsonToOss(materialJsonToUpload, userId, presetId, akid, aks, securityToken, type, region, bucket, endpoint);
  }

  let imageUrl = null;
  let imagePath = path.join(localFolder, `${folderName}.jpeg`);
  if (!fs.existsSync(imagePath)) imagePath = path.join(localFolder, `${folderName}.jpg`);
  if (fs.existsSync(imagePath)) {
    const imageObjectName = `preset/${userId}/${presetId}/${presetId}.jpeg`;
    imageUrl = await uploadFileToOSS(imagePath, imageObjectName, akid, aks, securityToken, 'image/jpeg', type, region, bucket, endpoint);
  }

  const presetName = name || folderName;
  let materialsSummary = [];
  try {
    if (materialJsonToUpload && fs.existsSync(materialJsonToUpload)) {
      const materialsData = JSON.parse(fs.readFileSync(materialJsonToUpload, 'utf-8'));
      if (Array.isArray(materialsData)) {
        materialsSummary = materialsData.map((item) => ({ name: item?.name, content: item?.content }));
      }
    }
  } catch {}

  const updatePayload = {
    name: presetName,
    url: zipUrl,
    materials_url: materialJsonOssUrl || '',
    image_url: imageUrl || '',
    description: description || `${folderName} 预设`,
    tags,
  };
  logger.info('[UploadPreset] updatePayload', { presetId, presetName, zipUrl, materialJsonOssUrl, imageUrl, tags });
  const updateSuccess = await updatePreset({ preset_id: presetId, ...updatePayload });

  if (updateSuccess) {
    logger.info('[UploadPreset] uploadFolderZipToOSS:success', { presetId, userId, presetName });
    return {
      preset_id: presetId,
      user_id: userId,
      name: presetName,
      url: zipUrl,
      materials: materialsSummary,
      image_url: imageUrl,
      description: description || `${folderName} 预设`,
      tag: tags,
      success: true,
    };
  }

  logger.warn('[UploadPreset] uploadFolderZipToOSS:update_failed', { traceId, presetId, userId });
  return {
    preset_id: presetId,
    user_id: userId,
    url: zipUrl,
    image_url: imageUrl,
    success: false,
  };
}