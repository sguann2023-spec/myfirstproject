import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { Dropdown, InputNumber, Popover, Select, Slider, Switch } from 'antd';
import { ChevronDown, Clock3, SlidersHorizontal } from 'lucide-react';
import DraftSelect from '../DraftSelect/index';
import PresetList from '../PresetList/PresetList';
import PresetIcon from '../../../public/preset_icon.svg';
import { queryScript } from '../../api/capcut';
import { PRESET_ANIMATION_OPTIONS } from '../../shared/textAnimations';
import { PRESET_TRANSITION_OPTIONS as RAW_PRESET_TRANSITION_OPTIONS } from '../../shared/presetTransitions';
import PresetCanvas from './PresetCanvas';
import PresetTimelinePanel from './PresetTimelinePanel';
import PresetReplacementPanel from './PresetReplacementPanel';
import { loadPresetMetadata, presetMetadata, resolvePresetTimes, resolvePresetTrack } from './presetModel';
import '../TextAddDetail/index.css';
import './index.css';

const NUMBER_INPUT_SHARED_PROPS = {
  controls: true,
  changeOnWheel: true,
};

const PRESET_SETTINGS_TABS = [
  { key: 'transform', label: '位置大小', icon: SlidersHorizontal },
  { key: 'timeline', label: '时间线', icon: Clock3 },
];

export const DEFAULT_PRESET_ADD_SETTINGS = {
  scaleXPercent: 100,
  scaleYPercent: 100,
  uniformScale: true,
  positionX: 0,
  positionY: 0,
  rotation: 0,
  width: null,
  height: null,
  targetStart: 0,
  sourceStart: null,
  sourceEnd: null,
  trackName: 'preset_track',
  relativeIndex: null,
  introAnimation: { enabled: false, animation: '', duration: 0.5 },
  outroAnimation: { enabled: false, animation: '', duration: 0.5 },
  transition: { enabled: false, transition: '', duration: 0.5 },
  replacements: [],
};

const PRESET_ANIMATION_GROUPS = [
  { key: 'introAnimation', label: '入场动画', options: PRESET_ANIMATION_OPTIONS.intro, paramPrefix: 'intro' },
  { key: 'outroAnimation', label: '出场动画', options: PRESET_ANIMATION_OPTIONS.outro, paramPrefix: 'outro' },
];

export const PRESET_TRANSITION_OPTIONS = RAW_PRESET_TRANSITION_OPTIONS.map((item) => ({
  ...item,
  value: item.value.split('\n').pop().trim(),
}));

const clampNumber = (value, min, max, fallback) => {
  const resolvedValue = Number(value);
  if (!Number.isFinite(resolvedValue)) return fallback;
  return Math.min(max, Math.max(min, resolvedValue));
};

const normalizeScalePercent = (value, fallback = 100) => clampNumber(value, 1, 500, fallback);
const normalizePositionValue = (value, fallback = 0) => clampNumber(value, -10000, 10000, fallback);
const normalizeRotationValue = (value, fallback = 0) => Math.round(clampNumber(value, -360, 360, fallback));
const normalizeOptionalInteger = (value, fallback = null) => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const resolvedValue = Number(value);
  if (!Number.isFinite(resolvedValue)) return fallback;
  return Math.round(clampNumber(resolvedValue, -10000, 10000, fallback ?? 0));
};
const normalizeOptionalPositiveInteger = (value, fallback = null) => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const resolvedValue = Number(value);
  if (!Number.isFinite(resolvedValue) || resolvedValue <= 0) return fallback;
  return Math.round(clampNumber(resolvedValue, 1, 10000, fallback ?? 1));
};
const normalizeOptionalTime = (value, fallback = null) => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const resolvedValue = Number(value);
  if (!Number.isFinite(resolvedValue)) return fallback;
  return Math.round(Math.max(0, resolvedValue) * 100) / 100;
};

const clampAnimationDuration = (value, fallback = 0.5) => {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(3, Math.max(0.1, number)) * 10) / 10;
};

const resolveAnimationSetting = (value, fallback = DEFAULT_PRESET_ADD_SETTINGS.introAnimation) => {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : fallback.enabled,
    animation: typeof source.animation === 'string' ? source.animation : fallback.animation,
    duration: clampAnimationDuration(source.duration, fallback.duration),
  };
};

