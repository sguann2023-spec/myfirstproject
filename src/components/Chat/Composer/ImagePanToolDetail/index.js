import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { Select, Tooltip } from 'antd';
import './index.css';
import ImageResolutionSelect from '../ImageResolutionSelect/index';
import ImageModelGptBlackIcon from '../../../../../public/image_model_gpt_black.svg';
import ImageModelJimengBlackIcon from '../../../../../public/image_model_jimeng_black.svg';
import ImageModelNanoBananaBlackIcon from '../../../../../public/image_model_nano_banana_black.svg';
import ImagePanSelectedIcon from '../../../../../public/image_pan_selected.svg';
import Point2Icon from '../../../../../public/point2.svg';

const IMAGE_MODEL_OPTIONS = [
  { value: 'seedream-4.5', label: 'seedream-4.5' },
  { value: 'nano_banana_pro', label: 'Nano Banana Pro' },
  { value: 'nano_banana', label: 'Nano Banana' },
];

const IMAGE_RESOLUTION_OPTIONS = [
  { value: '1024x1024', label: '1:1 | 标清1K' },
  { value: '2560x1440', label: '16:9 | 高清2K' },
  { value: '1440x2560', label: '9:16 | 高清2K' },
];

const getModelIcon = (model) => {
  const normalized = String(model || '').trim().toLowerCase();
  if (normalized.startsWith('nano_banana')) return ImageModelNanoBananaBlackIcon;
  if (normalized === 'gpt-image-2' || normalized === 'gpt-image-2-all') return ImageModelGptBlackIcon;
  if (normalized.startsWith('seedream-') || normalized.startsWith('jimeng-')) return ImageModelJimengBlackIcon;
  return null;
};

const normalizeModelLabel = (model) => {
  const raw = String(model || '').trim();
  if (!raw) return '';
  if (raw === 'jimeng-5.0') return 'seedream-5.0';
  if (raw === 'jimeng-4.5') return 'seedream-4.5';
  if (raw === 'jimeng-4.0') return 'seedream-4.0';
  if (raw === 'jimeng-3.0') return 'seedream-3.0';
  if (raw === 'nano_banana_pro') return 'Nano Banana Pro';
  if (raw === 'nano_banana_2') return 'Nano Banana 2';
  if (raw === 'nano_banana') return 'Nano Banana';
  if (raw === 'gpt-image-2-all') return 'GPT Image 2';
  return raw;
};

const formatImagePriceText = (price) => {
  const normalizedPrice = String(price || '').trim();
  if (!normalizedPrice) return '--/张';

  const numericPrice = Number(normalizedPrice);
  if (Number.isFinite(numericPrice)) {
    const formattedPrice = Number.isInteger(numericPrice)
      ? String(numericPrice)
      : String(Number(numericPrice.toFixed(1)));
    return `${formattedPrice}/张`;
  }

  return `${normalizedPrice}/张`;
};

const IMAGE_TEMPLATE_PREFERRED_TIERS = ['1K', '2K', '3K', '4K'];

const pickResolutionByTemplate = (capabilityMap, model, ratio) => {
  const resolutions = capabilityMap?.[model]?.resolutions;
  if (!resolutions || typeof resolutions !== 'object') return '';

  for (const tier of IMAGE_TEMPLATE_PREFERRED_TIERS) {
    const matched = (Array.isArray(resolutions[tier]) ? resolutions[tier] : []).find((item) => item?.ratio === ratio && item?.size);
    if (matched?.size) return String(matched.size).trim();
  }

  for (const items of Object.values(resolutions)) {
    const matched = (Array.isArray(items) ? items : []).find((item) => item?.ratio === ratio && item?.size);
    if (matched?.size) return String(matched.size).trim();
  }

  return '';
};

const renderModelContent = (model, label, description = '') => {
  const icon = getModelIcon(model);
  return (
    <span className="chat-panel__image-pan-option">
      {icon ? <img className="chat-panel__image-pan-option-icon" src={icon} alt="" aria-hidden="true" /> : null}
      <span className="chat-panel__image-pan-option-main">
        <span className="chat-panel__image-pan-option-text">{label}</span>
        {description ? <span className="chat-panel__image-pan-option-description">{description}</span> : null}
      </span>
    </span>
  );
};

const renderSelectedLabel = (text, open = false, icon = null) => (
  <span className="chat-panel__image-pan-selected">
    <span className="chat-panel__model-option-main">
      {icon ? <img className="chat-panel__image-pan-option-icon" src={icon} alt="" aria-hidden="true" /> : null}
      <span className="chat-panel__model-option-text">{text}</span>
    </span>
    <DownOutlined
      className={`chat-panel__image-pan-selected-arrow ${open ? 'is-open' : ''}`}
      aria-hidden="true"
    />
  </span>
);

