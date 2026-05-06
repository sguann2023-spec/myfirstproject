import { MessageBlockStatus, MessageBlockType } from './types';
import { buildErrorSignature } from '../../../../shared/chatError';
const { loggerService } = require('../../../../shared/logger');

const TOOL_FENCE_RE = /```(tool|tools|function)\s*\n([\s\S]*?)```/gi;
const THINK_TAG_RE = /<(?:think|thinking)(?:\s[^>]*)?>([\s\S]*?)<\/(?:think|thinking)>/gi;
const THINK_ESCAPED_TAG_RE = /&lt;(?:think|thinking)(?:\s[^&]*?)?&gt;([\s\S]*?)&lt;\/(?:think|thinking)&gt;/gi;
const THINK_FENCE_RE = /```thinking\s*\n([\s\S]*?)```/gi;
const DEBUG_CHAT_LOADING = process.env.NODE_ENV !== 'production';
const logger = loggerService.withContext('ChatBlocks/parser');

const normalizeStructuredBlockStatus = (status) => {
  const value = String(status || '').toLowerCase();
  if (!value) return MessageBlockStatus.SUCCESS;
  if (['processing', 'pending'].includes(value)) return MessageBlockStatus.PROCESSING;
  if (['streaming', 'running', 'invoking'].includes(value)) return MessageBlockStatus.STREAMING;
  if (['error', 'failed'].includes(value)) return MessageBlockStatus.ERROR;
  return MessageBlockStatus.SUCCESS;
};

const normalizeStructuredBlocks = ({ messageId, sourceBlocks = [] }) => {
  if (!Array.isArray(sourceBlocks) || sourceBlocks.length === 0) return [];
  return sourceBlocks
    .map((rawBlock, index) => {
      if (!rawBlock || typeof rawBlock !== 'object') return null;
      const rawType = String(rawBlock?.type || '').toLowerCase();
      const blockId = String(rawBlock?.id || `${messageId}-persisted-${index}`);
      const normalizedStatus = normalizeStructuredBlockStatus(rawBlock?.status);
      if (rawType === 'main_text' || rawType === 'code') {
        return {
          id: blockId,
          type: MessageBlockType.MAIN_TEXT,
          status: normalizedStatus,
          content: String(rawBlock?.content || ''),
        };
      }
      if (rawType === 'thinking') {
        return {
          id: blockId,
          type: MessageBlockType.THINKING,
          status: normalizedStatus,
          content: String(rawBlock?.content || ''),
        };
      }
      if (rawType === 'tool') {
        return {
          id: blockId,
          type: MessageBlockType.TOOL,
          status: normalizedStatus,
          toolName: rawBlock?.toolName,
          content: rawBlock?.content || rawBlock,
          metadata: rawBlock?.metadata || {},
        };
      }
      if (rawType === 'error') {
        return {
          id: blockId,
          type: MessageBlockType.ERROR,
          status: MessageBlockStatus.ERROR,
          content: String(rawBlock?.content || rawBlock?.error?.message || '请求失败'),
          error: rawBlock?.error || null,
        };
      }
      return null;
    })
    .filter(Boolean);
};

const normalizeToolPayload = (raw) => {
  const text = String(raw || '').trim();
  if (!text) {
    return {
      name: 'tool',
      args: '',
      result: '',
      raw: text,
    };
  }

  try {
    const parsed = JSON.parse(text);
    const name = parsed?.name || parsed?.tool || parsed?.function || 'tool';
    const args = parsed?.arguments || parsed?.args || parsed?.input || '';
    const result = parsed?.result || parsed?.output || '';
    return {
      name: String(name),
      args: typeof args === 'string' ? args : JSON.stringify(args, null, 2),
      result: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      raw: text,
    };
  } catch (error) {
    return {
      name: 'tool',
      args: '',
      result: text,
      raw: text,
    };
  }
};

const pushThinkingBlocks = (source, messageId, collector) => {
  let index = 0;
  let transformed = source;
  transformed = transformed.replace(THINK_TAG_RE, (_m, content) => {
    const thinking = String(content || '').trim();
    if (thinking) {
      collector.push({
        id: `${messageId}-thinking-${index++}`,
        type: MessageBlockType.THINKING,
        status: MessageBlockStatus.SUCCESS,
        content: thinking,
      });
    }
    return '\n';
  });
  transformed = transformed.replace(THINK_ESCAPED_TAG_RE, (_m, content) => {
    const thinking = String(content || '').trim();
    if (thinking) {
      collector.push({
        id: `${messageId}-thinking-${index++}`,
        type: MessageBlockType.THINKING,
        status: MessageBlockStatus.SUCCESS,
        content: thinking,
      });
    }
    return '\n';
  });
  transformed = transformed.replace(THINK_FENCE_RE, (_m, content) => {
    const thinking = String(content || '').trim();
    if (thinking) {
      collector.push({
        id: `${messageId}-thinking-${index++}`,
        type: MessageBlockType.THINKING,
        status: MessageBlockStatus.SUCCESS,
        content: thinking,
      });
    }
    return '\n';
  });
  return transformed;
};