const resolveTransitionSetting = (value, fallback = DEFAULT_PRESET_ADD_SETTINGS.transition) => {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : fallback.enabled,
    transition: typeof source.transition === 'string' ? source.transition : fallback.transition,
    duration: clampAnimationDuration(source.duration, fallback.duration),
  };
};

export const buildPresetAddRequestParams = (settings = DEFAULT_PRESET_ADD_SETTINGS) => {
  const scaleX = normalizeScalePercent(settings?.scaleXPercent, DEFAULT_PRESET_ADD_SETTINGS.scaleXPercent) / 100;
  const scaleY = normalizeScalePercent(settings?.scaleYPercent, DEFAULT_PRESET_ADD_SETTINGS.scaleYPercent) / 100;
  const positionX = normalizePositionValue(settings?.positionX, DEFAULT_PRESET_ADD_SETTINGS.positionX);
  const positionY = normalizePositionValue(settings?.positionY, DEFAULT_PRESET_ADD_SETTINGS.positionY);
  const rotation = normalizeRotationValue(settings?.rotation, DEFAULT_PRESET_ADD_SETTINGS.rotation);
  const width = normalizeOptionalPositiveInteger(settings?.width, null);
  const height = normalizeOptionalPositiveInteger(settings?.height, null);
  const targetStart = normalizeOptionalTime(settings?.targetStart, DEFAULT_PRESET_ADD_SETTINGS.targetStart);
  const sourceStart = normalizeOptionalTime(settings?.sourceStart, null);
  const sourceEnd = normalizeOptionalTime(settings?.sourceEnd, null);
  const trackName = String(settings?.trackName || DEFAULT_PRESET_ADD_SETTINGS.trackName).trim();
  const relativeIndex = normalizeOptionalInteger(settings?.relativeIndex, null);
  const replacements = Array.isArray(settings?.replacements)
    ? settings.replacements
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => Object.fromEntries(Object.entries(item)
        .map(([key, value]) => [String(key || '').trim(), String(value ?? '')])
        .filter(([key, value]) => key && value.trim())))
      .filter((item) => Object.keys(item).length > 0)
    : [];
  const animationParams = Object.fromEntries(PRESET_ANIMATION_GROUPS.flatMap(({ key, paramPrefix }) => {
    const value = resolveAnimationSetting(settings?.[key], DEFAULT_PRESET_ADD_SETTINGS[key]);
    if (!value.enabled || !value.animation.trim()) return [];
    return [[`${paramPrefix}_animation`, value.animation.trim()], [`${paramPrefix}_animation_duration`, value.duration]];
  }));
  const transitionValue = resolveTransitionSetting(settings?.transition, DEFAULT_PRESET_ADD_SETTINGS.transition);
  const transitionParams = transitionValue.enabled && transitionValue.transition.trim()
    ? { transition: transitionValue.transition.trim(), transition_duration: transitionValue.duration }
    : {};

  return {
    target_start: targetStart,
    ...(sourceStart !== null ? { start: sourceStart } : {}),
    ...(sourceEnd !== null ? { end: sourceEnd } : {}),
    transform_x_px: Math.round(positionX),
    transform_y_px: Math.round(positionY),
    rotation,
    scale_x: scaleX,
    scale_y: scaleY,
    ...(trackName ? { track_name: trackName } : {}),
    ...(width !== null ? { width } : {}),
    ...(height !== null ? { height } : {}),
    ...(settings.trackMode !== 'existing' && relativeIndex !== null ? { relative_index: relativeIndex } : {}),
    ...(replacements.length ? { replacements } : {}),
    ...animationParams,
    ...transitionParams,
  };
};

