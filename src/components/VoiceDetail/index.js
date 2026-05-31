import React from 'react';
import { getTtsSpeechPrice } from '../../api/tts';
import './index.css';
import Point2Icon from '../../../public/point2.svg';
import VoiceCollectIcon from '../../../public/voice_collect.svg';
import VoiceCollectedIcon from '../../../public/voice_collected.svg';

const DEFAULT_PRICE_TEXT = '--/百字';
const voicePriceCache = new Map();
const voicePriceRequestCache = new Map();

const normalizeVoiceProvider = (provider) =>
  String(provider || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)[0] || '';

const buildVoicePriceCacheKey = ({ provider = '', voiceId = '', model = '' } = {}) =>
  [provider, voiceId, model].join('|');

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
        const pendingRequest =
          voicePriceRequestCache.get(requestKey) ||
          getTtsSpeechPrice({
            provider: normalizedProvider || undefined,
            voice_id: normalizedVoiceId || undefined,
            model: normalizedProvider === 'minimax' ? normalizedPriceModel || undefined : undefined,
          });
        voicePriceRequestCache.set(requestKey, pendingRequest);
        const result = await pendingRequest;
        const nextText = String(result?.price_text || '').trim() || DEFAULT_PRICE_TEXT;
        voicePriceCache.set(requestKey, nextText);
        if (!cancelled) setUnitPriceText(nextText);
      } catch (error) {
        if (!cancelled) setUnitPriceText(DEFAULT_PRICE_TEXT);
      } finally {
        voicePriceRequestCache.delete(requestKey);
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

  return (
    <div className="voice-detail">
      <div className="voice-detail__main">
        <div className="voice-detail__title">{title}</div>
        {description ? <div className="voice-detail__description">{description}</div> : null}
      </div>
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
