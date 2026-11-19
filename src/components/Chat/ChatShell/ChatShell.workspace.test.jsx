import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatShell from './ChatShell';
import { ChatTaskContext } from './ChatTaskContext';
import WorkspaceTreeView from './WorkSpace/WorkspaceTreeView';
import { readOptionalSkillExampleText } from '../Composer/skillExample';

const probe = vi.hoisted(() => ({
  options: null,
  controller: null,
  preview: null,
  dialogs: null,
  skillProps: null,
  chatActions: null,
  renders: [],
  controllerMount: vi.fn(),
  dialogMount: vi.fn(),
  previewMount: vi.fn(),
  previewUnmount: vi.fn(),
}));

// Keep ChatShell, InlinePreviewPane, workspace tree clicks and portals real.
// Only replace the controller's internals: its own async/filesystem behavior has
// a separate suite. Calling options.onBindWorkspace executes ChatShell's binder.
vi.mock('./WorkSpace/useWorkspaceController', async () => {
  const { useState } = await import('react');
  return { useWorkspaceController: (options) => {
    useState(() => { probe.controllerMount(); return null; });
    const [createOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('new-workspace');
    const controller = {
      ...options,
      busy: false,
      workspaceExpanded: true,
      workspaceTrees: { [options.currentWorkspacePath]: [{
        name: 'docs', path: 'docs', type: 'directory', children: [{
          name: 'notes.md', path: 'docs/notes.md', type: 'file',
        }],
      }] },
      workspaceTreeLoading: {},
      visibleRecentWorkspaces: [],
      recentWorkspacePaths: [],
      toggleWorkspaceExpanded: vi.fn(),
      refreshWorkspaceTree: vi.fn(),
      openWorkspaceInFinder: vi.fn(),
      bindWorkspace: options.onBindWorkspace,
      openWorkspace: () => options.onBindWorkspace('/opened'),
      createWorkspace: () => setCreateOpen(true),
      createWorkspaceDialogOpen: createOpen,
      createWorkspaceParentDir: '/parent',
      createWorkspaceName: name,
      createWorkspaceNameError: '',
      createWorkspaceSubmitting: false,
      closeCreateWorkspaceDialog: () => setCreateOpen(false),
      changeCreateWorkspaceName: setName,
      handleCreateWorkspace: () => options.onBindWorkspace(`/parent/${name}`, { seedSkills: true }),
    };
    probe.options = options;
    probe.controller = controller;
    // Record during render, not just after effects, to catch a one-render flash.
    probe.renders.push({
      agentId: options.agentId,
      chatSessionId: options.chatSessionId,
      resolvedSessionId: options.resolvedSessionId,
      path: options.currentWorkspacePath,
      locked: options.hasLockedWorkspace,
    });
    return controller;
  } };
});
vi.mock('./WorkSpace/WorkSpace', async (importOriginal) => {
  const actual = await importOriginal();
  const { useEffect } = await import('react');
  return {
    ...actual,
    WorkspaceDialogs: (props) => {
      probe.dialogs = props;
      useEffect(() => { probe.dialogMount(); }, []);
      return <actual.WorkspaceDialogs {...props} />;
    },
  };
});
// Real tab behavior has its own WebPagePreview suite. Local state and lifecycle
// probes here detect remounts even if React recreates an identical-looking DOM.
vi.mock('./WebPagePreview', async () => {
  const { useEffect, useState } = await import('react');
  return { default: (props) => {
    const [draft, setDraft] = useState('');
    useEffect(() => {
      probe.previewMount();
      return () => probe.previewUnmount();
    }, []);
    probe.preview = props;
    return <section data-testid="preview" data-visible={String(props.visible)}>
      <button data-testid="preview-create" onClick={props.workspaceController.createWorkspace}>create</button>
      <button data-testid="preview-open" onClick={props.workspaceController.openWorkspace}>open</button>
      <button data-testid="preview-close" onClick={props.onClose}>close</button>
      <button data-testid="preview-edit" onClick={() => setDraft('unsaved edit')}>edit</button>
      <output data-testid="preview-draft">{draft}</output>
      <WorkspaceTreeView controller={props.workspaceController} renderTreeNodes={props.renderWorkspaceTreeNodes} />
      {props.renderSkillMembers?.()}
      {props.preview?.previewType === 'skill-source' ? props.renderSkillSource?.(props.preview) : null}
      <output data-testid="preview-payload">{JSON.stringify(props.preview)}</output>
    </section>;
  } };
});
vi.mock('antd', () => ({
  Tooltip: ({ children }) => children,
  Tour: () => null,
  message: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('./SkillMembers/SkillMembersSection', () => ({ default: (props) => {
  probe.skillProps = props;
  return <section data-testid="my-skills"><h1>{props.title}</h1></section>;
} }));
vi.mock('./MCPSettings/MCPSettings', () => ({ default: () => null }));
vi.mock('../../PartSplitToolDetail', () => ({ default: () => null }));
vi.mock('../../Icons/SidebarToggleIcon', () => ({ default: () => null }));
vi.mock('../Composer/skillExample', () => ({ readOptionalSkillExampleText: vi.fn() }));
vi.mock('../../../shared/markdownFileLinks', () => ({ resolveMarkdownFilePath: vi.fn((path) => path) }));
vi.mock('../../../api/newguiderReward', () => ({ claimNewguiderReward: vi.fn() }));
vi.mock('../../../shared/DownloadController.js', () => ({ DownloadController: {} }));
vi.mock('../../../shared/draftDownloaderUrl', () => ({ parseDraftDownloaderUrl: vi.fn(() => null) }));
vi.mock('../artifactFileTarget', () => ({ getArtifactFileSource: vi.fn(), getArtifactFileName: vi.fn() }));
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn() }) } }));
vi.mock('../../../shared/beginnerGuide', () => ({
  BEGINNER_GUIDE_COMPLETED_KEY: 'completed',
  BEGINNER_GUIDE_REOPEN_PENDING_KEY: 'reopen',
  clearBeginnerGuideReopen: vi.fn(),
  isBeginnerGuideCompleted: () => true,
  isBeginnerGuideReopenPending: () => false,
  setBeginnerGuideCompleted: vi.fn(),
}));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const sessionResult = (id, path = '', configuration = {}) => ({
  ok: true,
  session: {
    id,
    accessible_paths: path ? [path] : [],
    configuration: { ...configuration, selected_workspace_path: path },
  },
});
let root;
let container;
let props;
let listeners;
let getSession;
let updateSession;
let seedWorkspace;
const ChatActionsProbe = () => {
  probe.chatActions = React.useContext(ChatTaskContext);
  return <span>chat content</span>;
};
const render = async (updates = {}) => {
  props = { ...props, ...updates };
  await act(async () => { root.render(<ChatShell {...props}><ChatActionsProbe /></ChatShell>); });
};
const start = async (callback) => {
  let result;
  await act(async () => { result = callback(); });
  return { result };
};
const settle = async (request, value, reject = false) => {
  await act(async () => { request[reject ? 'reject' : 'resolve'](value); });
};
const click = async (element) => {
  expect(element).not.toBeNull();
  await act(async () => { element.click(); });
};
const dispatch = async (target, event) => {
  expect(target).not.toBeNull();
  await act(async () => { target.dispatchEvent(event); });
};
const keyDown = (target, key) => dispatch(target, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const mouse = (target, type, clientX) => dispatch(target, new MouseEvent(type, { clientX, bubbles: true, cancelable: true }));
const toggle = () => container.querySelector('.chat-panel__preview-toggle');
const previewPane = () => container.querySelector('.chat-panel__preview-pane');
const previewElement = () => container.querySelector('[data-testid="preview"]');
const separator = () => container.querySelector('[role="separator"]');
const expectPreviewVisibility = (requested, visible = requested) => {
  expect(toggle().getAttribute('aria-expanded')).toBe(String(requested));
  expect(toggle().getAttribute('aria-label')).toBe(requested ? '收起预览面板' : '展开预览面板');
  expect(toggle().getAttribute('aria-controls')).toBe(previewPane().id);
  expect(previewPane().id).not.toBe('');
  expect(previewPane().getAttribute('aria-hidden')).toBe(String(!visible));
  expect(previewPane().hasAttribute('inert')).toBe(!visible);
  expect(previewPane().classList.contains('is-open')).toBe(visible);
  expect(Boolean(separator())).toBe(visible);
  if (previewElement()) {
    expect(probe.preview.visible).toBe(visible);
    expect(previewElement().dataset.visible).toBe(String(visible));
  }
};
const expectPreviewWidth = (width) => {
  expect(previewPane().style.width).toBe(`${width}px`);
  expect(window.localStorage.getItem('chat-web-preview-width:v1')).toBe(String(width));
};
const changed = async (sessionId) => {
  await act(async () => { [...listeners].forEach((listener) => listener({ sessionId })); });
};
const expectWorkspace = (path, sessionId) => {
  expect(probe.options.currentWorkspacePath).toBe(path);
  expect(probe.options.hasLockedWorkspace).toBe(Boolean(path));
  if (sessionId !== undefined) expect(probe.options.resolvedSessionId).toBe(sessionId);
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  Object.assign(probe, { options: null, controller: null, preview: null, dialogs: null, skillProps: null, chatActions: null, renders: [] });
  window.localStorage.clear();
  listeners = new Set();
  getSession = vi.fn(async (id) => sessionResult(id));
  updateSession = vi.fn(async ({ sessionId, accessible_paths, configuration }) => (
    sessionResult(sessionId, accessible_paths[0], configuration)
  ));
  seedWorkspace = vi.fn().mockResolvedValue({ ok: true });
  window.electronAPI = {
    cherryChatStream: { getSession, updateSession },
    agentSessionStream: { onSessionChanged: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }) },
    agentSkills: { seedWorkspace },
  };
  window.toast = { error: vi.fn(), warning: vi.fn() };
  window.api = { file: {
    readExternal: vi.fn().mockResolvedValue('# notes'),
    openPath: vi.fn(),
    showInFolder: vi.fn(),
  } };
  props = {
    agentId: 'agent-a', chatSessionId: 'chat-a', runtimeSessionId: 'runtime-a',
    webPreview: { key: 'web', url: 'https://example.test' },
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  try {
    act(() => { root.unmount(); });
  } finally {
    container.remove();
  }
  expect(listeners.size).toBe(0);
});

