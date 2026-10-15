// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_MODEL_KEY, useChatModelPreference } from './useChatModelPreference';

const initialOptions = [{ value: 'gpt-5.3-codex' }, { value: 'claude-opus-4-7' }];
const remoteOptions = [{ value: 'qwen3.8-flash' }, { value: 'glm-5.3' }, ...initialOptions];

describe('useChatModelPreference', () => {
  let root;
  let container;
  let selectModel;
  let onError;
  let writes;

  function ModelPreference(props) {
    const [model, setModel] = useChatModelPreference({
      fallbackModel: 'gpt-5.3-codex',
      options: initialOptions,
      defaultModel: 'qwen3.8-flash',
      listLoaded: false,
      onError,
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
    onError = vi.fn();
    writes = vi.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    localStorage.clear();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it('keeps GLM before and after the dynamic model list arrives', async () => {
    localStorage.setItem(CHAT_MODEL_KEY, 'glm-5.3');
    writes.mockClear();
    await render();
    expect(container.textContent).toBe('glm-5.3');
    expect(writes).not.toHaveBeenCalled();

    await render({ options: remoteOptions, listLoaded: true });
    expect(container.textContent).toBe('glm-5.3');
    expect(localStorage.getItem(CHAT_MODEL_KEY)).toBe('glm-5.3');
  });

  it('persists a user selection and restores it on the next mount', async () => {
    await render({ options: remoteOptions, listLoaded: true });
    await act(async () => selectModel('glm-5.3'));
    expect(localStorage.getItem(CHAT_MODEL_KEY)).toBe('glm-5.3');

    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toBe('glm-5.3');
    await render({ options: remoteOptions, listLoaded: true });
    expect(container.textContent).toBe('glm-5.3');
  });

  it('uses the server default when there is no saved preference', async () => {
    await render();
    expect(localStorage.getItem(CHAT_MODEL_KEY)).toBeNull();
    await render({ options: remoteOptions, listLoaded: true });
    expect(container.textContent).toBe('qwen3.8-flash');
    expect(localStorage.getItem(CHAT_MODEL_KEY)).toBe('qwen3.8-flash');
  });

  it('falls back only after a successful list confirms the saved model is unavailable', async () => {
    localStorage.setItem(CHAT_MODEL_KEY, 'removed-model');
    await render();
    expect(localStorage.getItem(CHAT_MODEL_KEY)).toBe('removed-model');
    await render({ options: remoteOptions, listLoaded: true });
    expect(container.textContent).toBe('qwen3.8-flash');
    expect(localStorage.getItem(CHAT_MODEL_KEY)).toBe('qwen3.8-flash');
  });

  it('uses the first available model when the server default is unavailable', async () => {
    await render({ options: remoteOptions, defaultModel: 'missing', listLoaded: true });
    expect(container.textContent).toBe('qwen3.8-flash');
  });

  it('does not overwrite the preference when loading fails or returns no usable models', async () => {
    localStorage.setItem(CHAT_MODEL_KEY, 'glm-5.3');
    writes.mockClear();
    await render();
    await render({ options: [...initialOptions], listLoaded: false });
    expect(localStorage.getItem(CHAT_MODEL_KEY)).toBe('glm-5.3');
    expect(writes).not.toHaveBeenCalled();
    await render({ options: [], listLoaded: true });
    expect(container.textContent).toBe('glm-5.3');
    expect(localStorage.getItem(CHAT_MODEL_KEY)).toBe('glm-5.3');
    expect(writes).not.toHaveBeenCalled();
  });

  it('saves an explicit user choice even when the remote list failed', async () => {
    localStorage.setItem(CHAT_MODEL_KEY, 'glm-5.3');
    await render();
    await act(async () => selectModel('claude-opus-4-7'));
    expect(container.textContent).toBe('claude-opus-4-7');
    expect(localStorage.getItem(CHAT_MODEL_KEY)).toBe('claude-opus-4-7');
  });

  it('reports storage failures without preventing model selection', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    writes.mockImplementation(() => { throw new Error('storage unavailable'); });
    await render({ options: remoteOptions, listLoaded: true });
    expect(container.textContent).toBe('qwen3.8-flash');
    expect(onError).toHaveBeenCalledWith('Failed to load chat model settings.', expect.any(Error));
    expect(onError).toHaveBeenCalledWith('Failed to persist chat model settings.', expect.any(Error));
  });
});
