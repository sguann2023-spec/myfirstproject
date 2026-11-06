import React from 'react';
import { Typography } from 'antd';
import DraftIcon from '../../../../public/draft_icon.svg';
import { toMediaSrc } from '../../../shared/mediaSrc.js';
import PinnedDraftTrackView from '@renderer/pages/home/Inputbar/components/PinnedDraftTrackView/PinnedDraftTrackView';
import './ArtifactPreview.css';
import { formatDraftUpdatedAt } from '../pinnedDraftMetadata';

const { Text } = Typography;

// 与原 PinnedDraftPannel 展开列表保持一致的状态归一与标题回退逻辑
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
  sessionActive = false,
  sessionFulfilled = false,
  onPreviewItem,
  onDownloadItem,
  previewLoadingKey = null,
  previewErrorKey = null,
  previewErrorMessage = ''
}) => {
  const [previewDraftKey, setPreviewDraftKey] = React.useState(null);

  const displayDrafts = React.useMemo(() => drafts.map((draft, index) => {
    const status = draft.status === 'completed' ? 'completed' : 'in_progress';
    const normalizedStatus = sessionFulfilled && !sessionActive ? 'completed' : status;

    return {
      ...draft,
      key: draft.id || draft.draftId || `${draft.title || draft.name || 'draft'}-${index}`,
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
        <h3 className="artifact-preview__section-title">草稿</h3>
        {displayDrafts.length === 0 ? (
          <div className="artifact-preview__state">暂无草稿</div>
        ) : (
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
      </div>
    </div>
  );
};

export default ArtifactPreview;