describe('ChatShell workspace integration', () => {
  it('opens skill source using its own root without binding or changing the workspace', async () => {
    getSession.mockImplementation(async (id) => sessionResult(id, '/workspace'));
    window.api.file.listDirectory = vi.fn().mockResolvedValue(['/skills/demo/SKILL.md']);
    window.api.file.isDirectory = vi.fn().mockResolvedValue(false);
    const onOpenWebPreview = vi.fn();
    await render({ onOpenWebPreview });
    const skill = { id: 'source-demo', name: '示例技能', path: '/skills/demo' };
    await act(async () => probe.skillProps.onOpenSkillSource(skill));
    const firstKey = probe.preview.preview.key;
    expect(probe.preview.preview).toMatchObject({ previewType: 'skill-source', skillKey: 'source-demo', rootPath: '/skills/demo', title: '示例技能' });
    expect(window.api.file.listDirectory).toHaveBeenCalledWith('/skills/demo', expect.objectContaining({ recursive: true }));
    expectWorkspace('/workspace');
    expect(updateSession).not.toHaveBeenCalled();
    expect(onOpenWebPreview).not.toHaveBeenCalled();
    expect(probe.controllerMount).toHaveBeenCalledOnce();
    const sourcePane = container.querySelector('[aria-label="技能源码"]');
    expect(sourcePane).not.toBeNull();
    const sourceFile = sourcePane.querySelector('.chat-panel__tree-item.is-file');
    await click(sourceFile);
    expect(window.api.file.readExternal).toHaveBeenCalledWith('/skills/demo/SKILL.md', true);
    expect(probe.preview.preview.previewType).toBe('file');
    await act(async () => probe.skillProps.onOpenSkillSource(skill));
    expect(probe.preview.preview.key).not.toBe(firstKey);
  });

  it('renders skills only in the preview slot and preserves actions and expansion while toggling the preview', async () => {
    const skill = { id: 'skill-demo', name: '示例技能' };
    window.electronAPI.agentSkills.listLocal = vi.fn().mockResolvedValue({ ok: true, skills: [skill] });
    const onSelectSkill = vi.fn();
    const onModifySkill = vi.fn();
    const onOpenSkillStore = vi.fn();
    await render({ onSelectSkill, onModifySkill, onOpenSkillStore });
    expect(container.querySelector('.chat-panel__members')).toBeNull();
    expect(container.querySelector('.chat-panel__members-list')).toBeNull();
    expect(container.querySelector('.chat-panel__members-toggle')).toBeNull();
    expect(container.querySelectorAll('[data-testid="my-skills"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="preview"] [data-testid="my-skills"]')).not.toBeNull();
    expect(probe.skillProps).toMatchObject({ variant: 'preview', title: 'previewTab.mySkills', skills: [skill], onSelectSkill, onModifySkill, onOpenSkillStore });
    expectPreviewVisibility(true);
    await act(async () => probe.skillProps.onSelectSkill(skill));
    await act(async () => probe.skillProps.onModifySkill(skill));
    expect(onSelectSkill).toHaveBeenCalledWith(skill);
    expect(onModifySkill).toHaveBeenCalledWith(skill);
    await act(async () => probe.skillProps.onToggleSkillExpanded(skill));
    expect(probe.skillProps.expandedSkillKeys.has('skill-demo')).toBe(true);
    const skillsElement = container.querySelector('[data-testid="my-skills"]');
    await click(toggle());
    expectPreviewVisibility(false);
    expect(container.querySelector('[data-testid="my-skills"]')).toBe(skillsElement);
    expect(probe.skillProps.expandedSkillKeys.has('skill-demo')).toBe(true);
    await render({ sessionTitle: 'another title' });
    expectPreviewVisibility(false);
    await click(toggle());
    expectPreviewVisibility(true);
    expect(container.querySelector('[data-testid="my-skills"]')).toBe(skillsElement);
    expect(probe.skillProps.expandedSkillKeys.has('skill-demo')).toBe(true);
    expect(typeof probe.skillProps.renderTreeNodes).toBe('function');
    expect(typeof probe.skillProps.onDeleteSkill).toBe('function');
    expect(typeof probe.skillProps.onOpenSkillWebPreview).toBe('function');
    expect(typeof probe.skillProps.onRunSkillExample).toBe('function');
  });

  it('reads each skill example once and forwards cover, original name/description and web actions', async () => {
    const skills = [
      { id: 'nested', name: '原技能名称', description: '原技能描述', path: '/skills/nested' },
      { id: 'top', name: '顶层封面', path: '/skills/top' },
      { id: 'broken', name: '无效示例', path: '/skills/broken' },
      { id: 'missing', name: '普通技能', path: '/skills/missing' }
    ];
    window.electronAPI.agentSkills.listLocal = vi.fn().mockResolvedValue({ ok: true, skills });
    readOptionalSkillExampleText.mockImplementation(async (root) => ({
      '/skills/nested': JSON.stringify({ title: '不得替换标题', display_info: { cover_url: 'https://example.test/cover.jpg', web_share: 'https://example.test/demo', content: '不得替换描述' } }),
      '/skills/top': JSON.stringify({ cover_url: './cover.jpg' }),
      '/skills/broken': '{broken'
    }[root] || null));
    const onOpenWebPreview = vi.fn();
    try {
      await render({ onOpenWebPreview });
      expect(readOptionalSkillExampleText).toHaveBeenCalledTimes(4);
      expect(probe.skillProps.skills).toMatchObject([
        { id: 'nested', name: '原技能名称', description: '原技能描述', __exampleCoverSrc: 'https://example.test/cover.jpg' },
        { id: 'top', __exampleCoverSrc: 'file:///skills/top/cover.jpg' },
        { id: 'broken', __exampleCoverSrc: '' },
        { id: 'missing', __exampleCoverSrc: '' }
      ]);
      expect(probe.skillProps.skillPreviewPaths.nested).toBe('https://example.test/demo');
      expect(probe.skillProps.skillExamplePaths.nested).toBe('https://example.test/demo');
      const nestedSkill = probe.skillProps.skills[0];
      await act(async () => probe.skillProps.onRunSkillExample(nestedSkill));
      expect(onOpenWebPreview).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.test/demo', key: expect.stringContaining('skill-example:https://example.test/demo:'), title: '原技能名称' }));
    } finally {
      readOptionalSkillExampleText.mockReset();
    }
  });

  it.each(['chat', 'agent', 'both'])('never exposes A workspace during the first render after a %s switch', async (scope) => {
    getSession.mockImplementation(async (id) => sessionResult(id, id === 'runtime-a' ? '/workspace-a' : '/workspace-b'));
    await render();
    expectWorkspace('/workspace-a', 'runtime-a');
    probe.renders.length = 0;
    const pendingB = deferred();
    getSession.mockReturnValue(pendingB.promise);
    const updates = scope === 'agent'
      ? { agentId: 'agent-b' } // Even a reused runtime id must not leak the old owner.
      : { chatSessionId: 'chat-b', runtimeSessionId: 'runtime-b', ...(scope === 'both' ? { agentId: 'agent-b' } : {}) };
    await render(updates);
    expect(probe.renders.length).toBeGreaterThan(0);
    expect(probe.renders.every(({ path, locked }) => path === '' && locked === false)).toBe(true);
    expectWorkspace('', scope === 'agent' ? 'runtime-a' : 'runtime-b');
    await settle(pendingB, sessionResult(props.runtimeSessionId, '/workspace-b'));
    expectWorkspace('/workspace-b');
  });

  it.each(['ensure', 'seed', 'update'])('ignores a late %s result after A → B, including returning to A (ABA)', async (stage) => {
    const pending = deferred();
    const ensure = vi.fn().mockReturnValue(pending.promise);
    if (stage === 'ensure') props.runtimeSessionId = '';
    if (stage === 'seed') seedWorkspace.mockReturnValue(pending.promise);
    if (stage === 'update') updateSession.mockReturnValue(pending.promise);
    await render({ onEnsureRuntimeSession: ensure });
    const oldBind = probe.options.onBindWorkspace;
    const { result } = await start(() => oldBind('/old-a', { seedSkills: true }));
    if (stage === 'ensure') expect(ensure).toHaveBeenCalledOnce();
    if (stage === 'seed') expect(seedWorkspace).toHaveBeenCalledOnce();
    if (stage === 'update') expect(updateSession).toHaveBeenCalledOnce();
    getSession.mockImplementation(async (id) => sessionResult(id, '/workspace-b'));
    await render({ chatSessionId: 'chat-b', runtimeSessionId: 'runtime-b' });
    expectWorkspace('/workspace-b', 'runtime-b');
    // Returning to the same logical key must still invalidate the old request.
    await render({ chatSessionId: 'chat-a', runtimeSessionId: 'runtime-a' });
    expectWorkspace('/workspace-b', 'runtime-a');
    const reads = getSession.mock.calls.length;
    const seeds = seedWorkspace.mock.calls.length;
    const updates = updateSession.mock.calls.length;
    await settle(pending, stage === 'ensure' ? 'late-runtime-a' : stage === 'seed' ? { ok: true } : sessionResult('runtime-a', '/old-a'));
    await expect(result).resolves.toBe(false);
    expectWorkspace('/workspace-b', 'runtime-a');
    expect(getSession).toHaveBeenCalledTimes(reads);
    expect(seedWorkspace).toHaveBeenCalledTimes(seeds);
    expect(updateSession).toHaveBeenCalledTimes(updates);
    expect(window.toast.error).not.toHaveBeenCalled();
  });

  it.each(['ensure', 'seed', 'update'])('does not apply a late %s success to B', async (stage) => {
    const pending = deferred();
    if (stage === 'ensure') props.runtimeSessionId = '';
    if (stage === 'seed') seedWorkspace.mockReturnValue(pending.promise);
    if (stage === 'update') updateSession.mockReturnValue(pending.promise);
    await render({ onEnsureRuntimeSession: vi.fn().mockReturnValue(pending.promise) });
    const { result } = await start(() => probe.options.onBindWorkspace('/old-a', { seedSkills: true }));
    getSession.mockImplementation(async (id) => sessionResult(id, '/workspace-b'));
    await render({ chatSessionId: 'chat-b', runtimeSessionId: 'runtime-b' });
    const reads = getSession.mock.calls.length;
    const updates = updateSession.mock.calls.length;
    const seeds = seedWorkspace.mock.calls.length;
    probe.renders.length = 0;
    await settle(pending, stage === 'ensure' ? 'late-runtime-a' : stage === 'seed' ? { ok: true } : sessionResult('runtime-a', '/old-a'));
    await expect(result).resolves.toBe(false);
    expectWorkspace('/workspace-b', 'runtime-b');
    expect(probe.renders.every(({ path }) => path === '/workspace-b')).toBe(true);
    expect(getSession).toHaveBeenCalledTimes(reads);
    expect(updateSession).toHaveBeenCalledTimes(updates);
    expect(seedWorkspace).toHaveBeenCalledTimes(seeds);
  });

  it.each(['ensure', 'seed', 'update'])('suppresses stale %s errors rather than notifying B', async (stage) => {
    const pending = deferred();
    if (stage === 'ensure') props.runtimeSessionId = '';
    if (stage === 'seed') seedWorkspace.mockReturnValue(pending.promise);
    if (stage === 'update') updateSession.mockReturnValue(pending.promise);
    await render({ onEnsureRuntimeSession: vi.fn().mockReturnValue(pending.promise) });
    const { result } = await start(() => probe.options.onBindWorkspace('/old-a', { seedSkills: true }));
    await render({ chatSessionId: 'chat-b', runtimeSessionId: 'runtime-b' });
    await settle(pending, new Error('old A failure'), true);
    await expect(result).resolves.toBe(false);
    expectWorkspace('', 'runtime-b');
    expect(window.toast.error).not.toHaveBeenCalled();
    expect(window.toast.warning).not.toHaveBeenCalled();
  });

  it.each(['initial', 'notification'])('ignores old getSession %s reads, successes and failures, after a switch', async (source) => {
    const pending = deferred();
    if (source === 'initial') getSession.mockReturnValueOnce(pending.promise);
    await render();
    if (source === 'notification') {
      getSession.mockReturnValueOnce(pending.promise);
      await changed('runtime-a');
    }
    getSession.mockImplementation(async (id) => sessionResult(id, '/workspace-b'));
    await render({ chatSessionId: 'chat-b', runtimeSessionId: 'runtime-b' });
    expectWorkspace('/workspace-b');
    const calls = getSession.mock.calls.length;
    await changed('runtime-a');
    expect(getSession).toHaveBeenCalledTimes(calls);
    await settle(pending, sessionResult('runtime-a', '/workspace-a'));
    expectWorkspace('/workspace-b', 'runtime-b');

    const failing = deferred();
    getSession.mockReturnValueOnce(failing.promise);
    await changed('runtime-b');
    await render({ chatSessionId: 'chat-c', runtimeSessionId: 'runtime-c' });
    await settle(failing, new Error('stale read'), true);
    expectWorkspace('/workspace-b', 'runtime-c');
  });

  it('creates and binds without an initial runtime, and late runtime reads cannot undo the binding', async () => {
    props.runtimeSessionId = '';
    const ensured = deferred();
    const read = deferred();
    const update = deferred();
    getSession.mockReturnValue(read.promise);
    updateSession.mockReturnValue(update.promise);
    const ensure = vi.fn().mockReturnValue(ensured.promise);
    await render({ onEnsureRuntimeSession: ensure });
    const { result } = await start(() => probe.options.onBindWorkspace('/parent/new', { seedSkills: true }));
    expect(ensure).toHaveBeenCalledOnce();
    expect(updateSession).not.toHaveBeenCalled();
    await settle(ensured, 'runtime-created');
    expect(seedWorkspace).toHaveBeenCalledWith({ workspace: '/parent/new' });
    expect(updateSession).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'runtime-created', agent_id: 'agent-a', accessible_paths: ['/parent/new'],
      configuration: { selected_workspace_path: '/parent/new' },
    });
    expect(getSession).toHaveBeenCalledWith('runtime-created');
    // The parent's runtime id materializing is not a logical-session change.
    await render({ runtimeSessionId: 'runtime-created' });
    await settle(update, sessionResult('runtime-created', '/parent/new'));
    await expect(result).resolves.toBe(true);
    expectWorkspace('/parent/new', 'runtime-created');
    await settle(read, sessionResult('runtime-created'));
    expectWorkspace('/parent/new', 'runtime-created');
  });

  it.each([false, true])('keeps a fast ensure/update binding when the runtime read starts in a later effect (seedSkills=%s)', async (seedSkills) => {
    props.runtimeSessionId = '';
    const read = deferred();
    getSession.mockReturnValue(read.promise);
    await render({ onEnsureRuntimeSession: vi.fn().mockResolvedValue('runtime-created') });
    const { result } = await start(() => probe.options.onBindWorkspace('/fast-binding', { seedSkills }));
    await expect(result).resolves.toBe(true);
    expectWorkspace('/fast-binding', 'runtime-created');
    expect(getSession).toHaveBeenCalledWith('runtime-created');
    await settle(read, sessionResult('runtime-created'));
    expectWorkspace('/fast-binding', 'runtime-created');
  });

  it('clears the old workspace while replacing only the runtime id within one logical chat', async () => {
    getSession.mockResolvedValueOnce(sessionResult('runtime-a', '/workspace-a'));
    await render();
    expectWorkspace('/workspace-a', 'runtime-a');
    const readB = deferred();
    getSession.mockReturnValue(readB.promise);
    probe.renders.length = 0;
    await render({ runtimeSessionId: 'runtime-b' });
    try {
      expectWorkspace('', 'runtime-b');
      expect(probe.renders.every(({ path }) => path !== '/workspace-a')).toBe(true);
    } finally {
      await settle(readB, sessionResult('runtime-b', '/workspace-b'));
    }
    expectWorkspace('/workspace-b', 'runtime-b');
  });

  it('shares one controller and one real dialog portal between preview and dialogs, including while collapsed', async () => {
    const onAddWorkspaceFile = vi.fn();
    const sessionMessages = [{ id: 'message-a' }];
    await render({ onAddWorkspaceFile, sessionMessages, workspaceStatus: 'ready' });
    expect(probe.controllerMount).toHaveBeenCalledOnce();
    expect(probe.dialogMount).toHaveBeenCalledOnce();
    expect(probe.dialogs.controller).toBe(probe.preview.workspaceController);
    expect(probe.preview.workspaceController).toBe(probe.controller);
    expect(probe.options.onAddWorkspaceFile).toBe(onAddWorkspaceFile);
    expect(probe.options.workspaceStatus).toBe('ready');
    expect(probe.preview.sessionMessages).toBe(sessionMessages);
    await click(container.querySelector('[data-testid="preview-create"]'));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const dialog = document.querySelector('[role="dialog"]');
    await click(toggle());
    expectPreviewVisibility(false);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(probe.dialogs.controller).toBe(probe.preview.workspaceController);
    await click(toggle());
    await click(container.querySelector('[data-testid="preview-create"]'));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(probe.controllerMount).toHaveBeenCalledOnce();
    expect(probe.dialogMount).toHaveBeenCalledOnce();
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === '确认');
    await click(confirm);
    expect(seedWorkspace).toHaveBeenCalledExactlyOnceWith({ workspace: '/parent/new-workspace' });
    expect(updateSession).toHaveBeenCalledOnce();
    expectWorkspace('/parent/new-workspace');
  });

  it('opens and binds a workspace from the preview with the same controller as the dialogs', async () => {
    await render();
    await click(container.querySelector('[data-testid="preview-open"]'));
    expectWorkspace('/opened');
    expect(updateSession).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'runtime-a', agent_id: 'agent-a', accessible_paths: ['/opened'],
      configuration: { selected_workspace_path: '/opened' },
    });
    expect(seedWorkspace).not.toHaveBeenCalled();
    expect(probe.dialogs.controller).toBe(probe.preview.workspaceController);
    expect(probe.controllerMount).toHaveBeenCalledOnce();
    expect(probe.dialogMount).toHaveBeenCalledOnce();
  });

  it('directory and file clicks from the preview still use ChatShell file previews', async () => {
    getSession.mockImplementation(async (id) => sessionResult(id, '/workspace'));
    const read = deferred();
    window.api.file.readExternal.mockReturnValue(read.promise);
    const onOpenWebPreview = vi.fn();
    await render({ onOpenWebPreview });
    const area = previewElement;
    await click(area().querySelector('.is-directory'));
    expect(window.api.file.readExternal).not.toHaveBeenCalled();
    await click(area().querySelector('.is-file'));
    expect(window.api.file.readExternal).toHaveBeenCalledExactlyOnceWith('/workspace/docs/notes.md', true);
    expect(probe.preview.preview).toMatchObject({
      previewType: 'file', path: '/workspace/docs/notes.md', kind: 'pending', status: 'loading',
    });
    await settle(read, '# actual content');
    expect(probe.preview.preview).toMatchObject({
      previewType: 'file', path: '/workspace/docs/notes.md', title: 'notes.md',
      kind: 'markdown', status: 'ready', content: '# actual content', activate: false,
    });
    expect(container.querySelector('[data-testid="preview"] .chat-panel__tree-item.is-selected')).toBeNull();
    expect(onOpenWebPreview).not.toHaveBeenCalled();
    expect(window.api.file.openPath).not.toHaveBeenCalled();
    expect(probe.controllerMount).toHaveBeenCalledOnce();
  });
});

