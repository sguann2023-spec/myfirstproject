import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { AutoComplete, Dropdown, InputNumber, Select, Slider, message } from 'antd';
import { ChevronDown, Clock3, Music, Plus, SlidersHorizontal } from 'lucide-react';
import DraftSelect from '../DraftSelect/index';
import AudioPreview from '../RecognizationSubtitleToolDetail/AudioPreview';
import PinnedDraftTrackView from '../../renderer/src/pages/home/Inputbar/components/PinnedDraftTrackView/PinnedDraftTrackView';
import { queryScript } from '../../api/capcut';
import '../TextAddDetail/index.css';
import '../PresetAddDetail/index.css';
import '../RecognizationSubtitleToolDetail/index.css';
import './index.css';
import { BACKGROUND_MUSIC_LIBRARY, SOUND_EFFECT_LIBRARY } from './cloudAudioLibrary';

const AUDIO_EXTENSIONS = ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav', 'wma'];
const CLOUD_AUDIO_LIBRARY_BY_TYPE = {
  music: BACKGROUND_MUSIC_LIBRARY,
  sound: SOUND_EFFECT_LIBRARY,
};
const CLOUD_AUDIO_SEARCH_LIMIT = 80;

const AUDIO_SETTINGS_TABS = [
  { key: 'settings', label: '设置', icon: SlidersHorizontal },
  { key: 'timeline', label: '时间线', icon: Clock3 },
];

const AUDIO_SCENE_EFFECTS = [
  { label: '8bit', value: '8bit', paid: false, params: [{ name: 'change_voice_param_pitch_shift', label: '音调', defaultValue: 50 }, { name: 'change_voice_param_timbre', label: '音色', defaultValue: 100 }, { name: 'change_voice_param_strength', label: '强度', defaultValue: 100 }] },
  { label: '低保真', value: '低保真', paid: false, params: [{ name: '强弱', label: '强弱', defaultValue: 100 }] },
  { label: '合成器', value: '合成器', paid: false, params: [{ name: '强弱', label: '强弱', defaultValue: 100 }] },
  { label: '回音', value: '回音', paid: false, params: [{ name: 'change_voice_param_quantity', label: '数量', defaultValue: 80 }, { name: 'change_voice_param_strength', label: '强度', defaultValue: 76 }] },
  { label: '扩音器', value: '扩音器', paid: false, params: [{ name: '强弱', label: '强弱', defaultValue: 100 }] },
  { label: '水下', value: '水下', paid: false, params: [{ name: '深度', label: '深度', defaultValue: 50 }] },
  { label: '没电了', value: '没电了', paid: false, params: [{ name: '强弱', label: '强弱', defaultValue: 100 }] },
  { label: '环绕音', value: '环绕音', paid: false, params: [{ name: 'change_voice_param_center_position', label: '中心位置', defaultValue: 50 }, { name: 'change_voice_param_surrounding_frequency', label: '环绕频率', defaultValue: 50 }] },
  { label: '电音', value: '电音', paid: false, params: [{ name: '强弱', label: '强弱', defaultValue: 100 }] },
  { label: '颤音', value: '颤音', paid: false, params: [{ name: '频率', label: '频率', defaultValue: 71 }, { name: '幅度', label: '幅度', defaultValue: 91 }] },
  { label: '麦霸', value: '麦霸', paid: false, params: [{ name: '空间大小', label: '空间大小', defaultValue: 5 }, { name: '强弱', label: '强弱', defaultValue: 45 }] },
  { label: '黑胶', value: '黑胶', paid: false, params: [{ name: '强弱', label: '强弱', defaultValue: 100 }, { name: '噪点', label: '噪点', defaultValue: 74 }] },
  { label: '3d环绕音', value: '3d环绕音', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 0 }] },
  { label: 'Autotune', value: 'Autotune', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '下雨', value: '下雨', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }, { name: 'noise', label: '噪点', defaultValue: 74 }] },
  { label: '乡村大喇叭', value: '乡村大喇叭', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '人声增强', value: '人声增强', paid: true, params: [{ name: '强弱', label: '强弱', defaultValue: 100 }] },
  { label: '低音增强', value: '低音增强', paid: true, params: [{ name: 'change_voice_param_strength', label: '强度', defaultValue: 100 }] },
  { label: '停车场', value: '停车场', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }] },
  { label: '冰川之下', value: '冰川之下', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }, { name: 'noise', label: '噪点', defaultValue: 74 }] },
  { label: '刮风', value: '刮风', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }, { name: 'noise', label: '噪点', defaultValue: 74 }] },
  { label: '噪音混响', value: '噪音混响', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }] },
  { label: '地狱', value: '地狱', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }, { name: 'noise', label: '噪点', defaultValue: 74 }] },
  { label: '复古收音机', value: '复古收音机', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '失真电子', value: '失真电子', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '对讲机', value: '对讲机', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '房间', value: '房间', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '捂嘴', value: '捂嘴', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }] },
  { label: '教堂', value: '教堂', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '教室', value: '教室', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '机器人2', value: '机器人2', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }] },
  { label: '沙漠', value: '沙漠', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }, { name: 'noise', label: '噪点', defaultValue: 74 }] },
  { label: '派对', value: '派对', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }, { name: 'noise', label: '噪点', defaultValue: 74 }] },
  { label: '深海回声', value: '深海回声', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '电话', value: '电话', paid: true, params: [{ name: '强弱', label: '强弱', defaultValue: 70 }] },
  { label: '留声机', value: '留声机', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '百老汇', value: '百老汇', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }] },
  { label: '空灵感', value: '空灵感', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '空谷回声', value: '空谷回声', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '老式电话', value: '老式电话', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '言灵术', value: '言灵术', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }] },
  { label: '豪宅回声', value: '豪宅回声', paid: true, params: [{ name: '强度', label: '强度', defaultValue: 100 }] },
  { label: '迷幻电子', value: '迷幻电子', paid: true, params: [{ name: 'strength', label: '强度', defaultValue: 100 }, { name: 'noise', label: '噪点', defaultValue: 74 }] },
];

