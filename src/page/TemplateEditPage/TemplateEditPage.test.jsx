// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addEditorElement, analyzeEditorDocument } from '../../main/template/editorModel';
import { applyEditorAction } from '../../main/template/editorActions';
import { mixedTrackFixture } from '../../main/template/workflowTestUtils';
import { createEditorPreset } from '../../main/template/editorPresets';
import TemplateEditPage from './TemplateEditPage';

vi.mock('@uiw/react-codemirror', () => ({
  default: React.forwardRef(function EditorMock({ value }, ref) {
    React.useImperativeHandle(ref, () => ({
      view: { state: { doc: { toString: () => value } }, dispatch: vi.fn() }
    }), [value]);
    return <pre data-testid="editor">{value}</pre>;
  })
}));

let root;
let container;
let invoke;
beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const template = mixedTrackFixture();
  template.scenes[0].tracks.push({
    id: 'upper', name: '上层图片', type: 'video', track_relative_index: 10,
    segments: [{ id: 'upper-image', material_id: 'photo', target_timerange: { duration: 8_000_000 } }]
  });
  invoke = vi.fn(async (channel, payload, input) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(template) };
    if (channel === 'template:editor-analyze') return analyzeEditorDocument(payload);
    if (channel === 'template:editor-add') return addEditorElement(payload, input);
    if (channel === 'template:editor-edit') return applyEditorAction(payload, input);
    throw new Error(`Unexpected IPC: ${channel}`);
  });
  window.electron = { ipcRenderer: { invoke } };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.electron;
  vi.useRealTimers();
});

async function render() {
  await act(async () => root.render(<TemplateEditPage />));
  await act(async () => vi.advanceTimersByTimeAsync(250));
}

async function enterScene(id = 'scene-1') {
  const element = container.querySelector(`[data-element-id="${id}"]`);
  await act(async () => element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
}
async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(250));
}
async function key(element, value, options = {}) {
  await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value, ...options })));
}

it('层级树不暴露轨道节点；进入 Scene 后混排四种素材仍只占一行', async () => {
  await render();
  expect(container.querySelectorAll('.template-clip')).toHaveLength(1);
  await enterScene('scene');
  const labels = [...container.querySelectorAll('.template-track-select')];
  expect(labels.map((element) => element.getAttribute('aria-label'))).toEqual([
    '选择轨道 上层图片', '选择轨道 混排轨道'
  ]);
  expect(container.querySelector('[data-element-id="mixed"]')).toBeNull();
  expect(container.querySelector('[data-element-id="upper"]')).toBeNull();
  const rows = container.querySelectorAll('.template-track-row');
  expect(rows).toHaveLength(2);
  expect(rows[1].querySelectorAll('.template-clip')).toHaveLength(4);
  expect(labels[0].querySelector('b').textContent).toBe('11');
});

it('时间轴标签可选中逻辑轨道，追加时空间不足会显示错误', async () => {
  await render();
  await enterScene('scene');
  await act(async () => container.querySelector('[aria-label="选择轨道 混排轨道"]').click());
  expect(container.querySelector('.template-track-label.is-selected .template-track-select').getAttribute('aria-label'))
    .toBe('选择轨道 混排轨道');
  await act(async () => container.querySelector('[aria-label="添加文字"]').click());
  expect(invoke.mock.calls.find(([channel]) => channel === 'template:editor-add')[2])
    .toEqual({ type: 'text', selectedId: 'mixed' });
  expect(container.querySelector('[role="alert"]').textContent).toContain('没有剩余时间');
});

