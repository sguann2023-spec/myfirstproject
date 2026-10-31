import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act, useMemo, useSyncExternalStore } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import permissionsReducer, { toolPermissionsActions as permissions } from '../../renderer/src/store/toolPermissions';
import { isChatSessionAwaitingConfirmation, isChatSessionCompleted } from '../../shared/chatSessionCompletion';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatHistoryList from './ChatHistoryList';

const renderCounts = vi.hoisted(() => ({ group: vi.fn(), row: vi.fn() }));
vi.mock('lucide-react', async (importOriginal) => {
  const icons = await importOriginal();
  return {
    ...icons,
    Folder: (props) => { renderCounts.group(); return <icons.Folder {...props} />; },
    X: (props) => { renderCounts.row(); return <icons.X {...props} />; },
  };
});

describe('waiting for AskUserQuestion confirmation', () => {
  const request = { requestId: 'q1', toolName: 'AskUserQuestion', toolCallId: 'runtime-1:call', input: {}, createdAt: 1 };

  it.each(['pending', 'submitting-allow', 'submitting-deny', 'invoking'])('derives %s without changing busy/completion semantics', (status) => {
    const current = { runtimeSessionId: 'runtime-1', isPending: true, isFulfilled: true };
    const requests = { q1: { ...request, status } };
    expect(isChatSessionAwaitingConfirmation(current, requests)).toBe(status !== 'invoking');
    expect(isChatSessionCompleted(current)).toBe(false);
    expect(current.isPending).toBe(true);
    expect(isChatSessionAwaitingConfirmation({ ...current, isPending: false }, requests)).toBe(false);
  });

  it('matches only the exact runtime namespace, not the selected chat or raw IDs', () => {
    const requests = { q1: { ...request, status: 'pending' } };
    for (const runtimeSessionId of ['', 'runtime', 'runtime-10', 'other']) {
      expect(isChatSessionAwaitingConfirmation({ runtimeSessionId, isPending: true }, requests)).toBe(false);
    }
    for (const override of [{ toolName: 'Bash' }, { autoApprove: true }, { toolCallId: 'call' }]) {
      expect(isChatSessionAwaitingConfirmation({ runtimeSessionId: 'runtime-1', isPending: true }, { q1: { ...requests.q1, ...override } })).toBe(false);
    }
  });

  it('reacts to real Redux transitions through the HomePage subscription and list projection', async () => {
    const store = configureStore({ reducer: { toolPermissions: permissionsReducer } });
    // Run the actual HomePage hooks/projection rather than a parallel test implementation.
    const home = fs.readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
    const projection = home.slice(home.indexOf('  const toolPermissionRequests = useSyncExternalStore('), home.indexOf('\n\n  useEffect(() => {\n    chatSessionsRef.current = chatSessions;', home.indexOf('  const toolPermissionRequests = useSyncExternalStore(')));
    const derive = new Function('useSyncExternalStore', 'useMemo', 'appStore', 'chatSessions', 'chatSessionInFlightMap', 'chatSessionFulfilledMap', 'isChatSessionAwaitingConfirmation', 'isChatSessionCompleted', `${projection}; return chatSessionsWithStatus;`);
    const chats = [
      { ...session, runtimeSessionId: 'runtime-1' },
      { id: 's2', title: '另一个会话', runtimeSessionId: 'runtime-10' }
    ];
    let busy = { s1: true, s2: true };
    let activeId = 's2';
    const select = vi.fn(), remove = vi.fn();
    function ConnectedList() {
      const sessions = derive(useSyncExternalStore, useMemo, store, chats, busy, {}, isChatSessionAwaitingConfirmation, isChatSessionCompleted);
      return <ChatHistoryList sessions={sessions} activeSessionId={activeId} onSelectSession={select} onDeleteSession={remove} />;
    }
    const render = () => act(async () => root.render(<ConnectedList />));
    const dispatch = (action) => act(async () => { store.dispatch(action); });
    const badge = () => container.querySelector('.chat-history-list__confirmation-badge');
    await render(); expect(badge()).toBeNull();
    await dispatch(permissions.requestReceived(request));
    expect(badge().textContent).toBe('等待确认');
    expect(badge().previousElementSibling.textContent).toBe('会话');
    expect(container.querySelectorAll('.chat-history-list__confirmation-badge')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="对话中"]')).toHaveLength(2);
    activeId = 's1'; await render(); expect(badge()).not.toBeNull();
    await click(badge()); expect(select).toHaveBeenLastCalledWith('s1');
    await click(badge().parentElement.querySelector('[aria-label="删除会话"]'));
    expect(remove).toHaveBeenCalledWith('s1'); expect(select).toHaveBeenCalledTimes(1);
    await dispatch(permissions.submissionSent({ requestId: 'q1', behavior: 'allow' })); expect(badge()).not.toBeNull();
    await dispatch(permissions.submissionFailed({ requestId: 'q1' })); expect(badge()).not.toBeNull();
    await dispatch(permissions.submissionSent({ requestId: 'q1', behavior: 'allow' }));
    await dispatch(permissions.requestResolved({ requestId: 'q1', behavior: 'allow', reason: 'response' }));
    expect(badge()).toBeNull(); expect(container.querySelectorAll('[aria-label="对话中"]')).toHaveLength(2);
    await dispatch(permissions.requestReceived(request));
    busy = { s1: false, s2: true }; await render(); expect(badge()).toBeNull();
    busy = { s1: true, s2: true }; await render();
    await dispatch(permissions.requestResolved({ requestId: 'q1', behavior: 'deny', reason: 'aborted' })); expect(badge()).toBeNull();
    await dispatch(permissions.requestReceived(request));
    await dispatch(permissions.clearPending()); expect(badge()).toBeNull();
    await dispatch(permissions.requestReceived(request));
    await dispatch(permissions.removeByToolCallId({ toolCallId: request.toolCallId })); expect(badge()).toBeNull();
  });
});

