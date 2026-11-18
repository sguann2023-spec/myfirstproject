import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebPagePreview from './WebPagePreview';
import NewPreviewTab from './NewPreviewTab';
import InlinePreviewPane from './InlinePreviewPane';
import { IpcChannel } from '@shared/IpcChannel';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from '../../../renderer/src/i18n/locales/zh-cn.json';

i18next.use(initReactI18next).init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN } }, interpolation: { escapeValue: false } });

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn() }) } }));
vi.mock('@renderer/utils/download', () => ({ download: vi.fn() }));
vi.mock('./ImageContextMenu', () => ({ default: () => null }));
vi.mock('./WorkspacePreview', () => ({ default: ({ controller }) => <div data-testid="workspace-pane">{controller?.currentWorkspacePath}</div> }));
vi.mock('./SessionTokenStats', () => ({ default: ({ messages = [] }) => <div data-testid="stats-pane">{messages.length} messages</div> }));
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

const openEntry = async (key) => act(async () => container.querySelector(`[data-preview-entry="${key}"] button`).click());
const addTab = async () => act(async () => container.querySelector('.chat-web-preview__tab-add').click());

describe('launcher item interactions', () => {
  it.each(['workspace', 'browser', 'artifacts', 'stats'])('uses the same action for the %s row and its open button without double firing', async (key) => {
    const onOpen = vi.fn();
    await act(async () => root.render(<NewPreviewTab onOpenWorkspace={onOpen} onOpenBrowser={onOpen} onOpenArtifacts={onOpen} onOpenStats={onOpen} />));
    const entry = container.querySelector(`[data-preview-entry="${key}"]`);
    expect(entry.classList.contains('artifact-preview__item')).toBe(true);
    expect(entry.querySelector('button').classList.contains('artifact-preview__export')).toBe(true);
    await act(async () => entry.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    onOpen.mockClear();
    await act(async () => entry.querySelector('button').click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    onOpen.mockClear();
    await act(async () => entry.querySelector('h2').click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it.each(['Enter', ' '])('supports keyboard activation with %s', async (key) => {
    const onOpen = vi.fn();
    await act(async () => root.render(<NewPreviewTab onOpenBrowser={onOpen} />));
    const entry = container.querySelector('[data-preview-entry="browser"]');
    await act(async () => entry.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    expect(onOpen).toHaveBeenCalledTimes(1);
    onOpen.mockClear();
    await act(async () => entry.querySelector('button').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not activate unavailable or busy rows', async () => {
    const onOpen = vi.fn();
    await act(async () => root.render(<NewPreviewTab onOpenWorkspace={onOpen} workspaceBusy />));
    for (const key of ['workspace', 'browser', 'artifacts', 'stats']) {
      const entry = container.querySelector(`[data-preview-entry="${key}"]`);
      expect(entry.getAttribute('aria-disabled')).toBe('true');
      expect(entry.tabIndex).toBe(-1);
      await act(async () => entry.click());
      await act(async () => entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    }
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('new preview tab', () => {
  it('opens the four-entry launcher instead of browser controls', async () => {
    await renderPreview(initialPreview);
    await addTab();
    expect(tabs()).toHaveLength(2);
    expect(container.querySelector('.chat-web-preview__header')).toBeNull();
    expect(container.querySelectorAll('.chat-preview-start__entry')).toHaveLength(4);
    expect(container.querySelector('.chat-preview-start').getAttribute('aria-label')).toBe('新标签页');
    expect(container.querySelector('.chat-preview-start').hasAttribute('aria-labelledby')).toBe(false);
    expect(container.querySelector('.chat-preview-start').textContent).not.toContain('新标签页');
    expect(tabs()[1].querySelector('.chat-web-preview__tab-title').textContent).toBe('新标签页');
    expect(tabs()[1].querySelector('.lucide-globe')).toBeNull();
    const launcher = tabs()[1];
    await openEntry('browser');
    expect(tabs()).toHaveLength(3);
    expect(address()).toBe('');
    expect(container.querySelector('.chat-web-preview__address').placeholder).toBe('输入网址后回车');
    await act(async () => launcher.click());
    expect(container.querySelector('.chat-preview-start')).not.toBeNull();
    await openEntry('browser');
    expect(tabs()).toHaveLength(4);
    expect(address()).toBe('');
    expect(container.querySelector('.chat-web-preview__address').placeholder).toBe('输入网址后回车');
  });

  it('shows the optional skills section below the launcher and restores it on tab return', async () => {
    const renderSkillMembers = vi.fn(() => <><h1>我的技能</h1><button>示例技能</button></>);
    await act(async () => root.render(<WebPagePreview preview={{ previewType: 'new-tab' }} renderSkillMembers={renderSkillMembers} />));
    const launcher = tabs()[0];
    const content = container.querySelector('.chat-preview-start__content');
    const divider = content.querySelector('hr');
    const skills = content.querySelector('.chat-preview-start__skills');
    expect(content.querySelector('.chat-preview-start__entries').compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.nextElementSibling).toBe(skills);
    expect([...content.querySelectorAll('h1')].map((heading) => heading.textContent)).toEqual(['我的技能']);
    expect(skills.getAttribute('aria-label')).toBe('我的技能');
    expect(launcher.querySelector('.chat-web-preview__tab-title').textContent).toBe('新标签页');
    await openEntry('browser');
    expect(container.querySelector('.chat-preview-start__skills')).toBeNull();
    await act(async () => launcher.click());
    expect(container.querySelector('.chat-preview-start__skills').textContent).toContain('示例技能');
  });

  it('omits skills and the divider when the host has no skills renderer', async () => {
    await renderPreview({ previewType: 'new-tab' });
    expect(container.querySelector('.chat-preview-start__divider')).toBeNull();
    expect(container.querySelector('.chat-preview-start__skills')).toBeNull();
  });

  it('starts with a launcher when no preview URL is supplied', async () => {
    await renderPreview({ key: 'new-tab' }, true);
    expect(tabs()).toHaveLength(1);
    expect(container.querySelector('.chat-preview-start')).not.toBeNull();
    expect(container.querySelector('.chat-web-preview__address')).toBeNull();
  });

  it('preserves the launcher and opens a separate artifact tab on every click', async () => {
    const render = async (preview) => act(async () => root.render(<WebPagePreview preview={preview} sessionId="A" />));
    await render(initialPreview);
    await addTab();
    const launcher = tabs()[1];
    await openEntry('artifacts');
    expect(tabs()).toHaveLength(3);
    expect(container.querySelector('[data-testid="artifact-pane"]')).not.toBeNull();
    const artifactTab = tabs()[2];
    await render({ ...artifact, tabId: 'chat-artifact:pinned-drafts:A', key: 'artifact:updated' });
    expect(tabs()).toHaveLength(3);
    expect(tabs()[2]).toBe(artifactTab);
    await act(async () => launcher.click());
    await openEntry('artifacts');
    expect(tabs()).toHaveLength(4);
    expect(tabs()[3].classList.contains('is-active')).toBe(true);
    expect(artifactTab.classList.contains('is-active')).toBe(false);
  });

  it('opens statistics with current messages and removes it on session change', async () => {
    const render = async (sessionId, messages) => act(async () => root.render(
      <WebPagePreview preview={initialPreview} sessionId={sessionId} sessionMessages={messages} />
    ));
    await render('A', [{ id: '1' }]);
    const webTab = tabs()[0];
    await addTab();
    const launcher = tabs()[1];
    await openEntry('stats');
    expect(tabs()).toHaveLength(3);
    expect(container.querySelector('[data-testid="stats-pane"]').textContent).toBe('1 messages');
    expect(container.querySelector('.chat-web-preview__header')).toBeNull();
    await render('A', [{ id: '1' }, { id: '2' }]);
    expect(container.querySelector('[data-testid="stats-pane"]').textContent).toBe('2 messages');
    await act(async () => launcher.click());
    await openEntry('stats');
    expect(tabs()).toHaveLength(4);
    await render('B', []);
    expect(tabs()).toHaveLength(2);
    expect(tabs()[0]).toBe(webTab);
    expect(container.querySelector('[data-testid="stats-pane"]')).toBeNull();
    await addTab();
    await openEntry('stats');
    expect(container.querySelector('[data-testid="stats-pane"]').textContent).toBe('0 messages');
  });

  it.each(['row', 'button'])('opens a new bound workspace tab from the %s without replacing the launcher', async (target) => {
    const controller = { hasLockedWorkspace: true, currentWorkspacePath: '/tmp/project', openWorkspace: vi.fn(), createWorkspace: vi.fn() };
    await act(async () => root.render(<WebPagePreview preview={initialPreview} sessionId="A" workspaceController={controller} />));
    await addTab();
    expect(container.querySelector('[aria-label="新建工作空间"]')).toBeNull();
    const entry = container.querySelector('[data-preview-entry="workspace"]');
    await act(async () => (target === 'row' ? entry : entry.querySelector('button')).click());
    expect(controller.openWorkspace).not.toHaveBeenCalled();
    expect(tabs()).toHaveLength(3);
    expect(tabs()[2].textContent).toContain('project');
    expect(container.querySelector('[data-testid="workspace-pane"]').textContent).toBe('/tmp/project');
    await act(async () => tabs()[1].click());
    expect(container.querySelector('.chat-preview-start')).not.toBeNull();
    await openEntry('workspace');
    expect(tabs()).toHaveLength(4);
    expect(tabs()[3].classList.contains('is-active')).toBe(true);
  });

  it('shows create only when unbound and does not bubble it to open', async () => {
    const controller = { openWorkspace: vi.fn().mockResolvedValue(false), createWorkspace: vi.fn().mockResolvedValue(false) };
    await act(async () => root.render(<WebPagePreview preview={{ previewType: 'new-tab' }} sessionId="A" workspaceController={controller} />));
    await act(async () => container.querySelector('[aria-label="新建工作空间"]').click());
    expect(controller.createWorkspace).toHaveBeenCalledTimes(1);
    expect(controller.openWorkspace).not.toHaveBeenCalled();
    expect(container.querySelector('.chat-preview-start')).not.toBeNull();
    await act(async () => container.querySelector('[aria-label="打开工作空间"]').click());
    expect(controller.openWorkspace).toHaveBeenCalledTimes(1);
  });

  it.each(['open', 'create'])('preserves the launcher and adds a workspace tab only after %s succeeds', async (action) => {
    const controller = { currentWorkspacePath: '/tmp/project', openWorkspace: vi.fn().mockResolvedValue(true), createWorkspace: vi.fn().mockResolvedValue(true) };
    await act(async () => root.render(<WebPagePreview preview={initialPreview} sessionId="A" workspaceController={controller} />));
    await addTab();
    await act(async () => container.querySelector(`[aria-label="${action === 'create' ? '新建' : '打开'}工作空间"]`).click());
    expect(tabs()).toHaveLength(3);
    expect(container.querySelector('[data-testid="workspace-pane"]')).not.toBeNull();
    await act(async () => root.render(<WebPagePreview preview={{ key: 'file:test', previewType: 'file', name: 'test.txt' }} sessionId="A" workspaceController={controller} />));
    expect(tabs()).toHaveLength(4);
    expect(container.querySelector('[data-testid="file-pane"]')).not.toBeNull();
    await act(async () => tabs()[2].click());
    expect(container.querySelector('[data-testid="workspace-pane"]')).not.toBeNull();
    await act(async () => tabs()[1].click());
    expect(container.querySelector('.chat-preview-start')).not.toBeNull();
  });

  it.each(['session', 'close', 'navigate'])('ignores workspace completion after source %s changes', async (change) => {
    let finish;
    const controller = { openWorkspace: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
    const render = async (sessionId) => act(async () => root.render(<WebPagePreview preview={initialPreview} sessionId={sessionId} workspaceController={controller} />));
    await render('A');
    await addTab();
    await act(async () => container.querySelector('[aria-label="打开工作空间"]').click());
    if (change === 'session') await render('B');
    if (change === 'close') await act(async () => tabs()[1].querySelector('.chat-web-preview__tab-close').click());
    if (change === 'navigate') await openEntry('browser');
    await act(async () => finish(true));
    expect(container.querySelector('[data-testid="workspace-pane"]')).toBeNull();
  });

  it('cleans workspace tabs on session change and excludes them from browser IPC', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    window.electron = { ipcRenderer: { invoke } };
    const controller = { hasLockedWorkspace: true, currentWorkspacePath: '/tmp/project' };
    try {
      const render = async (sessionId) => act(async () => root.render(<WebPagePreview preview={initialPreview} sessionId={sessionId} workspaceController={controller} />));
      await render('A');
      await addTab();
      await openEntry('workspace');
      const state = invoke.mock.calls.map((call) => call[1]).filter((payload) => payload?.visible === true).at(-1);
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].url).toBe(initialPreview.url);
      await render('B');
      expect(tabs()).toHaveLength(2);
      expect(container.querySelector('[data-testid="workspace-pane"]')).toBeNull();
      expect(address()).toBe(initialPreview.url);
    } finally {
      delete window.electron;
    }
  });

  it('keeps the launcher usable after an open error and disables concurrent operations', async () => {
    const controller = { openWorkspace: vi.fn().mockRejectedValue(new Error('Folder chooser failed')) };
    const render = async () => act(async () => root.render(<WebPagePreview preview={{ previewType: 'new-tab' }} sessionId="A" workspaceController={controller} />));
    await render();
    await act(async () => container.querySelector('[aria-label="打开工作空间"]').click());
    expect(container.querySelector('[role="alert"]').textContent).toBe('Folder chooser failed');
    expect(container.querySelector('[aria-label="打开工作空间"]').disabled).toBe(false);
    controller.busy = true;
    await render();
    expect(container.querySelector('[aria-label="打开工作空间"]').disabled).toBe(true);
    expect(container.querySelector('[aria-label="新建工作空间"]').disabled).toBe(true);
  });

  it('closes a statistics tab and returns to its preserved launcher', async () => {
    await act(async () => root.render(<WebPagePreview preview={initialPreview} sessionId="A" />));
    await addTab();
    const launcher = tabs()[1];
    await openEntry('stats');
    await act(async () => tabs()[2].querySelector('.chat-web-preview__tab-close').click());
    expect(tabs()).toHaveLength(2);
    expect(tabs()[1]).toBe(launcher);
    expect(launcher.classList.contains('is-active')).toBe(true);
    expect(container.querySelector('.chat-preview-start')).not.toBeNull();
    expect(container.querySelector('[data-testid="stats-pane"]')).toBeNull();
  });

  it('disables session-only and file actions without a supporting host', async () => {
    await renderPreview({ previewType: 'new-tab' });
    for (const key of ['workspace', 'artifacts', 'stats']) {
      expect(container.querySelector(`[data-preview-entry="${key}"] button`).disabled).toBe(true);
    }
    expect(container.querySelector('[data-preview-entry="browser"] button').disabled).toBe(false);
  });

  it('never registers launcher or statistics tabs as browser tabs', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    window.electron = { ipcRenderer: { invoke } };
    try {
      await act(async () => root.render(<WebPagePreview preview={{ key: 'launcher', previewType: 'new-tab' }} sessionId="A" />));
      await openEntry('stats');
      const states = invoke.mock.calls.map((call) => call[1]).filter((payload) => payload?.visible === true);
      expect(states.length).toBeGreaterThan(0);
      expect(states.every((state) => state.tabs.length === 0 && state.activeTabId === null)).toBe(true);
    } finally {
      delete window.electron;
    }
  });
});

describe('preview pane visibility', () => {
  let invoke;
  let commandHandlers;

  beforeEach(() => {
    invoke = vi.fn().mockResolvedValue(null);
    commandHandlers = new Set();
    window.electron = {
      ipcRenderer: {
        invoke,
        on: vi.fn((channel, handler) => {
          if (channel === IpcChannel.BrowserPreview_Command) commandHandlers.add(handler);
        }),
        removeListener: vi.fn((channel, handler) => {
          if (channel === IpcChannel.BrowserPreview_Command) commandHandlers.delete(handler);
        })
      }
    };
  });

  afterEach(() => {
    delete window.electron;
  });

  const states = () => invoke.mock.calls
    .filter(([channel]) => channel === IpcChannel.BrowserPreview_StateSync)
    .map(([, payload]) => payload);
  const getContext = async () => {
    expect(commandHandlers.size).toBe(1);
    await act(async () => [...commandHandlers][0](null, { requestId: 'context', command: 'get_context' }));
    const response = invoke.mock.calls.filter(([channel]) => channel === IpcChannel.BrowserPreview_CommandResult).at(-1)[1];
    expect(response.ok).toBe(true);
    return response.result;
  };

  it.each([false, true])('preserves real tabs and active web content while syncing visibility without dom-ready (StrictMode: %s)', async (strict) => {
    const otherPreview = { key: 'other:web', url: 'https://example.com/other', title: 'Other page' };
    const render = async (preview, visible) => {
      const element = <WebPagePreview preview={preview} visible={visible} />;
      await act(async () => root.render(strict ? <React.StrictMode>{element}</React.StrictMode> : element));
    };
    await render(initialPreview, true);
    const webview = container.querySelector('webview');
    webview.getWebContentsId = vi.fn(() => 42);
    await render(otherPreview, true);
    const originalTabs = [...tabs()];
    const activeTab = tabs()[1];
    expect(states().at(-1)).toMatchObject({ visible: true, ready: true, activeWebContentsId: 42 });
    invoke.mockClear();

    for (const visible of [false, true]) {
      await render(otherPreview, visible);
      expect([...tabs()]).toEqual(originalTabs);
      expect(activeTab.classList.contains('is-active')).toBe(true);
      expect(address()).toBe(otherPreview.url);
      expect(container.querySelector('webview')).toBe(webview);
      expect(webview.src).toBe(otherPreview.url);
      const state = states().at(-1);
      expect(state).toMatchObject({ visible, ready: visible, activeWebContentsId: 42 });
      expect(state.tabs.map(({ url }) => url)).toEqual([initialPreview.url, otherPreview.url]);
      expect(state.tabs.find((tab) => tab.isActive)).toMatchObject({ id: state.activeTabId, url: otherPreview.url });
      const context = await getContext();
      expect(context.state).toEqual(state);
      expect(context.activeUrl).toBe(otherPreview.url);
    }
    expect(states()).toHaveLength(2);
    expect(states().every((state) => state.tabs.length === 2)).toBe(true);
  });

  it('keeps an active file pane mounted across collapse and expand without losing browser tabs', async () => {
    const filePreview = { key: 'file:visibility', previewType: 'file', name: 'notes.txt' };
    const render = async (preview, open) => act(async () => root.render(
      <InlinePreviewPane id="test-preview-pane" open={open} width={420}>
        <WebPagePreview preview={preview} visible={open} />
      </InlinePreviewPane>
    ));
    await render(initialPreview, true);
    await render(filePreview, true);
    const originalTabs = [...tabs()];
    const filePane = container.querySelector('[data-testid="file-pane"]');
    const pane = container.querySelector('#test-preview-pane');

    for (const open of [false, true]) {
      await render(filePreview, open);
      expect(container.querySelector('#test-preview-pane')).toBe(pane);
      expect(pane.getAttribute('aria-hidden')).toBe(String(!open));
      expect(pane.hasAttribute('inert')).toBe(!open);
      expect(Boolean(container.querySelector('[role="separator"]'))).toBe(open);
      expect([...tabs()]).toEqual(originalTabs);
      expect(tabs()[1].classList.contains('is-active')).toBe(true);
      expect(container.querySelector('[data-testid="file-pane"]')).toBe(filePane);
      expect(states().at(-1)).toMatchObject({ visible: open, ready: false });
      expect(states().at(-1).tabs).toHaveLength(1);
    }
  });

  it('starts hidden with browser context retained, shows without dom-ready, and clears only on unmount', async () => {
    await act(async () => root.render(<WebPagePreview preview={initialPreview} visible={false} />));
    const webview = container.querySelector('webview');
    webview.getWebContentsId = vi.fn(() => 7);
    expect(states().at(-1)).toMatchObject({ visible: false, ready: false });
    expect(states().at(-1).tabs).toHaveLength(1);
    expect((await getContext()).state).toMatchObject({ visible: false, ready: false, activeWebContentsId: 7 });

    await renderPreview(initialPreview);
    expect(states().at(-1)).toMatchObject({ visible: true, ready: true, activeWebContentsId: 7 });
    expect((await getContext()).state).toEqual(states().at(-1));
    invoke.mockClear();
    await act(async () => root.render(null));
    expect(states()).toEqual([{ visible: false, ready: false, activeTabId: null, activeWebContentsId: null, tabs: [] }]);
    expect(commandHandlers.size).toBe(0);
  });

  it('does not clear browser IPC state when URL changes rebind the webview listeners', async () => {
    await renderPreview(initialPreview);
    invoke.mockClear();
    await renderPreview({ ...initialPreview, url: 'https://example.com/updated' });
    expect(states().length).toBeGreaterThan(0);
    expect(states().every((state) => state.visible && state.tabs.length === 1)).toBe(true);
  });
});

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

const artifact = { key: 'chat-artifact:pinned-drafts', previewType: 'artifact', title: '产出' };
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
  it('closes the pane without creating a blank tab when A only has an artifact', async () => {
    const onClose = vi.fn();
    const Harness = ({ sessionId }) => {
      const [panePreview, setPanePreview] = React.useState(artifact);
      return panePreview ? (
        <WebPagePreview preview={panePreview} sessionId={sessionId} onClose={() => {
          onClose();
          setPanePreview(null);
        }} />
      ) : null;
    };
    await act(async () => root.render(<Harness sessionId="A" />));
    expect(tabs()).toHaveLength(1);
    await act(async () => root.render(<Harness sessionId="B" />));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(tabs()).toHaveLength(0);
    expect(container.querySelector('.chat-web-preview')).toBeNull();
    await act(async () => root.render(<Harness sessionId="B" />));
    expect(tabs()).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('preserves a manually created blank tab across session cleanup', async () => {
    const onClose = vi.fn();
    const render = async (sessionId) => act(async () => root.render(
      <WebPagePreview preview={artifact} sessionId={sessionId} onClose={onClose} />
    ));
    await render('A');
    await act(async () => container.querySelector('.chat-web-preview__tab-add').click());
    expect(tabs()).toHaveLength(2);
    const manualTab = tabs()[1];
    expect(container.querySelector('.chat-web-preview__address')).toBeNull();
    expect(container.querySelector('.chat-preview-start')).not.toBeNull();
    await render('B');
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toBe(manualTab);
    expect(container.querySelector('.chat-preview-start')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([true, false])('removes active and inactive artifacts while preserving web tabs (active: %s)', async (active) => {
    const onClose = vi.fn();
    const render = async (preview, sessionId) => act(async () => root.render(<WebPagePreview preview={preview} sessionId={sessionId} onClose={onClose} />));
    await render(initialPreview, 'A');
    const webTab = tabs()[0];
    await render({ ...artifact, key: 'artifact:A', tabId: 'artifact:A' }, 'A');
    if (!active) await render(initialPreview, 'A');
    expect(tabs()).toHaveLength(2);
    await render(active ? { ...artifact, key: 'artifact:A', tabId: 'artifact:A' } : initialPreview, 'B');
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toBe(webTab);
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="artifact-pane"]')).toBeNull();
    expect(address()).toBe(initialPreview.url);
  });
});
