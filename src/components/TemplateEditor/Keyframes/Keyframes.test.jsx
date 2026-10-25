import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Keyframes from './index';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host, anchor, props;
const query = selector => document.querySelector(selector);
const key = value => act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })));
const search = value => act(() => {
  const input = query('[role="combobox"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const render = overrides => act(() => root.render(<Keyframes {...props} {...overrides} />));

beforeEach(() => {
  host = document.createElement('div');
  anchor = document.createElement('button');
  document.body.append(host, anchor);
  anchor.getBoundingClientRect = () => ({ left: 100, right: 120, top: 100, bottom: 132 });
  root = createRoot(host);
  props = { clip: { id: 'clip', type: 'video', name: '视频', start: 1, end: 6 }, anchor, cursor: 2,
    onAction: vi.fn().mockResolvedValue(true), onFocusProperty: vi.fn(), onClose: vi.fn() };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove(); anchor.remove(); vi.restoreAllMocks();
});

it('菜单右侧定位、搜索聚焦、键盘循环选择后当前时间直接创建并聚焦属性面板', async () => {
  render();
  expect(query('[role="dialog"]').style.left).toBe('128px');
  expect(document.activeElement).toBe(query('[role="combobox"]'));
  search(' SCALE ');
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
  await key('ArrowUp');
  expect(query('[aria-selected="true"]').textContent).toBe('Scale');
  await key('ArrowDown'); await key('ArrowDown'); await key('Enter');
  expect(props.onAction).toHaveBeenCalledWith({ type: 'property', mode: 'keyframe', id: 'clip', property: 'scale_y', time: 1, value: 1 });
  expect(props.onFocusProperty).toHaveBeenCalledWith('clip', 'scale_y', 2);
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(query('[aria-label="关键帧数值"]')).toBeNull();
});

it.each(['keyboard', 'mouse'])('选择时采样当前插值而非默认值（%s）', async method => {
  render({ native: { common_keyframes: [{ property_type: 'KFTypeScaleX', keyframe_list: [
    { id: 'a', time_offset: 0, values: [1] }, { id: 'b', time_offset: 2_000_000, values: [2] },
  ] }] } });
  search('X Scale');
  if (method === 'keyboard') await key('Enter');
  else await act(async () => query('[role="option"]').click());
  expect(props.onAction).toHaveBeenCalledWith({ type: 'property', mode: 'keyframe', id: 'clip', property: 'scale_x', time: 1, value: 1.5 });
});

it('已有零值点仅聚焦、不重复提交，相邻微秒不误匹配', async () => {
  render({ native: { common_keyframes: [{ property_type: 'KFTypeGlobalAlpha', keyframe_list: [
    { id: 'a', time_offset: 1_000_000, values: [0] },
  ] }] } });
  search('opacity'); await key('Enter');
  expect(props.onAction).not.toHaveBeenCalled();
  expect(props.onFocusProperty).toHaveBeenCalledWith('clip', 'alpha', 2);
  render({ cursor: 2.000001, native: { common_keyframes: [{ property_type: 'KFTypeGlobalAlpha', keyframe_list: [
    { id: 'a', time_offset: 1_000_000, values: [0] },
  ] }] } });
  await key('Enter');
  expect(props.onAction).toHaveBeenCalledWith(expect.objectContaining({ time: 1.000001, value: 0 }));
});

it('空结果不误选，输入法 Enter 不提交，Escape 关闭归还焦点', async () => {
  render(); search('not-found'); await key('ArrowDown'); await key('Enter');
  expect(query('[role="status"]').textContent).toBe('无匹配属性');
  search('opacity');
  await act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  expect(props.onAction).not.toHaveBeenCalled();
  await key('Escape');
  expect(props.onClose).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(anchor);
});

it('靠右边界翻转、外部点击关闭', () => {
  anchor.getBoundingClientRect = () => ({ left: 950, right: 970, top: 700, bottom: 732 });
  render(); expect(query('[role="dialog"]').style.left).toBe('772px');
  act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(props.onClose).toHaveBeenCalledOnce();
});

it('锁定禁用，保存拒绝不关闭不聚焦并显示错误', async () => {
  render({ disabled: true }); search('scale_x'); await key('Enter');
  expect(query('[role="option"]').disabled).toBe(true); expect(props.onAction).not.toHaveBeenCalled();
  props.onAction.mockResolvedValue(false); render({ disabled: false }); await key('Enter');
  expect(query('[role="alert"]').textContent).toContain('未保存');
  expect(props.onClose).not.toHaveBeenCalled(); expect(props.onFocusProperty).not.toHaveBeenCalled();
});