let container, root, rename;
const session = { id: 's1', title: '会话', accessible_paths: ['/work/old'], configuration: { selected_workspace_path: '/work/old' } };
const click = async (element) => act(async () => element.click());
const input = () => container.querySelector('input[aria-label="工作空间名称"]');
const key = async (value, extra = {}, element = input()) => act(async () => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }));
});
const blur = async (element = input()) => act(async () => {
  element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
});
async function change(value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function open() { await click(container.querySelector('[aria-label="重命名工作空间"]')); }
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.toast = { error: vi.fn() };
  rename = vi.fn().mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<ChatHistoryList sessions={[session]} onRenameWorkspace={rename} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); delete window.toast; });

describe('history render isolation', () => {
  const makeSessions = () => Array.from({ length: 100 }, (_, index) => ({
    id: `perf-${index}`, title: `Chat ${index}`, createdAt: index + 1,
    lastUserMessageAt: index + 1, accessible_paths: [`/work/group-${index}`],
    isPending: false, isFulfilled: false,
  }));
  const resetCounts = () => { renderCounts.group.mockClear(); renderCounts.row.mockClear(); };

  it('skips groups and rows for message-only changes while using the latest callbacks', async () => {
    const sessions = makeSessions();
    const oldSelect = vi.fn(), newSelect = vi.fn(), newDelete = vi.fn();
    await act(async () => root.render(<ChatHistoryList sessions={sessions} onSelectSession={oldSelect} />));
    resetCounts();
    await act(async () => root.render(<ChatHistoryList
      sessions={sessions.map(item => ({ ...item, messages: [{ role: 'assistant', content: 'updated' }], updatedAt: 999 }))}
      onSelectSession={newSelect} onDeleteSession={newDelete} />));
    expect(renderCounts.group).not.toHaveBeenCalled();
    expect(renderCounts.row).not.toHaveBeenCalled();
    await click(container.querySelector('.chat-history-list__item:not(.chat-history-list__group-toggle)'));
    expect(newSelect).toHaveBeenCalledExactlyOnceWith('perf-99');
    expect(oldSelect).not.toHaveBeenCalled();
    await click(container.querySelector('[aria-label="删除会话"]'));
    expect(newDelete).toHaveBeenCalledExactlyOnceWith('perf-99');
    expect(newSelect).toHaveBeenCalledTimes(1);
  });

  it('renders only the changed workspace and row when a session completes', async () => {
    const sessions = makeSessions();
    await act(async () => root.render(<ChatHistoryList sessions={sessions.map(item => ({ ...item, isPending: item.id === 'perf-50' }))} />));
    resetCounts();
    await act(async () => root.render(<ChatHistoryList sessions={sessions.map(item => ({ ...item, isFulfilled: item.id === 'perf-50' }))} />));
    expect(renderCounts.group).toHaveBeenCalledTimes(1);
    expect(renderCounts.row).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="对话中"]')).toBeNull();
    expect(container.querySelectorAll('[aria-label="已完成"]')).toHaveLength(1);
  });

  it('does not rerender session rows while editing a workspace name', async () => {
    await act(async () => root.render(<ChatHistoryList sessions={makeSessions()} onRenameWorkspace={rename} />));
    await open();
    resetCounts();
    await change('new workspace');
    expect(renderCounts.group).toHaveBeenCalledTimes(1);
    expect(renderCounts.row).not.toHaveBeenCalled();
    await key('Enter');
    expect(rename).toHaveBeenCalledWith('/work/group-99', 'new workspace');
  });
});

