import React from 'react';
import { Icon, addCollection } from '@iconify/react';
import materialIconThemeIcons from '@iconify-json/material-icon-theme/icons.json';
import { Tooltip, message } from 'antd';
import { Copy, Download } from 'lucide-react';
import CodeViewer from './CodeViewer';
import './CodeBlockView.css';

addCollection(materialIconThemeIcons);

const getLanguageLabel = (language) => {
  const lang = String(language || 'text').toLowerCase();
  const map = {
    js: 'JavaScript',
    javascript: 'JavaScript',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    jsx: 'JSX',
    tsx: 'TSX',
    py: 'Python',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    md: 'Markdown',
    markdown: 'Markdown',
    dockerfile: 'Dockerfile',
    docker: 'Docker',
    plaintext: 'Text',
    txt: 'Text',
    text: 'Text',
    sh: 'Shell',
    shell: 'Bash',
    bash: 'Bash',
    zsh: 'Zsh',
    powershell: 'PowerShell',
    ps1: 'PowerShell',
    sql: 'SQL',
    ini: 'INI',
    c: 'C',
    cpp: 'C++',
  };
  if (map[lang]) return map[lang];
  return lang.charAt(0).toUpperCase() + lang.slice(1);
};

const getLanguageIconName = (language) => {
  const lang = String(language || 'text').toLowerCase();
  const map = {
    javascript: 'javascript',
    js: 'javascript',
    jsx: 'javascript',
    typescript: 'typescript',
    ts: 'typescript',
    tsx: 'typescript',
    python: 'python',
    py: 'python',
    bash: 'console',
    shell: 'console',
    zsh: 'console',
    sh: 'console',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    docker: 'docker',
    dockerfile: 'docker',
    md: 'markdown',
    markdown: 'markdown',
    plaintext: 'document',
    txt: 'document',
    text: 'document',
    powershell: 'powershell',
    ps1: 'powershell',
    ini: 'document',
    sql: 'database',
    html: 'html',
    xml: 'xml',
    css: 'css',
    c: 'c',
    cpp: 'cpp',
    'c++': 'cpp',
    java: 'java',
    go: 'go',
    rust: 'rust',
    text: 'file',
  };
  return map[lang] || 'file';
};

const getDownloadExt = (language) => {
  const lang = String(language || '').toLowerCase();
  const extMap = {
    javascript: 'js',
    js: 'js',
    typescript: 'ts',
    ts: 'ts',
    python: 'py',
    py: 'py',
    c: 'c',
    cpp: 'cpp',
    java: 'java',
    go: 'go',
    rust: 'rs',
    json: 'json',
    yaml: 'yaml',
    yml: 'yml',
    toml: 'toml',
    markdown: 'md',
    md: 'md',
    dockerfile: 'dockerfile',
    docker: 'docker',
    html: 'html',
    xml: 'xml',
    css: 'css',
    sql: 'sql',
    powershell: 'ps1',
    ps1: 'ps1',
    ini: 'ini',
    text: 'txt',
    txt: 'txt',
    plaintext: 'txt',
    bash: 'sh',
    zsh: 'zsh',
    sh: 'sh',
    shell: 'sh',
  };
  return extMap[lang] || 'txt';
};

const downloadCode = (code, language) => {
  const ext = getDownloadExt(language);
  const blob = new Blob([String(code || '')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `code.${ext}`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const CodeBlockView = ({ code, language }) => {
  const lang = String(language || 'text').toLowerCase();
  const label = getLanguageLabel(lang);
  const iconName = getLanguageIconName(lang);
  const sourceCode = String(code || '');
  const handleCopySource = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sourceCode.trimEnd());
      message.success('复制成功');
    } catch (error) {
      message.error('复制失败');
    }
  }, [sourceCode]);

  return (
    <div className="chat-code-block-view">
      <div className="chat-code-block-view__header">
        <div className="chat-code-block-view__title">
          <Icon icon={`material-icon-theme:${iconName}`} className="chat-code-block-view__lang-icon" />
          <span className="chat-code-block-view__lang">{label}</span>
        </div>
        <div className="chat-code-block-view__tools">
          <Tooltip title="复制源代码" mouseEnterDelay={0.5} mouseLeaveDelay={0}>
            <button
              type="button"
              className="chat-code-block-view__tool-btn"
              aria-label="复制源代码"
              onClick={handleCopySource}
            >
              <Copy className="tool-icon" />
            </button>
          </Tooltip>
          <Tooltip title="下载源代码" mouseEnterDelay={0.5} mouseLeaveDelay={0}>
            <button
              type="button"
              className="chat-code-block-view__tool-btn"
              aria-label="下载源代码"
              onClick={() => downloadCode(sourceCode, lang)}
            >
              <Download className="tool-icon" />
            </button>
          </Tooltip>
        </div>
      </div>
      <CodeViewer code={sourceCode} language={lang || 'text'} />
    </div>
  );
};

export default React.memo(CodeBlockView, (prevProps, nextProps) => (
  prevProps.code === nextProps.code && prevProps.language === nextProps.language
));
