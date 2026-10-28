import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MessageContent from './MessageContent/MessageContent';
import { readFileSync } from 'node:fs';
import { shouldSuppressCancelledTurnError } from '../../../shared/chatError';

const store = vi.hoisted(() => {
  const listeners = new Set();
  const store = {
    state: { messageBlocks: { entities: {} }, messages: { entities: {} } },
    getState: () => store.state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: ({ payload }) => {
      store.state = {
        ...store.state,
        messageBlocks: {
          entities: { ...store.state.messageBlocks.entities, ...Object.fromEntries(payload.map((b) => [b.id, b])) },
        },
      };
      listeners.forEach((listener) => listener());
    },
  };
  return store;
});

vi.mock('react-redux', () => ({
  Provider: ({ children }) => children,
  useSelector: (select) => select(React.useSyncExternalStore(store.subscribe, store.getState)),
}));
vi.mock('@renderer/store', () => ({ default: store }));
vi.mock('@renderer/store/messageBlock', () => ({
  upsertManyBlocks: (payload) => ({ payload }),
  messageBlocksSelectors: { selectEntities: (state) => state.messageBlocks.entities },
}));
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn() }) } }));
vi.mock('antd', () => ({ Image: () => null }));
vi.mock('./Markdown/Markdown', () => ({ default: () => null }));
vi.mock('@renderer/components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }) => children }));
vi.mock('@renderer/utils/messageUtils/is', () => ({
  isMainTextBlock: (block) => block.type === 'main_text',
  isMessageProcessing: (message) => message.status === 'processing',
  isVideoBlock: (block) => block.type === 'video',
}));
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }) => children,
  motion: { div: ({ children }) => <div>{children}</div> },
}));
vi.mock('@renderer/pages/home/Messages/Blocks/MainTextBlock', () => ({
  default: ({ block }) => <p>{block.content}</p>,
}));
vi.mock('@renderer/pages/home/Messages/Blocks/BlockErrorFallback', () => ({ default: () => null }));
vi.mock('@renderer/pages/home/Messages/Blocks/CitationBlock', () => ({ default: () => null }));
vi.mock('@renderer/pages/home/Messages/Blocks/CompactBlock', () => ({ default: () => null }));
// Keep error blocks observable: a null mock previously hid this regression.
vi.mock('@renderer/pages/home/Messages/Blocks/ErrorBlock', () => ({
  default: ({ block }) => <div role="alert">本次请求未能完成，请重试或切换模型 / {block.error?.message || '未收到具体错误原因，请稍后重试或新建任务'}</div>,
}));
vi.mock('@renderer/pages/home/Messages/Blocks/FileBlock', () => ({ default: () => null }));
vi.mock('@renderer/pages/home/Messages/Blocks/ImageBlock', () => ({ default: () => null }));
vi.mock('@renderer/pages/home/Messages/Blocks/PlaceholderBlock', () => ({ default: () => null }));
vi.mock('@renderer/pages/home/Messages/Blocks/ThinkingBlock', () => ({ default: () => null }));
vi.mock('@renderer/pages/home/Messages/Blocks/ToolBlock', () => ({ default: () => null }));
vi.mock('@renderer/pages/home/Messages/Blocks/TranslationBlock', () => ({ default: () => null }));
vi.mock('@renderer/pages/home/Messages/Blocks/VideoBlock', () => ({ default: () => null }));