describe('workspace inline rename', () => {
  it('replaces the original title in its row, focuses and selects without a portal', async () => {
    const title = container.querySelector('.chat-history-list__group-title');
    const row = title.parentElement;
    await open();
    expect(row.contains(input())).toBe(true);
    expect(container.querySelector('.chat-history-list__group-title')).toBeNull();
    expect(document.querySelector('[role="dialog"], .chat-history-rename__mask')).toBeNull();
    expect(document.activeElement).toBe(input());
    expect(input().value).toBe('old');
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe(3);
    expect(container.querySelector('.chat-history-list__group-toggle').classList.contains('is-expanded')).toBe(true);
  });

  it('saves a trimmed new name through the backend callback on Enter', async () => {
    await open(); await change('  renamed  '); await key('Enter');
    expect(rename).toHaveBeenCalledExactlyOnceWith('/work/old', 'renamed');
    expect(input()).toBeNull();
  });

  it('saves on blur', async () => {
    await open(); await change('new'); await blur();
    expect(rename).toHaveBeenCalledExactlyOnceWith('/work/old', 'new');
    expect(input()).toBeNull();
  });

  it('guards Enter plus blur in the same event batch and disables while pending', async () => {
    let resolve;
    rename.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await open(); await change('new');
    const editor = input();
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(rename).toHaveBeenCalledExactlyOnceWith('/work/old', 'new');
    expect(input().readOnly).toBe(true);
    await key('Escape');
    expect(input()).not.toBeNull();
    await act(async () => resolve());
    expect(input()).toBeNull();
  });

  it('cancels on Escape before a following blur can submit', async () => {
    await open(); await change('discard');
    const editor = input();
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(rename).not.toHaveBeenCalled();
    expect(input()).toBeNull();
    expect(container.querySelector('.chat-history-list__group-title').textContent).toBe('old');
    await open(); expect(input().value).toBe('old');
  });

  it.each(['Enter', 'blur'])('rejects whitespace-only names on %s', async (action) => {
    await open(); await change('   ');
    if (action === 'blur') await blur(); else await key(action);
    expect(rename).not.toHaveBeenCalled();
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('[role=alert]').textContent).toContain('请输入');
  });

  it('does not submit unchanged names', async () => {
    await open(); await key('Enter');
    expect(rename).not.toHaveBeenCalled();
    expect(input()).toBeNull();
  });

  it('shows inline failures, retains the draft and allows for a successful retry', async () => {
    rename.mockRejectedValueOnce(new Error('同名目录已存在'));
    await open(); await change('new'); await key('Enter');
    expect(container.querySelector('[role=alert]').textContent).toContain('同名目录已存在');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().disabled).toBe(false);
    expect(input().value).toBe('new');
    expect(document.activeElement).toBe(input());
    await change('retry'); await key('Enter');
    expect(rename).toHaveBeenLastCalledWith('/work/old', 'retry');
    expect(rename).toHaveBeenCalledTimes(2);
    expect(input()).toBeNull();
  });

  it('handles non-Error rejection with a fallback toast and allows cancelling', async () => {
    rename.mockRejectedValueOnce(null);
    await open(); await change('new'); await blur();
    expect(container.querySelector('[role=alert]').textContent).toContain('重命名失败');
    expect(input().disabled).toBe(false);
    await key('Escape'); expect(input()).toBeNull();
  });

  it('stops editing clicks and keyboard events from bubbling to the group', async () => {
    await open();
    const group = container.querySelector('.chat-history-list__group-toggle');
    const ancestorKey = vi.fn();
    document.addEventListener('keydown', ancestorKey);
    document.addEventListener('keyup', ancestorKey);
    await click(input()); await key(' ');
    await act(async () => input().dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })));
    expect(ancestorKey).not.toHaveBeenCalled();
    expect(group.classList.contains('is-expanded')).toBe(true);
    expect(rename).not.toHaveBeenCalled();
    document.removeEventListener('keydown', ancestorKey);
    document.removeEventListener('keyup', ancestorKey);
  });

  it('does not submit Enter used to confirm an IME composition', async () => {
    await open(); await change('新名称'); await key('Enter', { isComposing: true });
    expect(rename).not.toHaveBeenCalled();
    expect(input()).not.toBeNull();
    await key('Enter'); expect(rename).toHaveBeenCalledExactlyOnceWith('/work/old', '新名称');
  });
});

