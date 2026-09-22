import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MessageContent from './MessageContent/MessageContent';

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
vi.mock('@renderer/pages/home/Messages/Blocks/ErrorBlock', () => ({ default: () => null }));
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
