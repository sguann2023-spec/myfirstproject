import './index.css';
import VoiceCollectIcon from '../../../public/voice_collect.svg';
import VoiceCollectedIcon from '../../../public/voice_collected.svg';

const VoiceDetail = ({
  title,
  description,
  favorited = false,
  favoriteDisabled = false,
  onToggleFavorite,
}) => {
  const favoriteTitle = favorited ? '取消收藏' : '收藏';

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
    </div>
  );
};

export default VoiceDetail;