it('limits pasted astral Unicode to 20 codepoints without splitting surrogates', async () => {
  await open(); await change('😀'.repeat(21));
  expect(input().value).toBe('😀'.repeat(20));
  await key('Enter'); expect(rename).toHaveBeenCalledWith('/work/old', '😀'.repeat(20));
});
it.each(['a/b', 'CON', '..'])('shows an inline invalid-name error for %s', async (name) => {
  await open(); await change(name); await blur();
  expect(rename).not.toHaveBeenCalled();
  expect(input().getAttribute('aria-invalid')).toBe('true');
  expect(container.querySelector('[role=alert]').textContent).toContain('有效');
});
it('does not steal focus on failed blur and retries the same draft', async () => {
  rename.mockRejectedValueOnce(new Error('后端失败'));
  await open(); await change('retry');
  const outside = document.createElement('button'); document.body.appendChild(outside);
  await act(async () => outside.focus());
  expect(document.activeElement).toBe(outside);
  expect(input().value).toBe('retry');
  expect(container.querySelector('[role=alert]').textContent).toContain('后端失败');
  await key('Enter'); expect(rename).toHaveBeenCalledTimes(2);
  outside.remove();
});
it('does not truncate IME mid-composition, submit or cancel it; caps on completion', async () => {
  await open();
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await change('中'.repeat(21));
  expect(input().value).toBe('中'.repeat(21));
  await key('Enter'); await key('Escape'); await blur();
  expect(rename).not.toHaveBeenCalled(); expect(input()).not.toBeNull();
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  expect(input().value).toBe('中'.repeat(20));
  await key('Enter', { keyCode: 229 }); expect(rename).not.toHaveBeenCalled();
  await key('Enter'); expect(rename).toHaveBeenCalledWith('/work/old', '中'.repeat(20));
});

