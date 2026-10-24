import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Properties from './index';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host, props;
const query = label => host.querySelector(`[aria-label="${label}"]`);
const render = overrides => act(() => root.render(<Properties {...props} {...overrides} />));
const click = label => act(async () => query(label).click());
const edit = async (label, value) => {
  const input = query(label);
  act(() => input.focus());
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.blur());
};
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = { clip: { id: 'clip', name: '图片', type: 'image', start: 2, end: 7 }, native: {}, cursor: 3,
    onAction: vi.fn().mockResolvedValue(true), onSeek: vi.fn() };
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('静态数值自动写入静态动作，空心圆可在当前本地时间建点', async () => {
  render({ native: { clip: { transform: { x: .25 } } } });
  expect(query('X Position').value).toBe('0.25');
  expect(query('X Position 添加当前关键帧').querySelector('svg').getAttribute('fill')).toBe('none');
  await edit('X Position', '0.5');
  expect(props.onAction).toHaveBeenCalledWith({ type: 'property', id: 'clip', property: 'position_x', mode: 'static', value: .5 });
  await click('Opacity 添加当前关键帧');
  expect(props.onAction).toHaveBeenLastCalledWith({ type: 'property', id: 'clip', property: 'alpha', mode: 'keyframe', time: 1, value: 1 });
});

it('游标采样插值、动画自动写当前点、前后跳转、当前点和整组删除', async () => {
  const native = { common_keyframes: [{ id: 'g', property_type: 'KFTypeAlpha', keyframe_list: [
    { id: 'a', time_offset: 0, values: [0] }, { id: 'b', time_offset: 2_000_000, values: [1] },
  ] }] };
  render({ native });
  expect(query('Opacity').value).toBe('50');
  expect(query('Opacity 添加当前关键帧').querySelector('svg').getAttribute('fill')).toBe('currentColor');
  await edit('Opacity', '70');
  expect(props.onAction).toHaveBeenCalledWith({ type: 'property', id: 'clip', property: 'alpha', mode: 'keyframe', time: 1, value: .7 });
  await click('Opacity 上一个关键帧'); expect(props.onSeek).toHaveBeenLastCalledWith(2);
  await click('Opacity 下一个关键帧'); expect(props.onSeek).toHaveBeenLastCalledWith(4);
  render({ native, cursor: 4 });
  expect(query('Opacity').value).toBe('100');
  expect(query('Opacity 删除当前关键帧').classList.contains('is-current')).toBe(true);
  await click('Opacity 删除当前关键帧');
  expect(props.onAction).toHaveBeenLastCalledWith({ type: 'property', id: 'clip', property: 'alpha', mode: 'keyframe', time: 2, remove: true });
  await click('Opacity 删除全部关键帧');
  expect(props.onAction).toHaveBeenLastCalledWith({ type: 'property', id: 'clip', property: 'alpha', mode: 'keyframe', removeGroup: true });
});

it('锁定禁用所有交互，解除锁定后执行聚焦请求', () => {
  const focusRequest = { id: 'clip', property: 'scale_x' };
  render({ disabled: true, focusRequest });
  expect([...host.querySelectorAll('input, button')].every(element => element.disabled)).toBe(true);
  render({ disabled: false, focusRequest }); expect(document.activeElement).toBe(query('X Scale'));
});

it('不一致缩放仅禁用整体缩放，文字透明度读取 global_alpha', () => {
  render({ native: { clip: { scale: { x: 1, y: 2 } } } });
  expect(query('Scale').disabled).toBe(true); expect(query('X Scale').disabled).toBe(false); expect(query('Y Scale').value).toBe('200');
  render({ clip: { ...props.clip, type: 'text' }, native: { global_alpha: .4 } });
  expect(query('Opacity').value).toBe('40');
});

it('音频显示配置，贴纸仅静态，分镜仅动画；错误返回保留提示', async () => {
  render({ clip: { ...props.clip, type: 'audio' } }); expect(query('音量')).not.toBeNull();
  render({ clip: { ...props.clip, type: 'sticker' } }); expect(host.querySelectorAll('button')).toHaveLength(0);
  props.onAction.mockResolvedValue(false);
  render({ clip: { ...props.clip, type: 'composition' } }); await edit('X Position', '.2');
  expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'keyframe', time: 1 }));
  expect(host.querySelector('[role="alert"]').textContent).toContain('未保存');
});

