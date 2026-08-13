import { File, FileAudio, FileVideo, X } from 'lucide-react';
import FirstFrameIcon from '../../../../../public/first_frame.svg';
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

const renderPlaceholderThumb = () => {
  return (
    <span className="chat-panel__local-file-preview-placeholder-thumb-content" aria-hidden="true">
      <img src={FirstFrameIcon} alt="" aria-hidden="true" />
    </span>
  );
};

const buildOrderedPreviewEntries = (files = [], placeholders = [], slotOrder = []) => {
  const resolvedFiles = Array.isArray(files) ? files : [];
  const resolvedPlaceholders = Array.isArray(placeholders) ? placeholders : [];
  if (!Array.isArray(slotOrder) || slotOrder.length === 0) {
    return [
      ...resolvedFiles.map((file) => ({ type: 'file', key: `file:${file.uid || file.name}`, value: file })),
      ...resolvedPlaceholders.map((placeholder) => ({ type: 'placeholder', key: `placeholder:${placeholder.key || placeholder.label}`, value: placeholder })),
    ];
  }

  const orderedEntries = [];
  const usedFileKeys = new Set();
  const usedPlaceholderKeys = new Set();

  slotOrder.forEach((slotKey) => {
    const normalizedSlotKey = String(slotKey || '').trim();
    if (!normalizedSlotKey) return;

    const matchedFile = resolvedFiles.find((file) => String(file?.slotId || '').trim() === normalizedSlotKey);
    if (matchedFile) {
      const fileKey = `file:${matchedFile.uid || matchedFile.name}`;
      usedFileKeys.add(fileKey);
      orderedEntries.push({ type: 'file', key: fileKey, value: matchedFile });
      return;
    }

    const matchedPlaceholder = resolvedPlaceholders.find((placeholder) => String(placeholder?.key || '').trim() === normalizedSlotKey);
    if (matchedPlaceholder) {
      const placeholderKey = `placeholder:${matchedPlaceholder.key || matchedPlaceholder.label}`;
      usedPlaceholderKeys.add(placeholderKey);
      orderedEntries.push({ type: 'placeholder', key: placeholderKey, value: matchedPlaceholder });
    }
  });

  resolvedFiles.forEach((file) => {
    const fileKey = `file:${file.uid || file.name}`;
    if (usedFileKeys.has(fileKey)) return;
    orderedEntries.push({ type: 'file', key: fileKey, value: file });
  });
  resolvedPlaceholders.forEach((placeholder) => {
    const placeholderKey = `placeholder:${placeholder.key || placeholder.label}`;
    if (usedPlaceholderKeys.has(placeholderKey)) return;
    orderedEntries.push({ type: 'placeholder', key: placeholderKey, value: placeholder });
  });

  return orderedEntries;
};

const LocalFilePreviewList = ({ files = [], placeholders = [], slotOrder = [], onRemove, onAddFile }) => {
  const resolvedFiles = Array.isArray(files) ? files : [];
  const resolvedPlaceholders = Array.isArray(placeholders) ? placeholders : [];
  if (resolvedFiles.length === 0 && resolvedPlaceholders.length === 0) return null;
  const previewEntries = buildOrderedPreviewEntries(resolvedFiles, resolvedPlaceholders, slotOrder);

  return (
    <div className="chat-panel__local-file-preview-list" aria-label="文件预览">
      <div className="chat-panel__local-file-preview-scroll">
        {previewEntries.map((entry) => {
          if (entry.type === 'placeholder') {
            const placeholder = entry.value;
            return (
              <button
                key={entry.key}
                type="button"
                className="chat-panel__local-file-preview-placeholder"
                onClick={() => onAddFile && onAddFile(placeholder)}
              >
                <span className="chat-panel__local-file-preview-placeholder-thumb">
                  {renderPlaceholderThumb()}
                  <span className="chat-panel__local-file-preview-placeholder-label">
                    {placeholder.label || '上传文件'}
                  </span>
                </span>
              </button>
            );
          }

          const file = entry.value;
          const isImage = getFileKindFromType(file.fileType) === 'image';

          return (
            <div
              key={entry.key}
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
