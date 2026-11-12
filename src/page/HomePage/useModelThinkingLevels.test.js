// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveModelThinkingLevels, useModelThinkingLevels } from './useModelThinkingLevels';
import { SendQueue } from '../../components/Chat/sendQueue';

const options = [
  { value: 'a', thinking_levels: ['low', 'high'], thinking_default: 'high' },
  { value: 'b', thinking_levels: ['minimal', 'auto'], thinking_default: 'auto' },
  { value: 'unsupported' }
];
describe('session-bound model thinking preferences and queued snapshots', () => {
  let root, container, levels, select, saved;
  function Harness(props) {
    const [savedLevels, setSavedLevels] = useState({});
    saved = savedLevels;
    [levels, select] = useModelThinkingLevels({
      options,
      savedLevels,
      onLevelsChange: (modelId, level) => setSavedLevels((prev) => ({ ...prev, [modelId]: level })),
      ...props
    });
    return null;
  }
  const render = async (props = {}) => act(async () => root.render(createElement(Harness, props)));
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  it('uses valid catalog defaults and stores per-model choices on the session', async () => {
    await render();
    expect(levels).toEqual({ a: 'high', b: 'auto' });
    expect(saved).toEqual({});
    await act(async () => select('a', 'low'));
    await act(async () => select('b', 'minimal'));
    await act(async () => select('a', 'invalid'));
    expect(levels).toEqual({ a: 'low', b: 'minimal' });
    expect(saved).toEqual({ a: 'low', b: 'minimal' });
  });
  it('keeps stored session preferences while loading then validates changed catalogs', async () => {
    await render({ options: [], savedLevels: { a: 'low', b: 'minimal' } });
    expect(levels).toEqual({});
    await render({ savedLevels: { a: 'low', b: 'minimal' } });
    expect(levels.a).toBe('low');
    await render({ options: [{ value: 'a', thinking_levels: ['medium', 'high'], thinking_default: 'invalid' }], savedLevels: { a: 'low' } });
    expect(levels).toEqual({ a: 'medium' });
  });
  it('handles malformed session preference maps', async () => {
    await render({ savedLevels: 'not json' });
    expect(levels).toEqual({ a: 'high', b: 'auto' });
    await render({ savedLevels: ['low'] });
    expect(levels).toEqual({ a: 'high', b: 'auto' });
    await render({ savedLevels: null });
    expect(levels).toEqual({ a: 'high', b: 'auto' });
  });
  it('resolveModelThinkingLevels tolerates missing saved maps', () => {
    expect(resolveModelThinkingLevels(null, options)).toEqual({ a: 'high', b: 'auto' });
    expect(resolveModelThinkingLevels(undefined, options)).toEqual({ a: 'high', b: 'auto' });
  });
  it('freezes each queued model/level and leaves legacy absence unset on dispatch and restore', async () => {
    await render();
    const queue = new SendQueue();
    const snapshot = { queueModel: 'a', thinkingLevel: levels.a };
    queue.enqueue('s', 'first', snapshot);
    queue.enqueue('s', 'legacy', { queueModel: 'b' });
    snapshot.thinkingLevel = 'low';
    await act(async () => select('a', 'low'));
    let complete;
    const send = vi.fn((text, payload) => { complete = payload.onQueueComplete; });
    queue.pump('s', send);
    expect(send.mock.calls[0][1]).toMatchObject({ queueModel: 'a', thinkingLevel: 'high' });
    complete('aborted');
    const legacy = queue.state('s').items[0];
    const restore = vi.fn(() => true);
    expect(queue.restore('s', legacy.id, restore)).toBe(true);
    expect(restore.mock.calls[0][0].options).not.toHaveProperty('thinkingLevel');
    queue.enqueue('s', 'legacy dispatch', { queueModel: 'b' });
    queue.resume('s');
    queue.pump('s', send);
    expect(send.mock.calls[1][1]).not.toHaveProperty('thinkingLevel');
  });
});