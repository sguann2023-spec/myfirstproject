// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addEditorElement, analyzeEditorDocument } from '../../main/template/editorModel';
import { applyEditorAction } from '../../main/template/editorActions';
import { mixedTrackFixture } from '../../main/template/workflowTestUtils';
import { createEditorPreset } from '../../main/template/editorPresets';
import TemplateEditPage from './TemplateEditPage';
import { wheelIntent } from '../../components/TemplateEditor/Timeline/viewport';

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
async function inputValue(element, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
  await act(async () => element.dispatchEvent(new Event('input', { bubbles: true })));
}

it('层级树不暴露轨道节点；进入分镜后混排四种素材仍只占一行', async () => {
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

it('根层添加基础元素后自动进入所属分镜，撤销恢复根层', async () => {
  await render();
  await act(async () => container.querySelector('[aria-label="添加文字"]').click());
  await settle();
  expect(container.querySelector('[aria-label="分镜路径"] [aria-current="page"]').textContent).toBe('混排分镜');
  expect(container.querySelector('.template-clip.is-selected').textContent).toContain('Your text here');
  expect(container.querySelector('[role="treeitem"][aria-selected="true"]').textContent).toContain('Your text here');
  await act(async () => container.querySelector('[aria-label="撤销"]').click());
  await settle();
  expect(container.querySelector('[aria-label="打开模版时间轴"]').getAttribute('aria-current')).toBe('page');
  expect(container.querySelectorAll('.template-clip')).toHaveLength(1);
});

it('批量分镜按钮向当前轨道添加批量分镜', async () => {
  await render();
  await act(async () => container.querySelector('[aria-label="添加批量分镜"]').click());
  await settle();
  expect(invoke.mock.calls.find(([channel]) => channel === 'template:editor-add')[2])
    .toMatchObject({ type: 'batch-scene', scopeId: null });
  expect(container.querySelector('[aria-label="分镜路径"] [aria-current="page"]').textContent).toBe('混排分镜');
  expect(container.querySelector('.template-clip.is-selected').textContent).toContain('批量分镜');
  const draft = JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  expect(draft.scenes[0].tracks.at(-1).segments[0]).toMatchObject({
    name: '批量分镜', type: 'scene', dynamic: ['batch_scene.items'], batch_scene: { source: 'items', mode: 'repeat' }
  });
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('选中折叠的第二个根分镜后添加，自动展开并进入第二个分镜', async () => {
  await render();
  await act(async () => container.querySelector('[aria-label="添加分镜"]').click());
  await settle();
  expect(container.querySelector('[aria-label="打开模版时间轴"]').getAttribute('aria-current')).toBe('page');
  await act(async () => container.querySelector('[aria-label="折叠 分镜"]').click());
  await act(async () => container.querySelector('[aria-label="添加文字"]').click());
  await settle();
  expect(container.querySelector('[aria-label="分镜路径"] [aria-current="page"]').textContent).toBe('分镜');
  expect(container.querySelector('[aria-label="折叠 分镜"]')).not.toBeNull();
  expect(container.querySelector('.template-clip.is-selected').getAttribute('aria-label')).toBe('文字，0 到 5 秒');
  const draft = JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  expect(draft.scenes[0].tracks).toHaveLength(2);
  expect(draft.scenes[1].tracks).toHaveLength(1);
});

it.each(['取消', '失败'])('根层添加素材%s时不自动进入分镜', async (result) => {
  await render();
  const before = container.querySelector('[data-testid="editor"]').textContent;
  const implementation = invoke.getMockImplementation();
  invoke.mockImplementation((channel, ...args) => {
    if (channel === 'template:editor-add') {
      if (result === '失败') return Promise.reject(new Error('添加失败'));
      return Promise.resolve(null);
    }
    return implementation(channel, ...args);
  });
  await act(async () => container.querySelector('[aria-label="添加图片"]').click());
  await settle();
  expect(container.querySelector('[aria-label="打开模版时间轴"]').getAttribute('aria-current')).toBe('page');
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
});

it('时间轴标签可选中逻辑轨道，追加时空间不足会显示错误', async () => {
  await render();
  await enterScene('scene');
  await act(async () => container.querySelector('[aria-label="选择轨道 混排轨道"]').click());
  expect(container.querySelector('.template-track-label.is-selected .template-track-select').getAttribute('aria-label'))
    .toBe('选择轨道 混排轨道');
  await act(async () => container.querySelector('[aria-label="添加文字"]').click());
  expect(invoke.mock.calls.find(([channel]) => channel === 'template:editor-add')[2])
    .toEqual({ type: 'text', selectedId: 'mixed', scopeId: 'scene' });
  expect(container.querySelector('[role="alert"]').textContent).toContain('没有剩余时间');
});

it('自动分镜时长在时间轴更新，末尾追加后继续增长', async () => {
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

it('顶部模版标题点击后可编辑并保存为根分镜名称', async () => {
  await render();
  const title = container.querySelector('[aria-label="模版名称"]');
  await act(async () => title.focus());
  await inputValue(title, 'Creatomate Style Title');
  await act(async () => title.blur());
  await settle();
  const actions = invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit').map(call => call[2]);
  expect(actions.at(-1)).toMatchObject({ type: 'rename', id: 'scene', name: 'Creatomate Style Title' });
  expect(JSON.parse(container.querySelector('[data-testid="editor"]').textContent).scenes[0].name).toBe('Creatomate Style Title');
  expect(container.querySelector('[aria-label="模版名称"]').value).toBe('Creatomate Style Title');
});

it('左侧层级树的分镜行也可通过 F2 重命名', async () => {
  await render();
  const sceneRow = container.querySelector('[data-element-id="scene"]');
  await act(async () => sceneRow.click());
  await key(sceneRow, 'F2');
  const input = container.querySelector('[aria-label="元素名称"]');
  await inputValue(input, '分镜可编辑');
  await act(async () => input.blur());
  await settle();
  const actions = invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit').map(call => call[2]);
  expect(actions.at(-1)).toMatchObject({ type: 'rename', id: 'scene', name: '分镜可编辑' });
  expect(JSON.parse(container.querySelector('[data-testid="editor"]').textContent).scenes[0].name).toBe('分镜可编辑');
});

it('分镜自动时长弹窗使用 Creatomate 风格的 Auto 说明', async () => {
  invoke.mockImplementation((channel, payload, action) => {
    if (channel === 'template:editor-defaults') return Promise.resolve({ templateJson: JSON.stringify(createEditorPreset('mixed-track')), templateStorage: null });
    if (channel === 'template:editor-analyze') return Promise.resolve(analyzeEditorDocument(payload));
    if (channel === 'template:editor-edit') return Promise.resolve(applyEditorAction(payload, action));
    return Promise.resolve({});
  });
  await render();
  await enterScene();
  await act(async () => container.querySelector('[aria-label="调整分镜时长"]').click());
  expect(container.querySelector('.template-duration-popover h3').textContent).toBe('Duration');
  expect(container.querySelector('[aria-label="分镜固定时长"]').value).toBe('00:16.00');
  expect(container.querySelector('[role="radio"][aria-checked="true"]').textContent).toContain('Auto');
  expect(document.activeElement).toBe(container.querySelector('[role="radio"][aria-checked="true"]'));
  expect(container.querySelector('.template-duration-popover p').textContent).toBe('As long as its longest clip.');
});

it('一句一图的子分镜可折叠，双击进入后向其内部添加素材', async () => {
  const template = createEditorPreset('sentence-image');
  invoke.mockImplementation(async (channel, payload, input) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(template) };
    if (channel === 'template:editor-analyze') return analyzeEditorDocument(payload);
    if (channel === 'template:editor-add') return addEditorElement(payload, input);
    if (channel === 'template:editor-edit') return applyEditorAction(payload, input);
    throw new Error(`Unexpected IPC: ${channel}`);
  });
  await render();
  expect(window.document.title).toBe('一句一图');
  expect(container.querySelector('[aria-label="模版名称"]').value).toBe('一句一图');
  expect(container.querySelector('[aria-label="打开模版时间轴"]').textContent).toContain('一句一图');
  await enterScene();
  const sceneClips = container.querySelectorAll('.template-clip--scene');
  expect(sceneClips).toHaveLength(3);
  expect(container.querySelectorAll('.template-track-row')).toHaveLength(1);
  await act(async () => sceneClips[1].click());
  expect(container.querySelector('.template-clip--scene.is-selected').textContent).toContain('第 2 组');
  await act(async () => container.querySelector('[aria-label="折叠 第 2 组 · 一句一图"]').click());
  expect(container.querySelector('[aria-label="展开 第 2 组 · 一句一图"]')).not.toBeNull();
  await act(async () => sceneClips[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await act(async () => container.querySelector('[aria-label="添加文字"]').click());
  await act(async () => vi.advanceTimersByTimeAsync(250));
  const draft = JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  const second = draft.scenes[0].tracks[0].segments[1];
  expect(second.tracks).toHaveLength(3);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('分镜内选中子分镜后添加文字，同轨混排且支持撤销', async () => {
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
  await act(async () => container.querySelectorAll('.template-clip--scene')[2].click());
  await act(async () => container.querySelector('[aria-label="添加文字"]').click());
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(container.querySelectorAll('.template-track-row')).toHaveLength(1);
  expect(container.querySelectorAll('.template-clip--scene')).toHaveLength(3);
  expect(container.querySelector('.template-clip:not(.template-clip--scene)').getAttribute('aria-label')).toBe('文字，15 到 20 秒');
  const draft = JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  expect(draft.tracks).toBeUndefined();
  expect(draft.scenes[0].tracks[0].segments[2].tracks).toHaveLength(2);
  expect(container.querySelector('.template-timeline-duration').textContent).toBe('总时长 20 秒');
  await act(async () => container.querySelector('[aria-label="撤销"]').click());
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(container.querySelector('.template-clip:not(.template-clip--scene)')).toBeNull();
  expect(container.querySelector('.template-timeline-duration').textContent).toBe('总时长 15 秒');
});

it('添加分镜按钮向选中父轨道追加子分镜，不触发文件选择', async () => {
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
  await act(async () => container.querySelector('[aria-label="选择轨道 一句一图 · 子分镜"]').click());
  await act(async () => container.querySelector('[aria-label="添加分镜"]').click());
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(invoke.mock.calls.find(([channel]) => channel === 'template:editor-add')[2])
    .toEqual({ type: 'scene', selectedId: 'sentence-scenes', scopeId: 'scene-1' });
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
  expect(container.querySelector('[aria-label="分镜路径"] [aria-current]').textContent).toContain('第 2 组');
  await key(container.querySelector('main'), 'Escape');
  expect(container.querySelectorAll('.template-clip--scene')).toHaveLength(3);
  await act(async () => container.querySelector('[aria-label="打开模版时间轴"]').click());
  expect(container.querySelectorAll('.template-clip--scene')).toHaveLength(1);
});

it('层级树定位箭头可快速进入嵌套分镜并选中目标', async () => {
  const template = createEditorPreset('sentence-image');
  invoke.mockImplementation(async (channel, payload) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(template) };
    return analyzeEditorDocument(payload);
  });
  await render();
  await act(async () => container.querySelector('[aria-label="在时间轴中定位 第 2 句话"]').click());
  expect(container.querySelector('[aria-label="分镜路径"] [aria-current]').textContent).toContain('第 2 组');
  expect(container.querySelector('[data-clip-id="text-2"]')).not.toBeNull();
  expect(container.querySelector('[data-clip-id="text-2"]').getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('[aria-label="当前时间（秒）"]').value).toBe('0');
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

it.each(['开始', '结束'])('拖动%s边缘松手后保持新位置直到IPC和分析完成，不回跳', async edge => {
  await render();
  await enterScene('scene');
  const original = invoke.getMockImplementation();
  let completeEdit;
  let completeAnalysis;
  invoke.mockImplementation((channel, payload, input) => {
    if (channel === 'template:editor-edit') return new Promise(resolve => {
      completeEdit = () => resolve(applyEditorAction(payload, input));
    });
    if (channel === 'template:editor-analyze') return new Promise(resolve => {
      completeAnalysis = () => resolve(analyzeEditorDocument(payload));
    });
    return original(channel, payload, input);
  });
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  const handle = clip.querySelector(`[aria-label="调整 upper-image ${edge}"]`) ??
    clip.querySelector(edge === '开始' ? '.template-clip-edge--start' : '.template-clip-edge--end');
  const before = { left: clip.style.left, width: clip.style.width };
  await act(async () => handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 100, button: 0 })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: edge === '开始' ? 224 : 176, clientY: 100, ctrlKey: true })));
  const moved = { left: clip.style.left, width: clip.style.width };
  expect(moved).not.toEqual(before);
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
  expect({ left: clip.style.left, width: clip.style.width }).toEqual(moved);
  expect(clip.classList.contains('is-dragging')).toBe(false);
  await act(async () => completeEdit());
  expect({ left: clip.style.left, width: clip.style.width }).toEqual(moved);
  await settle();
  expect({ left: clip.style.left, width: clip.style.width }).toEqual(moved);
  await act(async () => completeAnalysis());
  expect(parseFloat(clip.style.left)).toBeCloseTo(parseFloat(moved.left), 5);
  expect(parseFloat(clip.style.width)).toBeCloseTo(parseFloat(moved.width), 5);
});

it('边缘提交失败时才恢复原位置，且不留下预览或历史', async () => {
  await render();
  await enterScene('scene');
  const original = invoke.getMockImplementation();
  let rejectEdit;
  invoke.mockImplementation((channel, ...args) => channel === 'template:editor-edit' ?
    new Promise((_resolve, reject) => { rejectEdit = reject; }) : original(channel, ...args));
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  const before = clip.style.width;
  await act(async () => clip.querySelector('.template-clip-edge--end').dispatchEvent(new MouseEvent('pointerdown', {
    bubbles: true, clientX: 200, clientY: 100, button: 0
  })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 176, clientY: 100, ctrlKey: true })));
  const moved = clip.style.width;
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
  expect(clip.style.width).toBe(moved);
  await act(async () => rejectEdit(new Error('提交失败')));
  expect(clip.style.width).toBe(before);
  expect(container.querySelector('[role="alert"]').textContent).toBe('提交失败');
  expect(container.querySelector('[aria-label="撤销"]').disabled).toBe(true);
});

it('拖动仅在松手时提交，重叠落点插入并可撤销', async () => {
  await render();
  await enterScene('scene');
  const before = container.querySelector('[data-testid="editor"]').textContent;
  const clip = container.querySelector('[data-clip-id="image"]');
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 100, button: 0 })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 74, clientY: 100, ctrlKey: true })));
  expect(invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit')).toHaveLength(0);
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 74, clientY: 100 })));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[data-testid="editor"]').textContent).not.toBe(before);
  expect(invoke.mock.calls.find(([channel]) => channel === 'template:editor-edit')[2].type).toBe('move-clip');
  expect(container.querySelector('[aria-label="撤销"]').disabled).toBe(false);
  await act(async () => container.querySelector('[aria-label="撤销"]').click());
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
});