const ImagePanToolDetail = ({
  disabled = false,
  onBack,
  selectedModel = 'seedream-4.5',
  selectedResolution = '1440x2560',
  onModelChange = null,
  onResolutionChange = null,
  onPromptChange = null,
  onTemplateMediaChange = null,
}) => {
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const [capabilityModels, setCapabilityModels] = React.useState([]);

  React.useEffect(() => {
    let cancelled = false;

    const loadCapabilities = async () => {
      const api = window?.electronAPI?.imageGeneration;
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
    if (capabilityModels.length === 0) return IMAGE_MODEL_OPTIONS;
    return capabilityModels.map((item) => ({
      value: String(item?.model || '').trim(),
      label: String(item?.display_name || '').trim() || normalizeModelLabel(item?.model),
      description: String(item?.description || '').trim(),
      priceText: formatImagePriceText(item?.price?.resource_points_per_unit),
    })).filter((item) => item.value);
  }, [capabilityModels]);

  const resolvedResolutionOptions = React.useMemo(() => {
    const activeCapability = capabilityModels.find((item) => String(item?.model || '').trim() === String(selectedModel || '').trim());
    const resolutions = activeCapability?.resolutions && typeof activeCapability.resolutions === 'object'
      ? activeCapability.resolutions
      : null;
    if (!resolutions) return IMAGE_RESOLUTION_OPTIONS;

    const tierLabelMap = {
      '1K': '标清1K',
      '2K': '高清2K',
      '3K': '超清3K',
      '4K': '超清4K',
    };

    const options = Object.entries(resolutions).flatMap(([tier, items]) =>
      (Array.isArray(items) ? items : []).map((item) => ({
        value: String(item?.size || '').trim(),
        label: `${String(item?.ratio || '').trim() || '--'} | ${tierLabelMap[tier] || tier}`,
      }))
    ).filter((item) => item.value);

    return options.length > 0 ? options : IMAGE_RESOLUTION_OPTIONS;
  }, [capabilityModels, selectedModel]);

  const capabilityMap = React.useMemo(() => capabilityModels.reduce((acc, item) => {
    const key = String(item?.model || '').trim();
    if (!key) return acc;
    acc[key] = item;
    return acc;
  }, {}), [capabilityModels]);

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

  const modelOptions = React.useMemo(() => resolvedModelOptions.map((item) => ({
    value: item.value,
    label: (
      <span className="chat-panel__image-pan-option-wrap">
        {renderModelContent(item.value, item.label, item.description)}
        <span className="chat-panel__image-pan-option-price-wrap">
          <img className="chat-panel__image-pan-option-price-icon" src={Point2Icon} alt="" aria-hidden="true" />
          <span className="chat-panel__image-pan-option-price">{item.priceText || '--/张'}</span>
        </span>
      </span>
    ),
    selectedLabel: renderSelectedLabel(item.label, modelPickerOpen, getModelIcon(item.value)),
  })), [modelPickerOpen, resolvedModelOptions]);

  const handleApplyTemplate = React.useCallback((template) => {
    const nextModel = String(template?.model || '').trim();
    const nextRatio = String(template?.ratio || '').trim();
    const nextPrompt = String(template?.prompt || '').trim();

    if (nextModel && onModelChange) {
      onModelChange(nextModel);
    }

    const nextResolution = pickResolutionByTemplate(capabilityMap, nextModel, nextRatio);
    if (nextResolution && onResolutionChange) {
      onResolutionChange(nextResolution);
    }

    if (nextPrompt && onPromptChange) {
      onPromptChange(nextPrompt);
    }
    if (onTemplateMediaChange) {
      onTemplateMediaChange(template);
    }
  }, [capabilityMap, onModelChange, onPromptChange, onResolutionChange, onTemplateMediaChange]);

  return (
    <div className="chat-panel__tool-detail-area">
      <Tooltip title="点击退出">
        <span className="chat-panel__tool-tooltip-trigger">
          <button
            type="button"
            className="chat-panel__tool-button chat-panel__tool-button--active"
            aria-label="图片"
            title="图片"
            aria-pressed="true"
            disabled={disabled}
            onClick={onBack}
          >
            <img className="chat-panel__tool-icon" src={ImagePanSelectedIcon} alt="" aria-hidden="true" />
            <span className="chat-panel__tool-text chat-panel__tool-text--active">图片</span>
            <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      <div className="chat-panel__tool-detail-content">
        <Select
          size="small"
          variant="borderless"
          className="chat-panel__model-picker chat-panel__image-pan-picker"
          classNames={{ popup: { root: 'chat-panel__image-pan-picker-dropdown' } }}
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
            <div className="chat-panel__image-pan-picker-popup" onPointerDown={(event) => event.stopPropagation()}>
              <div className="chat-panel__image-pan-picker-title">模型</div>
              {menu}
            </div>
          )}
          optionRender={(option) => {
            return option.data.label;
          }}
        />
        <ImageResolutionSelect
          model={selectedModel}
          capabilities={capabilityMap}
          value={selectedResolution}
          onChange={onResolutionChange}
          onTemplateApply={handleApplyTemplate}
          disabled={disabled}
        />
      </div>
    </div>
  );
};

export {
  IMAGE_MODEL_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
};

export default ImagePanToolDetail;
