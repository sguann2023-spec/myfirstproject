import React from 'react';
import './index.css';

const VIDEO_TEMPLATE_MANIFEST_URL = 'https://player.install-ai-guider.top/example/client_video_template/manifest.json';

const stripUrlQuery = (url) => String(url || '').trim().split('?')[0];

const isVideoUrl = (url) => {
  const normalizedUrl = stripUrlQuery(url).toLowerCase();
  return normalizedUrl.endsWith('.mp4') || normalizedUrl.endsWith('.mov') || normalizedUrl.endsWith('.webm') || normalizedUrl.endsWith('.m4v');
};

const resolvePreviewVideoUrl = (item) => {
  const previewVideoUrl = String(item?.previewVideoUrl || '').trim();
  if (previewVideoUrl) {
    return previewVideoUrl;
  }

  const coverUrl = String(item?.cover || '').trim();
  if (coverUrl.includes('x-tos-process=video/snapshot') && isVideoUrl(coverUrl)) {
    return stripUrlQuery(coverUrl);
  }

  return '';
};

const VideoTemplatePopover = ({
  onApplyTemplate = null,
}) => {
  const [templateItems, setTemplateItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState('');
  const [hoveredTemplateId, setHoveredTemplateId] = React.useState('');
  const [unmutedTemplateId, setUnmutedTemplateId] = React.useState('');
  const [loadedPreviewIds, setLoadedPreviewIds] = React.useState(() => new Set());
  const [loadedCoverIds, setLoadedCoverIds] = React.useState(() => new Set());
  const [readyPreviewIds, setReadyPreviewIds] = React.useState(() => new Set());
  const videoElementMapRef = React.useRef(new Map());

  const setVideoElementRef = React.useCallback((templateId, element) => {
    if (!templateId) return;
    if (element) {
      videoElementMapRef.current.set(templateId, element);
      return;
    }
    videoElementMapRef.current.delete(templateId);
  }, []);

  const markPreviewLoaded = React.useCallback((templateId) => {
    if (!templateId) return;
    setLoadedPreviewIds((prev) => {
      if (prev.has(templateId)) return prev;
      const next = new Set(prev);
      next.add(templateId);
      return next;
    });
  }, []);

  const markCoverLoaded = React.useCallback((templateId) => {
    if (!templateId) return;
    setLoadedCoverIds((prev) => {
      if (prev.has(templateId)) return prev;
      const next = new Set(prev);
      next.add(templateId);
      return next;
    });
  }, []);

  const markPreviewReady = React.useCallback((templateId) => {
    if (!templateId) return;
    setReadyPreviewIds((prev) => {
      if (prev.has(templateId)) return prev;
      const next = new Set(prev);
      next.add(templateId);
      return next;
    });
  }, []);

  React.useEffect(() => {
    videoElementMapRef.current.forEach((element, templateId) => {
      if (!element) return;
      element.muted = templateId !== unmutedTemplateId;
      if (templateId === hoveredTemplateId && loadedPreviewIds.has(templateId)) {
        element.currentTime = 0;
        const playPromise = element.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
        return;
      }
      element.pause();
      element.currentTime = 0;
    });
  }, [hoveredTemplateId, loadedPreviewIds, unmutedTemplateId]);

  React.useEffect(() => {
    if (!unmutedTemplateId) return;
    if (hoveredTemplateId === unmutedTemplateId) return;
    setUnmutedTemplateId('');
  }, [hoveredTemplateId, unmutedTemplateId]);

  React.useEffect(() => () => {
    videoElementMapRef.current.forEach((element) => {
      if (!element) return;
      element.pause();
      element.currentTime = 0;
    });
    videoElementMapRef.current.clear();
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();

    const loadManifest = async () => {
      try {
        setLoading(true);
        setLoadError('');
        const response = await fetch(VIDEO_TEMPLATE_MANIFEST_URL, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`manifest request failed: ${response.status}`);
        }
        const payload = await response.json();
        const templates = Array.isArray(payload?.templates) ? payload.templates : [];
        setTemplateItems(templates);
      } catch (error) {
        if (error?.name === 'AbortError') return;
        setTemplateItems([]);
        setLoadError('模板加载失败');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadManifest();
    return () => controller.abort();
  }, []);

  if (loading) {
    return <div className="chat-panel__video-template-popover-empty">模板加载中...</div>;
  }

  if (loadError) {
    return <div className="chat-panel__video-template-popover-empty">{loadError}</div>;
  }

  if (templateItems.length === 0) {
    return <div className="chat-panel__video-template-popover-empty">暂无模板</div>;
  }

  return (
    <div className="chat-panel__video-template-popover-panel">
      <div className="chat-panel__video-template-grid">
        {templateItems.map((item) => (
          (() => {
            const previewVideoUrl = resolvePreviewVideoUrl(item);
            const isHovered = hoveredTemplateId === item.id;
            const isUnmuted = unmutedTemplateId === item.id;
            const shouldLoadPreview = previewVideoUrl && loadedPreviewIds.has(item.id);
            const isCoverLoaded = loadedCoverIds.has(item.id);
            const isPreviewLoading =
              Boolean(previewVideoUrl) && shouldLoadPreview && (isHovered || isUnmuted) && !readyPreviewIds.has(item.id);

            return (
              <button
                key={item.id}
                type="button"
                className="chat-panel__video-template-card"
                onClick={() => onApplyTemplate && onApplyTemplate(item)}
                onMouseEnter={() => {
                  markPreviewLoaded(item.id);
                  setHoveredTemplateId(item.id);
                }}
                onMouseLeave={() => setHoveredTemplateId((current) => (current === item.id ? '' : current))}
                onFocus={() => {
                  markPreviewLoaded(item.id);
                  setHoveredTemplateId(item.id);
                }}
                onBlur={() => setHoveredTemplateId((current) => (current === item.id ? '' : current))}
              >
                <div
                  className="chat-panel__video-template-card-cover"
                  aria-label={item.description || item.id}
                >
                  {!isCoverLoaded ? <span className="chat-panel__video-template-card-loading" aria-hidden="true" /> : null}
                  <img
                    className={`chat-panel__video-template-card-image${isCoverLoaded ? ' is-loaded' : ''}`}
                    src={item.cover}
                    alt=""
                    aria-hidden="true"
                    onLoad={() => markCoverLoaded(item.id)}
                    onError={() => markCoverLoaded(item.id)}
                  />
                  {previewVideoUrl ? (
                    <video
                      ref={(element) => setVideoElementRef(item.id, element)}
                      className={`chat-panel__video-template-card-video${isHovered ? ' is-active' : ''}`}
                      src={shouldLoadPreview ? previewVideoUrl : undefined}
                      poster={item.cover}
                      muted
                      playsInline
                      loop
                      preload="none"
                      onLoadedData={() => markPreviewReady(item.id)}
                      onCanPlay={() => markPreviewReady(item.id)}
                      onError={() => markPreviewReady(item.id)}
                      aria-hidden="true"
                    />
                  ) : null}
                  {isPreviewLoading ? <span className="chat-panel__video-template-card-preview-loading" aria-hidden="true" /> : null}
                  {previewVideoUrl ? (
                    <span
                      className="chat-panel__video-template-card-audio"
                      role="button"
                      tabIndex={-1}
                      aria-label={isUnmuted ? '静音预览' : '开启声音'}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const nextUnmuted = isUnmuted ? '' : item.id;
                        markPreviewLoaded(item.id);
                        setHoveredTemplateId(item.id);
                        setUnmutedTemplateId(nextUnmuted);
                        const element = videoElementMapRef.current.get(item.id);
                        if (!element) return;
                        element.muted = !nextUnmuted;
                        const playPromise = element.play();
                        if (playPromise && typeof playPromise.catch === 'function') {
                          playPromise.catch(() => {});
                        }
                      }}
                    >
                      {isUnmuted ? (
                        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M2.5 6.2H5l3-2.4v8.4L5 9.8H2.5V6.2Z" fill="currentColor" />
                          <path d="M10.2 6.1C10.7 6.55 11 7.23 11 8s-.3 1.45-.8 1.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                          <path d="M11.7 4.7C12.56 5.53 13.1 6.69 13.1 8s-.54 2.47-1.4 3.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M2.5 6.2H5l3-2.4v8.4L5 9.8H2.5V6.2Z" fill="currentColor" />
                          <path d="M10.4 6.1 13 8.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                          <path d="M13 6.1 10.4 8.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                      )}
                    </span>
                  ) : null}
                  <div className="chat-panel__video-template-card-hover">
                    <span className="chat-panel__video-template-card-tag">
                      {item.generationModeLabel || '视频模板'}
                    </span>
                    <span className="chat-panel__video-template-card-desc">
                      {item.prompt || item.description || ''}
                    </span>
                    <span className="chat-panel__video-template-card-action">做同款</span>
                  </div>
                </div>
              </button>
            );
          })()
        ))}
      </div>
    </div>
  );
};

export default VideoTemplatePopover;