let container;
let root;
let firstLayouts;
const block = (id, content) => ({ id, content, type: 'main_text', status: 'success' });
const message = (id, blocks) => ({ id, role: 'assistant', blocks, content: blocks[0].content });
const Probe = ({ value }) => {
  React.useLayoutEffect(() => {
    firstLayouts.push(container.textContent);
  }, [value]);
  return <MessageContent message={value} />;
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  store.state = { messageBlocks: { entities: {} }, messages: { entities: {} } };
  firstLayouts = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('renders history snapshots before the passive Redux hydration effect', async () => {
  await act(async () => root.render(<Probe value={message('reply', [block('history-1', 'Complete reply')])} />));
  expect(firstLayouts).toEqual(['Complete reply']);
  expect(container.textContent).toBe('Complete reply');
});

it('does not render a blank frame when history replaces block IDs', async () => {
  await act(async () => root.render(<Probe value={message('reply', [block('stream-1', 'Complete reply')])} />));
  await act(async () => root.render(<Probe value={message('reply', [block('history-1', 'Complete reply')])} />));
  expect(firstLayouts).toEqual(['Complete reply', 'Complete reply']);
});

it('uses live Redux blocks ahead of stale fallback snapshots', async () => {
  store.state = {
    messageBlocks: { entities: { live: block('live', 'Latest reply') } },
    messages: { entities: { liveMessage: { id: 'liveMessage', role: 'assistant', status: 'success', blocks: ['live'] } } },
  };
  const value = { ...message('reply', [block('live', 'Old snapshot')]), storeAssistantMessageId: 'liveMessage' };
  await act(async () => root.render(<Probe value={value} />));
  expect(firstLayouts).toEqual(['Latest reply']);
  expect(container.textContent).toBe('Latest reply');
});

it('replaces active Redux blocks with a terminal persisted snapshot', async () => {
  store.state = {
    messageBlocks: {
      entities: {
        'pending-tool': {
          id: 'pending-tool',
          messageId: 'liveMessage',
          type: 'tool',
          status: 'processing',
          metadata: {
            rawMcpToolResponse: {
              id: 'koubo-template-call',
              status: 'pending',
            },
          },
        },
      },
    },
    messages: {
      entities: {
        liveMessage: {
          id: 'liveMessage',
          role: 'assistant',
          status: 'processing',
          blocks: ['pending-tool'],
        },
      },
    },
  };
  const value = {
    ...message('reply', [
      {
        id: 'completed-tool',
        messageId: 'liveMessage',
        type: 'tool',
        status: 'success',
        metadata: {
          rawMcpToolResponse: {
            id: 'koubo-template-call',
            status: 'done',
            response: { status: 'success', success: true },
          },
        },
      },
      block('completed-main', 'Complete reply'),
    ]),
    storeAssistantMessageId: 'liveMessage',
  };

  await act(async () => root.render(<Probe value={value} />));

  expect(container.textContent).toContain('Complete reply');
  expect(container.textContent).not.toContain('处理中');
  expect(store.state.messageBlocks.entities['completed-tool']).toMatchObject({
    status: 'success',
    metadata: {
      rawMcpToolResponse: {
        status: 'done',
      },
    },
  });
});

it('keeps an interrupted assistant turn visible when no answer text was produced', async () => {
  const value = {
    id: 'reply',
    role: 'assistant',
    blocks: [],
    content: '',
    aborted: true,
  };
  await act(async () => root.render(<Probe value={value} />));

  expect(container.textContent).toBe('已停止生成');
});

for (const live of [false, true]) {
  for (const error of [{}, { message: 'Unknown error', category: 'unknown' }]) {
    it(`suppresses generic errors on cancelled ${live ? 'live' : 'historical'} legacy turns`, async () => {
      const value = {
        id: 'reply', role: 'assistant', content: '', aborted: true, error,
        blocks: [{ id: 'stale-error', type: 'error', status: 'error', error }],
        ...(live ? { storeAssistantMessageId: 'liveMessage' } : {}),
      };
      if (live) store.state = {
        messageBlocks: { entities: { 'stale-error': value.blocks[0] } },
        messages: { entities: { liveMessage: { id: 'liveMessage', role: 'assistant', status: 'error', blocks: ['stale-error'], error } } },
      };
      await act(async () => root.render(<Probe value={value} />));
      expect(container.textContent).toBe('已停止生成');
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });
  }
}

it('retains concrete failures even when a historical turn was stopped', async () => {
  await act(async () => root.render(<Probe value={{
    id: 'reply', role: 'assistant', aborted: true, blocks: [],
    error: { message: 'Invalid API key', status: 401 },
  }} />));
  expect(container.textContent).toContain('Invalid API key');
  expect(container.textContent).toContain('已停止生成');
});

it('retains generic failures when the turn was not cancelled', async () => {
  await act(async () => root.render(<Probe value={{
    id: 'reply', role: 'assistant', blocks: [], error: {},
  }} />));
  expect(container.textContent).toContain('本次请求未能完成');
  expect(container.textContent).not.toContain('已停止生成');
});

it('recognizes persisted cancellation status without an aborted flag', async () => {
  await act(async () => root.render(<Probe value={{
    id: 'reply', role: 'assistant', status: 'cancelled', blocks: [], error: {},
  }} />));
  expect(container.textContent).toBe('已停止生成');
});

it('keeps stop visible when a late stream-close error replaces the live snapshot', async () => {
  const stopped = { id: 'reply', role: 'assistant', blocks: [], aborted: true };
  await act(async () => root.render(<Probe value={stopped} />));
  await act(async () => root.render(<Probe value={{
    ...stopped, error: { message: 'agent request failed', category: 'unknown' },
    blocks: [{ id: 'late-error', type: 'error', error: {} }],
  }} />));
  expect(firstLayouts).toEqual(['已停止生成', '已停止生成']);
  expect(container.textContent).toBe('已停止生成');
});

it('HomePage finalization preserves cancellation across the stop/error race', () => {
  // Exercise the real callback without mounting HomePage's unrelated editor/runtime.
  const source = readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
  const start = source.indexOf('    updateChatAssistantMessage(chatId, assistantMessageId, (message) => {', source.indexOf('const finalizeChatAssistantMessageLocally'));
  const end = source.indexOf('\n    });', start);
  const update = source.slice(start, end + '\n    });'.length);
  let message = { role: 'assistant', aborted: true, content: '', blocks: [] };
  const finalize = (error, aborted = false) => {
    Function('updateChatAssistantMessage', 'chatId', 'assistantMessageId', 'snapshot', 'error', 'aborted',
      'hasInterruptedAssistantState', 'shouldSuppressCancelledTurnError', 'finalizeStructuredBlocks',
      'buildAssistantDisplayContentFromBlocks', 'normalizeMessageModelMeta', 'resolveMessageModelId',
      'chatModelOptionsRef', 'chatModelMetaRef', 'chatModelMeta', 'chatModel', update)(
      (_chat, _id, change) => { message = change(message); }, 'chat', 'reply', null, error, aborted,
      (value) => value.aborted, shouldSuppressCancelledTurnError, (blocks) => blocks,
      () => '', () => null, () => '', { current: [] }, { current: null }, null, 'model');
  };
  finalize({ message: 'agent request failed', category: 'unknown' });
  expect(message).toMatchObject({ aborted: true, error: null });
  finalize({ message: 'Invalid API key', status: 401 });
  expect(message).toMatchObject({ aborted: true, error: { status: 401 } });
  finalize(null, true);
  expect(message.error).toMatchObject({ status: 401 });
});
