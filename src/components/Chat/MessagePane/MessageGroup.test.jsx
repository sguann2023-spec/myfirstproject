import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import i18next from 'i18next';
await i18next.init({ lng: 'zh-cn', resources: {} });
import MessageGroup, { aggregateToolFragments } from './MessageGroup/MessageGroup';
const store = vi.hoisted(() => {
  const listeners = new Set();
  const store = { state: { messages: { entities: {} }, messageBlocks: { entities: {} } },
    getState: () => store.state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    dispatch: state => { store.state = state; listeners.forEach(fn => fn()); } };
  return store;
});
vi.mock('@renderer/store', () => ({ default: store }));
vi.mock('../MessagePane/MessageContent/MessageContent', () => ({ buildAssistantBlockState: ({ message }) => ({
  blockIds: message.blocks.map(b => b.id), entities: Object.fromEntries(message.blocks.map(b => [b.id, b]))
}) }));
vi.mock('./MessageItem/MessageItem', () => ({ default: ({ message }) => <div data-testid="item">{message.blocks.filter(b => b.type === 'tool').length} calls</div> }));
const tool = id => ({ id, type: 'tool', metadata: { rawMcpToolResponse: { tool: { name: 'mcp__voice-library__list_voices', type: 'mcp' } } } });
const fragment = id => ({ id, role: 'assistant', blocks: [tool(id + '-tool')] });
it('aggregates separate voice-library fragments without changing stored objects', () => {
  const messages = [fragment('a'), fragment('b')];
  const result = aggregateToolFragments(messages, {}, null);
  expect(result).toHaveLength(1);
  expect(result[0].blocks).toHaveLength(2);
  expect(result[0].presentationMembers).toEqual(messages);
  expect(messages[0].blocks).toHaveLength(1);
});
it('merges two nested codemode scrapt runs in adjacent fragments into one 联网搜索 group', () => {
  const nestedTool = (id, operation) => ({ id, type: 'tool', metadata: { rawMcpToolResponse: { tool: { name: `mcp__vectcut__scrapt__${operation}`, type: 'mcp' } } } });
  const codemodeParent = id => ({ id, type: 'tool', metadata: { rawMcpToolResponse: { tool: { name: 'codemode' } } } });
  const run = (id, operation, count, startIndex) => [
    codemodeParent(`${id}-codemode`),
    ...Array.from({ length: count }, (_, i) => nestedTool(`${id}-${startIndex + i}`, operation))
  ];
  const first = { id: 'run-a', role: 'assistant', blocks: run('a', 'bilibili_app_fetch_one_video', 4, 0) };
  const second = { id: 'run-b', role: 'assistant', blocks: run('b', 'bilibili_web_fetch_video_subtitle', 4, 4) };
  const result = aggregateToolFragments([first, second], {}, null);
  expect(result).toHaveLength(1);
  expect(result[0].blocks.filter(block => block.type === 'tool')).toHaveLength(10);
  expect(result[0].presentationMembers).toEqual([first, second]);
});
it('respects user, prose, reasoning, attachments, turns and model alternatives', () => {
  const a = fragment('a'), b = fragment('b');
  for (const boundary of [
    { ...fragment('u'), role: 'user' },
    { ...fragment('p'), blocks: [{ id: 'p', type: 'main_text', content: 'hello' }] },
    { ...fragment('t'), blocks: [{ id: 't', type: 'thinking', content: 'reason' }] },
    { ...fragment('i'), imageAttachments: [{ url: 'image' }] },
  ]) expect(aggregateToolFragments([a, boundary, b], {}, null)).toHaveLength(3);
  for (const key of ['modelId', 'askId', 'turnId', 'groupId']) {
    expect(aggregateToolFragments([{ ...a, [key]: 'one' }, { ...b, [key]: 'two' }], {}, null)).toHaveLength(2);
  }
  expect(aggregateToolFragments([a, { ...b, blocks: [{ id: 'empty', type: 'main_text', content: '  ' }, ...b.blocks] }], {}, null)).toHaveLength(1);
});
it('recomputes grouped presentation when live Redux gains prose', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const messages = [fragment('a'), { ...fragment('b'), storeAssistantMessageId: 'live-b' }];
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<MessageGroup role="assistant" messages={messages} />));
  expect(container.querySelectorAll('[data-testid="item"]')).toHaveLength(1);
  expect(container.textContent).toBe('2 calls');
  await act(async () => store.dispatch({ messages: { entities: { 'live-b': { blocks: ['prose', 'b-tool'] } } },
    messageBlocks: { entities: { prose: { id: 'prose', type: 'main_text', content: 'boundary' }, 'b-tool': tool('b-tool') } } }));
  expect(container.querySelectorAll('[data-testid="item"]')).toHaveLength(2);
  await act(async () => store.dispatch({ messages: { entities: { 'live-b': { blocks: ['b-tool', 'c-tool'] } } },
    messageBlocks: { entities: { 'b-tool': tool('b-tool'), 'c-tool': tool('c-tool') } } }));
  expect(container.querySelectorAll('[data-testid="item"]')).toHaveLength(1);
  expect(container.textContent).toBe('3 calls');
  await act(async () => root.unmount());
});