it('跨轨拖动跟手浮动，显示轨道和间隙落点，松手建立新轨道', async () => {
  await render();
  await enterScene('scene');
  const scroller = container.querySelector('.template-timeline-scroll');
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 1000 });
  container.querySelectorAll('[data-track-id]').forEach((row, index) => {
    row.getBoundingClientRect = () => ({ top: 100 + index * 35, bottom: 135 + index * 35 });
  });
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 110, button: 0 })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 150 })));
  expect(clip.classList.contains('is-floating')).toBe(true);
  expect(clip.style.transform).toBe('translateY(40px)');
  expect(container.querySelector('.is-clip-drop-target').dataset.trackId).toBe('mixed');
  expect(container.querySelector('.template-clip-ghost')).toBeNull();
  await act(async () => clip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 170 })));
  expect(container.querySelector('.template-clip-drop-line')).not.toBeNull();
  expect(invoke.mock.calls.some(([channel]) => channel === 'template:editor-edit')).toBe(false);
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 200, clientY: 170 })));
  await settle();
  expect(invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit').map(call => call[2]))
    .toEqual([expect.objectContaining({ type: 'move-clip', beforeTrackId: null })]);
  expect(container.querySelector('[role="alert"]')?.textContent).toBeUndefined();
  expect(container.querySelectorAll('[data-track-id]')).toHaveLength(2);
  expect(container.querySelector('[data-track-id="upper"]')).toBeNull();
  expect(container.querySelector('.is-floating')).toBeNull();
  expect(container.querySelector('.template-clip-drop-line')).toBeNull();
  await act(async () => container.querySelector('[aria-label="撤销"]').click());
  await settle();
  expect(container.querySelectorAll('[data-track-id]')).toHaveLength(2);
  expect(container.querySelector('[data-track-id="upper"]')).not.toBeNull();
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

it('播放头贯穿整条时间线，刻度圆点和 Auto 标签独立显示', async () => {
  invoke.mockImplementationOnce(async () => ({
    templateJson: JSON.stringify(createEditorPreset('sentence-image'))
  }));
  await render();
  await enterScene();
  expect(container.querySelectorAll('.template-playhead')).toHaveLength(1);
  const playhead = container.querySelector('.template-playhead');
  expect(playhead.parentElement.className).toBe('template-timeline-inner');
  expect(container.querySelector('.template-track-lane .template-playhead')).toBeNull();
  expect(container.querySelectorAll('.template-ruler-mark > i').length).toBeGreaterThanOrEqual(5);
  expect(container.querySelector('.template-duration-label').textContent).toBe('Auto');
  const left = parseFloat(playhead.style.left);
  await key(container.querySelector('[aria-label="时间轴游标"]'), 'ArrowRight');
  expect(parseFloat(container.querySelector('.template-playhead').style.left)).toBeGreaterThan(left);
  expect(container.querySelectorAll('.template-outside-scene')).toHaveLength(1);
  expect(container.querySelector('.template-add-scene').style.left)
    .toBe(container.querySelector('.template-outside-scene').style.left);
  const scroller = container.querySelector('.template-timeline-scroll');
  await act(async () => {
    scroller.scrollLeft = 100;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  expect(container.querySelector('.template-playhead').style.visibility).toBe('hidden');
  await act(async () => {
    scroller.scrollLeft = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  expect(container.querySelector('.template-playhead').style.visibility).toBe('');
});

it('时间线区域连续捏合缩放锁定鼠标时间，横移和 Shift 滚轮仅平移视图', async () => {
  await render();
  const before = container.querySelector('[data-testid="editor"]').textContent;
  const scroller = container.querySelector('.template-timeline-scroll');
  const clip = container.querySelector('.template-clip');
  const clipWidth = () => parseFloat(clip.style.width);
  const initialWidth = clipWidth();
  const wheel = options => new WheelEvent('wheel', {
    bubbles: true, cancelable: true, clientX: 264, ...options
  });
  const first = wheel({ ctrlKey: true, deltaY: -10 });
  await act(async () => {
    scroller.dispatchEvent(first);
    scroller.dispatchEvent(wheel({ ctrlKey: true, deltaY: -10 }));
  });
  expect(first.defaultPrevented).toBe(true);
  expect(clipWidth() / initialWidth).toBeCloseTo(wheelIntent(first, 300).factor ** 2);
  expect((scroller.scrollLeft + 100) / clipWidth()).toBeCloseTo(100 / initialWidth);
  const width = clipWidth();
  const scroll = scroller.scrollLeft;
  await act(async () => clip.dispatchEvent(wheel({ deltaX: 1 })));
  expect(scroller.scrollLeft).toBeCloseTo(scroll + 1);
  await act(async () => scroller.dispatchEvent(wheel({ shiftKey: true, deltaY: -.5 })));
  expect(scroller.scrollLeft).toBeCloseTo(scroll + .5);
  expect(clipWidth()).toBe(width);
  await act(async () => {
    scroller.dispatchEvent(wheel({ ctrlKey: true, deltaY: 10 }));
    scroller.dispatchEvent(wheel({ ctrlKey: true, deltaY: 10 }));
  });
  expect(clipWidth()).toBeCloseTo(initialWidth);
  expect(scroller.scrollLeft).toBeCloseTo(0);
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  expect(invoke.mock.calls.some(([channel]) => channel === 'template:editor-edit')).toBe(false);
});

it('滚轮不接管左侧时间输入，纵向滚动保留轨道滚动且缩小覆盖完整刻度', async () => {
  await render();
  const scroller = container.querySelector('.template-timeline-scroll');
  const input = container.querySelector('[aria-label="当前时间（秒）"]');
  const ignored = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100, clientX: 50 });
  await act(async () => input.dispatchEvent(ignored));
  expect(ignored.defaultPrevented).toBe(false);
  await act(async () => scroller.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, deltaY: 30, clientX: 264
  })));
  expect(scroller.scrollTop).toBe(30);
  const width = parseFloat(container.querySelector('.template-clip').style.width);
  await act(async () => container.querySelector('[aria-label="缩小时间轴"]').click());
  expect(parseFloat(container.querySelector('.template-clip').style.width)).toBeLessThan(width);
  expect(parseFloat(container.querySelector('.template-timeline-inner').style.width)).toBe(404);
});

