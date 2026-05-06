import React from 'react';
import './MessageToolbar.css';

const MessageToolbar = ({
  keyword,
  includeUser,
  onKeywordChange,
  onIncludeUserChange,
  totalCount,
  visibleCount,
}) => (
  <div className="chat-panel__message-toolbar">
    <input
      className="chat-panel__message-search"
      type="text"
      value={keyword}
      placeholder="搜索当前会话消息"
      onChange={(event) => onKeywordChange(event.target.value)}
    />
    <label className="chat-panel__message-filter">
      <input
        type="checkbox"
        checked={includeUser}
        onChange={(event) => onIncludeUserChange(event.target.checked)}
      />
      <span>包含用户消息</span>
    </label>
    <span className="chat-panel__message-count">{visibleCount}/{totalCount}</span>
  </div>
);

export default MessageToolbar;
