import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const home = fs.readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
const body = home.split('  const handleCreateChatSession = (metadata = {}) => {')[1]
  .split('\n  const prepareQuickSkillTargetSession')[0].replace(/\};\s*$/, '');
const freshBody = home.split('const isFreshBeginnerGuideChatSession = (session) => {')[1].split('\n};')[0];
const workspaceBody = home.split('const getSessionWorkspacePath = (session) => {')[1].split('\n};')[0];
const normalizeLocalPath = (path) => String(path || '').replace(/\\/g, '/');
const empty = (id, workspacePath = '') => ({
  id, title: '新对话', createdAt: 123, lastUserMessageAt: 0,
  messages: [], runtimeSessionId: '', historyLoaded: true,
  configuration: { selected_workspace_path: workspacePath },
});

const setup = (sessions, options = {}) => {
  const state = { sessions, active: options.activeChatId || 'used' };
  const bindings = {
    normalizeLocalPath,
    chatSessionsRef: { current: sessions },
    chatSessions: sessions,
    activeChatId: state.active,
    DEFAULT_CHAT_TITLE: '新对话',
    isFreshBeginnerGuideChatSession: new Function('session', freshBody),
    getSessionWorkspacePath: new Function('normalizeLocalPath', `return (session) => {${workspaceBody}};`)(normalizeLocalPath),
    chatSessionSendingMap: {},
    chatSessionInFlightMap: {},
    chatEnsuringAgentSessionByChatIdRef: { current: new Map() },
    chatWorkspaceStatusMap: {},
    createEmptyChatSession: vi.fn(({ workspacePath }) => empty('created', workspacePath)),
    setChatSessions: vi.fn((update) => { state.sessions = update(state.sessions); }),
    setActiveChatId: vi.fn((id) => { state.active = id; }),
    setChatSessionSending: vi.fn(),
    setChatSessionInFlight: vi.fn(),
    setChatSessionFulfilled: vi.fn(),
    ...options,
  };
  const run = new Function(...Object.keys(bindings), `return (metadata = {}) => {${body}};`)(...Object.values(bindings));
  return { run, state, bindings };
};

describe('new chat reuses unused sessions through the shared HomePage handler', () => {
  it('selects an unused chat without changing its timestamps or creating another', () => {
    const unused = empty('unused');
    const { run, state, bindings } = setup([{ ...empty('used'), messages: [{ role: 'user' }] }, unused]);
    run();
    expect(state.active).toBe('unused');
    expect(state.sessions[1]).toBe(unused);
    expect(unused.createdAt).toBe(123);
    expect(bindings.createEmptyChatSession).not.toHaveBeenCalled();
    expect(bindings.setChatSessions).not.toHaveBeenCalled();
  });

  it('prefers the active empty chat', () => {
    const { run, state } = setup([empty('other'), empty('active')], { activeChatId: 'active' });
    run();
    expect(state.active).toBe('active');
  });

  it('reuses only the requested workspace and leaves navbar chats ungrouped', () => {
    const { run, state } = setup([empty('group', '/workspace'), empty('ungrouped')]);
    run({ workspacePath: '/workspace', source: 'chat-history-group-new' });
    expect(state.active).toBe('group');
    run({ source: 'chat-shell-navbar-click' });
    expect(state.active).toBe('ungrouped');
  });

  it.each([
    { messages: [{ role: 'user', content: 'hello' }] },
    { runtimeSessionId: 'runtime', historyLoaded: false },
    { historyLoaded: false },
    { lastUserMessageAt: 10 },
    { title: 'renamed' },
    { configuration: { selected_workspace_path: '/other' } },
  ])('does not reuse previously used or incompatible sessions: %j', (patch) => {
    const { run, state, bindings } = setup([{ ...empty('old'), ...patch }]);
    run();
    expect(state.active).toBe('created');
    expect(bindings.createEmptyChatSession).toHaveBeenCalledOnce();
  });

  it.each([
    { chatSessionSendingMap: { busy: true } },
    { chatSessionInFlightMap: { busy: true } },
    { chatWorkspaceStatusMap: { busy: 'preparing' } },
  ])('does not reuse a busy session: %j', (options) => {
    const { run, state } = setup([empty('busy')], options);
    run();
    expect(state.active).toBe('created');
  });

  it.each(['prewarming', 'prewarmed'])('reuses an unused chat that is %s on page display', (phase) => {
    const session = { ...empty('unused'), runtimeSessionId: phase === 'prewarmed' ? 'runtime' : '' };
    const { run, state, bindings } = setup([session], {
      activeChatId: 'unused',
      chatEnsuringAgentSessionByChatIdRef: {
        current: new Map(phase === 'prewarming' ? [['unused', Promise.resolve()]] : []),
      },
    });
    run();
    run();
    expect(state.active).toBe('unused');
    expect(state.sessions).toEqual([session]);
    expect(bindings.createEmptyChatSession).not.toHaveBeenCalled();
  });

  it('does not reuse a runtime-backed chat containing messages', () => {
    const { run, state } = setup([{
      ...empty('used'), runtimeSessionId: 'runtime', messages: [{ role: 'user', content: 'hello' }],
    }]);
    run();
    expect(state.active).toBe('created');
  });

  it('creates once when no match exists, including rapid repeated clicks before rendering', () => {
    const { run, state, bindings } = setup([]);
    run();
    run();
    expect(state.sessions).toHaveLength(1);
    expect(state.active).toBe('created');
    expect(bindings.createEmptyChatSession).toHaveBeenCalledOnce();
  });
});
