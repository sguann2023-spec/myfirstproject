import React from 'react';
import { DownOutlined, InfoCircleOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Popover, Tooltip } from 'antd';
import ChatModelsTipIcon from '../../../../../public/chat_models_tip.svg';
import Point2Icon from '../../../../../public/point2.svg';
import ScreenRatioIcon from '../../../../../public/screen_ratio.svg';
import './index.css';

const RATIO_ORDER = ['9:16', '2:3', '3:4', '1:1', '4:3', '3:2', '16:9', '21:9'];
const TIER_ORDER = ['480p', '720p', '1080p'];

const TIER_LABEL_MAP = {
  '480p': '480P',
  '720p': '720P',
  '1080p': '1080P',
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

const displayTierLabel = (tier) => TIER_LABEL_MAP[tier] || String(tier || '').toUpperCase();

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

const SUPPORT_OPTION_LABELS = {
  audioOn: '开启',
  audioOff: '关闭',
  offlineOn: '开启',
  offlineOff: '关闭',
  superResolveOn: '开启',
  superResolveOff: '关闭',
};
const TRIGGER_STATUS_LABELS = {
  audioOn: '有声',
  audioOff: '无声',
  offlineOn: '闲时',
  superResolveOn: '超分',
};

const getModelCapability = (capabilities, model) => capabilities?.[model] || {};
const normalizeGenerationModeValue = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || 'text_to_video';
};

const normalizeDurationValue = (value) => {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
};

const normalizePriceNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const findTierPriceEntry = (tierPrices, tier) => {
  const normalizedTier = String(tier || '').trim().toLowerCase();
  if (!normalizedTier || !tierPrices || typeof tierPrices !== 'object') return null;

  const matchedKey = Object.keys(tierPrices).find((key) => String(key || '').trim().toLowerCase() === normalizedTier);
  return matchedKey ? tierPrices[matchedKey] : null;
};

const findGenerationModeConfig = (generationModes, generationMode) => {
  const normalizedGenerationMode = normalizeGenerationModeValue(generationMode);
  return (Array.isArray(generationModes) ? generationModes : []).find(
    (item) => String(item?.value || '').trim() === normalizedGenerationMode
  ) || null;
};

const findPriceEntryByGroup = (priceMap, groupName, tier) => {
  const normalizedGroupName = String(groupName || '').trim().toLowerCase();
  if (!normalizedGroupName || !priceMap || typeof priceMap !== 'object') return null;

  const matchedKey = Object.keys(priceMap).find((key) => String(key || '').trim().toLowerCase() === normalizedGroupName);
  if (!matchedKey) return null;
  return findTierPriceEntry(priceMap[matchedKey], tier);
};

