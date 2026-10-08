import React from 'react';
import { Bot, Check, Code, Copy, RefreshCw, Trash2, Type } from 'lucide-react';
import { Tooltip, message as antMessage } from 'antd';
import { Provider, useSelector } from 'react-redux';
import CozeIcon from '../../../../../public/coze.svg';
import './MessageItem.css';
import MessageContent from '../MessageContent/MessageContent';
import { MessageRetryContext } from '@renderer/pages/home/Messages/Blocks/MessageRetryContext';
import MessageHeader from '../MessageHeader/MessageHeader';
import MessageTokens from '../../../../renderer/src/pages/home/Messages/MessageTokens';
import appStore from '../../../../renderer/src/store';
import { buildErrorSignature } from '../../../../shared/chatError';
import { buildDigitalHumanRequestApiCurl } from '../../../../shared/digitalHumanRequest';
import { normalizeTextEffectParams } from '../../../../shared/textEffects';
import { buildAiVideoRequestCozeClipboardData, buildAudioAddRequestCozeClipboardData, buildDigitalHumanRequestCozeClipboardData, buildDraftModifyRequestCozeClipboardData, buildDraftRequestCozeClipboardData, buildPresetAddRequestCozeClipboardData, buildSpeechRequestCozeClipboardData, buildTextAddRequestCozeClipboardData, isDigitalHumanRequestCozeSupported } from './cozeTransforms';
const DEBUG_CHAT_LOADING = false && process.env.NODE_ENV !== 'production';

const buildImageAttachmentSignature = (attachments = []) => JSON.stringify(
  (Array.isArray(attachments) ? attachments : []).map((item) => ({
    uid: String(item?.uid || ''),
    name: String(item?.name || ''),
    url: String(item?.url || ''),
    previewUrl: String(item?.previewUrl || ''),
    thumbnailUrl: String(item?.thumbnailUrl || ''),
    fileType: String(item?.fileType || '')
  }))
);

const buildUsageSignature = (usage = null) => JSON.stringify({
  total_tokens: Number(usage?.total_tokens || 0),
  prompt_tokens: Number(usage?.prompt_tokens || 0),
  completion_tokens: Number(usage?.completion_tokens || 0),
  cost: Number(usage?.cost || 0)
});

const buildUsageStepsSignature = (usageSteps = []) => JSON.stringify(
  (Array.isArray(usageSteps) ? usageSteps : []).map((step) => ({
    total_tokens: Number(step?.total_tokens || 0),
    prompt_tokens: Number(step?.prompt_tokens || 0),
    completion_tokens: Number(step?.completion_tokens || 0),
    cache_read_input_tokens: Number(step?.cache_read_input_tokens || 0),
    cache_creation_input_tokens: Number(step?.cache_creation_input_tokens || 0)
  }))
);

