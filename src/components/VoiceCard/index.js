import React from 'react';
import { Check } from 'lucide-react';
import './index.css';
import VoiceCircularVisualizer from '../VoiceCircularVisualizer';
import VoiceDetail from '../VoiceDetail';

const getVoiceCardCompareShape = (props = {}) => ({
  rowKey: String(props?.rowKey || '').trim(),
  globalVoiceId: String(props?.item?.global_voice_id || '').trim(),
  title: String(props?.item?.title || '').trim(),
  avatarUrl: String(props?.item?.avatar_url || '').trim(),
  previewUrl: String(props?.item?.try_listen_url || '').trim(),
  provider: String(props?.item?.price_provider || props?.item?.providers || props?.item?.provider || '').trim(),
  priceText: String(props?.item?.price_text || props?.item?.price || '').trim(),
  priceModel: String(props?.item?.price_model || '').trim(),
  favorited: Boolean(props?.item?.favorited),
  isSelected: Boolean(props?.isSelected),
  isPlaying: Boolean(props?.isPlaying),
  favoriteLoading: Boolean(props?.favoriteLoading),
  highlightMember: Boolean(props?.highlightMember),
  showDelete: Boolean(props?.showDelete),
  deleteDisabled: Boolean(props?.deleteDisabled),
});

const VoiceCard = ({
  item,
  isSelected = false,
  isPlaying = false,
  favoriteLoading = false,
  highlightMember = false,
  showDelete = false,
  deleteDisabled = false,
  onPreviewToggle,
  onPreviewEnd,
  onDelete,
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
        provider={item?.price_provider || item?.providers || item?.provider}
        globalVoiceId={item?.global_voice_id}
        priceText={item?.price_text || item?.price}
        priceModel={item?.price_model}
        highlightMember={highlightMember}
        showDelete={showDelete}
        deleteDisabled={deleteDisabled}
        favorited={Boolean(item?.favorited)}
        favoriteDisabled={favoriteLoading}
        onDelete={typeof onDelete === 'function' ? () => onDelete(item) : undefined}
        onToggleFavorite={
          typeof onToggleFavorite === 'function' ? () => onToggleFavorite(item) : undefined
        }
      />
      {isSelected ? <Check className="voice-card__check" size={14} strokeWidth={2.5} aria-hidden="true" /> : null}
    </div>
  );
};
const areVoiceCardPropsEqual = (prevProps, nextProps) => {
  const prevShape = getVoiceCardCompareShape(prevProps);
  const nextShape = getVoiceCardCompareShape(nextProps);

  return Object.keys(prevShape).every((key) => prevShape[key] === nextShape[key]);
};

export default React.memo(VoiceCard, areVoiceCardPropsEqual);
