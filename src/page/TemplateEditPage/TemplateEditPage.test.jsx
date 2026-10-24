// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addEditorElement, analyzeEditorDocument } from '../../main/template/editorModel';
import { applyEditorAction } from '../../main/template/editorActions';
import { copyEditorElement } from '../../main/template/editorClipboard';
import { mixedTrackFixture } from '../../main/template/workflowTestUtils';
import { createEditorPreset } from '../../main/template/editorPresets';
import TemplateEditPage from './TemplateEditPage';
import { wheelIntent } from '../../components/TemplateEditor/Timeline/viewport';

vi.mock('@uiw/react-codemirror', () => ({
  default: React.forwardRef(function EditorMock({ value, onChange }, ref) {
    React.useImperativeHandle(ref, () => ({
      view: { state: { doc: { toString: () => value } }, dispatch: vi.fn() }
    }), [value]);
    return <pre data-testid="editor" onInput={(event) => onChange?.(event.currentTarget.textContent ?? '')}>{value}</pre>;
  })
}));

let root;
let container;
let invoke;
let clipboardText;
beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  clipboardText = '';
  const template = mixedTrackFixture();
  template.scenes[0].tracks.push({
    id: 'upper', name: '上层图片', type: 'video', track_relative_index: 10,
    segments: [{ id: 'upper-image', material_id: 'photo', target_timerange: { duration: 8_000_000 } }]
  });
  invoke = vi.fn(async (channel, payload, input) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(template) };
    if (channel === 'template:editor-analyze') return analyzeEditorDocument(payload);
    if (channel === 'template:editor-add') return addEditorElement(payload, input);
    if (channel === 'template:editor-copy') {
      clipboardText = copyEditorElement(payload, input);
      return true;
    }
    if (channel === 'template:editor-edit') return applyEditorAction(payload,
      input.type === 'paste' ? { ...input, clipboard: clipboardText } : input);
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

it('Properties 转场静态保存后从素材引用回读，撤销清理配置并遵守轨道锁定', async () => {
  await render(); await enterScene('scene');
  await act(async () => container.querySelector('[data-clip-id="upper-image"]').click());
  const select = () => container.querySelector('.template-properties [aria-label="转场"]');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select(), '叠化');
  await act(async () => select().dispatchEvent(new Event('change', { bubbles: true })));
  await settle();
  expect(invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit').at(-1)[2])
    .toEqual({ type: 'property', id: 'upper-image', property: 'transition', mode: 'static', value: '叠化' });
  expect(select().value).toBe('叠化');
  const duration = () => container.querySelector('.template-properties [aria-label="转场时长"]');
  await act(async () => duration().focus()); await inputValue(duration(), '.8'); await key(duration(), 'Enter'); await settle();
  expect(container.querySelector('.template-properties [role="alert"]')?.textContent).toBeUndefined();
  expect(Number(duration().value)).toBe(0.8);
  await key(container.querySelector('main'), 'z', { ctrlKey: true }); await settle();
  expect(duration().value).toBe('0.5');
  await act(async () => container.querySelector('[data-track-id="upper"] .template-track-lock').click());
  expect(select().disabled).toBe(true); expect(duration().disabled).toBe(true);
});

it('父级完全裁切批量分镜内子分镜时，局部片段和顶部新增元素仍可见', async () => {
  const template = createEditorPreset('sentence-image');
  const children = template.scenes[0].tracks[0].segments;
  children[2].auto_duration = false;
  children[2].target_timerange.duration = 5_000_000;
  template.scenes[0].auto_duration = false;
  template.scenes[0].target_timerange.duration = 5_000_000;
  template.scenes[0].tracks = [{
    id: 'batch-track', type: 'mixed', segments: [{
      id: 'batch', type: 'scene', name: '批量分镜', auto_duration: true, target_timerange: { start: 0 },
      batch_scene: { source: 'items', mode: 'repeat', items: [{}] }, tracks: [], scenes: [{
        id: 'inner', type: 'scene', auto_duration: true, target_timerange: { start: 0 },
        tracks: [{ id: 'children-track', type: 'scene', segments: children }]
      }]
    }]
  }];
  invoke.mockImplementationOnce(async () => ({ templateJson: JSON.stringify(template) }));
  await render();
  await enterScene('sentence-scene-3');
  expect(container.querySelector('.template-timeline-duration').textContent).toBe('总时长 5 秒');
  expect(container.querySelectorAll('.template-clip')).toHaveLength(2);
  expect(container.querySelector('[data-clip-id="text-3"]').getAttribute('aria-label')).toContain('0 到 5 秒');
  await act(async () => container.querySelector('[data-clip-id="text-3"]').click());
  await act(async () => container.querySelector('[aria-label="添加文字"]').click());
  await settle();
  expect(container.querySelectorAll('.template-clip')).toHaveLength(3);
  expect(container.querySelector('.template-clip.is-selected').getAttribute('aria-label')).toBe('文字，0 到 5 秒');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  const draft = JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  expect(draft.scenes[0].target_timerange.duration).toBe(5_000_000);
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
  await settle();
  expect(container.querySelectorAll('.template-clip')).toHaveLength(2);
});

it.each([{ ctrlKey: true }, { metaKey: true }])('层级树支持复制粘贴普通元素、自动定位副本和撤销重做 %j', async (modifier) => {
  await render();
  const original = container.querySelector('[data-element-id="upper-image"]');
  const name = original.querySelector('strong').textContent;
  await act(async () => original.click());
  const before = container.querySelector('[data-testid="editor"]').textContent;
  await key(original, 'c', modifier);
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  await key(original, 'v', modifier);
  await settle();
  const clip = container.querySelector('.template-clip.is-selected');
  expect(clip.dataset.clipId).not.toBe('upper-image');
  expect(clip.getAttribute('aria-label')).toBe(`${name}，0 到 8 秒`);
  expect(container.querySelectorAll('.template-track-row')).toHaveLength(3);
  expect(container.querySelector('[role="treeitem"][aria-selected="true"]').dataset.elementId).toBe(clip.dataset.clipId);
  const pasted = container.querySelector('[data-testid="editor"]').textContent;
  await key(container.querySelector('.template-edit-page'), 'z', modifier);
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  await key(container.querySelector('.template-edit-page'), 'z', { ...modifier, shiftKey: true });
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(pasted);
});

