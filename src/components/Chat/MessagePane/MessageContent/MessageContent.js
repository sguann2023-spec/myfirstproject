import { configureStore } from '@reduxjs/toolkit';
import React from 'react';
import { Provider } from 'react-redux';
import MessageBlockRenderer from '@renderer/pages/home/Messages/Blocks';
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage';
import Markdown from '../Markdown/Markdown';
import { buildErrorSignature } from '../../../../shared/chatError';
import './MessageContent.css';

const DEBUG_CHAT_LOADING = false && process.env.NODE_ENV !== 'production';

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

const normalizeBlockStatus = (value) => {
  const status = String(value || '').toLowerCase();
  if (!status) return MessageBlockStatus.SUCCESS;
  if (status === 'pending') return MessageBlockStatus.PENDING;
  if (status === 'processing') return MessageBlockStatus.PROCESSING;
  if (status === 'streaming' || status === 'running' || status === 'invoking') return MessageBlockStatus.STREAMING;
  if (status === 'error' || status === 'failed') return MessageBlockStatus.ERROR;
  return MessageBlockStatus.SUCCESS;
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
    entities[id] = {
      ...rawBlock,
      id,
      messageId: String(rawBlock?.messageId || messageId),
      type: normalizeBlockType(rawBlock?.type),
      status: normalizeBlockStatus(rawBlock?.status),
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

const createToolStore = (entities = {}) =>
  configureStore({
    reducer: (
      state = {
        settings: {
          renderInputMessageAsMarkdown: false,
          mathEngine: 'KaTeX',
          mathEnableSingleDollar: true,
          codeExecution: {
            enabled: false,
            timeoutMinutes: 1
          },
          codeEditor: {
            enabled: false,
            themeLight: 'auto',
            themeDark: 'auto',
            highlightActiveLine: false,
            foldGutter: false,
            autocompletion: true,
            keymap: false
          },
          codePreview: {
            themeLight: 'auto',
            themeDark: 'auto'
          },
          codeViewer: {
            themeLight: 'auto',
            themeDark: 'auto'
          },
          codeImageTools: true,
          codeCollapsible: true,
          codeWrappable: false
        },
        messageBlocks: { entities },
        toolPermissions: { requests: {} }
      }
    ) => state
  });

const MessageContent = ({ message, isLoading = false }) => {
  const role = String(message?.role || '').toLowerCase();
  const isAssistant = role === 'assistant';

  const assistantState = React.useMemo(
    () => buildAssistantBlockState({ message, isLoading }),
    [message, isLoading]
  );
  const toolStore = React.useMemo(
    () => createToolStore(assistantState.entities),
    [assistantState]
  );
  const assistantMessage = React.useMemo(() => ({
    id: String(message?.id || ''),
    role: 'assistant',
    assistantId: '',
    topicId: '',
    createdAt: new Date().toISOString(),
    status: isLoading ? 'processing' : 'success',
    blocks: assistantState.blockIds
  }), [message, isLoading, assistantState.blockIds]);

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
    return (
      <div className="chat-message-content">
        <Markdown content={String(message?.content || '')} />
      </div>
    );
  }

  return (
    <Provider store={toolStore}>
      <div className="chat-message-content tw-scope chat-tool-layout-fix">
        <MessageBlockRenderer blocks={assistantState.blockIds} message={assistantMessage} />
      </div>
    </Provider>
  );
};

export default React.memo(MessageContent, (prevProps, nextProps) => {
  const prevMessage = prevProps.message || {};
  const nextMessage = nextProps.message || {};
  const prevError = buildErrorSignature(prevMessage.error);
  const nextError = buildErrorSignature(nextMessage.error);
  return (
    prevProps.isLoading === nextProps.isLoading
    && prevMessage.id === nextMessage.id
    && prevMessage.content === nextMessage.content
    && prevMessage.role === nextMessage.role
    && prevMessage.createdAt === nextMessage.createdAt
    && prevMessage.updatedAt === nextMessage.updatedAt
    && prevError === nextError
  );
});
