import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebPagePreview from './WebPagePreview';

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn() }) } }));
vi.mock('@renderer/utils/download', () => ({ download: vi.fn() }));
vi.mock('./ImageContextMenu', () => ({ default: () => null }));
vi.mock('./TextFilePreview', () => ({ default: () => null }));

const initialPreview = { key: 'quick-skill:tuangou-one-image-draft', url: 'https://www.douyin.com/video/123', title: 'Original video' };
let container;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const renderPreview = async (preview, strict = false) => {
  const element = <WebPagePreview preview={preview} />;
  await act(async () => root.render(strict ? <React.StrictMode>{element}</React.StrictMode> : element));
};
const tabs = () => container.querySelectorAll('.chat-web-preview__tab');
const address = () => container.querySelector('.chat-web-preview__address').value;

describe('manual preview tab identity', () => {
  it.each([false, true])('creates only one tab on first mount (StrictMode: %s)', async (strict) => {
    await renderPreview(initialPreview, strict);
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].classList.contains('is-active')).toBe(true);
    expect(address()).toBe(initialPreview.url);
    await renderPreview({ ...initialPreview }, strict);
    expect(tabs()).toHaveLength(1);
  });

  it('updates the same key without replacing the tab', async () => {
    await renderPreview(initialPreview);
    const originalTab = tabs()[0];
    await renderPreview({ ...initialPreview, url: 'https://m.douyin.com/share/video/456', title: 'Updated video' });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toBe(originalTab);
    expect(tabs()[0].title).toBe('Updated video');
    expect(address()).toBe('https://m.douyin.com/share/video/456');
  });

  it('opens different keys separately and reactivates the original on repeat', async () => {
    await renderPreview(initialPreview);
    const originalTab = tabs()[0];
    await renderPreview({ key: 'quick-skill:other', url: 'https://example.com/', title: 'Other video' });
    expect(tabs()).toHaveLength(2);
    expect(tabs()[1].classList.contains('is-active')).toBe(true);
    await renderPreview({ ...initialPreview });
    expect(tabs()).toHaveLength(2);
    expect(tabs()[0]).toBe(originalTab);
    expect(originalTab.classList.contains('is-active')).toBe(true);
    expect(address()).toBe(initialPreview.url);
  });

  it('does not activate a background update', async () => {
    await renderPreview(initialPreview);
    await renderPreview({ key: 'quick-skill:other', url: 'https://example.com/', title: 'Other video' });
    await renderPreview({ ...initialPreview, url: 'https://example.com/updated', activate: false });
    expect(tabs()).toHaveLength(2);
    expect(tabs()[1].classList.contains('is-active')).toBe(true);
    expect(address()).toBe('https://example.com/');
  });

  it('preserves explicit controller tab identity', async () => {
    const controlledPreview = { ...initialPreview, key: 'mcp-browser:controlled', tabId: 'controlled' };
    await renderPreview(controlledPreview);
    const originalTab = tabs()[0];
    await renderPreview({ ...controlledPreview, url: 'https://example.com/controlled' });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toBe(originalTab);
    expect(address()).toBe('https://example.com/controlled');
    await renderPreview(initialPreview);
    expect(tabs()).toHaveLength(1);
  });
});