it('自动 Scene 时长在时间轴更新，末尾追加后继续增长', async () => {
  const template = createEditorPreset('mixed-track');
  template.scenes[0].tracks[1].segments[3].target_timerange.duration = 8_000_000;
  invoke.mockImplementation(async (channel, payload, input) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(template) };
    if (channel === 'template:editor-analyze') return analyzeEditorDocument(payload);
    if (channel === 'template:editor-add') return addEditorElement(payload, input);
    if (channel === 'template:editor-edit') return applyEditorAction(payload, input);
    throw new Error(`Unexpected IPC: ${channel}`);
  });
  await render();
  await enterScene();
  expect(container.querySelector('.template-timeline-duration').textContent).toBe('总时长 20 秒');
  await act(async () => container.querySelector('[aria-label="选择轨道 上层 · 图片文字混排"]').click());
  await act(async () => container.querySelector('[aria-label="添加文字"]').click());
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(container.querySelector('.template-timeline-duration').textContent).toBe('总时长 25 秒');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('一句一图的子 Scene 在父轨道显示，点击后可折叠或向其内部添加素材', async () => {
  const template = createEditorPreset('sentence-image');
  invoke.mockImplementation(async (channel, payload, input) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(template) };
    if (channel === 'template:editor-analyze') return analyzeEditorDocument(payload);
    if (channel === 'template:editor-add') return addEditorElement(payload, input);
    if (channel === 'template:editor-edit') return applyEditorAction(payload, input);
    throw new Error(`Unexpected IPC: ${channel}`);
  });
  await render();
  await enterScene();
  const sceneClips = container.querySelectorAll('.template-clip--scene');
  expect(sceneClips).toHaveLength(3);
  expect(container.querySelectorAll('.template-track-row')).toHaveLength(1);
  await act(async () => sceneClips[1].click());
  expect(container.querySelector('.template-clip--scene.is-selected').textContent).toContain('第 2 组');
  await act(async () => container.querySelector('[aria-label="折叠 第 2 组 · 一句一图"]').click());
  expect(container.querySelector('[aria-label="展开 第 2 组 · 一句一图"]')).not.toBeNull();
  await act(async () => container.querySelector('[aria-label="添加文字"]').click());
  await act(async () => vi.advanceTimersByTimeAsync(250));
  const document = JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  const second = document.scenes[0].tracks[0].segments[1];
  expect(second.tracks).toHaveLength(3);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('添加 Scene 按钮向选中父轨道追加子 Scene，不触发文件选择', async () => {
  const template = createEditorPreset('sentence-image');
  invoke.mockImplementation(async (channel, payload, input) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(template) };
    if (channel === 'template:editor-analyze') return analyzeEditorDocument(payload);
    if (channel === 'template:editor-add') return addEditorElement(payload, input);
    if (channel === 'template:editor-edit') return applyEditorAction(payload, input);
    throw new Error(`Unexpected IPC: ${channel}`);
  });
  await render();
  await enterScene();
  await act(async () => container.querySelector('[aria-label="选择轨道 一句一图 · 子场景"]').click());
  await act(async () => container.querySelector('[aria-label="添加 Scene"]').click());
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(invoke.mock.calls.find(([channel]) => channel === 'template:editor-add')[2])
    .toEqual({ type: 'scene', selectedId: 'sentence-scenes' });
  expect(container.querySelectorAll('.template-clip--scene')).toHaveLength(4);
  expect(container.querySelector('.template-timeline-duration').textContent).toBe('总时长 20 秒');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('双击进入局部时间轴，面包屑和 Escape 返回父层', async () => {
  const template = createEditorPreset('sentence-image');
  invoke.mockImplementation(async (channel, payload) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(template) };
    return analyzeEditorDocument(payload);
  });
  await render();
  await enterScene();
  await act(async () => container.querySelector('[data-clip-id="sentence-scene-2"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(container.querySelectorAll('.template-track-row')).toHaveLength(2);
  expect(container.querySelector('[data-clip-id="text-2"]').getAttribute('aria-label')).toContain('0 到 5 秒');
  expect(container.querySelector('[aria-label="Scene 路径"] [aria-current]').textContent).toContain('第 2 组');
  await key(container.querySelector('main'), 'Escape');
  expect(container.querySelectorAll('.template-clip--scene')).toHaveLength(3);
  await act(async () => container.querySelector('[aria-label="打开模版时间轴"]').click());
  expect(container.querySelectorAll('.template-clip--scene')).toHaveLength(1);
});

