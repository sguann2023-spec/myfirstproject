const MODE_ALIASES = {
  'lip-sync': 'lip_sync',
  lip_sync: 'lip_sync',
  lips: 'lip_sync',
  'jimeng-avatar': 'omni',
  omni: 'omni',
  'seedance-avatar': 'seedance',
  seedance: 'seedance',
};
const DIGITAL_HUMAN_PACKAGING_TEMPLATES = new Set([
  'knowledge_pip',
  'traditional_bilingual',
  'national_classic',
  'basic_yellow_white',
  'classic_grass_green',
  'international_orange_bilingual',
  'eye_catching_green_bilingual',
  'intellectual_red',
  'classical_dark_brown',
  'fisheye_ins',
  'luxury_white_bilingual',
]);

export const normalizeDigitalHumanMode = (value = '') => (
  MODE_ALIASES[String(value || '').trim()] || ''
);

export const normalizeDigitalHumanRequestPayload = (request = {}, fallbackCopywriting = '') => {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null;

  const mode = normalizeDigitalHumanMode(request.mode);
  const copywriting = String(request.copywriting || request.text || fallbackCopywriting || '').trim();
  const voiceId = String(request.voice_id || request.voiceId || '').trim();
  const voiceProvider = String(request.voice_provider || request.voiceProvider || request.provider || '').trim();
  const imageUrl = String(request.image_url || request.imageUrl || '').trim();
  const videoUrl = String(request.video_url || request.videoUrl || '').trim();
  const prompt = String(request.prompt || '').trim();
  const packagingTemplate = String(request.packaging_template || request.packagingTemplate || '').trim();
  const outputResolution = Number(request.output_resolution ?? request.outputResolution);

  if (!mode || !copywriting || !voiceId) return null;
  if (mode === 'lip_sync' && !videoUrl) return null;
  if ((mode === 'omni' || mode === 'seedance') && !imageUrl) return null;

  return {
    mode,
    copywriting,
    voice_id: voiceId,
    ...(voiceProvider ? { voice_provider: voiceProvider } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(videoUrl ? { video_url: videoUrl } : {}),
    ...(prompt ? { prompt } : {}),
    ...(DIGITAL_HUMAN_PACKAGING_TEMPLATES.has(packagingTemplate)
      ? { packaging_template: packagingTemplate }
      : {}),
    ...(mode === 'omni' && (outputResolution === 720 || outputResolution === 1080)
      ? { output_resolution: outputResolution }
      : {}),
  };
};

export const buildDigitalHumanRequestApiCurl = (request = {}) => {
  const normalized = normalizeDigitalHumanRequestPayload(request, request?.copywriting);
  if (!normalized) return '';

  const config = normalized.mode === 'lip_sync'
    ? {
      endpoint: '/cut_jianying/digital_human/create',
      payload: {
        audio_url: '<generated_audio_url>',
        video_url: normalized.video_url,
      },
    }
    : normalized.mode === 'seedance'
      ? {
        endpoint: '/llm/digital_human/seedance/submit',
        payload: {
          image_url: normalized.image_url,
          copywriting: normalized.copywriting,
          voice_id: normalized.voice_id,
        },
      }
      : {
        endpoint: '/cut_jianying/digital_human/omni/submit',
        payload: {
          audio_url: '<generated_audio_url>',
          image_url: normalized.image_url,
          prompt: normalized.prompt,
          output_resolution: normalized.output_resolution === 720 ? 720 : 1080,
        },
      };

  return [
    `curl --location 'https://open.vectcut.com${config.endpoint}' \\`,
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data '${JSON.stringify(config.payload, null, 4)}'`,
  ].join('\n');
};
