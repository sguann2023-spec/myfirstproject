import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { Dropdown, Tooltip } from 'antd';
import { Badge } from 'lucide-react';
import { MEMBER_COLOR, normalizeMemberProvider } from '../../constants/member';
import VoiceSelectedIcon from '../../../public/voice_selected.svg';
import Point2Icon from '../../../public/point2.svg';
import VoiceLib, { useVoiceLib } from '../Chat/Composer/VoiceLib';
import './index.css';

const DEFAULT_TTS_MODEL_OPTIONS = {
  minimax: [
    { value: 'speech-2.6-turbo', label: 'speech-2.6-turbo', price_text: '4.8/百字' },
    { value: 'speech-2.6-hd', label: 'speech-2.6-hd', price_text: '6.4/百字' },
  ],
  elevenlabs: [
    { value: 'flash_v2_5', label: 'flash_v2_5', price_text: '7/百字' },
    { value: 'multilingual_v2', label: 'multilingual_v2', price_text: '14/百字' },
  ],
  volc: [
    { value: '', label: '默认模型', price_text: '6.4/百字' },
  ],
  azure: [
    { value: '', label: '默认模型', price_text: '3/百字' },
  ],
  fish: [
    { value: '', label: '默认模型', price_text: '4.8/百字' },
  ],
};

const DEFAULT_MODEL_KEY = '__default__';
const TTS_TEXT_BILLING_UNIT_SIZE = 100;

const normalizeModelOption = (item = {}) => {
  if (typeof item === 'string') {
    return { value: item, label: item, price_text: '' };
  }

  const value = String(item?.value ?? item?.model ?? '').trim();
  const label = String(item?.label || item?.name || value || '默认模型').trim();
  return {
    ...item,
    value,
    label,
    price_text: String(item?.price_text || item?.price || '').trim(),
    resource_points_per_unit: Number(item?.resource_points_per_unit),
    price_unit: String(item?.price_unit || '').trim(),
  };
};

const parsePriceTextValue = (priceText = '') => {
  const matched = String(priceText || '').match(/\d+(?:\.\d+)?/);
  if (!matched) return null;
  const value = Number(matched[0]);
  return Number.isFinite(value) ? value : null;
};

const formatPointCost = (value) => {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return '';
  return `${Number(normalized.toFixed(2)).toString()}积分`;
};

const buildActualPriceText = (modelOption = null, text = '') => {
  if (!modelOption) return '';
  const unitPrice = Number.isFinite(Number(modelOption?.resource_points_per_unit))
    ? Number(modelOption.resource_points_per_unit)
    : parsePriceTextValue(modelOption?.price_text);
  if (!Number.isFinite(unitPrice)) return '';

  const charCount = String(text || '').trim().length;
  const billingUnits = Math.max(0, Math.ceil(charCount / TTS_TEXT_BILLING_UNIT_SIZE));
  return formatPointCost(unitPrice * billingUnits);
};

const getVoiceProvider = (voiceItem = {}) => normalizeMemberProvider(
  voiceItem?.price_provider || voiceItem?.providers || voiceItem?.provider
);

const getVoiceModelOptions = (voiceItem = {}) => {
  const provider = getVoiceProvider(voiceItem);
  const backendOptions = Array.isArray(voiceItem?.tts_model_options)
    ? voiceItem.tts_model_options
    : (Array.isArray(voiceItem?.tts_pricing?.models) ? voiceItem.tts_pricing.models : []);
  const options = (backendOptions.length ? backendOptions : DEFAULT_TTS_MODEL_OPTIONS[provider] || [
    { value: '', label: '默认模型', price_text: String(voiceItem?.price_text || '').trim() },
  ])
    .map(normalizeModelOption)
    .filter(Boolean);

  return options.length ? options : [{ value: '', label: '默认模型', price_text: '' }];
};

const resolveSelectedModelOption = (options, selectedModel) => {
  const normalizedModel = String(selectedModel || '').trim();
  return options.find((item) => item.value === normalizedModel) || options[0] || null;
};

