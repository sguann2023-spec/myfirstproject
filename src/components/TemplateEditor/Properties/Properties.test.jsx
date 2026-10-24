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

it('音频显示空态，贴纸仅静态，分镜仅动画；错误返回保留提示', async () => {
  render({ clip: { ...props.clip, type: 'audio' } }); expect(host.querySelectorAll('input')).toHaveLength(0);
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
  render({ clip: { ...props.clip, type: 'text' } }); expect(host.querySelector('[role="note"]').textContent).toContain('字体字号');
  render({ clip: { ...props.clip, type: 'audio' } }); expect(host.querySelector('[role="note"]').textContent).toContain('淡入淡出');
});