const AUDIO_SCENE_EFFECT_OPTIONS = [
  { label: '无', value: '' },
  ...AUDIO_SCENE_EFFECTS.map((effect) => ({ label: effect.label, value: effect.value })),
];

export const DEFAULT_AUDIO_ADD_SETTINGS = {
  audioPath: '',
  audioName: '',
  previewSource: '',
  mediaDuration: 0,
  volumeDb: 0,
  playbackSpeed: 1,
  fadeInDuration: 0,
  fadeOutDuration: 0,
  targetStart: 0,
  sourceStart: null,
  sourceEnd: null,
  trackName: 'audio_track',
  trackMode: 'new',
  sceneEffectEnabled: false,
  sceneEffectType: '',
  sceneEffectParams: {},
  audioSourceType: 'local',
  cloudAudioId: '',
  cloudAudioType: '',
  cloudAudioUrl: '',
  musicId: '',
  music_id: '',
};

const clampNumber = (value, min, max, fallback) => {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) return fallback;
  return Math.min(max, Math.max(min, resolved));
};
const normalizeTime = (value, fallback = 0) => Math.round(clampNumber(value, 0, 86400, fallback) * 100) / 100;
const normalizeSpeed = (value, fallback = 1) => Math.round(clampNumber(value, 0.1, 5, fallback) * 100) / 100;
const normalizeOptionalTime = (value, fallback = null) => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  return normalizeTime(value, fallback ?? 0);
};
const normalizeVolumeDb = (value, fallback = 0) => Math.round(clampNumber(value, -60, 20, fallback) * 10) / 10;
const normalizePercent = (value, fallback = 0) => Math.round(clampNumber(value, 0, 100, fallback));
const resolveVolumeDb = (settings = DEFAULT_AUDIO_ADD_SETTINGS) => {
  if (settings?.volumeDb !== undefined) return normalizeVolumeDb(settings.volumeDb, DEFAULT_AUDIO_ADD_SETTINGS.volumeDb);
  if (settings?.volumePercent !== undefined) {
    const percent = clampNumber(settings.volumePercent, 0, 200, 100);
    return percent <= 0 ? -60 : normalizeVolumeDb(20 * Math.log10(percent / 100), 0);
  }
  return DEFAULT_AUDIO_ADD_SETTINGS.volumeDb;
};
const volumeDbToRequestValue = (value) => {
  const volumeDb = normalizeVolumeDb(value, DEFAULT_AUDIO_ADD_SETTINGS.volumeDb);
  return volumeDb <= -60 ? -100 : volumeDb;
};
const getAudioSceneEffect = (effectType) => AUDIO_SCENE_EFFECTS.find((effect) => effect.value === effectType) || null;
const getAudioSceneEffectParamDefaults = (effectType) => {
  const effect = getAudioSceneEffect(effectType);
  if (!effect) return {};
  return effect.params.reduce((result, param) => ({ ...result, [param.name]: normalizePercent(param.defaultValue, 0) }), {});
};
const buildAudioSceneEffectParams = (settings = DEFAULT_AUDIO_ADD_SETTINGS) => {
  const effect = getAudioSceneEffect(settings?.sceneEffectType || settings?.effect_type || settings?.effectType);
  if (!effect) return [];
  const values = settings?.sceneEffectParams && typeof settings.sceneEffectParams === 'object' ? settings.sceneEffectParams : {};
  return effect.params.map((param) => normalizePercent(values[param.name], param.defaultValue));
};

const filterCloudAudioItems = (items, searchValue) => {
  const keyword = String(searchValue || '').trim().toLowerCase();
  const source = Array.isArray(items) ? items : [];
  const filtered = keyword
    ? source.filter((item) => [item.id, item.title, ...(item.categories || [])].join(' ').toLowerCase().includes(keyword))
    : source;
  return filtered.slice(0, CLOUD_AUDIO_SEARCH_LIMIT);
};

const buildCloudAudioOptions = (items) => items.map((item) => ({
  value: item.id,
  label: item.title,
  item,
}));

const normalizePath = (value) => String(value || '').replace(/\\/g, '/');
const getBaseName = (value) => {
  const normalized = normalizePath(value).replace(/\/$/, '');
  return normalized.split('/').filter(Boolean).pop() || normalized;
};
const toMediaSrc = (value) => {
  const normalized = normalizePath(value).trim();
  if (!normalized) return '';
  if (/^(blob:|data:|https?:\/\/|file:\/\/)/i.test(normalized)) return normalized;
  const pathname = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${pathname.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;
};
const toArrayBuffer = (value) => {
  if (!value) return null;
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  if (Array.isArray(value?.data)) return Uint8Array.from(value.data).buffer;
  return null;
};
const isAudioFile = (file) => {
  const ext = String(file?.extension || file?.path || file?.name || '').split('.').pop().toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext);
};