it('横向滚动条仅覆盖时间区域，与滚轮平移双向同步', async () => {
  await render();
  expect(container.querySelector('.template-timeline-horizontal-scroll')).toBeNull();
  await act(async () => container.querySelector('[aria-label="放大时间轴"]').click());
  const bar = container.querySelector('.template-timeline-horizontal-scroll');
  const scroller = container.querySelector('.template-timeline-scroll');
  expect(bar.style.marginLeft).toBe('164px');
  expect(bar.style.width).toBe('240px');
  expect(bar.parentElement.className).toBe('template-edit-timeline');
  await act(async () => {
    bar.scrollLeft = 20;
    bar.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  expect(scroller.scrollLeft).toBe(20);
  await act(async () => scroller.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, clientX: 264, deltaX: -5
  })));
  expect(bar.scrollLeft).toBe(15);
  expect(scroller.scrollLeft).toBe(15);
  await act(async () => container.querySelector('[aria-label="缩小时间轴"]').click());
  expect(container.querySelector('.template-timeline-horizontal-scroll')).toBeNull();
  expect(scroller.scrollLeft).toBe(0);
});

it('时间线仅保留加减缩放按钮，不显示吸附与适应全部时长', async () => {
  await render();
  expect(container.querySelector('[aria-label="时间轴吸附"]')).toBeNull();
  expect(container.querySelector('[aria-label="适应全部时长"]')).toBeNull();
  expect([...container.querySelectorAll('.template-timeline-heading .template-timeline-button')]
    .map(button => button.getAttribute('aria-label'))).toEqual(['缩小时间轴', '放大时间轴']);
});

