import React from 'react';
import { Image } from 'antd';
import { Provider, useSelector } from 'react-redux';
import '@renderer/assets/styles/index.css';
import MessageBlockRenderer from '@renderer/pages/home/Messages/Blocks';
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage';
import appStore from '../../../../renderer/src/store';
import { upsertManyBlocks } from '../../../../renderer/src/store/messageBlock';
import Markdown from '../Markdown/Markdown';
import './MessageContent.css';

const DEBUG_CHAT_LOADING = false && process.env.NODE_ENV !== 'production';

const getUserImageAttachmentPreviewUrl = (attachment = {}) => (
  String(
    attachment?.previewUrl
    || attachment?.thumbnailUrl
    || attachment?.url
    || ''
  ).trim()
);

const normalizeBlockType = (value) => {
  const type = String(value || '').toLowerCase();
  switch (type) {
    case 'main_text':
      return MessageBlockType.MAIN_TEXT;
    case 'thinking':
      return MessageBlockType.THINKING;
    case 'translation':
      return MessageBlockType.TRANSLATION;
    case 'code':
      return MessageBlockType.CODE;
    case 'image':
      return MessageBlockType.IMAGE;
    case 'tool':
      return MessageBlockType.TOOL;
    case 'file':
      return MessageBlockType.FILE;
    case 'error':
      return MessageBlockType.ERROR;
    case 'citation':
      return MessageBlockType.CITATION;
    case 'video':
      return MessageBlockType.VIDEO;
    case 'compact':
      return MessageBlockType.COMPACT;
    default:
      return MessageBlockType.UNKNOWN;
  }
};

const normalizeBlockStatus = (value, { isLoading = false, blockType = MessageBlockType.UNKNOWN } = {}) => {
  const status = String(value || '').toLowerCase();
  if (!status) {
    if (blockType === MessageBlockType.ERROR) return MessageBlockStatus.ERROR;
    return isLoading ? MessageBlockStatus.STREAMING : MessageBlockStatus.SUCCESS;
  }
  if (status === 'pending') return MessageBlockStatus.PENDING;
  if (status === 'processing') return MessageBlockStatus.PROCESSING;
  if (status === 'streaming' || status === 'running' || status === 'invoking') return MessageBlockStatus.STREAMING;
  if (status === 'error' || status === 'failed') return MessageBlockStatus.ERROR;
  return MessageBlockStatus.SUCCESS;
};

const buildAssistantMessageStatus = ({ message, isLoading, entities, blockIds }) => {
  if (message?.error) return 'error';
  if (isLoading) return 'processing';
  const hasActiveBlock = blockIds.some((id) => {
    const status = entities[id]?.status;
    return (
      status === MessageBlockStatus.PENDING
      || status === MessageBlockStatus.PROCESSING
      || status === MessageBlockStatus.STREAMING
    );
  });
  return hasActiveBlock ? 'processing' : 'success';
};

const buildAssistantBlockState = ({ message, isLoading }) => {
  const messageId = String(message?.id || `assistant-${Date.now()}`);
  const createdAt = new Date().toISOString();
  const sourceBlocks = Array.isArray(message?.blocks) ? message.blocks : [];
  const entities = {};
  const blockIds = [];

  sourceBlocks.forEach((rawBlock, index) => {
    if (!rawBlock || typeof rawBlock !== 'object') return;
    const id = String(rawBlock?.id || `${messageId}-block-${index}`);
    const type = normalizeBlockType(rawBlock?.type);
    entities[id] = {
      ...rawBlock,
      id,
      messageId: String(rawBlock?.messageId || messageId),
      type,
      status: normalizeBlockStatus(rawBlock?.status, {
        isLoading,
        blockType: type
      }),
      createdAt: String(rawBlock?.createdAt || createdAt),
      updatedAt: rawBlock?.updatedAt ? String(rawBlock.updatedAt) : undefined
    };
    blockIds.push(id);
  });

  if (blockIds.length === 0) {
    const content = String(message?.content || '').trim();
    if (content) {
      const mainId = `${messageId}-main`;
      entities[mainId] = {
        id: mainId,
        messageId,
        type: MessageBlockType.MAIN_TEXT,
        status: MessageBlockStatus.SUCCESS,
        content,
        createdAt
      };
      blockIds.push(mainId);
    }
  }

  if (message?.error) {
    const errorId = `${messageId}-error`;
    entities[errorId] = {
      id: errorId,
      messageId,
      type: MessageBlockType.ERROR,
      status: MessageBlockStatus.ERROR,
      error: message.error,
      createdAt
    };
    blockIds.push(errorId);
  }

  if (isLoading) {
    const loadingId = `${messageId}-placeholder`;
    entities[loadingId] = {
      id: loadingId,
      messageId,
      type: MessageBlockType.UNKNOWN,
      status: MessageBlockStatus.PROCESSING,
      createdAt
    };
  }

  return {
    entities,
    blockIds
  };
};

