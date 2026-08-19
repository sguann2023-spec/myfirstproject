import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHighlighter } from 'shiki';
import { Plus, X } from 'lucide-react';
import { Button, Input, Popover } from 'antd';
import './TextFilePreview.css';

const PREVIEW_THEME = 'one-light';
const PREVIEW_LANGUAGES = [
  'javascript', 'typescript', 'python', 'bash', 'json', 'html', 'css', 'c', 'cpp', 'go',
  'rust', 'java', 'php', 'sql', 'xml', 'yaml', 'markdown', 'text'
];

let previewHighlighterPromise = null;
const codeHtmlCache = new Map();
const LINE_ACTION_ICON_MARKUP = renderToStaticMarkup(
  <Plus className="chat-file-preview__line-action-icon" size={12} strokeWidth={2.6} />
);
const COMMENT_POPOVER_OFFSET_X = 0;
const COMMENT_POPOVER_OFFSET_Y = 0;

const getPreviewHighlighter = () => {
  if (!previewHighlighterPromise) {
    previewHighlighterPromise = createHighlighter({
      themes: [PREVIEW_THEME],
      langs: PREVIEW_LANGUAGES,
    });
  }
  return previewHighlighterPromise;
};

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const getLineCount = (content) => Math.max(String(content || '').split('\n').length, 1);

const buildPlainPreviewHtml = (content) => {
  const lines = String(content || '').split('\n');
  return `
    <pre class="shiki chat-file-preview__code-block">
      <code>
        ${lines.map((line) => `<span class="line">${escapeHtml(line)}</span>`).join('')}
      </code>
    </pre>
  `;
};

const decorateCodeHtml = (html, lineCount) => {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const pre = doc.querySelector('pre');
  const code = doc.querySelector('code');

  if (!pre || !code) {
    return html;
  }

  const codeLines = Array.from(code.children).filter((node) => node.classList?.contains('line'));
  const digits = Math.max(String(Math.max(lineCount, 1)).length, 1);
  const rows = doc.createElement('span');
  rows.className = 'chat-file-preview__code-rows';
  rows.style.setProperty('--preview-line-digits', `${digits}`);

  if (codeLines.length === 0) {
    const row = doc.createElement('span');
    row.className = 'chat-file-preview__code-row';
    row.append(createGutterNode(doc, 1));

    const emptyLine = doc.createElement('span');
    emptyLine.className = 'line chat-file-preview__code-line';
    row.append(emptyLine);
    rows.append(row);
  } else {
    codeLines.forEach((lineNode, index) => {
      const row = doc.createElement('span');
      row.className = 'chat-file-preview__code-row';
      row.append(createGutterNode(doc, index + 1));

      const nextLine = lineNode.cloneNode(true);
      nextLine.classList.add('chat-file-preview__code-line');
      row.append(nextLine);
      rows.append(row);
    });
  }

  code.replaceChildren(rows);
  pre.classList.add('chat-file-preview__code-block');
  pre.style.background = 'transparent';

  return pre.outerHTML;
};

const createGutterNode = (doc, lineNumber) => {
  const gutter = doc.createElement('span');
  gutter.className = 'chat-file-preview__gutter';

  const action = doc.createElement('button');
  action.type = 'button';
  action.className = 'chat-file-preview__line-action';
  action.setAttribute('data-line-number', String(lineNumber));
  action.setAttribute('aria-label', `对第 ${lineNumber} 行添加评论`);
  action.innerHTML = LINE_ACTION_ICON_MARKUP;

  const number = doc.createElement('span');
  number.className = 'chat-file-preview__line-number';
  number.textContent = String(lineNumber);

  gutter.append(action, number);
  return gutter;
};

