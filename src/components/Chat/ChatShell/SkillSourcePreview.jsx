import React from 'react';
import { ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';
import './WorkSpace/WorkSpace.css';

const SkillSourcePreview = ({ preview, onLoad, renderTreeNodes }) => {
  const rootPath = preview?.rootPath || '';
  const title = preview?.title || '技能源码';
  const [refreshVersion, setRefreshVersion] = React.useState(0);
  const [nodes, setNodes] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    setNodes([]);
    setError('');
    setLoading(Boolean(rootPath));
    if (!rootPath) return () => { cancelled = true; };

    const load = async () => {
      try {
        const result = await onLoad(preview);
        if (!cancelled) setNodes(result);
      } catch (loadError) {
        if (!cancelled) setError(loadError?.message || '加载技能源码失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [preview, rootPath, onLoad, refreshVersion]);

  return (
    <section className="chat-workspace-preview" aria-label="技能源码">
      <header className="chat-workspace-preview__header">
        <FolderOpen size={18} aria-hidden="true" />
        <h1 title={rootPath}>{title}</h1>
        <button
          type="button"
          className="chat-web-preview__action"
          title="刷新技能源码"
          aria-label="刷新技能源码"
          disabled={!rootPath}
          onClick={() => setRefreshVersion((version) => version + 1)}>
          <RefreshCw size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="chat-web-preview__action"
          title="打开文件管理器"
          aria-label="打开文件管理器"
          disabled={!rootPath}
          onClick={() => { void window.api?.file?.openPath(rootPath); }}>
          <ExternalLink size={14} aria-hidden="true" />
        </button>
      </header>
      <div className="chat-workspace-preview__body">
        <div className="chat-panel__workspace-tree" aria-busy={loading}>
          {!rootPath ? <p className="chat-panel__members-empty">无法定位技能目录</p> : loading ? (
            <p className="chat-panel__members-empty">加载目录中...</p>
          ) : error ? (
            <p className="chat-panel__members-empty" role="alert">{error}</p>
          ) : nodes.length === 0 ? (
            <p className="chat-panel__members-empty">目录为空</p>
          ) : renderTreeNodes(`skill-source:${rootPath}`, rootPath, nodes, 0)}
        </div>
      </div>
    </section>
  );
};

export default SkillSourcePreview;
