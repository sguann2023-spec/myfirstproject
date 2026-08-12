import { File, FileAudio, FileVideo, X } from 'lucide-react';
import './index.css';

const getFileDisplayName = (file = {}) => file.name || '文件';
const getFileExtension = (fileName = '') => {
  const normalized = String(fileName || '').trim();
  if (!normalized || !normalized.includes('.')) return '';
  return normalized.split('.').pop() || '';
};

const getFileKindFromType = (fileType = '') => {
  if (String(fileType).startsWith('image/')) return 'image';
  if (String(fileType).startsWith('video/')) return 'video';
  if (String(fileType).startsWith('audio/')) return 'audio';
  return 'file';
};
const getFileMetaLabel = (file = {}) => {
  const extension = getFileExtension(file.name).toUpperCase();
  if (extension) return extension;
  const kind = getFileKindFromType(file.fileType);
  if (kind === 'image') return 'IMAGE';
  if (kind === 'video') return 'VIDEO';
  if (kind === 'audio') return 'AUDIO';
  return 'FILE';
};

const getPreviewUrl = (file = {}) => (
  file.localPreviewUrl || file.localThumbUrl || file.previewUrl || file.thumbnailUrl || file.url || ''
);

const renderFileThumb = (file = {}) => {
  const previewUrl = getPreviewUrl(file);
  const kind = getFileKindFromType(file.fileType);

  if (previewUrl && kind === 'image') {
    return <img className="chat-panel__local-file-preview-thumb-image" src={previewUrl} alt={getFileDisplayName(file)} />;
  }

  if (previewUrl && kind === 'video') {
    return (
      <>
        <video
          className="chat-panel__local-file-preview-thumb-video"
          src={previewUrl}
          muted
          playsInline
          preload="metadata"
        />
        {file.durationLabel ? (
          <span className="chat-panel__local-file-preview-thumb-duration">{file.durationLabel}</span>
        ) : null}
      </>
    );
  }

  return (
    <span className="chat-panel__local-file-preview-thumb-icon" aria-hidden="true">
      {kind === 'audio' ? <FileAudio size={18} /> : kind === 'file' ? <File size={18} /> : <FileVideo size={18} />}
    </span>
  );
};

const LocalFilePreviewList = ({ files = [], onRemove }) => {
  if (!Array.isArray(files) || files.length === 0) return null;

  return (
    <div className="chat-panel__local-file-preview-list" aria-label="文件预览">
      <div className="chat-panel__local-file-preview-scroll">
        {files.map((file) => {
          const isImage = getFileKindFromType(file.fileType) === 'image';

          return (
            <div
              key={file.uid || file.name}
              className={`chat-panel__local-file-preview-item ${isImage ? 'chat-panel__local-file-preview-item--image' : ''}`}
            >
              <button
                type="button"
                className="chat-panel__local-file-preview-remove"
                aria-label={`移除 ${getFileDisplayName(file)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove && onRemove(file);
                }}
              >
                <X size={12} />
              </button>
              <div className="chat-panel__local-file-preview-thumb">
                {renderFileThumb(file)}
              </div>
              {isImage ? null : (
                <div className="chat-panel__local-file-preview-main">
                  <div className="chat-panel__local-file-preview-name" title={getFileDisplayName(file)}>
                    {getFileDisplayName(file)}
                  </div>
                  <div className="chat-panel__local-file-preview-meta">
                    {getFileMetaLabel(file)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LocalFilePreviewList;
