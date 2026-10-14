// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TemplatePickerDialog from './TemplatePickerDialog';

let root;
let container;
const getComputedStyle = window.getComputedStyle.bind(window);
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom cannot measure pseudo-element scrollbars used by Antd's modal.
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
  window.matchMedia = vi.fn(() => ({
    matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it('选择后才通知打开指定模版', async () => {
  const onSelect = vi.fn();
  await act(async () => root.render(<TemplatePickerDialog open onClose={vi.fn()} onSelect={onSelect} />));
  expect(onSelect).not.toHaveBeenCalled();
  const cards = document.querySelectorAll('.template-picker-card');
  expect(cards).toHaveLength(3);
  await act(async () => cards[0].click());
  expect(onSelect).toHaveBeenLastCalledWith('empty');
  await act(async () => cards[1].click());
  expect(onSelect).toHaveBeenLastCalledWith('sentence-image');
  expect(cards[2].textContent).toContain('混排演示');
  expect(cards[2].querySelectorAll('.template-picker-mixed-clip')).toHaveLength(4);
  await act(async () => cards[2].click());
  expect(onSelect).toHaveBeenLastCalledWith('mixed-track');
});

it('取消不创建模版', async () => {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  await act(async () => root.render(<TemplatePickerDialog open onClose={onClose} onSelect={onSelect} />));
  await act(async () => document.querySelector('.ant-modal-close').click());
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
});