// Execute the actual HomePage callback, preload method and IPC registration bodies.
// Only Electron transport/service boundaries are faked, not the rename callback.
function realRenameChain() {
  const read = (file) => fs.readFileSync(`${process.cwd()}/src/${file}`, 'utf8');
  const home = read('page/HomePage/HomePage.jsx');
  const ipc = read('main/services/agents/services/channels/sessionStreamIpc.ts');
  const preload = read('preload/index.ts');
  const handlers = new Map();
  const service = { renameWorkspace: vi.fn(async (source, name) => ({ source, target: `/work/${name}`, sessions: [] })) };
  const activity = { runs: 0, renaming: false };
  const controllers = new Map();
  const context = { ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    IpcChannel: { CherryChatStream_WorkspaceRename: 'rename' }, sessionService: service,
    workspaceActivity: activity, activeAbortControllers: controllers, broadcastSessionChanged: vi.fn() };
  const registration = ipc.slice(ipc.indexOf('  let workspaceMutationPending = false'), ipc.indexOf('  ipcMain.handle(LegacyChannels.SessionCreate, guardWorkspaceRequest'));
  vm.runInNewContext(ts.transpileModule(registration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const method = preload.match(/renameWorkspace: (.*),\n/)[1];
  const bridge = vm.runInNewContext(ts.transpileModule(`const rename = ${method}; rename`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { ipcRenderer: { invoke: (channel, payload) => handlers.get(channel)(null, payload) }, IpcChannel: context.IpcChannel });
  window.electronAPI = { cherryChatStream: { renameWorkspace: bridge } };
  const map = {};
  const state = { sessions: [session] };
  const version = { current: 0 };
  const callback = home.slice(home.indexOf('  const handleRenameWorkspace = async'), home.indexOf('  const handleDeleteWorkspace = async'));
  const handle = vm.runInNewContext(`${callback}; handleRenameWorkspace`, {
    window, CustomEvent, workspaceRenameVersionRef: version, chatSessionSendingMap: map, chatSessionInFlightMap: {},
    setChatSessions: (update) => { state.sessions = update(state.sessions); },
    readWorkspaceStore: () => ({ library: ['/work/old'], recent: [], accessTimes: {} }), writeWorkspaceStore: vi.fn()
  });
  return { handle, service, activity, map, state, version };
}
it('submits through real HomePage/preload/IPC and remaps the frontend session', async () => {
  const chain = realRenameChain();
  await act(async () => root.render(<ChatHistoryList sessions={[session]} onRenameWorkspace={chain.handle} />));
  await open(); await change('新名字'); await key('Enter');
  expect(chain.service.renameWorkspace).toHaveBeenCalledWith('/work/old', '新名字', expect.any(Function));
  expect(chain.state.sessions[0].accessible_paths).toEqual(['/work/新名字']);
  expect(chain.activity.renaming).toBe(false); expect(input()).toBeNull();
  delete window.electronAPI;
});
it('surfaces frontend/backend locks and IPC errors inline and releases the gate for retry', async () => {
  const chain = realRenameChain();
  await act(async () => root.render(<ChatHistoryList sessions={[session]} onRenameWorkspace={chain.handle} />));
  await open(); await change('新名字');
  chain.map.s1 = true; await key('Enter');
  expect(chain.service.renameWorkspace).not.toHaveBeenCalled();
  expect(container.querySelector('[role=alert]').textContent).toContain('运行中');
  chain.map.s1 = false; chain.activity.runs = 1; await blur();
  expect(chain.service.renameWorkspace).not.toHaveBeenCalled();
  expect(container.querySelector('[role=alert]').textContent).toContain('运行中');
  chain.activity.runs = 0;
  chain.service.renameWorkspace.mockRejectedValueOnce(new Error('同名文件或文件夹已存在'));
  await key('Enter'); expect(input().getAttribute('aria-invalid')).toBe('true');
  expect(container.querySelector('[role=alert]').textContent).toContain('已存在');
  expect(chain.activity.renaming).toBe(false);
  await key('Enter'); expect(input()).toBeNull();
  delete window.electronAPI;
});

it('shows a Chinese error when the running preload does not expose renameWorkspace', async () => {
  const chain = realRenameChain();
  window.electronAPI = { cherryChatStream: {} };
  await act(async () => root.render(<ChatHistoryList sessions={[session]} onRenameWorkspace={chain.handle} />));
  await open(); await change('新名字'); await blur();
  expect(input().value).toBe('新名字');
  expect(container.querySelector('[role=alert]').textContent).toContain('重启或更新');
  delete window.electronAPI;
});
it('keeps the shared IPC rename gate until completion and rejects concurrent attempts', async () => {
  const chain = realRenameChain();
  let finish;
  chain.service.renameWorkspace.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const first = chain.handle('/work/old', 'new');
  expect(chain.activity.renaming).toBe(true);
  await expect(chain.handle('/work/old', 'other')).rejects.toThrow('运行中');
  expect(chain.service.renameWorkspace).toHaveBeenCalledTimes(1);
  finish({ source: '/work/old', target: '/work/new', sessions: [] });
  await first;
  expect(chain.activity.renaming).toBe(false);
  delete window.electronAPI;
});

it('hides native paths even from an older backend', async () => {
  rename.mockRejectedValueOnce(new Error("ENOENT: lstat '/private/very/long/source10_28_5'"));
  await open(); await change('new'); await key('Enter');
  const alert = container.querySelector('[role=alert]');
  expect(alert.textContent).toBe('重命名失败，请刷新后重试');
  expect(alert.title).not.toContain('/private');
  const css = fs.readFileSync(`${process.cwd()}/src/components/ChatHistoryList/ChatHistoryList.css`, 'utf8');
  expect(css).toMatch(/__rename-error\s*\{[^}]*position: absolute/s);
  expect(css).toMatch(/__rename-error\s*\{[^}]*white-space: nowrap/s);
});

it('ignores late workspace hydration responses after rename, including queued state updates', async () => {
  const home = fs.readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
  const start = home.indexOf('      const workspaceVersion = workspaceRenameVersionRef.current;');
  const body = home.slice(start, home.indexOf('\n    });', start));
  let resolve, queued;
  const chain = realRenameChain();
  const version = chain.version;
  const state = { ...session, runtimeSessionId: 'runtime-1' };
  const run = () => new Function('workspaceRenameVersionRef', 'chatId', 'runtimeSessionId', 'chatWorkspaceMetaHydratingRef', 'window', 'cancelled', 'normalizeLocalPath', 'chatWorkspaceHydrationSuppressedRef', 'logger', 'setChatSessions', body)(
    version, 's1', 'runtime-1', { current: new Set() },
    { electronAPI: { cherryChatStream: { getSession: () => new Promise(done => { resolve = done; }) } } },
    false, x => x || '', { current: new Set() }, { info() {}, debug() {} }, update => { queued = update; });
  run(); await chain.handle('/work/old', 'new');
  resolve({ session }); await Promise.resolve(); await Promise.resolve();
  expect(queued).toBeUndefined();
  run(); resolve({ session }); await Promise.resolve(); await Promise.resolve();
  expect(queued).toBeTypeOf('function');
  await chain.handle('/work/new', 'newer');
  const renamed = { ...state, accessible_paths: ['/work/new'] };
  expect(queued([renamed])[0]).toBe(renamed);
  delete window.electronAPI;
});
