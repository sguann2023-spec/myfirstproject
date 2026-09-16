import React from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Input, Popover } from 'antd';
import ScreenRatioIcon from '../../../public/screen_ratio.svg';

const CUSTOM_PRESET_KEY = 'custom';
const DRAFT_DIMENSION_MIN = 64;
const DRAFT_DIMENSION_MAX = 7680;
const PRESET_OPTIONS = [
  { key: '16:9', label: '16:9', value: '1080x1920' },
  { key: '4:3', label: '4:3', value: '1080x1440' },
  { key: '2.35:1', label: '2.35:1', value: '680x1600' },
  { key: '2:1', label: '2:1', value: '540x1080' },
  { key: '1.85:1', label: '1.85:1', value: '800x1480' },
  { key: '9:16', label: '9:16', value: '1920x1080' },
  { key: '3:4', label: '3:4', value: '1440x1080' },
  { key: '5.8寸', label: '5.8寸', value: '1080x2340' },
  { key: '1:1', label: '1:1', value: '1080x1080' },
  { key: CUSTOM_PRESET_KEY, label: '自定义', value: '' },
];

const PRESET_SIZE_MAP = PRESET_OPTIONS.reduce((acc, item) => {
  if (item.value) {
    acc[item.key] = item.value;
  }
  return acc;
}, {});

const RATIO_ICON_SIZE_MAP = {
  '1:1': { width: 16, height: 16 },
  '16:9': { width: 10, height: 18 },
  '4:3': { width: 12, height: 16 },
  '2.35:1': { width: 8, height: 18 },
  '2:1': { width: 10, height: 18 },
  '1.85:1': { width: 10, height: 18 },
  '9:16': { width: 18, height: 10 },
  '3:4': { width: 16, height: 12 },
  '5.8寸': { width: 8, height: 18 },
  custom: { width: 14, height: 14 },
};

const normalizeDimension = (value) => {
  const sanitizedValue = String(value || '').replace(/[^\d]/g, '');
  if (!sanitizedValue) return '';
  const numericValue = Number(sanitizedValue);
  if (!Number.isFinite(numericValue)) return '';
  return String(Math.min(DRAFT_DIMENSION_MAX, Math.max(DRAFT_DIMENSION_MIN, Math.round(numericValue))));
};

const parseResolution = (value) => {
  const [width = '', height = ''] = String(value || '').trim().toLowerCase().split('x');
  return {
    width: normalizeDimension(width),
    height: normalizeDimension(height),
  };
};

const getPresetKeyFromResolution = (value) => {
  const normalizedValue = String(value || '').trim().toLowerCase();
  const matchedPreset = PRESET_OPTIONS.find((item) => (
    item.value && String(item.value).trim().toLowerCase() === normalizedValue
  ));
  return matchedPreset?.key || CUSTOM_PRESET_KEY;
};

const getRatioIconSize = (ratio) => RATIO_ICON_SIZE_MAP[ratio] || RATIO_ICON_SIZE_MAP['1:1'];

const RatioIcon = ({ ratio, active = false }) => {
  const { width, height } = getRatioIconSize(ratio);
  return (
    <span className="chat-panel__draft-resolution-ratio-icon-wrap" aria-hidden="true">
      <span
        className={`chat-panel__draft-resolution-ratio-icon ${active ? 'chat-panel__draft-resolution-ratio-icon--active' : ''}`}
        style={{ width: `${width}px`, height: `${height}px` }}
      />
    </span>
  );
};

const ChainIcon = () => (
  <svg
    className="chat-panel__draft-resolution-chain-icon"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M6.5 7a5 5 0 0 0 0 10h3a1 1 0 1 0 0-2h-3a3 3 0 0 1 0-6h3a1 1 0 0 0 0-2h-3Zm11 0a5 5 0 0 1 0 10h-3a1 1 0 1 1 0-2h3a3 3 0 0 0 0-6h-3a1 1 0 1 1 0-2h3ZM14 13a1 1 0 1 0 0-2h-4a1 1 0 1 0 0 2h4Z"
      fill="currentColor"
    />
  </svg>
);