const getCodePreviewHtml = async (content, language) => {
  const normalizedLanguage = String(language || 'text').toLowerCase() || 'text';
  const source = String(content || '');
  const cacheKey = `${normalizedLanguage}::${source}`;
  if (codeHtmlCache.has(cacheKey)) {
    return codeHtmlCache.get(cacheKey);
  }

  const lineCount = getLineCount(source);
  let html = buildPlainPreviewHtml(source);

  if (source) {
    try {
      const highlighter = await getPreviewHighlighter();
      const loadedLanguages = highlighter.getLoadedLanguages().map((item) => String(item).toLowerCase());
      const safeLanguage = loadedLanguages.includes(normalizedLanguage) ? normalizedLanguage : 'text';
      html = highlighter.codeToHtml(source, { lang: safeLanguage, theme: PREVIEW_THEME });
    } catch (_error) {
      html = buildPlainPreviewHtml(source);
    }
  }

  const decorated = decorateCodeHtml(html, lineCount);
  codeHtmlCache.set(cacheKey, decorated);
  return decorated;
};

const CodePreview = ({ content, language }) => {
  const cacheKey = React.useMemo(() => `${String(language || 'text').toLowerCase()}::${String(content || '')}`, [content, language]);
  const [html, setHtml] = React.useState(() => codeHtmlCache.get(cacheKey) || buildPlainPreviewHtml(content));

  React.useEffect(() => {
    let cancelled = false;
    setHtml(codeHtmlCache.get(cacheKey) || buildPlainPreviewHtml(content));

    getCodePreviewHtml(content, language).then((nextHtml) => {
      if (!cancelled) {
        setHtml(nextHtml);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [content, language]);

  return (
    <div
      className="chat-file-preview__code"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

const getKindLabel = (kind) => {
  if (kind === 'image') return 'Image';
  if (kind === 'video') return 'Video';
  if (kind === 'audio') return 'Audio';
  if (kind === 'markdown') return 'Markdown';
  if (kind === 'code') return 'Code';
  if (kind === 'unsupported') return 'File';
  return 'Text';
};

const TextFilePreview = ({
  preview,
  currentModelMeta = null,
  onClose,
  onSaveEdit,
  onSubmitComment,
  submittingComment = false
}) => {
  if (!preview) return null;

  const {
    name = '',
    path = '',
    kind = 'text',
    language = 'text',
    status = 'idle',
    src = '',
    content = '',
    error = ''
  } = preview;

  const isLoading = status === 'loading';
  const isError = status === 'error';
  const isUnsupported = status === 'unsupported' || kind === 'unsupported';
  const isMediaPreview = kind === 'image' || kind === 'video' || kind === 'audio';
  const supportsContentPreview = !isLoading && !isError && !isUnsupported;
  const supportsEditing = supportsContentPreview && !isMediaPreview && Boolean(path);
  const modelIcon = String(currentModelMeta?.icon || '').trim();
  const modelName = String(currentModelMeta?.name || '').trim();
  const modelFallback = (modelName || 'M').charAt(0).toUpperCase();
  const bodyRef = React.useRef(null);
  const [commentDraft, setCommentDraft] = React.useState('');
  const [editDraft, setEditDraft] = React.useState(() => String(content || ''));
  const [isEditing, setIsEditing] = React.useState(false);
  const [savingEdit, setSavingEdit] = React.useState(false);
  const supportsLineComments = supportsContentPreview && !isMediaPreview && !isEditing;
  const [commentPopover, setCommentPopover] = React.useState({
    open: false,
    lineNumber: null,
    top: 0,
    left: 0,
    height: 1
  });
  const canSubmitComment = Boolean(String(commentDraft || '').trim());
  const canSaveEdit = supportsEditing && isEditing && !savingEdit && editDraft !== String(content || '');

  React.useEffect(() => {
    setEditDraft(String(content || ''));
    setIsEditing(false);
    setSavingEdit(false);
    setCommentDraft('');
    setCommentPopover({ open: false, lineNumber: null, top: 0, left: 0, height: 1 });
  }, [content, path]);

  const closeCommentPopover = React.useCallback(() => {
    setCommentPopover((prev) => ({ ...prev, open: false }));
  }, []);

  const handleStartEdit = React.useCallback(() => {
    if (!supportsEditing) return;
    setEditDraft(String(content || ''));
    setIsEditing(true);
    setCommentPopover({ open: false, lineNumber: null, top: 0, left: 0, height: 1 });
  }, [content, supportsEditing]);

  const handleCancelEdit = React.useCallback(() => {
    setEditDraft(String(content || ''));
    setIsEditing(false);
    setSavingEdit(false);
  }, [content]);

  const handleSaveEdit = React.useCallback(async () => {
    if (!canSaveEdit || typeof onSaveEdit !== 'function') return;

    setSavingEdit(true);
    const result = await onSaveEdit({
      fileName: name,
      filePath: path,
      content: editDraft
    });
    if (result !== false) {
      setIsEditing(false);
    }
    setSavingEdit(false);
  }, [canSaveEdit, editDraft, name, onSaveEdit, path]);

  const handleSubmitComment = React.useCallback(async () => {
    const comment = String(commentDraft || '').trim();
    const lineNumber = Number(commentPopover.lineNumber || 0);
    if (!comment || !lineNumber || typeof onSubmitComment !== 'function') return;

    const result = await onSubmitComment({
      fileName: name,
      filePath: path,
      lineNumber,
      comment
    });
    if (result === false) return;

    setCommentDraft('');
    setCommentPopover((prev) => ({ ...prev, open: false }));
  }, [commentDraft, commentPopover.lineNumber, name, onSubmitComment, path]);

  const handlePreviewBodyClick = React.useCallback((event) => {
    const trigger = event.target?.closest?.('.chat-file-preview__line-action');
    if (!trigger || !bodyRef.current) return;

    const lineNumber = Number(trigger.getAttribute('data-line-number') || 0);
    if (!lineNumber) return;

    const bodyRect = bodyRef.current.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const scrollTop = bodyRef.current.scrollTop || 0;
    const scrollLeft = bodyRef.current.scrollLeft || 0;

    setCommentPopover({
      open: true,
      lineNumber,
      top: triggerRect.bottom - bodyRect.top + scrollTop + COMMENT_POPOVER_OFFSET_Y,
      left: triggerRect.right - bodyRect.left + scrollLeft + COMMENT_POPOVER_OFFSET_X,
      height: 1
    });
  }, []);

  const commentPopoverContent = (
    <div className="chat-file-preview__comment-popover">
      <div className="chat-file-preview__comment-header">
        <div className="chat-file-preview__comment-title-wrap">
          <span className="chat-file-preview__comment-model-avatar" aria-hidden="true">
            {modelIcon ? (
              <img className="chat-file-preview__comment-model-avatar-image" src={modelIcon} alt="" />
            ) : (
              <span className="chat-file-preview__comment-model-avatar-fallback">{modelFallback}</span>
            )}
          </span>
          <div className="chat-file-preview__comment-title">评论</div>
        </div>
        <div className="chat-file-preview__comment-subtitle">
          {commentPopover.lineNumber ? `对第 ${commentPopover.lineNumber} 行评论` : '评论'}
        </div>
      </div>
      <Input.TextArea
        value={commentDraft}
        onChange={(event) => setCommentDraft(event.target.value)}
        autoSize={{ minRows: 4, maxRows: 6 }}
        placeholder="想要怎么修改？"
        className="chat-file-preview__comment-input"
      />
      <div className="chat-file-preview__comment-actions">
        <Button autoInsertSpace={false} type="text" className="chat-file-preview__comment-btn" onClick={closeCommentPopover}>
          取消
        </Button>
        <Button
          autoInsertSpace={false}
          type="primary"
          className="chat-file-preview__comment-btn chat-file-preview__comment-btn--primary"
          disabled={!canSubmitComment || submittingComment}
          onClick={() => {
            void handleSubmitComment();
          }}>
           评论
        </Button>
      </div>
    </div>
  );

  return (
    <div className="chat-file-preview">
      <div className="chat-file-preview__header">
        <div className="chat-file-preview__meta">
          <div className="chat-file-preview__name" title={name}>{name}</div>
          <div className="chat-file-preview__subline" title={path}>
            <span className="chat-file-preview__kind">{getKindLabel(kind)}</span>
            <span className="chat-file-preview__path">{path}</span>
          </div>
        </div>
        <div className="chat-file-preview__header-actions">
          {supportsEditing && !isEditing && (
            <Button
              autoInsertSpace={false}
              type="text"
              className="chat-file-preview__toolbar-btn"
              onClick={handleStartEdit}>
              编辑
            </Button>
          )}
          {supportsEditing && isEditing && (
            <>
              <Button
                autoInsertSpace={false}
                type="text"
                className="chat-file-preview__toolbar-btn"
                disabled={savingEdit}
                onClick={handleCancelEdit}>
                取消
              </Button>
              <Button
                autoInsertSpace={false}
                type="primary"
                className="chat-file-preview__toolbar-btn chat-file-preview__toolbar-btn--primary"
                disabled={!canSaveEdit}
                loading={savingEdit}
                onClick={() => {
                  void handleSaveEdit();
                }}>
                保存
              </Button>
            </>
          )}
        </div>
        <button
          type="button"
          className="chat-file-preview__close"
          onClick={() => onClose?.()}
          aria-label="关闭预览">
          <X size={14} />
        </button>
      </div>

      <div ref={bodyRef} className="chat-file-preview__body" onClick={supportsLineComments ? handlePreviewBodyClick : undefined}>
        {isLoading && <div className="chat-file-preview__state">加载文件中...</div>}
        {isError && !isLoading && <div className="chat-file-preview__state">{error || '读取文件失败'}</div>}
        {isUnsupported && !isLoading && !isError && (
          <div className="chat-file-preview__state chat-file-preview__state--unsupported">
            暂不支持预览该类型文件
          </div>
        )}
        {supportsContentPreview && isEditing && (
          <div className="chat-file-preview__editor-shell">
            <Input.TextArea
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              className="chat-file-preview__editor"
              autoSize={false}
              spellCheck={false}
            />
          </div>
        )}
        {supportsContentPreview && !isEditing && isMediaPreview && (
          <div className={`chat-file-preview__media-shell chat-file-preview__media-shell--${kind}`.trim()}>
            {kind === 'image' && (
              <img
                className="chat-file-preview__media chat-file-preview__media--image"
                src={src}
                alt={name || '图片预览'}
                draggable={false}
              />
            )}
            {kind === 'video' && (
              <video
                className="chat-file-preview__media chat-file-preview__media--video"
                src={src}
                controls
                playsInline
                preload="metadata"
              />
            )}
            {kind === 'audio' && (
              <audio
                className="chat-file-preview__media chat-file-preview__media--audio"
                src={src}
                controls
                preload="metadata"
              />
            )}
          </div>
        )}
        {supportsContentPreview && !isEditing && !isMediaPreview && (
          <CodePreview content={content} language={language} />
        )}
        {supportsLineComments && (
          <Popover
            open={commentPopover.open}
            arrow={false}
            placement="bottomLeft"
            trigger="click"
            content={commentPopoverContent}
            classNames={{ root: 'chat-file-preview__comment-popover-overlay' }}
            getPopupContainer={() => bodyRef.current || document.body}
            onOpenChange={(open) => {
              if (!open) {
                closeCommentPopover();
              }
            }}>
            <span
              className="chat-file-preview__comment-anchor"
              style={{
                top: `${commentPopover.top}px`,
                left: `${commentPopover.left}px`,
                height: `${commentPopover.height}px`
              }}
              aria-hidden="true"
            />
          </Popover>
        )}
      </div>
    </div>
  );
};

export default TextFilePreview;