it('两端时间图标打开同一弹窗，不触发片段拖动；自动开始和撤销写回 JSON', async () => {
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="image"]');
  const trigger = clip.querySelector('.template-clip-timing-trigger--start');
  expect(clip.tagName).toBe('DIV');
  expect(clip.querySelectorAll('button')).toHaveLength(2);
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    trigger.click();
  });
  expect(invoke.mock.calls.some(([channel]) => channel === 'template:editor-edit')).toBe(false);
  const dialog = () => document.querySelector('[role="dialog"]');
  expect(dialog().getAttribute('aria-label')).toContain('时间设置');
  const before = container.querySelector('[data-testid="editor"]').textContent;
  await act(async () => dialog().querySelector('[aria-label="开始规则"] [role="radio"]').click());
  await settle();
  expect(invoke.mock.calls.find(([channel]) => channel === 'template:editor-edit')[2])
    .toEqual({ type: 'clip-timing', id: 'image', field: 'start', mode: 'auto' });
  expect(dialog().querySelector('[aria-label="开始规则"] [role="radio"]').getAttribute('aria-checked')).toBe('true');
  await key(dialog().querySelector('input'), 'Escape');
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await act(async () => container.querySelector('[aria-label="撤销"]').click());
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  await act(async () => clip.querySelector('.template-clip-timing-trigger--end').click());
  expect(dialog()).not.toBeNull();
  await act(async () => container.querySelector('main').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  expect(dialog()).toBeNull();
});