const TTSToolDetail = ({
  disabled = false,
  onBack,
  onSelectedVoiceChange = null,
  selectedModel = '',
  onModelChange = null,
  inputText = '',
}) => {
  const voiceLib = useVoiceLib({ onSelectedVoiceChange });
  const [voicePickerOpen, setVoicePickerOpen] = React.useState(false);
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const selectedVoice = voiceLib?.selectedVoiceLibraryItem || null;
  const modelOptions = React.useMemo(() => getVoiceModelOptions(selectedVoice), [selectedVoice]);
  const selectedModelOption = React.useMemo(
    () => resolveSelectedModelOption(modelOptions, selectedModel),
    [modelOptions, selectedModel]
  );

  React.useEffect(() => {
    if (!selectedModelOption || typeof onModelChange !== 'function') return;
    if (String(selectedModel || '').trim() === selectedModelOption.value) return;
    onModelChange(selectedModelOption.value);
  }, [onModelChange, selectedModel, selectedModelOption]);

  const modelMenuItems = React.useMemo(() => modelOptions.map((item) => ({
    key: item.value || DEFAULT_MODEL_KEY,
    label: (
      <span className="chat-panel__tts-model-menu-item">
        <span className="chat-panel__tts-model-menu-name">{item.label}</span>
      </span>
    ),
    onClick: () => {
      if (typeof onModelChange === 'function') {
        onModelChange(item.value);
      }
    },
  })), [modelOptions, onModelChange]);

  const selectedPriceText = buildActualPriceText(selectedModelOption, inputText);
  const canSwitchModel = modelOptions.length > 1;
  const modelButtonContent = (
    <>
      <Badge className="chat-panel__tts-model-icon" aria-hidden="true" />
      <span className="chat-panel__tool-text chat-panel__tts-model-trigger-text">
        {selectedModelOption?.label || '默认模型'}
      </span>
      {canSwitchModel ? (
        <DownOutlined
          className={`chat-panel__tool-dropdown-arrow ${modelPickerOpen ? 'open' : ''}`}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return (
    <div className="chat-panel__tts-tool-detail chat-panel__tool-detail-area" style={{ '--member-color': MEMBER_COLOR }}>
      <Tooltip title="点击退出">
        <span className="chat-panel__tool-tooltip-trigger">
          <button
            type="button"
            className="chat-panel__tool-button chat-panel__tool-button--active"
            aria-label="AI朗读"
            title="AI朗读"
            aria-pressed="true"
            disabled={disabled}
            onClick={onBack}
          >
            <img className="chat-panel__tool-icon" src={VoiceSelectedIcon} alt="" aria-hidden="true" />
            <span className="chat-panel__tool-text chat-panel__tool-text--active">AI朗读</span>
            <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      <div className="chat-panel__tool-detail-content">
        <VoiceLib
          controller={voiceLib}
          disabled={disabled}
          active={voicePickerOpen}
          onOpenChange={setVoicePickerOpen}
        />
        {canSwitchModel ? (
          <Dropdown
            disabled={disabled}
            trigger={['click']}
            open={modelPickerOpen}
            onOpenChange={setModelPickerOpen}
            overlayClassName="chat-panel__tts-model-dropdown"
            placement="bottomLeft"
            menu={{ items: modelMenuItems, selectedKeys: [selectedModelOption?.value || DEFAULT_MODEL_KEY] }}
          >
            <span className="chat-panel__tool-dropdown-trigger">
              <button
                type="button"
                className={`chat-panel__tool-button chat-panel__tts-model-button ${modelPickerOpen ? 'chat-panel__tool-button--sub-active' : ''}`}
                aria-label="选择语音模型"
                title="选择语音模型"
                disabled={disabled}
              >
                {modelButtonContent}
              </button>
            </span>
          </Dropdown>
        ) : null}
        {selectedPriceText ? (
          <span className="chat-panel__tts-model-price" title={`预计消耗 ${selectedPriceText}`}>
            <img className="chat-panel__tts-model-price-icon" src={Point2Icon} alt="" aria-hidden="true" />
            <span className="chat-panel__tts-model-price-text">{selectedPriceText}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default TTSToolDetail;
