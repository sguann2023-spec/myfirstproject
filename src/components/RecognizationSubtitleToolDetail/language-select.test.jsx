import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import RecognizationSubtitleToolDetail, { buildSubtitleRecognitionRequest } from './index';

vi.mock('../../api/pricing', () => ({
  getSubtitleRecognitionPricing: vi.fn(async () => ({ success: true, prices: [] })),
}));
vi.mock('../../api/sts', () => ({ uploadToOSSWithProgress: vi.fn() }));

let root;
let container;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

it('opens the real Antd language menu above the settings popover and submits a selection', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('matchMedia', () => ({
    matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onSettingsChange = vi.fn();
  await act(async () => root.render(<RecognizationSubtitleToolDetail
    settings={{ mediaSource: '/video.mp4' }} onSettingsChange={onSettingsChange} />));

  const checkbox = document.querySelector('input[aria-label="启用语言"]');
  expect(checkbox.checked).toBe(false);
  expect(document.querySelector('[aria-label="识别语言"]')).toBeNull();
  await act(async () => checkbox.click());
  const select = document.querySelector('.chat-panel__subtitle-language-select');
  expect(select).not.toBeNull();
  expect(select.classList.contains('ant-select-disabled')).toBe(false);
  await act(async () => {
    select.querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  const menu = document.querySelector('.chat-panel__subtitle-language-dropdown');
  expect(menu).not.toBeNull();
  expect(menu.classList.contains('ant-select-dropdown-hidden')).toBe(false);
  const option = [...menu.querySelectorAll('.ant-select-item-option')].find((node) => node.textContent === '英语');
  expect(option).toBeDefined();
  await act(async () => option.click());
  expect(select.textContent).toContain('英语');
  expect(buildSubtitleRecognitionRequest(onSettingsChange.mock.calls.at(-1)[0]).language).toBe('en-US');
  await act(async () => checkbox.click());
  expect(select.classList.contains('ant-select-disabled')).toBe(true);
  expect(buildSubtitleRecognitionRequest(onSettingsChange.mock.calls.at(-1)[0])).not.toHaveProperty('language');
});