it('自动开始后手动拖动左边缘会切回固定开始', async () => {
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  await act(async () => clip.querySelector('.template-clip-timing-trigger--start').click());
  const dialog = () => document.querySelector('[role="dialog"]');
  await act(async () => dialog().querySelector('[aria-label="开始规则"] [role="radio"]').click());
  await settle();
  expect(dialog().querySelector('[aria-label="开始规则"] [role="radio"]').getAttribute('aria-checked')).toBe('true');
  await act(async () => clip.querySelector('.template-clip-edge--start').dispatchEvent(new MouseEvent('pointerdown', {
    bubbles: true, clientX: 200, clientY: 100, button: 0
  })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 224, clientY: 100, ctrlKey: true })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
  await settle();
  const segment = JSON.parse(container.querySelector('[data-testid="editor"]').textContent).scenes[0].tracks[1].segments[0];
  expect(segment.auto_timing?.start).toBeUndefined();
  expect(segment.target_timerange.start).toBeGreaterThan(0);
  await act(async () => container.querySelector('[data-clip-id="upper-image"] .template-clip-timing-trigger--start').click());
  expect(dialog().querySelector('[aria-label="开始规则"] .is-active')).not.toBeNull();
});

it('自动开始后手动拖动片段主体会固定开始时间', async () => {
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  await act(async () => clip.querySelector('.template-clip-timing-trigger--start').click());
  const dialog = () => document.querySelector('[role="dialog"]');
  await act(async () => dialog().querySelector('[aria-label="开始规则"] [role="radio"]').click());
  await settle();
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 100, button: 0 })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 224, clientY: 100, ctrlKey: true })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
  await settle();
  const actions = invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit').map(call => call[2]);
  expect(actions.at(-1)).toMatchObject({ type: 'move-clip', id: 'upper-image', manual: true });
  const segment = JSON.parse(container.querySelector('[data-testid="editor"]').textContent).scenes[0].tracks[1].segments[0];
  expect(segment.auto_timing?.start).toBeUndefined();
  expect(segment.target_timerange.start).toBeGreaterThan(0);
});

