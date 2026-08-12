import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { Select, Tooltip } from 'antd';
import './index.css';
import VideoResolutionSelect from '../VideoResolutionSelect/index';
import ImageModelJimengBlackIcon from '../../../../../public/image_model_jimeng_black.svg';
import AiVideoSelectedIcon from '../../../../../public/ai_video_selected.svg';

const VIDEO_MODEL_OPTIONS = [
  { value: 'seedance-2.0', label: 'Seedance 2.0' },
  { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast' },
  { value: 'seedance-1.5-pro', label: 'Seedance 1.5 Pro' },
];

const VIDEO_RESOLUTION_OPTIONS = [
  { value: '720x1280', label: '9:16 | 720P' },
  { value: '960x960', label: '1:1 | 720P' },
  { value: '1280x720', label: '16:9 | 720P' },
];

const normalizeModelLabel = (model) => {
  const raw = String(model || '').trim();
  if (!raw) return '';
  if (raw === 'seedance-1.5-pro') return 'Seedance 1.5 Pro';
  if (raw === 'seedance-2.0') return 'Seedance 2.0';
  if (raw === 'seedance-2.0-fast') return 'Seedance 2.0 Fast';
  return raw;
};

const getModelIcon = (model) => {
  const normalized = String(model || '').trim().toLowerCase();
  if (normalized.startsWith('seedance-') || normalized.startsWith('doubao-seedance-')) return ImageModelJimengBlackIcon;
  return null;
};

const renderModelContent = (model, label, description = '') => {
  const icon = getModelIcon(model);
  return (
    <span className="chat-panel__video-option" title={description || label}>
      {icon ? <img className="chat-panel__video-option-icon" src={icon} alt="" aria-hidden="true" /> : null}
      <span className="chat-panel__video-option-main">
        <span className="chat-panel__video-option-text">{label}</span>
        {description ? <span className="chat-panel__video-option-description">{description}</span> : null}
      </span>
    </span>
  );
};

const renderSelectedLabel = (text, open = false, icon = null) => (
  <span className="chat-panel__video-selected">
    <span className="chat-panel__model-option-main">
      {icon ? <img className="chat-panel__video-option-icon" src={icon} alt="" aria-hidden="true" /> : null}
      <span className="chat-panel__model-option-text">{text}</span>
    </span>
    <DownOutlined
      className={`chat-panel__video-selected-arrow ${open ? 'is-open' : ''}`}
      aria-hidden="true"
    />
  </span>
);

const VideoToolDetail = ({
  disabled = false,
  onBack,
  selectedModel = 'seedance-2.0',
  selectedResolution = '720x1280',
  selectedDuration = 5,
  selectedGenerateAudio = true,
  selectedSeedanceOffline = false,
  selectedSuperResolve = false,
  onModelChange = null,
  onResolutionChange = null,
  onDurationChange = null,
  onGenerateAudioChange = null,
  onSeedanceOfflineChange = null,
  onSuperResolveChange = null,
}) => {
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const [capabilityModels, setCapabilityModels] = React.useState([]);

  React.useEffect(() => {
    let cancelled = false;

    const loadCapabilities = async () => {
      const api = window?.electronAPI?.videoGeneration;
      if (!api || typeof api.getCapabilities !== 'function') return;

      try {
        const result = await api.getCapabilities({ includePrices: true });
        const models = Array.isArray(result?.models) ? result.models : [];
        if (!cancelled && models.length > 0) {
          setCapabilityModels(models);
        }
      } catch (_error) {
        if (!cancelled) {
          setCapabilityModels([]);
        }
      }
    };

    void loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedModelOptions = React.useMemo(() => {
    if (capabilityModels.length === 0) return VIDEO_MODEL_OPTIONS;
    return capabilityModels.map((item) => ({
      value: String(item?.model || '').trim(),
      label: String(item?.display_name || '').trim() || normalizeModelLabel(item?.model),
      description: String(item?.description || '').trim(),
    })).filter((item) => item.value);
  }, [capabilityModels]);

  const resolvedResolutionOptions = React.useMemo(() => {
    const activeCapability = capabilityModels.find((item) => String(item?.model || '').trim() === String(selectedModel || '').trim());
    const resolutions = activeCapability?.resolutions && typeof activeCapability.resolutions === 'object'
      ? activeCapability.resolutions
      : null;
    if (!resolutions) return VIDEO_RESOLUTION_OPTIONS;

    const tierLabelMap = {
      '480p': '480P',
      '720p': '720P',
      '1080p': '1080P',
    };

    const options = Object.entries(resolutions).flatMap(([tier, items]) =>
      (Array.isArray(items) ? items : []).map((item) => ({
        value: String(item?.size || '').trim(),
        label: `${String(item?.ratio || '').trim() || '--'} | ${tierLabelMap[tier] || tier.toUpperCase()}`,
      }))
    ).filter((item) => item.value);

    return options.length > 0 ? options : VIDEO_RESOLUTION_OPTIONS;
  }, [capabilityModels, selectedModel]);

  const capabilityMap = React.useMemo(() => capabilityModels.reduce((acc, item) => {
    const key = String(item?.model || '').trim();
    if (!key) return acc;
    acc[key] = item;
    return acc;
  }, {}), [capabilityModels]);

  const activeCapability = React.useMemo(
    () => capabilityMap[String(selectedModel || '').trim()] || null,
    [capabilityMap, selectedModel]
  );

  React.useEffect(() => {
    if (capabilityModels.length === 0) return;
    if (!resolvedModelOptions.some((item) => item.value === selectedModel) && resolvedModelOptions[0]?.value) {
      onModelChange && onModelChange(resolvedModelOptions[0].value);
    }
  }, [capabilityModels.length, onModelChange, resolvedModelOptions, selectedModel]);

  React.useEffect(() => {
    if (capabilityModels.length === 0) return;
    if (!resolvedResolutionOptions.some((item) => item.value === selectedResolution) && resolvedResolutionOptions[0]?.value) {
      onResolutionChange && onResolutionChange(resolvedResolutionOptions[0].value);
    }
  }, [capabilityModels.length, onResolutionChange, resolvedResolutionOptions, selectedResolution]);

  React.useEffect(() => {
    if (!activeCapability) return;
    if (!activeCapability.generate_audio_supported && selectedGenerateAudio === false) {
      onGenerateAudioChange && onGenerateAudioChange(true);
    }
    if (!activeCapability.seedance_offline_supported && selectedSeedanceOffline === true) {
      onSeedanceOfflineChange && onSeedanceOfflineChange(false);
    }
    if (!activeCapability.super_resolve_supported && selectedSuperResolve === true) {
      onSuperResolveChange && onSuperResolveChange(false);
    }
  }, [
    activeCapability,
    onGenerateAudioChange,
    onSeedanceOfflineChange,
    onSuperResolveChange,
    selectedGenerateAudio,
    selectedSeedanceOffline,
    selectedSuperResolve,
  ]);

  const modelOptions = React.useMemo(() => resolvedModelOptions.map((item) => ({
    value: item.value,
    label: renderModelContent(item.value, item.label, item.description),
    selectedLabel: renderSelectedLabel(item.label, modelPickerOpen, getModelIcon(item.value)),
  })), [modelPickerOpen, resolvedModelOptions]);

  return (
    <div className="chat-panel__tool-detail-area">
      <Tooltip title="点击退出">
        <span className="chat-panel__tool-tooltip-trigger">
          <button
            type="button"
            className="chat-panel__tool-button chat-panel__tool-button--active"
            aria-label="视频"
            title="视频"
            aria-pressed="true"
            disabled={disabled}
            onClick={onBack}
          >
            <img className="chat-panel__tool-icon" src={AiVideoSelectedIcon} alt="" aria-hidden="true" />
            <span className="chat-panel__tool-text chat-panel__tool-text--active">视频</span>
            <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      <div className="chat-panel__tool-detail-content">
        <Select
          size="small"
          variant="borderless"
          className="chat-panel__model-picker chat-panel__video-picker"
          classNames={{ popup: { root: 'chat-panel__video-picker-dropdown' } }}
          listHeight={320}
          value={selectedModel}
          options={modelOptions}
          optionLabelProp="selectedLabel"
          onChange={(value) => onModelChange && onModelChange(value)}
          onOpenChange={setModelPickerOpen}
          disabled={disabled}
          popupMatchSelectWidth={false}
          getPopupContainer={() => document.body}
          popupRender={(menu) => (
            <div className="chat-panel__video-picker-popup" onPointerDown={(event) => event.stopPropagation()}>
              <div className="chat-panel__video-picker-title">模型</div>
              {menu}
            </div>
          )}
          optionRender={(option) => option.data.label}
        />
        <VideoResolutionSelect
          model={selectedModel}
          capabilities={capabilityMap}
          value={selectedResolution}
          duration={selectedDuration}
          generateAudio={selectedGenerateAudio}
          seedanceOffline={selectedSeedanceOffline}
          superResolve={selectedSuperResolve}
          onChange={onResolutionChange}
          onDurationChange={onDurationChange}
          onGenerateAudioChange={onGenerateAudioChange}
          onSeedanceOfflineChange={onSeedanceOfflineChange}
          onSuperResolveChange={onSuperResolveChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
};

export {
  VIDEO_MODEL_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
};

export default VideoToolDetail;
