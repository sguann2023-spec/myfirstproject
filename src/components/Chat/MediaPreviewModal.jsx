import React from 'react';
import { Modal } from 'antd';
import { X } from 'lucide-react';
import './Composer/LocalFilePreviewList/index.css';

export default function MediaPreviewModal({ src, kind, name = '', onClose }) {
  const [previewAspectRatio, setPreviewAspectRatio] = React.useState(1);
  const mediaRef = React.useRef(null);
  const bindMedia = React.useCallback((node) => {
    const previous = mediaRef.current;
    if (previous && previous !== node) {
      previous.pause();
      previous.removeAttribute('src');
      previous.load();
    }
    mediaRef.current = node;
  }, []);
  React.useEffect(() => { setPreviewAspectRatio(1); }, [src]);
  return (
      <Modal open={Boolean(src)} centered title={null} closable closeIcon={<X size={22} />} maskClosable
        transitionName="" maskTransitionName=""
        width={src && kind === 'audio' ? 492 : `min(80vw, ${80 * previewAspectRatio}vh)`}
        rootClassName={`chat-panel__media-click-modal chat-panel__media-click-modal--${src ? kind : ''}`}
        onCancel={() => onClose()} footer={null} destroyOnHidden>
        {src ? (
          <div className="chat-panel__media-click-content" onClick={() => onClose()}>
            {kind === 'image' ? (
              <img className="chat-panel__media-click-image" src={src} alt={name}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth > 0 && naturalHeight > 0) setPreviewAspectRatio(naturalWidth / naturalHeight);
                }} />
            ) : kind === 'video' ? <>
              <video ref={bindMedia} key={src} src={src} controls playsInline preload="metadata"
                onClick={(event) => event.stopPropagation()}
                onLoadedMetadata={(event) => {
                  const { videoWidth, videoHeight } = event.currentTarget;
                  if (videoWidth > 0 && videoHeight > 0) setPreviewAspectRatio(videoWidth / videoHeight);
                }} />
              <div className="chat-panel__media-click-title" title={name}>{name}</div>
            </> : <audio ref={bindMedia} key={src} src={src} controls preload="metadata" onClick={(event) => event.stopPropagation()} />}
          </div>
        ) : null}
      </Modal>
  );
}
