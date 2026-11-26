// Readonly API fixtures. No endpoint implementation or visual component is imported here.
export const fixtureImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><rect width="160" height="120" rx="12" fill="#e2e6ff"/><circle cx="120" cy="30" r="15" fill="#ffd77c"/><path d="M0 110L50 45L95 95L125 65L160 110" fill="#7d92d8"/></svg>')}`;
const copy = (value) => structuredClone(value);
const readonly = async () => { throw new Error('DEV fixture: submissions, uploads and mutations are disabled.'); };
const drafts = [
  { draft_id: 'fixture-draft-01', draft_name: '测试草稿 · 竖屏宣传片', width: 1080, height: 1920 },
  { draft_id: 'fixture-draft-02', draft_name: '这是用于检查超长草稿名称省略与对齐的只读测试草稿', width: 1920, height: 1080 },
  { draft_id: 'fixture-draft-03', draft_name: '测试草稿 · 字幕与音频', width: 1080, height: 1080 },
];
export const draftList = async ({ offset = 0, limit = 20 } = {}) => ({ success: true, drafts: copy(drafts.slice(offset, offset + limit)) });
export const searchDraft = async ({ draft_id } = {}) => ({ success: true, draft: copy(drafts.find((draft) => draft.draft_id === draft_id) || drafts[0]) });
export const queryScript = async () => ({ success: true, output: {
  canvas_config: { width: 1080, height: 1920 }, duration: 12000000,
  tracks: [{ id: 'fixture-video', name: '主视频', type: 'video', relative_index: 0, segments: [] }, { id: 'fixture-text', name: '字幕轨道', type: 'text', relative_index: 1, segments: [] }, { id: 'fixture-audio', name: '背景音乐', type: 'audio', segments: [] }],
  materials: { videos: [], texts: [], audios: [] },
} });

const imageModels = [
  ['seedream-4.5', 'seedream-4.5'], ['nano_banana_pro', 'Nano Banana Pro'], ['nano_banana', 'Nano Banana'],
].map(([model, display_name]) => ({ model, display_name, description: '只读模型数据 · 用于布局验证', reference_supported: true, badges: [], resolutions: {
  '1K': [{ ratio: '1:1', size: '1024x1024' }],
  '2K': [{ ratio: '16:9', size: '2560x1440' }, { ratio: '9:16', size: '1440x2560' }],
} }));
const videoModels = [
  ['seedance-2.0', 'Seedance 2.0'], ['seedance-2.0-fast', 'Seedance 2.0 Fast'], ['seedance-1.5-pro', 'Seedance 1.5 Pro'],
].map(([model, display_name]) => ({ model, display_name, description: '只读模型数据 · 不执行生成', badges: [], reference_supported: true, first_last_frame_supported: true, multi_image_reference_supported: true, generate_audio_supported: true, seedance_offline_supported: true, super_resolve_supported: true, gen_durations: [5, 10, 15], generation_modes: [
  { value: 'text_to_video', label: '文生视频' }, { value: 'first_frame', label: '首帧生成' }, { value: 'first_last_frame', label: '首尾帧' }, { value: 'reference', label: '参考生成' },
], resolutions: { '720p': [{ ratio: '9:16', size: '720x1280' }, { ratio: '1:1', size: '960x960' }, { ratio: '16:9', size: '1280x720' }], '1080p': [{ ratio: '9:16', size: '1080x1920' }, { ratio: '16:9', size: '1920x1080' }] } }));
export const getImageGenerationCapabilities = async () => ({ models: copy(imageModels) });
export const getVideoGenerationCapabilities = async () => ({ models: copy(videoModels) });

export const fixtureVoice = { global_voice_id: 'fixture-voice-01', title: '测试音色', providers: 'minimax', gender: 'female', language: 'zh', readable_language: '中文', avatar_url: fixtureImage, try_listen_url: '', voice_persona_desc: '只读演示音色', favorited: false };
const voices = [fixtureVoice, { ...fixtureVoice, global_voice_id: 'fixture-voice-02', title: '用于测试长音色名称的演示声音', providers: 'elevenlabs' }, { ...fixtureVoice, global_voice_id: 'fixture-voice-03', title: '测试男声', providers: 'fish', gender: 'male' }];
export const getVoiceLibrary = async ({ offset = 0, limit = 24, provider, gender, language } = {}) => {
  const filtered = voices.filter((voice) => (!provider || voice.providers === provider) && (!gender || voice.gender === gender) && (!language || voice.language === language));
  return { success: true, items: copy(filtered.slice(offset, offset + limit)), pagination: { offset, limit, total: filtered.length } };
};
export const getVoiceFavoritesLibrary = getVoiceLibrary;
export const getMyVoiceLibrary = getVoiceLibrary;
export const getVoiceFavoriteIds = async () => ({ success: true, items: [] });
export const getVoiceLibraryFilterOptions = async () => ({ success: true, options: { provider: ['minimax', 'elevenlabs', 'fish'], gender: ['female', 'male'], language: ['zh', 'en'] }, readable_language: { zh: '中文', en: '英语' } });
export const getTtsClonePrice = async ({ provider = 'fish' } = {}) => ({ success: true, provider, billing_mode: 'membership_slots', slot_limit: 0, remaining_slots: 0, resource_points_per_unit: 0 });
export const getTtsSpeechPrice = async () => ({ success: true, items: [] });
export const getDigitalHumanAvatarExamples = async () => ({ success: true, items: [
  { avatar_id: 'official_fixture_01', title: '测试数字形象', cover_url: fixtureImage, demo_url: '', voice_id: 'fixture-voice-02', voice_provider: 'elevenlabs', can_use_seedance: true },
  { avatar_id: 'official_fixture_02', title: '超长数字人形象名称用于验证选择器宽度', cover_url: fixtureImage, demo_url: '', voice_id: 'fixture-voice-01', voice_provider: 'minimax', can_use_seedance: false },
] });
export const getDigitalHumanPricing = async () => ({ success: true, items: ['seedance_image_driver', 'omni_image_driver', 'lip_sync'].map((key) => ({ key, resource_points_per_unit: 2 })) });
export const getMembershipSummary = async () => ({ is_active: true, membership_level: 'pro' });
export const getSubtitleRecognitionPricing = async () => ({ success: true, prices: [
  { effect_mode: 'asr', resource_points_per_unit: 2 }, { effect_mode: 'sta', resource_points_per_unit: 4 },
] });
export const getProjectPricing = async () => ({ success: true, items: [] });
export const presetList = async () => ({ success: true, data: [{ preset_id: 'fixture-preset-01', name: '测试预设', image_url: fixtureImage, width: 1080, height: 1920, duration_seconds: 5, materials_json: [] }] });
export const presetGroups = async () => ({ success: true, data: [{ group_id: 'fixture-group', name: '只读测试分组', preset_count: 1 }] });
export const presetUngroupedCount = async () => ({ success: true, data: { count: 1 } });

export {
  readonly as addVoiceFavorite, readonly as removeVoiceFavorite, readonly as deleteMyTtsVoice,
  readonly as updateMyVoiceProfile, readonly as cloneTtsVoiceWithElevenlabs,
  readonly as cloneTtsVoiceWithFish, readonly as cloneTtsVoiceWithMinimax,
  readonly as createDigitalHumanAvatarLibrary, readonly as deleteDigitalHumanAvatarLibrary,
  readonly as uploadToOSSWithProgress, readonly as uploadDigitalHumanAvatarCover,
  readonly as createPresetGroup, readonly as updatePresetGroup, readonly as deletePresetGroup,
};