it('图片视频按参考百分比和旋转范围显示，越界不提交，位置保留 shared 归一化单位', async () => {
  render({ clip: { ...props.clip, type: 'video' } });
  expect(query('X Scale').value).toBe('100');
  expect(query('X Scale').min).toBe('1'); expect(query('X Scale').max).toBe('500');
  expect(query('Z Rotation').min).toBe('-360'); expect(query('Z Rotation').max).toBe('360');
  expect(query('X Position').min).toBe('-10'); expect(query('X Position').max).toBe('10');
  expect(host.textContent).toContain('归一化（非像素）');
  await edit('X Scale', '150');
  expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'scale_x', mode: 'static', value: 1.5 }));
  props.onAction.mockClear(); await edit('X Scale', '501');
  expect(props.onAction).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]').textContent).toContain('1 到 500');
});

it('视频音量复用音频 dB 规则，转为比例关键帧；静音为零，不调用 Preset 接口', async () => {
  render({ clip: { ...props.clip, type: 'video' } });
  expect(query('Volume').value).toBe('0'); expect(query('Volume').min).toBe('-60'); expect(query('Volume').max).toBe('20');
  await edit('Volume', '6');
  expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'property', mode: 'keyframe', property: 'volume', value: 10 ** (6 / 20) }));
  await edit('Volume', '-60');
  expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'keyframe', value: 0 }));
  expect(host.querySelector('[role="note"]').textContent).toContain('不使用 Preset 身份或替换接口');
  expect(host.querySelector('[aria-label="选择预设"]')).toBeNull();
});

it('滑块松手写入比例，未支持能力明确展示', async () => {
  render();
  const slider = query('Opacity 滑块');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '35');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => slider.dispatchEvent(new Event('pointerup', { bubbles: true })));
  expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'static', property: 'alpha', value: .35 }));
  render({ clip: { ...props.clip, type: 'text' } }); expect(host.querySelector('[role="note"]').textContent).toContain('局部富文本');
  render({ clip: { ...props.clip, type: 'audio' } }); expect(host.querySelector('[role="note"]').textContent).toContain('音频关键帧');
});

const choose = async (label, value) => act(async () => {
  const element = query(label);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
});

it('文字读取素材排版与效果，数值、布尔、颜色和枚举按静态动作提交', async () => {
  const material = { id: 'm', content: JSON.stringify({ text: '标题', styles: [{ size: 24, bold: true }] }), letter_spacing: .5 };
  render({ clip: { ...props.clip, type: 'text' }, native: { material_id: 'm' }, nativeIndex: new Map([['m', material]]) });
  expect(query('文字内容').value).toBe('标题'); expect(query('字号').value).toBe('24');
  expect(query('加粗').getAttribute('aria-pressed')).toBe('true'); expect(query('字间距').value).toBe('10');
  await edit('字号', '30');
  expect(props.onAction).toHaveBeenLastCalledWith({ type: 'property', id: 'clip', property: 'font_size', mode: 'static', value: 30 });
  await click('加粗'); expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'bold', value: false }));
  await click('右对齐'); expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'align', value: 2 }));
  await click('启用描边'); expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'border_width', value: 1 }));
  expect(host.querySelector('.chat-panel__text-settings-form')).not.toBeNull();
  expect(host.querySelector('[data-configuration="font_size"]')).toBeNull();
});

it('音频读取速度淡入淡出和三音效，参数数量与名称由资源定义决定', async () => {
  const effect = { type: 'audio_effect', resource_id: '7018011608408396325', category_id: 'sound_effect', audio_adjust_params: [
    { name: 'change_voice_param_quantity', parameterIndex: 0, value: .8 },
    { name: 'change_voice_param_strength', parameterIndex: 1, value: .762 },
  ] };
  const native = { speed: 1.5, volume: .5, extra_material_refs: ['fade', 'effect'] };
  render({ clip: { ...props.clip, type: 'audio' }, native,
    nativeIndex: new Map([['fade', { type: 'audio_fade', fade_in_duration: 500000 }], ['effect', effect]]) });
  expect(query('速度').value).toBe('1.5'); expect(query('淡入').value).toBe('0.5'); expect(query('强度').value).toBe('76.2');
  expect([...query('场景音效').options].map(option => option.value)).toEqual(['', '低保真', '回音', '水下']);
  await edit('速度', '2'); expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'speed', mode: 'static', value: 2 }));
  await edit('淡出', '.75'); expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'fade_out_duration', value: .75 }));
  await edit('强度', '25'); expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'effect_param_1', value: 25 }));
  await choose('场景音效', ''); expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'effect_type', value: '' }));
});

