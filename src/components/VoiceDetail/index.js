import React from 'react';
import { Copy } from 'lucide-react';
import { message } from 'antd';
import { getTtsSpeechPrice } from '../../api/tts';
import './index.css';
import Point2Icon from '../../../public/point2.svg';
import VoiceCollectIcon from '../../../public/voice_collect.svg';
import VoiceCollectedIcon from '../../../public/voice_collected.svg';

const DEFAULT_PRICE_TEXT = '--/百字';
const voicePriceCache = new Map();
const voicePriceRequestCache = new Map();
const voicePriceBatchQueue = new Map();

const normalizeVoiceProvider = (provider) =>
  String(provider || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)[0] || '';

const buildVoicePriceCacheKey = ({ provider = '', voiceId = '', model = '' } = {}) =>
  [provider, voiceId, model].join('|');

const buildVoicePriceBatchKey = ({ provider = '', model = '' } = {}) =>
  [provider, model].join('|');

const getVoicePriceResponseItems = (result) => {
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  if (Array.isArray(result?.prices)) return result.prices;
  if (Array.isArray(result?.data?.prices)) return result.data.prices;
  if (Array.isArray(result?.data)) return result.data;
  return [];
};

const buildVoicePriceTextMap = (result, voiceIds = []) => {
  const normalizedVoiceIds = Array.isArray(voiceIds)
    ? voiceIds.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const priceTextMap = new Map();
  const responseItems = getVoicePriceResponseItems(result);

  responseItems.forEach((item) => {
    const voiceId = String(item?.voice_id || item?.global_voice_id || item?.id || '').trim();
    if (!voiceId) return;
    const nextText = String(item?.price_text || item?.price || '').trim();
    if (nextText) {
      priceTextMap.set(voiceId, nextText);
    }
  });

  const responsePriceMap = result?.price_map || result?.data?.price_map || result?.prices_map || result?.data?.prices_map;
  if (responsePriceMap && typeof responsePriceMap === 'object') {
    Object.entries(responsePriceMap).forEach(([voiceId, value]) => {
      const normalizedVoiceId = String(voiceId || '').trim();
      const nextText = String(value?.price_text || value?.price || value || '').trim();
      if (normalizedVoiceId && nextText) {
        priceTextMap.set(normalizedVoiceId, nextText);
      }
    });
  }

  if (normalizedVoiceIds.length === 1 && !priceTextMap.has(normalizedVoiceIds[0])) {
    const nextText = String(result?.price_text || result?.data?.price_text || '').trim();
    if (nextText) {
      priceTextMap.set(normalizedVoiceIds[0], nextText);
    }
  }

  return priceTextMap;
};

const requestVoicePriceBatch = ({ provider = '', voiceId = '', model = '' } = {}) => {
  const normalizedVoiceId = String(voiceId || '').trim();
  if (!normalizedVoiceId) return Promise.resolve(DEFAULT_PRICE_TEXT);

  const requestKey = buildVoicePriceCacheKey({ provider, voiceId: normalizedVoiceId, model });
  if (voicePriceCache.has(requestKey)) {
    return Promise.resolve(voicePriceCache.get(requestKey) || DEFAULT_PRICE_TEXT);
  }
  if (voicePriceRequestCache.has(requestKey)) {
    return voicePriceRequestCache.get(requestKey);
  }

  const batchKey = buildVoicePriceBatchKey({ provider, model });
  let batch = voicePriceBatchQueue.get(batchKey);

  if (!batch) {
    batch = {
      provider,
      model,
      voiceIds: new Set(),
      resolvers: new Map(),
      timer: null,
    };
    voicePriceBatchQueue.set(batchKey, batch);
  }

  batch.voiceIds.add(normalizedVoiceId);

  const pendingRequest = new Promise((resolve) => {
    const resolvers = batch.resolvers.get(normalizedVoiceId) || [];
    resolvers.push(resolve);
    batch.resolvers.set(normalizedVoiceId, resolvers);
  });

  voicePriceRequestCache.set(requestKey, pendingRequest);

  if (!batch.timer) {
    batch.timer = window.setTimeout(async () => {
      const currentBatch = voicePriceBatchQueue.get(batchKey);
      if (!currentBatch) return;

      voicePriceBatchQueue.delete(batchKey);
      const voiceIds = Array.from(currentBatch.voiceIds);

      try {
        const result = await getTtsSpeechPrice({
          provider: currentBatch.provider || undefined,
          voice_id: voiceIds,
          model: currentBatch.provider === 'minimax' ? currentBatch.model || undefined : undefined,
        });
        const priceTextMap = buildVoicePriceTextMap(result, voiceIds);

        voiceIds.forEach((currentVoiceId) => {
          const currentRequestKey = buildVoicePriceCacheKey({
            provider: currentBatch.provider,
            voiceId: currentVoiceId,
            model: currentBatch.model,
          });
          const nextText = priceTextMap.get(currentVoiceId) || DEFAULT_PRICE_TEXT;
          voicePriceCache.set(currentRequestKey, nextText);
          voicePriceRequestCache.delete(currentRequestKey);
          (currentBatch.resolvers.get(currentVoiceId) || []).forEach((resolver) => resolver(nextText));
        });
      } catch (error) {
        voiceIds.forEach((currentVoiceId) => {
          const currentRequestKey = buildVoicePriceCacheKey({
            provider: currentBatch.provider,
            voiceId: currentVoiceId,
            model: currentBatch.model,
          });
          voicePriceRequestCache.delete(currentRequestKey);
          (currentBatch.resolvers.get(currentVoiceId) || []).forEach((resolver) => resolver(DEFAULT_PRICE_TEXT));
        });
      }
    }, 0);
  }

  return pendingRequest;
};