const buildMetricsSignature = (metrics = null) => JSON.stringify({
  completion_tokens: Number(metrics?.completion_tokens || 0),
  time_completion_millsec: Number(metrics?.time_completion_millsec || 0),
  time_first_token_millsec: Number(metrics?.time_first_token_millsec || 0)
});
const buildDraftRequestSignature = (draftRequest = null) => {
  if (!draftRequest || typeof draftRequest !== 'object') return '';
  return JSON.stringify({
    action: String(draftRequest?.action || ''),
    width: Number(draftRequest?.width || 0),
    height: Number(draftRequest?.height || 0),
    cover: String(draftRequest?.cover || ''),
    name: String(draftRequest?.name || '')
  });
};
const buildDraftDownloadRequestSignature = (draftDownloadRequest = null) => {
  if (!draftDownloadRequest || typeof draftDownloadRequest !== 'object') return '';
  return JSON.stringify({
    drafts: (Array.isArray(draftDownloadRequest?.drafts) ? draftDownloadRequest.drafts : []).map((item) => ({
      draftId: String(item?.draftId || item?.draft_id || ''),
      draftName: String(item?.draftName || item?.draft_name || ''),
      cover: String(item?.cover || '')
    }))
  });
};
const buildDraftExportRequestSignature = (draftExportRequest = null) => buildDraftDownloadRequestSignature(draftExportRequest);
const buildDraftModifyRequestSignature = (draftModifyRequest = null) => {
  if (!draftModifyRequest || typeof draftModifyRequest !== 'object') return '';
  return JSON.stringify({
    draftId: String(draftModifyRequest?.draftId || draftModifyRequest?.draft_id || ''),
    name: String(draftModifyRequest?.name || ''),
    cover: String(draftModifyRequest?.cover || '')
  });
};
const buildTextAddRequestSignature = (textAddRequest = null) => {
  if (!textAddRequest || typeof textAddRequest !== 'object') return '';
  return JSON.stringify({
    draftId: String(textAddRequest?.draftId || textAddRequest?.draft_id || ''),
    text: String(textAddRequest?.text || ''),
    start: Number(textAddRequest?.start || 0),
    end: Number(textAddRequest?.end || 0),
    font: String(textAddRequest?.font || ''),
    fontColor: String(textAddRequest?.font_color || textAddRequest?.fontColor || ''),
    fontSize: Number(textAddRequest?.font_size ?? textAddRequest?.fontSize ?? 0),
    textStyles: textAddRequest?.text_styles ?? textAddRequest?.textStyles ?? [],
    ...normalizeTextEffectParams(textAddRequest),
    letterSpacing: Number(textAddRequest?.letter_spacing ?? textAddRequest?.letterSpacing ?? 0),
    lineSpacing: Number(textAddRequest?.line_spacing ?? textAddRequest?.lineSpacing ?? 0),
    scaleX: Number(textAddRequest?.scale_x ?? textAddRequest?.scaleX ?? 0),
    scaleY: Number(textAddRequest?.scale_y ?? textAddRequest?.scaleY ?? 0),
    transformXPx: Number(textAddRequest?.transform_x_px ?? textAddRequest?.transformXPx ?? 0),
    transformYPx: Number(textAddRequest?.transform_y_px ?? textAddRequest?.transformYPx ?? 0),
    fixedWidthPx: Number(textAddRequest?.fixed_width_px ?? textAddRequest?.fixedWidthPx ?? textAddRequest?.fixed_width ?? textAddRequest?.fixedWidth ?? 0),
    fixedHeightPx: Number(textAddRequest?.fixed_height_px ?? textAddRequest?.fixedHeightPx ?? textAddRequest?.fixed_height ?? textAddRequest?.fixedHeight ?? 0),
    rotation: Number(textAddRequest?.rotation ?? 0),
    bold: Boolean(textAddRequest?.bold),
    italic: Boolean(textAddRequest?.italic),
    underline: Boolean(textAddRequest?.underline),
    vertical: Boolean(textAddRequest?.vertical),
    align: Number(textAddRequest?.align ?? 0),
    trackName: String(textAddRequest?.track_name || textAddRequest?.trackName || ''),
    relativeIndex: Number(textAddRequest?.relative_index ?? textAddRequest?.relativeIndex ?? 0)
  });
};
const buildPresetAddRequestSignature = (presetAddRequest = null) => {
  if (!presetAddRequest || typeof presetAddRequest !== 'object') return '';
  return JSON.stringify({
    draftId: String(presetAddRequest?.draftId || presetAddRequest?.draft_id || ''),
    presetId: String(presetAddRequest?.presetId || presetAddRequest?.preset_id || ''),
    replacements: Array.isArray(presetAddRequest?.replacements) ? presetAddRequest.replacements : []
  });
};
const buildSpeechRequestSignature = (speechRequest = null) => {
  if (!speechRequest || typeof speechRequest !== 'object') return '';
  return JSON.stringify({
    text: String(speechRequest?.text || ''),
    provider: String(speechRequest?.provider || ''),
    model: String(speechRequest?.model || ''),
    voiceId: String(speechRequest?.voice_id || speechRequest?.voiceId || ''),
    onlyTts: Boolean(speechRequest?.only_tts ?? speechRequest?.onlyTts),
    draftId: String(speechRequest?.draft_id || speechRequest?.draftId || ''),
    targetStart: Number(speechRequest?.target_start ?? speechRequest?.targetStart ?? 0),
    trackName: String(speechRequest?.track_name || speechRequest?.trackName || '')
  });
};
const buildSeedAudioRequestSignature = (seedAudioRequest = null) => {
  if (!seedAudioRequest || typeof seedAudioRequest !== 'object') return '';
  return JSON.stringify({
    textPrompt: String(seedAudioRequest?.text_prompt || seedAudioRequest?.textPrompt || seedAudioRequest?.prompt || ''),
    model: String(seedAudioRequest?.model || ''),
    voiceId: String(seedAudioRequest?.voice_id || seedAudioRequest?.voiceId || ''),
    references: Array.isArray(seedAudioRequest?.references) ? seedAudioRequest.references : [],
    audioUrl: String(seedAudioRequest?.audio_url || seedAudioRequest?.audioUrl || ''),
    imageUrl: String(seedAudioRequest?.image_url || seedAudioRequest?.imageUrl || '')
  });
};
const buildVoiceConversionRequestSignature = (voiceConversionRequest = null) => {
  if (!voiceConversionRequest || typeof voiceConversionRequest !== 'object') return '';
  return JSON.stringify({
    audioUrl: String(voiceConversionRequest?.audio_url || voiceConversionRequest?.audioUrl || ''),
    videoUrl: String(voiceConversionRequest?.video_url || voiceConversionRequest?.videoUrl || ''),
    voiceId: String(voiceConversionRequest?.voice_id || voiceConversionRequest?.voiceId || '')
  });
};
const buildAudioAddRequestSignature = (audioAddRequest = null) => {
  if (!audioAddRequest || typeof audioAddRequest !== 'object') return '';
  return JSON.stringify({
    draftId: String(audioAddRequest?.draft_id || audioAddRequest?.draftId || ''),
    audioUrl: String(audioAddRequest?.audio_url || audioAddRequest?.audioUrl || ''),
    musicId: String(audioAddRequest?.music_id || audioAddRequest?.musicId || ''),
    targetStart: Number(audioAddRequest?.target_start ?? audioAddRequest?.targetStart ?? 0),
    start: Number(audioAddRequest?.start ?? 0),
    end: Number(audioAddRequest?.end ?? 0),
    duration: Number(audioAddRequest?.duration ?? 0),
    volume: Number(audioAddRequest?.volume ?? 0),
    speed: Number(audioAddRequest?.speed ?? 0),
    fadeInDuration: Number(audioAddRequest?.fade_in_duration ?? audioAddRequest?.fadeInDuration ?? 0),
    fadeOutDuration: Number(audioAddRequest?.fade_out_duration ?? audioAddRequest?.fade_out_duratioin ?? audioAddRequest?.fadeOutDuration ?? 0),
    trackName: String(audioAddRequest?.track_name || audioAddRequest?.trackName || ''),
    effectType: String(audioAddRequest?.effect_type || audioAddRequest?.effectType || ''),
    effectParams: audioAddRequest?.effect_params || audioAddRequest?.effectParams || []
  });
};
const buildAiVideoRequestSignature = (aiVideoRequest = null) => {
  if (!aiVideoRequest || typeof aiVideoRequest !== 'object') return '';
  return JSON.stringify({
    model: String(aiVideoRequest?.model || ''),
    resolution: String(aiVideoRequest?.resolution || ''),
    genDuration: Number(aiVideoRequest?.gen_duration ?? aiVideoRequest?.genDuration ?? 0),
    generateAudio: Boolean(aiVideoRequest?.generate_audio ?? aiVideoRequest?.generateAudio),
    superResolve: Boolean(aiVideoRequest?.super_resolve ?? aiVideoRequest?.superResolve),
    enableSeedanceOffline: Boolean(aiVideoRequest?.enable_seedance_offline ?? aiVideoRequest?.enableSeedanceOffline),
    content: Array.isArray(aiVideoRequest?.content) ? aiVideoRequest.content : []
  });
};
const buildDigitalHumanRequestSignature = (digitalHumanRequest = null) => {
  if (!digitalHumanRequest || typeof digitalHumanRequest !== 'object') return '';
  return JSON.stringify({
    mode: String(digitalHumanRequest?.mode || ''),
    copywriting: String(digitalHumanRequest?.copywriting || ''),
    voiceId: String(digitalHumanRequest?.voice_id || digitalHumanRequest?.voiceId || ''),
    imageUrl: String(digitalHumanRequest?.image_url || digitalHumanRequest?.imageUrl || ''),
    videoUrl: String(digitalHumanRequest?.video_url || digitalHumanRequest?.videoUrl || ''),
    prompt: String(digitalHumanRequest?.prompt || ''),
    outputResolution: Number(digitalHumanRequest?.output_resolution ?? digitalHumanRequest?.outputResolution ?? 0)
  });
};
const buildDraftInspectRequestSignature = (draftInspectRequest = null) => {
  if (!draftInspectRequest || typeof draftInspectRequest !== 'object') return '';
  return JSON.stringify({
    requestId: String(draftInspectRequest?.requestId || ''),
    draftId: String(draftInspectRequest?.draftId || draftInspectRequest?.draft_id || ''),
    requirement: String(
      draftInspectRequest?.requirement
      || draftInspectRequest?.inspectRequirement
      || draftInspectRequest?.query
      || ''
    )
  });
};
const isHttpLikeUrl = (value = '') => /^https?:\/\//i.test(String(value || '').trim());
const resolveDraftApiCover = (draftRequest = null, message = {}) => {
  const directCover = String(draftRequest?.cover || '').trim();
  if (isHttpLikeUrl(directCover)) return directCover;

  const attachmentCover = (Array.isArray(message?.imageAttachments) ? message.imageAttachments : []).reduce((matched, attachment) => {
    if (matched) return matched;
    const candidate = String(
      attachment?.url
      || attachment?.previewUrl
      || attachment?.thumbnailUrl
      || ''
    ).trim();
    return isHttpLikeUrl(candidate) ? candidate : matched;
  }, '');
  if (attachmentCover) return attachmentCover;
  if (directCover) return directCover;
  return '';
};
const buildDraftRequestApiCurl = (draftRequest = null, message = {}) => {
  const width = Number(draftRequest?.width || 1080) || 1080;
  const height = Number(draftRequest?.height || 1920) || 1920;
  const cover = resolveDraftApiCover(draftRequest, message);
  const name = String(draftRequest?.name || '').trim();
  const payload = {
    width,
    height,
    ...(cover ? { cover } : {}),
    ...(name ? { name } : {})
  };
  const payloadText = JSON.stringify(payload, null, 4);
  return [
    "curl --location 'https://open.vectcut.com/cut_jianying/create_draft' \\",
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data '${payloadText}'`
  ].join('\n');
};
const buildDraftModifyRequestApiCurl = (draftModifyRequest = null, message = {}) => {
  const draftId = String(draftModifyRequest?.draftId || draftModifyRequest?.draft_id || '').trim();
  const cover = resolveDraftApiCover(draftModifyRequest, message);
  const name = String(draftModifyRequest?.name || '').trim();
  const payload = {
    draft_id: draftId,
    ...(name ? { name } : {}),
    ...(cover ? { cover } : {})
  };
  const payloadText = JSON.stringify(payload, null, 4);
  return [
    "curl --location 'https://open.vectcut.com/cut_jianying/modify_draft' \\",
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data '${payloadText}'`
  ].join('\n');
};
const buildTextAddRequestApiCurl = (textAddRequest = null) => {
  const relativeIndex = Number(textAddRequest?.relative_index ?? textAddRequest?.relativeIndex);
  const scaleX = Number(textAddRequest?.scale_x ?? textAddRequest?.scaleX);
  const scaleY = Number(textAddRequest?.scale_y ?? textAddRequest?.scaleY);
  const transformXPx = Number(textAddRequest?.transform_x_px ?? textAddRequest?.transformXPx);
  const transformYPx = Number(textAddRequest?.transform_y_px ?? textAddRequest?.transformYPx);
  const fixedWidthPx = Number(textAddRequest?.fixed_width_px ?? textAddRequest?.fixedWidthPx ?? textAddRequest?.fixed_width ?? textAddRequest?.fixedWidth);
  const fixedHeightPx = Number(textAddRequest?.fixed_height_px ?? textAddRequest?.fixedHeightPx ?? textAddRequest?.fixed_height ?? textAddRequest?.fixedHeight);
  const rotation = Number(textAddRequest?.rotation);
  const payload = {
    draft_id: String(textAddRequest?.draft_id || textAddRequest?.draftId || '').trim(),
    text: String(textAddRequest?.text || ''),
    start: Number(textAddRequest?.start || 0) || 0,
    end: Number(textAddRequest?.end || 3) || 3,
    ...((textAddRequest?.text_styles ?? textAddRequest?.textStyles)?.length
      ? { text_styles: textAddRequest.text_styles ?? textAddRequest.textStyles } : {}),
    ...normalizeTextEffectParams(textAddRequest || {}),
    ...(Number.isInteger(relativeIndex) ? { relative_index: relativeIndex } : {}),
    ...(String(textAddRequest?.font || '').trim() ? { font: String(textAddRequest.font).trim() } : {}),
    ...(Number.isFinite(Number(textAddRequest?.font_size ?? textAddRequest?.fontSize))
      ? { font_size: Number(textAddRequest?.font_size ?? textAddRequest?.fontSize) }
      : {}),
    ...(String(textAddRequest?.font_color || textAddRequest?.fontColor || '').trim()
      ? { font_color: String(textAddRequest?.font_color || textAddRequest?.fontColor || '').trim() }
      : {}),
    ...(Number.isFinite(Number(textAddRequest?.letter_spacing ?? textAddRequest?.letterSpacing))
      ? { letter_spacing: Number(textAddRequest?.letter_spacing ?? textAddRequest?.letterSpacing) }
      : {}),
    ...(Number.isFinite(Number(textAddRequest?.line_spacing ?? textAddRequest?.lineSpacing))
      ? { line_spacing: Number(textAddRequest?.line_spacing ?? textAddRequest?.lineSpacing) }
      : {}),
    ...(typeof textAddRequest?.bold === 'boolean' ? { bold: textAddRequest.bold } : {}),
    ...(typeof textAddRequest?.italic === 'boolean' ? { italic: textAddRequest.italic } : {}),
    ...(typeof textAddRequest?.underline === 'boolean' ? { underline: textAddRequest.underline } : {}),
    ...(typeof textAddRequest?.vertical === 'boolean' ? { vertical: textAddRequest.vertical } : {}),
    ...(Number.isInteger(Number(textAddRequest?.align)) ? { align: Number(textAddRequest.align) } : {}),
    ...(Number.isFinite(scaleX) ? { scale_x: scaleX } : {}),
    ...(Number.isFinite(scaleY) ? { scale_y: scaleY } : {}),
    ...(Number.isFinite(transformXPx) ? { transform_x_px: transformXPx } : {}),
    ...(Number.isFinite(transformYPx) ? { transform_y_px: transformYPx } : {}),
    ...(Number.isFinite(fixedWidthPx) ? { fixed_width_px: fixedWidthPx } : {}),
    ...(Number.isFinite(fixedHeightPx) ? { fixed_height_px: fixedHeightPx } : {}),
    ...(Number.isFinite(rotation) ? { rotation } : {}),
    ...(String(textAddRequest?.track_name || textAddRequest?.trackName || '').trim()
      ? { track_name: String(textAddRequest?.track_name || textAddRequest?.trackName || '').trim() }
      : {})
  };
  const payloadText = JSON.stringify(payload, null, 4);
  return [
    "curl --location 'https://open.vectcut.com/cut_jianying/add_text' \\",
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data '${payloadText}'`
  ].join('\n');
};
const normalizePresetAddReplacements = (replacements = []) => (
  Array.isArray(replacements)
    ? replacements
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .flatMap((item) => Object.entries(item).map(([key, value]) => {
        const normalizedKey = String(key || '').trim();
        const normalizedValue = String(value ?? '');
        return normalizedKey && normalizedValue.trim() ? { [normalizedKey]: normalizedValue } : null;
      }).filter(Boolean))
    : []
);
const buildPresetAddRequestApiCurl = (presetAddRequest = null) => {
  const numberFields = [
    ['target_start', presetAddRequest?.target_start ?? presetAddRequest?.targetStart],
    ['start', presetAddRequest?.start],
    ['end', presetAddRequest?.end],
    ['transform_x', presetAddRequest?.transform_x ?? presetAddRequest?.transformX],
    ['transform_y', presetAddRequest?.transform_y ?? presetAddRequest?.transformY],
    ['transform_x_px', presetAddRequest?.transform_x_px ?? presetAddRequest?.transformXPx],
    ['transform_y_px', presetAddRequest?.transform_y_px ?? presetAddRequest?.transformYPx],
    ['rotation', presetAddRequest?.rotation],
    ['scale_x', presetAddRequest?.scale_x ?? presetAddRequest?.scaleX],
    ['scale_y', presetAddRequest?.scale_y ?? presetAddRequest?.scaleY],
    ['width', presetAddRequest?.width],
    ['height', presetAddRequest?.height],
    ['relative_index', presetAddRequest?.relative_index ?? presetAddRequest?.relativeIndex],
    ['intro_animation_duration', presetAddRequest?.intro_animation_duration ?? presetAddRequest?.introAnimationDuration],
    ['outro_animation_duration', presetAddRequest?.outro_animation_duration ?? presetAddRequest?.outroAnimationDuration],
    ['transition_duration', presetAddRequest?.transition_duration ?? presetAddRequest?.transitionDuration]
  ];
  const stringFields = [
    ['track_name', presetAddRequest?.track_name || presetAddRequest?.trackName],
    ['intro_animation', presetAddRequest?.intro_animation || presetAddRequest?.introAnimation],
    ['outro_animation', presetAddRequest?.outro_animation || presetAddRequest?.outroAnimation],
    ['transition', presetAddRequest?.transition]
  ];
  const replacements = normalizePresetAddReplacements(presetAddRequest?.replacements);
  const payload = {
    preset_id: String(presetAddRequest?.preset_id || presetAddRequest?.presetId || '').trim(),
    ...(replacements.length ? { replacements } : {})
  };
  numberFields.forEach(([key, value]) => {
    const normalized = Number(value);
    if (Number.isFinite(normalized)) payload[key] = normalized;
  });
  payload.draft_id = String(presetAddRequest?.draft_id || presetAddRequest?.draftId || '').trim();
  stringFields.forEach(([key, value]) => {
    const normalized = String(value || '').trim();
    if (normalized) payload[key] = normalized;
  });
  const payloadText = JSON.stringify(payload, null, 4);
  return [
    "curl --location 'https://open.vectcut.com/cut_jianying/add_preset' \\",
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data '${payloadText}'`
  ].join('\n');
};
const buildSpeechRequestApiCurl = (speechRequest = null) => {
  const payload = {
    ...(String(speechRequest?.provider || '').trim() ? { provider: String(speechRequest.provider).trim() } : {}),
    text: String(speechRequest?.text || ''),
    ...(String(speechRequest?.voice_id || speechRequest?.voiceId || '').trim()
      ? { voice_id: String(speechRequest?.voice_id || speechRequest?.voiceId || '').trim() }
      : {}),
    ...(String(speechRequest?.model || '').trim() ? { model: String(speechRequest.model).trim() } : {}),
    ...(String(speechRequest?.draft_id || speechRequest?.draftId || '').trim()
      ? { draft_id: String(speechRequest?.draft_id || speechRequest?.draftId || '').trim() }
      : {}),
    ...(typeof speechRequest?.only_tts === 'boolean'
      ? { only_tts: speechRequest.only_tts }
      : (typeof speechRequest?.onlyTts === 'boolean' ? { only_tts: speechRequest.onlyTts } : {})),
  };
  const numberFields = [
    ['speech_speed', speechRequest?.speech_speed ?? speechRequest?.speechSpeed],
    ['start', speechRequest?.start],
    ['end', speechRequest?.end],
    ['volume', speechRequest?.volume],
    ['target_start', speechRequest?.target_start ?? speechRequest?.targetStart],
    ['speed', speechRequest?.speed],
    ['width', speechRequest?.width],
    ['height', speechRequest?.height],
    ['fade_in_duration', speechRequest?.fade_in_duration ?? speechRequest?.fadeInDuration],
    ['fade_out_duration', speechRequest?.fade_out_duration ?? speechRequest?.fadeOutDuration]
  ];
  numberFields.forEach(([key, value]) => {
    const normalized = Number(value);
    if (Number.isFinite(normalized)) payload[key] = normalized;
  });
  const trackName = String(speechRequest?.track_name || speechRequest?.trackName || '').trim();
  const effectType = String(speechRequest?.effect_type || speechRequest?.effectType || '').trim();
  const effectParams = Array.isArray(speechRequest?.effect_params)
    ? speechRequest.effect_params
    : (Array.isArray(speechRequest?.effectParams) ? speechRequest.effectParams : null);
  if (trackName) payload.track_name = trackName;
  if (effectType) payload.effect_type = effectType;
  if (effectParams?.length) payload.effect_params = effectParams;
  const payloadText = JSON.stringify(payload, null, 4);
  return [
    "curl --location 'https://open.vectcut.com/cut_jianying/generate_speech' \\",
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data '${payloadText}'`
  ].join('\n');
};
const buildSeedAudioRequestApiCurl = (seedAudioRequest = null) => {
  const references = Array.isArray(seedAudioRequest?.references)
    ? seedAudioRequest.references.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    : [];
  const referenceAudios = Array.isArray(seedAudioRequest?.referenceAudios)
    ? seedAudioRequest.referenceAudios
    : (Array.isArray(seedAudioRequest?.reference_audios) ? seedAudioRequest.reference_audios : []);
  const normalizedReferenceAudios = referenceAudios
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((audioUrl) => ({ audio_url: audioUrl }));
  const allReferences = [...references, ...normalizedReferenceAudios];
  const audioUrl = String(seedAudioRequest?.audio_url || seedAudioRequest?.audioUrl || '').trim();
  const imageUrl = String(seedAudioRequest?.image_url || seedAudioRequest?.imageUrl || '').trim();
  const voiceId = String(seedAudioRequest?.voice_id || seedAudioRequest?.voiceId || '').trim();
  const payload = {
    model: String(seedAudioRequest?.model || 'seed-audio-1.0').trim() || 'seed-audio-1.0',
    text_prompt: String(seedAudioRequest?.text_prompt || seedAudioRequest?.textPrompt || seedAudioRequest?.prompt || '').trim(),
    ...(allReferences.length ? { references: allReferences } : {}),
    ...(audioUrl ? { audio_url: audioUrl } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(voiceId ? { voice_id: voiceId } : {})
  };
  const payloadText = JSON.stringify(payload, null, 4);
  return [
    "curl --location 'https://open.vectcut.com/llm/tts/seed_audio/generate' \\",
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data-raw '${payloadText}'`
  ].join('\n');
};
const buildVoiceConversionRequestApiCurl = (voiceConversionRequest = null) => {
  const audioUrl = String(voiceConversionRequest?.audio_url || voiceConversionRequest?.audioUrl || '').trim();
  const videoUrl = String(voiceConversionRequest?.video_url || voiceConversionRequest?.videoUrl || '').trim();
  const voiceId = String(voiceConversionRequest?.voice_id || voiceConversionRequest?.voiceId || '').trim();
  const payload = {
    ...(videoUrl ? { video_url: videoUrl } : { audio_url: audioUrl }),
    voice_id: voiceId
  };
  const payloadText = JSON.stringify(payload, null, 4);
  return [
    '# 1. 提交变声任务',
    "curl --location 'https://open.vectcut.com/llm/sts/submit/generate' \\",
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data '${payloadText}'`,
    '',
    '# 2. 使用上一步返回的 task_id 查询结果',
    "curl --location 'https://open.vectcut.com/llm/sts/submit/task_status?task_id=<task_id>' \\",
    "--header 'Authorization: Bearer <token>'"
  ].join('\n');
};
const buildAudioAddRequestApiCurl = (audioAddRequest = null) => {
  const payload = {
    ...(String(audioAddRequest?.audio_url || audioAddRequest?.audioUrl || '').trim()
      ? { audio_url: String(audioAddRequest?.audio_url || audioAddRequest?.audioUrl || '').trim() }
      : {}),
    ...(String(audioAddRequest?.music_id || audioAddRequest?.musicId || '').trim()
      ? { music_id: String(audioAddRequest?.music_id || audioAddRequest?.musicId || '').trim() }
      : {}),
    ...(String(audioAddRequest?.draft_id || audioAddRequest?.draftId || '').trim()
      ? { draft_id: String(audioAddRequest?.draft_id || audioAddRequest?.draftId || '').trim() }
      : {})
  };
  const numberFields = [
    ['target_start', audioAddRequest?.target_start ?? audioAddRequest?.targetStart],
    ['start', audioAddRequest?.start],
    ['end', audioAddRequest?.end],
    ['duration', audioAddRequest?.duration],
    ['volume', audioAddRequest?.volume],
    ['speed', audioAddRequest?.speed],
    ['fade_in_duration', audioAddRequest?.fade_in_duration ?? audioAddRequest?.fadeInDuration],
    ['fade_out_duration', audioAddRequest?.fade_out_duration ?? audioAddRequest?.fade_out_duratioin ?? audioAddRequest?.fadeOutDuration],
    ['width', audioAddRequest?.width],
    ['height', audioAddRequest?.height]
  ];
  numberFields.forEach(([key, value]) => {
    const normalized = Number(value);
    if (Number.isFinite(normalized)) payload[key] = normalized;
  });
  const trackName = String(audioAddRequest?.track_name || audioAddRequest?.trackName || '').trim();
  const effectType = String(audioAddRequest?.effect_type || audioAddRequest?.effectType || '').trim();
  const effectParams = Array.isArray(audioAddRequest?.effect_params)
    ? audioAddRequest.effect_params
    : (Array.isArray(audioAddRequest?.effectParams) ? audioAddRequest.effectParams : null);
  if (trackName) payload.track_name = trackName;
  if (effectType) payload.effect_type = effectType;
  if (effectParams?.length) payload.effect_params = effectParams;
  const payloadText = JSON.stringify(payload, null, 4);
  return [
    "curl --location 'https://open.vectcut.com/cut_jianying/add_audio' \\",
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data '${payloadText}'`
  ].join('\n');
};
const buildAiVideoRequestApiCurl = (aiVideoRequest = null) => {
  const content = Array.isArray(aiVideoRequest?.content) ? aiVideoRequest.content : [];
  const payload = {
    model: String(aiVideoRequest?.model || '').trim(),
    resolution: String(aiVideoRequest?.resolution || '').trim(),
    ...(content.length ? { content } : {}),
    ...(Number.isFinite(Number(aiVideoRequest?.gen_duration ?? aiVideoRequest?.genDuration))
      ? { gen_duration: Number(aiVideoRequest?.gen_duration ?? aiVideoRequest?.genDuration) }
      : {}),
    ...(typeof aiVideoRequest?.generate_audio === 'boolean'
      ? { generate_audio: aiVideoRequest.generate_audio }
      : (typeof aiVideoRequest?.generateAudio === 'boolean' ? { generate_audio: aiVideoRequest.generateAudio } : {})),
    ...(typeof aiVideoRequest?.super_resolve === 'boolean'
      ? { super_resolve: aiVideoRequest.super_resolve }
      : (typeof aiVideoRequest?.superResolve === 'boolean' ? { super_resolve: aiVideoRequest.superResolve } : {})),
    ...(typeof aiVideoRequest?.enable_seedance_offline === 'boolean'
      ? { enable_seedance_offline: aiVideoRequest.enable_seedance_offline }
      : (typeof aiVideoRequest?.enableSeedanceOffline === 'boolean' ? { enable_seedance_offline: aiVideoRequest.enableSeedanceOffline } : {})),
  };
  const payloadText = JSON.stringify(payload, null, 4);
  return [
    "curl --location 'https://open.vectcut.com/cut_jianying/generate_ai_video' \\",
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data '${payloadText}'`
  ].join('\n');
};
const buildDraftAgentPrompt = (content = '') => {
  const normalizedContent = String(content || '').trim();
  return normalizedContent ? `使用vectcut工具，${normalizedContent}` : '使用vectcut工具';
};

const LiveAssistantMessageTokens = ({ fallbackMessage, storeAssistantMessageId }) => {
  const storeMessage = useSelector((state) => state?.messages?.entities?.[storeAssistantMessageId] || null);
  const resolvedMessage = storeMessage
    ? {
      ...fallbackMessage,
      ...storeMessage,
      model: storeMessage?.model || fallbackMessage?.model,
      modelId: storeMessage?.modelId || fallbackMessage?.modelId,
      usage: storeMessage?.usage ?? fallbackMessage?.usage,
      usageSteps: storeMessage?.usageSteps ?? fallbackMessage?.usageSteps,
      metrics: storeMessage?.metrics ?? fallbackMessage?.metrics
    }
    : fallbackMessage;

  return <MessageTokens message={resolvedMessage} />;
};

const MessageItem = ({
  message,
  role,
  hasConnectedExternalAgent = false,
  onCopyAssistantMessage,
  onRetryAssistantMessage,
  onDeleteAssistantMessage,
  actionsDisabled = false,
  formatMessageTime,
  model,
  modelOptions,
  formatModelDisplayName,
  isLoading = false,
  userName,
  userAvatar,
}) => {
  const isAssistant = role === 'assistant';
  const isUser = role === 'user';
  const retryAction = React.useMemo(() => ({
    onRetry: () => onRetryAssistantMessage?.(message),
    disabled: actionsDisabled || isLoading || !onRetryAssistantMessage,
    modelId: String(message?.modelId || message?.model?.id || '')
  }), [actionsDisabled, isLoading, message, onRetryAssistantMessage]);
  const draftRequest = message?.draftRequest && typeof message.draftRequest === 'object'
    ? message.draftRequest
    : null;
  const draftExportRequest = message?.draftExportRequest && typeof message.draftExportRequest === 'object'
    ? message.draftExportRequest
    : null;
  const draftDownloadRequest = message?.draftDownloadRequest && typeof message.draftDownloadRequest === 'object'
    ? message.draftDownloadRequest
    : null;
  const draftModifyRequest = message?.draftModifyRequest && typeof message.draftModifyRequest === 'object'
    ? message.draftModifyRequest
    : null;
  const textAddRequest = message?.textAddRequest && typeof message.textAddRequest === 'object'
    ? message.textAddRequest
    : null;
  const presetAddRequest = message?.presetAddRequest && typeof message.presetAddRequest === 'object'
    ? message.presetAddRequest
    : null;
  const speechRequest = message?.speechRequest && typeof message.speechRequest === 'object'
    ? message.speechRequest
    : null;
  const seedAudioRequest = message?.seedAudioRequest && typeof message.seedAudioRequest === 'object'
    ? message.seedAudioRequest
    : null;
  const voiceConversionRequest = message?.voiceConversionRequest && typeof message.voiceConversionRequest === 'object'
    ? message.voiceConversionRequest
    : null;
  const audioAddRequest = message?.audioAddRequest && typeof message.audioAddRequest === 'object'
    ? message.audioAddRequest
    : null;
  const aiVideoRequest = message?.aiVideoRequest && typeof message.aiVideoRequest === 'object'
    ? message.aiVideoRequest
    : null;
  const digitalHumanRequest = message?.digitalHumanRequest && typeof message.digitalHumanRequest === 'object'
    ? message.digitalHumanRequest
    : null;
  const isLipSyncDigitalHumanRequest = isDigitalHumanRequestCozeSupported(digitalHumanRequest);
  const draftInspectRequest = message?.draftInspectRequest && typeof message.draftInspectRequest === 'object'
    ? message.draftInspectRequest
    : null;
  const reversePromptRequest = message?.reversePromptRequest && typeof message.reversePromptRequest === 'object'
    ? message.reversePromptRequest
    : null;
  const subtitleStoryboardRequest = message?.subtitleStoryboardRequest && typeof message.subtitleStoryboardRequest === 'object'
    ? message.subtitleStoryboardRequest
    : null;
  const hasDraftAgentCompatibleRequest = Boolean(
    draftRequest || draftExportRequest || draftDownloadRequest || draftModifyRequest || textAddRequest || presetAddRequest || speechRequest || seedAudioRequest || voiceConversionRequest || audioAddRequest || aiVideoRequest || digitalHumanRequest || draftInspectRequest || reversePromptRequest || message?.subtitleRecognitionRequest || subtitleStoryboardRequest
  );
  const canShowDraftAgentAction = isUser && hasConnectedExternalAgent && hasDraftAgentCompatibleRequest;
  const canShowDraftApiAction = isUser && !draftExportRequest && !draftDownloadRequest && (Boolean(draftRequest) || Boolean(draftModifyRequest) || Boolean(textAddRequest) || Boolean(presetAddRequest) || Boolean(speechRequest) || Boolean(seedAudioRequest) || Boolean(voiceConversionRequest) || Boolean(audioAddRequest) || Boolean(aiVideoRequest) || Boolean(digitalHumanRequest));
  const canShowDraftCozeAction = isUser && (Boolean(draftRequest) || Boolean(draftModifyRequest) || Boolean(textAddRequest) || Boolean(presetAddRequest) || Boolean(speechRequest) || Boolean(audioAddRequest) || Boolean(aiVideoRequest) || isLipSyncDigitalHumanRequest);
  const storeAssistantMessageId = String(message?.storeAssistantMessageId || '').trim();
  const canUseLiveAssistantTokens = isAssistant && Boolean(storeAssistantMessageId);
  const [copied, setCopied] = React.useState(false);
  const [draftDisplayMode, setDraftDisplayMode] = React.useState('text');
  const showDraftAgentFormat = draftDisplayMode === 'agent';
  const showDraftApiFormat = draftDisplayMode === 'api';
  const showDraftCozeFormat = draftDisplayMode === 'coze';
  const displayedMessage = React.useMemo(() => {
    if (showDraftAgentFormat && canShowDraftAgentAction) {
      return {
        ...message,
        content: subtitleStoryboardRequest
          ? `请使用本地文件读写能力完成以下字幕分镜任务，无需调用 vectcut MCP 工具。请先确认能访问指定文件，无法访问时说明原因，不要虚构修改结果。\n\n${String(message?.content || '')}`
          : buildDraftAgentPrompt(message?.content)
      };
    }
    if (showDraftCozeFormat && canShowDraftCozeAction) {
      return {
        ...message,
        content: isLipSyncDigitalHumanRequest
          ? buildDigitalHumanRequestCozeClipboardData(digitalHumanRequest)
          : (aiVideoRequest
          ? buildAiVideoRequestCozeClipboardData(aiVideoRequest)
          : (audioAddRequest
          ? buildAudioAddRequestCozeClipboardData(audioAddRequest)
          : (presetAddRequest
          ? buildPresetAddRequestCozeClipboardData(presetAddRequest)
          : (speechRequest
            ? buildSpeechRequestCozeClipboardData(speechRequest)
            : (textAddRequest
              ? buildTextAddRequestCozeClipboardData(textAddRequest)
              : (draftModifyRequest
                ? buildDraftModifyRequestCozeClipboardData(draftModifyRequest)
                : buildDraftRequestCozeClipboardData(draftRequest))))))),
        imageAttachments: []
      };
    }
    if (!canShowDraftApiAction || !showDraftApiFormat) return message;
    const apiContent = digitalHumanRequest
      ? buildDigitalHumanRequestApiCurl(digitalHumanRequest)
      : (aiVideoRequest
      ? buildAiVideoRequestApiCurl(aiVideoRequest)
      : (audioAddRequest
      ? buildAudioAddRequestApiCurl(audioAddRequest)
      : (presetAddRequest
      ? buildPresetAddRequestApiCurl(presetAddRequest)
      : (voiceConversionRequest
        ? buildVoiceConversionRequestApiCurl(voiceConversionRequest)
        : (seedAudioRequest
          ? buildSeedAudioRequestApiCurl(seedAudioRequest)
          : (speechRequest
          ? buildSpeechRequestApiCurl(speechRequest)
          : (textAddRequest
            ? buildTextAddRequestApiCurl(textAddRequest)
            : (draftModifyRequest
              ? buildDraftModifyRequestApiCurl(draftModifyRequest, message)
              : buildDraftRequestApiCurl(draftRequest, message)))))))));
    return {
      ...message,
      content: apiContent,
      imageAttachments: []
    };
  }, [
    canShowDraftAgentAction,
    canShowDraftApiAction,
    canShowDraftCozeAction,
    draftModifyRequest,
    draftRequest,
    audioAddRequest,
    aiVideoRequest,
    digitalHumanRequest,
    isLipSyncDigitalHumanRequest,
    voiceConversionRequest,
    seedAudioRequest,
    presetAddRequest,
    speechRequest,
    textAddRequest,
    subtitleStoryboardRequest,
    message,
    showDraftAgentFormat,
    showDraftApiFormat,
    showDraftCozeFormat
  ]);

  React.useEffect(() => {
    if (showDraftAgentFormat && !canShowDraftAgentAction) {
      setDraftDisplayMode('text');
      return;
    }
    if (showDraftCozeFormat && !canShowDraftCozeAction) {
      setDraftDisplayMode('text');
      return;
    }
    if (showDraftApiFormat && !canShowDraftApiAction) {
      setDraftDisplayMode('text');
    }
  }, [canShowDraftAgentAction, canShowDraftApiAction, canShowDraftCozeAction, showDraftAgentFormat, showDraftApiFormat, showDraftCozeFormat]);

  React.useEffect(() => {
    if (!DEBUG_CHAT_LOADING || !isAssistant) return;
    // logger.info({
    //   role,
    //   messageId: message?.id || '',
    //   isLoading,
    //   contentLength: String(message?.content || '').length,
    //   hasError: Boolean(message?.error)
    // });
  }, [isAssistant, role, message, isLoading]);

  const handleCopy = async (event) => {
    event.stopPropagation();
    event.currentTarget?.blur?.();
    if (!onCopyAssistantMessage) return;
    try {
      await onCopyAssistantMessage(displayedMessage);
      antMessage.success('已复制');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      antMessage.error('复制失败');
    }
  };
  const handleConvertToApi = React.useCallback((event) => {
    event.stopPropagation();
    event.currentTarget?.blur?.();
    setDraftDisplayMode('api');
  }, []);
  const handleConvertToAgent = React.useCallback((event) => {
    event.stopPropagation();
    event.currentTarget?.blur?.();
    setDraftDisplayMode('agent');
  }, []);
  const handleConvertToCoze = React.useCallback((event) => {
    event.stopPropagation();
    event.currentTarget?.blur?.();
    setDraftDisplayMode('coze');
  }, []);
  const handleConvertToText = React.useCallback((event) => {
    event.stopPropagation();
    event.currentTarget?.blur?.();
    setDraftDisplayMode('text');
  }, []);

  return (
    <div className={`chat-panel__message ${role}`}>
      <MessageHeader
        role={role}
        message={message}
        model={model}
        modelOptions={modelOptions}
        formatModelDisplayName={formatModelDisplayName}
        formatMessageTime={formatMessageTime}
        userName={userName}
        userAvatar={userAvatar}
      />
      <div className={`chat-panel__message-body ${isAssistant ? 'assistant' : 'user'}`}>
        <MessageRetryContext.Provider value={retryAction}>
          <MessageContent message={displayedMessage} isLoading={isLoading} />
        </MessageRetryContext.Provider>
        {!isLoading && isAssistant && (
          <div className="chat-panel__message-actions">
            <Tooltip title="复制" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
              <button
                type="button"
                className="chat-panel__message-action-btn"
                onClick={handleCopy}
                disabled={actionsDisabled}>
                {copied ? <Check size={15} className="chat-panel__message-action-icon copied" /> : <Copy size={15} className="chat-panel__message-action-icon" />}
              </button>
            </Tooltip>
            <Tooltip title="重试" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
              <button
                type="button"
                className="chat-panel__message-action-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onRetryAssistantMessage && onRetryAssistantMessage(message);
                }}
                disabled={actionsDisabled}>
                <RefreshCw size={15} className="chat-panel__message-action-icon" />
              </button>
            </Tooltip>
            <Tooltip title="删除" mouseEnterDelay={1} styles={{ body: { fontSize: 12 } }}>
              <button
                type="button"
                className="chat-panel__message-action-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteAssistantMessage && onDeleteAssistantMessage(message);
                }}
                disabled={actionsDisabled}>
                <Trash2 size={15} className="chat-panel__message-action-icon" />
              </button>
            </Tooltip>
            <div className="chat-panel__message-tokens">
              {canUseLiveAssistantTokens ? (
                <Provider store={appStore}>
                  <LiveAssistantMessageTokens
                    fallbackMessage={message}
                    storeAssistantMessageId={storeAssistantMessageId}
                  />
                </Provider>
              ) : (
                <MessageTokens message={message} />
              )}
            </div>
          </div>
        )}
      </div>
      {!isLoading && isUser && (
        <div className="chat-panel__message-actions chat-panel__message-actions--user">
          {canShowDraftApiAction && showDraftApiFormat ? (
            <div className="chat-panel__message-api-tip">替换token为你的API KEY</div>
          ) : null}
          {canShowDraftAgentAction && showDraftAgentFormat ? (
            <div className="chat-panel__message-api-tip">复制到其他agent使用</div>
          ) : null}
          {canShowDraftCozeAction && showDraftCozeFormat ? (
            <div className="chat-panel__message-api-tip">复制到扣子工作流使用</div>
          ) : null}
          {(canShowDraftAgentAction || canShowDraftApiAction || canShowDraftCozeAction) ? (
            <>
              <Tooltip title="文字" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
                <button
                  type="button"
                  className={`chat-panel__message-action-btn ${draftDisplayMode === 'text' ? 'is-active' : ''}`}
                  onClick={handleConvertToText}
                  disabled={actionsDisabled}>
                  <Type size={15} className="chat-panel__message-action-icon" />
                </button>
              </Tooltip>
              {canShowDraftAgentAction ? (
                <Tooltip title="Agent" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
                  <button
                    type="button"
                    className={`chat-panel__message-action-btn ${showDraftAgentFormat ? 'is-active' : ''}`}
                    onClick={handleConvertToAgent}
                    disabled={actionsDisabled}>
                    <Bot size={15} className="chat-panel__message-action-icon" />
                  </button>
                </Tooltip>
              ) : null}
              {canShowDraftApiAction ? (
                <Tooltip title="API" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
                  <button
                    type="button"
                    className={`chat-panel__message-action-btn ${showDraftApiFormat ? 'is-active' : ''}`}
                    onClick={handleConvertToApi}
                    disabled={actionsDisabled}>
                    <Code size={15} className="chat-panel__message-action-icon" />
                  </button>
                </Tooltip>
              ) : null}
              {canShowDraftCozeAction ? (
                <Tooltip title="Coze" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
                  <button
                    type="button"
                    className={`chat-panel__message-action-btn ${showDraftCozeFormat ? 'is-active' : ''}`}
                    onClick={handleConvertToCoze}
                    disabled={actionsDisabled}>
                    <img src={CozeIcon} alt="" className="chat-panel__message-action-image-icon" />
                  </button>
                </Tooltip>
              ) : null}
            </>
          ) : null}
          <Tooltip title="复制" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
            <button
              type="button"
              className="chat-panel__message-action-btn"
              onClick={handleCopy}
              disabled={actionsDisabled}>
              {copied ? <Check size={15} className="chat-panel__message-action-icon copied" /> : <Copy size={15} className="chat-panel__message-action-icon" />}
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
};

const areModelOptionsEqual = (prevOptions = [], nextOptions = []) => {
  if (prevOptions === nextOptions) return true;
  if (!Array.isArray(prevOptions) || !Array.isArray(nextOptions)) return false;
  if (prevOptions.length !== nextOptions.length) return false;
  for (let i = 0; i < prevOptions.length; i += 1) {
    const prev = prevOptions[i];
    const next = nextOptions[i];
    if (typeof prev !== typeof next) return false;
    if (typeof prev === 'string') {
      if (prev !== next) return false;
      continue;
    }
    const prevValue = prev?.value || prev?.name || prev?.id || '';
    const nextValue = next?.value || next?.name || next?.id || '';
    const prevLabel = prev?.label || prev?.name || prev?.value || prev?.id || '';
    const nextLabel = next?.label || next?.name || next?.value || next?.id || '';
    const prevIcon = prev?.icon || prev?.iconUrl || prev?.black_icon || '';
    const nextIcon = next?.icon || next?.iconUrl || next?.black_icon || '';
    if (prevValue !== nextValue || prevLabel !== nextLabel || prevIcon !== nextIcon) {
      return false;
    }
  }
  return true;
};

export default React.memo(MessageItem, (prevProps, nextProps) => {
  const prevMessage = prevProps.message || {};
  const nextMessage = nextProps.message || {};
  const prevError = buildErrorSignature(prevMessage.error);
  const nextError = buildErrorSignature(nextMessage.error);
  const prevUsage = buildUsageSignature(prevMessage.usage);
  const nextUsage = buildUsageSignature(nextMessage.usage);
  const prevUsageSteps = buildUsageStepsSignature(prevMessage.usageSteps);
  const nextUsageSteps = buildUsageStepsSignature(nextMessage.usageSteps);
  const prevMetrics = buildMetricsSignature(prevMessage.metrics);
  const nextMetrics = buildMetricsSignature(nextMessage.metrics);
  return (
    prevProps.role === nextProps.role
    && prevProps.onCopyAssistantMessage === nextProps.onCopyAssistantMessage
    && prevProps.onRetryAssistantMessage === nextProps.onRetryAssistantMessage
    && prevProps.onDeleteAssistantMessage === nextProps.onDeleteAssistantMessage
    && prevProps.hasConnectedExternalAgent === nextProps.hasConnectedExternalAgent
    && prevProps.actionsDisabled === nextProps.actionsDisabled
    && prevProps.isLoading === nextProps.isLoading
    && prevProps.model === nextProps.model
    && areModelOptionsEqual(prevProps.modelOptions, nextProps.modelOptions)
    && prevProps.formatMessageTime === nextProps.formatMessageTime
    && prevProps.formatModelDisplayName === nextProps.formatModelDisplayName
    && prevProps.userName === nextProps.userName
    && prevProps.userAvatar === nextProps.userAvatar
    && prevMessage.id === nextMessage.id
    && prevMessage.content === nextMessage.content
    && prevMessage.role === nextMessage.role
    && prevMessage.createdAt === nextMessage.createdAt
    && prevMessage.updatedAt === nextMessage.updatedAt
    && prevMessage.retryStatusText === nextMessage.retryStatusText
    && prevUsage === nextUsage
    && prevUsageSteps === nextUsageSteps
    && prevMetrics === nextMetrics
    && buildImageAttachmentSignature(prevMessage.imageAttachments) === buildImageAttachmentSignature(nextMessage.imageAttachments)
    && buildDraftRequestSignature(prevMessage.draftRequest) === buildDraftRequestSignature(nextMessage.draftRequest)
    && buildDraftExportRequestSignature(prevMessage.draftExportRequest) === buildDraftExportRequestSignature(nextMessage.draftExportRequest)
    && buildDraftDownloadRequestSignature(prevMessage.draftDownloadRequest) === buildDraftDownloadRequestSignature(nextMessage.draftDownloadRequest)
    && buildDraftModifyRequestSignature(prevMessage.draftModifyRequest) === buildDraftModifyRequestSignature(nextMessage.draftModifyRequest)
    && buildTextAddRequestSignature(prevMessage.textAddRequest) === buildTextAddRequestSignature(nextMessage.textAddRequest)
    && buildPresetAddRequestSignature(prevMessage.presetAddRequest) === buildPresetAddRequestSignature(nextMessage.presetAddRequest)
    && buildVoiceConversionRequestSignature(prevMessage.voiceConversionRequest) === buildVoiceConversionRequestSignature(nextMessage.voiceConversionRequest)
    && buildSeedAudioRequestSignature(prevMessage.seedAudioRequest) === buildSeedAudioRequestSignature(nextMessage.seedAudioRequest)
    && buildSpeechRequestSignature(prevMessage.speechRequest) === buildSpeechRequestSignature(nextMessage.speechRequest)
    && buildAudioAddRequestSignature(prevMessage.audioAddRequest) === buildAudioAddRequestSignature(nextMessage.audioAddRequest)
    && buildAiVideoRequestSignature(prevMessage.aiVideoRequest) === buildAiVideoRequestSignature(nextMessage.aiVideoRequest)
    && buildDigitalHumanRequestSignature(prevMessage.digitalHumanRequest) === buildDigitalHumanRequestSignature(nextMessage.digitalHumanRequest)
    && buildDraftInspectRequestSignature(prevMessage.draftInspectRequest) === buildDraftInspectRequestSignature(nextMessage.draftInspectRequest)
    && JSON.stringify(prevMessage.reversePromptRequest) === JSON.stringify(nextMessage.reversePromptRequest)
    && JSON.stringify(prevMessage.subtitleRecognitionRequest) === JSON.stringify(nextMessage.subtitleRecognitionRequest)
    && JSON.stringify(prevMessage.subtitleStoryboardRequest) === JSON.stringify(nextMessage.subtitleStoryboardRequest)
    && prevError === nextError
  );
});