const DraftResolutionSelect = ({
  value = '1920x1080',
  onChange = null,
  disabled = false,
}) => {
  const [open, setOpen] = React.useState(false);

  const matchedPresetKey = React.useMemo(() => getPresetKeyFromResolution(value), [value]);
  const parsedValue = React.useMemo(() => parseResolution(value), [value]);
  const [draftWidth, setDraftWidth] = React.useState(parsedValue.width);
  const [draftHeight, setDraftHeight] = React.useState(parsedValue.height);
  const [selectedPresetKey, setSelectedPresetKey] = React.useState(matchedPresetKey);

  React.useEffect(() => {
    setDraftWidth(parsedValue.width);
    setDraftHeight(parsedValue.height);
    setSelectedPresetKey(matchedPresetKey);
  }, [matchedPresetKey, parsedValue.height, parsedValue.width]);

  const emitResolution = React.useCallback((width, height) => {
    const normalizedWidth = normalizeDimension(width);
    const normalizedHeight = normalizeDimension(height);
    if (normalizedWidth === '' || normalizedHeight === '' || !onChange) return;
    onChange(`${normalizedWidth}x${normalizedHeight}`);
  }, [onChange]);

  const handleSelectRatio = React.useCallback((presetKey) => {
    setSelectedPresetKey(presetKey);
    if (presetKey === CUSTOM_PRESET_KEY) return;
    const nextResolution = PRESET_SIZE_MAP[presetKey];
    if (!nextResolution) return;
    const { width, height } = parseResolution(nextResolution);
    setDraftWidth(width);
    setDraftHeight(height);
    emitResolution(width, height);
  }, [emitResolution]);

  const handleWidthChange = React.useCallback((event) => {
    const nextWidth = normalizeDimension(event?.target?.value);
    setSelectedPresetKey(CUSTOM_PRESET_KEY);
    setDraftWidth(nextWidth);
    if (nextWidth !== '' && draftHeight !== '') {
      emitResolution(nextWidth, draftHeight);
    }
  }, [draftHeight, emitResolution]);

  const handleHeightChange = React.useCallback((event) => {
    const nextHeight = normalizeDimension(event?.target?.value);
    setSelectedPresetKey(CUSTOM_PRESET_KEY);
    setDraftHeight(nextHeight);
    if (draftWidth !== '' && nextHeight !== '') {
      emitResolution(draftWidth, nextHeight);
    }
  }, [draftWidth, emitResolution]);

  const panel = (
    <div className="chat-panel__draft-resolution-panel">
      <div className="chat-panel__draft-resolution-section">
        <div className="chat-panel__draft-resolution-title">选择比例</div>
        <div className="chat-panel__draft-resolution-group">
          {PRESET_OPTIONS.map((preset) => {
            const active = preset.key === selectedPresetKey;
            return (
              <button
                key={preset.key}
                type="button"
                className={`chat-panel__draft-resolution-ratio-button ${active ? 'is-active' : ''}`}
                onClick={() => handleSelectRatio(preset.key)}
              >
                <RatioIcon ratio={preset.key} active={active} />
                <span className="chat-panel__draft-resolution-ratio-text">{preset.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="chat-panel__draft-resolution-section">
        <div className="chat-panel__draft-resolution-title">尺寸</div>
        <div className="chat-panel__draft-resolution-dims">
          <div className="chat-panel__draft-resolution-input-box">
            <span className="chat-panel__draft-resolution-input-label">W</span>
            <Input
              value={draftWidth}
              onChange={handleWidthChange}
              variant="borderless"
              className="chat-panel__draft-resolution-input"
              inputMode="numeric"
              placeholder="宽"
            />
          </div>
          <span className="chat-panel__draft-resolution-dims-chain">
            <ChainIcon />
          </span>
          <div className="chat-panel__draft-resolution-input-box">
            <span className="chat-panel__draft-resolution-input-label">H</span>
            <Input
              value={draftHeight}
              onChange={handleHeightChange}
              variant="borderless"
              className="chat-panel__draft-resolution-input"
              inputMode="numeric"
              placeholder="高"
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="topLeft"
      open={disabled ? false : open}
      onOpenChange={setOpen}
      content={panel}
      classNames={{ root: 'chat-panel__draft-resolution-popover' }}
    >
      <button
        type="button"
        className={`chat-panel__draft-resolution-trigger ${open ? 'is-open' : ''}`}
        disabled={disabled}
      >
        <img
          className="chat-panel__draft-resolution-trigger-icon"
          src={ScreenRatioIcon}
          alt=""
          aria-hidden="true"
        />
        <span className="chat-panel__draft-resolution-trigger-text">
          {selectedPresetKey !== CUSTOM_PRESET_KEY ? (
            <span>{selectedPresetKey}</span>
          ) : (
            <>
              <span>{draftWidth === '' ? '-' : draftWidth}</span>
              <span>x</span>
              <span>{draftHeight === '' ? '-' : draftHeight}</span>
            </>
          )}
        </span>
        <DownOutlined className={`chat-panel__draft-resolution-trigger-arrow ${open ? 'is-open' : ''}`} aria-hidden="true" />
      </button>
    </Popover>
  );
};

export default DraftResolutionSelect;
