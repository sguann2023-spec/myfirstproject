import React from 'react';
import './MessageHeader.css';

const getModelMeta = (model, modelOptions) => {
  const options = Array.isArray(modelOptions) ? modelOptions : [];
  const matched = options.find((item) => {
    if (typeof item === 'string') return item === model;
    const value = item?.value || item?.name || item?.id;
    return value === model;
  });

  if (!matched || typeof matched === 'string') {
    return { name: model || '助手', icon: '' };
  }

  return {
    name: matched?.label || matched?.name || matched?.value || matched?.id || model || '助手',
    icon: matched?.icon || matched?.iconUrl || matched?.black_icon || '',
  };
};

const MessageHeader = ({
  role,
  message,
  model,
  modelOptions,
  formatModelDisplayName,
  formatMessageTime,
  userName,
  userAvatar,
}) => {
  const isAssistant = role === 'assistant';
  const messageModel = String(
    message?.model
    || message?.modelId
    || message?.model_id
    || message?.modelName
    || ''
  ).trim();
  const modelMeta = getModelMeta(messageModel || (isAssistant ? '' : model), modelOptions);
  const displayModelName = formatModelDisplayName ? formatModelDisplayName(modelMeta.name) : modelMeta.name;
  const displayName = isAssistant ? displayModelName : (String(userName || '').trim() || '用户');
  const userAvatarSrc = String(userAvatar || '').trim();

  return (
    <div className="chat-message-header">
      <div className="chat-message-header__avatar-wrap">
        {isAssistant && modelMeta.icon ? (
          <img className="chat-message-header__avatar" src={modelMeta.icon} alt={displayName} />
        ) : !isAssistant && userAvatarSrc ? (
          <img className="chat-message-header__avatar" src={userAvatarSrc} alt={displayName} />
        ) : (
          <div className={`chat-message-header__avatar chat-message-header__avatar--${isAssistant ? 'assistant' : 'user'}`}>
            {isAssistant ? 'AI' : '用户'}
          </div>
        )}
      </div>
      <div className="chat-message-header__meta">
        <div className={`chat-message-header__name-row chat-message-header__name-row--${isAssistant ? 'assistant' : 'user'}`}>
          {isAssistant ? (
            <>
              <div className="chat-message-header__title">{displayName}</div>
              <div className="chat-message-header__time">{formatMessageTime(message?.updatedAt || message?.createdAt)}</div>
            </>
          ) : (
            <>
              <div className="chat-message-header__time">{formatMessageTime(message?.updatedAt || message?.createdAt)}</div>
              <div className="chat-message-header__title">{displayName}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const areModelOptionsEqual = (prevOptions = [], nextOptions = []) => {
  if (prevOptions === nextOptions) return true;
  if (!Array.isArray(prevOptions) || !Array.isArray(nextOptions)) return false;
  if (prevOptions.length !== nextOptions.length) return false;
  for (let i = 0; i < prevOptions.length; i += 1) {
    const prev = prevOptions[i];
    const next = nextOptions[i];
    if (typeof prev !== typeof next) return false;
    if (typeof prev === 'string') {
      if (prev !== next) return false;
      continue;
    }
    const prevValue = prev?.value || prev?.name || prev?.id || '';
    const nextValue = next?.value || next?.name || next?.id || '';
    const prevLabel = prev?.label || prev?.name || prev?.value || prev?.id || '';
    const nextLabel = next?.label || next?.name || next?.value || next?.id || '';
    const prevIcon = prev?.icon || prev?.iconUrl || prev?.black_icon || '';
    const nextIcon = next?.icon || next?.iconUrl || next?.black_icon || '';
    if (prevValue !== nextValue || prevLabel !== nextLabel || prevIcon !== nextIcon) {
      return false;
    }
  }
  return true;
};

export default React.memo(MessageHeader, (prevProps, nextProps) => {
  const prevMessage = prevProps.message || {};
  const nextMessage = nextProps.message || {};
  return (
    prevProps.role === nextProps.role
    && areModelOptionsEqual(prevProps.modelOptions, nextProps.modelOptions)
    && prevProps.formatModelDisplayName === nextProps.formatModelDisplayName
    && prevProps.formatMessageTime === nextProps.formatMessageTime
    && prevProps.userName === nextProps.userName
    && prevProps.userAvatar === nextProps.userAvatar
    && prevMessage.createdAt === nextMessage.createdAt
    && prevMessage.updatedAt === nextMessage.updatedAt
    && prevMessage.model === nextMessage.model
    && prevMessage.modelId === nextMessage.modelId
    && prevMessage.model_id === nextMessage.model_id
    && prevMessage.modelName === nextMessage.modelName
  );
});