it('时间轴复制整个分镜，粘贴保留内部内容并追加根分镜', async () => {
  await render();
  const scene = container.querySelector('[data-clip-id="scene"]');
  await act(async () => scene.click());
  await key(scene, 'c', { ctrlKey: true });
  await key(scene, 'v', { ctrlKey: true });
  await settle();
  expect(container.querySelectorAll('.template-clip--scene')).toHaveLength(2);
  const draft = JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  expect(draft.scenes).toHaveLength(2);
  expect(draft.scenes[1].tracks).toHaveLength(draft.scenes[0].tracks.length);
  expect(draft.scenes[1].id).not.toBe(draft.scenes[0].id);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('复制后切换时间轴可粘贴；锁定目标时不提交，解锁后允许连续粘贴', async () => {
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  await act(async () => clip.click());
  await key(clip, 'c', { metaKey: true });
  await act(async () => container.querySelector('[aria-label="锁定轨道 上层图片"]').click());
  const before = container.querySelector('[data-testid="editor"]').textContent;
  await key(document.body, 'v', { metaKey: true });
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  expect(container.querySelector('[role="alert"]').textContent).toContain('轨道已锁定');
  await act(async () => container.querySelector('[aria-label="解锁轨道 上层图片"]').click());
  await key(document.body, 'v', { metaKey: true });
  await settle();
  await key(document.body, 'v', { metaKey: true });
  await settle();
  expect(container.querySelectorAll('.template-track-row')).toHaveLength(4);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('输入框和 JSON 编辑区的复制粘贴不触发元素 IPC，空剪贴板失败不修改文档', async () => {
  await render();
  await enterScene('scene');
  await act(async () => container.querySelector('[data-clip-id="upper-image"]').click());
  const count = invoke.mock.calls.length;
  const input = container.querySelector('[aria-label="当前时间（秒）"]');
  await key(input, 'c', { ctrlKey: true });
  await key(input, 'v', { ctrlKey: true });
  const editor = container.querySelector('[data-testid="editor"]');
  editor.classList.add('cm-editor');
  await key(editor, 'c', { metaKey: true });
  await key(editor, 'v', { metaKey: true });
  expect(invoke.mock.calls).toHaveLength(count);
  const before = editor.textContent;
  await key(document.body, 'v', { ctrlKey: true });
  await settle();
  expect(editor.textContent).toBe(before);
  expect(container.querySelector('[role="alert"]').textContent).toContain('请先复制');
});

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
  expect(labels.every(element => element.textContent === element.querySelector('b').textContent)).toBe(true);
  expect(labels.every(element => element.querySelector('span') === null)).toBe(true);
});

it('关键帧按钮搜索属性、保存原生关键帧、显示属性行，快捷键撤销重做', async () => {
  await render();
  await enterScene('scene');
  await act(async () => container.querySelector('[data-track-id="upper"] .template-track-keyframes').click());
  const dialog = () => document.querySelector('.template-keyframes');
  expect(dialog()).not.toBeNull();
  const search = dialog().querySelector('[aria-label="查找关键帧属性"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(search, 'X Scale');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(dialog().querySelectorAll('.template-keyframe-properties button')).toHaveLength(1);
  await act(async () => dialog().querySelector('.template-keyframe-properties button').click());
  await settle();
  const draft = () => JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  expect(draft().scenes[0].tracks.find(track => track.id === 'upper').segments[0].common_keyframes[0])
    .toMatchObject({ property_type: 'KFTypeScaleX', keyframe_list: [{ time_offset: 0, values: [1] }] });
  expect(container.querySelector('.template-keyframe-lane').textContent).toContain('X Scale');
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('.template-properties [aria-label="X Scale"]'));
  await key(container.querySelector('.template-track-keyframes'), 'z', { ctrlKey: true });
  await settle();
  expect(container.querySelector('.template-keyframe-lane')).toBeNull();
  await key(container.querySelector('.template-track-keyframes'), 'z', { ctrlKey: true, shiftKey: true });
  await settle();
  expect(container.querySelector('.template-keyframe-point')).not.toBeNull();
});

it('分镜和批量分镜提供关键帧菜单，音频禁用；锁定后不可配置', async () => {
  await render();
  expect(container.querySelector('.template-track-keyframes').disabled).toBe(false);
  await enterScene('scene');
  await act(async () => container.querySelector('[data-clip-id="audio"]').click());
  expect(container.querySelector('[data-track-id="mixed"] .template-track-keyframes').disabled).toBe(true);
  await act(async () => container.querySelector('[data-track-id="upper"] .template-track-lock').click());
  expect(container.querySelector('[data-track-id="upper"] .template-track-keyframes').disabled).toBe(true);
});

it('Properties 静态和动画写入与游标同步，菜单当前时间创建、圆点选中聚焦、前后跳转和锁定', async () => {
  await render();
  await enterScene('scene');
  await act(async () => container.querySelector('[data-clip-id="upper-image"]').click());
  const panel = () => container.querySelector('.template-properties');
  const time = () => container.querySelector('[aria-label="当前时间（秒）"]');
  const input = () => panel().querySelector('[aria-label="X Position"]');
  const commit = async value => {
    await act(async () => input().focus());
    await inputValue(input(), value);
    await key(input(), 'Enter');
    await settle();
  };
  await commit('.2');
  expect(invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit').at(-1)[2])
    .toEqual({ type: 'property', mode: 'static', id: 'upper-image', property: 'position_x', value: .2 });
  await inputValue(time(), '1.25');
  await act(async () => container.querySelector('[data-track-id="upper"] .template-track-keyframes').click());
  await inputValue(document.querySelector('[aria-label="查找关键帧属性"]'), 'X Position');
  await act(async () => document.querySelector('.template-keyframe-properties button').click());
  await settle();
  expect(time().value).toBe('1.25');
  expect(document.activeElement).toBe(input());
  expect(container.querySelector('.template-keyframe-point.is-current svg').getAttribute('fill')).toBe('currentColor');
  await inputValue(time(), '2.5');
  expect(panel().querySelector('[aria-label="X Position 添加当前关键帧"]')).not.toBeNull();
  await commit('.6');
  expect(time().value).toBe('2.5');
  expect(invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit').at(-1)[2])
    .toEqual({ type: 'property', mode: 'keyframe', id: 'upper-image', property: 'position_x', time: 2.5, value: .6 });
  await act(async () => panel().querySelector('[aria-label="X Position 上一个关键帧"]').click());
  expect(time().value).toBe('1.25');
  expect(input().value).toBe('0.2');
  await act(async () => panel().querySelector('[aria-label="X Position 下一个关键帧"]').click());
  expect(time().value).toBe('2.5');
  await act(async () => container.querySelector('.template-keyframe-point').click());
  expect(time().value).toBe('1.25');
  expect(document.activeElement).toBe(input());
  expect(document.querySelector('.template-keyframes')).toBeNull();
  await act(async () => container.querySelector('[data-track-id="upper"] .template-track-lock').click());
  expect([...panel().querySelectorAll('input, button')].every(element => element.disabled)).toBe(true);
  expect([...container.querySelectorAll('.template-keyframe-point')].every(element => element.disabled)).toBe(true);
});

it('根时间轴隐藏末尾添加分镜，进入分镜后显示，返回根层再次隐藏', async () => {
  await render();
  expect(container.querySelector('.template-add-scene')).toBeNull();
  expect(container.querySelector('.template-edit-tools [aria-label="添加分镜"]')).not.toBeNull();
  await enterScene('scene');
  expect(container.querySelector('.template-add-scene')).not.toBeNull();
  await act(async () => container.querySelector('[aria-label="打开模版时间轴"]').click());
  expect(container.querySelector('.template-add-scene')).toBeNull();
});

it.each(['text', 'scene'])('选中铺满固定分镜的普通元素后添加 %s，在同级新建轨道而非末尾追加', async (type) => {
  await render();
  await enterScene('scene');
  await act(async () => container.querySelector('[data-clip-id="upper-image"]').click());
  const before = container.querySelector('[data-testid="editor"]').textContent;
  await act(async () => container.querySelector(`.template-edit-tools [aria-label="${type === 'text' ? '添加文字' : '添加分镜'}"]`).click());
  await settle();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  const draft = JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  expect(draft.scenes[0].tracks).toHaveLength(3);
  expect(draft.scenes[0].tracks.find(track => track.id === 'upper').segments).toHaveLength(1);
  expect(draft.scenes[0].tracks.at(-1).segments[0].target_timerange.start).toBe(0);
  expect(container.querySelector('.template-clip.is-selected').getAttribute('aria-label'))
    .toBe(`${type === 'text' ? '文字' : '分镜'}，0 到 ${type === 'text' ? 8 : 5} 秒`);
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
});

it('根层添加基础元素后自动进入所属分镜，撤销恢复根层', async () => {
  await render();
  await act(async () => container.querySelector('[aria-label="添加文字"]').click());
  await settle();
  expect(container.querySelector('[aria-label="分镜路径"] [aria-current="page"]').textContent).toBe('混排分镜');
  expect(container.querySelector('.template-clip.is-selected').textContent).toContain('Your text here');
  expect(container.querySelector('[role="treeitem"][aria-selected="true"]').textContent).toContain('Your text here');
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
  await settle();
  expect(container.querySelector('[aria-label="打开模版时间轴"]').getAttribute('aria-current')).toBe('page');
  expect(container.querySelectorAll('.template-clip')).toHaveLength(1);
});

it('批量分镜按钮向当前轨道添加批量分镜', async () => {
  await render();
  const sceneIcon = container.querySelector('[data-element-id="scene"] .template-layer-icon[aria-label="分镜"] svg');
  expect(sceneIcon).not.toBeNull();
  const sceneMarkup = sceneIcon.outerHTML;
  await act(async () => container.querySelector('[aria-label="添加批量分镜"]').click());
  await settle();
  expect(invoke.mock.calls.find(([channel]) => channel === 'template:editor-add')[2])
    .toMatchObject({ type: 'batch-scene', scopeId: null });
  expect(container.querySelector('[aria-label="分镜路径"] [aria-current="page"]').textContent).toBe('混排分镜');
  expect(container.querySelector('.template-clip.is-selected').textContent).toContain('批量分镜');
  const draft = JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  expect(draft.scenes[0].tracks.at(-1).segments[0]).toMatchObject({
    name: '批量分镜', type: 'scene', dynamic: ['batch_scene.items'], batch_scene: { source: 'items', mode: 'repeat' },
    tracks: [], scenes: [{ name: '分镜', tracks: [] }]
  });
  const batch = draft.scenes[0].tracks.at(-1).segments[0];
  const batchIcon = container.querySelector(`[data-element-id="${batch.id}"] .template-layer-icon[aria-label="批量分镜"] svg`);
  expect(batchIcon).not.toBeNull();
  expect(batchIcon.outerHTML).not.toBe(sceneMarkup);
  expect(container.querySelector(`[data-element-id="${batch.id}"] .template-disclosure`)).not.toBeNull();
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

it('时间轴点击选中片段后，焦点不在页面内按 Delete 也能删除', async () => {
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
  expect(clip.classList.contains('is-selected')).toBe(true);
  expect(document.activeElement).toBe(clip);
  await key(document.body, 'Delete');
  await settle();
  expect(container.querySelector('[data-clip-id="upper-image"]')).toBeNull();
});

it('选中容器分镜后按 Delete 删除整个容器并缩短总时长', async () => {
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
  expect(container.querySelectorAll('.template-clip--scene')).toHaveLength(3);
  const scene = container.querySelector('[data-clip-id="sentence-scene-2"]');
  await act(async () => scene.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 })));
  await act(async () => scene.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
  await key(document.body, 'Backspace');
  await settle();
  expect(container.querySelectorAll('.template-clip--scene')).toHaveLength(2);
  expect(container.querySelector('.template-timeline-duration').textContent).toBe('总时长 10 秒');
});

it('右键菜单打开时按 Delete 删除片段并关闭菜单', async () => {
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  await act(async () => clip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 })));
  expect(container.querySelector('.template-context-menu')).not.toBeNull();
  await key(document.body, 'Delete');
  await settle();
  expect(container.querySelector('.template-context-menu')).toBeNull();
  expect(container.querySelector('[data-clip-id="upper-image"]')).toBeNull();
});

it('焦点在输入框内按退格不会删除选中片段', async () => {
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="upper-image"]');
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 })));
  const input = container.querySelector('[aria-label="当前时间（秒）"]');
  await act(async () => input.focus());
  await key(input, 'Backspace');
  expect(invoke.mock.calls.some(([channel]) => channel === 'template:editor-edit')).toBe(false);
  expect(container.querySelector('[data-clip-id="upper-image"]')).not.toBeNull();
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

