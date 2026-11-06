import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebPagePreview from './WebPagePreview';

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn() }) } }));
vi.mock('@renderer/utils/download', () => ({ download: vi.fn() }));
vi.mock('./ImageContextMenu', () => ({ default: () => null }));
vi.mock('./TextFilePreview', () => ({ default: () => <div data-testid="file-pane" /> }));
vi.mock('./ArtifactPreview', () => ({ default: ({ drafts = [] }) => <div data-testid="artifact-pane">{drafts.length} drafts</div> }));

const initialPreview = { key: 'quick-skill:tuangou-one-image-draft', url: 'https://www.douyin.com/video/123', title: 'Original video' };
let container;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 0; });
  Element.prototype.scrollTo = vi.fn();
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

const artifact = { key: 'chat-artifact:pinned-drafts', previewType: 'artifact', title: '产物' };
describe('artifact preview tabs', () => {
  it.each([false, true])('mounts an artifact once without browser controls (StrictMode: %s)', async (strict) => {
    await renderPreview(artifact, strict);
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].textContent).toContain('产物');
    expect(container.querySelector('[data-testid="artifact-pane"]')).not.toBeNull();
    expect(container.querySelector('.chat-web-preview__address')).toBeNull();
  });

  it('keeps web, file and artifact tabs together, reuses the key, closes and reopens', async () => {
    await renderPreview(initialPreview);
    const webTab = tabs()[0];
    await renderPreview({ key: 'file:test', previewType: 'file', name: 'test.txt' });
    await renderPreview(artifact);
    expect(tabs()).toHaveLength(3);
    const artifactTab = tabs()[2];
    await renderPreview({ ...artifact });
    expect(tabs()).toHaveLength(3);
    expect(tabs()[2]).toBe(artifactTab);
    await act(async () => webTab.click());
    expect(address()).toBe(initialPreview.url);
    await act(async () => tabs()[1].click());
    expect(container.querySelector('[data-testid="file-pane"]')).not.toBeNull();
    await act(async () => artifactTab.querySelector('.chat-web-preview__tab-close').click());
    expect(tabs()).toHaveLength(2);
    await renderPreview({ ...artifact });
    expect(tabs()).toHaveLength(3);
    expect(container.querySelector('[data-testid="artifact-pane"]')).not.toBeNull();
  });

  it('does not activate artifact background updates and forwards fresh draft data', async () => {
    await renderPreview(initialPreview);
    await renderPreview({ ...artifact, activate: false });
    expect(tabs()).toHaveLength(2);
    expect(address()).toBe(initialPreview.url);
    await act(async () => root.render(<WebPagePreview preview={artifact} artifactProps={{ drafts: [{ id: 'draft-1' }] }} />));
    expect(container.querySelector('[data-testid="artifact-pane"]').textContent).toBe('1 drafts');
    await act(async () => root.render(<WebPagePreview preview={artifact} artifactProps={{ drafts: [{ id: 'draft-1' }, { id: 'draft-2' }] }} />));
    expect(container.querySelector('[data-testid="artifact-pane"]').textContent).toBe('2 drafts');
    expect(tabs()).toHaveLength(2);
  });

  it('sends only web tabs to browser state sync', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    window.electron = { ipcRenderer: { invoke } };
    try {
      await renderPreview(initialPreview);
      await renderPreview(artifact);
      const state = invoke.mock.calls.map((call) => call[1]).filter((payload) => payload?.visible === true).at(-1);
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].url).toBe(initialPreview.url);
      expect(state.activeTabId).not.toBeNull();
    } finally {
      delete window.electron;
    }
  });
});

describe('session artifact cleanup', () => {
  it.each([true, false])('removes active and inactive artifacts while preserving web tabs (active: %s)', async (active) => {
    const render = async (preview, sessionId) => act(async () => root.render(<WebPagePreview preview={preview} sessionId={sessionId} />));
    await render(initialPreview, 'A');
    await render({ ...artifact, key: 'artifact:A', tabId: 'artifact:A' }, 'A');
    if (!active) await render(initialPreview, 'A');
    expect(tabs()).toHaveLength(2);
    await render(active ? { ...artifact, key: 'artifact:A', tabId: 'artifact:A' } : initialPreview, 'B');
    expect(tabs()).toHaveLength(1);
    expect(container.querySelector('[data-testid="artifact-pane"]')).toBeNull();
    expect(address()).toBe(initialPreview.url);
  });
});
