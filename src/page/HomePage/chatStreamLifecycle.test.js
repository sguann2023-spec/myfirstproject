import { describe, expect, it, vi } from 'vitest';
import { createChannelEventStream } from '../../renderer/src/services/messageStreaming/channelStream';
import { completeAfterDrain, preserveHydratedMessageBodies, normalizeLiveMessageModel, ownsChatCompletion } from './chatStreamLifecycle';

describe('chat stream completion', () => {
  it('drains a real channel consumer before detaching the live message', async () => {
    const channel = createChannelEventStream();
    const snapshot = { content: '', usage: null };
    const finished = (async () => {
      const reader = channel.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await Promise.resolve();
        if (value.type === 'text-delta') snapshot.content += value.text;
        if (value.type === 'finish') snapshot.usage = value.totalUsage;
      }
    })();
    channel.pushChunk({ type: 'text-delta', text: 'last body' });
    channel.pushChunk({ type: 'finish', totalUsage: { totalTokens: 7 } });
    let detached;
    await completeAfterDrain({ streamController: { ...channel, finished } }, () => {
      detached = { ...snapshot, storeAssistantMessageId: null };
    });
    expect(detached).toEqual({ content: 'last body', usage: { totalTokens: 7 }, storeAssistantMessageId: null });
  });
  it('closes once and snapshots/releases only after the last queued chunk is consumed', async () => {
    let drain;
    const events = [];
    const pending = { streamController: {
      complete: vi.fn(() => events.push('close')),
      finished: new Promise((resolve) => { drain = resolve; })
    } };
    const done = completeAfterDrain(pending, () => events.push('snapshot', 'release'));
    completeAfterDrain(pending, () => events.push('duplicate'));
    expect(events).toEqual(['close']);
    events.push('last-text', 'usage');
    drain();
    await done;
    expect(events).toEqual(['close', 'last-text', 'usage', 'snapshot', 'release']);
    expect(pending.streamController.complete).toHaveBeenCalledTimes(1);
  });
  it('also finalizes requests without a renderer controller', async () => {
    const finalize = vi.fn();
    await completeAfterDrain({}, finalize);
    expect(finalize).toHaveBeenCalledOnce();
  });
});

it('does not let an old request clear a newer request state', async () => {
  let drain;
  const old = { chatId: 'chat', streamController: { complete() {}, finished: new Promise((resolve) => { drain = resolve; }) } };
  const pending = new Map([['old', old]]);
  const cleanup = vi.fn();
  const done = completeAfterDrain(old, () => {
    if (ownsChatCompletion(pending, 'old', old)) cleanup();
  });
  pending.set('new', { chatId: 'chat' });
  drain();
  await done;
  expect(cleanup).not.toHaveBeenCalled();
  pending.delete('new');
  pending.set('old', { chatId: 'chat' });
  expect(ownsChatCompletion(pending, 'old', old)).toBe(false);
});

it('refreshes model metadata without detaching live Redux blocks', () => {
  const message = { storeAssistantMessageId: 'live', blocks: [{ status: 'streaming' }], content: '', modelId: 'm' };
  const result = normalizeLiveMessageModel(message, [], () => ({ id: 'm', name: 'Updated' }));
  expect(result.storeAssistantMessageId).toBe('live');
  expect(result.blocks).toBe(message.blocks);
  expect(result.model.name).toBe('Updated');
  expect(message.model).toBeUndefined();
});

describe('history body preservation', () => {
  it('merges accounting without erasing the same-ID body or blocks', () => {
    const current = [{ id: 'a', content: 'final text', blocks: [{ type: 'main_text', content: 'final text' }] }];
    const [result] = preserveHydratedMessageBodies([{ id: 'a', content: ' ', blocks: [], usage: { tokens: 42 } }], current);
    expect(result.content).toBe('final text');
    expect(result.blocks).toEqual(current[0].blocks);
    expect(result.usage).toEqual({ tokens: 42 });
  });
  it('does not replace visible blocks with accounting-only blocks', () => {
    const blocks = [{ type: 'main_text', content: 'visible body' }];
    const [result] = preserveHydratedMessageBodies(
      [{ id: 'a', content: '', blocks: [{ type: 'usage' }], usage: { tokens: 9 } }],
      [{ id: 'a', content: 'visible body', blocks }]
    );
    expect(result.content).toBe('visible body');
    expect(result.blocks).toBe(blocks);
    expect(result.usage.tokens).toBe(9);
  });
  it('protects live messages and accepts nonempty persisted replacements', () => {
    const live = { id: 'a', storeAssistantMessageId: 'redux-id', content: 'live' };
    expect(preserveHydratedMessageBodies([{ id: 'a', content: 'stale' }], [live])[0]).toBe(live);
    expect(preserveHydratedMessageBodies([{ id: 'b', content: 'saved' }], [{ id: 'b', content: 'local' }])[0].content).toBe('saved');
  });
});
