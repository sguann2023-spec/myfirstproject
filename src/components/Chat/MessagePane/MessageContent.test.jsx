import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MessageContent from './MessageContent/MessageContent';
import MessageGroup from './MessageGroup/MessageGroup';
import i18next from 'i18next';
vi.mock('./MessageItem/MessageItem', () => ({ default: ({ message, isLoading }) => <MessageContent message={message} isLoading={isLoading} /> }));
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
vi.mock('@renderer/pages/home/Messages/Blocks/ToolBlock', () => ({ default: () => <div data-testid="single-tool" /> }));
vi.mock('@renderer/pages/home/Messages/Blocks/ToolBlockGroup', () => ({ default: ({ blocks }) => <div data-testid="tool-group">{blocks.length} calls</div> }));
vi.mock('@renderer/pages/home/Messages/Blocks/TranslationBlock', () => ({ default: () => null }));
vi.mock('@renderer/pages/home/Messages/Blocks/VideoBlock', () => ({ default: () => null }));

let container;
let root;
let firstLayouts;
const block = (id, content) => ({ id, content, type: 'main_text', status: 'success' });
const message = (id, blocks) => ({ id, role: 'assistant', blocks, content: blocks[0].content });
it('renders two separate voice-library messages as one two-call group through the actual block adapter', async () => {
  await i18next.init({ lng: 'zh-cn', resources: {} });
  const tool = id => ({ id, type: 'tool', status: 'success', metadata: { rawMcpToolResponse: {
    tool: { name: 'mcp__voice-library__list_voices', type: 'mcp' }
  } } });
  const messages = ['one', 'two'].map(id => ({ id, role: 'assistant', content: 'serialized tool fallback', blocks: [tool(id)] }));
  await act(async () => root.render(<MessageGroup role="assistant" messages={messages} />));
  expect(container.querySelectorAll('[data-testid="tool-group"]')).toHaveLength(1);
  expect(container.textContent).toContain('2 calls');
  expect(container.querySelector('[data-testid="single-tool"]')).toBeNull();
});

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

  expect(container.textContent).toBe('用户已取消');
});

it('appends the processed duration to the cancelled notice when timestamps exist', async () => {
  await act(async () => root.render(<Probe value={{
    id: 'reply',
    role: 'assistant',
    blocks: [],
    content: '',
    aborted: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T01:02:03.000Z',
  }} />));

  expect(container.textContent).toBe('用户已取消 · 已处理 1小时2分3秒');
});

for (const live of [false, true]) {
  it(`renders one error card for block and top-level errors on ${live ? 'live' : 'historical'} turns`, async () => {
    const error = { message: '400 status code (no body)', status: 400 };
    const errorBlock = { id: 'original-error', type: 'error', status: 'error', error };
    const value = {
      id: 'reply', role: 'assistant', blocks: [errorBlock], error,
      ...(live ? { storeAssistantMessageId: 'liveMessage' } : {}),
    };
    if (live) store.state = {
      messageBlocks: { entities: { 'store-error': { ...errorBlock, id: 'store-error' } } },
      messages: { entities: { liveMessage: { id: 'liveMessage', role: 'assistant', status: 'error', blocks: ['store-error'], error } } },
    };
    await act(async () => root.render(<Probe value={value} />));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.textContent).toContain(error.message);
  });

  for (const error of [{}, { message: 'Unknown error', category: 'unknown' },
    { message: 'Invalid API key', status: 401 },
    { message: 'Error Details: {}', category: 'unknown' },
    { message: 'Connection closed', code: 'ECONNRESET' }]) {
    it(`suppresses ${JSON.stringify(error)} on cancelled ${live ? 'live' : 'historical'} turns`, async () => {
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
      expect(container.textContent).toBe('用户已取消');
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });
  }
}