const audioTrackNames = (script) => {
  const tracks = Array.isArray(script?.tracks) ? script.tracks : (script?.tracks && typeof script.tracks === 'object' ? Object.values(script.tracks) : []);
  return tracks
    .filter((track) => ['audio', 'extract_music'].includes(String(track?.type || '').trim().toLowerCase()))
    .map((track) => String(track?.name || track?.track_name || '').trim())
    .filter(Boolean);
};
const allTrackNames = (script) => {
  const tracks = Array.isArray(script?.tracks) ? script.tracks : (script?.tracks && typeof script.tracks === 'object' ? Object.values(script.tracks) : []);
  return tracks.map((track) => String(track?.name || track?.track_name || '').trim()).filter(Boolean);
};
const uniqueTrackName = (baseName, usedNames) => {
  const used = new Set(usedNames);
  const base = String(baseName || DEFAULT_AUDIO_ADD_SETTINGS.trackName).trim().slice(0, 100) || DEFAULT_AUDIO_ADD_SETTINGS.trackName;
  let name = base;
  let count = 2;
  while (used.has(name)) {
    const suffix = `_${count++}`;
    name = base.slice(0, 100 - suffix.length) + suffix;
  }
  return name;
};
const resolveAudioTrack = (settings, script) => {
  const names = audioTrackNames(script);
  const inputTrackName = settings?.trackMode === 'new'
    ? (settings?.newTrackName || settings?.trackName)
    : settings?.trackName;
  const requestedName = String(inputTrackName || DEFAULT_AUDIO_ADD_SETTINGS.trackName).trim() || DEFAULT_AUDIO_ADD_SETTINGS.trackName;
  const trackName = settings?.trackMode === 'new'
    ? uniqueTrackName(requestedName, allTrackNames(script))
    : requestedName;
  const trackMode = settings?.trackMode === 'existing' && names.includes(trackName) ? 'existing' : 'new';
  return {
    ...settings,
    trackMode,
    trackName,
    newTrackName: trackMode === 'new' ? trackName : requestedName,
  };
};
const resolveAudioTimes = (settings) => {
  const duration = normalizeTime(settings?.mediaDuration, 0);
  const speed = normalizeSpeed(settings?.playbackSpeed ?? settings?.speed, DEFAULT_AUDIO_ADD_SETTINGS.playbackSpeed);
  const sourceStart = normalizeOptionalTime(settings?.sourceStart, 0);
  const sourceEnd = normalizeOptionalTime(settings?.sourceEnd, duration || null);
  const safeSourceEnd = duration ? Math.min(duration, Math.max(sourceEnd ?? duration, sourceStart)) : sourceEnd;
  const clipDuration = safeSourceEnd !== null ? Math.max(0, safeSourceEnd - sourceStart) : duration;
  const playbackDuration = normalizeTime(speed > 0 ? clipDuration / speed : clipDuration, clipDuration);
  const targetStart = normalizeTime(settings?.targetStart, 0);
  return { sourceStart, sourceEnd: safeSourceEnd, targetStart, targetEnd: targetStart + playbackDuration, duration, clipDuration, playbackDuration, speed };
};

export const buildAudioAddRequestParams = (settings = DEFAULT_AUDIO_ADD_SETTINGS) => {
  const times = resolveAudioTimes(settings);
  const trackName = String(settings?.trackName || DEFAULT_AUDIO_ADD_SETTINGS.trackName).trim();
  const volumeDb = resolveVolumeDb(settings);
  const speed = normalizeSpeed(settings?.playbackSpeed ?? settings?.speed, DEFAULT_AUDIO_ADD_SETTINGS.playbackSpeed);
  const sceneEffectType = settings?.sceneEffectEnabled ? String(settings?.sceneEffectType || '').trim() : '';
  const sceneEffectParams = buildAudioSceneEffectParams(settings);
  const musicId = String(settings?.musicId || settings?.music_id || settings?.cloudAudioId || '').trim();
  const useMusicId = musicId && String(settings?.audioSourceType || '').trim() !== 'local';
  return {
    ...(useMusicId ? { music_id: musicId } : { audio_url: String(settings?.audioPath || '').trim() }),
    target_start: times.targetStart,
    ...(times.sourceStart > 0 ? { start: times.sourceStart } : {}),
    ...(times.sourceEnd !== null && times.sourceEnd > 0 ? { end: times.sourceEnd } : {}),
    ...(times.duration > 0 ? { duration: times.duration } : {}),
    volume: volumeDbToRequestValue(volumeDb),
    ...(speed !== DEFAULT_AUDIO_ADD_SETTINGS.playbackSpeed ? { speed } : {}),
    fade_in_duration: normalizeTime(settings?.fadeInDuration, 0),
    fade_out_duratioin: normalizeTime(settings?.fadeOutDuration, 0),
    ...(sceneEffectType ? { effect_type: sceneEffectType } : {}),
    ...(sceneEffectType && sceneEffectParams.length ? { effect_params: sceneEffectParams } : {}),
    ...(trackName ? { track_name: trackName } : {}),
  };
};

export const buildAudioAddSettingsPrompt = (settings = DEFAULT_AUDIO_ADD_SETTINGS) => {
  const params = buildAudioAddRequestParams(settings);
  return [
    '音频设置：',
    `文件：${params.audio_url || params.music_id || settings.audioName}`,
    params.music_id ? `素材ID：${params.music_id}` : '',
    `音量：${params.volume}dB`,
    params.speed ? `变速：${params.speed}x` : '',
    `淡入淡出：${JSON.stringify({ fade_in_duration: params.fade_in_duration, fade_out_duratioin: params.fade_out_duratioin })}`,
    params.effect_type ? `场景音：${JSON.stringify({ effect_type: params.effect_type, effect_params: params.effect_params })}` : '',
    `时间线：${JSON.stringify({ target_start: params.target_start, start: params.start, end: params.end, duration: params.duration, track_name: params.track_name })}`,
  ].filter(Boolean).join('\n');
};

export const getAudioAddToolSendState = ({ selectedDraftIds = [], settings = DEFAULT_AUDIO_ADD_SETTINGS } = {}) => {
  const hasSelectedDraft = Array.isArray(selectedDraftIds) && selectedDraftIds.length > 0;
  const hasAudio = Boolean(String(settings?.audioPath || settings?.cloudAudioId || settings?.musicId || settings?.music_id || '').trim());
  return {
    canSend: hasSelectedDraft && hasAudio,
    disabledReason: !hasSelectedDraft ? '必须选择一个草稿添加音频' : !hasAudio ? '请选择音频文件' : '',
  };
};