it('结束对齐选项保持长度，自动时长禁用；锁定轨道不能打开弹窗', async () => {
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  await act(async () => clip.querySelector('.template-clip-timing-trigger--end').click());
  const dialog = () => document.querySelector('[role="dialog"]');
  await act(async () => dialog().querySelector('[aria-label="开始规则"] [role="radio"]:last-child').click());
  await settle();
  expect(clip.getAttribute('aria-label')).toContain('0 到 8 秒');
  expect(dialog().querySelector('[aria-label="开始规则"] [role="radio"]:last-child').getAttribute('aria-checked')).toBe('true');
  expect(dialog().querySelector('[aria-label="时长规则"] button').disabled).toBe(true);
  await key(dialog(), 'Escape');
  await act(async () => container.querySelector('[aria-label="锁定轨道 上层图片"]').click());
  expect(clip.querySelector('.template-clip-timing-trigger--start').disabled).toBe(true);
  await act(async () => clip.querySelector('.template-clip-timing-trigger--start').click());
  expect(dialog()).toBeNull();
});

it('时间输入验证格式，提交微秒值；失败保持原规则与文档', async () => {
  await render();
  await enterScene('scene');
  await act(async () => container.querySelector('[data-clip-id="upper-image"] .template-clip-timing-trigger--end').click());
  const input = document.querySelector('[aria-label="片段时长"]');
  const change = async value => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await key(input, 'Enter');
  };
  await change('bad');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(invoke.mock.calls.some(([channel]) => channel === 'template:editor-edit')).toBe(false);
  await change('00:06.123456');
  await settle();
  expect(invoke.mock.calls.find(([channel]) => channel === 'template:editor-edit')[2].value).toBe(6.123456);
  const before = container.querySelector('[data-testid="editor"]').textContent;
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((channel, ...args) => channel === 'template:editor-edit'
    ? Promise.reject(new Error('时间修改失败')) : original(channel, ...args));
  await change('00:05.00');
  expect(container.querySelector('[role="alert"]').textContent).toBe('时间修改失败');
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  expect(document.querySelector('[aria-label="时长规则"] .is-active')).not.toBeNull();
});

