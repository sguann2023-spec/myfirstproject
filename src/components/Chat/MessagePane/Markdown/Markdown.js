import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import CodeBlock from './CodeBlock';
import './Markdown.css';

const normalizeLatexBrackets = (text) => {
  const source = String(text || '');
  // Support \\( inline \\) and \\[ block \\] forms that many models output.
  return source
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, expr) => `\n$$\n${String(expr || '').trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, expr) => `$${String(expr || '').trim()}$`);
};

const Markdown = ({ content }) => {
  const normalizedContent = React.useMemo(() => normalizeLatexBrackets(content), [content]);

  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code: (props) => <CodeBlock {...props} />,
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
};

export default Markdown;