const pushToolBlocks = (source, messageId, collector) => {
  let index = 0;
  return source.replace(TOOL_FENCE_RE, (_m, _lang, payload) => {
    const normalized = normalizeToolPayload(payload);
    collector.push({
      id: `${messageId}-tool-${index++}`,
      type: MessageBlockType.TOOL,
      status: MessageBlockStatus.SUCCESS,
      content: normalized,
    });
    return '\n';
  });
};

const getStableMessageId = (message) => {
  if (message?.id !== undefined && message?.id !== null && String(message.id).trim()) {
    return String(message.id);
  }
  if (message?.createdAt) {
    return `created-${String(message.createdAt)}`;
  }
  if (message?.timestamp) {
    return `ts-${String(message.timestamp)}`;
  }
  if (message?.updatedAt) {
    return `updated-${String(message.updatedAt)}`;
  }
  return `role-${String(message?.role || 'message')}`;
};

export const parseMessageBlocks = ({ message, isLoading = false, preferStructuredBlocks = false }) => {
  const messageId = getStableMessageId(message);
  const raw = String(message?.content || '');
  const sourceBlocks = Array.isArray(message?.blocks) ? message.blocks : [];
  const structuredBlocks = preferStructuredBlocks
    ? normalizeStructuredBlocks({ messageId, sourceBlocks })
    : [];
  const thinkingBlocks = [];
  const toolBlocks = [];
  const blocks = structuredBlocks.length > 0 ? [...structuredBlocks] : [];

  let rest = raw;
  if (blocks.length === 0) {
    rest = pushThinkingBlocks(rest, messageId, thinkingBlocks);
    rest = pushToolBlocks(rest, messageId, toolBlocks);

    const main = String(rest || '').trim();
    const thinkingInProgress = isLoading && !main;
    if (thinkingBlocks.length > 0) {
      thinkingBlocks.forEach((block) => {
        blocks.push({
          ...block,
          status: thinkingInProgress ? MessageBlockStatus.STREAMING : MessageBlockStatus.SUCCESS,
        });
      });
    }
    if (main) {
      blocks.push({
        id: `${messageId}-main`,
        type: MessageBlockType.MAIN_TEXT,
        status: MessageBlockStatus.SUCCESS,
        content: main,
      });
    }
    if (toolBlocks.length > 0) {
      blocks.push(...toolBlocks);
    }
  }
  const messageError = message?.error || null;
  const errorSignature = buildErrorSignature(messageError);
  if (errorSignature && !isLoading) {
    blocks.push({
      id: `${messageId}-error`,
      type: MessageBlockType.ERROR,
      status: MessageBlockStatus.ERROR,
      content: messageError?.title || messageError?.message || '请求失败',
      error: {
        category: messageError?.category || 'unknown',
        title: messageError?.title || '请求失败',
        message: messageError?.message || '',
        detail: messageError?.detail || messageError?.message || '',
        status: messageError?.status,
        code: messageError?.code,
      },
    });
  }

  if (blocks.length === 0) {
    blocks.push({
      id: `${messageId}-main`,
      type: MessageBlockType.MAIN_TEXT,
      status: MessageBlockStatus.SUCCESS,
      content: raw,
    });
  }

  if (isLoading) {
    // Keep the loading indicator visible during streaming, and remove it only when streaming ends.
    blocks.push({
      id: `${messageId}-placeholder`,
      type: MessageBlockType.PLACEHOLDER,
      status: MessageBlockStatus.PROCESSING,
      content: '',
    });
  }

  if (DEBUG_CHAT_LOADING) {
    logger.info({
      messageId,
      isLoading,
      rawLength: raw.length,
      sourceBlocksCount: Array.isArray(message?.blocks) ? message.blocks.length : 0,
      useStructuredBlocks: preferStructuredBlocks,
      structuredBlocksCount: structuredBlocks.length,
      parsedToolCount: toolBlocks.length,
      parsedThinkingCount: thinkingBlocks.length,
      parsedTotalCount: blocks.length
    });
  }

  return blocks;
};
