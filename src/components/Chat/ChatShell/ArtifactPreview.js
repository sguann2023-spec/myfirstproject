import { AudioGenerationToolBody } from '@renderer/pages/home/Messages/Tools/MessageAgentTools/AudioGenerationTool';
import { pinnedAudioToOutput } from '../pinnedAudioMetadata';
import React from 'react';
import { FileChartLine } from 'lucide-react';
import MediaPreviewModal from '../MediaPreviewModal';

const VideoItem = ({ video, onOpen }) => {
  const [duration, setDuration] = React.useState(null);
  const src = toMediaSrc(video.videoUrl);
  React.useEffect(() => setDuration(null), [src]);
  const label = Number.isFinite(duration) && duration > 0
    ? `${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(Math.floor(duration % 60)).padStart(2, '0')}` : '--:--';
  return <button type="button" className="artifact-preview__video-item" aria-label="预览生成视频" onClick={onOpen}>
    <video src={src} muted playsInline preload="metadata"
      onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
      onDurationChange={(event) => setDuration(event.currentTarget.duration)} onError={() => setDuration(null)} />
    <span className="artifact-preview__video-duration">{label}</span>
  </button>;
};
import { Image, Typography } from 'antd';
import DraftIcon from '../../../../public/draft_icon.svg';
import { toMediaSrc } from '../../../shared/mediaSrc.js';
import PinnedDraftTrackView from '@renderer/pages/home/Inputbar/components/PinnedDraftTrackView/PinnedDraftTrackView';
import './ArtifactPreview.css';
import { formatDraftUpdatedAt } from '../pinnedDraftMetadata';

const { Text } = Typography;

// 与原 PinnedArtifactPannel 展开列表保持一致的状态归一与标题回退逻辑
const getDraftTitle = (draft, index, sessionActive) => {
  if (draft.status === 'in_progress' && sessionActive && draft.activeTitle) {
    return draft.activeTitle;
  }

  return draft.title || draft.name || draft.draftTitle || draft.draftId || draft.id || `草稿 ${index + 1}`;
};

const DraftCover = ({ cover }) => {
  const src = toMediaSrc(cover);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  const isPlaceholder = !src || failed;
  return (
    <div className={`artifact-preview__cover ${isPlaceholder ? 'is-placeholder' : ''}`.trim()}>
      <img src={isPlaceholder ? DraftIcon : src} alt="" onError={() => setFailed(true)} />
    </div>
  );
};