it.each(['scene', 'outer-batch', 'inner-batch', 'image'])('双击层级名称重命名，不进入分镜，支持取消和撤销 %s', async id => {
  const draft = mixedTrackFixture();
  const batch = (id, child) => ({
    id, name: '批量分镜', type: 'scene', target_timerange: { start: 0, duration: 5_000_000 },
    batch_scene: { source: 'items', mode: 'repeat', items: [{}] }, tracks: [],
    scenes: [{ id: `${id}-child`, name: '分镜', target_timerange: { start: 0, duration: 5_000_000 },
      tracks: child ? [{ id: `${id}-track`, type: 'mixed', segments: [child] }] : [] }]
  });
  draft.scenes[0].tracks.push({ id: 'outer-track', type: 'mixed', track_relative_index: 20,
    segments: [batch('outer-batch', batch('inner-batch'))] });
  invoke.mockImplementationOnce(async () => ({ templateJson: JSON.stringify(draft) }));
  await render();
  const before = container.querySelector('[data-testid="editor"]').textContent;
  const row = container.querySelector(`[data-element-id="${id}"]`);
  await act(async () => row.querySelector('strong').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(container.querySelector('[aria-label="分镜路径"] [aria-current="page"]').getAttribute('aria-label')).toBe('打开模版时间轴');
  let input = container.querySelector('[aria-label="元素名称"]');
  expect(input).not.toBeNull();
  await inputValue(input, '取消名称');
  await key(input, 'Escape');
  expect(container.querySelector('[aria-label="元素名称"]')).toBeNull();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  await act(async () => row.querySelector('strong').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  input = container.querySelector('[aria-label="元素名称"]');
  await inputValue(input, '新的分镜名称');
  await key(input, 'Enter');
  await settle();
  expect(container.querySelector(`[data-element-id="${id}"] strong`).textContent).toBe('新的分镜名称');
  expect(invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit').map(call => call[2]))
    .toEqual([{ type: 'rename', id, name: '新的分镜名称' }]);
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  if (id !== 'image') {
    await key(container.querySelector(`[data-element-id="${id}"]`), 'Enter');
    await settle();
    expect(container.querySelector('[aria-label="分镜路径"] [aria-current="page"]').textContent)
      .toBe(id === 'scene' ? draft.scenes[0].name : '批量分镜');
  }
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
  await act(async () => container.querySelector('.template-duration-popover').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  expect(container.querySelector('.template-duration-popover')).not.toBeNull();
  await act(async () => container.querySelector('.template-edit-code').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  expect(container.querySelector('.template-duration-popover')).toBeNull();
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

it('分镜内选中子分镜后添加文字，进入容器内部且支持撤销', async () => {
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
  expect(container.querySelectorAll('.template-track-row')).toHaveLength(3);
  expect(container.querySelectorAll('.template-clip--scene')).toHaveLength(0);
  expect(container.querySelector('.template-clip.is-selected').getAttribute('aria-label')).toBe('文字，0 到 5 秒');
  const draft = JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  expect(draft.tracks).toBeUndefined();
  expect(draft.scenes[0].tracks[0].segments).toHaveLength(3);
  expect(draft.scenes[0].tracks[0].segments[2].tracks).toHaveLength(3);
  expect(container.querySelector('.template-timeline-duration').textContent).toBe('总时长 5 秒');
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
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
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
  await settle();
  expect(current().target_timerange.start).toBeUndefined();
  await key(container.querySelector('main'), 'z', { ctrlKey: true, shiftKey: true });
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
  const unchanged = container.querySelector('[data-testid="editor"]').textContent;
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(unchanged);
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
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
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
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
  await settle();
  expect(container.querySelectorAll('[data-track-id]')).toHaveLength(2);
  expect(container.querySelector('[data-track-id="upper"]')).not.toBeNull();
});

it('拖到子分镜片段上高亮容器，松手移入并进入该分镜', async () => {
  const draft = mixedTrackFixture();
  draft.scenes[0].tracks.push({
    id: 'container', name: '容器', type: 'mixed', track_relative_index: 20,
    segments: [{ id: 'child', name: '容器分镜', type: 'scene', target_timerange: { start: 0, duration: 5_000_000 }, tracks: [] }]
  });
  invoke.mockImplementation(async (channel, payload, input) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(draft) };
    if (channel === 'template:editor-analyze') return analyzeEditorDocument(payload);
    if (channel === 'template:editor-add') return addEditorElement(payload, input);
    if (channel === 'template:editor-edit') return applyEditorAction(payload, input);
    throw new Error(`Unexpected IPC: ${channel}`);
  });
  await render();
  await enterScene('scene');
  const scroller = container.querySelector('.template-timeline-scroll');
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 1000 });
  container.querySelector('[data-clip-id="child"]').getBoundingClientRect =
    () => ({ left: 100, right: 220, top: 135, bottom: 170, width: 120, height: 35 });
  const clip = container.querySelector('[data-clip-id="image"]');
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 110, button: 0 })));
  await act(async () => clip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 130, clientY: 150 })));
  expect(container.querySelector('[data-clip-id="child"]').classList.contains('is-scene-drop-target')).toBe(true);
  await act(async () => clip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 130, clientY: 150 })));
  await settle();
  expect(invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit').map(call => call[2]))
    .toEqual([expect.objectContaining({ type: 'move-into-scene', id: 'image', sceneId: 'child' })]);
  expect(container.querySelector('[role="alert"]')?.textContent).toBeUndefined();
  expect(container.querySelector('[aria-label="分镜路径"] [aria-current="page"]').textContent).toBe('容器分镜');
  expect(container.querySelector('[data-clip-id="image"]')).not.toBeNull();
  expect(container.querySelectorAll('[data-track-id]')).toHaveLength(1);
});

