import React from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Popover } from 'antd';
import ImageTemplateIcon from '../../../../../public/image_template.svg';
import ScreenRatioIcon from '../../../../../public/screen_ratio.svg';
import ImageTemplatePopover from '../ImageTemplatePopover/index';
import './index.css';

const RATIO_ORDER = ['9:16', '2:3', '3:4', '1:1', '4:3', '3:2', '16:9', '21:9'];
const TIER_ORDER = ['1K', '2K', '4K'];

const TIER_LABEL_MAP = {
  '1K': '标清1K',
  '2K': '高清2K',
  '4K': '超清4K',
};

const RATIO_ICON_SIZE_MAP = {
  '1:1': { width: 16, height: 16 },
  '21:9': { width: 18, height: 8 },
  '16:9': { width: 18, height: 10 },
  '3:2': { width: 18, height: 12 },
  '4:3': { width: 16, height: 12 },
  '3:4': { width: 12, height: 16 },
  '2:3': { width: 12, height: 18 },
  '9:16': { width: 10, height: 18 },
};

const displayTierLabel = (tier) => TIER_LABEL_MAP[tier] || tier;

const getRatioIconSize = (ratio) => RATIO_ICON_SIZE_MAP[ratio] || RATIO_ICON_SIZE_MAP['1:1'];

const findSizeInfo = (capabilities, model, size) => {
  const resByTier = capabilities?.[model]?.resolutions || {};
  for (const tier of Object.keys(resByTier)) {
    for (const item of resByTier[tier] || []) {
      if (item?.size === size) {
        return { ratio: item?.ratio || '1:1', tier };
      }
    }
  }
  return null;
};

const getAvailableRatios = (capabilities, model) => {
  const resByTier = capabilities?.[model]?.resolutions || {};
  const ratioSet = new Set();
  Object.values(resByTier).forEach((items) => {
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (item?.ratio) ratioSet.add(item.ratio);
    });
  });
  return RATIO_ORDER.filter((ratio) => ratioSet.has(ratio));
};

const getAvailableTiersForRatio = (capabilities, model, ratio) => {
  const resByTier = capabilities?.[model]?.resolutions || {};
  return TIER_ORDER.filter((tier) => (resByTier[tier] || []).some((item) => item?.ratio === ratio));
};

const pickSize = (capabilities, model, ratio, tier) => {
  const resByTier = capabilities?.[model]?.resolutions || {};
  const item = (resByTier[tier] || []).find((entry) => entry?.ratio === ratio);
  return item?.size || null;
};

const RatioIcon = ({ ratio, active = false }) => {
  const { width, height } = getRatioIconSize(ratio);
  return (
    <span className="chat-panel__image-resolution-ratio-icon-wrap" aria-hidden="true">
      <span
        className={`chat-panel__image-resolution-ratio-icon ${active ? 'chat-panel__image-resolution-ratio-icon--active' : ''}`}
        style={{ width: `${width}px`, height: `${height}px` }}
      />
    </span>
  );
};

