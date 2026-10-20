import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import ImageAddDetailTool, { buildImageAddRequestParams, buildImageAddSettingsPrompt } from './index';
import { queryScript } from '../../api/capcut';

vi.mock('../../renderer/src/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) },
}));
vi.mock('../../api/capcut', () => ({
  queryScript: vi.fn(async () => ({ output: { canvas_config: { width: 1920, height: 1080 }, tracks: [] } })),
}));
vi.mock('../DraftSelect/index', () => ({ default: () => <button>Draft</button> }));
vi.mock('./ImageCanvas', () => ({
  default: ({ source, settings, canvas, onChange, onChoose }) => (
    <div aria-label="图片画布" data-source={source} data-rotation={settings.rotation} data-width={canvas?.width}>
      <button aria-label="模拟画布变换" onClick={(event) => {
        event.stopPropagation();
        onChange({ positionX: 100, scaleXPercent: 150, scaleYPercent: 150 });
      }} />
      <button aria-label="模拟双击替换" onClick={(event) => {
        event.stopPropagation();
        onChoose();
      }} />
    </div>
  ),
}));
vi.mock('../../renderer/src/pages/home/Inputbar/components/PinnedDraftTrackView/PinnedDraftTrackView', () => ({
  default: ({ plannedText, videoTracksOnly, rowHeightScale }) => (
    <div aria-label="轨道预览数据" data-video-only={String(videoTracksOnly)} data-row-scale={rowHeightScale}>
      {JSON.stringify(plannedText)}
    </div>
  ),
}));

let root;
let host;
const query = (selector) => document.querySelector(selector);
const click = async (element) => act(async () => element.click());
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = () => ({
    matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  });
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  root = null;
  delete window.api;
  vi.clearAllMocks();
});
async function mount(props = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ImageAddDetailTool selectedDraftIds={['draft-1']} {...props} />));
}

it('未选草稿时只显示草稿选择器', async () => {
  await mount({ selectedDraftIds: [] });
  expect(query('.chat-panel__text-settings-main')).toBeNull();
  expect(query('[aria-label="导入图片"]')).toBeNull();
});

it('父级重绘和更换回调不会再次回写设置，后续编辑使用最新回调', async () => {
  const first = vi.fn();
  const next = vi.fn();
  await mount({ onSettingsChange: first });
  expect(first).toHaveBeenCalled();
  await act(async () => root.render(
    <ImageAddDetailTool selectedDraftIds={['draft-1']} onSettingsChange={next} />
  ));
  expect(next).not.toHaveBeenCalled();
  await click(query('[role="tab"][aria-label="时间线"]'));
  await act(async () => query('[aria-label="结束时间"]').dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowUp', keyCode: 38, which: 38, bubbles: true,
  })));
  expect(next).toHaveBeenCalledOnce();
  expect(next.mock.lastCall[0].end).toBe(3.01);
});

it('结束时间在编辑事件中同步通知父级，不等待渲染后的 effect', async () => {
  const onSettingsChange = vi.fn();
  await mount({ onSettingsChange });
  await click(query('[role="tab"][aria-label="时间线"]'));
  const input = query('[aria-label="结束时间"]');
  onSettingsChange.mockClear();
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowUp', keyCode: 38, which: 38, bubbles: true,
    }));
    expect(onSettingsChange).toHaveBeenCalledOnce();
    expect(buildImageAddRequestParams(onSettingsChange.mock.lastCall[0]).end).toBe(3.01);
  });
  expect(onSettingsChange).toHaveBeenCalledOnce();
});

it('快捷短语使用与请求一致的完整文件路径而非显示名称', () => {
  for (const imagePath of ['/Users/test/My Images/flame.svg', 'C:\\Users\\test\\Images\\flame.svg']) {
    const settings = { imagePath, imageName: 'flame.svg' };
    expect(buildImageAddSettingsPrompt(settings)).toContain(`文件：${imagePath}\n`);
    expect(buildImageAddRequestParams(settings).image_url).toBe(imagePath);
  }
});

