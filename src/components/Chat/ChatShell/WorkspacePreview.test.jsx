import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from '../../../renderer/src/i18n/locales/zh-cn.json';
import WorkspacePreview from './WorkspacePreview';

i18next.use(initReactI18next).init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN } } });
let root;
let container;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('uses the shared tree and delegates file actions, refresh, and reveal', async () => {
  const onOpenFile = vi.fn();
  const onContextMenu = vi.fn();
  const onDeleteNode = vi.fn();
  const controller = {
    currentWorkspacePath: '/tmp/project', hasLockedWorkspace: true,
    workspaceTreeLoading: {}, workspaceTrees: { '/tmp/project': [{ path: 'notes.txt', name: 'notes.txt', type: 'file' }] },
    refreshWorkspaceTree: vi.fn(), openWorkspaceInFinder: vi.fn(),
    openFileContextMenu: onContextMenu, handleDeleteWorkspaceNode: onDeleteNode
  };
  const renderTreeNodes = vi.fn((_scope, _path, nodes, _depth, options) => <button onClick={() => onOpenFile(nodes[0])} onContextMenu={(event) => options.onContextMenu(event, nodes[0])}>{nodes[0].name}</button>);
  await act(async () => root.render(<WorkspacePreview controller={controller} renderTreeNodes={renderTreeNodes} />));
  expect(container.querySelector('h1').textContent).toBe('project');
  expect(renderTreeNodes).toHaveBeenCalledWith('workspace:/tmp/project', '/tmp/project', controller.workspaceTrees['/tmp/project'], 0, { onContextMenu, showDeleteAction: true, onDeleteNode });
  await act(async () => container.querySelector('.chat-panel__workspace-tree button').click());
  expect(onOpenFile).toHaveBeenCalledWith(controller.workspaceTrees['/tmp/project'][0]);
  await act(async () => container.querySelector('[title="刷新工作空间"]').click());
  await act(async () => container.querySelector('[title="打开文件管理器"]').click());
  expect(controller.refreshWorkspaceTree).toHaveBeenCalledOnce();
  expect(controller.openWorkspaceInFinder).toHaveBeenCalledOnce();
});

it('displays shared loading and empty states', async () => {
  const controller = { currentWorkspacePath: '/tmp/project', hasLockedWorkspace: true, workspaceTreeLoading: { '/tmp/project': true }, workspaceTrees: {} };
  await act(async () => root.render(<WorkspacePreview controller={controller} />));
  expect(container.textContent).toContain('加载目录中');
  controller.workspaceTreeLoading = {};
  await act(async () => root.render(<WorkspacePreview controller={controller} />));
  expect(container.textContent).toContain('工作空间为空');
});
