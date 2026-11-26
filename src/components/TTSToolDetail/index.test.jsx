import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const captures = vi.hoisted(() => ({ dropdown: null, voiceProps: null }));
vi.mock('antd', () => ({
  Dropdown: (props) => { captures.dropdown = props; return props.children; },
  Tooltip: ({ children }) => children,
}));
vi.mock('../Chat/Composer/VoiceLib', () => ({
  default: (props) => { captures.voiceProps = props; return null; },
  useVoiceLib: () => ({ selectedVoiceLibraryItem: { global_voice_id: 'voice-1', providers: 'minimax' } }),
}));
import TTSToolDetail from './index';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('opens both voice and model choices above the bottom toolbar while retaining model/back callbacks and pricing', () => {
  const onModelChange = vi.fn();
  const onBack = vi.fn();
  act(() => root.render(
    <TTSToolDetail selectedModel="speech-2.6-turbo" onModelChange={onModelChange} onBack={onBack} inputText="测试朗读" />
  ));
  expect(captures.dropdown.placement).toBe('topLeft');
  expect(captures.voiceProps.placement).toBe('topLeft');
  expect(captures.dropdown.menu.selectedKeys).toEqual(['speech-2.6-turbo']);
  act(() => captures.dropdown.menu.items[1].onClick());
  expect(onModelChange).toHaveBeenLastCalledWith('speech-2.6-hd');
  expect(container.querySelector('.chat-panel__tts-model-price-text').textContent).toBe('4.8积分');
  act(() => container.querySelector('[aria-label="AI朗读"]').click());
  expect(onBack).toHaveBeenCalledOnce();
});