it('批量分镜内时间轴末尾添加分镜，落入被省略显示的子分镜', async () => {
  const draft = mixedTrackFixture();
  draft.scenes[0].tracks.push({
    id: 'batch-track', name: '批量', type: 'mixed', track_relative_index: 20,
    segments: [{
      id: 'batch', name: '批量分镜', type: 'scene', target_timerange: { start: 0, duration: 5_000_000 },
      batch_scene: { source: 'items', mode: 'repeat', items: [{ title: '分镜文案', image: '' }] },
      tracks: [], scenes: [{ id: 'batch-child', name: '分镜', target_timerange: { start: 0, duration: 5_000_000 }, tracks: [] }]
    }]
  });
  invoke.mockImplementation(async (channel, payload, input) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(draft) };
    if (channel === 'template:editor-analyze') return analyzeEditorDocument(payload);
    if (channel === 'template:editor-add') return addEditorElement(payload, input);
    if (channel === 'template:editor-edit') return applyEditorAction(payload, input);
    throw new Error(`Unexpected IPC: ${channel}`);
  });
  await render();
  await enterScene('batch');
  await act(async () => container.querySelector('.template-add-scene').click());
  await settle();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(invoke.mock.calls.find(([channel]) => channel === 'template:editor-add')[2])
    .toMatchObject({ type: 'scene', selectedId: 'batch', scopeId: 'batch' });
  expect(container.querySelector('.template-clip--scene.is-selected')).not.toBeNull();
  const added = JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
  const batchScene = added.scenes[0].tracks.find(track => track.id === 'batch-track')
    .segments.find(segment => segment.id === 'batch');
  expect(batchScene.tracks).toEqual([]);
  expect(batchScene.scenes[0].tracks).toHaveLength(1);
  expect(batchScene.scenes[0].tracks[0].segments[0]).toMatchObject({ name: '分镜', type: 'scene' });
});

