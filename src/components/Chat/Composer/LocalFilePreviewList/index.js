import React from 'react';
import MediaPreviewModal from '../../MediaPreviewModal';
import { Popover } from 'antd';
import { AudioLines, File, FileAudio, FileVideo, LoaderCircle, X } from 'lucide-react';
import FirstFrameIcon from '../../../../../public/first_frame.svg';
import MaterialPlusIcon from '../../../../../public/material-plus.svg';
import MaterialPlusErrorIcon from '../../../../../public/material-plus-error.svg';
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

const RemoteImageThumb = ({ src, name }) => {
  const [loading, setLoading] = React.useState(true);
  return <>
    {loading ? <span className="chat-panel__local-file-preview-thumb-loading" aria-hidden="true"><LoaderCircle className="chat-panel__local-file-preview-thumb-loading-icon" size={16} /></span> : null}
    <img className="chat-panel__local-file-preview-thumb-image" src={src} alt={name}
      onLoad={() => setLoading(false)} onError={() => setLoading(false)} />
  </>;
};

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
    if (isRemoteHttpUrl(previewUrl)) return <RemoteImageThumb key={previewUrl} src={previewUrl} name={getFileDisplayName(file)} />;
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

const renderPlaceholderThumb = (placeholder = {}) => {
  return (
    <span className="chat-panel__local-file-preview-placeholder-thumb-content" aria-hidden="true">
      {placeholder.kind === 'audio' ? <FileAudio size={20} />
        : placeholder.kind === 'video' ? <FileVideo size={20} />
        : <img src={FirstFrameIcon} alt="" aria-hidden="true" />}
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

const LocalFilePreviewList = ({ files = [], placeholders = [], slotOrder = [], fileGroups = null, activeGroupKey,
  onActiveGroupChange, onRemove, onAddFile }) => {
  const [localGroupKey, setLocalGroupKey] = React.useState('');
  const [modalFile, setModalFile] = React.useState(null);
  const resolvedFiles = Array.isArray(files) ? files : [];
  const resolvedPlaceholders = Array.isArray(placeholders) ? placeholders : [];
  const resolvedFileGroups = Array.isArray(fileGroups) ? fileGroups : null;
  const previewEntries = buildOrderedPreviewEntries(resolvedFiles, resolvedPlaceholders, slotOrder);
  const selectedGroup = resolvedFileGroups?.find((group) => group.key === (activeGroupKey || localGroupKey)) || resolvedFileGroups?.[0];
  const renderMedia = (file, hover = false) => {
    const src = getMediaPreviewUrl(file);
    const kind = getPreviewKind(file);
    if (hover && ['image', 'video', 'audio'].includes(kind)) return (
      <div className={`chat-panel__media-hover-preview chat-panel__media-hover-preview--${kind}`}>
        {kind === 'image' ? <img src={src} alt={getFileDisplayName(file)} />
          : kind === 'video' ? <video src={src} controls playsInline preload="metadata" muted />
          : <audio src={src} controls preload="metadata" />}
        <div className="chat-panel__media-hover-preview-title" title={getFileDisplayName(file)}>
          {getFileDisplayName(file)}
        </div>
      </div>
    );
    if (kind === 'image') return <img src={src} alt={getFileDisplayName(file)} style={{ maxWidth: '100%', maxHeight: hover ? 220 : '65vh' }} />;
    if (kind === 'video') return <video src={src} controls playsInline preload="metadata" muted={hover} style={{ maxWidth: '100%', maxHeight: hover ? 220 : '65vh' }} />;
    if (kind === 'audio') return <audio src={src} controls preload="metadata" />;
    return null;
  };
  // Toolbar attachments and template slots share the same centered media modal;
  // the open-preview button only renders for image/video/audio with a URL.
  const selectFile = (file) => {
    setModalFile(file);
  };
  if (resolvedFiles.length === 0 && resolvedPlaceholders.length === 0 && (resolvedFileGroups?.length || 0) === 0) return null;

  const renderPlaceholderChip = (placeholder, templateGroup = null) => (
    <button
      type="button"
      className={`chat-panel__local-file-preview-placeholder${templateGroup ? ' is-template' : ''}`}
      aria-invalid={templateGroup ? Boolean(templateGroup.invalid) : undefined}
      onClick={() => onAddFile && onAddFile(placeholder)}
    >
      <span className="chat-panel__local-file-preview-placeholder-thumb">
        {templateGroup ? (
          <span className="chat-panel__local-file-preview-placeholder-thumb-content" aria-hidden="true">
            <img src={templateGroup.invalid ? MaterialPlusErrorIcon : MaterialPlusIcon} alt="" />
          </span>
        ) : renderPlaceholderThumb(placeholder)}
        <span className="chat-panel__local-file-preview-placeholder-label">
          {placeholder.label || '上传文件'}
        </span>
      </span>
    </button>
  );

  const renderFileChip = (file) => {
    const isImage = !isVoiceIdFile(file) && getFileKindFromType(file.fileType) === 'image';
    const canPreview = ['image', 'video', 'audio'].includes(getPreviewKind(file)) && Boolean(getMediaPreviewUrl(file));

    const chip = (
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
    return resolvedFileGroups && canPreview
      ? <Popover key={`file:${getFileKey(file)}`} mouseEnterDelay={0.4} destroyOnHidden
          placement="topLeft" arrow={false} autoAdjustOverflow={false}
          rootClassName={`chat-panel__media-hover-popover chat-panel__media-hover-popover--${getPreviewKind(file)}`}
          content={renderMedia(file, true)}>{chip}</Popover>
      : chip;
  };

  const renderGroupSection = (group) => (
    <div className={`chat-panel__local-file-preview-group ${group.invalid ? 'is-invalid' : ''}`} key={`group:${group.key}`}>
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
        {group.placeholder ? renderPlaceholderChip(group.placeholder, group) : null}
      </div>
    </div>
  );

  return (
    <div className="chat-panel__local-file-preview-list" aria-label="文件预览">
      {resolvedFileGroups ? <div className="chat-panel__skill-group-tabs" role="tablist" aria-label="素材分组">
        {resolvedFileGroups.map((group) => <button key={group.key} type="button" role="tab"
          aria-selected={selectedGroup?.key === group.key}
          className={`${selectedGroup?.key === group.key ? 'is-active' : ''} ${group.invalid ? 'is-invalid' : ''}`}
          title={group.countHint || group.description}
          onClick={() => { setLocalGroupKey(group.key); onActiveGroupChange?.(group.key); }}>
          {group.label}({group.count})
        </button>)}
      </div> : null}
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
        {selectedGroup ? renderGroupSection(selectedGroup) : null}
      </div>
      <MediaPreviewModal src={modalFile ? getMediaPreviewUrl(modalFile) : ''}
        kind={modalFile ? getPreviewKind(modalFile) : ''} name={modalFile ? getFileDisplayName(modalFile) : ''}
        onClose={() => setModalFile(null)} />
    </div>
  );
};

export default LocalFilePreviewList;
