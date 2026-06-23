import React from 'react';
import { Check, Copy, RefreshCw, Trash2 } from 'lucide-react';
import { Tooltip, message as antMessage } from 'antd';
import './MessageItem.css';
import MessageContent from '../MessageContent/MessageContent';
import MessageHeader from '../MessageHeader/MessageHeader';
import MessageTokens from '../../../../renderer/src/pages/home/Messages/MessageTokens';
import { buildErrorSignature } from '../../../../shared/chatError';
import { loggerService } from '@logger';
const DEBUG_CHAT_LOADING = false && process.env.NODE_ENV !== 'production';
const logger = loggerService.withContext('ChatLoading/MessageItem');

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

const buildUsageSignature = (usage = null) => JSON.stringify({
  total_tokens: Number(usage?.total_tokens || 0),
  prompt_tokens: Number(usage?.prompt_tokens || 0),
  completion_tokens: Number(usage?.completion_tokens || 0),
  cost: Number(usage?.cost || 0)
});

const buildMetricsSignature = (metrics = null) => JSON.stringify({
  completion_tokens: Number(metrics?.completion_tokens || 0),
  time_completion_millsec: Number(metrics?.time_completion_millsec || 0),
  time_first_token_millsec: Number(metrics?.time_first_token_millsec || 0)
});

const MessageItem = ({
  message,
  role,
  onCopyAssistantMessage,
  onRetryAssistantMessage,
  onDeleteAssistantMessage,
  actionsDisabled = false,
  formatMessageTime,
  model,
  modelOptions,
  formatModelDisplayName,
  isLoading = false,
  userName,
  userAvatar,
}) => {
  const isAssistant = role === 'assistant';
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!DEBUG_CHAT_LOADING || !isAssistant) return;
    // logger.info({
    //   role,
    //   messageId: message?.id || '',
    //   isLoading,
    //   contentLength: String(message?.content || '').length,
    //   hasError: Boolean(message?.error)
    // });
  }, [isAssistant, role, message, isLoading]);

  const handleCopy = async (event) => {
    event.stopPropagation();
    if (!onCopyAssistantMessage) return;
    try {
      await onCopyAssistantMessage(message);
      antMessage.success('已复制');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      antMessage.error('复制失败');
    }
  };

  return (
    <div className={`chat-panel__message ${role}`}>
      <MessageHeader
        role={role}
        message={message}
        model={model}
        modelOptions={modelOptions}
        formatModelDisplayName={formatModelDisplayName}
        formatMessageTime={formatMessageTime}
        userName={userName}
        userAvatar={userAvatar}
      />
      <div className={`chat-panel__message-body ${isAssistant ? 'assistant' : 'user'}`}>
        <MessageContent message={message} isLoading={isLoading} />
        {isAssistant && !isLoading && (
          <div className="chat-panel__message-actions">
            <Tooltip title="复制" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
              <button
                type="button"
                className="chat-panel__message-action-btn"
                onClick={handleCopy}
                disabled={actionsDisabled}>
                {copied ? <Check size={15} className="chat-panel__message-action-icon copied" /> : <Copy size={15} className="chat-panel__message-action-icon" />}
              </button>
            </Tooltip>
            <Tooltip title="重试" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
              <button
                type="button"
                className="chat-panel__message-action-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onRetryAssistantMessage && onRetryAssistantMessage(message);
                }}
                disabled={actionsDisabled}>
                <RefreshCw size={15} className="chat-panel__message-action-icon" />
              </button>
            </Tooltip>
            <Tooltip title="删除" mouseEnterDelay={1} styles={{ body: { fontSize: 12 } }}>
              <button
                type="button"
                className="chat-panel__message-action-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteAssistantMessage && onDeleteAssistantMessage(message);
                }}
                disabled={actionsDisabled}>
                <Trash2 size={15} className="chat-panel__message-action-icon" />
              </button>
            </Tooltip>
            {message?.usage ? (
              <div className="chat-panel__message-tokens">
                <MessageTokens message={message} />
              </div>
            ) : null}
          </div>
        )}
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

export default React.memo(MessageItem, (prevProps, nextProps) => {
  const prevMessage = prevProps.message || {};
  const nextMessage = nextProps.message || {};
  const prevError = buildErrorSignature(prevMessage.error);
  const nextError = buildErrorSignature(nextMessage.error);
  const prevUsage = buildUsageSignature(prevMessage.usage);
  const nextUsage = buildUsageSignature(nextMessage.usage);
  const prevMetrics = buildMetricsSignature(prevMessage.metrics);
  const nextMetrics = buildMetricsSignature(nextMessage.metrics);
  return (
    prevProps.role === nextProps.role
    && prevProps.onCopyAssistantMessage === nextProps.onCopyAssistantMessage
    && prevProps.onRetryAssistantMessage === nextProps.onRetryAssistantMessage
    && prevProps.onDeleteAssistantMessage === nextProps.onDeleteAssistantMessage
    && prevProps.actionsDisabled === nextProps.actionsDisabled
    && prevProps.isLoading === nextProps.isLoading
    && prevProps.model === nextProps.model
    && areModelOptionsEqual(prevProps.modelOptions, nextProps.modelOptions)
    && prevProps.formatMessageTime === nextProps.formatMessageTime
    && prevProps.formatModelDisplayName === nextProps.formatModelDisplayName
    && prevProps.userName === nextProps.userName
    && prevProps.userAvatar === nextProps.userAvatar
    && prevMessage.id === nextMessage.id
    && prevMessage.content === nextMessage.content
    && prevMessage.role === nextMessage.role
    && prevMessage.createdAt === nextMessage.createdAt
    && prevMessage.updatedAt === nextMessage.updatedAt
    && prevUsage === nextUsage
    && prevMetrics === nextMetrics
    && buildImageAttachmentSignature(prevMessage.imageAttachments) === buildImageAttachmentSignature(nextMessage.imageAttachments)
    && prevError === nextError
  );
});
