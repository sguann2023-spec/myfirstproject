import React from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { Dropdown, message } from 'antd';
import { ChevronDown, Clock3, Image as ImageIcon, SlidersHorizontal } from 'lucide-react';
import DraftSelect from '../DraftSelect/index';
import ImageCanvas from './ImageCanvas';
import ImageSettingsPanel, { DEFAULT_IMAGE_PANEL_SETTINGS } from './ImageSettingsPanel';
import ImageTimelinePanel, { resolveImageTrack } from './ImageTimelinePanel';
import ImageTimelineBoundary from './ImageTimelineBoundary';
import { queryScript } from '../../api/capcut';
import '../TextAddDetail/index.css';
import '../PresetAddDetail/index.css';
import './index.css';

const IMAGE_EXTENSIONS = ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'];
const IMAGE_SETTINGS_TABS = [
  { key: 'settings', label: '位置大小', icon: SlidersHorizontal },
  { key: 'timeline', label: '时间线', icon: Clock3 },
];

export const DEFAULT_IMAGE_ADD_SETTINGS = {
  ...DEFAULT_IMAGE_PANEL_SETTINGS,
  imagePath: '',
  imageName: '',
  previewSource: '',
  start: 0,
  end: 3,
  scaleXPercent: 100,
  scaleYPercent: 100,
  uniformScale: true,
  positionX: 0,
  positionY: 0,
  rotation: 0,
  alphaPercent: 100,
  width: null,
  height: null,
  trackName: 'image_track',
  relativeIndex: null,
};

