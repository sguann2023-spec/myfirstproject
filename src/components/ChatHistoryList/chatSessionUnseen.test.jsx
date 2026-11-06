import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const home = fs.readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
function setup() {
  const state = { unread: {}, focused: true };
  const activeChatIdRef = { current: 's1' }, selectedPaneRef = { current: 'chat' };
  const notify = vi.fn();
  const source = home.slice(home.indexOf('  const setChatSessionUnseen ='), home.indexOf('  const removeChatHistoryLoading ='));
  const handlers = vm.runInNewContext(`${source}; ({ recordTaskFinished, setChatSessionFulfilled, removeChatSessionFulfilled, removeChatSessionUnseen });`, {
    Date, activeChatIdRef, selectedPaneRef, isFocused: () => state.focused,
    document: { visibilityState: 'visible' }, chatSessionsRef: { current: [{ id: 's1', title: 'one' }] },
    lastTaskFinishedAtByRequestIdRef: { current: {} }, CHAT_TASK_FINISHED_DEDUPE_MS: 3000,
    dispatchTaskFinishedNotification: notify,
    setChatSessionFulfilledMap: update => update({}),
    setChatSessionUnreadMap: update => { state.unread = update(state.unread); }
  });
  return { state, activeChatIdRef, selectedPaneRef, notify, ...handlers };
}
function sessionChanged(c, pending = false) {
  let listener;
  const hydrate = vi.fn();
  const deferred = new Map(), settled = new Map([['s1:runtime-1', true]]);
  const start = home.indexOf('    return api.onSessionChanged((payload) => {');
  const end = home.indexOf('\n  }, [canUseAgentRuntime, hydratePersistedChatSessionFromHistory]);', start);
  vm.runInNewContext(`(() => { ${home.slice(start, end)} })()`, {
    api: { onSessionChanged: callback => { listener = callback; } },
    chatIdByAgentSessionIdRef: { current: new Map([['runtime-1', 's1']]) },
    chatPendingByRequestIdRef: { current: new Map(pending ? [['req', { agentSessionId: 'runtime-1' }]] : []) },
    chatDeferredSessionChangeHydrateRef: { current: deferred },
    chatHistoryHydrateSettledRef: { current: settled },
    recordTaskFinished: c.recordTaskFinished, hydratePersistedChatSessionFromHistory: hydrate
  });
  return { emit: change => listener({ sessionId: 'runtime-1', headless: true, ...change }), hydrate, deferred, settled };
}
describe('HomePage task completion unread state', () => {
  it.each([{ reason: 'metadata' }, {}, { reason: 'turn-completed' }, { reason: 'metadata', outcome: 'success' }])(
    'refreshes metadata/legacy changes without unread or notifications: %j', change => {
      const c = setup(); c.state.focused = false;
      const events = sessionChanged(c);
      // No prior turn timestamp: correctness must not depend on the eight-second dedupe window.
      events.emit(change);
      expect(c.state.unread).toEqual({}); expect(c.notify).not.toHaveBeenCalled();
      expect(events.hydrate).toHaveBeenCalledWith({ chatId: 's1', sessionId: 'runtime-1', reason: 'session-changed.headless' });
    }
  );
  it.each(['success', 'error'])('notifies an explicit background %s completion', outcome => {
    const c = setup(); c.state.focused = false;
    const events = sessionChanged(c);
    events.emit({ reason: 'turn-completed', outcome });
    expect(c.state.unread.s1).toBe(true);
    expect(c.notify).toHaveBeenCalledWith({ chatId: 's1', outcome, sessionTitle: 'one' });
    expect(events.hydrate).toHaveBeenCalledTimes(1);
  });
  it('preserves pending-history deferral and ignores cancelled notifications', () => {
    const c = setup(); c.state.focused = false;
    const events = sessionChanged(c, true);
    events.emit({ reason: 'metadata' });
    expect(events.deferred.get('s1')).toEqual({ chatId: 's1', sessionId: 'runtime-1', reason: 'session-changed.headless.deferred' });
    expect(events.settled.has('s1:runtime-1')).toBe(false);
    expect(events.hydrate).not.toHaveBeenCalled();
    sessionChanged(c).emit({ reason: 'turn-completed', outcome: 'cancelled' });
    expect(c.notify).not.toHaveBeenCalled(); expect(c.state.unread).toEqual({});
  });
  it('uses a neutral attention color instead of error red for unread results', () => {
    const css = fs.readFileSync(`${process.cwd()}/src/components/ChatHistoryList/ChatHistoryList.css`, 'utf8');
    const rule = css.match(/\.chat-history-list__status-dot\.is-fulfilled\s*\{([^}]+)\}/)?.[1];
    expect(rule).toContain('#1677ff');
    expect(rule).not.toContain('--color-status-error');
  });
  it('keeps visible completions read and marks another chat unread using latest refs', () => {
    const c = setup(); c.recordTaskFinished('s1', 'success'); expect(c.state.unread.s1).toBe(false);
    c.activeChatIdRef.current = 's2'; c.recordTaskFinished('s1', 'success'); expect(c.state.unread.s1).toBe(true);
    c.removeChatSessionUnseen('s1'); expect(c.state.unread.s1).toBeUndefined();
  });
  it.each(['success', 'error'])('marks an unfocused %s unread and dispatches its title', outcome => {
    const c = setup(); c.state.focused = false; c.recordTaskFinished('s1', outcome);
    expect(c.state.unread.s1).toBe(true);
    expect(c.notify).toHaveBeenCalledWith({ chatId: 's1', outcome, sessionTitle: 'one' });
  });
  it('treats a non-chat pane as not watching', () => {
    const c = setup(); c.selectedPaneRef.current = 'skill'; c.recordTaskFinished('s1', 'success');
    expect(c.state.unread.s1).toBe(true);
  });
  it('deduplicates the same task but not different tasks within three seconds', () => {
    const c = setup();
    c.recordTaskFinished('s1', 'error', 'req1');
    c.recordTaskFinished('s1', 'success', 'req1');
    c.recordTaskFinished('s1', 'success', 'req2');
    expect(c.notify).toHaveBeenCalledTimes(2);
  });
  it('uses the same identity for renderer completion and headless backfill', () => {
    const c = setup(); const events = sessionChanged(c);
    c.recordTaskFinished('s1', 'success', 'req1');
    events.emit({ reason: 'turn-completed', outcome: 'success', requestId: 'req1' });
    events.emit({ reason: 'turn-completed', outcome: 'error', requestId: 'req2' });
    expect(c.notify).toHaveBeenCalledTimes(2);
  });
  it('does not drop a different completed task while history hydration is deferred', () => {
    const c = setup(); const events = sessionChanged(c, true);
    events.emit({ reason: 'turn-completed', outcome: 'success', requestId: 'req1' });
    events.emit({ reason: 'turn-completed', outcome: 'error', requestId: 'req2' });
    expect(c.notify).toHaveBeenCalledTimes(2);
    expect(events.hydrate).not.toHaveBeenCalled();
  });
  it('allows the same task again after three seconds', () => {
    const clock = vi.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(10000);
      const c = setup(); c.recordTaskFinished('s1', 'success', 'req1');
      clock.mockReturnValue(13001); c.recordTaskFinished('s1', 'error', 'req1');
      expect(c.notify).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });
  it('cancellation neither notifies nor consumes a task key', () => {
    const c = setup();
    c.recordTaskFinished('s1', 'cancelled', 'req1');
    expect(c.notify).not.toHaveBeenCalled();
    c.recordTaskFinished('s1', 'success', 'req1');
    expect(c.notify).toHaveBeenCalledTimes(1);
  });
  it('fulfillment is state only and does not double-notify', () => {
    const c = setup(); c.setChatSessionFulfilled('s1', true, 'direct.complete');
    expect(c.notify).not.toHaveBeenCalled();
  });
  it('advances the queue while notification is unresolved, retaining request identity', () => {
    const c = setup(); c.notify.mockReturnValue(new Promise(() => {}));
    const done = vi.fn();
    const source = home.slice(home.indexOf('  const finishQueuedRequest ='), home.indexOf('  const chatPerfByRequestIdRef ='));
    const finish = vm.runInNewContext(`${source}; finishQueuedRequest`, {
      chatPendingByRequestIdRef: { current: new Map() },
      queueCompletionRef: { current: new Map([['req1', { done, chatId: 's1' }]]) }, recordTaskFinished: c.recordTaskFinished
    });
    finish('req1', 'complete');
    expect(done).toHaveBeenCalledWith('complete');
    c.recordTaskFinished('s1', 'success', 'req1');
    expect(c.notify).toHaveBeenCalledTimes(1);
  });
  it('clears only the focused visible current chat on focus and visibility events', () => {
    const listeners = {}, clear = vi.fn(), off = vi.fn();
    const doc = { visibilityState: 'visible', addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: off };
    const pane = { current: 'skill' };
    let focused = true;
    const start = home.indexOf('    const clearCurrent = () => {');
    const end = home.indexOf('\n  }, []);', start);
    const cleanup = vm.runInNewContext(`(() => { ${home.slice(start, end)} })()`, {
      document: doc, window: { addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: off },
      selectedPaneRef: pane, activeChatIdRef: { current: 's1' }, isFocused: () => focused,
      removeChatSessionUnseen: clear
    });
    listeners.focus(); expect(clear).not.toHaveBeenCalled();
    pane.current = 'chat'; focused = false; listeners.visibilitychange(); expect(clear).not.toHaveBeenCalled();
    focused = true; doc.visibilityState = 'hidden'; listeners.focus(); expect(clear).not.toHaveBeenCalled();
    doc.visibilityState = 'visible'; listeners.visibilitychange(); expect(clear).toHaveBeenCalledWith('s1');
    cleanup(); expect(off).toHaveBeenCalledTimes(2);
  });
  it('persists unread and resends raw badge count when preferences change', () => {
    const send = vi.fn(), setItem = vi.fn(), dispose = vi.fn();
    let preferenceChanged;
    const start = home.indexOf('    try { window.localStorage.setItem(CHAT_UNREAD_STORAGE_KEY');
    const end = home.indexOf('\n  }, [chatSessionUnreadMap]);', start);
    const cleanup = vm.runInNewContext(`(() => { ${home.slice(start, end)} })()`, {
      window: { localStorage: { setItem }, ipc: { send } },
      CHAT_UNREAD_STORAGE_KEY: 'unread', chatSessionUnreadMap: { s1: true, s2: false, s3: true },
      subscribeTaskNotificationPreferences: listener => { preferenceChanged = listener; return dispose; }
    });
    expect(JSON.parse(setItem.mock.calls[0][1])).toEqual({ s1: true, s2: false, s3: true });
    expect(send).toHaveBeenLastCalledWith('notification:set-badge-count', 2);
    preferenceChanged(); expect(send).toHaveBeenCalledTimes(2);
    cleanup(); expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('notification clicks navigate and clear unread through either IPC signature', () => {
    const clear = vi.fn(), pane = vi.fn(), active = vi.fn(), off = vi.fn();
    let listener;
    const start = home.indexOf("    const ipc = window.electron?.ipcRenderer || window.ipc;\n    const onClick");
    const end = home.indexOf('\n  }, []);', start);
    const cleanup = vm.runInNewContext(`(() => { ${home.slice(start, end)} })()`, {
      window: { ipc: { on: (_channel, callback) => { listener = callback; return off; } } },
      chatSessionsRef: { current: [{ id: 's1' }] }, setSelectedPane: pane,
      setActiveChatId: active, removeChatSessionUnseen: clear
    });
    listener({ meta: { chatId: 's1' } }); listener({}, { meta: { chatId: 's1' } });
    expect(pane).toHaveBeenLastCalledWith('chat'); expect(active).toHaveBeenLastCalledWith('s1');
    expect(clear).toHaveBeenCalledTimes(2);
    listener({ meta: { chatId: 'deleted' } }); expect(clear).toHaveBeenCalledTimes(2);
    cleanup(); expect(off).toHaveBeenCalledTimes(1);
  });
  it('cleans unread state on restarting and deletion', () => {
    const c = setup(); c.state.focused = false; c.recordTaskFinished('s1', 'success');
    c.setChatSessionFulfilled('s1', false); expect(c.state.unread.s1).toBeUndefined();
    c.recordTaskFinished('s1', 'error'); c.removeChatSessionFulfilled('s1'); expect(c.state.unread.s1).toBeUndefined();
  });
});