it('方向键移动片段，撤销重做与 JSON 一致', async () => {
  await render();
  await enterScene('scene');
  await key(container.querySelector('[data-clip-id="upper-image"]'), 'ArrowRight');
  await settle();
  const current = () => JSON.parse(container.querySelector('[data-testid="editor"]').textContent).scenes[0].tracks[1].segments[0];
  expect(current().target_timerange.start).toBe(100_000);
  await act(async () => container.querySelector('[aria-label="撤销"]').click());
  await settle();
  expect(current().target_timerange.start).toBeUndefined();
  await act(async () => container.querySelector('[aria-label="重做"]').click());
  await settle();
  expect(current().target_timerange.start).toBe(100_000);
});

it('轨道锁定阻止键盘移动和删除，解锁后可删除并撤销', async () => {
  await render();
  await enterScene('scene');
  await act(async () => container.querySelector('[aria-label="锁定轨道 上层图片"]').click());
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  await act(async () => clip.click());
  await key(clip, 'ArrowRight');
  expect(invoke.mock.calls.some(([channel]) => channel === 'template:editor-edit')).toBe(false);
  await key(clip, 'Delete');
  expect(container.querySelector('[role="alert"]').textContent).toContain('锁定');
  await act(async () => container.querySelector('[aria-label="解锁轨道 上层图片"]').click());
  await key(clip, 'Delete');
  await settle();
  expect(container.querySelector('[data-clip-id="upper-image"]')).toBeNull();
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
  await settle();
  expect(container.querySelector('[data-clip-id="upper-image"]')).not.toBeNull();
});

it('拖动仅在松手时提交，同轨冲突保持原始 JSON', async () => {
  await render();
  await enterScene('scene');
  const before = container.querySelector('[data-testid="editor"]').textContent;
  const clip = container.querySelector('[data-clip-id="image"]');
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 100, button: 0 })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 74, clientY: 100, ctrlKey: true })));
  expect(invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit')).toHaveLength(0);
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 74, clientY: 100 })));
  expect(container.querySelector('[role="alert"]').textContent).toMatch(/重叠|冲突/);
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  expect(container.querySelector('[aria-label="撤销"]').disabled).toBe(true);
});

it('取消拖动不提交，缩放和游标只影响视图', async () => {
  await render();
  await enterScene('scene');
  const before = container.querySelector('[data-testid="editor"]').textContent;
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50, button: 0 })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 74 })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true })));
  const width = container.querySelector('.template-timeline-inner').style.width;
  await act(async () => container.querySelector('[aria-label="放大时间轴"]').click());
  expect(container.querySelector('.template-timeline-inner').style.width).not.toBe(width);
  await key(container.querySelector('[aria-label="时间轴游标"]'), 'ArrowRight');
  expect(container.querySelector('[aria-label="当前时间（秒）"]').value).toBe('0.1');
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  expect(invoke.mock.calls.some(([channel]) => channel === 'template:editor-edit')).toBe(false);
});

it('树节点键盘导航、折叠与 F2 重命名入口', async () => {
  await render();
  const scene = container.querySelector('[data-element-id="scene"]');
  await act(async () => scene.click());
  await key(scene, 'ArrowLeft');
  expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
  await key(scene, 'ArrowRight');
  await key(scene, 'ArrowDown');
  expect(container.querySelector('[role="treeitem"][aria-selected="true"]').dataset.elementId).toBe('upper-image');
  await key(container.querySelector('[data-element-id="upper-image"]'), 'F2');
  expect(container.querySelector('[aria-label="元素名称"]')).not.toBeNull();
  await key(container.querySelector('[aria-label="元素名称"]'), 'Escape');
  expect(container.querySelector('[aria-label="元素名称"]')).toBeNull();
});