it('preserves generated text without an error card when a historical turn was cancelled', async () => {
  await act(async () => root.render(<Probe value={{
    id: 'reply', role: 'assistant', aborted: true, blocks: [block('partial', 'Partial reply')],
    error: { message: 'Invalid API key', status: 401 },
  }} />));
  expect(container.textContent).toBe('Partial reply用户已取消');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('retains generic failures when the turn was not cancelled', async () => {
  await act(async () => root.render(<Probe value={{
    id: 'reply', role: 'assistant', blocks: [], error: {},
  }} />));
  expect(container.textContent).toContain('本次请求未能完成');
  expect(container.textContent).not.toContain('用户已取消');
});

it('recognizes persisted cancellation status without an aborted flag', async () => {
  await act(async () => root.render(<Probe value={{
    id: 'reply', role: 'assistant', status: 'cancelled', blocks: [], error: {},
  }} />));
  expect(container.textContent).toBe('用户已取消');
});

it('keeps stop visible when a late stream-close error replaces the live snapshot', async () => {
  const stopped = { id: 'reply', role: 'assistant', blocks: [], aborted: true };
  await act(async () => root.render(<Probe value={stopped} />));
  await act(async () => root.render(<Probe value={{
    ...stopped, error: { message: 'agent request failed', category: 'unknown' },
    blocks: [{ id: 'late-error', type: 'error', error: {} }],
  }} />));
  expect(firstLayouts).toEqual(['用户已取消', '用户已取消']);
  expect(container.textContent).toBe('用户已取消');
});

it.each(['paused', 'cancelled', 'interrupted', 'error'])('retains persisted %s through history hydration and the embedded renderer', async (status) => {
  const source = readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
  const start = source.indexOf('const toPersistedHistoryMessage =');
  const end = source.indexOf('const finalizeLatestTodoWriteInStore', start);
  const hydrate = Function('isStructuredBlockObject', 'normalizeStructuredBlocksForPersistence',
    'hasInterruptedAssistantState', 'buildAssistantDisplayContentFromBlocks', 'buildMessageContentFromBlocks',
    'normalizeMessageModelMeta', 'resolveMessageModelId', 'limitInlineText',
    `${source.slice(start, end)}; return toPersistedHistoryMessage;`)(
    () => true, (blocks) => blocks, (m) => ['paused', 'cancelled', 'interrupted'].includes(m.status),
    () => 'partial', () => '', () => null, () => '', (value) => value);
  const persisted = JSON.parse(JSON.stringify({ message: { id: 'reply', role: 'assistant', status },
    blocks: [block('earlier', 'earlier output'), block('answer', 'partial')] }));
  const reloaded = hydrate(persisted, 0);
  expect(reloaded.status).toBe(status);
  await act(async () => root.render(<Probe value={reloaded} />));
  expect(container.textContent).not.toContain('已完成');
});

it.each(['pending', 'processing', 'streaming'])('does not complete a local %s snapshot on restart', (status) => {
  const source = readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
  const start = source.indexOf('const normalizePersistedChatMessage =');
  const end = source.indexOf('const shouldHydrateChatSessionFromHistory', start);
  const recover = Function('limitInlineText', 'isStructuredBlockObject', 'hasInterruptedAssistantState',
    'isStreamingLikeBlockStatus', 'normalizeStructuredBlocksForPersistence', 'normalizeMessageModelMeta',
    'resolveMessageModelId', 'buildComparableModelMeta', `${source.slice(start, end)}; return normalizePersistedChatMessage;`)(
    (value) => value, () => true, (m) => Boolean(m.aborted),
    (value) => ['pending', 'processing', 'streaming'].includes(value),
    (blocks, { aborted }) => blocks.map((b) => ({ ...b, status: aborted ? 'cancelled' : 'success' })),
    () => null, () => '', () => null);
  const saved = JSON.parse(JSON.stringify({ id: 'reply', role: 'assistant', status,
    content: 'partial', blocks: [{ ...block('partial', 'partial'), status }] }));
  const reloaded = recover(saved, [], { recovering: true });
  expect(reloaded.aborted).toBe(true);
  expect(reloaded.blocks[0].status).toBe('cancelled');
  expect(saved.blocks[0].status).toBe(status);
});

it.each([
  ['success', 'success', 'success'],
  ['success', 'error', 'success'], // A recovered tool error is not a failed turn.
  ['processing', 'success', 'paused'],
  ['pending', 'success', 'paused'],
  ['streaming', 'success', 'paused'],
  ['error', 'success', 'error'],
  ['paused', 'success', 'paused'],
])('maps persisted %s with a %s block to %s, without inventing completion', (status, blockStatus, expected) => {
  const source = readFileSync(`${process.cwd()}/src/components/Chat/MessagePane/MessageContent/MessageContent.js`, 'utf8');
  const start = source.indexOf('const buildAssistantMessageStatus =');
  const end = source.indexOf('const isActiveBlockStatus', start);
  const mapStatus = Function('visibleTurnError', 'isCancelledTurn', 'MessageBlockStatus',
    `${source.slice(start, end)}; return buildAssistantMessageStatus;`)(
    () => null, () => false, { PENDING: 'pending', PROCESSING: 'processing', STREAMING: 'streaming' });
  expect(mapStatus({ message: { status }, isLoading: false,
    blockIds: ['tool'], entities: { tool: { status: blockStatus } } })).toBe(expected);
  expect(mapStatus({ message: { status: 'processing' }, isLoading: true,
    blockIds: [], entities: {} })).toBe('processing');
});

it('keeps cancelled block and message states non-success in the embedded renderer', async () => {
  await act(async () => root.render(<Probe value={{ id: 'reply', role: 'assistant', aborted: true,
    blocks: [{ ...block('partial', 'partial'), status: 'cancelled' }] }} />));
  expect(store.getState().messageBlocks.entities.partial.status).toBe('paused');
  expect(container.textContent).not.toContain('已完成');
});

it('HomePage snapshots retain completed-step accounting when the turn fails', () => {
  const source = readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
  const start = source.indexOf('const getAssistantSnapshotFromStore =');
  const end = source.indexOf('const finalizeStructuredBlocks', start);
  const saved = {
    blocks: [],
    usageSteps: [{ prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500,
      prompt_tokens_details: { cached_tokens: 200 } }]
  };
  const snapshot = Function('appStore', 'buildAssistantDisplayContentFromBlocks',
    `${source.slice(start, end)}; return getAssistantSnapshotFromStore('reply');`)(
    { getState: () => ({ messages: { entities: { reply: saved } } }) }, () => '');
  expect(snapshot.usageSteps).toEqual(saved.usageSteps);
  expect(snapshot.usageSteps[0].prompt_tokens_details).not.toBe(saved.usageSteps[0].prompt_tokens_details);
});

it('HomePage finalization preserves cancellation across the stop/error race', () => {
  // Exercise the real callback without mounting HomePage's unrelated editor/runtime.
  const source = readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
  const start = source.indexOf('    updateChatAssistantMessage(chatId, assistantMessageId, (message) => {', source.indexOf('const finalizeChatAssistantMessageLocally'));
  const end = source.indexOf('\n    });', start);
  const update = source.slice(start, end + '\n    });'.length);
  let message = { role: 'assistant', aborted: true, content: '', blocks: [] };
  const snapshot = { usageSteps: [{ prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }] };
  const finalize = (error, aborted = false) => {
    Function('updateChatAssistantMessage', 'chatId', 'assistantMessageId', 'snapshot', 'error', 'aborted',
      'hasInterruptedAssistantState', 'shouldSuppressCancelledTurnError', 'finalizeStructuredBlocks',
      'buildAssistantDisplayContentFromBlocks', 'normalizeMessageModelMeta', 'resolveMessageModelId',
      'chatModelOptionsRef', 'chatModelMetaRef', 'chatModelMeta', 'chatModel', update)(
      (_chat, _id, change) => { message = change(message); }, 'chat', 'reply', snapshot, error, aborted,
      (value) => value.aborted, shouldSuppressCancelledTurnError, (blocks) => blocks,
      () => '', () => null, () => '', { current: [] }, { current: null }, null, 'model');
  };
  finalize({ message: 'agent request failed', category: 'unknown' });
  expect(message).toMatchObject({ aborted: true, error: null });
  expect(message.usageSteps).toEqual(snapshot.usageSteps);
  finalize({ message: 'Invalid API key', status: 401 });
  expect(message).toMatchObject({ aborted: true, error: null });
  finalize(null, true);
  expect(message.error).toBeNull();
});
