import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AttachmentUploadCards from './AttachmentUploadCards';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(props = {}) {
  act(() => root.render(<AttachmentUploadCards {...props} />));
  return Array.from(host.querySelectorAll('button'));
}

describe('AttachmentUploadCards', () => {
  it('renders exactly two accessible upload buttons with matching decorative plus icons', () => {
    const buttons = render();

    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.textContent)).toEqual(['参考', '素材']);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['上传参考', '上传素材']);
    expect(host.querySelector('.chat-panel__attachment-upload-cards')).not.toBeNull();
    expect(host.querySelector('input')).toBeNull();

    for (const button of buttons) {
      expect(button.type).toBe('button');
      expect(button.disabled).toBe(false);
      expect(button.tabIndex).toBe(0);
      const icon = button.querySelector('svg.lucide-plus');
      expect(icon).not.toBeNull();
      expect(icon.getAttribute('stroke-width')).toBe('2');
      expect(icon.getAttribute('stroke')).toBe('#9c9d9e');
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.getAttribute('focusable')).toBe('false');
    }
    expect(buttons[0].querySelector('svg').innerHTML).toBe(buttons[1].querySelector('svg').innerHTML);
  });

  it('passes the selected purpose once per click, including clicks on card content', () => {
    const onSelect = vi.fn();
    const [reference, material] = render({ onSelect });

    act(() => reference.click());
    act(() => material.querySelector('span').click());

    expect(onSelect.mock.calls).toEqual([['reference'], ['material']]);
  });

  it('disables both buttons and prevents selection', () => {
    const onSelect = vi.fn();
    const buttons = render({ onSelect, disabled: true });

    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      act(() => button.click());
      act(() => button.querySelector('span').click());
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('responds to disabled changes without losing the purpose callbacks', () => {
    const onSelect = vi.fn();
    render({ onSelect, disabled: true });
    const buttons = render({ onSelect, disabled: false });

    for (const button of buttons) {
      expect(button.disabled).toBe(false);
      act(() => button.click());
    }
    expect(onSelect.mock.calls).toEqual([['reference'], ['material']]);
  });

  it('uses keyboard-focusable native buttons without submitting an enclosing form', () => {
    const onSelect = vi.fn();
    const onSubmit = vi.fn((event) => event.preventDefault());
    act(() => root.render(<form onSubmit={onSubmit}><AttachmentUploadCards onSelect={onSelect} /></form>));

    for (const button of host.querySelectorAll('button')) {
      button.focus();
      expect(document.activeElement).toBe(button);
      act(() => button.click());
    }
    expect(onSelect.mock.calls).toEqual([['reference'], ['material']]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('can render and be clicked without an optional selection handler', () => {
    const buttons = render();
    expect(() => act(() => buttons.forEach((button) => button.click()))).not.toThrow();
  });
});