it('图片组合动画与转场使用白名单，可删除；视频无组合动画，锁定全部配置', async () => {
  render();
  expect(query('入场动画时长').disabled).toBe(true);
  expect(query('组合/循环动画')).not.toBeNull();
  await choose('转场', '叠化'); expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'transition', value: '叠化' }));
  await choose('转场', ''); expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'transition', value: '' }));
  render({ clip: { ...props.clip, type: 'video' }, disabled: true });
  expect(query('组合/循环动画')).toBeNull(); expect(query('音量')).not.toBeNull();
  expect([...host.querySelectorAll('input, textarea, select, button')].every(element => element.disabled)).toBe(true);
});

it('局部富文本、未知资源读取失败不允许覆盖，后端拒绝显示错误', async () => {
  render({ clip: { ...props.clip, type: 'text' }, native: { material_id: 'm' },
    nativeIndex: new Map([['m', { content: JSON.stringify({ text: 'a', styles: [{}, {}] }) }]]) });
  expect(query('字号').disabled).toBe(true); expect(host.textContent).toContain('不能无损转换');
  render({ clip: { ...props.clip, type: 'audio' } });
  props.onAction.mockResolvedValue(false); await edit('速度', '2');
  expect(host.querySelector('[role="alert"]').textContent).toContain('未保存');
});

it('共享文字设置的竖排映射、效果百分比和聚焦保持 property 协议', async () => {
  const material = { content: JSON.stringify({ text: '标题', styles: [{ size: 24 }] }), background_alpha: .4 };
  render({ clip: { ...props.clip, type: 'text' }, native: { material_id: 'm' }, nativeIndex: new Map([['m', material]]),
    focusRequest: { id: 'clip', property: 'position_x' } });
  expect(document.activeElement).toBe(query('X Position'));
  await click('上对齐');
  expect(props.onAction).toHaveBeenCalledWith(expect.objectContaining({ property: 'vertical', value: true }));
  expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'align', value: 0 }));
  const section = host.querySelector('[aria-label="背景设置"]');
  await act(async () => section.querySelector('button[aria-expanded]').click());
  expect(query('背景不透明度').value).toBe('40%');
  await edit('背景不透明度', '65');
  expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'background_alpha', mode: 'static', value: .65 }));
  render({ clip: { ...props.clip, type: 'text' }, disabled: true });
  expect(query('加粗').disabled).toBe(true); expect(query('字号').disabled).toBe(true);
});

it('共享文字保存失败展示错误且不修改后续对齐字段', async () => {
  render({ clip: { ...props.clip, type: 'text' } });
  props.onAction.mockResolvedValue(false);
  await click('下对齐');
  expect(props.onAction).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]').textContent).toContain('未保存');
});

it('文字设置使用原控件布局，字号编辑结束前不提交或禁用控件', async () => {
  render({ clip: { ...props.clip, type: 'text' } });
  const input = query('字号');
  act(() => input.focus());
  for (const value of ['3', '30']) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  expect(props.onAction).not.toHaveBeenCalled();
  expect(input.disabled).toBe(false);
  await act(async () => input.blur());
  expect(props.onAction).toHaveBeenCalledTimes(1);
  expect(props.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ property: 'font_size', value: 30 }));
  expect(host.querySelectorAll('.chat-panel__text-settings-toggle')).toHaveLength(3);
  expect(host.querySelectorAll('.chat-panel__text-settings-align')).toHaveLength(6);
  expect(host.querySelector('.chat-panel__text-settings-spacing-row')).not.toBeNull();
  expect(host.querySelector('.template-properties-unsupported').compareDocumentPosition(host.querySelector('.template-text-settings')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
});
