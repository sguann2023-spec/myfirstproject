import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const captures = vi.hoisted(() => ({ voiceProps: null, setVoiceLibraryOpen: vi.fn() }));
vi.mock('../../../../api/digital_human', () => ({ createDigitalHumanAvatarLibrary: vi.fn() }));
vi.mock('../../../../api/sts', () => ({ uploadDigitalHumanAvatarCover: vi.fn() }));
vi.mock('antd', () => ({
  Image: () => null,
  message: {},
  Spin: () => null,
  Upload: ({ children }) => children,
}));
vi.mock('../VoiceLib', () => ({
  default: (props) => { captures.voiceProps = props; return null; },
  useVoiceLib: () => ({ setVoiceLibraryOpen: captures.setVoiceLibraryOpen, selectedVoiceLibraryItem: null }),
}));
import CreateDigitalHumanAvatorDialog from './index';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('keeps the voice popup at the dialog root rather than the inline control and preserves close/name interactions', () => {
  const onClose = vi.fn();
  const onNameChange = vi.fn();
  act(() => root.render(<CreateDigitalHumanAvatorDialog open name="数字形象" onClose={onClose} onNameChange={onNameChange} />));
  const dialog = document.querySelector('.chat-panel__digital-human-create-dialog');
  const control = dialog.querySelector('.chat-panel__digital-human-create-inline-control--voice');
  const trigger = document.createElement('span');
  control.append(trigger);
  expect(captures.voiceProps.getPopupContainer(trigger)).toBe(dialog);
  expect(captures.voiceProps.placement).toBeUndefined();
  expect(captures.voiceProps.selectedTextPrefix).toBe('');
  expect(dialog.querySelector('input').value).toBe('数字形象');
  act(() => dialog.click());
  expect(onClose).not.toHaveBeenCalled();
  act(() => dialog.querySelector('.chat-panel__digital-human-create-cancel').click());
  expect(onClose).toHaveBeenCalledOnce();
  act(() => root.render(<CreateDigitalHumanAvatorDialog open={false} />));
  expect(captures.setVoiceLibraryOpen).toHaveBeenLastCalledWith(false);
  expect(document.querySelector('.chat-panel__digital-human-create-dialog')).toBeNull();
});