it('批量分镜的默认子分镜不显示，内部内容直接透出', async () => {
  const draft = mixedTrackFixture();
  draft.scenes[0].tracks.push({
    id: 'batch-track', name: '批量轨', type: 'mixed', track_relative_index: 20,
    segments: [{
      id: 'batch', name: '批量分镜', type: 'scene', target_timerange: { start: 2_000_000, duration: 5_000_000 },
      batch_scene: { source: 'items', mode: 'repeat', items: [{ title: '分镜文案', image: '' }] },
      tracks: [], scenes: [{
        id: 'batch-child', name: '分镜', target_timerange: { start: 0, duration: 5_000_000 },
        tracks: [{ id: 'child-text-track', name: '文字', type: 'text', track_relative_index: 0, segments: [
          { id: 'child-text', material_id: 'title', target_timerange: { start: 0, duration: 2_000_000 } }
        ] }]
      }]
    }]
  });
  invoke.mockImplementation(async (channel, payload, input) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(draft) };
    if (channel === 'template:editor-analyze') return analyzeEditorDocument(payload);
    if (channel === 'template:editor-add') return addEditorElement(payload, input);
    if (channel === 'template:editor-edit') return applyEditorAction(payload, input);
    throw new Error(`Unexpected IPC: ${channel}`);
  });
  await render();
  expect(container.querySelector('[data-element-id="batch-child"]')).toBeNull();
  expect(container.querySelector('[data-element-id="child-text"]')).not.toBeNull();
  await enterScene('batch');
  expect(container.querySelector('[data-element-id="batch-child"]')).toBeNull();
  expect(container.querySelector('[aria-label="分镜路径"] [aria-current="page"]').textContent).toBe('批量分镜');
  expect(container.querySelector('[data-track-id="__child_scenes__"]')).toBeNull();
  expect([...container.querySelectorAll('.template-track-select')].map(element => element.getAttribute('aria-label')))
    .toEqual(['选择轨道 文字']);
  expect(container.querySelector('[data-clip-id="child-text"]')).not.toBeNull();
  expect(container.querySelector('.template-clip--scene')).toBeNull();
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
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  await act(async () => clip.querySelector('.template-clip-timing-trigger--end').click());
  expect(dialog()).not.toBeNull();
  await act(async () => container.querySelector('main').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  expect(dialog()).toBeNull();
});

