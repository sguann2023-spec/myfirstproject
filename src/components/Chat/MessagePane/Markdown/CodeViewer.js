import React from 'react';
import { createHighlighter } from 'shiki';
import './CodeViewer.css';

let highlighterPromise = null;
const htmlCache = new Map();

const getShikiHighlighter = () => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['one-light'],
      langs: ['javascript', 'typescript', 'python', 'bash', 'json', 'html', 'css', 'c', 'cpp', 'go', 'rust', 'java', 'text'],
    });
  }
  return highlighterPromise;
};

const CodeViewer = ({ code, language }) => {
  const cacheKey = React.useMemo(() => `${String(language || 'text').toLowerCase()}::${String(code || '')}`, [code, language]);
  const [html, setHtml] = React.useState(() => htmlCache.get(cacheKey) || '');
  const escapedCode = React.useMemo(
    () => String(code || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    [code]
  );

  React.useEffect(() => {
    let cancelled = false;
    if (!code) {
      setHtml('');
      return;
    }
    const cached = htmlCache.get(cacheKey);
    if (cached) {
      setHtml(cached);
      return;
    }
    getShikiHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        const lang = (language || 'text').toLowerCase();
        const safeLang = highlighter.getLoadedLanguages().includes(lang) ? lang : 'text';
        const result = highlighter.codeToHtml(code, { lang: safeLang, theme: 'one-light' });
        htmlCache.set(cacheKey, result);
        setHtml(result);
      })
      .catch(() => {
        if (!cancelled) {
          setHtml('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, language]);

  if (!code) {
    return null;
  }

  return (
    <div
      className="chat-code-viewer"
      dangerouslySetInnerHTML={{ __html: html || `<pre class="shiki"><code>${escapedCode}</code></pre>` }}
    />
  );
};

export default CodeViewer;
