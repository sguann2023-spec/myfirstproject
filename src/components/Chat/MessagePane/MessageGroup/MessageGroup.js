import React from 'react';
import { Provider, useSelector } from 'react-redux';
import appStore from '../../../../renderer/src/store';
import { buildAssistantBlockState } from '../MessageContent/MessageContent';
import { groupConsecutiveTools } from '@renderer/pages/home/Messages/Blocks/toolGrouping';

// This adapter only changes presentation. Never replace persisted messages/blocks.
export const aggregateToolFragments = (messages, state, loadingMessageId) => {
  const resolved = messages.map((message) => {
    const live = state?.messages?.entities?.[message.storeAssistantMessageId];
    const fallback = buildAssistantBlockState({ message, isLoading: false });
    const blocks = live
      ? (live.blocks || []).map(id => state.messageBlocks?.entities?.[id] || { id, type: 'unknown' })
      : fallback.blockIds.map(id => fallback.entities[id]);
    return { original: message, metadata: { ...message, ...live }, blocks, members: [message] };
  });
  const result = [];
  const eligible = (entry) => entry.original.role === 'assistant'
    && !entry.original.error && !entry.original.aborted && !entry.original.digitalHumanRequest
    && !entry.metadata.error && !entry.metadata.aborted
    && !['attachments', 'imageAttachments', 'files'].some(key => entry.original[key]?.length || entry.metadata[key]?.length)
    && entry.blocks.length > 0
    && entry.blocks.every(block => block.type === 'tool' ||
      (['thinking', 'main_text'].includes(block.type) && !String(block.content || '').trim()));
  for (const entry of resolved) {
    const previous = result[result.length - 1];
    const sameContext = previous && ['askId', 'turnId', 'topicId', 'assistantId', 'model', 'modelId', 'groupId']
      .every(key => JSON.stringify(previous.metadata[key] ?? null) === JSON.stringify(entry.metadata[key] ?? null));
    const tools = previous && [...previous.blocks, ...entry.blocks].filter(block => block.type === 'tool');
    const groups = tools && groupConsecutiveTools(tools);
    if (previous && eligible(previous) && eligible(entry) && sameContext
      && groups.length === 1 && Array.isArray(groups[0])) {
      previous.blocks = [...previous.blocks, ...entry.blocks];
      previous.members.push(entry.original);
    } else result.push(entry);
  }
  return result.map(entry => entry.members.length === 1 ? entry.original : {
    ...entry.original,
    // A synthetic view has no live message identity; its blocks have already
    // been resolved from Redux, and the originals remain available to actions.
    storeAssistantMessageId: undefined,
    blocks: entry.blocks,
    presentationMembers: entry.members,
    presentationLoading: entry.members.some(message => message.id === loadingMessageId),
  });
};
import MessageItem from '../MessageItem/MessageItem';
import { buildErrorSignature } from '../../../../shared/chatError';
import './MessageGroup.css';

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

const LiveMessageGroup = ({
  role,
  messages,
  hasConnectedExternalAgent = false,
  onCopyAssistantMessage,
  onRetryAssistantMessage,
  actionsDisabled = false,
  formatMessageTime,
  model,
  modelOptions,
  formatModelDisplayName,
  loadingMessageId,
  userName,
  userAvatar,
}) => {
  const liveMessages = useSelector(state => state?.messages?.entities);
  const liveBlocks = useSelector(state => state?.messageBlocks?.entities);
  const displayedMessages = React.useMemo(() => role === 'assistant'
    ? aggregateToolFragments(messages, { messages: { entities: liveMessages }, messageBlocks: { entities: liveBlocks } }, loadingMessageId)
    : messages, [role, messages, liveMessages, liveBlocks, loadingMessageId]);
  return (
    <div className={`chat-panel__message-group chat-panel__message-group--${role}`}>
      {displayedMessages.map((message, index) => (
        <MessageItem
          key={message.id || `${role}-${index}`}
          role={role}
          message={message}
          hasConnectedExternalAgent={hasConnectedExternalAgent}
          onCopyAssistantMessage={message.presentationMembers && onCopyAssistantMessage
            ? () => onCopyAssistantMessage(message.presentationMembers[0]) : onCopyAssistantMessage}
          onRetryAssistantMessage={message.presentationMembers && onRetryAssistantMessage
            ? () => onRetryAssistantMessage(message.presentationMembers[0]) : onRetryAssistantMessage}
          actionsDisabled={actionsDisabled}
          formatMessageTime={formatMessageTime}
          model={model}
          modelOptions={modelOptions}
          formatModelDisplayName={formatModelDisplayName}
          isLoading={message.presentationLoading || message.id === loadingMessageId}
          userName={userName}
          userAvatar={userAvatar}
        />
      ))}
    </div>
  );
};

const MessageGroup = props => <Provider store={appStore}><LiveMessageGroup {...props} /></Provider>;

const areMessagesEqual = (prevMessages = [], nextMessages = []) => {
  if (prevMessages === nextMessages) return true;
  if (prevMessages.length !== nextMessages.length) return false;
  for (let i = 0; i < prevMessages.length; i += 1) {
    const prev = prevMessages[i] || {};
    const next = nextMessages[i] || {};
    if (
      prev.id !== next.id
      || prev.role !== next.role
      || ['askId', 'turnId', 'topicId', 'assistantId', 'model', 'modelId', 'groupId', 'attachments', 'files'].some(key => prev[key] !== next[key])
      || prev.content !== next.content
      || prev.blocks !== next.blocks
      || prev.aborted !== next.aborted
      || prev.digitalHumanRequest !== next.digitalHumanRequest
      || prev.storeAssistantMessageId !== next.storeAssistantMessageId
      || prev.createdAt !== next.createdAt
      || prev.updatedAt !== next.updatedAt
      || prev.retryStatusText !== next.retryStatusText
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
  && prevProps.hasConnectedExternalAgent === nextProps.hasConnectedExternalAgent
  && prevProps.onCopyAssistantMessage === nextProps.onCopyAssistantMessage
  && prevProps.onRetryAssistantMessage === nextProps.onRetryAssistantMessage
  && prevProps.actionsDisabled === nextProps.actionsDisabled
  && prevProps.loadingMessageId === nextProps.loadingMessageId
  && prevProps.model === nextProps.model
  && areModelOptionsEqual(prevProps.modelOptions, nextProps.modelOptions)
  && prevProps.formatMessageTime === nextProps.formatMessageTime
  && prevProps.formatModelDisplayName === nextProps.formatModelDisplayName
  && prevProps.userName === nextProps.userName
  && prevProps.userAvatar === nextProps.userAvatar
));
