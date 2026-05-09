import React from 'react';
import './ChatHistoryList.css';

const formatSessionTime = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (error) {
    return '';
  }
};

const getPreviewText = (session) => {
  const list = Array.isArray(session?.messages) ? session.messages : [];
  const last = list[list.length - 1];
  const text = String(last?.content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '暂无消息';
  return text.length > 26 ? `${text.slice(0, 26)}...` : text;
};

const ChatHistoryList = ({
  sessions = [],
  activeSessionId,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  visible = true,
}) => {
  const sortedSessions = [...sessions].sort((a, b) => {
    const timeA = new Date(a?.updatedAt).getTime() || 0;
    const timeB = new Date(b?.updatedAt).getTime() || 0;
    return timeB - timeA;
  });

  return (
    <div className={`chat-history-list ${visible ? 'is-visible' : 'is-hidden'}`}>
      <div className="chat-history-list__header">
        <div className="chat-history-list__title">会话历史</div>
        <button
          type="button"
          className="chat-history-list__new-btn"
          onClick={() => onCreateSession && onCreateSession()}
        >
          新建
        </button>
      </div>

      <div className="chat-history-list__body">
        {sortedSessions.length === 0 ? (
          <div className="chat-history-list__empty">暂无会话记录</div>
        ) : (
          sortedSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                className={`chat-history-list__item ${isActive ? 'active' : ''}`}
                onClick={() => onSelectSession && onSelectSession(session.id)}
              >
                <div className="chat-history-list__item-top">
                  <div className="chat-history-list__item-title">
                    {session.title || '新对话'}
                  </div>
                  <div className="chat-history-list__item-time">{formatSessionTime(session.updatedAt)}</div>
                </div>
                <div className="chat-history-list__item-preview">{getPreviewText(session)}</div>
                <button
                  type="button"
                  className="chat-history-list__delete-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteSession && onDeleteSession(session.id);
                  }}
                >
                  删除
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ChatHistoryList;
