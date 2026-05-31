import React from 'react';
import { Check } from 'lucide-react';
import './index.css';
import VoiceCircularVisualizer from '../VoiceCircularVisualizer';
import VoiceDetail from '../VoiceDetail';

const VoiceCard = ({
  item,
  isSelected = false,
  isPlaying = false,
  favoriteLoading = false,
  onPreviewToggle,
  onPreviewEnd,
  onToggleFavorite,
}) => {
  const title = item?.title || item?.global_voice_id || '未命名音色';
  const previewUrl = item?.try_listen_url;

  const stopPreviewEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePreviewClick = (event) => {
    stopPreviewEvent(event);

    if (!previewUrl) return;
    onPreviewToggle?.(item);
  };

  return (
    <div className={`voice-card ${isSelected ? 'voice-card--selected' : ''}`}>
      <button
        type="button"
        className="voice-card__avatar-wrap"
        aria-label={`试听${title}`}
        title="试听"
        disabled={!previewUrl}
        onMouseDown={stopPreviewEvent}
        onClick={handlePreviewClick}
      >
        {isPlaying && previewUrl ? (
          <div className="voice-card__wave-line">
            <VoiceCircularVisualizer
              audioUrl={previewUrl}
              width={40}
              height={40}
              backgroundColor="rgba(0, 0, 0, 0)"
              gradientColors={['#fc88af', '#3bffaf', '#3f9dff']}
              barWidth={1}
              fftSize={128}
              smoothingTimeConstant={0.65}
              animationSpeed={1}
              onAudioEnd={() => onPreviewEnd?.(item?.global_voice_id)}
              onError={() => onPreviewEnd?.(item?.global_voice_id)}
            />
          </div>
        ) : null}
        {item?.avatar_url ? (
          <img className="voice-card__avatar" src={item.avatar_url} alt="" aria-hidden="true" />
        ) : (
          <div className="voice-card__avatar voice-card__avatar--placeholder">
            {String(title).slice(0, 1)}
          </div>
        )}
        <span className="voice-card__preview" aria-hidden="true">
          <span className="voice-card__preview-icon" aria-hidden="true" />
        </span>
      </button>
      <VoiceDetail
        title={title}
        provider={item?.providers || item?.provider}
        globalVoiceId={item?.global_voice_id}
        priceText={item?.price_text}
        favorited={Boolean(item?.favorited)}
        favoriteDisabled={favoriteLoading}
        onToggleFavorite={
          typeof onToggleFavorite === 'function' ? () => onToggleFavorite(item) : undefined
        }
      />
      {isSelected ? <Check className="voice-card__check" size={14} strokeWidth={2.5} aria-hidden="true" /> : null}
    </div>
  );
};

export default React.memo(VoiceCard);
