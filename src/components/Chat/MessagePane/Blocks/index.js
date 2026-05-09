import React from 'react';
import { MessageBlockStatus, MessageBlockType as NewMessageBlockType } from '@renderer/types/newMessage';
import PlaceholderBlock from '@renderer/pages/home/Messages/Blocks/PlaceholderBlock';
import ToolBlock from '@renderer/pages/home/Messages/Blocks/ToolBlock';
import ToolBlockGroup from '@renderer/pages/home/Messages/Blocks/ToolBlockGroup';
import ErrorBlock from './ErrorBlock';
import MainTextBlock from './MainTextBlock';
import ThinkingBlock from './ThinkingBlock';
import { MessageBlockType } from './types';
import { loggerService } from '@logger';
const DEBUG_CHAT_LOADING = process.env.NODE_ENV !== 'production';
const logger = loggerService.withContext('ChatBlocks/renderer');

const normalizeToolRuntimeStatus = (status) => {
  const value = String(status || '').toLowerCase();
  if (!value) return 'done';
  if (['success', 'completed', 'complete'].includes(value)) return 'done';
  if (['processing', 'streaming', 'running', 'invoking', 'pending'].includes(value)) return 'pending';
  if (value === 'error' || value === 'failed') return 'error';
  return value;
};

const normalizeToolBlock = (block) => {
  if (block?.metadata?.rawMcpToolResponse) return block;
  const payload = block?.content || {};
  const toolName = String(block?.toolName || payload?.name || 'tool');
  const args = payload?.args || '';
  const result = payload?.result || '';
  return {
    ...block,
    content: typeof args === 'string' ? args : JSON.stringify(args, null, 2),
    metadata: {
      ...(block?.metadata || {}),
      rawMcpToolResponse: {
        type: 'normal',
        status: normalizeToolRuntimeStatus(payload?.status || block?.status),
        tool: { type: 'normal', name: toolName },
        arguments: args,
        response: result
      }
    }
  };
};

const groupBlocks = (blocks) => {
  const grouped = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.type === MessageBlockType.TOOL) {
      const bucket = [block];
      let j = i + 1;
      while (j < blocks.length && blocks[j].type === MessageBlockType.TOOL) {
        bucket.push(blocks[j]);
        j += 1;
      }
      if (bucket.length > 1) {
        grouped.push({ type: 'tool_group', id: `tool-group-${bucket[0].id}`, blocks: bucket });
      } else {
        grouped.push(bucket[0]);
      }
      i = j - 1;
      continue;
    }
    grouped.push(block);
  }
  return grouped;
};

const MessageBlockRenderer = ({ blocks = [] }) => {
  const groupedBlocks = React.useMemo(() => groupBlocks(blocks), [blocks]);

  React.useEffect(() => {
    if (!DEBUG_CHAT_LOADING) return;
    const toolCount = groupedBlocks.reduce((acc, block) => {
      if (block?.type === MessageBlockType.TOOL) return acc + 1;
      if (block?.type === 'tool_group') return acc + (Array.isArray(block.blocks) ? block.blocks.length : 0);
      return acc;
    }, 0);
    logger.info({
      groupedCount: groupedBlocks.length,
      toolCount,
      blockTypes: groupedBlocks.map((block) => block?.type || 'unknown')
    });
  }, [groupedBlocks]);

  return (
    <div className="chat-message-blocks">
      {groupedBlocks.map((block) => {
        if (block.type === 'tool_group') {
          return <ToolBlockGroup key={block.id} blocks={block.blocks.map(normalizeToolBlock)} />;
        }
        switch (block.type) {
          case MessageBlockType.MAIN_TEXT:
            return <MainTextBlock key={block.id} block={block} />;
          case MessageBlockType.THINKING:
            return <ThinkingBlock key={block.id} block={block} />;
          case MessageBlockType.TOOL:
            return <ToolBlock key={block.id} block={normalizeToolBlock(block)} />;
          case MessageBlockType.PLACEHOLDER:
            return (
              <PlaceholderBlock
                key={block.id}
                block={{
                  id: String(block.id || `loading-${Date.now()}`),
                  messageId: String(block.messageId || ''),
                  type: NewMessageBlockType.UNKNOWN,
                  status: MessageBlockStatus.PROCESSING,
                  createdAt: new Date().toISOString()
                }}
              />
            );
          case MessageBlockType.ERROR:
            return <ErrorBlock key={block.id} block={block} />;
          default:
            return null;
        }
      })}
    </div>
  );
};

export default MessageBlockRenderer;
