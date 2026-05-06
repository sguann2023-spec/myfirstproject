import React from 'react';
import CodeBlockView from './CodeBlockView';
import './CodeBlock.css';

const CodeBlock = ({ inline, className, children, ...props }) => {
  const code = String(children || '').replace(/\n$/, '');
  if (inline) {
    return <code className={className} {...props}>{children}</code>;
  }

  const languageMatch = /language-([\w-+]+)/.exec(className || '');
  const isMultiline = code.includes('\n');
  const language = languageMatch?.[1] ?? (isMultiline ? 'text' : null);

  if (language !== null) {
    return <CodeBlockView code={code} language={language} />;
  }

  return (
    <code className={className} style={{ textWrap: 'wrap', fontSize: '95%', padding: '2px 4px' }} {...props}>
      {children}
    </code>
  );
};

export default CodeBlock;
