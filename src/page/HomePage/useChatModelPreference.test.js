// @vitest-environment jsdom
import { act, createElement, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatModelPreference } from './useChatModelPreference';

const initialOptions = [{ value: 'gpt-5.3-codex' }, { value: 'claude-opus-4-7' }];
const remoteOptions = [{ value: 'qwen3.8-flash' }, { value: 'glm-5.3' }, ...initialOptions];

describe('useChatModelPreference (session-bound)', () => {
  let root;
  let container;
  let selectModel;
  let savedBySession;

  // Simulates HomePage: each session stores its own model; switching sessions
  // swaps savedModel, and onModelChange writes back to the active session only.
  function ModelPreference({ sessionId = 's1', ...props }) {
    const [saved, setSaved] = useState({});
    savedBySession = saved;
    const [model, setModel] = useChatModelPreference({
      fallbackModel: 'gpt-5.3-codex',
      options: initialOptions,
      defaultModel: 'qwen3.8-flash',
      listLoaded: false,
      savedModel: saved[sessionId],
      onModelChange: (value) => setSaved((prev) => ({ ...prev, [sessionId]: value })),
      ...props
    });
    selectModel = setModel;
    return createElement('div', null, model);
  }

  const render = async (props = {}) => {
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(ModelPreference, props)));
    });
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    localStorage.clear();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it('keeps the session model before and after the dynamic model list arrives', async () => {
    await render({ options: remoteOptions, listLoaded: false });
    await act(async () => selectModel('glm-5.3'));
    await render();
    expect(container.textContent).toBe('glm-5.3');

    await render({ options: remoteOptions, listLoaded: true });
    expect(container.textContent).toBe('glm-5.3');
    expect(savedBySession.s1).toBe('glm-5.3');
  });

  it('binds a user selection to the active session only', async () => {
    await render({ options: remoteOptions, listLoaded: true });
    await act(async () => selectModel('glm-5.3'));
    expect(container.textContent).toBe('glm-5.3');
    expect(savedBySession).toEqual({ s1: 'glm-5.3' });

    // Switching to another session must not inherit s1's choice.
    await render({ options: remoteOptions, listLoaded: true, sessionId: 's2' });
    expect(container.textContent).toBe('qwen3.8-flash');
    expect(savedBySession).toEqual({ s1: 'glm-5.3', s2: 'qwen3.8-flash' });

    // Switching back restores s1's own model.
    await render({ options: remoteOptions, listLoaded: true, sessionId: 's1' });
    expect(container.textContent).toBe('glm-5.3');
  });

  it('uses the server default for a session without a saved model', async () => {
    await render();
    expect(savedBySession).toEqual({});
    await render({ options: remoteOptions, listLoaded: true });
    expect(container.textContent).toBe('qwen3.8-flash');
    expect(savedBySession).toEqual({ s1: 'qwen3.8-flash' });
  });

  it('falls back only after a successful list confirms the session model is unavailable', async () => {
    await render({ options: remoteOptions, listLoaded: true });
    await act(async () => selectModel('glm-5.3'));
    await render({ options: [{ value: 'qwen3.8-flash' }], listLoaded: true });
    expect(container.textContent).toBe('qwen3.8-flash');
    expect(savedBySession.s1).toBe('qwen3.8-flash');
  });

  it('uses the first available model when the server default is unavailable', async () => {
    await render({ options: remoteOptions, defaultModel: 'missing', listLoaded: true });
    expect(container.textContent).toBe('qwen3.8-flash');
  });

  it('does not bind a model when loading fails or returns no usable models', async () => {
    await render({ options: remoteOptions, listLoaded: true });
    await act(async () => selectModel('glm-5.3'));
    await render({ options: [...initialOptions], listLoaded: false });
    expect(savedBySession.s1).toBe('glm-5.3');
    await render({ options: [], listLoaded: true });
    expect(container.textContent).toBe('glm-5.3');
    expect(savedBySession.s1).toBe('glm-5.3');
  });

  it('ignores selections outside the offered options', async () => {
    await render({ options: remoteOptions, listLoaded: true });
    await act(async () => selectModel('not-offered'));
    expect(savedBySession.s1).toBe('qwen3.8-flash');
  });
});