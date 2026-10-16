// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import TimeInput, { formatClipTime, parseClipTime } from './TimeInput';

let root;
let container;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});
async function render(value = '01:02:03.45') {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const commit = vi.fn();
  function Harness() {
    const [time, setTime] = useState(value);
    return <TimeInput value={time} onChange={setTime} onCommit={commit} aria-label="时间" />;
  }
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
  return { input: container.querySelector('input'), commit };
}
const key = async (input, key) => act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
const selected = input => input.value.slice(input.selectionStart, input.selectionEnd);

it('支持秒、分秒和时分秒输入，校验分钟秒数进位', () => {
  expect(formatClipTime(3723.45)).toBe('01:02:03.45');
  expect(formatClipTime(59.999)).toBe('01:00.00');
  expect(parseClipTime('01:02:03.45')).toBe(3723.45);
  expect(parseClipTime('12:03.45')).toBe(723.45);
  expect(parseClipTime('3.123456')).toBe(3.123456);
  expect(parseClipTime('01:60:03')).toBeNaN();
  expect(parseClipTime('00:60')).toBeNaN();
});

it('点击时间段可单独选中时分秒，左右键切段，上下键调整', async () => {
  const { input, commit } = await render();
  await act(async () => input.focus());
  expect(selected(input)).toBe('01:02:03.45');
  input.setSelectionRange(4, 4);
  await act(async () => input.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
  expect(selected(input)).toBe('02');
  await key(input, 'ArrowUp');
  expect(input.value).toBe('01:03:03.45');
  expect(selected(input)).toBe('03');
  await key(input, 'ArrowRight');
  expect(selected(input)).toBe('03');
  await key(input, 'ArrowDown');
  expect(input.value).toBe('01:03:02.45');
  await key(input, 'ArrowRight');
  expect(selected(input)).toBe('45');
  await key(input, 'ArrowUp');
  expect(input.value).toBe('01:03:02.46');
  await key(input, 'ArrowLeft');
  await key(input, 'ArrowLeft');
  await key(input, 'ArrowLeft');
  expect(selected(input)).toBe('01');
  await key(input, 'ArrowUp');
  expect(input.value).toBe('02:03:02.46');
  expect(commit).not.toHaveBeenCalled();
  await key(input, 'Enter');
  expect(commit).toHaveBeenCalledOnce();
});

it('秒数跨分钟时保持选段，调整不产生负时间', async () => {
  const { input } = await render('00:59.00');
  input.setSelectionRange(3, 5);
  await key(input, 'ArrowUp');
  expect(input.value).toBe('01:00.00');
  expect(selected(input)).toBe('00');
  await key(input, 'ArrowDown');
  expect(input.value).toBe('00:59.00');
});
