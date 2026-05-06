import React from 'react';
import { ChevronRight, Lightbulb } from 'lucide-react';
import { MessageBlockStatus } from './types';
import Markdown from '../Markdown/Markdown';
import './ThinkingBlock.css';

const ThinkingBlock = ({ block }) => {
  const content = String(block?.content || '').trim();
  const isThinking = block?.status === MessageBlockStatus.STREAMING || block?.status === MessageBlockStatus.PROCESSING;
  const showThinkingPreview = isThinking;
  const [expanded, setExpanded] = React.useState(false);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const LINE_HEIGHT = 14;
  const PREVIEW_LIFT = 8;

  React.useEffect(() => {
    if (!isThinking) return () => {};
    const timer = window.setInterval(() => {
      setElapsedMs((prev) => prev + 100);
    }, 100);
    return () => {
      window.clearInterval(timer);
    };
  }, [isThinking]);

  const seconds = React.useMemo(() => (((elapsedMs < 1000 ? 100 : elapsedMs) / 1000).toFixed(1)), [elapsedMs]);
  const title = isThinking ? `深度思考中（用时 ${seconds} 秒）` : `已深度思考（用时 ${seconds} 秒）`;
  const allPreviewLines = React.useMemo(() => {
    return String(content || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }, [content, isThinking]);
  const previewLines = React.useMemo(() => (
    isThinking ? allPreviewLines.slice(0, -1) : allPreviewLines
  ), [allPreviewLines, isThinking]);
  const previewVisible = showThinkingPreview && !expanded && previewLines.length > 0;
  const containerHeight = React.useMemo(() => {
    if (!previewVisible || previewLines.length < 1) return 38;
    return Math.min(75, Math.max(previewLines.length + 1, 2) * LINE_HEIGHT + 25);
  }, [previewVisible, previewLines.length]);
  const previewHeight = React.useMemo(
    () => Math.max(containerHeight - 30, LINE_HEIGHT),
    [containerHeight]
  );
  const previewOffsetY = React.useMemo(() => {
    const totalLinesHeight = previewLines.length * LINE_HEIGHT;
    return Math.min(0, previewHeight - totalLinesHeight);
  }, [previewHeight, previewLines.length]);
  const previewTrackStyle = React.useMemo(() => {
    if (!previewVisible) return {};
    return {
      transform: `translateY(${previewOffsetY - PREVIEW_LIFT}px)`,
    };
  }, [previewOffsetY, previewVisible, PREVIEW_LIFT]);

  if (!content) return null;

  return (
    <div className="chat-message-block chat-message-block--thinking">
      <button
        type="button"
        className={`chat-thinking-block__header ${expanded ? 'expanded' : ''} ${previewVisible ? 'previewing' : 'no-preview'}`}
        style={{ height: containerHeight }}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={`chat-thinking-block__icon-wrap ${isThinking ? 'thinking' : ''} ${previewVisible ? 'previewing' : 'no-preview'}`}>
          <Lightbulb className="chat-thinking-block__icon" size={previewVisible ? 30 : 20} />
        </span>
        <span className={`chat-thinking-block__text-wrap ${previewVisible ? 'previewing' : 'no-preview'}`}>
          <span className={`chat-thinking-block__title ${!previewVisible ? 'showThinking' : ''}`}>{title}</span>
          {previewVisible ? (
            <span className="chat-thinking-block__preview" style={{ height: previewHeight }}>
              <span className="chat-thinking-block__preview-track" style={previewTrackStyle}>
                {previewLines.map((line, index) => (
                  <span key={`${line}-${index}`} className="chat-thinking-block__preview-line">
                    {line}
                  </span>
                ))}
              </span>
            </span>
          ) : null}
        </span>
        <span className={`chat-thinking-block__arrow ${expanded ? 'expanded' : ''}`}>
          <ChevronRight size={18} />
        </span>
      </button>
      {expanded ? (
        <div className="chat-thinking-block__body">
          <Markdown content={content} />
        </div>
      ) : null}
    </div>
  );
};

export default ThinkingBlock;