const getPriceGroupFlags = (groupName) => {
  const normalized = String(groupName || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return {
    offline: normalized.includes('offline'),
    audioOn: normalized === 'audio' || normalized.includes('with_audio') || normalized.includes('generate_audio') || /(^|_)audio($|_)/.test(normalized),
    audioOff: normalized.includes('without_audio') || normalized.includes('no_audio') || normalized.includes('mute') || normalized.includes('silent'),
    superResolve: normalized.includes('super_resolve') || normalized.includes('superresolve') || normalized.includes('super_resolution'),
    firstFrameExtend: normalized.includes('first_frame_extend') || normalized.includes('firstframeextend'),
    referenceVideo: normalized.includes('reference_video') || normalized.includes('referencevideo'),
    standard: normalized === 'standard' || normalized === 'default' || normalized === 'base',
  };
};

const pickVideoPriceEntry = (
  priceMap,
  tier,
  {
    generationMode = 'text_to_video',
    generationModeConfig = null,
    generateAudioSupported = false,
    generateAudio = true,
    seedanceOffline = false,
    superResolveSupported = false,
    superResolve = false,
  } = {}
) => {
  if (!priceMap || typeof priceMap !== 'object') return null;
  const preferredGroupName = seedanceOffline
    ? String(generationModeConfig?.offline_price_group || '').trim()
    : String(generationModeConfig?.price_group || '').trim();
  const preferredEntry = findPriceEntryByGroup(priceMap, preferredGroupName, tier);
  if (preferredEntry) {
    return preferredEntry;
  }

  const normalizedGenerationMode = normalizeGenerationModeValue(generationMode);

  const candidates = Object.entries(priceMap)
    .map(([groupName, tierPrices]) => ({
      groupName,
      tierPrices,
      flags: getPriceGroupFlags(groupName),
    }))
    .filter(({ tierPrices, flags }) => tierPrices && typeof tierPrices === 'object' && !flags.firstFrameExtend && !flags.referenceVideo)
    .map((item) => {
      const entry = findTierPriceEntry(item.tierPrices, tier);
      if (!entry) return null;

      const { flags } = item;
      if (!seedanceOffline && flags.offline) return null;
      if (!generateAudioSupported && (flags.audioOn || flags.audioOff)) return null;
      if (!superResolveSupported && flags.superResolve) return null;
      if (generateAudioSupported) {
        if (generateAudio && flags.audioOff) return null;
        if (!generateAudio && flags.audioOn) return null;
      }
      if (superResolveSupported && !superResolve && flags.superResolve) return null;

      let score = 0;
      if (flags.standard) score += 1;
      if (seedanceOffline && flags.offline) score += 4;
      if (generateAudioSupported && generateAudio && flags.audioOn) score += 3;
      if (generateAudioSupported && !generateAudio && flags.audioOff) score += 3;
      if (superResolveSupported && superResolve && flags.superResolve) score += 3;
      if (normalizedGenerationMode === 'first_frame' && flags.firstFrameExtend) score += 5;
      if (normalizedGenerationMode === 'reference' && flags.referenceVideo) score += 5;
      if (normalizedGenerationMode === 'text_to_video' && flags.standard) score += 2;
      if (normalizedGenerationMode === 'first_last_frame' && flags.firstFrameExtend) score += 2;

      return {
        entry,
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.entry || null;
};

const formatTotalPriceText = (pricePerUnit, duration) => {
  const normalizedPrice = normalizePriceNumber(pricePerUnit);
  const normalizedDuration = normalizeDurationValue(duration);
  if (normalizedPrice === null || normalizedDuration === null) return '--积分';

  const totalPrice = normalizedPrice * normalizedDuration;
  const formattedTotal = Number.isInteger(totalPrice)
    ? String(totalPrice)
    : String(Number(totalPrice.toFixed(1)));
  return `${formattedTotal}积分`;
};

const RatioIcon = ({ ratio, active = false }) => {
  const { width, height } = getRatioIconSize(ratio);
  return (
    <span className="chat-panel__video-resolution-ratio-icon-wrap" aria-hidden="true">
      <span
        className={`chat-panel__video-resolution-ratio-icon ${active ? 'chat-panel__video-resolution-ratio-icon--active' : ''}`}
        style={{ width: `${width}px`, height: `${height}px` }}
      />
    </span>
  );
};

const VideoResolutionSelect = ({
  model,
  capabilities,
  generationMode = 'text_to_video',
  value,
  duration = 5,
  generateAudio = true,
  seedanceOffline = false,
  superResolve = false,
  onChange = null,
  onDurationChange = null,
  onGenerateAudioChange = null,
  onSeedanceOfflineChange = null,
  onSuperResolveChange = null,
  disabled = false,
}) => {
  const [open, setOpen] = React.useState(false);
  const durationTrackRef = React.useRef(null);
  const [canScrollDurationLeft, setCanScrollDurationLeft] = React.useState(false);
  const [canScrollDurationRight, setCanScrollDurationRight] = React.useState(false);
  const modelCapability = React.useMemo(() => getModelCapability(capabilities, model), [capabilities, model]);
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

  const generateAudioSupported = Boolean(modelCapability?.generate_audio_supported);
  const seedanceOfflineSupported = Boolean(modelCapability?.seedance_offline_supported);
  const superResolveSupported = Boolean(modelCapability?.super_resolve_supported);
  const generationModeConfig = React.useMemo(
    () => findGenerationModeConfig(modelCapability?.generation_modes, generationMode),
    [generationMode, modelCapability]
  );
  const durationOptions = React.useMemo(() => {
    const rawDurations = Array.isArray(modelCapability?.gen_durations) ? modelCapability.gen_durations : [];
    const normalizedDurations = rawDurations
      .map((item) => normalizeDurationValue(item))
      .filter((item) => item !== null);
    return normalizedDurations.length > 0 ? normalizedDurations : [4, 5, 6, 7, 8];
  }, [modelCapability]);
  const resolvedDuration = durationOptions.includes(normalizeDurationValue(duration))
    ? normalizeDurationValue(duration)
    : durationOptions[0];
  const triggerPriceText = React.useMemo(() => {
    const priceEntry = pickVideoPriceEntry(modelCapability?.price, tier, {
      generationMode,
      generationModeConfig,
      generateAudioSupported,
      generateAudio,
      seedanceOffline,
      superResolveSupported,
      superResolve,
    });
    return formatTotalPriceText(priceEntry?.resource_points_per_unit, resolvedDuration);
  }, [
    generateAudio,
    generateAudioSupported,
    generationMode,
    generationModeConfig,
    modelCapability,
    resolvedDuration,
    seedanceOffline,
    superResolve,
    superResolveSupported,
    tier,
  ]);

  React.useEffect(() => {
    if (resolvedDuration === null) return;
    if (resolvedDuration !== normalizeDurationValue(duration) && onDurationChange) {
      onDurationChange(resolvedDuration);
    }
  }, [duration, onDurationChange, resolvedDuration]);

  const updateDurationScrollState = React.useCallback(() => {
    const element = durationTrackRef.current;
    if (!element) {
      setCanScrollDurationLeft(false);
      setCanScrollDurationRight(false);
      return;
    }

    setCanScrollDurationLeft(element.scrollLeft > 4);
    const remainingScroll = element.scrollWidth - element.clientWidth - element.scrollLeft;
    setCanScrollDurationRight(remainingScroll > 4);
  }, []);

  React.useEffect(() => {
    if (!open) return undefined;

    updateDurationScrollState();
    const handleResize = () => updateDurationScrollState();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [durationOptions, open, updateDurationScrollState]);

  const handleDurationArrowBackClick = () => {
    const element = durationTrackRef.current;
    if (!element) return;
    element.scrollBy({ left: -160, behavior: 'smooth' });
  };

  const handleDurationArrowClick = () => {
    const element = durationTrackRef.current;
    if (!element) return;
    element.scrollBy({ left: 160, behavior: 'smooth' });
  };

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

  const panel = (
    <div className="chat-panel__video-resolution-panel">
      <div className="chat-panel__video-resolution-section">
        <div className="chat-panel__video-resolution-title">选择比例</div>
        <div className="chat-panel__video-resolution-group">
          <div
            className="chat-panel__video-resolution-group-inner"
            style={{ gridTemplateColumns: `repeat(${Math.max(ratios.length, 1)}, minmax(0, 1fr))` }}
          >
            {ratios.map((item) => {
              const active = item === ratio;
              return (
                <button
                  key={item}
                  type="button"
                  disabled={disabled}
                  className={`chat-panel__video-resolution-ratio-button ${active ? 'is-active' : ''}`}
                  onClick={() => handleSelectRatio(item)}
                >
                  <RatioIcon ratio={item} active={active} />
                  <span className="chat-panel__video-resolution-ratio-text">{item}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="chat-panel__video-resolution-section">
        <div className="chat-panel__video-resolution-title">视频时长</div>
        <div className="chat-panel__video-resolution-duration-group">
          <button
            type="button"
            className="chat-panel__video-resolution-duration-arrow"
            onClick={handleDurationArrowBackClick}
            aria-label="查看前面的时长"
            disabled={disabled || !canScrollDurationLeft}
          >
            <LeftOutlined />
          </button>
          <div
            ref={durationTrackRef}
            className="chat-panel__video-resolution-duration-track"
            onScroll={updateDurationScrollState}
          >
            {durationOptions.map((item) => {
              const active = item === resolvedDuration;
              return (
                <button
                  key={item}
                  type="button"
                  disabled={disabled}
                  className={`chat-panel__video-resolution-duration-button ${active ? 'is-active' : ''}`}
                  onClick={() => onDurationChange && onDurationChange(item)}
                >
                  {item}s
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="chat-panel__video-resolution-duration-arrow"
            onClick={handleDurationArrowClick}
            aria-label="查看更多时长"
            disabled={disabled || !canScrollDurationRight}
          >
            <RightOutlined />
          </button>
        </div>
      </div>

      <div className="chat-panel__video-resolution-section">
        <div className="chat-panel__video-resolution-title">选择分辨率</div>
        <div
          className="chat-panel__video-resolution-tier-group"
          style={{ gridTemplateColumns: `repeat(${Math.max(tiersForRatio.length, 1)}, minmax(0, 1fr))` }}
        >
          {tiersForRatio.map((item) => {
            const active = item === tier;
            return (
              <button
                key={item}
                type="button"
                disabled={disabled}
                className={`chat-panel__video-resolution-tier-button ${active ? 'is-active' : ''}`}
                onClick={() => handleSelectTier(item)}
              >
                <span className="chat-panel__video-resolution-tier-label">{displayTierLabel(item)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {generateAudioSupported ? (
        <div className="chat-panel__video-resolution-section">
          <div className="chat-panel__video-resolution-title">输出声音</div>
          <div className="chat-panel__video-resolution-toggle-group">
            <button
              type="button"
              disabled={disabled}
              className={`chat-panel__video-resolution-toggle-button ${generateAudio ? 'is-active' : ''}`}
              onClick={() => onGenerateAudioChange && onGenerateAudioChange(true)}
            >
              {SUPPORT_OPTION_LABELS.audioOn}
            </button>
            <button
              type="button"
              disabled={disabled}
              className={`chat-panel__video-resolution-toggle-button ${!generateAudio ? 'is-active' : ''}`}
              onClick={() => onGenerateAudioChange && onGenerateAudioChange(false)}
            >
              {SUPPORT_OPTION_LABELS.audioOff}
            </button>
          </div>
        </div>
      ) : null}

      {seedanceOfflineSupported ? (
        <div className="chat-panel__video-resolution-section">
          <div className="chat-panel__video-resolution-title chat-panel__video-resolution-title-with-tip">
            <span>闲时生成</span>
            <Tooltip title="利用空闲时间生成，排队更久价格更低">
              <InfoCircleOutlined className="chat-panel__video-resolution-title-tip-icon" />
            </Tooltip>
          </div>
          <div className="chat-panel__video-resolution-toggle-group">
            <button
              type="button"
              disabled={disabled}
              className={`chat-panel__video-resolution-toggle-button ${!seedanceOffline ? 'is-active' : ''}`}
              onClick={() => onSeedanceOfflineChange && onSeedanceOfflineChange(false)}
            >
              {SUPPORT_OPTION_LABELS.offlineOff}
            </button>
            <button
              type="button"
              disabled={disabled}
              className={`chat-panel__video-resolution-toggle-button ${seedanceOffline ? 'is-active' : ''}`}
              onClick={() => onSeedanceOfflineChange && onSeedanceOfflineChange(true)}
            >
              {SUPPORT_OPTION_LABELS.offlineOn}
            </button>
          </div>
        </div>
      ) : null}

      {superResolveSupported ? (
        <div className="chat-panel__video-resolution-section">
          <div className="chat-panel__video-resolution-title chat-panel__video-resolution-title-with-tip">
            <span>开启超分</span>
            <Tooltip title="把生成视频分辨率超分到原来的2倍">
              <img className="chat-panel__video-resolution-title-tip-icon" src={ChatModelsTipIcon} alt="" aria-hidden="true" />
            </Tooltip>
          </div>
          <div className="chat-panel__video-resolution-toggle-group">
            <button
              type="button"
              disabled={disabled}
              className={`chat-panel__video-resolution-toggle-button ${!superResolve ? 'is-active' : ''}`}
              onClick={() => onSuperResolveChange && onSuperResolveChange(false)}
            >
              {SUPPORT_OPTION_LABELS.superResolveOff}
            </button>
            <button
              type="button"
              disabled={disabled}
              className={`chat-panel__video-resolution-toggle-button ${superResolve ? 'is-active' : ''}`}
              onClick={() => onSuperResolveChange && onSuperResolveChange(true)}
            >
              {SUPPORT_OPTION_LABELS.superResolveOn}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="chat-panel__video-resolution-actions">
      <Popover
        trigger="click"
        placement="topLeft"
        open={disabled ? false : open}
        onOpenChange={setOpen}
        content={panel}
        overlayClassName="chat-panel__video-resolution-popover"
      >
        <button
          type="button"
          className={`chat-panel__video-resolution-trigger ${open ? 'is-open' : ''}`}
          disabled={disabled}
        >
          <img
            className="chat-panel__video-resolution-trigger-icon"
            src={ScreenRatioIcon}
            alt=""
            aria-hidden="true"
          />
          <span className="chat-panel__video-resolution-trigger-text">
            <span>{ratio}</span>
            <span className="chat-panel__video-resolution-trigger-divider" aria-hidden="true" />
            <span>{displayTierLabel(tier)}</span>
            <span className="chat-panel__video-resolution-trigger-divider" aria-hidden="true" />
            <span>{resolvedDuration}s</span>
            {generateAudioSupported ? (
              <>
                <span className="chat-panel__video-resolution-trigger-divider" aria-hidden="true" />
                <span>{generateAudio ? TRIGGER_STATUS_LABELS.audioOn : TRIGGER_STATUS_LABELS.audioOff}</span>
              </>
            ) : null}
            {seedanceOfflineSupported && seedanceOffline ? (
              <>
                <span className="chat-panel__video-resolution-trigger-divider" aria-hidden="true" />
                <span>{TRIGGER_STATUS_LABELS.offlineOn}</span>
              </>
            ) : null}
            {superResolveSupported && superResolve ? (
              <>
                <span className="chat-panel__video-resolution-trigger-divider" aria-hidden="true" />
                <span>{TRIGGER_STATUS_LABELS.superResolveOn}</span>
              </>
            ) : null}
          </span>
          <DownOutlined className={`chat-panel__video-resolution-trigger-arrow ${open ? 'is-open' : ''}`} aria-hidden="true" />
        </button>
      </Popover>
      <span className="chat-panel__video-resolution-price">
        <img className="chat-panel__video-resolution-price-icon" src={Point2Icon} alt="" aria-hidden="true" />
        <span className="chat-panel__video-resolution-price-text">{triggerPriceText}</span>
      </span>
    </div>
  );
};

export default VideoResolutionSelect;
