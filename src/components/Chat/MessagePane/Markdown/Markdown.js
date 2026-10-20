import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { ChatTaskContext } from '../../ChatShell/ChatTaskContext';
import CodeBlock from './CodeBlock';
import './Markdown.css';

const normalizeLatexBrackets = (text) => {
  const source = String(text || '');
  // Support \\( inline \\) and \\[ block \\] forms that many models output.
  return source
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, expr) => `\n$$\n${String(expr || '').trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, expr) => `$${String(expr || '').trim()}$`);
};

const Markdown = ({ content, components }) => {
  const { openWebUrl } = React.useContext(ChatTaskContext);
  const normalizedContent = React.useMemo(() => normalizeLatexBrackets(content), [content]);
  const Link = React.useCallback(({ href, children, node: _node, ...props }) => {
    const normalizedHref = String(href || '').trim();
    const isHashUrl = normalizedHref.startsWith('#');
    const isWebUrl = (() => {
      try {
        const protocol = new URL(normalizedHref).protocol;
        return protocol === 'http:' || protocol === 'https:';
      } catch (_error) {
        return false;
      }
    })();

    return (
      <a
        {...props}
        href={normalizedHref || undefined}
        target={isWebUrl ? undefined : '_blank'}
        rel="noreferrer"
        onClick={(event) => {
          if (isHashUrl) {
            event.stopPropagation();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (isWebUrl && typeof openWebUrl === 'function') {
            openWebUrl(normalizedHref, props.title || '');
            return;
          }
          if (normalizedHref) {
            window.open(normalizedHref, '_blank', 'noopener,noreferrer');
          }
        }}>
        {children}
      </a>
    );
  }, [openWebUrl]);
  const mergedComponents = React.useMemo(() => ({
    a: Link,
    code: (props) => <CodeBlock {...props} />,
    pre: ({ children }) => <>{children}</>,
    ...(components || {})
  }), [Link, components]);

  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={mergedComponents}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
};

export default Markdown;
