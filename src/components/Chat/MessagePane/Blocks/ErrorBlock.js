import React from 'react';
import { AlertTriangle } from 'lucide-react';

const ErrorBlock = ({ block }) => {
  const title = String(block?.error?.title || block?.content || '请求失败');
  const message = String(block?.error?.message || '');
  const detail = String(block?.error?.detail || '');
  const description = message || detail || '未知错误';

  return (
    <div className="chat-message-block chat-message-block--error">
      <div className="chat-error-block__header">
        <span className="chat-error-block__icon">
          <AlertTriangle size={16} />
        </span>
        <span className="chat-error-block__title">{title}</span>
      </div>
      <div className="chat-error-block__message">{description}</div>
    </div>
  );
};

export default ErrorBlock;