it('入口使用完整设置面板，折叠、开关、拨盘及效果参数正常工作', async () => {
  const onSettingsChange = vi.fn();
  await mount({ onSettingsChange });
  const heading = query('.chat-panel__text-settings-section-header');
  expect(heading.textContent).toBe('位置大小');
  expect(query('.chat-panel__text-settings-switch')).not.toBeNull();
  const dial = query('[aria-label="拖动调整平面旋转"]');
  await act(async () => dial.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowRight', shiftKey: true, bubbles: true,
  })));
  expect(buildImageAddRequestParams(onSettingsChange.mock.lastCall[0]).rotation).toBe(10);
  await click(heading);
  expect(query('[aria-label="拖动调整平面旋转"]')).toBeNull();
  await click(heading);
  await click(query('[aria-label="等比缩放"]'));
  expect(query('[aria-label="缩放高度"]')).not.toBeNull();
  const headings = Array.from(document.querySelectorAll('.chat-panel__text-settings-section-header'));
  await click(headings.find((item) => item.textContent === '动画'));
  expect(query('[aria-label="启用入场动画"]')).not.toBeNull();
  expect(query('[aria-label="启用出场动画"]')).not.toBeNull();
  expect(query('[aria-label="启用组合动画"]')).not.toBeNull();
  await click(query('[aria-label="启用入场动画"]'));
  expect(onSettingsChange.mock.lastCall[0].introAnimation.enabled).toBe(true);
  await click(query('[aria-label="启用组合动画"]'));
  expect(onSettingsChange.mock.lastCall[0].comboAnimation.enabled).toBe(true);
  await click(headings.find((item) => item.textContent === '转场'));
  await click(query('[aria-label="启用转场"]'));
  expect(query('[aria-label="选择转场"]')).not.toBeNull();
  expect(onSettingsChange.mock.lastCall[0].transition.enabled).toBe(true);
  expect(query('input[aria-label="透明度"]').getAttribute('aria-valuemax')).toBe('100');
});

it('导入图片后接入草稿画布，变换同步到请求，点击画布替换图片', async () => {
  window.api = { file: { select: vi.fn()
    .mockResolvedValueOnce([{ path: '/tmp/first.png', name: 'first.png' }])
    .mockResolvedValueOnce([{ path: '/tmp/second.png', name: 'second.png' }]) } };
  const onSettingsChange = vi.fn();
  await mount({ onSettingsChange });
  await click(query('[aria-label="导入图片"]'));
  expect(query('[aria-label="图片画布"]').dataset.width).toBe('1920');
  expect(query('[aria-label="图片画布"]').dataset.source).toBe('file:///tmp/first.png');
  expect(query('.chat-panel__image-add-preview-card')).toBeNull();
  expect(Array.from(document.querySelectorAll('button')).some((item) => item.textContent === '替换图片'
    || item.textContent === '移除图片')).toBe(false);
  await click(query('[aria-label="模拟画布变换"]'));
  expect(buildImageAddRequestParams(onSettingsChange.mock.lastCall[0])).toMatchObject({
    image_url: '/tmp/first.png', transform_x_px: 100, scale_x: 1.5, scale_y: 1.5,
  });
  await click(query('[aria-label="图片画布"]'));
  expect(query('[aria-label="图片画布"]').dataset.source).toBe('file:///tmp/second.png');
  await act(async () => {
    query('[aria-label="图片画布"]').dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    query('[aria-label="图片画布"]').click();
  });
  expect(window.api.file.select).toHaveBeenCalledTimes(2);
});

it('时间线使用视频轨道选择、层级控件及与预设一致的只读预览', async () => {
  queryScript.mockResolvedValueOnce({ output: { tracks: [
    { type: 'text', name: '文字' },
    { type: 'video', name: '主视频', relative_index: 5,
      segments: [{ target_timerange: { start: 0, duration: 10000000 } }] },
  ] } });
  window.api = { file: { select: vi.fn().mockResolvedValue([{ path: '/tmp/image.png' }]) } };
  const onSettingsChange = vi.fn();
  await mount({ onSettingsChange });
  await click(query('[aria-label="导入图片"]'));
  await click(query('[role="tab"][aria-label="时间线"]'));
  expect(query('[aria-label="选择视频轨道"]')).not.toBeNull();
  expect(query('[aria-label="置顶"]')).not.toBeNull();
  expect(query('[aria-label="置底"]')).not.toBeNull();
  const preview = query('[aria-label="轨道预览数据"]');
  expect(preview.dataset.videoOnly).toBe('true');
  expect(Number(preview.dataset.rowScale)).toBe(3 / 5);
  expect(JSON.parse(preview.textContent)).toMatchObject({ type: 'video', start: 0, end: 3 });
  expect(buildImageAddRequestParams(onSettingsChange.mock.lastCall[0])).toMatchObject({
    track_name: 'image_track', relative_index: 6,
  });
});

it('启用的动画和转场完整写入请求，未启用效果不提交', () => {
  expect(buildImageAddRequestParams({
    introAnimation: { enabled: true, animation: '渐显', duration: 0.7 },
    outroAnimation: { enabled: false, animation: '渐隐', duration: 0.8 },
    comboAnimation: { enabled: true, animation: '叠叠乐', duration: 0.6 },
    transition: { enabled: true, transition: '叠化', duration: 0.5 },
  })).toMatchObject({ intro_animation: '渐显', intro_animation_duration: 0.7,
    combo_animation: '叠叠乐', combo_animation_duration: 0.6,
    transition: '叠化', transition_duration: 0.5 });
  expect(buildImageAddRequestParams()).not.toHaveProperty('outro_animation');
  expect(buildImageAddRequestParams()).not.toHaveProperty('combo_animation');
});
