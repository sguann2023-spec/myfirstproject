import React from 'react';
import { LoaderCircle, X } from 'lucide-react';
import Markdown from '../../Markdown/Markdown';
import './SkillMarkdownPreview.css';

const parseSkillMarkdown = (rawContent) => {
  const source = String(rawContent || '');
  const frontmatterMatch = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!frontmatterMatch) {
    return {
      description: '',
      content: source.trim()
    };
  }

  const frontmatter = frontmatterMatch[1];
  const body = source.slice(frontmatterMatch[0].length).trim();
  const descriptionMatch = frontmatter.match(/(?:^|\n)description:\s*([\s\S]*?)(?=\n[\w-]+\s*:|$)/);
  const description = String(descriptionMatch?.[1] || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\n\s+/g, ' ');

  return {
    description,
    content: body
  };
};

const SkillMarkdownPreview = ({
  skill,
  onBack,
  onAddSkill,
  onUseSkill,
  isInstalled = false,
  addLoading = false,
  addDisabled = false
}) => {
  const [state, setState] = React.useState({
    status: 'loading',
    description: '',
    content: '',
    error: ''
  });
  const markdownComponents = React.useMemo(() => ({
    a: ({ children }) => <span className="chat-panel__skill-preview-link-text">{children}</span>
  }), []);

  React.useEffect(() => {
    let disposed = false;
    const skillPath = String(skill?.skillMarkdownPath || '').trim();

    if (!skillPath) {
      setState({
        status: 'error',
        description: '',
        content: '',
        error: '未找到技能说明文件'
      });
      return undefined;
    }

    setState({
      status: 'loading',
      description: '',
      content: '',
      error: ''
    });

    const loadMarkdown = async () => {
      try {
        const rawContent = await window.api.file.readExternal(skillPath, true);
        const { description, content } = parseSkillMarkdown(rawContent);
        if (disposed) return;
        setState({
          status: 'ready',
          description,
          content: String(content || ''),
          error: ''
        });
      } catch (error) {
        if (disposed) return;
        setState({
          status: 'error',
          description: '',
          content: '',
          error: error?.message || '读取技能说明失败'
        });
      }
    };

    void loadMarkdown();

    return () => {
      disposed = true;
    };
  }, [skill?.skillMarkdownPath]);

  const actionLabel = isInstalled ? '去使用' : '添加技能';

  return (
    <div className="chat-panel__skill-preview">
      <div className="chat-panel__skill-preview-header">
        <div className="chat-panel__skill-preview-title">
          {skill?.name || skill?.folderName || '技能说明'}
        </div>
        <div className="chat-panel__skill-preview-actions">
          <button
            type="button"
            className={`chat-panel__skill-preview-add${isInstalled ? ' is-installed' : ''}${addLoading ? ' is-loading' : ''}`}
            onClick={() => {
              if (isInstalled) {
                onUseSkill?.(skill);
                return;
              }
              onAddSkill?.(skill);
            }}
            disabled={isInstalled ? false : addDisabled}
          >
            {!isInstalled && addLoading ? (
              <LoaderCircle className="chat-panel__skill-preview-add-loading" size={14} strokeWidth={2.2} />
            ) : null}
            {actionLabel}
          </button>
          <button
            type="button"
            className="chat-panel__skill-preview-close"
            aria-label="关闭预览"
            onClick={onBack}
          >
            <X size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>
      <div className="chat-panel__skill-preview-body">
        {state.status === 'loading' ? (
          <div className="chat-panel__skill-preview-state">
            <LoaderCircle className="chat-panel__skill-preview-loading" size={18} strokeWidth={2.2} />
            正在加载技能说明
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div className="chat-panel__skill-preview-state chat-panel__skill-preview-state--error">
            {state.error}
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <>
            {skill?.previewVideoUrl ? (
              <div className="chat-panel__skill-preview-video">
                <video
                  className="chat-panel__skill-preview-video-player"
                  src={skill.previewVideoUrl}
                  controls
                  playsInline
                  preload="metadata"
                />
              </div>
            ) : null}
            {state.description ? (
              <section className="chat-panel__skill-preview-section">
                <div className="chat-panel__skill-preview-section-label">技能描述</div>
                <div className="chat-panel__skill-preview-description">{state.description}</div>
              </section>
            ) : null}
            <section className="chat-panel__skill-preview-section">
              <div className="chat-panel__skill-preview-section-label">技能内容</div>
              <div className="chat-panel__skill-preview-markdown">
                <Markdown content={state.content} components={markdownComponents} />
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default React.memo(SkillMarkdownPreview);
