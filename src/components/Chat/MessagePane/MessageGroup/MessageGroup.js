import React from 'react';
import MessageItem from '../MessageItem/MessageItem';
import { buildErrorSignature } from '../../../../shared/chatError';
import { loggerService } from '@logger';
import './MessageGroup.css';

const DEBUG_CHAT_LOADING = false && process.env.NODE_ENV !== 'production';
const logger = loggerService.withContext('ChatLoading/MessageGroup');

const buildImageAttachmentSignature = (attachments = []) => JSON.stringify(
  (Array.isArray(attachments) ? attachments : []).map((item) => ({
    uid: String(item?.uid || ''),
    name: String(item?.name || ''),
    url: String(item?.url || ''),
    previewUrl: String(item?.previewUrl || ''),
    thumbnailUrl: String(item?.thumbnailUrl || ''),
    fileType: String(item?.fileType || '')
  }))
);

const MessageGroup = ({
  role,
  messages,
  onCopyAssistantMessage,
  onRetryAssistantMessage,
  onDeleteAssistantMessage,
  actionsDisabled = false,
  formatMessageTime,
  model,
  modelOptions,
  formatModelDisplayName,
  loadingMessageId,
  userName,
  userAvatar,
}) => {
  React.useEffect(() => {
    if (!DEBUG_CHAT_LOADING) return;
    // logger.info({
    //   role,
    //   loadingMessageId,
    //   messageIds: messages.map((item) => item?.id)
    // });
  }, [role, loadingMessageId, messages]);

  return (
    <div className={`chat-panel__message-group chat-panel__message-group--${role}`}>
      {messages.map((message, index) => (
        <MessageItem
          key={message.id || `${role}-${index}`}
          role={role}
          message={message}
          onCopyAssistantMessage={onCopyAssistantMessage}
          onRetryAssistantMessage={onRetryAssistantMessage}
          onDeleteAssistantMessage={onDeleteAssistantMessage}
          actionsDisabled={actionsDisabled}
          formatMessageTime={formatMessageTime}
          model={model}
          modelOptions={modelOptions}
          formatModelDisplayName={formatModelDisplayName}
          isLoading={message.id === loadingMessageId}
          userName={userName}
          userAvatar={userAvatar}
        />
      ))}
    </div>
  );
};

const areMessagesEqual = (prevMessages = [], nextMessages = []) => {
  if (prevMessages === nextMessages) return true;
  if (prevMessages.length !== nextMessages.length) return false;
  for (let i = 0; i < prevMessages.length; i += 1) {
    const prev = prevMessages[i] || {};
    const next = nextMessages[i] || {};
    if (
      prev.id !== next.id
      || prev.role !== next.role
      || prev.content !== next.content
      || prev.createdAt !== next.createdAt
      || prev.updatedAt !== next.updatedAt
      || buildImageAttachmentSignature(prev.imageAttachments) !== buildImageAttachmentSignature(next.imageAttachments)
      || buildErrorSignature(prev.error) !== buildErrorSignature(next.error)
    ) {
      return false;
    }
  }
  return true;
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

export default React.memo(MessageGroup, (prevProps, nextProps) => (
  prevProps.role === nextProps.role
  && areMessagesEqual(prevProps.messages, nextProps.messages)
  && prevProps.onCopyAssistantMessage === nextProps.onCopyAssistantMessage
  && prevProps.onRetryAssistantMessage === nextProps.onRetryAssistantMessage
  && prevProps.onDeleteAssistantMessage === nextProps.onDeleteAssistantMessage
  && prevProps.actionsDisabled === nextProps.actionsDisabled
  && prevProps.loadingMessageId === nextProps.loadingMessageId
  && prevProps.model === nextProps.model
  && areModelOptionsEqual(prevProps.modelOptions, nextProps.modelOptions)
  && prevProps.formatMessageTime === nextProps.formatMessageTime
  && prevProps.formatModelDisplayName === nextProps.formatModelDisplayName
  && prevProps.userName === nextProps.userName
  && prevProps.userAvatar === nextProps.userAvatar
));