export const buildPresetAddSettingsPrompt = (settings = DEFAULT_PRESET_ADD_SETTINGS) => {
  const params = buildPresetAddRequestParams(settings);
  const animationsPayload = PRESET_ANIMATION_GROUPS.reduce((acc, { paramPrefix }) => {
    if (params[`${paramPrefix}_animation`]) {
      acc[`${paramPrefix}_animation`] = params[`${paramPrefix}_animation`];
      acc[`${paramPrefix}_animation_duration`] = params[`${paramPrefix}_animation_duration`];
    }
    return acc;
  }, {});
  return [
    '预设设置：',
    `位置大小：${JSON.stringify({
      transform_x_px: params.transform_x_px,
      transform_y_px: params.transform_y_px,
      rotation: params.rotation,
      scale_x: params.scale_x,
      scale_y: params.scale_y,
      ...(params.width ? { width: params.width } : {}),
      ...(params.height ? { height: params.height } : {}),
    })}`,
    `时间线：${JSON.stringify({
      target_start: params.target_start,
      ...(params.start !== undefined ? { start: params.start } : {}),
      ...(params.end !== undefined ? { end: params.end } : {}),
      ...(params.track_name ? { track_name: params.track_name } : {}),
      ...(params.relative_index !== undefined ? { relative_index: params.relative_index } : {}),
    })}`,
    params.replacements?.length ? `替换元素：${JSON.stringify(params.replacements)}` : '',
    Object.keys(animationsPayload).length ? `动画：${JSON.stringify(animationsPayload)}` : '',
    params.transition ? `转场：${JSON.stringify({ transition: params.transition, transition_duration: params.transition_duration })}` : '',
  ].filter(Boolean).join('\n');
};

export const getPresetAddToolSendState = ({ selectedDraftIds = [], selectedPreset = null } = {}) => {
  const hasSelectedDraft = Array.isArray(selectedDraftIds) && selectedDraftIds.length > 0;
  const presetId = String(selectedPreset?.preset_id || selectedPreset?.presetId || '').trim();
  return {
    canSend: hasSelectedDraft && Boolean(presetId),
    disabledReason: !hasSelectedDraft
      ? '必须选择一个草稿添加预设'
      : !presetId
        ? '请选择一个预设'
        : ''
  };
};

const PresetPreview = ({ preset, settings, metadata, canvas, onChange, disabled = false, pickerOpen, onPickerOpenChange, onSelect }) => {
  return <div className={`chat-panel__preset-add-preview-stage${preset ? ' has-preset' : ''}`}>
    {preset ? (
      <PresetPickerDropdown open={pickerOpen} disabled={disabled} onOpenChange={onPickerOpenChange} onSelect={onSelect}>
        <div>
          <PresetCanvas key={preset.preset_id || preset.id} preset={preset} metadata={metadata} canvas={canvas}
            settings={settings} onChange={onChange} disabled={disabled} onChoose={() => !disabled && onPickerOpenChange(true)} />
        </div>
      </PresetPickerDropdown>
    ) : (
      <PresetPickerDropdown open={pickerOpen} disabled={disabled} onOpenChange={onPickerOpenChange} onSelect={onSelect}>
        <button
          type="button"
          className="chat-panel__preset-add-preview-element"
          style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
          disabled={disabled}
          aria-label="选择预设"
          aria-expanded={pickerOpen}
        >
          <span className="chat-panel__preset-add-preview-empty">点击选择预设</span>
        </button>
      </PresetPickerDropdown>
    )}
  </div>;
};

const PresetPickerDropdown = ({ open, disabled, onOpenChange, onSelect, children }) => {
  const content = (
    <div className="chat-panel__preset-add-picker-dropdown">
      <div className="chat-panel__preset-add-picker-dropdown-list">
        <PresetList readOnly showLocal={false} onSelect={(preset) => { if (disabled) return; onSelect?.(preset); }} />
      </div>
    </div>
  );
  return <Popover
    open={open && !disabled}
    onOpenChange={(next) => { if (!disabled) onOpenChange(next); }}
    trigger="click"
    placement="bottomLeft"
    autoAdjustOverflow={false}
    getPopupContainer={(trigger) => trigger.closest('.chat-panel__text-settings-dropdown') || document.body}
    arrow={false}
    destroyOnHidden
    content={content}
    classNames={{ root: 'chat-panel__preset-add-picker-popover' }}
  >
    {children}
  </Popover>;
};

