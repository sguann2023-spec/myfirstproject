import React from 'react';
import './MessageNavigation.css';

const MessageNavigation = ({ containerRef }) => {
  const handleScrollToTop = () => {
    const container = containerRef.current;
    if (container) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleScrollToBottom = () => {
    const container = containerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  };

  return (
    <div className="chat-panel__message-nav">
      <button
        type="button"
        className="chat-panel__message-nav-btn"
        onClick={handleScrollToTop}
      >
        顶部
      </button>
      <button
        type="button"
        className="chat-panel__message-nav-btn"
        onClick={handleScrollToBottom}
      >
        底部
      </button>
    </div>
  );
};

export default MessageNavigation;