const LiveAssistantMessageContent = ({ fallbackMessage, storeAssistantMessageId, isLoading = false }) => {
  const storeMessage = useSelector((state) => state?.messages?.entities?.[storeAssistantMessageId] || null);
  const fallbackAssistantState = React.useMemo(
    () => buildAssistantBlockState({ message: fallbackMessage, isLoading }),
    [fallbackMessage, isLoading]
  );
  const fallbackAssistantStatus = React.useMemo(
    () => buildAssistantMessageStatus({
      message: fallbackMessage,
      isLoading,
      entities: fallbackAssistantState.entities,
      blockIds: fallbackAssistantState.blockIds
    }),
    [fallbackMessage, isLoading, fallbackAssistantState]
  );
  const fallbackAssistantCreatedAt = React.useMemo(
    () => String(fallbackMessage?.createdAt || new Date().toISOString()),
    [fallbackMessage?.id, fallbackMessage?.createdAt]
  );

  React.useEffect(() => {
    if (storeMessage) return;
    const fallbackBlocks = fallbackAssistantState.blockIds
      .map((id) => fallbackAssistantState.entities[id])
      .filter(Boolean);
    if (fallbackBlocks.length === 0) return;
    appStore.dispatch(upsertManyBlocks(fallbackBlocks));
  }, [storeMessage, fallbackAssistantState]);

  const resolvedMessage = storeMessage
    ? {
      ...storeMessage,
      error: fallbackMessage?.error || storeMessage?.error || null
    }
    : {
      id: String(fallbackMessage?.id || storeAssistantMessageId || ''),
      role: 'assistant',
      assistantId: '',
      topicId: '',
      createdAt: fallbackAssistantCreatedAt,
      status: fallbackAssistantStatus,
      blocks: fallbackAssistantState.blockIds,
      error: fallbackMessage?.error || null
    };
  const blocks = Array.isArray(resolvedMessage?.blocks) ? resolvedMessage.blocks : [];

  return (
    <div className="chat-message-content tw-scope chat-tool-layout-fix">
      <MessageBlockRenderer blocks={blocks} message={resolvedMessage} />
    </div>
  );
};

const MessageContent = ({ message, isLoading = false }) => {
  const role = String(message?.role || '').toLowerCase();
  const isAssistant = role === 'assistant';
  const storeAssistantMessageId = String(message?.storeAssistantMessageId || '').trim();
  const canUseLiveRendererStore = isAssistant && Boolean(storeAssistantMessageId);

  if (canUseLiveRendererStore) {
    return (
      <Provider store={appStore}>
        <LiveAssistantMessageContent
          fallbackMessage={message}
          storeAssistantMessageId={storeAssistantMessageId}
          isLoading={isLoading}
        />
      </Provider>
    );
  }

  const assistantState = React.useMemo(
    () => buildAssistantBlockState({ message, isLoading }),
    [message, isLoading]
  );
  const assistantStatus = React.useMemo(
    () => buildAssistantMessageStatus({
      message,
      isLoading,
      entities: assistantState.entities,
      blockIds: assistantState.blockIds
    }),
    [message, isLoading, assistantState]
  );
  const assistantCreatedAt = React.useMemo(
    () => String(message?.createdAt || new Date().toISOString()),
    [message?.id, message?.createdAt]
  );
  const assistantMessage = React.useMemo(() => ({
    id: String(message?.id || ''),
    role: 'assistant',
    assistantId: '',
    topicId: '',
    createdAt: assistantCreatedAt,
    status: assistantStatus,
    blocks: assistantState.blockIds
  }), [assistantCreatedAt, assistantStatus, message?.id, assistantState.blockIds]);

  React.useEffect(() => {
    if (!isAssistant) return;
    const assistantBlocks = assistantState.blockIds
      .map((id) => assistantState.entities[id])
      .filter(Boolean);
    if (assistantBlocks.length === 0) return;
    appStore.dispatch(upsertManyBlocks(assistantBlocks));
  }, [isAssistant, assistantState]);

  React.useEffect(() => {
    if (!DEBUG_CHAT_LOADING) return;
    // logger.info({
    //   messageId: message?.id || '',
    //   role,
    //   isLoading,
    //   contentLength: String(message?.content || '').length,
    //   hasBlocks: Array.isArray(message?.blocks) && message.blocks.length > 0,
    //   renderPath: isAssistant ? 'assistant:new-blocks-full' : 'user:legacy-markdown',
    //   assistantBlockCount: assistantState.blockIds.length
    // });
  }, [message, isLoading, role, isAssistant, assistantState.blockIds.length]);

  if (!isAssistant) {
    const imageAttachments = Array.isArray(message?.imageAttachments)
      ? message.imageAttachments.filter((item) => (
        item
        && typeof item === 'object'
        && String(item?.fileType || '').toLowerCase().startsWith('image/')
        && getUserImageAttachmentPreviewUrl(item)
      ))
      : [];
    return (
      <div className="chat-message-content">
        <Markdown content={String(message?.content || '')} />
        {imageAttachments.length > 0 && (
          <Image.PreviewGroup>
            <div className="chat-message-user-attachments" aria-label="图片附件">
              {imageAttachments.map((attachment, index) => {
                const previewUrl = getUserImageAttachmentPreviewUrl(attachment);
                const name = String(attachment?.name || `图片 ${index + 1}`);
                return (
                  <div
                    key={String(attachment?.uid || attachment?.url || `${name}-${index}`)}
                    className="chat-message-user-attachment">
                    <Image
                      className="chat-message-user-attachment__image"
                      src={previewUrl}
                      alt={name}
                      width={120}
                      height={120}
                    />
                  </div>
                );
              })}
            </div>
          </Image.PreviewGroup>
        )}
      </div>
    );
  }

  return (
    <Provider store={appStore}>
      <div className="chat-message-content tw-scope chat-tool-layout-fix">
        <MessageBlockRenderer blocks={assistantState.blockIds} message={assistantMessage} />
      </div>
    </Provider>
  );
};

export default React.memo(MessageContent);
