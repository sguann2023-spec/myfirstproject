import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createCanvas } from '@napi-rs/canvas';
import Konva from 'konva';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import PresetCanvas from './PresetCanvas';

let root;
let host;
beforeAll(() => {
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
});

describe('真实 Konva 预设变换', () => {
  it('挂载变换框，拖动缩放旋转写回参数，禁用时不能操作', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const onChange = vi.fn();
    const props = { preset: { preset_id: 'a' }, metadata: { width: 1920, height: 1080 },
      canvas: { width: 1920, height: 1080 }, settings: {
        positionX: 0, positionY: 0, scaleXPercent: 100, scaleYPercent: 100, rotation: 0, uniformScale: true,
      }, onChange };
    await act(async () => root.render(<PresetCanvas {...props} />));
    const stage = Konva.stages.at(-1);
    const node = stage.findOne('.preset-object');
    const transformer = stage.findOne('Transformer');
    expect(node.width() / node.height()).toBeCloseTo(1920 / 1080);
    expect(transformer.nodes()).toEqual([node]);
    expect(node.draggable()).toBe(true);
    await act(async () => {
      node.x(node.x() + 8.75);
      node.fire('dragend');
    });
    expect(onChange.mock.lastCall[0].positionX).toBe(100);
    await act(async () => {
      node.scale({ x: 1.5, y: 1.5 });
      node.rotation(32);
      node.fire('transformend');
    });
    expect(onChange.mock.lastCall[0]).toMatchObject({ scaleXPercent: 150, scaleYPercent: 150, rotation: 32 });
    await act(async () => root.render(<PresetCanvas {...props} disabled />));
    expect(node.draggable()).toBe(false);
    expect(transformer.nodes()).toEqual([]);
  });
});