it('媒体弹窗提供三种时长和循环配置；缺少元数据禁用媒体，循环可撤销', async () => {
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="video"]');
  await act(async () => clip.querySelector('.template-clip-timing-trigger--end').click());
  const dialog = () => document.querySelector('[role="dialog"]');
  expect(dialog().querySelector('[aria-label="时长规则"] [role="radio"]:last-child').textContent).toBe('媒体');
  expect(dialog().querySelector('[aria-label="时长规则"] [role="radio"]:last-child').disabled).toBe(true);
  const before = container.querySelector('[data-testid="editor"]').textContent;
  await act(async () => dialog().querySelector('[role="switch"]').click());
  await settle();
  expect(dialog().querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true');
  expect(JSON.parse(container.querySelector('[data-testid="editor"]').textContent).scenes[0].tracks[0].segments[3].loop).toBe(true);
  await key(dialog(), 'Escape');
  await act(async () => container.querySelector('[aria-label="撤销"]').click());
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
});

it('有源时长时媒体选项写回模式并更新片段图标', async () => {
  const template = mixedTrackFixture();
  template.materials.videos[1].duration = 5_000_000;
  invoke.mockImplementationOnce(async () => ({ templateJson: JSON.stringify(template) }));
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="video"]');
  await act(async () => clip.querySelector('.template-clip-timing-trigger--end').click());
  const media = () => document.querySelector('[aria-label="时长规则"] [role="radio"]:last-child');
  expect(media().disabled).toBe(false);
  await act(async () => media().click());
  await settle();
  expect(media().getAttribute('aria-checked')).toBe('true');
  expect(JSON.parse(container.querySelector('[data-testid="editor"]').textContent).scenes[0].tracks[0].segments[3].duration_mode).toBe('media');
  expect(document.querySelector('[role="dialog"]').textContent).toContain('播放素材的完整源区间。');
});
