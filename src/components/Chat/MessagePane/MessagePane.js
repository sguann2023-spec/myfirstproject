import React from 'react';
import './MessagePane.css';
import VectcutClawImage from '../../../../public/vectcut_claw.png';
import MessageGroup from './MessageGroup/MessageGroup';
import { loggerService } from '@logger';
const DEBUG_CHAT_LOADING = false && process.env.NODE_ENV !== 'production';
const logger = loggerService.withContext('ChatLoading/MessagePane');

const MessagePane = ({
  messages,
  sending,
  onCopyAssistantMessage,
  onRetryAssistantMessage,
  onDeleteAssistantMessage,
  messageEndRef,
  onQuickPrompt,
  quickPrompts,
  emptyWelcomeText,
  formatMessageTime,
  model,
  modelOptions,
  formatModelDisplayName,
  userName,
  userAvatar,
}) => {
  const visibleMessages = messages;
  const loadingMessageId = React.useMemo(() => {
    if (!sending || visibleMessages.length === 0) return null;
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      const message = visibleMessages[i];
      const role = message?.role;
      if (role === 'assistant') {
        return message.id;
      }
      if (role === 'user') {
        break;
      }
    }
    return null;
  }, [sending, visibleMessages]);

  const groupedMessages = React.useMemo(() => {
    const groups = [];
    visibleMessages.forEach((message) => {
      const role = message.role === 'user' ? 'user' : 'assistant';
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.role === role) {
        lastGroup.messages.push(message);
      } else {
        groups.push({ role, messages: [message] });
      }
    });
    return groups;
  }, [visibleMessages]);

  React.useEffect(() => {
    if (!DEBUG_CHAT_LOADING) return;
    const tail = visibleMessages.slice(-3).map((item) => ({
      id: item?.id,
      role: item?.role,
      contentLength: String(item?.content || '').length
    }));
    // logger.info({
    //   sending,
    //   visibleCount: visibleMessages.length,
    //   loadingMessageId,
    //   groupedCount: groupedMessages.length,
    //   tail
    // });
  }, [sending, visibleMessages, loadingMessageId, groupedMessages]);

  return (
    <div className="chat-panel__message-pane">
      <div className="chat-panel__messages">
        {visibleMessages.length === 0 ? (
          messages.length === 0 ? (
            <div className="chat-panel__empty chat-panel__empty--image">
              <img className="chat-panel__empty-image" src={VectcutClawImage} alt="开始对话" />
              <div className="chat-panel__empty-welcome" aria-label={emptyWelcomeText}>
                {Array.from(emptyWelcomeText).map((char, index) => (
                  <span
                    key={`${char}-${index}`}
                    className="chat-panel__empty-welcome-char"
                    style={{ animationDelay: `${index * 20}ms` }}
                  >
                    {char}
                  </span>
                ))}
              </div>
              <div className="chat-panel__quick-prompts">
                {quickPrompts.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="chat-panel__quick-prompt"
                    onClick={() => onQuickPrompt(item.prompt)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-panel__empty">没有匹配的消息</div>
          )
        ) : (
          groupedMessages.map((group, index) => (
            <MessageGroup
              key={`group-${group.role}-${group.messages[0]?.id || index}`}
              role={group.role}
              messages={group.messages}
              onCopyAssistantMessage={onCopyAssistantMessage}
              onRetryAssistantMessage={onRetryAssistantMessage}
              onDeleteAssistantMessage={onDeleteAssistantMessage}
              actionsDisabled={sending}
              formatMessageTime={formatMessageTime}
              model={model}
              modelOptions={modelOptions}
              formatModelDisplayName={formatModelDisplayName}
              loadingMessageId={loadingMessageId}
              userName={userName}
              userAvatar={userAvatar}
            />
          ))
        )}
        <div ref={messageEndRef} />
      </div>
    </div>
  );
};

const areMessagesEqual = (prevMessages = [], nextMessages = []) => {
  if (prevMessages === nextMessages) return true;
  if (!Array.isArray(prevMessages) || !Array.isArray(nextMessages)) return false;
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

export default React.memo(MessagePane, (prevProps, nextProps) => (
  areMessagesEqual(prevProps.messages, nextProps.messages)
  && prevProps.sending === nextProps.sending
  && prevProps.onCopyAssistantMessage === nextProps.onCopyAssistantMessage
  && prevProps.onRetryAssistantMessage === nextProps.onRetryAssistantMessage
  && prevProps.onDeleteAssistantMessage === nextProps.onDeleteAssistantMessage
  && prevProps.messageEndRef === nextProps.messageEndRef
  && prevProps.onQuickPrompt === nextProps.onQuickPrompt
  && prevProps.quickPrompts === nextProps.quickPrompts
  && prevProps.emptyWelcomeText === nextProps.emptyWelcomeText
  && prevProps.formatMessageTime === nextProps.formatMessageTime
  && prevProps.model === nextProps.model
  && areModelOptionsEqual(prevProps.modelOptions, nextProps.modelOptions)
  && prevProps.formatModelDisplayName === nextProps.formatModelDisplayName
  && prevProps.userName === nextProps.userName
  && prevProps.userAvatar === nextProps.userAvatar
));