it('固定时间第一次点击只选中模式，第二次点击才进入输入编辑', async () => {
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="image"]');
  await act(async () => clip.querySelector('.template-clip-timing-trigger--start').click());
  const dialog = () => document.querySelector('[role="dialog"]');
  await act(async () => dialog().querySelector('[aria-label="开始规则"] [role="radio"]').click());
  await settle();
  const startInput = dialog().querySelector('[aria-label="片段开始时间"]');
  await act(async () => startInput.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  await settle();
  expect(invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit').map(call => call[2]).at(-1))
    .toEqual({ type: 'clip-timing', id: 'image', field: 'start', mode: 'fixed', value: 0 });
  expect(startInput.readOnly).toBe(true);
  expect(document.activeElement).not.toBe(startInput);
  await act(async () => startInput.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  await settle();
  expect(startInput.readOnly).toBe(false);
  expect(document.activeElement).toBe(startInput);
  await act(async () => clip.querySelector('.template-clip-timing-trigger--end').click());
  await settle();
  const durationInput = dialog().querySelector('[aria-label="片段时长"]');
  expect(durationInput.readOnly).toBe(true);
  expect(document.activeElement).not.toBe(durationInput);
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

it('媒体弹窗提供循环开关，缺少源时长时禁止开启', async () => {
  await render();
  await enterScene('scene');
  const clip = container.querySelector('[data-clip-id="video"]');
  await act(async () => clip.querySelector('.template-clip-timing-trigger--end').click());
  const dialog = () => document.querySelector('[role="dialog"]');
  expect(dialog().querySelector('[aria-label="时长规则"] [role="radio"]:last-child').textContent).toBe('媒体');
  expect(dialog().querySelector('[aria-label="时长规则"] [role="radio"]:last-child').disabled).toBe(true);
  expect(dialog().textContent).not.toContain('媒体模式需要素材 duration');
  expect(dialog().querySelector('[role="switch"]').disabled).toBe(true);
  expect(dialog().querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false');
  expect(dialog().textContent).toContain('循环');
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

it('批量分镜音频切换媒体时长后，Auto 边界和填充文字同步延长，撤销恢复', async () => {
  const template = createEditorPreset('empty');
  delete template.duration;
  template.materials.audios = [{ id: 'sound', type: 'audio', path: '/tmp/audio.wav', duration: 12_000_000 }];
  template.materials.texts = [{ id: 'title-material', type: 'text', content: JSON.stringify({ text: 'Your text here' }) }];
  template.scenes = [{
    id: 'batch', name: '批量分镜', auto_duration: true, target_timerange: { start: 0 },
    batch_scene: { source: 'items', mode: 'repeat', items: [{}] }, tracks: [],
    scenes: [{
      id: 'child', target_timerange: { start: 0, duration: 5_000_000 },
      tracks: [
        { id: 'sound-track', name: '音频', type: 'audio', segments: [{
          id: 'sound-clip', name: '音频', material_id: 'sound',
          target_timerange: { start: 0, duration: 5_000_000 }, source_timerange: { start: 0 }
        }] },
        { id: 'title-track', name: '文字', type: 'text', segments: [{
          id: 'title', name: '文字', material_id: 'title-material', target_timerange: {}
        }] }
      ]
    }]
  }];
  invoke.mockImplementationOnce(async () => ({ templateJson: JSON.stringify(template) }));
  await render();
  await enterScene('batch');
  const handle = () => container.querySelector('.template-duration-handle');
  const oldLeft = parseFloat(handle().style.left);
  expect(handle().textContent).toBe('Auto');
  const before = container.querySelector('[data-testid="editor"]').textContent;
  await act(async () => container.querySelector('[data-clip-id="sound-clip"] .template-clip-timing-trigger--end').click());
  await act(async () => document.querySelector('[aria-label="时长规则"] [role="radio"]:last-child').click());
  await settle();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('.template-timeline-duration').textContent).toBe('总时长 12 秒');
  const audio = container.querySelector('[data-clip-id="sound-clip"]');
  expect(parseFloat(handle().style.left)).toBeCloseTo(parseFloat(audio.style.left) + parseFloat(audio.style.width));
  expect(parseFloat(container.querySelector('.template-outside-scene').style.left)).toBeCloseTo(164 + parseFloat(handle().style.left));
  expect(container.querySelector('[data-clip-id="title"]').getAttribute('aria-label')).toBe('文字，0 到 12 秒');
  await key(document.querySelector('[role="dialog"]'), 'Escape');
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  expect(container.querySelector('.template-timeline-duration').textContent).toBe('总时长 5 秒');
  expect(parseFloat(handle().style.left)).toBeCloseTo(oldLeft);
});

it('Workflow 视图可编辑，测试导出优先使用编辑后的内容', async () => {
  const workflow = { width: 720, height: 1280, inputs: { demo: { text: 'hi' } }, script: [] };
  const draft = mixedTrackFixture();
  invoke.mockImplementation(async (channel, payload) => {
    if (channel === 'template:editor-defaults') return { templateJson: JSON.stringify(draft) };
    if (channel === 'template:editor-analyze') return analyzeEditorDocument(payload);
    if (channel === 'template:editor-compile') return { workflow, warnings: [], dynamicInputs: [] };
    if (channel === 'template:editor-test-export') return { draftId: 'draft-9', warnings: [] };
    throw new Error(`Unexpected IPC: ${channel}`);
  });
  await render();
  const toggle = container.querySelector('[aria-label="切换到 Workflow"]');
  expect(toggle.disabled).toBe(false);
  await act(async () => toggle.click());
  await settle();
  const heading = container.querySelector('.template-code-heading');
  expect(heading.textContent).toContain('Workflow');
  expect(heading.textContent).not.toContain('只读');
  expect(heading.textContent).toContain('未提交执行');
  expect(JSON.parse(container.querySelector('[data-testid="editor"]').textContent)).toEqual(workflow);
  const editor = container.querySelector('[data-testid="editor"]');
  const edited = JSON.stringify({ ...workflow, inputs: { demo: { text: 'edited' } } }, null, 2);
  await act(async () => {
    editor.textContent = edited;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelector('.template-code-heading').textContent).toContain('已编辑');
  await act(async () => container.querySelector('[aria-label="测试导出"]').click());
  await settle();
  const exportPayload = invoke.mock.calls.find(([channel]) => channel === 'template:editor-test-export')[1];
  expect(exportPayload.workflowJson).toBe(edited);
  expect(container.querySelector('[role="status"]').textContent).toContain('draft-9');
});

async function layerDrag(element, type, clientY = 120) {
  element.getBoundingClientRect = () => ({ top: 100, bottom: 140, height: 40, left: 0, right: 250, width: 250 });
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: { setData: vi.fn(), effectAllowed: '', dropEffect: '' } });
  await act(async () => element.dispatchEvent(event));
  return event;
}

it('目录同轨元素可拖动插入，时间不变、落下选中并支持撤销重做', async () => {
  await render();
  await enterScene('scene');
  const before = container.querySelector('[data-testid="editor"]').textContent;
  const source = container.querySelector('[data-element-id="image"]');
  const target = container.querySelector('[data-element-id="video"]');
  await layerDrag(source, 'dragstart');
  expect(source.classList.contains('is-layer-dragging')).toBe(true);
  expect((await layerDrag(target, 'dragover', 102)).defaultPrevented).toBe(true);
  expect(target.classList.contains('is-layer-drop-before')).toBe(true);
  await layerDrag(target, 'drop', 102);
  await settle();
  expect([...container.querySelectorAll('[data-element-id]')].map(row => row.dataset.elementId))
    .toEqual(['scene', 'upper-image', 'text', 'audio', 'image', 'video']);
  expect(container.querySelector('.template-layer[aria-selected="true"]').dataset.elementId).toBe('image');
  expect(container.querySelector('.template-clip.is-selected').getAttribute('aria-label')).toContain('0 到 2 秒');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('.is-layer-dragging, .is-layer-drop-before')).toBeNull();
  const changed = container.querySelector('[data-testid="editor"]').textContent;
  await key(container.querySelector('main'), 'z', { ctrlKey: true });
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  await key(container.querySelector('main'), 'z', { ctrlKey: true, shiftKey: true });
  await settle();
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(changed);
});

it('目录拖入分镜支持悬停展开，落下后自动显示目标内部并保留选中', async () => {
  const draft = mixedTrackFixture();
  draft.scenes[0].tracks.push({
    id: 'upper', type: 'video', track_relative_index: 10,
    segments: [{ id: 'upper-image', material_id: 'photo', target_timerange: { duration: 8_000_000 } }]
  });
  draft.scenes[0].scenes = [{ id: 'child', name: '子分镜', target_timerange: { duration: 8_000_000 }, tracks: [] }];
  invoke.mockImplementationOnce(async () => ({ templateJson: JSON.stringify(draft) }));
  await render();
  await enterScene('scene');
  await act(async () => container.querySelector('[aria-label="折叠 子分镜"]').click());
  const source = container.querySelector('[data-element-id="upper-image"]');
  const target = container.querySelector('[data-element-id="child"]');
  await layerDrag(source, 'dragstart');
  await layerDrag(target, 'dragover');
  expect(target.classList.contains('is-layer-drop-inside')).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(container.querySelector('[aria-label="折叠 子分镜"]')).not.toBeNull();
  await layerDrag(target, 'drop');
  await settle();
  expect(container.querySelector('.template-layer[aria-selected="true"]').dataset.elementId).toBe('upper-image');
  expect(container.querySelector('.template-layer[aria-selected="true"]').getAttribute('aria-level')).toBe('3');
  expect(container.querySelectorAll('.template-track-row')).toHaveLength(1);
  expect(container.querySelector('.template-clip.is-selected').dataset.clipId).toBe('upper-image');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('目录拖动取消、父子循环及锁定目标均不提交编辑', async () => {
  await render();
  await enterScene('scene');
  const source = container.querySelector('[data-element-id="upper-image"]');
  const target = container.querySelector('[data-element-id="text"]');
  await layerDrag(source, 'dragstart');
  await layerDrag(target, 'dragover', 138);
  expect(target.classList.contains('is-layer-drop-after')).toBe(true);
  await layerDrag(source, 'dragend');
  expect(container.querySelector('.is-layer-drop-after, .is-layer-dragging')).toBeNull();
  const parent = container.querySelector('[data-element-id="scene"]');
  expect(parent.draggable).toBe(true);
  await layerDrag(parent, 'dragstart');
  expect((await layerDrag(target, 'dragover')).defaultPrevented).toBe(false);
  await layerDrag(target, 'drop');
  await act(async () => container.querySelector('[aria-label="锁定轨道 混排轨道"]').click());
  await layerDrag(source, 'dragstart');
  expect((await layerDrag(target, 'dragover')).defaultPrevented).toBe(false);
  await layerDrag(target, 'drop');
  expect(invoke.mock.calls.filter(([channel]) => channel === 'template:editor-edit')).toHaveLength(0);
  expect(target.draggable).toBe(false);
});

const activeTrackRows = () => [...container.querySelectorAll('.template-layer-track-rail.is-active')]
  .map(rail => rail.parentElement.dataset.elementId);

it('目录选中同轨素材共用蓝线，其他轨道保持灰线且仅选中行有蓝色背景', async () => {
  await render();
  await act(async () => container.querySelector('[data-element-id="image"]').click());
  expect(activeTrackRows()).toEqual(['image', 'text', 'audio', 'video']);
  expect(container.querySelectorAll('.template-layer.is-selected')).toHaveLength(1);
  expect(container.querySelector('[data-element-id="upper-image"] .template-layer-track-rail')
    .classList.contains('is-active')).toBe(false);
  const rails = [...container.querySelectorAll('.template-layer-track-rail.is-active')];
  expect(rails[0].classList.contains('is-first')).toBe(true);
  expect(rails.at(-1).classList.contains('is-last')).toBe(true);
  expect(new Set(rails.map(rail => rail.style.left)).size).toBe(1);
  await act(async () => container.querySelector('[data-element-id="text"]').click());
  expect(activeTrackRows()).toEqual(['image', 'text', 'audio', 'video']);
});

it('同轨分镜及其展开内容归在一条蓝线下，折叠后端点跟随更新', async () => {
  const draft = mixedTrackFixture();
  const composition = (id, name, start) => ({
    id, name, type: 'scene', target_timerange: { start, duration: 2_000_000 },
    tracks: [{ id: `${id}-track`, type: 'text', segments: [{
      id: `${id}-text`, material_id: draft.materials.texts[0].id, target_timerange: { duration: 2_000_000 }
    }] }]
  });
  draft.scenes[0].tracks = [
    { id: 'first-scene-track', type: 'scene', track_relative_index: 1,
      segments: [composition('first', '第一分镜', 0), composition('second', '第二分镜', 2_000_000)] },
    { id: 'other-scene-track', type: 'scene', track_relative_index: 0, segments: [composition('other', '其他分镜', 0)] }
  ];
  invoke.mockImplementationOnce(async () => ({ templateJson: JSON.stringify(draft) }));
  await render();
  await act(async () => container.querySelector('[data-element-id="first"]').click());
  expect(activeTrackRows()).toEqual(['first', 'first-text', 'second', 'second-text']);
  expect(container.querySelector('[data-element-id="other"] .template-layer-track-rail').dataset.active).toBe('false');
  await act(async () => container.querySelector('[aria-label="折叠 第二分镜"]').click());
  expect(activeTrackRows()).toEqual(['first', 'first-text', 'second']);
  expect(container.querySelector('[data-element-id="second"] .template-layer-track-rail').classList.contains('is-last')).toBe(true);
  await act(async () => container.querySelector('[data-element-id="first-text"]').click());
  expect(activeTrackRows()).toEqual(['first-text']);
});

it('目录拖动换轨后，蓝线不会保留在原轨道上', async () => {
  await render();
  const source = container.querySelector('[data-element-id="image"]');
  const target = container.querySelector('[data-element-id="video"]');
  await layerDrag(source, 'dragstart');
  expect(activeTrackRows()).toEqual(['image', 'text', 'audio', 'video']);
  await layerDrag(target, 'drop', 102);
  await settle();
  expect(activeTrackRows()).toEqual(['image']);
  expect(container.querySelector('[data-element-id="text"] .template-layer-track-rail').dataset.active).toBe('false');
});

for (const type of ['audio', 'video']) {
  it(`${type} 循环开关写回 JSON，保留时长并支持撤销重做和关闭`, async () => {
    const draft = mixedTrackFixture();
    const material = type === 'audio' ? draft.materials.audios[0] : draft.materials.videos[1];
    material.duration = draft.scenes[0].tracks[0].segments.find(item => item.id === type).source_timerange.start + 1_000_000;
    invoke.mockImplementationOnce(async () => ({ templateJson: JSON.stringify(draft) }));
    await render();
    await enterScene('scene');
    const clip = container.querySelector(`[data-clip-id="${type}"]`);
    const originalWidth = clip.style.width;
    await act(async () => clip.querySelector('.template-clip-timing-trigger--end').click());
    const loop = () => document.querySelector('[role="switch"][aria-label="循环播放"]');
    expect(loop().disabled).toBe(false);
    await act(async () => loop().click());
    await settle();
    expect(loop().getAttribute('aria-checked')).toBe('true');
    const json = () => JSON.parse(container.querySelector('[data-testid="editor"]').textContent);
    expect(json().scenes[0].tracks[0].segments.find(item => item.id === type).loop).toBe(true);
    expect(container.querySelector(`[data-clip-id="${type}"]`).style.width).toBe(originalWidth);
    await key(container.querySelector('main'), 'z', { ctrlKey: true });
    await settle();
    expect(loop().getAttribute('aria-checked')).toBe('false');
    await key(container.querySelector('main'), 'z', { ctrlKey: true, shiftKey: true });
    await settle();
    expect(loop().getAttribute('aria-checked')).toBe('true');
    await act(async () => loop().click());
    await settle();
    expect(loop().getAttribute('aria-checked')).toBe('false');
    expect(json().scenes[0].tracks[0].segments.find(item => item.id === type).loop).toBe(false);
  });
}

it('图片和文字的时长弹窗不显示循环开关', async () => {
  await render();
  await enterScene('scene');
  for (const id of ['image', 'text']) {
    await act(async () => container.querySelector(`[data-clip-id="${id}"] .template-clip-timing-trigger--end`).click());
    expect(document.querySelector('[role="dialog"] [role="switch"]')).toBeNull();
  }
});

it('循环设置失败时开关恢复原状态，不改 JSON 或时间轴', async () => {
  const draft = mixedTrackFixture();
  draft.materials.videos[1].duration = 4_000_000;
  invoke.mockImplementationOnce(async () => ({ templateJson: JSON.stringify(draft) }));
  await render();
  await enterScene('scene');
  const before = container.querySelector('[data-testid="editor"]').textContent;
  await act(async () => container.querySelector('[data-clip-id="video"] .template-clip-timing-trigger--end').click());
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((channel, ...args) => channel === 'template:editor-edit'
    ? Promise.reject(new Error('循环设置失败')) : original(channel, ...args));
  await act(async () => document.querySelector('[role="switch"]').click());
  await settle();
  expect(document.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false');
  expect(container.querySelector('[data-testid="editor"]').textContent).toBe(before);
  expect(container.querySelector('[role="alert"]').textContent).toBe('循环设置失败');
});

it('贴纸滤镜特效的工具栏与目录统一使用指定 Lucide 图标', async () => {
  const draft = mixedTrackFixture();
  const resources = [
    ['sticker', '贴纸', 'stickers', 'sticker', 'sticky-note'],
    ['filter', '滤镜', 'effects', 'filter', 'blend'],
    ['effect', '特效', 'video_effects', 'video_effect', 'sparkles']
  ];
  for (const [type, name, bucket, materialType] of resources) {
    draft.materials[bucket] = [{ id: `${type}-material`, type: materialType, resource_id: '123' }];
    draft.scenes[0].tracks.push({
      id: `${type}-track`, type, segments: [{
        id: type, name, material_id: `${type}-material`, target_timerange: { duration: 5_000_000 }
      }]
    });
  }
  invoke.mockImplementationOnce(async () => ({ templateJson: JSON.stringify(draft) }));
  await render();
  for (const [type, name, , , icon] of resources) {
    const toolbarIcon = container.querySelector(`[aria-label="添加${name}"] svg`);
    const directoryIcon = container.querySelector(`[data-element-id="${type}"] .template-disclosure svg`);
    expect(toolbarIcon.classList.contains(`lucide-${icon}`)).toBe(true);
    expect(directoryIcon.classList.contains(`lucide-${icon}`)).toBe(true);
    expect(directoryIcon.innerHTML).toBe(toolbarIcon.innerHTML);
  }
});