const ChainIcon = () => (
  <svg
    className="chat-panel__image-resolution-chain-icon"
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

const ImageResolutionSelect = ({
  model,
  capabilities,
  value,
  onChange = null,
  onTemplateApply = null,
  disabled = false,
}) => {
  const [open, setOpen] = React.useState(false);
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const ratios = React.useMemo(() => getAvailableRatios(capabilities, model), [capabilities, model]);

  const initial = React.useMemo(() => {
    const info = findSizeInfo(capabilities, model, value);
    if (info && ratios.includes(info.ratio)) return info;
    const fallbackRatio = ratios[0] || '1:1';
    const tiers = getAvailableTiersForRatio(capabilities, model, fallbackRatio);
    const fallbackTier = tiers[0] || TIER_ORDER[0];
    return { ratio: fallbackRatio, tier: fallbackTier };
  }, [capabilities, model, value, ratios]);

  const [ratio, setRatio] = React.useState(initial.ratio);
  const [tier, setTier] = React.useState(initial.tier);

  React.useEffect(() => {
    const info = findSizeInfo(capabilities, model, value);
    if (info) {
      setRatio(info.ratio);
      setTier(info.tier);
      return;
    }

    setRatio(initial.ratio);
    setTier(initial.tier);
    const nextSize = pickSize(capabilities, model, initial.ratio, initial.tier);
    if (nextSize && onChange) {
      onChange(nextSize);
    }
  }, [capabilities, initial.ratio, initial.tier, model, onChange, value]);

  const tiersForRatio = React.useMemo(
    () => getAvailableTiersForRatio(capabilities, model, ratio),
    [capabilities, model, ratio]
  );

  const selectedSize = React.useMemo(
    () => pickSize(capabilities, model, ratio, tier),
    [capabilities, model, ratio, tier]
  );

  const [width = '-', height = '-'] = String(selectedSize || '').split('x');
  const handleSelectRatio = (nextRatio) => {
    const nextTiers = getAvailableTiersForRatio(capabilities, model, nextRatio);
    const nextTier = nextTiers.includes(tier) ? tier : nextTiers[0];
    const nextSize = pickSize(capabilities, model, nextRatio, nextTier);
    if (!nextTier || !nextSize) return;
    setRatio(nextRatio);
    setTier(nextTier);
    if (onChange) onChange(nextSize);
  };

  const handleSelectTier = (nextTier) => {
    const nextSize = pickSize(capabilities, model, ratio, nextTier);
    if (!nextSize) return;
    setTier(nextTier);
    if (onChange) onChange(nextSize);
  };

  const handleApplyTemplate = React.useCallback((template) => {
    setTemplateOpen(false);
    if (onTemplateApply) {
      onTemplateApply(template);
    }
  }, [onTemplateApply]);

  const panel = (
    <div className="chat-panel__image-resolution-panel">
      <div className="chat-panel__image-resolution-section">
        <div className="chat-panel__image-resolution-title">选择比例</div>
        <div className="chat-panel__image-resolution-group">
          {ratios.map((item) => {
            const active = item === ratio;
            return (
              <button
                key={item}
                type="button"
                className={`chat-panel__image-resolution-ratio-button ${active ? 'is-active' : ''}`}
                onClick={() => handleSelectRatio(item)}
              >
                <RatioIcon ratio={item} active={active} />
                <span className="chat-panel__image-resolution-ratio-text">{item}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="chat-panel__image-resolution-section">
        <div className="chat-panel__image-resolution-title">选择分辨率</div>
          <div
            className="chat-panel__image-resolution-tier-group"
            style={{ gridTemplateColumns: `repeat(${Math.max(tiersForRatio.length, 1)}, minmax(0, 1fr))` }}
          >
            {tiersForRatio.map((item) => {
              const active = item === tier;
              return (
                <button
                  key={item}
                  type="button"
                  className={`chat-panel__image-resolution-tier-button ${active ? 'is-active' : ''}`}
                  onClick={() => handleSelectTier(item)}
                >
                  {displayTierLabel(item)}
                </button>
              );
            })}
          </div>
      </div>

      <div className="chat-panel__image-resolution-section">
        <div className="chat-panel__image-resolution-title">尺寸</div>
        <div className="chat-panel__image-resolution-dims">
          <div className="chat-panel__image-resolution-dims-box">
            <span className="chat-panel__image-resolution-dims-label">W</span>
            <span className="chat-panel__image-resolution-dims-value">{width}</span>
          </div>
          <span className="chat-panel__image-resolution-dims-chain">
            <ChainIcon />
          </span>
          <div className="chat-panel__image-resolution-dims-box">
            <span className="chat-panel__image-resolution-dims-label">H</span>
            <span className="chat-panel__image-resolution-dims-value">{height}</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="chat-panel__image-resolution-actions">
      <Popover
        trigger="click"
        placement="topLeft"
        open={disabled ? false : open}
        onOpenChange={setOpen}
        content={panel}
        overlayClassName="chat-panel__image-resolution-popover"
      >
        <button
          type="button"
          className={`chat-panel__image-resolution-trigger ${open ? 'is-open' : ''}`}
          disabled={disabled}
        >
          <img
            className="chat-panel__image-resolution-trigger-icon"
            src={ScreenRatioIcon}
            alt=""
            aria-hidden="true"
          />
          <span className="chat-panel__image-resolution-trigger-text">
            <span>{ratio}</span>
            <span className="chat-panel__image-resolution-trigger-divider" aria-hidden="true" />
            <span>{displayTierLabel(tier)}</span>
          </span>
          <DownOutlined className={`chat-panel__image-resolution-trigger-arrow ${open ? 'is-open' : ''}`} aria-hidden="true" />
        </button>
      </Popover>
      <Popover
        trigger="click"
        placement="topLeft"
        open={disabled ? false : templateOpen}
        onOpenChange={setTemplateOpen}
        content={<ImageTemplatePopover onApplyTemplate={handleApplyTemplate} />}
        align={{ offset: [-420, -12] }}
        overlayClassName="chat-panel__image-template-popover"
      >
        <button
          type="button"
          className={`chat-panel__image-template-trigger ${templateOpen ? 'is-open' : ''}`}
          disabled={disabled}
        >
          <img
            className="chat-panel__image-template-trigger-icon"
            src={ImageTemplateIcon}
            alt=""
            aria-hidden="true"
          />
          <span className="chat-panel__image-template-trigger-text">模版</span>
        </button>
      </Popover>
    </div>
  );
};

export default ImageResolutionSelect;
