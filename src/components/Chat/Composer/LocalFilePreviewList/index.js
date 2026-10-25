import React from 'react';
import { AudioLines, File, FileAudio, FileVideo, LoaderCircle, X } from 'lucide-react';
import FirstFrameIcon from '../../../../../public/first_frame.svg';
import './index.css';

const getFileDisplayName = (file = {}) => file.name || '文件';
const getFileExtension = (fileName = '') => {
  const normalized = String(fileName || '').trim();
  if (!normalized || !normalized.includes('.')) return '';
  return normalized.split('.').pop() || '';
};

const isVoiceIdFile = (file = {}) => String(file?.kind || '').trim() === 'voice_id';

const isRemoteHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || ''));

const getFileKindFromType = (fileType = '') => {
  if (String(fileType).startsWith('image/')) return 'image';
  if (String(fileType).startsWith('video/')) return 'video';
  if (String(fileType).startsWith('audio/')) return 'audio';
  return 'file';
};
const getFileMetaLabel = (file = {}) => {
  if (isVoiceIdFile(file)) {
    const voiceId = String(file?.voiceId || '').trim();
    return voiceId ? `voice_id: ${voiceId}` : 'VOICE ID';
  }
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

// Cloud-hosted videos load asynchronously; show a spinner placeholder until
// the first frame is ready instead of a blank/black box.
const RemoteVideoThumb = ({ src, durationLabel }) => {
  const [status, setStatus] = React.useState('loading');

  return (
    <>
      {status === 'loading' ? (
        <span className="chat-panel__local-file-preview-thumb-loading" aria-hidden="true">
          <LoaderCircle className="chat-panel__local-file-preview-thumb-loading-icon" size={16} aria-hidden="true" />
        </span>
      ) : null}
      {status === 'error' ? (
        <span className="chat-panel__local-file-preview-thumb-icon" aria-hidden="true">
          <FileVideo size={18} />
        </span>
      ) : null}
      <video
        className="chat-panel__local-file-preview-thumb-video"
        src={src}
        muted
        playsInline
        preload="metadata"
        style={status === 'loading' ? { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' } : undefined}
        onLoadedMetadata={() => setStatus((current) => (current === 'loading' ? 'ready' : current))}
        onLoadedData={() => setStatus((current) => (current === 'loading' ? 'ready' : current))}
        onError={() => setStatus('error')}
      />
      {durationLabel ? (
        <span className="chat-panel__local-file-preview-thumb-duration">{durationLabel}</span>
      ) : null}
    </>
  );
};

const renderFileThumb = (file = {}) => {
  if (isVoiceIdFile(file)) {
    return (
      <span className="chat-panel__local-file-preview-thumb-icon" aria-hidden="true">
        <AudioLines size={18} />
      </span>
    );
  }
  const previewUrl = getPreviewUrl(file);
  const kind = getFileKindFromType(file.fileType);

  if (previewUrl && kind === 'image') {
    return <img className="chat-panel__local-file-preview-thumb-image" src={previewUrl} alt={getFileDisplayName(file)} />;
  }

  if (previewUrl && kind === 'video') {
    if (isRemoteHttpUrl(previewUrl)) {
      return <RemoteVideoThumb src={previewUrl} durationLabel={file.durationLabel} />;
    }
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

const getMediaUrl = (file = {}) => (
  file.localPreviewUrl || file.previewUrl || file.url || ''
);
const getFileKey = (file) => String(file.uid || file.name);
const getPreviewKind = (file) => isVoiceIdFile(file) ? 'file' : getFileKindFromType(file.fileType);
const getMediaPreviewUrl = (file) => getPreviewKind(file) === 'image' ? getPreviewUrl(file) : getMediaUrl(file);

const LocalFilePreviewList = ({ files = [], placeholders = [], slotOrder = [], fileGroups = null, onRemove, onAddFile, openAttachmentPreview }) => {
  const resolvedFiles = Array.isArray(files) ? files : [];
  const resolvedPlaceholders = Array.isArray(placeholders) ? placeholders : [];
  const resolvedFileGroups = Array.isArray(fileGroups) ? fileGroups : null;
  const previewEntries = buildOrderedPreviewEntries(resolvedFiles, resolvedPlaceholders, slotOrder);
  // Opened sidebar tabs are independent of the composer's attachment list.
  const selectFile = (file) => {
    const key = `chat-attachment:${getFileKey(file)}`;
    const name = getFileDisplayName(file);
    openAttachmentPreview?.({
      key,
      tabId: key,
      previewType: 'file',
      activate: true,
      title: name,
      name,
      kind: getPreviewKind(file),
      status: 'ready',
      src: getMediaPreviewUrl(file),
    });
  };
  if (resolvedFiles.length === 0 && resolvedPlaceholders.length === 0 && (resolvedFileGroups?.length || 0) === 0) return null;

  const renderPlaceholderChip = (placeholder) => (
    <button
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

  const renderFileChip = (file) => {
    const isImage = !isVoiceIdFile(file) && getFileKindFromType(file.fileType) === 'image';
    const canPreview = ['image', 'video', 'audio'].includes(getPreviewKind(file)) && Boolean(getMediaPreviewUrl(file));

    return (
      <div
        key={`file:${getFileKey(file)}`}
        className={`chat-panel__local-file-preview-item ${isImage ? 'chat-panel__local-file-preview-item--image' : ''}`}
      >
        {canPreview ? (
          <button
            type="button"
            className="chat-panel__local-file-preview-open"
            aria-label={`预览 ${getFileDisplayName(file)}`}
            title={`预览 ${getFileDisplayName(file)}`}
            onClick={() => selectFile(file)}
          />
        ) : null}
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
            {isVoiceIdFile(file) ? null : (
              <div className="chat-panel__local-file-preview-meta">
                {getFileMetaLabel(file)}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderGroupSection = (group) => (
    <div className="chat-panel__local-file-preview-group" key={`group:${group.key}`}>
      <div
        className="chat-panel__local-file-preview-group-header"
        title={group.description || group.label}
      >
        <span className="chat-panel__local-file-preview-group-label">{group.label}</span>
        {group.countHint ? (
          <span className="chat-panel__local-file-preview-group-hint">{group.countHint}</span>
        ) : null}
      </div>
      <div className="chat-panel__local-file-preview-group-files">
        {group.files.map((file) => renderFileChip(file))}
        {group.placeholder ? renderPlaceholderChip(group.placeholder) : null}
      </div>
    </div>
  );

  return (
    <div className="chat-panel__local-file-preview-list" aria-label="文件预览">
      <div className="chat-panel__local-file-preview-scroll">
        {previewEntries.map((entry) => (
          entry.type === 'placeholder'
            ? (
              <React.Fragment key={`placeholder:${entry.value.key || entry.value.label}`}>
                {renderPlaceholderChip(entry.value)}
              </React.Fragment>
            )
            : renderFileChip(entry.value)
        ))}
        {resolvedFileGroups ? resolvedFileGroups.map((group) => renderGroupSection(group)) : null}
      </div>
    </div>
  );
};

export default LocalFilePreviewList;
