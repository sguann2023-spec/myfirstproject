const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const ffprobeStatic = require('ffprobe-static');
const sharp = require('sharp');

function loadLoggerBridge() {
  const candidates = [
    path.resolve(__dirname, 'loggerBridge.js'),
    path.resolve(__dirname, '../../util/loggerBridge.js'),
    path.resolve(process.cwd(), 'util/loggerBridge.js')
  ];

  const target = candidates.find((candidate) => fs.existsSync(candidate));
  if (!target) {
    throw new Error('loggerBridge module not found');
  }

  return require(target);
}

const logger = loadLoggerBridge().withContext('UpdateMediaMetadata');

const execFileAsync = promisify(execFile);
const DEFAULT_MEDIA_WIDTH = 1920;
const DEFAULT_MEDIA_HEIGHT = 1080;
const FFPROBE_TIMEOUT_MS = 15000;
const FFPROBE_MAX_BUFFER = 8 * 1024 * 1024;
const KEYFRAME_PROPERTY_MAP = {
  position_x: 'KFTypePositionX',
  position_y: 'KFTypePositionY',
  rotation: 'KFTypeRotation',
  scale_x: 'KFTypeScaleX',
  scale_y: 'KFTypeScaleY',
  alpha: 'KFTypeAlpha',
  global_alpha: 'KFTypeGlobalAlpha',
  text_color: 'KFTypeTextColor',
  saturation: 'KFTypeSaturation',
  contrast: 'KFTypeContrast',
  brightness: 'KFTypeBrightness',
  volume: 'KFTypeVolume',
  mask_rotation: 'KFTypeMaskRotation',
  mask_size_x: 'KFTypeMaskSizeX',
  mask_size_y: 'KFTypeMaskSizeY'
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function hasPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function isLocalLikePath(value) {
  return typeof value === 'string'
    && (value.startsWith('/') || value.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(value));
}

function isHttpLikeUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function normalizePathLike(value) {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  if (!value.startsWith('file://')) {
    return value;
  }
  try {
    const decoded = decodeURI(value);
    if (process.platform === 'win32' && /^file:\/\/\/[a-zA-Z]:/.test(decoded)) {
      return decoded.slice('file:///'.length);
    }
    return decoded.replace(/^file:\/\//, '');
  } catch {
    return value.replace(/^file:\/\//, '');
  }
}

function getExistingLocalMediaPath(material) {
  const candidates = [
    material?.path,
    material?.replace_path,
    material?.local_path
  ];

  for (const candidate of candidates) {
    const normalized = normalizePathLike(candidate);
    if (!normalized) {
      continue;
    }
    if (isLocalLikePath(normalized) && fs.existsSync(normalized)) {
      return normalized;
    }
  }

  return '';
}

function getRemoteMediaUrl(material) {
  const remoteUrl = normalizePathLike(material?.remote_url);
  return isHttpLikeUrl(remoteUrl) ? remoteUrl : '';
}

function getMediaProbeSource(material) {
  return getRemoteMediaUrl(material);
}

function resolveFfprobePath() {
  const executableName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  let packaged = '';
  if (process.resourcesPath) {
    if (process.platform === 'darwin') {
      packaged = path.join(process.resourcesPath, '..', 'Frameworks', 'ffprobe', 'darwin', process.arch, executableName);
    } else if (process.platform === 'win32') {
      packaged = path.join(process.resourcesPath, 'ffprobe', 'win32', process.arch, executableName);
    }
  }
  const bundled = ffprobeStatic?.path ? normalizePathLike(ffprobeStatic.path) : '';
  const unpacked = bundled.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1');
  const candidates = [packaged, bundled, unpacked, 'ffprobe'].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'ffprobe' || fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'ffprobe';
}

function parseJsonFromFfprobe(rawOutput) {
  const text = String(rawOutput || '').trim();
  const jsonStart = text.indexOf('{');
  if (jsonStart === -1) {
    throw new Error('ffprobe did not return JSON output');
  }
  return JSON.parse(text.slice(jsonStart));
}

async function runFfprobe(args) {
  const ffprobePath = resolveFfprobePath();
  const { stdout, stderr } = await execFileAsync(ffprobePath, args, {
    windowsHide: true,
    timeout: FFPROBE_TIMEOUT_MS,
    maxBuffer: FFPROBE_MAX_BUFFER
  });
  return parseJsonFromFfprobe(`${stdout || ''}\n${stderr || ''}`);
}

async function probeMedia(filePath) {
  return runFfprobe([
    '-v',
    'error',
    '-show_entries',
    'stream=index,codec_type,width,height,duration:format=duration',
    '-of',
    'json',
    filePath
  ]);
}

async function probeMediaCached(filePath, cache) {
  if (!cache) {
    return probeMedia(filePath);
  }

  const cacheKey = normalizePathLike(filePath);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const pending = probeMedia(filePath).catch((error) => {
    cache.delete(cacheKey);
    throw error;
  });
  cache.set(cacheKey, pending);
  return pending;
}

function getTrackList(script) {
  if (Array.isArray(script?.tracks)) {
    return script.tracks;
  }
  if (script?.tracks && typeof script.tracks === 'object') {
    return Object.values(script.tracks);
  }
  return [];
}

function getTrackType(track) {
  return String(track?.type || track?.track_type || '').toLowerCase();
}

function getSegments(track) {
  return Array.isArray(track?.segments) ? track.segments : [];
}

function getTimerangeStart(range) {
  return toNumber(range?.start, 0);
}

function getTimerangeDuration(range) {
  if (hasPositiveNumber(range?.duration)) {
    return toNumber(range.duration, 0);
  }
  const start = getTimerangeStart(range);
  const end = toNumber(range?.end, 0);
  return end > start ? end - start : 0;
}

function getTimerangeEnd(range) {
  const start = getTimerangeStart(range);
  const end = toNumber(range?.end, NaN);
  if (Number.isFinite(end) && end > 0) {
    return end;
  }
  return start + getTimerangeDuration(range);
}

function setTimerange(range, start, duration) {
  const safeDuration = Math.max(0, Math.floor(duration));
  return {
    ...(range && typeof range === 'object' ? range : {}),
    start: Math.max(0, Math.floor(start)),
    duration: safeDuration,
    end: Math.max(0, Math.floor(start)) + safeDuration
  };
}

function getSegmentTargetEnd(segment) {
  if (hasPositiveNumber(segment?.end)) {
    return toNumber(segment.end, 0);
  }
  return getTimerangeEnd(segment?.target_timerange);
}

function getSegmentSourceStart(segment) {
  return toNumber(segment?.source_timerange?.start, 0);
}

function getSegmentSpeed(segment) {
  const speed = toNumber(segment?.speed?.speed ?? segment?.speed, 1);
  return speed > 0 ? speed : 1;
}

function materialNameOf(material) {
  return material?.material_name || material?.name || material?.id || 'unknown';
}

function createId() {
  return randomUUID().replace(/-/g, '');
}

function getMaterialMap(script, key) {
  const entries = asArray(script?.materials?.[key]);
  return new Map(entries.filter((item) => item?.id).map((item) => [item.id, item]));
}

function getSegmentMaterialSize(segment, materialById) {
  const material = materialById.get(segment?.material_id);
  const width = toNumber(segment?.material_size?.[0], 0) || toNumber(material?.width, 0);
  const height = toNumber(segment?.material_size?.[1], 0) || toNumber(material?.height, 0);
  return {
    width,
    height
  };
}

function resolveKeyframeProperty(propertyType, trackType) {
  if (propertyType === 'alpha' && trackType === 'text') {
    return KEYFRAME_PROPERTY_MAP.global_alpha;
  }
  return KEYFRAME_PROPERTY_MAP[propertyType] || '';
}

function parseTextColorValue(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value.startsWith('#')) {
    throw new Error('text_color value must use #RRGGBB or #RRGGBBAA format');
  }

  let hexValue = value.slice(1);
  if (hexValue.length === 6) {
    hexValue += 'FF';
  } else if (hexValue.length !== 8) {
    throw new Error('text_color value must use #RRGGBB or #RRGGBBAA format');
  }

  if (!/^[0-9a-fA-F]{8}$/.test(hexValue)) {
    throw new Error('text_color value contains invalid hex digits');
  }

  const rgba = [];
  for (let index = 0; index < 8; index += 2) {
    rgba.push(parseInt(hexValue.slice(index, index + 2), 16) / 255);
  }
  return rgba;
}

function parsePendingKeyframeValue(propertyType, rawValue, materialSize) {
  const value = String(rawValue ?? '').trim();
  if (!value) {
    throw new Error('keyframe value is empty');
  }

  if ((propertyType === 'alpha' || propertyType === 'volume') && value.endsWith('%')) {
    return Number(value.slice(0, -1)) / 100;
  }
  if ((propertyType === 'rotation' || propertyType === 'mask_rotation') && value.endsWith('deg')) {
    return Number(value.slice(0, -3));
  }
  if (propertyType === 'saturation' || propertyType === 'contrast' || propertyType === 'brightness') {
    if (value.startsWith('+')) {
      return Number(value.slice(1));
    }
    if (value.startsWith('-')) {
      return -Math.abs(Number(value.slice(1)));
    }
    return Number(value);
  }
  if (propertyType === 'text_color') {
    return parseTextColorValue(rawValue);
  }
  if (propertyType === 'mask_size_x') {
    if (!hasPositiveNumber(materialSize?.width)) {
      throw new Error('mask_size_x requires valid material width');
    }
    return Number(value) / materialSize.width;
  }
  if (propertyType === 'mask_size_y') {
    if (!hasPositiveNumber(materialSize?.height)) {
      throw new Error('mask_size_y requires valid material height');
    }
    return Number(value) / materialSize.height;
  }
  return Number(value);
}

function ensureCommonKeyframeList(segment, propertyType) {
  if (!Array.isArray(segment.common_keyframes)) {
    segment.common_keyframes = [];
  }

  let target = segment.common_keyframes.find((item) => item?.property_type === propertyType);
  if (!target) {
    target = {
      id: createId(),
      keyframe_list: [],
      material_id: '',
      property_type: propertyType
    };
    segment.common_keyframes.push(target);
  } else if (!Array.isArray(target.keyframe_list)) {
    target.keyframe_list = [];
  }

  return target;
}

function appendSegmentKeyframe(segment, propertyType, timeOffset, value) {
  const target = ensureCommonKeyframeList(segment, propertyType);
  const keyframeValues = Array.isArray(value) ? value : [value];
  target.keyframe_list.push({
    curveType: 'Line',
    graphID: '',
    left_control: { x: 0.0, y: 0.0 },
    right_control: { x: 0.0, y: 0.0 },
    id: createId(),
    time_offset: Math.max(0, Math.floor(timeOffset)),
    values: keyframeValues
  });
  target.keyframe_list.sort((a, b) => toNumber(a?.time_offset, 0) - toNumber(b?.time_offset, 0));
}

function applyPendingKeyframeToSegment(segment, trackType, propertyType, timeOffset, value) {
  if (trackType === 'audio') {
    appendSegmentKeyframe(segment, KEYFRAME_PROPERTY_MAP.volume, timeOffset, value);
    return;
  }

  if (propertyType === 'scale_x' || propertyType === 'scale_y') {
    segment.uniform_scale = {
      ...(segment.uniform_scale && typeof segment.uniform_scale === 'object' ? segment.uniform_scale : {}),
      on: false,
      value: toNumber(segment?.uniform_scale?.value, 1) || 1
    };
  }

  if (propertyType === 'uniform_scale') {
    const current = segment.uniform_scale && typeof segment.uniform_scale === 'object'
      ? segment.uniform_scale
      : { on: true, value: 1 };
    if (current.on === false) {
      throw new Error('已设置 scale_x 或 scale_y 时, 不能再设置 uniform_scale');
    }
    segment.uniform_scale = {
      ...current,
      on: true,
      value: toNumber(value, 1) || 1
    };
    appendSegmentKeyframe(segment, KEYFRAME_PROPERTY_MAP.scale_x, timeOffset, value);
    return;
  }

  const mappedProperty = resolveKeyframeProperty(propertyType, trackType);
  if (!mappedProperty) {
    throw new Error(`Unsupported keyframe property type: ${propertyType}`);
  }
  appendSegmentKeyframe(segment, mappedProperty, timeOffset, value);
}

function processPendingKeyframes(script) {
  const videoMaterialById = getMaterialMap(script, 'videos');
  const tracks = getTrackList(script);
  if (!tracks.length) {
    return;
  }

  logger.info('处理待添加的关键帧...');

  for (const track of tracks) {
    const pendingKeyframes = asArray(track?.pending_keyframes);
    if (!pendingKeyframes.length) {
      continue;
    }

    const trackType = getTrackType(track);
    logger.info(`处理轨道 ${track?.name || track?.id || 'unknown'} 中的 ${pendingKeyframes.length} 个待添加关键帧...`);

    for (const keyframeInfo of pendingKeyframes) {
      const propertyType = String(keyframeInfo?.property_type || '').trim();
      const timeSeconds = Number(keyframeInfo?.time);
      const rawValue = keyframeInfo?.value;

      try {
        if (!propertyType || !Number.isFinite(timeSeconds)) {
          throw new Error('invalid pending keyframe payload');
        }

        const targetTime = Math.floor(timeSeconds * 1000000);
        const targetSegment = getSegments(track).find((segment) => {
          const start = getTimerangeStart(segment?.target_timerange);
          const end = getSegmentTargetEnd(segment);
          return start <= targetTime && targetTime <= end;
        });

        if (!targetSegment) {
          logger.warn(`警告：在轨道 ${track?.name || 'unknown'} 的时间点 ${timeSeconds}s 找不到对应的片段，跳过此关键帧`);
          continue;
        }

        const materialSize = getSegmentMaterialSize(targetSegment, videoMaterialById);
        const parsedValue = parsePendingKeyframeValue(propertyType, rawValue, materialSize);
        if (Array.isArray(parsedValue)) {
          if (parsedValue.length === 0 || parsedValue.some((item) => !Number.isFinite(item))) {
            throw new Error(`Invalid value format: ${rawValue}`);
          }
        } else if (!Number.isFinite(parsedValue)) {
          throw new Error(`Invalid value format: ${rawValue}`);
        }

        const offsetTime = targetTime - getTimerangeStart(targetSegment.target_timerange) + getSegmentSourceStart(targetSegment);
        applyPendingKeyframeToSegment(targetSegment, trackType, propertyType, offsetTime, parsedValue);
        logger.info(`成功添加关键帧: ${propertyType} 在 ${timeSeconds}s`);
      } catch (error) {
        logger.error(`添加关键帧失败: ${error?.message || error}`);
      }
    }

    track.pending_keyframes = [];
    logger.info(`轨道 ${track?.name || track?.id || 'unknown'} 中的待添加关键帧已处理完成。`);
  }
}

function updateMatchingSegments(script, materialId, durationMicros, kind) {
  if (!materialId || !hasPositiveNumber(durationMicros)) {
    return;
  }

  const tracks = getTrackList(script);
  for (const track of tracks) {
    for (const segment of getSegments(track)) {
      if (!segment || segment.material_id !== materialId) {
        continue;
      }

      const currentSource = segment.source_timerange || {};
      const currentTarget = segment.target_timerange || {};
      const sourceEnd = getTimerangeEnd(currentSource);
      if (sourceEnd > 0 && sourceEnd <= durationMicros) {
        segment.end = getSegmentTargetEnd(segment);
        continue;
      }

      const sourceStart = getTimerangeStart(currentSource);
      const newSourceDuration = Math.floor(durationMicros - sourceStart);
      if (newSourceDuration <= 0) {
        logger.warn(
          `警告：${kind}片段 ${segment.segment_id || materialId} 的起始时间 ${sourceStart} 超出了素材时长 ${durationMicros}，将跳过此片段。`
        );
        continue;
      }

      const speed = getSegmentSpeed(segment);
      const newTargetDuration = Math.max(0, Math.floor(newSourceDuration / speed));

      segment.source_timerange = setTimerange(currentSource, sourceStart, newSourceDuration);
      segment.target_timerange = setTimerange(currentTarget, getTimerangeStart(currentTarget), newTargetDuration);
      segment.end = getTimerangeEnd(segment.target_timerange);

      logger.info(`已调整${kind}片段 ${segment.segment_id || materialId} 的 timerange 以适应新的素材时长。`);
    }
  }
}

function removeConflictingSegments(script) {
  logger.info('检查轨道片段时间范围冲突...');
  for (const track of getTrackList(script)) {
    const segments = getSegments(track);
    const toRemove = new Set();

    for (let i = 0; i < segments.length; i += 1) {
      if (toRemove.has(i)) {
        continue;
      }

      const current = segments[i];
      const currentStart = getTimerangeStart(current?.target_timerange);
      const currentEnd = getSegmentTargetEnd(current);
      if (currentEnd <= currentStart) {
        continue;
      }

      for (let j = 0; j < segments.length; j += 1) {
        if (i === j || toRemove.has(j)) {
          continue;
        }

        const other = segments[j];
        const otherStart = getTimerangeStart(other?.target_timerange);
        const otherEnd = getSegmentTargetEnd(other);
        if (otherEnd <= otherStart) {
          continue;
        }

        const overlaps = currentStart < otherEnd && otherStart < currentEnd;
        if (!overlaps) {
          continue;
        }

        const laterIndex = Math.max(i, j);
        logger.warn(
          `轨道 ${track?.name || track?.id || 'unknown'} 中的片段 ${segments[Math.min(i, j)]?.segment_id || 'unknown'} 和 ${segments[laterIndex]?.segment_id || 'unknown'} 时间范围冲突，删除后一个片段`
        );
        toRemove.add(laterIndex);
      }
    }

    for (const index of [...toRemove].sort((a, b) => b - a)) {
      segments.splice(index, 1);
    }
  }
}

function recomputeScriptDuration(script) {
  let maxDuration = 0;
  for (const track of getTrackList(script)) {
    for (const segment of getSegments(track)) {
      const end = getSegmentTargetEnd(segment);
      segment.end = end;
      maxDuration = Math.max(maxDuration, end);
    }
  }
  script.duration = maxDuration;
  logger.info(`更新脚本总时长为: ${script.duration} 微秒。`);
}

async function updateAudioMetadata(script, progress, probeCache) {
  const audios = asArray(script?.materials?.audios);
  if (audios.length === 0) {
    logger.info('草稿中没有找到音频文件。');
    return;
  }

  for (const audio of audios) {
    const materialName = materialNameOf(audio);
    const probeSource = getMediaProbeSource(audio);

    if (!probeSource) {
      logger.warn(`警告：音频文件 ${materialName} 没有可用的 remote_url，已跳过。`);
      continue;
    }

    try {
      progress(`正在处理音频元数据: ${materialName}`);
      const info = await probeMediaCached(probeSource, probeCache);
      const streams = asArray(info?.streams);
      if (streams.some((stream) => stream?.codec_type === 'video')) {
        logger.warn(`警告：音频文件 ${materialName} 包含视频轨道，已跳过其元数据更新。`);
        continue;
      }

      const audioStream = streams.find((stream) => stream?.codec_type === 'audio') || streams[0] || null;
      const durationSeconds = toNumber(audioStream?.duration, 0) || toNumber(info?.format?.duration, 0);
      if (durationSeconds > 0) {
        audio.duration = Math.round(durationSeconds * 1000000);
        logger.info(`成功获取音频 ${materialName} 时长: ${durationSeconds.toFixed(2)} 秒 (${audio.duration} 微秒)。`);
      } else {
        logger.warn(`警告：无法获取音频 ${materialName} 的时长。`);
      }
    } catch (error) {
      logger.error(`获取音频 ${materialName} 时长时发生错误: ${error?.message || error}`, error);
    }

    if (hasPositiveNumber(audio?.duration)) {
      updateMatchingSegments(script, audio.id, audio.duration, '音频');
    }
  }
}

async function updatePhotoMetadata(video, materialName, probePath, progress) {
  if (hasPositiveNumber(video?.width) && hasPositiveNumber(video?.height)) {
    return;
  }

  try {
    progress(`正在处理图片元数据: ${materialName}`);
    const metadata = await sharp(probePath, { limitInputPixels: false }).metadata();
    if (hasPositiveNumber(metadata?.width)) {
      video.width = Math.round(metadata.width);
    }
    if (hasPositiveNumber(metadata?.height)) {
      video.height = Math.round(metadata.height);
    }
    logger.info(`成功设置图片 ${materialName} 宽高: ${video.width}x${video.height}。`);
  } catch (error) {
    logger.error(`设置图片 ${materialName} 宽高失败: ${error?.message || error}，使用默认值 1920x1080。`, error);
    if (!hasPositiveNumber(video?.width)) {
      video.width = DEFAULT_MEDIA_WIDTH;
    }
    if (!hasPositiveNumber(video?.height)) {
      video.height = DEFAULT_MEDIA_HEIGHT;
    }
  }
}

async function updateVideoMetadata(script, progress, probeCache) {
  const videos = asArray(script?.materials?.videos);
  if (videos.length === 0) {
    logger.info('草稿中没有找到视频或图片文件。');
    return;
  }

  for (const video of videos) {
    const materialName = materialNameOf(video);
    const materialType = video?.material_type || video?.type;
    const probePath = getExistingLocalMediaPath(video);
    const probeSource = getMediaProbeSource(video);

    if (materialType === 'photo') {
      if (probePath) {
        await updatePhotoMetadata(video, materialName, probePath, progress);
      } else if (!hasPositiveNumber(video?.width) || !hasPositiveNumber(video?.height)) {
        logger.warn(`警告：图片文件 ${materialName} 没有可探测的本地路径，且缺少有效宽高。`);
      }
      continue;
    }

    if (materialType !== 'video') {
      continue;
    }

    if (!probeSource) {
      logger.warn(`警告：视频文件 ${materialName} 没有可用的 remote_url，已跳过。`);
      continue;
    }

    try {
      progress(`正在处理视频元数据: ${materialName}`);
      const info = await probeMediaCached(probeSource, probeCache);
      const streams = asArray(info?.streams);
      const videoStream = streams.find((stream) => stream?.codec_type === 'video') || streams[0] || null;

      if (hasPositiveNumber(videoStream?.width)) {
        video.width = Math.round(videoStream.width);
      }
      if (hasPositiveNumber(videoStream?.height)) {
        video.height = Math.round(videoStream.height);
      }

      const durationSeconds = toNumber(videoStream?.duration, 0) || toNumber(info?.format?.duration, 0);
      if (durationSeconds > 0) {
        video.duration = Math.round(durationSeconds * 1000000);
      }

      if (!hasPositiveNumber(video?.width)) {
        video.width = DEFAULT_MEDIA_WIDTH;
      }
      if (!hasPositiveNumber(video?.height)) {
        video.height = DEFAULT_MEDIA_HEIGHT;
      }

      if (hasPositiveNumber(video?.duration)
        && hasPositiveNumber(video?.width)
        && hasPositiveNumber(video?.height)) {
        logger.info(`成功设置视频 ${materialName} 宽高: ${video.width}x${video.height}。`);
        logger.info(
          `成功获取视频 ${materialName} 时长: ${(video.duration / 1000000).toFixed(2)} 秒 (${video.duration} 微秒)。`
        );
      } else {
        logger.warn(`警告：无法完整获取视频 ${materialName} 的元数据。`);
      }
    } catch (error) {
      logger.error(`获取视频 ${materialName} 信息时发生错误: ${error?.message || error}，使用默认值 1920x1080。`, error);
      if (!hasPositiveNumber(video?.width)) {
        video.width = DEFAULT_MEDIA_WIDTH;
      }
      if (!hasPositiveNumber(video?.height)) {
        video.height = DEFAULT_MEDIA_HEIGHT;
      }
    }

    if (hasPositiveNumber(video?.duration)) {
      updateMatchingSegments(script, video.id, video.duration, '视频');
    }
  }
}

async function updateMediaMetadata(script, options = {}) {
  if (!script || typeof script !== 'object') {
    throw new Error('script is required');
  }

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const progress = (message) => {
    try {
      onProgress(message);
    } catch (error) {
      logger.debug(`progress callback failed: ${error?.message || error}`);
    }
  };

  const probeCache = new Map();
  await updateAudioMetadata(script, progress, probeCache);
  await updateVideoMetadata(script, progress, probeCache);
  removeConflictingSegments(script);
  recomputeScriptDuration(script);
  processPendingKeyframes(script);

  return script;
}

module.exports = {
  updateMediaMetadata
};