describe('ChatShell inline preview collapse integration', () => {
  it('creates a new-tab on the first toggle when there is no preview, without a members column', async () => {
    const onCloseWebPreview = vi.fn();
    const onInlinePreviewVisibilityChange = vi.fn();
    await render({ webPreview: null, onCloseWebPreview, onInlinePreviewVisibilityChange });
    expect(container.querySelector('.chat-panel__members')).toBeNull();
    expect(previewElement()).toBeNull();
    expect(probe.previewMount).not.toHaveBeenCalled();
    expectPreviewVisibility(false);
    expect(onInlinePreviewVisibilityChange).toHaveBeenLastCalledWith(false, expect.any(Number));

    await click(toggle());
    expect(probe.preview.preview).toMatchObject({ previewType: 'new-tab', activate: true });
    expectPreviewVisibility(true);
    expect(probe.previewMount).toHaveBeenCalledOnce();
    expect(onInlinePreviewVisibilityChange).toHaveBeenLastCalledWith(true, expect.any(Number));
    expect(onCloseWebPreview).not.toHaveBeenCalled();
    expect(probe.controllerMount).toHaveBeenCalledOnce();
    expect(probe.dialogMount).toHaveBeenCalledOnce();
  });

  it('keeps the same mounted preview and local state while toggling visible, without closing', async () => {
    const onCloseWebPreview = vi.fn();
    const onInlinePreviewVisibilityChange = vi.fn();
    await render({ onCloseWebPreview, onInlinePreviewVisibilityChange });
    const originalElement = previewElement();
    const originalPane = previewPane();
    const originalPreview = probe.preview.preview;
    await click(container.querySelector('[data-testid="preview-edit"]'));
    expect(container.querySelector('[data-testid="preview-draft"]').textContent).toBe('unsaved edit');

    await click(toggle());
    expectPreviewVisibility(false);
    expect(previewElement()).toBe(originalElement);
    expect(previewPane()).toBe(originalPane);
    expect(probe.preview.preview).toBe(originalPreview);
    expect(onInlinePreviewVisibilityChange).toHaveBeenLastCalledWith(false, expect.any(Number));
    await render({ sessionTitle: 'unrelated rerender' });
    expectPreviewVisibility(false);
    await click(toggle());
    expectPreviewVisibility(true);
    expect(previewElement()).toBe(originalElement);
    expect(previewPane()).toBe(originalPane);
    expect(container.querySelector('[data-testid="preview-draft"]').textContent).toBe('unsaved edit');
    expect(probe.previewMount).toHaveBeenCalledOnce();
    expect(probe.previewUnmount).not.toHaveBeenCalled();
    expect(onCloseWebPreview).not.toHaveBeenCalled();
    expect(onInlinePreviewVisibilityChange).toHaveBeenLastCalledWith(true, expect.any(Number));
  });

  it.each(['ready', 'error'])('keeps the preview collapsed when a pending file read becomes %s with activate:false', async (status) => {
    getSession.mockImplementation(async (id) => sessionResult(id, '/workspace'));
    const read = deferred();
    window.api.file.readExternal.mockReturnValue(read.promise);
    const onCloseWebPreview = vi.fn();
    const onInlinePreviewVisibilityChange = vi.fn();
    await render({ webPreview: null, onCloseWebPreview, onInlinePreviewVisibilityChange });
    await click(toggle());
    await click(previewElement().querySelector('.is-directory'));
    await click(previewElement().querySelector('.is-file'));
    expect(probe.preview.preview).toMatchObject({
      previewType: 'file', path: '/workspace/docs/notes.md', kind: 'pending', status: 'loading', activate: true,
    });
    expectPreviewVisibility(true);
    const originalElement = previewElement();
    await click(container.querySelector('[data-testid="preview-edit"]'));
    await click(toggle());
    expectPreviewVisibility(false);
    onInlinePreviewVisibilityChange.mockClear();

    await settle(read, status === 'ready' ? '# loaded in the background' : new Error('read failed'), status === 'error');
    expect(probe.preview.preview).toMatchObject({
      previewType: 'file', path: '/workspace/docs/notes.md', kind: 'markdown', status, activate: false,
      ...(status === 'ready' ? { content: '# loaded in the background' } : { error: 'read failed' }),
    });
    expectPreviewVisibility(false);
    expect(previewElement()).toBe(originalElement);
    expect(container.querySelector('[data-testid="preview-draft"]').textContent).toBe('unsaved edit');
    expect(onInlinePreviewVisibilityChange.mock.calls.some(([requested]) => requested)).toBe(false);
    expect(onCloseWebPreview).not.toHaveBeenCalled();
    await click(toggle());
    expectPreviewVisibility(true);
    expect(probe.preview.preview.status).toBe(status);
    expect(probe.previewMount).toHaveBeenCalledOnce();
    expect(probe.previewUnmount).not.toHaveBeenCalled();
  });

  it('expands for an explicit same-key web open but not an activate:false update', async () => {
    const onCloseWebPreview = vi.fn();
    await render({ onCloseWebPreview });
    const originalElement = previewElement();
    await click(container.querySelector('[data-testid="preview-edit"]'));
    await click(toggle());
    await render({ webPreview: { ...props.webPreview, title: 'background update', activate: false } });
    expectPreviewVisibility(false);
    expect(probe.preview.preview).toMatchObject({ key: 'web', activate: false, title: 'background update' });

    await render({ webPreview: { ...props.webPreview, title: 'explicit reopen', activate: true } });
    expectPreviewVisibility(true);
    expect(probe.preview.preview).toMatchObject({ key: 'web', url: 'https://example.test', activate: true, title: 'explicit reopen' });
    expect(previewElement()).toBe(originalElement);
    expect(container.querySelector('[data-testid="preview-draft"]').textContent).toBe('unsaved edit');
    expect(probe.previewMount).toHaveBeenCalledOnce();
    expect(probe.previewUnmount).not.toHaveBeenCalled();
    expect(onCloseWebPreview).not.toHaveBeenCalled();
  });

  it.each(['web link', 'attachment', 'file'])('expands a collapsed preview for an explicit %s open from chat context', async (source) => {
    await render({ webPreview: null });
    await click(toggle());
    const originalElement = previewElement();
    await click(toggle());
    expectPreviewVisibility(false);
    if (source === 'web link') {
      await act(async () => { probe.chatActions.openWebUrl('https://example.test/chat', 'chat link'); });
      expect(probe.preview.preview).toMatchObject({ previewType: 'web', url: 'https://example.test/chat', activate: true });
    } else if (source === 'attachment') {
      await act(async () => { probe.chatActions.openAttachmentPreview({ key: 'attachment-a', previewType: 'image', activate: true }); });
      expect(probe.preview.preview).toMatchObject({ key: 'attachment-a', previewType: 'image', activate: true });
    } else {
      await act(async () => { await probe.chatActions.openFilePath('/workspace/notes.md'); });
      expect(probe.preview.preview).toMatchObject({ previewType: 'file', path: '/workspace/notes.md', status: 'ready', activate: false });
    }
    expectPreviewVisibility(true);
    expect(previewElement()).toBe(originalElement);
    expect(probe.previewMount).toHaveBeenCalledOnce();
    expect(probe.previewUnmount).not.toHaveBeenCalled();
  });

  it('reports requested:true before previewWindowReady while passing visible:false, and preserves state across readiness', async () => {
    const onInlinePreviewVisibilityChange = vi.fn();
    await render({ previewWindowReady: false, onInlinePreviewVisibilityChange });
    expectPreviewVisibility(true, false);
    expect(onInlinePreviewVisibilityChange).toHaveBeenLastCalledWith(true, expect.any(Number));
    const originalElement = previewElement();
    await click(container.querySelector('[data-testid="preview-edit"]'));
    await render({ previewWindowReady: true });
    expectPreviewVisibility(true);
    expect(previewElement()).toBe(originalElement);
    await render({ previewWindowReady: false });
    expectPreviewVisibility(true, false);
    expect(onInlinePreviewVisibilityChange).toHaveBeenLastCalledWith(true, expect.any(Number));
    await click(toggle());
    expectPreviewVisibility(false);
    expect(onInlinePreviewVisibilityChange).toHaveBeenLastCalledWith(false, expect.any(Number));
    await render({ previewWindowReady: true });
    expectPreviewVisibility(false);
    await click(toggle());
    expectPreviewVisibility(true);
    expect(previewElement()).toBe(originalElement);
    expect(container.querySelector('[data-testid="preview-draft"]').textContent).toBe('unsaved edit');
    expect(probe.previewMount).toHaveBeenCalledOnce();
    expect(probe.previewUnmount).not.toHaveBeenCalled();
  });

  it('really clears a web preview on close rather than treating close as collapse', async () => {
    const onCloseWebPreview = vi.fn();
    await render({ onCloseWebPreview });
    await click(container.querySelector('[data-testid="preview-edit"]'));
    await click(container.querySelector('[data-testid="preview-close"]'));
    expectPreviewVisibility(false);
    expect(previewElement()).toBeNull();
    expect(onCloseWebPreview).toHaveBeenCalledOnce();
    expect(probe.previewUnmount).toHaveBeenCalledOnce();
    await click(toggle());
    expectPreviewVisibility(true);
    expect(probe.preview.preview.previewType).toBe('new-tab');
    expect(container.querySelector('[data-testid="preview-draft"]').textContent).toBe('');
    expect(probe.previewMount).toHaveBeenCalledTimes(2);
    expect(onCloseWebPreview).toHaveBeenCalledOnce();
  });

  it.each(['ready', 'error'])('does not resurrect a closed file pane after its late %s result', async (status) => {
    const read = deferred();
    window.api.file.readExternal.mockReturnValue(read.promise);
    const onCloseWebPreview = vi.fn();
    await render({ webPreview: null, onCloseWebPreview });
    const { result } = await start(() => probe.chatActions.openFilePath('/workspace/notes.md'));
    expect(probe.preview.preview).toMatchObject({ kind: 'pending', status: 'loading' });
    await click(container.querySelector('[data-testid="preview-close"]'));
    expect(previewElement()).toBeNull();
    expectPreviewVisibility(false);
    await settle(read, status === 'ready' ? '# too late' : new Error('late read failure'), status === 'error');
    await result;
    expect(previewElement()).toBeNull();
    expectPreviewVisibility(false);
    expect(probe.previewUnmount).toHaveBeenCalledOnce();
    expect(onCloseWebPreview).toHaveBeenCalledOnce();
    await click(toggle());
    expect(probe.preview.preview.previewType).toBe('new-tab');
    expectPreviewVisibility(true);
    expect(probe.previewMount).toHaveBeenCalledTimes(2);
  });

  it('retains keyboard resize, bounds, reset and persisted width across collapse', async () => {
    window.localStorage.setItem('chat-web-preview-width:v1', '460');
    const onInlinePreviewVisibilityChange = vi.fn();
    await render({ onInlinePreviewVisibilityChange });
    const panel = container.querySelector('.chat-panel');
    Object.defineProperty(panel, 'clientWidth', { configurable: true, value: 1200 });
    expectPreviewWidth(460);
    expect(separator().getAttribute('tabindex')).toBe('0');
    expect(separator().getAttribute('aria-orientation')).toBe('vertical');
    await keyDown(separator(), 'ArrowLeft');
    expectPreviewWidth(480);
    await keyDown(separator(), 'ArrowRight');
    expectPreviewWidth(460);
    await keyDown(separator(), 'Home');
    expectPreviewWidth(320);
    await keyDown(separator(), 'ArrowRight');
    expectPreviewWidth(320);
    await keyDown(separator(), 'End');
    expectPreviewWidth(880);
    await keyDown(separator(), 'ArrowLeft');
    expectPreviewWidth(880);
    await dispatch(separator(), new MouseEvent('dblclick', { bubbles: true }));
    expectPreviewWidth(400);
    await keyDown(separator(), 'ArrowLeft');
    expectPreviewWidth(420);
    await click(toggle());
    expectPreviewVisibility(false);
    expect(window.localStorage.getItem('chat-web-preview-width:v1')).toBe('420');
    expect(onInlinePreviewVisibilityChange).toHaveBeenLastCalledWith(false, 420);
    await click(toggle());
    expectPreviewWidth(420);
    expect(onInlinePreviewVisibilityChange).toHaveBeenLastCalledWith(true, 420);
    Object.defineProperty(panel, 'clientWidth', { configurable: true, value: 800 });
    await keyDown(separator(), 'End');
    expectPreviewWidth(532);
    Object.defineProperty(panel, 'clientWidth', { configurable: true, value: 700 });
    await dispatch(window, new Event('resize'));
    expectPreviewWidth(432);
  });

  it('preserves mouse resizing and restores the resize shield and body styles before collapsing', async () => {
    window.localStorage.setItem('chat-web-preview-width:v1', '460');
    await render();
    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;
    try {
      await mouse(separator(), 'mousedown', 700);
      expect(container.querySelector('.chat-panel').classList.contains('is-resizing-web-preview')).toBe(true);
      expect(container.querySelector('.chat-panel__resize-shield')).not.toBeNull();
      expect(document.body.style.cursor).toBe('col-resize');
      expect(document.body.style.userSelect).toBe('none');
      await mouse(window, 'mousemove', 620);
      expectPreviewWidth(540);
    } finally {
      await mouse(window, 'mouseup', 620);
    }
    expect(container.querySelector('.chat-panel__resize-shield')).toBeNull();
    expect(container.querySelector('.chat-panel').classList.contains('is-resizing-web-preview')).toBe(false);
    expect(document.body.style.cursor).toBe(originalCursor);
    expect(document.body.style.userSelect).toBe(originalUserSelect);
    await click(toggle());
    expectPreviewVisibility(false);
    await click(toggle());
    expectPreviewVisibility(true);
    expectPreviewWidth(540);
    expect(probe.previewMount).toHaveBeenCalledOnce();
  });

  it.each(['collapse', 'window not ready'])('stops an active drag when the preview becomes hidden by %s', async (reason) => {
    window.localStorage.setItem('chat-web-preview-width:v1', '460');
    await render();
    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;
    try {
      await mouse(separator(), 'mousedown', 700);
      await mouse(window, 'mousemove', 660);
      expectPreviewWidth(500);
      if (reason === 'collapse') await click(toggle());
      else await render({ previewWindowReady: false });
      expectPreviewVisibility(reason !== 'collapse', false);
      expect(container.querySelector('.chat-panel__resize-shield')).toBeNull();
      expect(container.querySelector('.chat-panel').classList.contains('is-resizing-web-preview')).toBe(false);
      expect(document.body.style.cursor).toBe(originalCursor);
      expect(document.body.style.userSelect).toBe(originalUserSelect);
      await mouse(window, 'mousemove', 520);
      expect(window.localStorage.getItem('chat-web-preview-width:v1')).toBe('500');
    } finally {
      await mouse(window, 'mouseup', 520);
    }
    if (reason === 'collapse') await click(toggle());
    else await render({ previewWindowReady: true });
    expectPreviewVisibility(true);
    expectPreviewWidth(500);
    expect(probe.previewMount).toHaveBeenCalledOnce();
    expect(probe.previewUnmount).not.toHaveBeenCalled();
  });
});
