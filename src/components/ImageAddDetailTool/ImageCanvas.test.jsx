import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createCanvas, Image } from '@napi-rs/canvas';
import Konva from 'konva';
import { KonvaRenderer } from 'react-konva';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ImageCanvas from './ImageCanvas';

let root;
let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const canvases = new WeakMap();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    if (!canvases.has(this)) canvases.set(this, createCanvas(this.width || 300, this.height || 150));
    return canvases.get(this).getContext('2d');
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.restoreAllMocks();
});

it('真实图片画布按草稿比例显示，拖动缩放旋转写回参数且支持禁用', async () => {
  const image = new Image();
  image.src = createCanvas(1920, 1080).toBuffer('image/png');
  Object.defineProperty(image, 'src', { set() { queueMicrotask(() => image.onload?.()); } });
  vi.spyOn(window, 'Image').mockImplementation(function () { return image; });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const onChange = vi.fn();
  const onChoose = vi.fn();
  const props = { source: 'file:///tmp/image.png', canvas: { width: 1920, height: 1080 },
    settings: { positionX: 0, positionY: 0, scaleXPercent: 100, scaleYPercent: 100,
      rotation: 0, uniformScale: true, alphaPercent: 50 }, onChange, onChoose };
  await act(async () => root.render(<ImageCanvas {...props} />));
  const stage = Konva.stages.at(-1);
  const node = stage.findOne('.image-object');
  const transformer = stage.findOne('Transformer');
  expect(stage.width()).toBe(192);
  expect(node.width() / node.height()).toBeCloseTo(1920 / 1080);
  expect(node.findOne('Image')).toBeDefined();
  expect(node.opacity()).toBe(0.5);
  expect(transformer.nodes()).toEqual([node]);
  expect(transformer.keepRatio()).toBe(true);
  const canvasUpdates = vi.spyOn(KonvaRenderer, 'updateContainer');
  await act(async () => root.render(<ImageCanvas {...props} settings={{
    ...props.settings, start: 1, end: 8, trackName: 'another_track', relativeIndex: 2,
  }} />));
  expect(canvasUpdates).not.toHaveBeenCalled();
  await act(async () => root.render(<ImageCanvas {...props} settings={{
    ...props.settings, rotation: 15, alphaPercent: 80,
  }} />));
  expect(canvasUpdates).toHaveBeenCalled();
  expect(node.rotation()).toBe(15);
  expect(node.opacity()).toBe(0.8);
  await act(async () => root.render(<ImageCanvas {...props} />));
  await act(async () => {
    node.x(node.x() + 4.375);
    node.y(node.y() - 2.1875);
    node.fire('dragend');
  });
  expect(onChange.mock.lastCall[0]).toMatchObject({ positionX: 100, positionY: 50 });
  await act(async () => {
    node.scale({ x: 1.5, y: 1.5 });
    node.rotation(32);
    node.fire('transformend');
    node.fire('dblclick');
  });
  expect(onChange.mock.lastCall[0]).toMatchObject({
    scaleXPercent: 150, scaleYPercent: 150, rotation: 32,
  });
  expect(onChoose).toHaveBeenCalledOnce();
  await act(async () => root.render(<ImageCanvas {...props} disabled />));
  expect(node.draggable()).toBe(false);
  expect(transformer.nodes()).toEqual([]);
});

it.each([[2160, 3840], [540, 960], [1920, 1080]])(
  '源图 %i×%i 按剪映适配后缩放，截图位置可往返',
  async (imageWidth, imageHeight) => {
    const image = new Image();
    image.src = createCanvas(imageWidth, imageHeight).toBuffer('image/png');
    Object.defineProperty(image, 'src', { set() { queueMicrotask(() => image.onload?.()); } });
    vi.spyOn(window, 'Image').mockImplementation(function () { return image; });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const onChange = vi.fn();
    await act(async () => root.render(<ImageCanvas source="file:///tmp/reference.jpg"
      canvas={{ width: 1080, height: 1920 }} onChange={onChange}
      settings={{ positionX: -358, positionY: 651, scaleXPercent: 16, scaleYPercent: 16,
        rotation: 0, uniformScale: true, alphaPercent: 100 }} />));
    const node = Konva.stages.at(-1).findOne('.image-object');
    const ratio = 280 / 1920;
    const fit = Math.min(1080 / imageWidth, 1920 / imageHeight);
    expect(node.width() * node.scaleX()).toBeCloseTo(imageWidth * fit * ratio * 0.16);
    expect(node.height() * node.scaleY()).toBeCloseTo(imageHeight * fit * ratio * 0.16);
    expect(node.x() / (1080 * ratio)).toBeCloseTo(0.5 - 358 / 2160);
    expect(node.y() / 280).toBeCloseTo(0.5 - 651 / 3840);
    await act(async () => node.fire('dragend'));
    expect(onChange.mock.lastCall[0]).toMatchObject({
      positionX: -358, positionY: 651, scaleXPercent: 16, scaleYPercent: 16,
    });
  },
);
