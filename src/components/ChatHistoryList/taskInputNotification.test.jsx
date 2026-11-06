import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
const root = process.cwd();
const home = fs.readFileSync(`${root}/src/page/HomePage/HomePage.jsx`, 'utf8');
function load(relative, context) {
  const source = fs.readFileSync(`${root}/${relative}`, 'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, ...context });
  return exports;
}
describe('realtime question notification', () => {
  it('restores historical questions without dispatching a notification', () => {
    const notify = vi.fn();
    const request = { status: 'pending', input: { questions: ['restored'] } };
    const { restorePendingAskUserQuestion } = load('src/renderer/src/utils/askUserQuestionSnapshot.ts', {
      selectPendingPermission: () => request,
      resolveToolArguments: input => input,
      dispatchTaskInputRequiredNotification: notify
    });
    const restored = restorePendingAskUserQuestion({ id: 'runtime:call', tool: { name: 'AskUserQuestion' }, status: 'running' }, {});
    expect(restored.status).toBe('pending');
    expect(restored.arguments).toEqual(request.input);
    expect(notify).not.toHaveBeenCalled();
  });
  it('uses current refs once across subscriptions, excludes auto approval and ordinary permissions', async () => {
    const seenInputRequiredRequestIdsRef = { current: new Set() };
    const chatIdByAgentSessionIdRef = { current: new Map([['runtime', 's1']]) };
    const chatSessionsRef = { current: [{ id: 's1', title: 'latest' }] };
    const notify = vi.fn(), deny = vi.fn(), dispatch = vi.fn();
    const start = home.indexOf('async (payload) => {', home.indexOf('const offPermissionRequest ='));
    const end = home.indexOf('\n    });', start);
    const subscribe = () => vm.runInNewContext(`(${home.slice(start, end)}\n})`, {
      seenInputRequiredRequestIdsRef, chatIdByAgentSessionIdRef, chatSessionsRef,
      dispatchTaskInputRequiredNotification: notify,
      appStore: { dispatch, getState: () => ({ messageBlocks: { entities: {} } }) },
      toolPermissionsActions: { requestReceived: p => p },
      window: { electronAPI: { agentTools: { respondToPermission: deny } } }, logger: { error: vi.fn() }
    });
    const payload = { requestId: 'q1', toolName: 'AskUserQuestion', toolCallId: 'runtime:call' };
    await subscribe()(payload); await subscribe()(payload);
    expect(notify).toHaveBeenCalledExactlyOnceWith({ chatId: 's1', requestId: 'q1', sessionTitle: 'latest' });
    await subscribe()({ ...payload, requestId: 'auto', autoApprove: true });
    await subscribe()({ ...payload, requestId: 'bash', toolName: 'Bash' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(deny).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'deny' }));
    chatIdByAgentSessionIdRef.current = new Map([['runtime', 's2']]);
    chatSessionsRef.current = [{ id: 's2', title: 'changed' }];
    await subscribe()({ ...payload, requestId: 'q2' });
    expect(notify).toHaveBeenLastCalledWith({ chatId: 's2', requestId: 'q2', sessionTitle: 'changed' });
    expect(home.slice(start, end)).not.toContain('recordTaskFinished');
    expect(home.slice(start, end)).not.toContain('setChatSessionUnread');
    const restore = home.indexOf('? restorePendingAskUserQuestion');
    expect(home.slice(restore - 100, restore + 400)).not.toContain('dispatchTaskInputRequiredNotification');
    expect(home).toContain('const seenInputRequiredRequestIdsRef = useRef(new Set());');
  });
});
describe('renderer notification policy', () => {
  function setup() {
    const state = { enabled: true, focused: false };
    const send = vi.fn().mockResolvedValue(true), sound = vi.fn();
    const api = load('src/renderer/src/utils/taskNotification.ts', {
      loggerService: { withContext: () => ({ warn: vi.fn() }) },
      isFocused: () => state.focused, isTaskNotificationEnabled: () => state.enabled,
      playTaskNotificationSound: sound, window: { api: { notification: { send } } }
    });
    return { ...api, state, send, sound };
  }
  it('shares silent delivery and pop sound, only on explicit true', async () => {
    const c = setup();
    await c.dispatchTaskInputRequiredNotification({ chatId: 's1', requestId: 'q1', sessionTitle: 'Title' });
    expect(c.send).toHaveBeenLastCalledWith(expect.objectContaining({ silent: true, message: expect.stringContaining('Title'), meta: { kind: 'task-input-required', chatId: 's1', requestId: 'q1' } }));
    expect(c.sound).toHaveBeenCalledTimes(1);
    for (const result of [false, undefined]) {
      c.send.mockResolvedValue(result);
      await c.dispatchTaskInputRequiredNotification({ chatId: 's1', requestId: 'q2' });
    }
    c.send.mockRejectedValue(new Error('failed'));
    await c.dispatchTaskInputRequiredNotification({ chatId: 's1', requestId: 'q3' });
    expect(c.sound).toHaveBeenCalledTimes(1);
    c.send.mockResolvedValue(true);
    await c.dispatchTaskFinishedNotification({ chatId: 's1', outcome: 'error' });
    expect(c.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error', meta: { kind: 'task-finished', chatId: 's1' } }));
    expect(c.sound).toHaveBeenCalledTimes(2);
  });
  it('keeps identified task completions distinct from input-required notifications', async () => {
    const c = setup();
    for (const requestId of ['req1', 'req2']) {
      await c.dispatchTaskFinishedNotification({ chatId: 's1', outcome: 'success', requestId });
    }
    expect(c.send).toHaveBeenCalledTimes(2);
    expect(c.send.mock.calls[0][0]).toEqual(expect.objectContaining({
      id: expect.stringContaining('task-finished-req1-'), type: 'success',
      meta: { kind: 'task-finished', chatId: 's1', requestId: 'req1' }
    }));
    expect(c.send.mock.calls[1][0].id).toContain('task-finished-req2-');
  });
  it('suppresses disabled, focused, and invalid inputs', async () => {
    const c = setup();
    c.state.enabled = false; await c.dispatchTaskInputRequiredNotification({ chatId: 's1', requestId: 'q1' });
    c.state.enabled = true; c.state.focused = true;
    await c.dispatchTaskInputRequiredNotification({ chatId: 's1', requestId: 'q2' });
    c.state.focused = false;
    await c.dispatchTaskInputRequiredNotification({ chatId: '', requestId: 'q3' });
    await c.dispatchTaskInputRequiredNotification({ chatId: 's1', requestId: '' });
    expect(c.send).not.toHaveBeenCalled(); expect(c.sound).not.toHaveBeenCalled();
  });
});
describe('main notification policy', () => {
  function setup() {
    const state = { windows: [], supported: true, fail: false };
    const created = [];
    class Native {
      static isSupported() { return state.supported; }
      constructor(options) { this.options = options; this.handlers = {}; created.push(this); }
      once(name, fn) { this.handlers[name] = fn; }
      on(name, fn) { this.handlers[name] = fn; }
      show() { if (state.fail) throw new Error('native failure'); }
    }
    const main = { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn(), webContents: { send: vi.fn() } };
    const Service = load('src/main/services/NotificationService.ts', { ElectronNotification: Native,
      BrowserWindow: { getAllWindows: () => state.windows }, windowService: { getMainWindow: () => main } }).default;
    return { service: new Service(), state, created, main };
  }
  const input = (requestId = 'q1', kind = 'task-input-required') => ({ title: 'title', message: 'body', meta: { kind, chatId: 's1', requestId } });
  it('suppresses any focused live window, dedupes even suppressed events, and ignores destroyed windows', async () => {
    const c = setup();
    c.state.windows = [{ isDestroyed: () => false, isFocused: () => true }];
    expect(await c.service.sendNotification(input())).toBe(false);
    expect(await c.service.sendNotification(input('x', 'task-finished'))).toBe(false);
    c.state.windows = [{ isDestroyed: () => true, isFocused: () => { throw new Error('destroyed'); } }];
    expect(await c.service.sendNotification(input())).toBe(false);
    expect(await c.service.sendNotification(input('q2'))).toBe(true);
    expect(await c.service.sendNotification(input('q2'))).toBe(false);
    expect(c.created).toHaveLength(1);
    expect(c.created[0].options.silent).toBe(true);
    c.created[0].handlers.click();
    expect(c.main.restore).toHaveBeenCalled(); expect(c.main.focus).toHaveBeenCalled();
    expect(c.main.webContents.send).toHaveBeenCalledWith('notification-click', input('q2'));
  });
  it('bounds input dedupe and preserves repeated finishes and legacy notifications', async () => {
    const c = setup();
    for (let i = 0; i < 1002; i++) await c.service.sendNotification(input(String(i)));
    expect(c.service.seenInputRequestIds.size).toBe(1000);
    expect(await c.service.sendNotification(input('0'))).toBe(true);
    expect(await c.service.sendNotification(input('f', 'task-finished'))).toBe(true);
    expect(await c.service.sendNotification(input('f', 'task-finished'))).toBe(true);
    c.state.supported = false;
    expect(await c.service.sendNotification(input('unsupported'))).toBe(false);
    c.state.fail = true;
    expect(await c.service.sendNotification(input('failed'))).toBe(false);
    await expect(c.service.sendNotification(input('legacy', 'other'))).rejects.toThrow('native failure');
  });
});