// 草稿产物预览窗格：展示本轮会话生成的草稿列表，
// 点击条目展开轨道预览，导出按钮入队下载。
const ArtifactPreview = ({
  drafts = [],
  audios = [],
  images = [],
  videos = [],
  documents = [],
  onOpenDocument,
  sessionActive = false,
  sessionFulfilled = false,
  onPreviewItem,
  onDownloadItem,
  previewLoadingKey = null,
  previewErrorKey = null,
  previewErrorMessage = ''
}) => {
  const [previewVideo, setPreviewVideo] = React.useState(null);
  React.useEffect(() => setPreviewVideo(null), [videos]);
  const [previewDraftKey, setPreviewDraftKey] = React.useState(null);

  const displayDrafts = React.useMemo(() => drafts.map((draft, index) => {
    const status = draft.status === 'completed' ? 'completed' : 'in_progress';
    const normalizedStatus = sessionFulfilled && !sessionActive ? 'completed' : status;

    return {
      ...draft,
      key: draft.draftId || draft.id || `${draft.title || draft.name || 'draft'}-${index}`,
      title: getDraftTitle({ ...draft, status: normalizedStatus }, index, sessionActive),
      status: normalizedStatus,
      statusTone: normalizedStatus === 'completed' ? 'completed' : 'processing'
    };
  }), [drafts, sessionActive, sessionFulfilled]);

  const openPreviewItem = React.useCallback((draft) => {
    if (!draft) return;
    if (previewDraftKey === draft.key) {
      setPreviewDraftKey(null);
      return;
    }
    setPreviewDraftKey(draft.key);
    onPreviewItem?.(draft);
  }, [onPreviewItem, previewDraftKey]);

  return (
    <div className="artifact-preview">
      <div className="artifact-preview__body">
        {(displayDrafts.length > 0 || audios.length === 0 && images.length === 0 && videos.length === 0 && documents.length === 0) && <h3 className="artifact-preview__section-title">草稿</h3>}
        {displayDrafts.length === 0 ? (audios.length || images.length || videos.length || documents.length ? null : (
          <div className="artifact-preview__state">暂无草稿</div>
        )) : (
          <div className="artifact-preview__list">
            {displayDrafts.map((draft) => (
              <div className="artifact-preview__card" key={draft.key}>
              <div
                className={`artifact-preview__item artifact-preview__item--${draft.statusTone}`.trim()}
                role="button"
                tabIndex={0}
                aria-expanded={previewDraftKey === draft.key}
                onClick={() => openPreviewItem(draft)}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    openPreviewItem(draft);
                  }
                }}>
                <DraftCover cover={draft.cover} />
                <div className="artifact-preview__item-main">
                  <Text className="artifact-preview__item-title" title={draft.title}>{draft.title}</Text>
                  <div className="artifact-preview__item-time">{formatDraftUpdatedAt(draft.updated_at)}</div>
                </div>
                <button
                  type="button"
                  className="artifact-preview__export"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDownloadItem?.(draft);
                  }}
                  aria-label={`导出草稿 ${draft.title}`}>
                  导出
                </button>
              </div>
              {previewDraftKey === draft.key && (
                <div className="artifact-preview__track">
                  {previewLoadingKey === draft.key ? (
                    <div className="artifact-preview__state">正在加载轨道预览...</div>
                  ) : previewErrorKey === draft.key ? (
                    <div className="artifact-preview__state artifact-preview__state--error" role="alert">
                      {previewErrorMessage || '轨道预览加载失败'}
                    </div>
                  ) : draft.trackPreview ? (
                    <PinnedDraftTrackView draftTitle={draft.title} preview={draft.trackPreview} />
                  ) : (
                    <div className="artifact-preview__state">暂无可预览轨道</div>
                  )}
                </div>
              )}
              </div>
            ))}
          </div>
        )}
        {videos.length > 0 && <section aria-label="视频">
          <h3 className="artifact-preview__section-title">视频</h3>
          <div className="artifact-preview__video-grid">
            {videos.map((video) => <VideoItem key={`${video.runtimeSessionId}:${video.id}`} video={video} onOpen={() => setPreviewVideo(video)} />)}
          </div>
        </section>}
        <MediaPreviewModal src={previewVideo ? toMediaSrc(previewVideo.videoUrl) : ''} kind="video" name="生成视频" onClose={() => setPreviewVideo(null)} />
        {images.length > 0 && <section aria-label="图片" className="artifact-preview__image-section">
          <h3 className="artifact-preview__section-title">图片</h3>
          <Image.PreviewGroup>
            <div className="artifact-preview__image-grid">
              {images.map((image, index) => <Image
                key={image.id}
                src={toMediaSrc(image.imageUrl)}
                alt={`生成图片 ${index + 1}`}
              />)}
            </div>
          </Image.PreviewGroup>
        </section>}
        {audios.length > 0 && <section aria-label="音频" className="artifact-preview__audio-section">
          <h3 className="artifact-preview__section-title">音频</h3>
          <div className="artifact-preview__list">
            {audios.map((audio) => <div className="artifact-preview__card" key={audio.id}>
              <AudioGenerationToolBody output={pinnedAudioToOutput(audio)} title={audio.text} isRunning={false} compact />
            </div>)}
          </div>
        </section>}
        {documents.length > 0 && <section aria-label="文档">
          <h3 className="artifact-preview__section-title">文档</h3>
          <div className="artifact-preview__list">{documents.map((item) => <div className="artifact-preview__card" key={item.id}>
            <div className="artifact-preview__item">
              <div className="artifact-preview__cover is-placeholder"><FileChartLine size={28} strokeWidth={1} /></div>
              <div className="artifact-preview__item-main">
                <Text className="artifact-preview__item-title" title={item.name || item.filePath?.split('/').pop()}>{item.name || item.filePath?.split('/').pop()}</Text>
                <div className="artifact-preview__item-time">{formatDraftUpdatedAt(item.createdAt)}</div>
              </div>
              <button type="button" className="artifact-preview__export" onClick={() => onOpenDocument?.(item)}>打开</button>
            </div>
          </div>)}</div>
        </section>}
      </div>
    </div>
  );
};

export default ArtifactPreview;
