import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkSpace, { useWorkspaceController, WorkspaceDialogs } from './WorkSpace';
import WorkspaceTreeView from './WorkspaceTreeView';

const { store, notifications } = vi.hoisted(() => ({ store: new Map(), notifications: { success: vi.fn() } }));
vi.mock('../../../../shared/electronStore', () => ({ electronStore: {
  get: (key) => store.get(key), set: (key, value) => store.set(key, value),
} }));
vi.mock('antd', () => ({ message: notifications }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
let root;
let container;
let controller;
let props;
let streamCallback;
let renderSurfaces;
let treeRenderer;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
function Harness() {
  controller = useWorkspaceController(props);
  return renderSurfaces ? <>
    <WorkSpace controller={controller} renderTreeNodes={treeRenderer} />
    <WorkspaceTreeView controller={controller} renderTreeNodes={treeRenderer} />
    <WorkspaceDialogs controller={controller} />
  </> : null;
}
const render = async (updates = {}) => {
  props = { ...props, ...updates };
  await act(async () => root.render(<Harness />));
};
const start = async (callback) => {
  let result;
  await act(async () => { result = callback(); });
  return { result };
};
const settle = async (request, value) => { await act(async () => { request.resolve(value); }); };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  store.clear();
  window.localStorage.clear();
  controller = null;
  renderSurfaces = false;
  treeRenderer = vi.fn(() => <div data-tree="true">tree</div>);
  streamCallback = null;
  window.toast = { error: vi.fn(), warning: vi.fn() };
  window.modal = undefined;
  window.api = {
    getAppInfo: vi.fn().mockResolvedValue({ appDataPath: '/app' }),
    copy: vi.fn().mockResolvedValue({ success: true }),
    file: {
      selectFolder: vi.fn().mockResolvedValue('/selected'),
      listDirectory: vi.fn().mockResolvedValue([]),
      isDirectory: vi.fn().mockImplementation(async (path) => !path.includes('.')),
      checkFileName: vi.fn().mockImplementation(async (_parent, name) => ({ safeName: name, requestedExists: false })),
      mkdir: vi.fn().mockResolvedValue(undefined),
      openPath: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      getPathForFile: vi.fn((file) => `/source/${file.name}`),
      deleteExternalFile: vi.fn().mockResolvedValue(undefined),
      deleteExternalDir: vi.fn().mockResolvedValue(undefined),
      showInFolder: vi.fn(),
    },
  };
  window.electronAPI = {
    path: { join: (...parts) => parts.join('/') },
    cherryChatStream: { onChunk: vi.fn((callback) => {
      streamCallback = callback;
      return () => { if (streamCallback === callback) streamCallback = null; };
    }) },
  };
  props = { agentId: 'agent-a', chatSessionId: 'chat-a', resolvedSessionId: '', onBindWorkspace: vi.fn().mockResolvedValue(true) };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('workspace controller operations', () => {
  it('opens and binds exactly once under rapid duplicate opens/creates, returning booleans', async () => {
    const selected = deferred();
    window.api.file.selectFolder.mockReturnValue(selected.promise);
    await render();
    const { result } = await start(() => controller.openWorkspace());
    expect(controller.busy).toBe(true);
    await expect(controller.openWorkspace()).resolves.toBe(false);
    await expect(controller.createWorkspace()).resolves.toBe(false);
    expect(window.api.file.selectFolder).toHaveBeenCalledOnce();
    await settle(selected, '/selected');
    await expect(result).resolves.toBe(true);
    expect(props.onBindWorkspace).toHaveBeenCalledWith('/selected', {});
    expect(controller.busy).toBe(false);
    expect(controller.recentWorkspacePaths[0]).toBe('/selected');
    window.api.file.selectFolder.mockResolvedValue('');
    const cancelled = await start(() => controller.openWorkspace());
    await expect(cancelled.result).resolves.toBe(false);
  });

  it.each([{ chatSessionId: 'chat-b' }, { agentId: 'agent-b' }])('ignores a native picker finishing after logical session change %j', async (change) => {
    const selected = deferred();
    window.api.file.selectFolder.mockReturnValue(selected.promise);
    await render();
    const { result } = await start(() => controller.openWorkspace());
    await render(change);
    await settle(selected, '/old-session');
    await expect(result).resolves.toBe(false);
    expect(props.onBindWorkspace).not.toHaveBeenCalled();
    expect(controller.busy).toBe(false);
  });

  it('does not treat a runtime session id appearing as a conversation change', async () => {
    const selected = deferred();
    window.api.file.selectFolder.mockReturnValue(selected.promise);
    await render();
    const { result } = await start(() => controller.openWorkspace());
    await render({ resolvedSessionId: 'runtime-created' });
    await settle(selected, '/selected');
    await expect(result).resolves.toBe(true);
    expect(props.onBindWorkspace).toHaveBeenCalledOnce();
  });

  it('ignores a bind result arriving after switching conversations', async () => {
    const bind = deferred();
    props.onBindWorkspace.mockReturnValue(bind.promise);
    await render();
    const { result } = await start(() => controller.openWorkspace());
    expect(props.onBindWorkspace).toHaveBeenCalledOnce();
    await render({ chatSessionId: 'chat-b' });
    await settle(bind, true);
    await expect(result).resolves.toBe(false);
    expect(controller.recentWorkspacePaths).not.toContain('/selected');
  });

  it('waits for confirmation, creates under the remembered agent parent, and binds with skills seeded', async () => {
    store.set('workspaceParentDirByAgent', { 'agent-a': '/remembered' });
    await render();
    const { result } = await start(() => controller.createWorkspace());
    expect(controller.createWorkspaceDialogOpen).toBe(true);
    expect(controller.createWorkspaceParentDir).toBe('/remembered');
    expect(window.api.getAppInfo).not.toHaveBeenCalled();
    expect(props.onBindWorkspace).not.toHaveBeenCalled();
    await act(async () => controller.changeCreateWorkspaceName('My workspace'));
    let submitted;
    await act(async () => { submitted = controller.handleCreateWorkspace(); });
    await expect(submitted).resolves.toBe(true);
    await expect(result).resolves.toBe(true);
    expect(window.api.file.mkdir).toHaveBeenCalledWith('/remembered/My workspace');
    expect(props.onBindWorkspace).toHaveBeenCalledWith('/remembered/My workspace', { seedSkills: true });
    expect(controller.createWorkspaceDialogOpen).toBe(false);
    expect(controller.busy).toBe(false);
  });

  it('preserves name validation and supports retry without resolving create prematurely', async () => {
    window.api.file.checkFileName.mockResolvedValueOnce({ requestedExists: true });
    await render();
    const { result } = await start(() => controller.createWorkspace());
    const resolved = vi.fn();
    result.then(resolved);
    expect(controller.createWorkspaceParentDir).toBe('/app/Data/Workspaces/agent-a');
    await act(async () => controller.changeCreateWorkspaceName('taken'));
    await act(async () => { await controller.handleCreateWorkspace(); });
    expect(controller.createWorkspaceNameError).toContain('已被占用');
    expect(window.api.file.mkdir).not.toHaveBeenCalled();
    expect(resolved).not.toHaveBeenCalled();
    await act(async () => controller.changeCreateWorkspaceName('available'));
    expect(controller.createWorkspaceNameError).toBe('');
    await act(async () => { await controller.handleCreateWorkspace(); });
    await expect(result).resolves.toBe(true);
  });

  it('updates and remembers the parent folder picker', async () => {
    await render();
    const { result } = await start(() => controller.createWorkspace());
    window.api.file.selectFolder.mockResolvedValue('/custom-parent');
    await act(async () => { await controller.handlePickWorkspaceParentDir(); });
    expect(controller.createWorkspaceParentDir).toBe('/custom-parent');
    expect(store.get('workspaceParentDirByAgent')['agent-a']).toBe('/custom-parent');
    act(() => controller.closeCreateWorkspaceDialog());
    await expect(result).resolves.toBe(false);
  });

  it.each(['close', 'session', 'unmount'])('cancels pending create on %s and never opens a late dialog', async (reason) => {
    const appInfo = deferred();
    window.api.getAppInfo.mockReturnValue(appInfo.promise);
    await render();
    const { result } = await start(() => controller.createWorkspace());
    if (reason === 'close') act(() => controller.closeCreateWorkspaceDialog());
    if (reason === 'session') await render({ chatSessionId: 'chat-b' });
    if (reason === 'unmount') { act(() => root.unmount()); root = null; }
    await expect(result).resolves.toBe(false);
    await settle(appInfo, { appDataPath: '/old-app' });
    expect(controller.createWorkspaceDialogOpen).toBe(false);
    expect(props.onBindWorkspace).not.toHaveBeenCalled();
  });

  it.each(['checkFileName', 'mkdir'])('does not continue stale creation after awaiting %s', async (method) => {
    const pending = deferred();
    window.api.file[method].mockReturnValue(pending.promise);
    await render();
    const { result } = await start(() => controller.createWorkspace());
    await act(async () => controller.changeCreateWorkspaceName('new'));
    const submit = await start(() => controller.handleCreateWorkspace());
    await render({ agentId: 'agent-b' });
    await expect(result).resolves.toBe(false);
    await settle(pending, method === 'checkFileName' ? { safeName: 'new' } : undefined);
    await expect(submit.result).resolves.toBe(false);
    expect(props.onBindWorkspace).not.toHaveBeenCalled();
    if (method === 'checkFileName') expect(window.api.file.mkdir).not.toHaveBeenCalled();
  });

  it('guards duplicate confirmation before React rerenders', async () => {
    const check = deferred();
    window.api.file.checkFileName.mockReturnValue(check.promise);
    await render();
    const created = await start(() => controller.createWorkspace());
    await act(async () => controller.changeCreateWorkspaceName('new'));
    let first;
    let second;
    await act(async () => {
      first = controller.handleCreateWorkspace();
      second = controller.handleCreateWorkspace();
    });
    await expect(second).resolves.toBe(false);
    expect(window.api.file.checkFileName).toHaveBeenCalledOnce();
    await settle(check, { safeName: 'new' });
    await expect(first).resolves.toBe(true);
    await expect(created.result).resolves.toBe(true);
  });

  it('keeps the lock and dialog on failed binding, then permits cancellation', async () => {
    props.onBindWorkspace.mockResolvedValue(false);
    await render();
    const created = await start(() => controller.createWorkspace());
    await act(async () => controller.changeCreateWorkspaceName('new'));
    await act(async () => { await controller.handleCreateWorkspace(); });
    expect(controller.createWorkspaceDialogOpen).toBe(true);
    expect(controller.busy).toBe(true);
    expect(controller.createWorkspaceSubmitting).toBe(false);
    await expect(controller.openWorkspace()).resolves.toBe(false);
    act(() => controller.closeCreateWorkspaceDialog());
    await expect(created.result).resolves.toBe(false);
    expect(controller.busy).toBe(false);
  });

  it('cancels an in-flight confirmation without allowing its completion to affect a reopened dialog', async () => {
    const check = deferred();
    window.api.file.checkFileName.mockReturnValueOnce(check.promise);
    await render();
    const oldCreate = await start(() => controller.createWorkspace());
    await act(async () => controller.changeCreateWorkspaceName('old'));
    const oldSubmit = await start(() => controller.handleCreateWorkspace());
    act(() => controller.closeCreateWorkspaceDialog());
    await expect(oldCreate.result).resolves.toBe(false);
    const nextCreate = await start(() => controller.createWorkspace());
    await settle(check, { safeName: 'old' });
    await expect(oldSubmit.result).resolves.toBe(false);
    expect(controller.createWorkspaceDialogOpen).toBe(true);
    expect(controller.busy).toBe(true);
    expect(window.api.file.mkdir).not.toHaveBeenCalled();
    act(() => controller.closeCreateWorkspaceDialog());
    await expect(nextCreate.result).resolves.toBe(false);
  });

  it('preserves guide refs on the existing create button and singleton dialog', async () => {
    const buttonRef = React.createRef();
    const dialogRef = React.createRef();
    const inputRef = React.createRef();
    function Guided() {
      controller = useWorkspaceController(props);
      return <>
        <WorkSpace controller={controller} renderTreeNodes={treeRenderer} beginnerGuideCreateWorkspaceButtonRef={buttonRef} />
        <WorkspaceDialogs controller={controller} beginnerGuideWorkspaceDialogRef={dialogRef} beginnerGuideWorkspaceNameInputRef={inputRef} />
      </>;
    }
    await act(async () => root.render(<Guided />));
    expect(buttonRef.current.textContent).toContain('新建工作空间');
    act(() => buttonRef.current.click());
    await flush();
    expect(dialogRef.current.getAttribute('role')).toBe('dialog');
    expect(inputRef.current.placeholder).toBe('空间名称');
    act(() => controller.closeCreateWorkspaceDialog());
  });

  it('accepts optional events and defaults Finder to the current workspace', async () => {
    await render({ currentWorkspacePath: '/bound', hasLockedWorkspace: true });
    await controller.openWorkspaceInFinder();
    await controller.openWorkspaceInFinder(undefined, '/another');
    expect(window.api.file.openPath.mock.calls).toEqual([['/bound'], ['/another']]);
    await act(async () => { await controller.refreshWorkspaceTree(); });
    expect(window.api.file.listDirectory).toHaveBeenCalledWith('/bound', expect.any(Object));
  });
});

describe('workspace controller trees and shared surfaces', () => {
  it('loads bound trees and refreshes from tools while the sidebar is collapsed', async () => {
    vi.useFakeTimers();
    await render({ currentWorkspacePath: '/bound', hasLockedWorkspace: true, resolvedSessionId: 'runtime' });
    expect(window.api.file.listDirectory).toHaveBeenCalledOnce();
    act(() => controller.toggleWorkspaceExpanded());
    expect(controller.workspaceExpanded).toBe(false);
    act(() => streamCallback({ type: 'chunk', sessionId: 'runtime', chunk: { type: 'tool-result', toolName: 'Write', input: { file_path: '/bound/a.txt' } } }));
    await act(async () => { vi.advanceTimersByTime(120); });
    expect(window.api.file.listDirectory).toHaveBeenCalledTimes(2);
    act(() => streamCallback({ type: 'chunk', sessionId: 'other', chunk: { type: 'tool-result', toolName: 'Bash' } }));
    await act(async () => { vi.advanceTimersByTime(120); });
    expect(window.api.file.listDirectory).toHaveBeenCalledTimes(2);
  });

  it('does not let an older tree response replace a newer refresh or clear its loading state', async () => {
    const first = deferred();
    const second = deferred();
    window.api.file.listDirectory.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render({ currentWorkspacePath: '/bound', hasLockedWorkspace: true });
    const refreshed = await start(() => controller.refreshWorkspaceTree());
    await settle(first, ['stale.txt']);
    expect(controller.workspaceTreeLoading['/bound']).toBe(true);
    expect(controller.workspaceTrees['/bound']).toBeUndefined();
    await settle(second, ['fresh.txt']);
    await refreshed.result;
    expect(controller.workspaceTrees['/bound'].map((node) => node.name)).toEqual(['fresh.txt']);
    expect(controller.workspaceTreeLoading['/bound']).toBe(false);
  });

  it('keeps the newer tree when an older response rejects after it completes', async () => {
    const oldTree = deferred();
    window.api.file.listDirectory.mockReturnValueOnce(oldTree.promise).mockResolvedValue(['fresh.txt']);
    await render({ currentWorkspacePath: '/bound', hasLockedWorkspace: true });
    await act(async () => { await controller.refreshWorkspaceTree(); });
    await act(async () => { oldTree.reject(new Error('stale failure')); });
    expect(controller.workspaceTrees['/bound'].map((node) => node.name)).toEqual(['fresh.txt']);
    expect(controller.workspaceTreeLoading['/bound']).toBe(false);
  });

  it('reloads bound trees correctly under StrictMode effect replay', async () => {
    props = { ...props, currentWorkspacePath: '/bound', hasLockedWorkspace: true };
    window.api.file.listDirectory.mockResolvedValue(['strict.txt']);
    await act(async () => root.render(<React.StrictMode><Harness /></React.StrictMode>));
    expect(controller.workspaceTrees['/bound'].map((node) => node.name)).toEqual(['strict.txt']);
    expect(controller.workspaceTreeLoading['/bound']).toBe(false);
  });

  it('ignores old directory checks and logical-session tree responses', async () => {
    const check = deferred();
    window.api.file.listDirectory.mockResolvedValueOnce(['old.txt']).mockResolvedValue(['new.txt']);
    window.api.file.isDirectory.mockImplementation(async (path) => path === '/bound/old.txt' ? check.promise : !path.includes('.'));
    await render({ currentWorkspacePath: '/bound', hasLockedWorkspace: true });
    await render({ chatSessionId: 'chat-b' });
    await settle(check, false);
    expect(controller.workspaceTrees['/bound'].map((node) => node.name)).toEqual(['new.txt']);
  });

  it('handles relative entries, directory sort, hidden skill exclusion, and rename reload', async () => {
    window.api.file.listDirectory.mockResolvedValue(['z.txt', 'folder', 'folder/a.txt', '.claude', '.claude/seed.txt', '/outside/file']);
    await render({ currentWorkspacePath: '/bound', hasLockedWorkspace: true });
    expect(controller.workspaceTrees['/bound'].map((node) => node.name)).toEqual(['folder', 'z.txt']);
    expect(controller.workspaceTrees['/bound'][0].children[0].name).toBe('a.txt');
    await act(async () => window.dispatchEvent(new Event('workspace-renamed')));
    expect(window.api.file.listDirectory).toHaveBeenCalledTimes(2);
  });

  it('shares tree rendering and one dialog/context-menu overlay between both surfaces', async () => {
    renderSurfaces = true;
    window.api.file.listDirectory.mockResolvedValue(['a.txt']);
    await render({ currentWorkspacePath: '/bound', hasLockedWorkspace: true });
    expect(document.querySelectorAll('[data-tree]')).toHaveLength(2);
    const call = treeRenderer.mock.calls.at(-1);
    expect(call.slice(0, 4)).toEqual(['workspace:/bound', '/bound', controller.workspaceTrees['/bound'], 0]);
    expect(call[4].showDeleteAction).toBe(true);
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 50, clientY: 60 };
    act(() => call[4].onContextMenu(event, { rootPath: '/bound', absolutePath: '/bound/a.txt', node: { name: 'a.txt' }, onOpen: vi.fn() }));
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    const created = await start(() => controller.createWorkspace());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    act(() => controller.closeCreateWorkspaceDialog());
    await expect(created.result).resolves.toBe(false);
  });

  it('renders loading and empty states without mounting additional overlays', async () => {
    renderSurfaces = true;
    const tree = deferred();
    window.api.file.listDirectory.mockReturnValue(tree.promise);
    await render({ currentWorkspacePath: '/bound', hasLockedWorkspace: true });
    expect(document.body.textContent).toContain('加载目录中');
    await settle(tree, []);
    expect(document.body.textContent).toContain('工作空间为空');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('copies dropped files with collision-safe names and refreshes the shared tree', async () => {
    await render({ currentWorkspacePath: '/bound', hasLockedWorkspace: true });
    window.api.file.get.mockImplementation(async (path) => path === '/bound/a.txt' ? {} : null);
    const event = {
      dataTransfer: { types: ['Files'], files: [{ name: 'a.txt' }] },
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    };
    act(() => controller.handleWorkspaceDragEnter(event));
    expect(controller.isWorkspaceDragActive).toBe(true);
    act(() => controller.handleWorkspaceDrop(event));
    await flush();
    expect(window.api.copy).toHaveBeenCalledWith('/source/a.txt', '/bound/a-1.txt');
    expect(controller.workspaceDropPending).toBe(false);
    expect(controller.isWorkspaceDragActive).toBe(false);
    expect(window.api.file.listDirectory).toHaveBeenCalledTimes(2);
  });

  it('preserves delete confirmation and refresh, ignoring confirmations from an old session', async () => {
    let confirm;
    window.modal = { confirm: vi.fn((options) => { confirm = options; }) };
    await render({ currentWorkspacePath: '/bound', hasLockedWorkspace: true });
    const entry = { absolutePath: '/bound/a.txt', node: { name: 'a.txt' }, isDirectory: false };
    const deleted = await start(() => controller.handleDeleteWorkspaceNode(entry));
    await act(async () => { confirm.onOk(); });
    await deleted.result;
    expect(window.api.file.deleteExternalFile).toHaveBeenCalledWith('/bound/a.txt');
    const stale = await start(() => controller.handleDeleteWorkspaceNode(entry));
    await render({ chatSessionId: 'chat-b' });
    await act(async () => { confirm.onOk(); });
    await stale.result;
    expect(window.api.file.deleteExternalFile).toHaveBeenCalledOnce();
  });

  it('retains recent ordering, show-more, and stale-folder cleanup', async () => {
    const paths = Array.from({ length: 7 }, (_, index) => `/recent-${index}`);
    window.localStorage.setItem('chat-workspaces:v1', JSON.stringify({ library: paths, recent: paths }));
    window.api.file.isDirectory.mockImplementation(async (path) => path !== '/recent-6');
    await render();
    expect(controller.recentWorkspacePaths).toEqual(paths.slice(0, 6));
    expect(controller.visibleRecentWorkspaces).toHaveLength(5);
    act(() => controller.setShowAllRecentWorkspaces(true));
    expect(controller.visibleRecentWorkspaces).toHaveLength(6);
    await act(async () => { await controller.bindWorkspace('/recent-4'); });
    expect(controller.recentWorkspacePaths[0]).toBe('/recent-4');
  });
});
