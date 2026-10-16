// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TemplatePickerDialog from './TemplatePickerDialog';

let root;
let container;
const getComputedStyle = window.getComputedStyle.bind(window);
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom cannot measure pseudo-element scrollbars used by Antd's modal.
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
  window.matchMedia = vi.fn(() => ({
    matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}
  }));
  window.electron = { ipcRenderer: { invoke: vi.fn(async () => [
    { id: 'empty', name: '空白模版', description: 'Empty template · 从零开始添加素材', source: 'preset' },
    { id: 'sentence-image', name: '一句一图', description: '每个子分镜一句一图，图片与文字同步，分镜自动串联', source: 'preset' },
    { id: 'mixed-track', name: '混排演示', description: '同轨图片与文字交替出现，演示混排与上下层级', source: 'preset' },
  ]) } };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  delete window.electron;
});

it('选择后才通知打开指定模版', async () => {
  const onSelect = vi.fn();
  await act(async () => root.render(<TemplatePickerDialog open onClose={vi.fn()} onSelect={onSelect} />));
  expect(onSelect).not.toHaveBeenCalled();
  let cards = document.querySelectorAll('.template-picker-card');
  expect(cards).toHaveLength(1);
  expect(cards[0].textContent).toContain('新建模版');
  await act(async () => cards[0].click());
  cards = document.querySelectorAll('.template-picker-card');
  expect(cards).toHaveLength(3);
  await act(async () => cards[0].click());
  expect(onSelect).toHaveBeenLastCalledWith('empty');
  await act(async () => cards[1].click());
  expect(onSelect).toHaveBeenLastCalledWith('sentence-image');
  expect(cards[2].textContent).toContain('混排演示');
  expect(cards[2].querySelectorAll('.template-picker-mixed-clip')).toHaveLength(4);
  await act(async () => cards[2].click());
  expect(onSelect).toHaveBeenLastCalledWith('mixed-track');
});

it('展示本地已保存模版并按文件路径打开', async () => {
  window.electron.ipcRenderer.invoke.mockResolvedValueOnce([
    { id: 'empty', name: '空白模版', description: 'Empty template · 从零开始添加素材', source: 'preset' },
    { id: 'local:/workspace/template/scenes/tpl-1/template.json', name: '一句一图', description: '3小时前', source: 'local', templatePath: '/workspace/template/scenes/tpl-1/template.json' },
  ]);
  const onSelect = vi.fn();
  await act(async () => root.render(<TemplatePickerDialog open onClose={vi.fn()} onSelect={onSelect} />));
  await act(async () => {});
  const cards = document.querySelectorAll('.template-picker-card');
  expect(cards).toHaveLength(2);
  expect(cards[0].textContent).toContain('新建模版');
  expect(cards[1].textContent).toContain('一句一图');
  expect(cards[1].textContent).toContain('3小时前');
  await act(async () => cards[1].click());
  expect(onSelect).toHaveBeenCalledWith({ templatePath: '/workspace/template/scenes/tpl-1/template.json' });
});

it('取消不创建模版', async () => {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  await act(async () => root.render(<TemplatePickerDialog open onClose={onClose} onSelect={onSelect} />));
  await act(async () => document.querySelector('.ant-modal-close').click());
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
});