const clampNumber = (value, min, max, fallback) => {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) return fallback;
  return Math.min(max, Math.max(min, resolved));
};
const normalizeTime = (value, fallback = 0) => Math.round(clampNumber(value, 0, 86400, fallback) * 100) / 100;
const normalizeScalePercent = (value, fallback = 100) => clampNumber(value, 1, 500, fallback);
const normalizePositionValue = (value, fallback = 0) => clampNumber(value, -10000, 10000, fallback);
const normalizeRotationValue = (value, fallback = 0) => Math.round(clampNumber(value, -360, 360, fallback));
const normalizePercent = (value, fallback = 100) => Math.round(clampNumber(value, 0, 100, fallback));
const normalizeOptionalPositiveInteger = (value, fallback = null) => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const resolved = Number(value);
  if (!Number.isFinite(resolved) || resolved <= 0) return fallback;
  return Math.round(clampNumber(resolved, 1, 10000, fallback ?? 1));
};
const normalizeOptionalInteger = (value, fallback = null) => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) return fallback;
  return Math.round(clampNumber(resolved, -10000, 10000, fallback ?? 0));
};
const normalizePath = (value) => String(value || '').replace(/\\/g, '/');
const getBaseName = (value) => normalizePath(value).replace(/\/$/, '').split('/').filter(Boolean).pop() || value;
const toMediaSrc = (value) => {
  const normalized = normalizePath(value).trim();
  if (!normalized) return '';
  if (/^(blob:|data:|https?:\/\/|file:\/\/)/i.test(normalized)) return normalized;
  const pathname = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${pathname.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;
};
const isImageFile = (file) => IMAGE_EXTENSIONS.includes(String(file?.extension || file?.path || file?.name || '').split('.').pop().toLowerCase());

export const buildImageAddRequestParams = (settings = DEFAULT_IMAGE_ADD_SETTINGS) => {
  const start = Math.min(86399.99, normalizeTime(settings?.start, DEFAULT_IMAGE_ADD_SETTINGS.start));
  const end = Math.max(start + 0.01, normalizeTime(settings?.end, DEFAULT_IMAGE_ADD_SETTINGS.end));
  const width = normalizeOptionalPositiveInteger(settings?.width, null);
  const height = normalizeOptionalPositiveInteger(settings?.height, null);
  const relativeIndex = normalizeOptionalInteger(settings?.relativeIndex, null);
  const trackName = String(settings?.trackName || DEFAULT_IMAGE_ADD_SETTINGS.trackName).trim();
  const effects = {};
  [['introAnimation', 'intro_animation', 'animation'], ['outroAnimation', 'outro_animation', 'animation'], ['comboAnimation', 'combo_animation', 'animation'], ['transition', 'transition', 'transition']].forEach(([key, param, field]) => {
    const effect = settings[key];
    if (!effect?.enabled || !effect[field]?.trim()) return;
    effects[param] = effect[field].trim();
    effects[`${param}_duration`] = Math.round(clampNumber(effect.duration, 0.1, 3, 0.5) * 10) / 10;
  });
  return {
    image_url: String(settings?.imagePath || '').trim(),
    start,
    end,
    transform_x_px: Math.round(normalizePositionValue(settings?.positionX, 0)),
    transform_y_px: Math.round(normalizePositionValue(settings?.positionY, 0)),
    rotation: normalizeRotationValue(settings?.rotation, 0),
    scale_x: normalizeScalePercent(settings?.scaleXPercent, 100) / 100,
    scale_y: normalizeScalePercent(settings?.scaleYPercent, 100) / 100,
    alpha: normalizePercent(settings?.alphaPercent, 100) / 100,
    ...(trackName ? { track_name: trackName } : {}),
    ...(width !== null ? { width } : {}),
    ...(height !== null ? { height } : {}),
    ...(settings.trackMode !== 'existing' && relativeIndex !== null ? { relative_index: relativeIndex } : {}),
    ...effects,
  };
};

export const buildImageAddSettingsPrompt = (settings = DEFAULT_IMAGE_ADD_SETTINGS) => {
  const params = buildImageAddRequestParams(settings);
  return [
    '图片设置：',
    `文件：${params.image_url || settings.imageName}`,
    `位置大小：${JSON.stringify({ transform_x_px: params.transform_x_px, transform_y_px: params.transform_y_px, rotation: params.rotation, scale_x: params.scale_x, scale_y: params.scale_y, alpha: params.alpha, width: params.width, height: params.height })}`,
    `时间线：${JSON.stringify({ start: params.start, end: params.end, track_name: params.track_name, relative_index: params.relative_index })}`,
    params.intro_animation ? `入场动画：${params.intro_animation}，${params.intro_animation_duration}秒` : '',
    params.outro_animation ? `出场动画：${params.outro_animation}，${params.outro_animation_duration}秒` : '',
    params.combo_animation ? `组合动画：${params.combo_animation}，${params.combo_animation_duration}秒` : '',
    params.transition ? `转场：${params.transition}，${params.transition_duration}秒` : '',
  ].filter(Boolean).join('\n');
};

export const getImageAddToolSendState = ({ selectedDraftIds = [], settings = DEFAULT_IMAGE_ADD_SETTINGS } = {}) => {
  const hasSelectedDraft = Array.isArray(selectedDraftIds) && selectedDraftIds.length > 0;
  const hasImage = Boolean(String(settings?.imagePath || '').trim());
  return { canSend: hasSelectedDraft && hasImage, disabledReason: !hasSelectedDraft ? '必须选择一个草稿添加图片' : !hasImage ? '请选择图片文件' : '' };
};

const ImageAddDetailTool = ({ disabled = false, onBack, selectedDraftIds = [], onSelectedDraftIdsChange = null, onSettingsChange = null }) => {
  const dragCounterRef = React.useRef(0);
  const previewObjectUrlRef = React.useRef('');
  const choosingRef = React.useRef(false);
  const stagePointerRef = React.useRef(null);
  const [settingsOpen, setSettingsOpen] = React.useState(true);
  const [activeSettingsTab, setActiveSettingsTab] = React.useState('settings');
  const [settings, setSettings] = React.useState({ ...DEFAULT_IMAGE_ADD_SETTINGS });
  const [previewScript, setPreviewScript] = React.useState(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState('');
  const [isDraggingImage, setIsDraggingImage] = React.useState(false);
  const selectedDraftId = String(selectedDraftIds?.[0] || '').trim();
  const hasSelectedDraft = Boolean(selectedDraftId);
  const effectiveSettings = React.useMemo(() => previewScript ? resolveImageTrack(settings, previewScript) : settings, [settings, previewScript]);
  const settingsRef = React.useRef(settings);
  const previewScriptRef = React.useRef(null);
  const settingsChangeRef = React.useRef(onSettingsChange);
  React.useLayoutEffect(() => { settingsChangeRef.current = onSettingsChange; }, [onSettingsChange]);
  const notifySettings = React.useCallback(() => {
    const value = settingsRef.current;
    settingsChangeRef.current?.(previewScriptRef.current ? resolveImageTrack(value, previewScriptRef.current) : value);
  }, []);

  React.useEffect(() => () => { if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current); }, []);
  React.useEffect(() => {
    previewScriptRef.current = null;
    notifySettings();
    if (!selectedDraftId) { setPreviewScript(null); setPreviewError(''); setPreviewLoading(false); return undefined; }
    let cancelled = false;
    setPreviewScript(null); setPreviewLoading(true); setPreviewError('');
    queryScript({ draft_id: selectedDraftId, force_update: false })
      .then((response) => {
        if (cancelled) return;
        const output = response?.output || response?.data?.output || response?.result?.output;
        const script = typeof output === 'string' ? JSON.parse(output) : output;
        if (!script || typeof script !== 'object') throw new Error('草稿轨道加载失败');
        previewScriptRef.current = script;
        setPreviewScript(script);
        notifySettings();
      })
      .catch((error) => { if (!cancelled) { setPreviewScript(null); setPreviewError(error?.message || '草稿轨道加载失败'); } })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDraftId, notifySettings]);

  // Publish from edits/loading, not a render-driven effect that schedules another parent render.
  const updateSetting = React.useCallback((patch) => {
    const prev = settingsRef.current;
    if (!Object.keys(patch).some((key) => !Object.is(prev[key], patch[key]))) return;
    const next = { ...prev, ...patch };
    settingsRef.current = next;
    setSettings(next);
    notifySettings();
  }, [notifySettings]);
  const revokePreviewObjectUrl = React.useCallback(() => {
    if (!previewObjectUrlRef.current) return;
    URL.revokeObjectURL(previewObjectUrlRef.current);
    previewObjectUrlRef.current = '';
  }, []);
  const applyImageFile = React.useCallback(async (file) => {
    if (!file) return;
    if (!isImageFile(file)) { message.warning('请选择图片文件'); return; }
    let filePath = String(file?.path || '').trim();
    try { filePath = String(window.api?.file?.getPathForFile?.(file) || filePath).trim(); } catch { /* noop */ }
    if (!filePath) { message.warning('请从本地文件拖入图片'); return; }
    revokePreviewObjectUrl();
    const previewSource = typeof file?.arrayBuffer === 'function' ? URL.createObjectURL(file) : toMediaSrc(filePath);
    if (previewSource.startsWith('blob:')) previewObjectUrlRef.current = previewSource;
    updateSetting({ imagePath: filePath, imageName: file.name || getBaseName(filePath), previewSource });
  }, [revokePreviewObjectUrl, updateSetting]);
  const chooseImageFile = React.useCallback(async () => {
    if (disabled || choosingRef.current) return;
    choosingRef.current = true;
    try {
      const files = await window.api?.file?.select?.({ title: '选择图片文件', properties: ['openFile'], filters: [{ name: '图片文件', extensions: IMAGE_EXTENSIONS }] });
      if (Array.isArray(files) && files[0]) await applyImageFile(files[0]);
    } catch { message.error('选择图片文件失败'); }
    finally { choosingRef.current = false; }
  }, [disabled, applyImageFile]);
  const handleStagePointerDown = (event) => { stagePointerRef.current = { x: event.clientX, y: event.clientY }; };
  const handleStageClick = (event) => {
    const origin = stagePointerRef.current;
    stagePointerRef.current = null;
    if (disabled) return;
    if (origin && (Math.abs(event.clientX - origin.x) > 4 || Math.abs(event.clientY - origin.y) > 4)) return;
    void chooseImageFile();
  };
  const resetDragState = () => { dragCounterRef.current = 0; setIsDraggingImage(false); };
  const handleDragEnter = (event) => { if (disabled || !hasSelectedDraft || settings.previewSource) return; event.preventDefault(); dragCounterRef.current += 1; setIsDraggingImage(true); };
  const handleDragOver = (event) => { if (disabled || !hasSelectedDraft || settings.previewSource) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; setIsDraggingImage(true); };
  const handleDragLeave = (event) => { if (disabled || !hasSelectedDraft || settings.previewSource) return; event.preventDefault(); dragCounterRef.current = Math.max(0, dragCounterRef.current - 1); if (dragCounterRef.current === 0) setIsDraggingImage(false); };
  const handleDrop = (event) => {
    if (disabled || !hasSelectedDraft || settings.previewSource) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []).filter(Boolean);
    resetDragState();
    if (files.length > 1) { message.warning('一次只能导入一张图片'); return; }
    if (files[0]) void applyImageFile(files[0]);
  };

  const settingsPanelContent = (
    <ImageSettingsPanel settings={effectiveSettings} onChange={updateSetting} disabled={disabled} />
  );
  const timelinePanelContent = (
    <div className="chat-panel__text-settings-panel chat-panel__image-add-settings-panel">
      <ImageTimelineBoundary settings={effectiveSettings}>
      <ImageTimelinePanel script={previewScript} loading={previewLoading} error={previewError}
        settings={effectiveSettings} onChange={updateSetting} disabled={disabled} />
      </ImageTimelineBoundary>
    </div>
  );
  const draftSelector = (
    <DraftSelect mode="single" disabled={disabled} selectedDraftIds={selectedDraftIds}
      onSelectedDraftIdsChange={onSelectedDraftIdsChange} placeholder="选择草稿"
      searchPlaceholder="搜索草稿id" triggerClassName="chat-panel__text-settings-draft-select"
      popoverClassName="chat-panel__text-settings-draft-select-popover" />
  );
  const settingsPopupContent = (
    <div className={`chat-panel__text-settings-popup chat-panel__image-add-settings-popup${hasSelectedDraft ? '' : ' chat-panel__text-settings-popup--preview-only'}`}>
      <div className="chat-panel__text-settings-layout">
        <div className="chat-panel__text-settings-preview chat-panel__image-add-settings-preview">
          <div className="chat-panel__text-settings-preview-stage">
            {hasSelectedDraft ? (
              <div className="chat-panel__text-settings-preview-selector chat-panel__text-settings-preview-selector--top">
                {draftSelector}
              </div>
            ) : null}
            <div className={`chat-panel__text-settings-preview-canvas-shell chat-panel__image-add-preview-shell${isDraggingImage ? ' is-dragging' : ''}`}
              onDragEnter={handleDragEnter} onDragOver={handleDragOver}
              onDragLeave={handleDragLeave} onDrop={handleDrop}>
              {!hasSelectedDraft ? (
                <div className="chat-panel__text-settings-preview-selector chat-panel__text-settings-preview-selector--empty">
                  {draftSelector}
                </div>
              ) : settings.previewSource ? (
                <div
                  className="chat-panel__preset-add-preview-stage has-preset"
                  title="点击替换图片"
                  onPointerDown={handleStagePointerDown}
                  onClick={handleStageClick}
                >
                  <ImageCanvas source={settings.previewSource} canvas={previewScript?.canvas_config}
                    settings={effectiveSettings} onChange={updateSetting} disabled={disabled}
                    onChoose={chooseImageFile} />
                </div>
              ) : (
                <div className="chat-panel__preset-add-preview-stage">
                  <button type="button" className="chat-panel__preset-add-preview-element"
                    style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
                    disabled={disabled} aria-label="导入图片" title="支持拖拽本地图片到此处"
                    onClick={chooseImageFile}>
                    <span className="chat-panel__preset-add-preview-empty">点击导入图片</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {hasSelectedDraft ? (
          <div className="chat-panel__text-settings-main chat-panel__image-add-settings-main">
            <div className="chat-panel__text-settings-content">
              {activeSettingsTab === 'timeline' ? timelinePanelContent : settingsPanelContent}
            </div>
            <div className="chat-panel__text-settings-tabs" role="tablist" aria-label="图片设置">
              {IMAGE_SETTINGS_TABS.map((tab) => (
                <button key={tab.key} type="button" role="tab" aria-selected={activeSettingsTab === tab.key}
                  className={`chat-panel__text-settings-tab ${activeSettingsTab === tab.key ? 'active' : ''}`}
                  title={tab.label} aria-label={tab.label} onClick={() => setActiveSettingsTab(tab.key)}>
                  <tab.icon className="chat-panel__text-settings-tab-icon" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="chat-panel__tool-detail-area chat-panel__image-add-detail" role="group" aria-label="添加图片工具">
      <button type="button" className="chat-panel__tool-button chat-panel__tool-button--active" onClick={onBack} disabled={disabled}>
        <ImageIcon size={14} className="chat-panel__tool-text-add-icon chat-panel__image-add-tool-icon" aria-hidden="true" />
        <span className="chat-panel__tool-text chat-panel__tool-text--active">添加图片</span>
        <CloseOutlined className="chat-panel__tool-close-icon" />
      </button>
      <Dropdown disabled={disabled} open={settingsOpen} autoAdjustOverflow={false} onOpenChange={(open) => !disabled && setSettingsOpen(open)} popupRender={() => settingsPopupContent} trigger={['click']} placement="topLeft" overlayClassName="chat-panel__text-settings-dropdown" menu={{ items: [] }}>
        <span className="chat-panel__tool-dropdown-trigger">
          <button
            type="button"
            className={`chat-panel__draft-select-trigger chat-panel__text-settings-trigger ${settingsOpen ? 'is-open' : ''}`}
            aria-label="设置"
            title="设置"
            disabled={disabled}
          >
            <SlidersHorizontal
              className="chat-panel__draft-select-trigger-search-icon chat-panel__text-settings-trigger-icon"
              aria-hidden="true"
            />
            <span className="chat-panel__draft-select-trigger-text chat-panel__text-settings-trigger-text">设置</span>
            <ChevronDown
              className={`chat-panel__draft-select-trigger-icon ${settingsOpen ? 'is-open' : ''}`}
              aria-hidden="true"
            />
          </button>
        </span>
      </Dropdown>
    </div>
  );
};

export default ImageAddDetailTool;
