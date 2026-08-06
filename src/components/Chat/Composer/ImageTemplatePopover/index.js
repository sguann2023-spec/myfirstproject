import React from 'react';
import './index.css';

const IMAGE_TEMPLATE_MANIFEST_URL = 'https://player.install-ai-guider.top/example/client_image_template/manifest.json';

const ratioToAspectRatio = (ratio) => {
  if (!ratio || typeof ratio !== 'string' || !ratio.includes(':')) {
    return '1 / 1';
  }
  const [width = '1', height = '1'] = ratio.split(':');
  return `${width.trim()} / ${height.trim()}`;
};

const ImageTemplatePopover = ({
  onApplyTemplate = null,
}) => {
  const [templateItems, setTemplateItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState('');

  React.useEffect(() => {
    const controller = new AbortController();

    const loadManifest = async () => {
      try {
        setLoading(true);
        setLoadError('');
        const response = await fetch(IMAGE_TEMPLATE_MANIFEST_URL, {
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
    return <div className="chat-panel__image-template-popover-empty">模板加载中...</div>;
  }

  if (loadError) {
    return <div className="chat-panel__image-template-popover-empty">{loadError}</div>;
  }

  if (templateItems.length === 0) {
    return <div className="chat-panel__image-template-popover-empty">暂无模板</div>;
  }

  return (
    <div className="chat-panel__image-template-popover-panel">
      <div className="chat-panel__image-template-grid">
        {templateItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className="chat-panel__image-template-card"
            onClick={() => onApplyTemplate && onApplyTemplate(item)}
          >
            <div
              className="chat-panel__image-template-card-cover"
              aria-label={item.description || item.id}
              style={{
                aspectRatio: ratioToAspectRatio(item.ratio),
              }}
            >
              <img className="chat-panel__image-template-card-image" src={item.cover} alt="" aria-hidden="true" />
              <div className="chat-panel__image-template-card-hover">
                <span className="chat-panel__image-template-card-desc">{item.description}</span>
                <span className="chat-panel__image-template-card-action">做同款</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ImageTemplatePopover;