const VoiceDetail = ({
  title,
  description,
  provider,
  globalVoiceId,
  priceText = '',
  priceModel = '',
  favorited = false,
  favoriteDisabled = false,
  onToggleFavorite,
}) => {
  const favoriteTitle = favorited ? '取消收藏' : '收藏';
  const normalizedProvider = React.useMemo(() => normalizeVoiceProvider(provider), [provider]);
  const normalizedVoiceId = React.useMemo(() => String(globalVoiceId || '').trim(), [globalVoiceId]);
  const normalizedPriceModel = React.useMemo(() => String(priceModel || '').trim(), [priceModel]);
  const cacheKey = React.useMemo(
    () =>
      buildVoicePriceCacheKey({
        provider: normalizedProvider,
        voiceId: normalizedVoiceId,
        model: normalizedPriceModel,
      }),
    [normalizedPriceModel, normalizedProvider, normalizedVoiceId]
  );
  const initialPriceText = React.useMemo(() => {
    const nextText = String(priceText || '').trim();
    if (nextText) return nextText;
    if (cacheKey && voicePriceCache.has(cacheKey)) return voicePriceCache.get(cacheKey);
    return DEFAULT_PRICE_TEXT;
  }, [cacheKey, priceText]);
  const [unitPriceText, setUnitPriceText] = React.useState(initialPriceText);

  React.useEffect(() => {
    const nextText = String(priceText || '').trim();
    if (cacheKey && nextText) {
      voicePriceCache.set(cacheKey, nextText);
    }
  }, [cacheKey, priceText]);

  React.useEffect(() => {
    setUnitPriceText(initialPriceText);
  }, [initialPriceText]);

  React.useEffect(() => {
    if (String(priceText || '').trim()) return undefined;
    if (!normalizedProvider && !normalizedVoiceId) {
      setUnitPriceText(DEFAULT_PRICE_TEXT);
      return undefined;
    }
    if (cacheKey && voicePriceCache.has(cacheKey)) {
      setUnitPriceText(voicePriceCache.get(cacheKey) || DEFAULT_PRICE_TEXT);
      return undefined;
    }

    let cancelled = false;
    const fetchPrice = async () => {
      const requestKey = cacheKey;
      if (!requestKey) return;

      try {
        const pendingRequest = requestVoicePriceBatch({
          provider: normalizedProvider,
          voiceId: normalizedVoiceId,
          model: normalizedPriceModel,
        });
        const result = await pendingRequest;
        const nextText = String(result || '').trim() || DEFAULT_PRICE_TEXT;
        voicePriceCache.set(requestKey, nextText);
        if (!cancelled) setUnitPriceText(nextText);
      } catch (error) {
        if (!cancelled) setUnitPriceText(DEFAULT_PRICE_TEXT);
      }
    };

    fetchPrice();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, normalizedPriceModel, normalizedProvider, normalizedVoiceId, priceText]);

  const handleFavoriteMouseDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleFavoriteClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (favoriteDisabled || typeof onToggleFavorite !== 'function') return;
    onToggleFavorite();
  };

  const handleCopyVoiceId = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!normalizedVoiceId) return;
    try {
      await navigator.clipboard.writeText(normalizedVoiceId);
      message.success('音色ID已复制');
    } catch (error) {
      message.error('复制失败');
    }
  };

  return (
    <div className="voice-detail">
      <div className="voice-detail__main">
        <div className="voice-detail__title">{title}</div>
        {description ? <div className="voice-detail__description">{description}</div> : null}
      </div>
      {normalizedVoiceId ? (
        <button
          type="button"
          className="voice-detail__copy"
          aria-label="复制音色ID"
          title={normalizedVoiceId}
          onMouseDown={handleFavoriteMouseDown}
          onClick={handleCopyVoiceId}
        >
          <Copy className="voice-detail__copy-icon" size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}
      {typeof onToggleFavorite === 'function' ? (
        <button
          type="button"
          className={`voice-detail__favorite ${favorited ? 'is-favorited' : ''}`}
          aria-label={favoriteTitle}
          title={favoriteTitle}
          disabled={favoriteDisabled}
          onMouseDown={handleFavoriteMouseDown}
          onClick={handleFavoriteClick}
        >
          <img
            className="voice-detail__favorite-icon"
            src={favorited ? VoiceCollectedIcon : VoiceCollectIcon}
            alt=""
            aria-hidden="true"
          />
        </button>
      ) : null}
      <div className="voice-detail__price" title={`单价 ${unitPriceText}`}>
        <img className="voice-detail__price-icon" src={Point2Icon} alt="" aria-hidden="true" />
        <span>{unitPriceText}</span>
      </div>
    </div>
  );
};

export default VoiceDetail;