const AudioAddToolDetail = ({ disabled = false, onBack, selectedDraftIds = [], onSelectedDraftIdsChange = null, onSettingsChange = null }) => {
  const dragCounterRef = React.useRef(0);
  const previewObjectUrlRef = React.useRef('');
  const [settingsOpen, setSettingsOpen] = React.useState(true);
  const [activeSettingsTab, setActiveSettingsTab] = React.useState('settings');
  const [isBasicSectionExpanded, setIsBasicSectionExpanded] = React.useState(true);
  const [isSpeedSectionExpanded, setIsSpeedSectionExpanded] = React.useState(true);
  const [isSceneEffectSectionExpanded, setIsSceneEffectSectionExpanded] = React.useState(false);
  const [settings, setSettings] = React.useState({ ...DEFAULT_AUDIO_ADD_SETTINGS });
  const [previewScript, setPreviewScript] = React.useState(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState('');
  const [isDraggingAudio, setIsDraggingAudio] = React.useState(false);
  const [previewFile, setPreviewFile] = React.useState(null);
  const [previewAudioData, setPreviewAudioData] = React.useState(null);
  const [musicLibrarySearch, setMusicLibrarySearch] = React.useState('');
  const [soundLibrarySearch, setSoundLibrarySearch] = React.useState('');
  const [cloudAudioResolving, setCloudAudioResolving] = React.useState(false);
  const selectedDraftId = String(selectedDraftIds?.[0] || '').trim();
  const hasSelectedDraft = Boolean(selectedDraftId);
  const effectiveSettings = React.useMemo(() => resolveAudioTrack(settings, previewScript), [settings, previewScript]);
  const times = React.useMemo(() => resolveAudioTimes(effectiveSettings), [effectiveSettings]);
  const trackNames = React.useMemo(() => audioTrackNames(previewScript), [previewScript]);
  const locked = disabled || previewLoading || Boolean(previewError);
  const musicLibraryOptions = React.useMemo(() => buildCloudAudioOptions(filterCloudAudioItems(BACKGROUND_MUSIC_LIBRARY, musicLibrarySearch)), [musicLibrarySearch]);
  const soundLibraryOptions = React.useMemo(() => buildCloudAudioOptions(filterCloudAudioItems(SOUND_EFFECT_LIBRARY, soundLibrarySearch)), [soundLibrarySearch]);

  React.useEffect(() => {
    onSettingsChange?.(effectiveSettings);
  }, [effectiveSettings, onSettingsChange]);

  React.useEffect(() => () => {
    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
  }, []);

  React.useEffect(() => {
    if (!selectedDraftId) {
      setPreviewScript(null);
      setPreviewError('');
      setPreviewLoading(false);
      return undefined;
    }
    let cancelled = false;
    setPreviewScript(null);
    setPreviewLoading(true);
    setPreviewError('');
    queryScript({ draft_id: selectedDraftId, force_update: false })
      .then((response) => {
        if (cancelled) return;
        const output = response?.output || response?.data?.output || response?.result?.output;
        const script = typeof output === 'string' ? JSON.parse(output) : output;
        if (!script || typeof script !== 'object') throw new Error('草稿轨道加载失败');
        setPreviewScript(script);
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewScript(null);
        setPreviewError(error?.message || '草稿轨道加载失败');
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedDraftId]);

  const updateSetting = React.useCallback((patch) => setSettings((prev) => ({ ...prev, ...patch })), []);
  const revokePreviewObjectUrl = React.useCallback(() => {
    if (!previewObjectUrlRef.current) return;
    URL.revokeObjectURL(previewObjectUrlRef.current);
    previewObjectUrlRef.current = '';
  }, []);
  const removeAudioFile = React.useCallback(() => {
    revokePreviewObjectUrl();
    setPreviewFile(null);
    setPreviewAudioData(null);
    updateSetting({ audioPath: '', audioName: '', previewSource: '', mediaDuration: 0, sourceStart: null, sourceEnd: null, cloudAudioId: '', cloudAudioType: '', cloudAudioUrl: '', musicId: '', music_id: '' });
  }, [revokePreviewObjectUrl, updateSetting]);
  const applyAudioFile = React.useCallback(async (file) => {
    if (!file) return;
    if (!isAudioFile(file)) {
      message.warning('请选择音频文件');
      return;
    }
    let filePath = String(file?.path || '').trim();
    try {
      filePath = String(window.api?.file?.getPathForFile?.(file) || filePath).trim();
    } catch {
      // In non-Electron contexts, dropped File objects may not expose a native path.
    }
    if (!filePath) {
      message.warning('请从本地文件拖入音频');
      return;
    }
    revokePreviewObjectUrl();
    let audioData = null;
    if (typeof file?.arrayBuffer !== 'function' && Number(file?.size || 0) <= 64 * 1024 * 1024) {
      try {
        audioData = toArrayBuffer(await window.api?.fs?.read?.(filePath));
      } catch {
        audioData = null;
      }
    }
    const previewSource = typeof file?.arrayBuffer === 'function'
      ? URL.createObjectURL(file)
      : toMediaSrc(filePath);
    if (previewSource.startsWith('blob:')) previewObjectUrlRef.current = previewSource;
    setPreviewFile(typeof file?.arrayBuffer === 'function' ? file : null);
    setPreviewAudioData(audioData);
    updateSetting({
      audioSourceType: 'local',
      audioPath: filePath,
      audioName: file.name || getBaseName(filePath),
      previewSource,
      sourceStart: null,
      sourceEnd: null,
      cloudAudioId: '',
      cloudAudioType: '',
      cloudAudioUrl: '',
      musicId: '',
      music_id: '',
    });
  }, [revokePreviewObjectUrl, updateSetting]);
  const applyCloudAudio = React.useCallback(async (sourceType, audioId) => {
    const item = (CLOUD_AUDIO_LIBRARY_BY_TYPE[sourceType] || []).find((entry) => entry.id === audioId);
    if (!item) return;
    setCloudAudioResolving(true);
    try {
      const resolved = await window.ipc?.invoke?.('cloud-audio:resolve-url', {
        musicId: item.id,
        title: item.title,
        url: item.url,
      });
      const audioUrl = String(resolved?.url || item.url || '').trim();
      if (!audioUrl) throw new Error('云端音频链接解析失败');
      const previewSource = String(resolved?.previewSource || '').trim() || audioUrl;
      const previewLocalPath = String(resolved?.localPath || '').trim();
      let audioData = null;
      if (previewLocalPath && Number(item.duration || 0) <= 60 * 60) {
        try {
          audioData = toArrayBuffer(await window.api?.fs?.read?.(previewLocalPath));
        } catch {
          audioData = null;
        }
      }
      revokePreviewObjectUrl();
      setPreviewFile(null);
      setPreviewAudioData(audioData);
      updateSetting({
        audioSourceType: sourceType,
        audioPath: audioUrl,
        audioName: item.title,
        previewSource,
        mediaDuration: normalizeTime(item.duration, 0),
        sourceStart: null,
        sourceEnd: null,
        cloudAudioId: item.id,
        cloudAudioType: sourceType,
        cloudAudioUrl: audioUrl,
        musicId: item.id,
        music_id: item.id,
      });
    } catch (error) {
      message.error(error?.message || '素材库音频解析失败');
    } finally {
      setCloudAudioResolving(false);
    }
  }, [revokePreviewObjectUrl, updateSetting]);
  const chooseAudioFile = async () => {
    if (disabled) return;
    try {
      const files = await window.api?.file?.select?.({
        title: '选择音频文件',
        properties: ['openFile'],
        filters: [{ name: '音频文件', extensions: AUDIO_EXTENSIONS }],
      });
      const file = Array.isArray(files) ? files[0] : null;
      if (!file) return;
      await applyAudioFile(file);
    } catch {
      message.error('选择音频文件失败');
    }
  };
  const resetDragState = React.useCallback(() => {
    dragCounterRef.current = 0;
    setIsDraggingAudio(false);
  }, []);
  const handleAudioDragEnter = React.useCallback((event) => {
    if (disabled || !hasSelectedDraft || settings.previewSource) return;
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current += 1;
    setIsDraggingAudio(true);
  }, [disabled, hasSelectedDraft, settings.previewSource]);
  const handleAudioDragOver = React.useCallback((event) => {
    if (disabled || !hasSelectedDraft || settings.previewSource) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setIsDraggingAudio(true);
  }, [disabled, hasSelectedDraft, settings.previewSource]);
  const handleAudioDragLeave = React.useCallback((event) => {
    if (disabled || !hasSelectedDraft || settings.previewSource) return;
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingAudio(false);
  }, [disabled, hasSelectedDraft, settings.previewSource]);
  const handleAudioDrop = React.useCallback((event) => {
    if (disabled || !hasSelectedDraft || settings.previewSource) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer?.files || []).filter(Boolean);
    resetDragState();
    if (files.length === 0) return;
    if (files.length > 1) {
      message.warning('一次只能导入一个音频文件');
      return;
    }
    void applyAudioFile(files[0]);
  }, [applyAudioFile, disabled, hasSelectedDraft, resetDragState, settings.previewSource]);
  const updateTrack = (patch) => updateSetting(resolveAudioTrack({ ...effectiveSettings, ...patch }, previewScript));
  const sliderMax = settings.mediaDuration ? Math.round(settings.mediaDuration * 100) / 100 : 0;
  const handleSourceRangeChange = (range) => {
    if (!Array.isArray(range) || range.length !== 2 || !settings.mediaDuration) return;
    const [rawStart, rawEnd] = range;
    updateSetting({
      sourceStart: normalizeTime(Math.min(rawStart, rawEnd), 0),
      sourceEnd: normalizeTime(Math.max(rawStart, rawEnd), settings.mediaDuration),
    });
  };
  const plannedAudio = settings.audioPath && times.clipDuration > 0 ? {
    type: 'audio',
    text: settings.audioName || '音频',
    trackName: effectiveSettings.trackName,
    trackMode: effectiveSettings.trackMode,
    start: times.targetStart,
    end: times.targetEnd,
  } : undefined;
  const volumeDb = resolveVolumeDb(settings);
  const selectedSceneEffect = settings.sceneEffectEnabled ? getAudioSceneEffect(settings.sceneEffectType) : null;
  const playbackSpeed = normalizeSpeed(settings.playbackSpeed ?? settings.speed, DEFAULT_AUDIO_ADD_SETTINGS.playbackSpeed);
  const playbackDuration = times.playbackDuration || 0;
  const speedDurationMax = times.clipDuration ? normalizeTime(times.clipDuration / 0.1, 0.1) : 0.1;
  const speedDurationMin = times.clipDuration ? normalizeTime(times.clipDuration / 5, 0.01) : 0;
  const volumePercent = ((volumeDb + 60) / 80) * 100;
  const volumeZeroPercent = 75;
  const volumeIncludeStart = Math.min(volumePercent, volumeZeroPercent);
  const volumeIncludeEnd = Math.max(volumePercent, volumeZeroPercent);
  const volumeMarks = React.useMemo(() => ({
    0: '0dB',
  }), []);
  const speedMarks = React.useMemo(() => ({
    0.1: '',
    1: '',
    2: '',
    3: '',
    4: '',
    5: '',
  }), []);
  const handleSpeedChange = (value) => updateSetting({ playbackSpeed: normalizeSpeed(value, playbackSpeed) });
  const handlePlaybackDurationChange = (value) => {
    const nextDuration = normalizeTime(value, playbackDuration || speedDurationMin || 0);
    if (!times.clipDuration || nextDuration <= 0) return;
    updateSetting({ playbackSpeed: normalizeSpeed(times.clipDuration / nextDuration, playbackSpeed) });
  };
  const handleSceneEffectEnabledChange = (checked) => {
    updateSetting({
      sceneEffectEnabled: checked,
      ...(checked && !settings.sceneEffectType ? { sceneEffectParams: getAudioSceneEffectParamDefaults('') } : {}),
    });
    if (checked) setIsSceneEffectSectionExpanded(true);
  };
  const handleSceneEffectChange = (value) => updateSetting({
    sceneEffectType: value,
    sceneEffectParams: getAudioSceneEffectParamDefaults(value),
  });
  const updateSceneEffectParam = (paramName, value, fallback) => updateSetting({
    sceneEffectParams: {
      ...(settings.sceneEffectParams || {}),
      [paramName]: normalizePercent(value, fallback),
    },
  });

  const settingsPanelContent = (
    <div className="chat-panel__text-settings-panel chat-panel__audio-add-settings-panel">
      <div className="chat-panel__text-settings-form">
        <section className="chat-panel__text-effect-section">
          <button type="button" className="chat-panel__text-settings-section-header" aria-expanded={isBasicSectionExpanded} onClick={() => setIsBasicSectionExpanded((prev) => !prev)}>
            <span className="chat-panel__text-settings-section-title">基础</span>
            <ChevronDown className={`chat-panel__text-settings-section-icon ${isBasicSectionExpanded ? 'is-expanded' : ''}`} aria-hidden="true" />
          </button>
          {isBasicSectionExpanded ? <>
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">音量</div>
              <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
                <Slider min={-60} max={20} step={0.1} marks={volumeMarks} included={false} value={volumeDb} disabled={disabled} className="chat-panel__text-settings-slider chat-panel__audio-add-db-slider" style={{ '--audio-volume-include-start': `${volumeIncludeStart}%`, '--audio-volume-include-end': `${volumeIncludeEnd}%` }} tooltip={{ formatter: (value) => (value <= -60 ? '静音' : `${Number(value || 0).toFixed(1)}dB`) }} onChange={(value) => updateSetting({ volumeDb: normalizeVolumeDb(value, volumeDb) })} />
                <InputNumber min={-60} max={20} step={0.1} precision={1} value={volumeDb} disabled={disabled} className="chat-panel__text-settings-number" controls changeOnWheel formatter={(value) => (Number(value) <= -60 ? '静音' : `${value ?? ''}dB`)} parser={(value) => String(value || '').replace('dB', '').replace('静音', '-60').trim()} onChange={(value) => updateSetting({ volumeDb: normalizeVolumeDb(value, volumeDb) })} />
              </div>
            </div>
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">淡入时长</div>
              <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
                <Slider min={0} max={30} step={0.1} value={settings.fadeInDuration} disabled={disabled} className="chat-panel__text-settings-slider" tooltip={{ formatter: (value) => `${Number(value || 0).toFixed(1)}s` }} onChange={(value) => updateSetting({ fadeInDuration: normalizeTime(value, 0) })} />
                <InputNumber min={0} max={30} step={0.1} precision={1} value={settings.fadeInDuration} disabled={disabled} className="chat-panel__text-settings-number" controls changeOnWheel formatter={(value) => `${value ?? ''}s`} parser={(value) => String(value || '').replace('s', '').replace('秒', '').trim()} onChange={(value) => updateSetting({ fadeInDuration: normalizeTime(value, 0) })} />
              </div>
            </div>
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">淡出时长</div>
              <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
                <Slider min={0} max={30} step={0.1} value={settings.fadeOutDuration} disabled={disabled} className="chat-panel__text-settings-slider" tooltip={{ formatter: (value) => `${Number(value || 0).toFixed(1)}s` }} onChange={(value) => updateSetting({ fadeOutDuration: normalizeTime(value, 0) })} />
                <InputNumber min={0} max={30} step={0.1} precision={1} value={settings.fadeOutDuration} disabled={disabled} className="chat-panel__text-settings-number" controls changeOnWheel formatter={(value) => `${value ?? ''}s`} parser={(value) => String(value || '').replace('s', '').replace('秒', '').trim()} onChange={(value) => updateSetting({ fadeOutDuration: normalizeTime(value, 0) })} />
              </div>
            </div>
          </> : null}
        </section>
        <section className="chat-panel__text-effect-section" aria-label="变速设置">
          <div className="chat-panel__text-settings-divider" />
          <button type="button" className="chat-panel__text-settings-section-header" aria-expanded={isSpeedSectionExpanded} onClick={() => setIsSpeedSectionExpanded((prev) => !prev)}>
            <span className="chat-panel__text-settings-section-title">变速</span>
            <ChevronDown className={`chat-panel__text-settings-section-icon ${isSpeedSectionExpanded ? 'is-expanded' : ''}`} aria-hidden="true" />
          </button>
          {isSpeedSectionExpanded ? <>
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">倍数</div>
              <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size chat-panel__audio-add-speed-control">
                <Slider min={0.1} max={5} step={0.01} marks={speedMarks} included={false} value={playbackSpeed} disabled={disabled} className="chat-panel__text-settings-slider chat-panel__audio-add-speed-slider" tooltip={{ formatter: (value) => `${Number(value || 1).toFixed(2)}x` }} onChange={handleSpeedChange} />
                <InputNumber min={0.1} max={5} step={0.01} precision={2} value={playbackSpeed} disabled={disabled} className="chat-panel__text-settings-number" controls changeOnWheel formatter={(value) => `${value ?? ''}x`} parser={(value) => String(value || '').replace('x', '').trim()} onChange={handleSpeedChange} />
              </div>
            </div>
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">时长</div>
              <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size chat-panel__audio-add-speed-control">
                <Slider min={speedDurationMin || 0} max={speedDurationMax || 0.1} step={0.01} value={playbackDuration} disabled={disabled || !times.clipDuration} className="chat-panel__text-settings-slider chat-panel__audio-add-duration-slider" tooltip={{ formatter: (value) => `${Number(value || 0).toFixed(2)}s` }} onChange={handlePlaybackDurationChange} />
                <InputNumber min={speedDurationMin || 0} max={speedDurationMax || 0.1} step={0.01} precision={2} value={playbackDuration} disabled={disabled || !times.clipDuration} className="chat-panel__text-settings-number" controls changeOnWheel formatter={(value) => `${value ?? ''}s`} parser={(value) => String(value || '').replace('s', '').replace('秒', '').trim()} onChange={handlePlaybackDurationChange} />
              </div>
            </div>
          </> : null}
        </section>
        <section className="chat-panel__text-effect-section" aria-label="声音效果设置">
          <div className="chat-panel__text-settings-divider" />
          <div className="chat-panel__text-effect-header">
            <input type="checkbox" aria-label="启用声音效果" checked={Boolean(settings.sceneEffectEnabled)} disabled={disabled} onChange={(event) => handleSceneEffectEnabledChange(event.target.checked)} />
            <button type="button" className="chat-panel__text-settings-section-header" aria-expanded={isSceneEffectSectionExpanded} onClick={() => setIsSceneEffectSectionExpanded((prev) => !prev)}>
              <span className="chat-panel__text-settings-section-title">声音效果</span>
              <ChevronDown className={`chat-panel__text-settings-section-icon ${isSceneEffectSectionExpanded ? 'is-expanded' : ''}`} aria-hidden="true" />
            </button>
          </div>
          {isSceneEffectSectionExpanded ? <fieldset className="chat-panel__text-effect-fields" disabled={disabled || !settings.sceneEffectEnabled}>
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">场景音</div>
              <div className="chat-panel__text-settings-control chat-panel__audio-add-effect-control">
                <Select className="chat-panel__text-settings-select chat-panel__audio-add-effect-select" value={settings.sceneEffectType || ''} disabled={disabled || !settings.sceneEffectEnabled} options={AUDIO_SCENE_EFFECT_OPTIONS} onChange={handleSceneEffectChange} />
              </div>
            </div>
            {selectedSceneEffect?.params.map((param) => {
              const value = normalizePercent(settings.sceneEffectParams?.[param.name], param.defaultValue);
              return (
                <div className="chat-panel__text-settings-row" key={`${selectedSceneEffect.value}-${param.name}`}>
                  <div className="chat-panel__text-settings-label">{param.label}</div>
                  <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
                    <Slider min={0} max={100} step={1} value={value} disabled={disabled || !settings.sceneEffectEnabled} className="chat-panel__text-settings-slider" tooltip={{ formatter: (nextValue) => `${Math.round(Number(nextValue || 0))}` }} onChange={(nextValue) => updateSceneEffectParam(param.name, nextValue, param.defaultValue)} />
                    <InputNumber min={0} max={100} step={1} precision={0} value={value} disabled={disabled || !settings.sceneEffectEnabled} className="chat-panel__text-settings-number" controls changeOnWheel onChange={(nextValue) => updateSceneEffectParam(param.name, nextValue, param.defaultValue)} />
                  </div>
                </div>
              );
            })}
          </fieldset> : null}
        </section>
      </div>
    </div>
  );

  const timelinePanelContent = (
    <div className="chat-panel__text-settings-panel chat-panel__audio-add-settings-panel">
      <div className="chat-panel__text-timeline">
      <div className="chat-panel__text-settings-form">
        <div className="chat-panel__text-settings-row">
          <label htmlFor="audio-track-select" className="chat-panel__text-settings-label">轨道名</label>
          <div className="chat-panel__text-track-control">
            <AutoComplete id="audio-track-select" aria-label="选择音频轨道" className="chat-panel__text-settings-select chat-panel__text-track-select" value={effectiveSettings.trackMode === 'new' ? effectiveSettings.newTrackName : effectiveSettings.trackName} disabled={locked} defaultActiveFirstOption={false} filterOption={false} suffixIcon={<ChevronDown size={14} />} placeholder="选择音频轨道或输入新名称" options={[...trackNames.map((name) => ({ value: `existing:${name}`, label: name, trackName: name })), { value: '__new__', label: '新建轨道', create: true }]} onChange={(next, option) => { if (option?.trackName || option?.create) return; updateTrack({ trackMode: 'new', newTrackName: next.slice(0, 100) }); }} onSelect={(next) => updateTrack(next === '__new__' ? { trackMode: 'new', newTrackName: 'audio_track' } : { trackMode: 'existing', trackName: next.slice('existing:'.length) })} onBlur={() => { if (effectiveSettings.trackMode === 'new') updateTrack({ newTrackName: effectiveSettings.trackName }); }} />
          </div>
        </div>
        <div className="chat-panel__text-settings-row chat-panel__preset-add-clip-row">
          <span className="chat-panel__text-settings-label">音频截取</span>
          <div className="chat-panel__preset-add-clip-control">
            <Slider range={{ draggableTrack: true }} min={0} max={sliderMax || 0.01} step={0.01} value={settings.mediaDuration ? [times.sourceStart, times.sourceEnd ?? settings.mediaDuration] : [0, 0]} disabled={disabled || !settings.mediaDuration} className="chat-panel__text-settings-slider chat-panel__preset-add-clip-slider" tooltip={{ formatter: (value) => `${Number(value || 0).toFixed(2)}s` }} onChange={handleSourceRangeChange} />
          </div>
        </div>
        <div className="chat-panel__text-settings-row chat-panel__preset-add-start-row">
          <span className="chat-panel__text-settings-label">开始时间</span>
          <div className="chat-panel__preset-add-start-control">
            <InputNumber aria-label="开始时间" className="chat-panel__text-settings-number" title="开始时间（秒）" value={settings.mediaDuration ? times.targetStart : null} placeholder="待读取" disabled={disabled || !settings.mediaDuration} min={0} max={86400} controls changeOnWheel step={0.01} precision={2} onChange={(value) => updateSetting({ targetStart: normalizeTime(value, 0) })} />
          </div>
        </div>
      </div>
      {previewLoading ? <div role="status">正在加载轨道预览...</div> : previewError ? <div role="alert" className="chat-panel__text-preset-error">{previewError}</div> : <div className="chat-panel__preset-add-track-preview chat-panel__audio-add-track-preview" aria-label="只读音频轨道预览"><PinnedDraftTrackView preview={previewScript} plannedText={plannedAudio} rowHeightScale={4 / 5} /></div>}
      </div>
    </div>
  );

  const activePanelContent = activeSettingsTab === 'timeline' ? timelinePanelContent : settingsPanelContent;

  const settingsPopupContent = (
    <div className={`chat-panel__text-settings-popup chat-panel__audio-add-settings-popup${hasSelectedDraft ? '' : ' chat-panel__text-settings-popup--preview-only'}`}>
      <div className="chat-panel__text-settings-layout">
        <div className="chat-panel__text-settings-preview chat-panel__audio-add-settings-preview">
          <div className="chat-panel__text-settings-preview-stage">
            {hasSelectedDraft ? <div className="chat-panel__text-settings-preview-selector chat-panel__text-settings-preview-selector--top">
              <DraftSelect mode="single" disabled={disabled} selectedDraftIds={selectedDraftIds} onSelectedDraftIdsChange={onSelectedDraftIdsChange} placeholder="选择草稿" searchPlaceholder="搜索草稿id" triggerClassName="chat-panel__text-settings-draft-select" popoverClassName="chat-panel__text-settings-draft-select-popover" />
            </div> : null}
            <div
              className={`chat-panel__audio-add-preview-shell ${isDraggingAudio ? 'is-dragging' : ''}`}
              onDragEnter={handleAudioDragEnter}
              onDragOver={handleAudioDragOver}
              onDragLeave={handleAudioDragLeave}
              onDrop={handleAudioDrop}
            >
              {!hasSelectedDraft ? <DraftSelect mode="single" disabled={disabled} selectedDraftIds={selectedDraftIds} onSelectedDraftIdsChange={onSelectedDraftIdsChange} placeholder="选择草稿" searchPlaceholder="搜索草稿id" triggerClassName="chat-panel__text-settings-draft-select" popoverClassName="chat-panel__text-settings-draft-select-popover" /> : <div className="chat-panel__audio-add-source-panel">
                {settings.previewSource ? (
                  <AudioPreview source={settings.previewSource} file={previewFile} audioData={previewAudioData} name={settings.audioName} removeDisabled={disabled || cloudAudioResolving} onRemove={removeAudioFile} onDurationChange={(duration) => updateSetting({ mediaDuration: duration })} showWaveStatus={false} trimStart={times.sourceStart} trimEnd={times.sourceEnd ?? settings.mediaDuration} playbackRate={playbackSpeed} />
                ) : <>
                  <button type="button" className="chat-panel__audio-add-upload" disabled={disabled || cloudAudioResolving} onClick={chooseAudioFile}>
                    <Plus size={24} aria-hidden="true" />
                    <span>导入音频</span>
                    <small>支持拖拽本地音频到此处</small>
                  </button>
                  <div className="chat-panel__audio-add-library-list" aria-label="音频素材库">
                    <Select showSearch className="chat-panel__audio-add-library-select" value={undefined} disabled={disabled || cloudAudioResolving} loading={cloudAudioResolving} placeholder="搜索背景音乐库" filterOption={false} searchValue={musicLibrarySearch} onSearch={setMusicLibrarySearch} onChange={(value) => applyCloudAudio('music', value)} options={musicLibraryOptions} notFoundContent="未找到素材" />
                    <Select showSearch className="chat-panel__audio-add-library-select" value={undefined} disabled={disabled || cloudAudioResolving} loading={cloudAudioResolving} placeholder="搜索音效库" filterOption={false} searchValue={soundLibrarySearch} onSearch={setSoundLibrarySearch} onChange={(value) => applyCloudAudio('sound', value)} options={soundLibraryOptions} notFoundContent="未找到素材" />
                  </div>
                </>}
              </div>}
            </div>
          </div>
        </div>
        {hasSelectedDraft ? <div className="chat-panel__text-settings-main chat-panel__audio-add-settings-main">
          <div className="chat-panel__text-settings-content">
            {activePanelContent}
          </div>
          <div className="chat-panel__text-settings-tabs" role="tablist" aria-label="音频设置">
            {AUDIO_SETTINGS_TABS.map((tab) => (
              <button key={tab.key} type="button" role="tab" aria-selected={activeSettingsTab === tab.key} className={`chat-panel__text-settings-tab ${activeSettingsTab === tab.key ? 'active' : ''}`} title={tab.label} aria-label={tab.label} onClick={() => setActiveSettingsTab(tab.key)}>
                <tab.icon className="chat-panel__text-settings-tab-icon" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div> : null}
      </div>
    </div>
  );

  return <div className="chat-panel__tool-detail-area chat-panel__audio-add-detail" role="group" aria-label="添加音频工具">
    <button type="button" className="chat-panel__tool-button chat-panel__tool-button--active" onClick={onBack} disabled={disabled}>
      <Music size={12} className="chat-panel__tool-text-add-icon chat-panel__audio-add-tool-icon" aria-hidden="true" />
      <span className="chat-panel__tool-text chat-panel__tool-text--active">添加音频</span>
      <CloseOutlined className="chat-panel__tool-close-icon chat-panel__audio-add-close-icon" />
    </button>
    <Dropdown disabled={disabled} open={settingsOpen} autoAdjustOverflow={false} onOpenChange={(open) => !disabled && setSettingsOpen(open)} popupRender={() => settingsPopupContent} trigger={['click']} placement="topLeft" overlayClassName="chat-panel__text-settings-dropdown" menu={{ items: [] }}>
      <span className="chat-panel__tool-dropdown-trigger">
        <button type="button" className={`chat-panel__draft-select-trigger chat-panel__text-settings-trigger ${settingsOpen ? 'is-open' : ''}`} disabled={disabled} aria-label="设置" title="设置">
          <SlidersHorizontal className="chat-panel__text-settings-trigger-icon" aria-hidden="true" />
          <span className="chat-panel__tool-text chat-panel__text-settings-trigger-text">设置</span>
          <DownOutlined className="chat-panel__audio-add-settings-arrow" />
        </button>
      </span>
    </Dropdown>
  </div>;
};

export default AudioAddToolDetail;
