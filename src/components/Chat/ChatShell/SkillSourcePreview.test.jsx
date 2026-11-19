import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkillSourcePreview from './SkillSourcePreview';

let root;
let container;
const preview = { skillKey: 'one', rootPath: '/skills/one', title: '技能一源码' };
const nodes = [{ name: 'SKILL.md', path: '/skills/one/SKILL.md', type: 'file' }];
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('api', { file: { openPath: vi.fn() } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const renderPreview = (props) => act(async () => {
  root.render(<SkillSourcePreview preview={preview} renderTreeNodes={() => null} {...props} />);
});
const refresh = () => container.querySelector('[aria-label="刷新技能源码"]');
const reveal = () => container.querySelector('[aria-label="打开文件管理器"]');

describe('SkillSourcePreview', () => {
  it('loads on mount, delegates only the scoped tree, and reveals the skill directory', async () => {
    const pending = deferred();
    const onLoad = vi.fn(() => pending.promise);
    const onOpenFile = vi.fn();
    const renderTreeNodes = vi.fn((_scope, _root, treeNodes) => (
      <button onClick={() => onOpenFile(treeNodes[0])}>{treeNodes[0].name}</button>
    ));
    await renderPreview({ onLoad, renderTreeNodes });
    expect(onLoad).toHaveBeenCalledExactlyOnceWith(preview);
    expect(container.querySelector('h1').textContent).toBe(preview.title);
    expect(container.querySelector('h1').title).toBe(preview.rootPath);
    expect(container.querySelector('.chat-workspace-preview__header')).not.toBeNull();
    expect(container.querySelector('.chat-workspace-preview__body')).not.toBeNull();
    expect(container.textContent).toContain('加载目录中');
    expect(container.textContent).not.toContain('目录为空');
    expect(renderTreeNodes).not.toHaveBeenCalled();
    await act(async () => pending.resolve(nodes));
    expect(renderTreeNodes).toHaveBeenCalledWith('skill-source:/skills/one', '/skills/one', nodes, 0);
    expect(renderTreeNodes.mock.calls.every((args) => args.length === 4)).toBe(true);
    expect(container.querySelector('.chat-panel__workspace-tree').getAttribute('aria-busy')).toBe('false');
    await act(async () => container.querySelector('.chat-panel__workspace-tree button').click());
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(nodes[0]);
    await act(async () => reveal().click());
    expect(window.api.file.openPath).toHaveBeenCalledExactlyOnceWith(preview.rootPath);
  });

  it('refreshes independently, hides stale nodes while loading, and renders empty results', async () => {
    const pending = deferred();
    const onLoad = vi.fn().mockResolvedValueOnce(nodes).mockReturnValueOnce(pending.promise);
    const renderTreeNodes = vi.fn(() => <span>SKILL.md</span>);
    await renderPreview({ onLoad, renderTreeNodes });
    expect(container.textContent).toContain('SKILL.md');
    await act(async () => refresh().click());
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(onLoad).toHaveBeenLastCalledWith(preview);
    expect(container.textContent).toContain('加载目录中');
    expect(container.textContent).not.toContain('SKILL.md');
    await act(async () => pending.resolve([]));
    expect(container.textContent).toContain('目录为空');
    expect(container.textContent).not.toContain('加载目录中');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows an independent error state and clears it on successful refresh', async () => {
    const onLoad = vi.fn().mockRejectedValueOnce(new Error('目录读取失败')).mockResolvedValueOnce(nodes);
    await renderPreview({ onLoad, renderTreeNodes: () => <span>SKILL.md</span> });
    expect(container.querySelector('[role="alert"]').textContent).toBe('目录读取失败');
    expect(container.textContent).not.toContain('目录为空');
    expect(container.textContent).not.toContain('加载目录中');
    await act(async () => refresh().click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('SKILL.md');
  });

  it.each(['resolve', 'reject'])('ignores an old load that settles via %s after the root changes', async (settle) => {
    const oldLoad = deferred();
    const newLoad = deferred();
    const onLoad = vi.fn().mockReturnValueOnce(oldLoad.promise).mockReturnValueOnce(newLoad.promise);
    const renderTreeNodes = vi.fn(() => <span>new tree</span>);
    await renderPreview({ onLoad, renderTreeNodes });
    const nextPreview = { skillKey: 'two', rootPath: '/skills/two', title: '技能二源码' };
    await renderPreview({ preview: nextPreview, onLoad, renderTreeNodes });
    expect(onLoad).toHaveBeenLastCalledWith(nextPreview);
    await act(async () => oldLoad[settle](settle === 'resolve' ? nodes : new Error('旧目录错误')));
    expect(container.textContent).toContain('加载目录中');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(renderTreeNodes).not.toHaveBeenCalled();
    await act(async () => newLoad.resolve(nodes));
    expect(renderTreeNodes).toHaveBeenLastCalledWith('skill-source:/skills/two', '/skills/two', nodes, 0);
    expect(container.querySelector('h1').textContent).toBe(nextPreview.title);
  });

  it('ignores an older request when refreshed before loading finishes', async () => {
    const first = deferred();
    const second = deferred();
    const onLoad = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const renderTreeNodes = vi.fn(() => <span>latest tree</span>);
    await renderPreview({ onLoad, renderTreeNodes });
    await act(async () => refresh().click());
    await act(async () => second.resolve(nodes));
    await act(async () => first.reject(new Error('stale error')));
    expect(container.textContent).toContain('latest tree');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not load without a root and disables refresh and reveal, including after a root switch', async () => {
    const pending = deferred();
    const onLoad = vi.fn(() => pending.promise);
    const renderTreeNodes = vi.fn();
    const missingRoot = { skillKey: 'missing', title: '未定位技能' };
    await renderPreview({ preview: missingRoot, onLoad, renderTreeNodes });
    expect(onLoad).not.toHaveBeenCalled();
    expect(container.textContent).toContain('无法定位技能目录');
    expect(refresh().disabled).toBe(true);
    expect(reveal().disabled).toBe(true);
    await act(async () => { refresh().click(); reveal().click(); });
    expect(onLoad).not.toHaveBeenCalled();
    expect(window.api.file.openPath).not.toHaveBeenCalled();
    await renderPreview({ onLoad, renderTreeNodes });
    expect(onLoad).toHaveBeenCalledOnce();
    await renderPreview({ preview: missingRoot, onLoad, renderTreeNodes });
    await act(async () => pending.resolve(nodes));
    expect(container.textContent).toContain('无法定位技能目录');
    expect(renderTreeNodes).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('加载目录中');
  });

  it('ignores a pending load after unmounting', async () => {
    const pending = deferred();
    const renderTreeNodes = vi.fn();
    await renderPreview({ onLoad: () => pending.promise, renderTreeNodes });
    await act(async () => root.render(null));
    await act(async () => pending.resolve(nodes));
    expect(renderTreeNodes).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });
});
