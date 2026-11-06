import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useArtifactAutoPreview } from './useArtifactAutoPreview';

let container;
let root;
let onOpen;
const draft = { draftId: 'draft-a', clientRequestId: 'request-a', createdAt: 1, status: 'completed' };
const Harness = (props) => { useArtifactAutoPreview(props); return null; };
const render = async (drafts, sessionId = 'chat-a', extra = {}) => {
  await act(async () => root.render(
    <React.StrictMode><Harness sessionId={sessionId} drafts={drafts} {...extra} onOpen={() => onOpen()} /></React.StrictMode>
  ));
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onOpen = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('artifact auto preview', () => {
  it('does not activate restored documents but activates new manual documents', async () => {
    await render([], 'chat-a', { documents: [] });
    await render([], 'chat-a', { documents: [{ id: 'old', filePath: '/a.md', restoredArtifact: true }] });
    expect(onOpen).not.toHaveBeenCalled();
    await render([], 'chat-a', { documents: [{ id: 'old', filePath: '/a.md', restoredArtifact: true }, { id: 'new', filePath: '/b.html' }] });
    expect(onOpen).toHaveBeenCalledOnce();
  });
  it('does not open historical artifacts on mount or ordinary rerenders', async () => {
    await render([draft]);
    await render([{ ...draft }]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens for the first artifact and for updates to the same draft', async () => {
    await render([]);
    await render([draft]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    const modifying = { ...draft, createdAt: 2, clientRequestId: 'request-b', status: 'in_progress' };
    await render([modifying]);
    expect(onOpen).toHaveBeenCalledTimes(2);
    await render([{ ...modifying, status: 'completed' }]);
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('opens when adding another artifact', async () => {
    await render([draft]);
    await render([{ ...draft, draftId: 'draft-b' }, draft]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('ignores metadata and track-preview cache updates', async () => {
    await render([draft]);
    await render([{ ...draft, title: 'Resolved title', cover: 'cover.jpg', updated_at: 3, trackPreview: { tracks: [] } }]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not open on session switches, including returning to an updated background session', async () => {
    await render([draft]);
    await render([], 'chat-b');
    await render([{ ...draft, createdAt: 2 }]);
    expect(onOpen).not.toHaveBeenCalled();
    await render([{ ...draft, createdAt: 3 }]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('does not reopen after closing until the next event, and ignores an empty list', async () => {
    await render([]);
    await render([draft]);
    onOpen.mockClear();
    await render([{ ...draft }]);
    expect(onOpen).not.toHaveBeenCalled();
    await render([{ ...draft, createdAt: 2 }]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    onOpen.mockClear();
    await render([]);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

it('opens audio-only additions and updates but ignores player state and duplicate events', async () => {
  const audio = { id: 'a', runtimeSessionId: 'r', audioUrl: 'a.mp3', createdAt: 1, status: 'completed' };
  await render([]);
  await render([], 'chat-a', { audios: [audio] });
  expect(onOpen).toHaveBeenCalledTimes(1);
  await render([], 'chat-a', { audios: [{ ...audio, isPlaying: true, currentTime: 3 }] });
  expect(onOpen).toHaveBeenCalledTimes(1);
  await render([], 'chat-a', { audios: [{ ...audio, audioUrl: 'b.mp3' }] });
  expect(onOpen).toHaveBeenCalledTimes(2);
});
it('baselines audio history loading and switching sessions', async () => {
  const audio = { id: 'a', audioUrl: 'a.mp3', createdAt: 1, status: 'completed' };
  await render([], 'chat-a', { historyLoading: true });
  await render([], 'chat-a', { audios: [audio], historyLoading: true });
  await render([], 'chat-a', { audios: [audio], historyLoading: false });
  await render([], 'chat-b', { audios: [audio] });
  await render([], 'chat-a', { audios: [{ ...audio, createdAt: 2 }] });
  expect(onOpen).not.toHaveBeenCalled();
});

it('opens image additions and URL changes, not timestamp-only redelivery', async () => {
  const image = { id: 't', taskId: 't', runtimeSessionId: 'r', imageUrl: 'a.png', createdAt: 1, status: 'completed' };
  await render([]);
  await render([], 'chat-a', { images: [image] });
  expect(onOpen).toHaveBeenCalledTimes(1);
  await render([], 'chat-a', { images: [{ ...image, createdAt: 99, previewVisible: true }] });
  expect(onOpen).toHaveBeenCalledTimes(1);
  await render([], 'chat-a', { images: [{ ...image, imageUrl: 'b.png' }] });
  expect(onOpen).toHaveBeenCalledTimes(2);
  await render([], 'chat-a', { images: [image, { ...image, id: 'next', taskId: 'next' }] });
  expect(onOpen).toHaveBeenCalledTimes(3);
});
it('baselines image history, session switches and empty lists', async () => {
  const image = { id: 't', runtimeSessionId: 'r', imageUrl: 'a.png', status: 'completed' };
  await render([], 'chat-a', { images: [image] });
  await render([], 'chat-a', { images: [image], historyLoading: true });
  await render([], 'chat-a', { images: [{ ...image, imageUrl: 'b.png' }], historyLoading: false });
  await render([], 'chat-b', { images: [image] });
  await render([], 'chat-a', { images: [{ ...image, imageUrl: 'c.png' }] });
  await render([]);
  expect(onOpen).not.toHaveBeenCalled();
});
