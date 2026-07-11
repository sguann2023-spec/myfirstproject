import React from 'react';
import { Plus, X } from 'lucide-react';
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
  const getLastUserMessageTime = (session) => {
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.role === 'user') {
        return Number(message?.createdAt) || new Date(message?.createdAt).getTime() || 0;
      }
    }
    return Number(session?.updatedAt) || new Date(session?.updatedAt).getTime() || 0;
  };

  const sortedSessions = [...sessions].sort((a, b) => {
    const timeA = getLastUserMessageTime(a);
    const timeB = getLastUserMessageTime(b);
    return timeB - timeA;
  });

  return (
    <div className={`chat-history-list ${visible ? 'is-visible' : 'is-hidden'}`}>
      <div className="chat-history-list__header">
        <div className="chat-history-list__title">会话历史</div>
        {/* <button
          type="button"
          className="chat-history-list__new-btn"
          aria-label="新建会话"
          onClick={() => onCreateSession && onCreateSession()}
        >
          <Plus size={14} strokeWidth={2} />
        </button> */}
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
                  <span className="chat-history-list__status-slot">
                    {session.isPending && (
                      <span
                        className={`chat-history-list__status-dot is-pending ${isActive ? 'is-active-session' : ''}`}
                        aria-label="对话中"
                      />
                    )}
                    {session.isFulfilled && !session.isPending && !isActive && (
                      <span className="chat-history-list__status-dot is-fulfilled" aria-label="已完成" />
                    )}
                  </span>
                  <div className="chat-history-list__item-title">
                    {session.title || '新对话'}
                  </div>
                  
                  <button
                    type="button"
                    className="chat-history-list__delete-btn"
                    aria-label="删除会话"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteSession && onDeleteSession(session.id);
                    }}
                  >
                    <X size={14} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ChatHistoryList;