const PresetAddDetail = ({
  disabled = false,
  onBack,
  selectedDraftIds = [],
  onSelectedDraftIdsChange = null,
  selectedPreset = null,
  onSelectedPresetChange = null,
  onSettingsChange = null,
}) => {
  const [settingsOpen, setSettingsOpen] = React.useState(true);
  const [settings, setSettings] = React.useState({ ...DEFAULT_PRESET_ADD_SETTINGS });
  const [activeSettingsTab, setActiveSettingsTab] = React.useState(PRESET_SETTINGS_TABS[0].key);
  const [presetPickerOpen, setPresetPickerOpen] = React.useState(false);
  const [isTransformSectionExpanded, setIsTransformSectionExpanded] = React.useState(true);
  const [isAnimationSectionExpanded, setIsAnimationSectionExpanded] = React.useState(false);
  const [isTransitionSectionExpanded, setIsTransitionSectionExpanded] = React.useState(false);
  const [previewScript, setPreviewScript] = React.useState(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState('');
  const [metadataState, setMetadataState] = React.useState(null);
  const metadata = metadataState?.preset === selectedPreset ? metadataState.data : presetMetadata(selectedPreset || {});
  const metadataError = metadataState?.preset === selectedPreset ? metadataState.error : '';

  const selectedDraftId = String(selectedDraftIds?.[0] || '').trim();
  const hasSelectedDraft = Boolean(selectedDraftId);
  const effectiveSettings = React.useMemo(() => {
    console.log('[PresetAddDetail] effectiveSettings 计算', {
      settings,
      metadataDuration: metadata.duration,
      metadata,
      selectedPreset,
    });
    const timedSettings = metadata.duration ? { ...settings, ...resolvePresetTimes(settings, metadata.duration) } : settings;
    console.log('[PresetAddDetail] timedSettings（应用 duration 兜底后）', {
      sourceStart: timedSettings.sourceStart,
      sourceEnd: timedSettings.sourceEnd,
      targetStart: timedSettings.targetStart,
      targetEnd: timedSettings.targetEnd,
    });
    const result = previewScript ? resolvePresetTrack(timedSettings, previewScript) : timedSettings;
    console.log('[PresetAddDetail] effectiveSettings 最终结果', result);
    return result;
  }, [settings, previewScript, metadata.duration]);

  React.useEffect(() => {
    if (!selectedPreset) { setMetadataState(null); return undefined; }
    console.log('[PresetAddDetail] 开始加载预设元数据', {
      selectedPreset,
      preset_id: selectedPreset?.preset_id || selectedPreset?.id,
      url: selectedPreset?.url,
      duration_seconds: selectedPreset?.duration_seconds,
    });
    const controller = new AbortController();
    loadPresetMetadata(selectedPreset, controller.signal).then((data) => {
      console.log('[PresetAddDetail] 预设元数据加载成功', { data });
      if (!controller.signal.aborted) setMetadataState({ preset: selectedPreset, data, error: '' });
    }).catch((error) => {
      console.warn('[PresetAddDetail] 预设元数据加载失败', {
        error,
        message: error?.message,
        fallback: presetMetadata(selectedPreset),
      });
      if (!controller.signal.aborted) setMetadataState({
        preset: selectedPreset, data: presetMetadata(selectedPreset), error: error.message,
      });
    });
    return () => controller.abort();
  }, [selectedPreset]);

  React.useEffect(() => {
    setSettings((prev) => ({ ...prev, sourceStart: null, sourceEnd: null, replacements: [] }));
  }, [selectedPreset?.preset_id, selectedPreset?.id]);

  React.useEffect(() => {
    setPresetPickerOpen(false);
  }, [selectedDraftId, settingsOpen, disabled]);

  React.useEffect(() => {
    if (typeof onSettingsChange === 'function') onSettingsChange(effectiveSettings);
  }, [onSettingsChange, effectiveSettings]);

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

  const updateSetting = React.useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);
  const updateReplacements = React.useCallback((replacements) => {
    updateSetting({ replacements });
  }, [updateSetting]);

  const handleUniformScaleChange = React.useCallback((checked) => {
    setSettings((prev) => ({
      ...prev,
      uniformScale: checked,
      ...(checked ? { scaleYPercent: normalizeScalePercent(prev.scaleXPercent, prev.scaleYPercent) } : {})
    }));
  }, []);

  const handleScaleXChange = React.useCallback((value) => {
    setSettings((prev) => {
      const next = normalizeScalePercent(value, prev.scaleXPercent);
      return { ...prev, scaleXPercent: next, ...(prev.uniformScale ? { scaleYPercent: next } : {}) };
    });
  }, []);

  const handleScaleYChange = React.useCallback((value) => {
    setSettings((prev) => ({ ...prev, scaleYPercent: normalizeScalePercent(value, prev.scaleYPercent) }));
  }, []);

  const updateRotationFromPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const angle = Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2) * 180 / Math.PI;
    updateSetting({ rotation: normalizeRotationValue(angle, 0) });
  };

  const renderScaleControl = React.useCallback((value, onChange) => (
    <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
      <Slider min={1} max={500} value={value} disabled={disabled} className="chat-panel__text-settings-slider" tooltip={{ open: false }} onChange={onChange} />
      <InputNumber min={1} max={500} value={value} disabled={disabled} className="chat-panel__text-settings-number" {...NUMBER_INPUT_SHARED_PROPS} formatter={(inputValue) => `${inputValue ?? ''}%`} parser={(inputValue) => String(inputValue || '').replace('%', '')} onChange={onChange} />
    </div>
  ), [disabled]);

  const transformPanelContent = (
    <div className="chat-panel__text-settings-panel chat-panel__preset-add-settings-panel">
      <div className="chat-panel__text-settings-form">
      <section className="chat-panel__text-effect-section">
      <button
        type="button"
        className="chat-panel__text-settings-section-header"
        aria-expanded={isTransformSectionExpanded}
        onClick={() => setIsTransformSectionExpanded((prev) => !prev)}
      >
        <span className="chat-panel__text-settings-section-title">位置大小</span>
        <ChevronDown className={`chat-panel__text-settings-section-icon ${isTransformSectionExpanded ? 'is-expanded' : ''}`} aria-hidden="true" />
      </button>
      {isTransformSectionExpanded ? <>
      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">{settings.uniformScale ? '缩放' : '缩放宽度'}</div>
        {renderScaleControl(settings.scaleXPercent, handleScaleXChange)}
      </div>
      {!settings.uniformScale ? <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">缩放高度</div>
        {renderScaleControl(settings.scaleYPercent, handleScaleYChange)}
      </div> : null}
      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">等比缩放</div>
        <div className="chat-panel__text-settings-control chat-panel__text-settings-control--switch">
          <Switch checked={settings.uniformScale} disabled={disabled} className="chat-panel__text-settings-switch" onChange={handleUniformScaleChange} />
        </div>
      </div>
      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">位置</div>
        <div className="chat-panel__text-settings-control">
          <div className="chat-panel__text-settings-transform-row">
            <span className="chat-panel__text-settings-transform-label x">X</span>
            <InputNumber min={-10000} max={10000} value={settings.positionX} disabled={disabled} className="chat-panel__text-settings-number chat-panel__text-settings-transform-input" {...NUMBER_INPUT_SHARED_PROPS} onChange={(value) => updateSetting({ positionX: normalizePositionValue(value, 0) })} />
            <span className="chat-panel__text-settings-transform-label y">Y</span>
            <InputNumber min={-10000} max={10000} value={settings.positionY} disabled={disabled} className="chat-panel__text-settings-number chat-panel__text-settings-transform-input" {...NUMBER_INPUT_SHARED_PROPS} onChange={(value) => updateSetting({ positionY: normalizePositionValue(value, 0) })} />
          </div>
        </div>
      </div>
      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">平面旋转</div>
        <div className="chat-panel__text-settings-control chat-panel__text-settings-control--rotation">
          <InputNumber min={-360} max={360} value={settings.rotation} disabled={disabled} className="chat-panel__text-settings-number chat-panel__text-settings-transform-input" {...NUMBER_INPUT_SHARED_PROPS} formatter={(value) => `${value ?? ''}°`} parser={(value) => String(value || '').replace('°', '')} onChange={(value) => updateSetting({ rotation: normalizeRotationValue(value, 0) })} />
          <span
            className="chat-panel__text-settings-rotation-preview"
            style={{ '--rotation-deg': `${settings.rotation}deg` }}
            aria-label="拖动调整平面旋转"
            aria-valuemax={360}
            aria-valuemin={-360}
            aria-valuenow={settings.rotation}
            aria-disabled={disabled}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            onPointerDown={(event) => {
              if (disabled || event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              updateRotationFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) updateRotationFromPointer(event);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              if (disabled || !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
              event.preventDefault();
              const direction = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1;
              setSettings((prev) => ({ ...prev, rotation: normalizeRotationValue(prev.rotation + direction * (event.shiftKey ? 10 : 1), 0) }));
            }}
          >
            <span className="chat-panel__text-settings-rotation-indicator" />
          </span>
        </div>
      </div>
      </> : null}
      </section>
      <section className="chat-panel__text-effect-section" aria-label="动画设置">
        <div className="chat-panel__text-settings-divider" />
        <button
          type="button"
          className="chat-panel__text-settings-section-header"
          aria-expanded={isAnimationSectionExpanded}
          onClick={() => setIsAnimationSectionExpanded((prev) => !prev)}
        >
          <span className="chat-panel__text-settings-section-title">动画</span>
          <ChevronDown className={`chat-panel__text-settings-section-icon ${isAnimationSectionExpanded ? 'is-expanded' : ''}`} aria-hidden="true" />
        </button>
        {isAnimationSectionExpanded ? (
          <div className="chat-panel__text-settings-form">
            {PRESET_ANIMATION_GROUPS.map(({ key, label, options }) => {
              const value = resolveAnimationSetting(settings[key], DEFAULT_PRESET_ADD_SETTINGS[key]);
              return (
                <div key={key} className="chat-panel__text-animation-group" aria-label={`${label}设置`}>
                  <label className="chat-panel__text-effect-header">
                    <input type="checkbox" aria-label={`启用${label}`} checked={value.enabled} disabled={disabled}
                      onChange={(event) => updateSetting({ [key]: { ...value, enabled: event.target.checked } })} />
                    <span className="chat-panel__text-settings-section-title">{label}</span>
                  </label>
                  <fieldset className="chat-panel__text-effect-fields" disabled={disabled || !value.enabled}>
                    <div className="chat-panel__text-settings-row">
                      <div className="chat-panel__text-settings-label">动画</div>
                      <div className="chat-panel__text-settings-control chat-panel__text-animation-control">
                        <Select aria-label={`选择${label}`} className="chat-panel__text-settings-select"
                          value={value.animation || undefined} placeholder="请选择动画" showSearch
                          optionFilterProp="label" options={options}
                          disabled={disabled || !value.enabled}
                          getPopupContainer={(node) => node.closest('.chat-panel__text-settings-popup') || document.body}
                          styles={{ popup: { root: { zIndex: 1600 } } }}
                          onChange={(animation) => {
                            const selected = options.find((option) => option.value === animation);
                            const duration = selected && Number.isFinite(selected.duration) && selected.duration > 0
                              ? clampAnimationDuration(selected.duration, value.duration)
                              : value.duration;
                            updateSetting({ [key]: { ...value, animation, duration } });
                          }} />
                      </div>
                    </div>
                    <div className="chat-panel__text-settings-row">
                      <div className="chat-panel__text-settings-label">持续时间</div>
                      <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
                        <Slider min={0.1} max={3} step={0.1} value={value.duration}
                          disabled={disabled || !value.enabled} className="chat-panel__text-settings-slider"
                          tooltip={{ formatter: (input) => `${input} 秒` }}
                          onChange={(duration) => updateSetting({ [key]: { ...value, duration: clampAnimationDuration(duration, value.duration) } })} />
                        <InputNumber aria-label={`${label}持续时间`} min={0.1} max={3} step={0.1} precision={1}
                          value={value.duration} disabled={disabled || !value.enabled}
                          className="chat-panel__text-settings-number" controls changeOnWheel
                          formatter={(input) => `${input ?? ''} 秒`} parser={(input) => String(input || '').replace('秒', '').trim()}
                          onChange={(duration) => {
                            if (duration != null) updateSetting({ [key]: { ...value, duration: clampAnimationDuration(duration, value.duration) } });
                          }} />
                      </div>
                    </div>
                  </fieldset>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
      <section className="chat-panel__text-effect-section" aria-label="转场设置">
        <div className="chat-panel__text-settings-divider" />
        <div className="chat-panel__text-effect-header">
          <input type="checkbox" aria-label="启用转场"
            checked={resolveTransitionSetting(settings.transition, DEFAULT_PRESET_ADD_SETTINGS.transition).enabled}
            disabled={disabled}
            onChange={(event) => {
              const current = resolveTransitionSetting(settings.transition, DEFAULT_PRESET_ADD_SETTINGS.transition);
              updateSetting({ transition: { ...current, enabled: event.target.checked } });
            }} />
          <button
            type="button"
            className="chat-panel__text-settings-section-header"
            aria-expanded={isTransitionSectionExpanded}
            onClick={() => setIsTransitionSectionExpanded((prev) => !prev)}
          >
            <span className="chat-panel__text-settings-section-title">转场</span>
            <ChevronDown className={`chat-panel__text-settings-section-icon ${isTransitionSectionExpanded ? 'is-expanded' : ''}`} aria-hidden="true" />
          </button>
        </div>
        {isTransitionSectionExpanded ? (() => {
          const value = resolveTransitionSetting(settings.transition, DEFAULT_PRESET_ADD_SETTINGS.transition);
          return (
            <fieldset className="chat-panel__text-effect-fields" disabled={disabled || !value.enabled}>
              <div className="chat-panel__text-settings-row">
                <div className="chat-panel__text-settings-label">转场</div>
                <div className="chat-panel__text-settings-control chat-panel__text-animation-control">
                  <Select aria-label="选择转场" className="chat-panel__text-settings-select"
                    value={value.transition || undefined} placeholder="请选择转场" showSearch
                    optionFilterProp="label" options={PRESET_TRANSITION_OPTIONS}
                    disabled={disabled || !value.enabled}
                    getPopupContainer={(node) => node.closest('.chat-panel__text-settings-popup') || document.body}
                    styles={{ popup: { root: { zIndex: 1600 } } }}
                    onChange={(transition) => {
                      const selected = PRESET_TRANSITION_OPTIONS.find((option) => option.value === transition);
                      const duration = selected && Number.isFinite(selected.duration) && selected.duration > 0
                        ? clampAnimationDuration(selected.duration, value.duration)
                        : value.duration;
                      updateSetting({ transition: { ...value, transition, duration } });
                    }} />
                </div>
              </div>
              <div className="chat-panel__text-settings-row">
                <div className="chat-panel__text-settings-label">持续时间</div>
                <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
                  <Slider min={0.1} max={3} step={0.1} value={value.duration}
                    disabled={disabled || !value.enabled} className="chat-panel__text-settings-slider"
                    tooltip={{ formatter: (input) => `${input} 秒` }}
                    onChange={(duration) => updateSetting({ transition: { ...value, duration: clampAnimationDuration(duration, value.duration) } })} />
                  <InputNumber aria-label="转场持续时间" min={0.1} max={3} step={0.1} precision={1}
                    value={value.duration} disabled={disabled || !value.enabled}
                    className="chat-panel__text-settings-number" controls changeOnWheel
                    formatter={(input) => `${input ?? ''} 秒`} parser={(input) => String(input || '').replace('秒', '').trim()}
                    onChange={(duration) => {
                      if (duration != null) updateSetting({ transition: { ...value, duration: clampAnimationDuration(duration, value.duration) } });
                    }} />
                </div>
              </div>
            </fieldset>
          );
        })() : null}
      </section>
      </div>
    </div>
  );

  const timelinePanelContent = (
    <div className="chat-panel__text-settings-panel chat-panel__preset-add-settings-panel">
      <PresetTimelinePanel script={previewScript} loading={previewLoading} error={previewError}
        settings={effectiveSettings} onChange={updateSetting} disabled={disabled}
        preset={selectedPreset} duration={metadata.duration} />
      {metadataError && <div role="alert" className="chat-panel__text-preset-error">{metadataError}</div>}
    </div>
  );

  const settingsPanelContent = activeSettingsTab === 'timeline' ? timelinePanelContent : transformPanelContent;

  const settingsPopupContent = (
    <div className={`chat-panel__text-settings-popup chat-panel__preset-add-settings-popup${hasSelectedDraft ? '' : ' chat-panel__text-settings-popup--preview-only'}`}>
      <div className="chat-panel__text-settings-layout">
        <div className="chat-panel__text-settings-preview chat-panel__preset-add-settings-preview">
          <div className="chat-panel__text-settings-preview-stage">
            {hasSelectedDraft ? (
              <div className="chat-panel__text-settings-preview-selector chat-panel__text-settings-preview-selector--top">
                <DraftSelect mode="single" disabled={disabled} selectedDraftIds={selectedDraftIds} onSelectedDraftIdsChange={onSelectedDraftIdsChange} placeholder="选择草稿" searchPlaceholder="搜索草稿id" triggerClassName="chat-panel__text-settings-draft-select" popoverClassName="chat-panel__text-settings-draft-select-popover" />
              </div>
            ) : null}
            <div className="chat-panel__text-settings-preview-canvas-shell chat-panel__preset-add-preview-shell">
              {!hasSelectedDraft ? (
                <div className="chat-panel__text-settings-preview-selector chat-panel__text-settings-preview-selector--empty">
                  <DraftSelect mode="single" disabled={disabled} selectedDraftIds={selectedDraftIds} onSelectedDraftIdsChange={onSelectedDraftIdsChange} placeholder="选择草稿" searchPlaceholder="搜索草稿id" triggerClassName="chat-panel__text-settings-draft-select" popoverClassName="chat-panel__text-settings-draft-select-popover" />
                </div>
              ) : (
                <PresetPreview
                  preset={selectedPreset}
                  settings={settings}
                  metadata={metadata}
                  canvas={previewScript?.canvas_config}
                  onChange={updateSetting}
                  disabled={disabled}
                  pickerOpen={presetPickerOpen}
                  onPickerOpenChange={setPresetPickerOpen}
                  onSelect={(preset) => {
                    onSelectedPresetChange?.(preset);
                    setPresetPickerOpen(false);
                  }}
                />
              )}
            </div>
          </div>
        </div>
        {hasSelectedDraft ? (
          <div className="chat-panel__text-settings-main chat-panel__preset-add-settings-main">
            <div className="chat-panel__text-settings-content">
              {selectedPreset && (
                <PresetReplacementPanel
                  key={selectedPreset?.preset_id || selectedPreset?.id}
                  preset={selectedPreset}
                  disabled={disabled}
                  onChange={updateReplacements}
                />
              )}
              {settingsPanelContent}
            </div>
            <div className="chat-panel__text-settings-tabs" role="tablist" aria-label="预设设置">
              {PRESET_SETTINGS_TABS.map((tab) => (
                <button key={tab.key} type="button" className={`chat-panel__text-settings-tab ${activeSettingsTab === tab.key ? 'active' : ''}`} title={tab.label} aria-label={tab.label} onClick={() => setActiveSettingsTab(tab.key)}>
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
    <div className="chat-panel__tool-detail-area chat-panel__preset-add-detail" role="group" aria-label="添加预设工具">
      <button type="button" className="chat-panel__tool-button chat-panel__tool-button--active" onClick={onBack} disabled={disabled}>
        <img className="chat-panel__tool-text-add-icon chat-panel__preset-add-tool-icon" src={PresetIcon} alt="" aria-hidden="true" />
        <span className="chat-panel__tool-text chat-panel__tool-text--active">添加预设</span>
        <CloseOutlined className="chat-panel__tool-close-icon" />
      </button>
      <Dropdown disabled={disabled} open={settingsOpen} autoAdjustOverflow={false} onOpenChange={(open) => !disabled && setSettingsOpen(open)} popupRender={() => settingsPopupContent} trigger={['click']} placement="topLeft" overlayClassName="chat-panel__text-settings-dropdown" menu={{ items: [] }}>
        <span className="chat-panel__tool-dropdown-trigger">
        <button type="button" className={`chat-panel__draft-select-trigger chat-panel__text-settings-trigger ${settingsOpen ? 'is-open' : ''}`} disabled={disabled} aria-label="设置" title="设置">
          <SlidersHorizontal className="chat-panel__text-settings-trigger-icon" aria-hidden="true" />
          <span className="chat-panel__tool-text chat-panel__text-settings-trigger-text">设置</span>
          <DownOutlined className="chat-panel__tool-close-icon" />
        </button>
        </span>
      </Dropdown>
    </div>
  );
};

export default PresetAddDetail;
