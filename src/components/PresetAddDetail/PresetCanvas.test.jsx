import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createCanvas } from '@napi-rs/canvas';
import Konva from 'konva';
import { KonvaRenderer } from 'react-konva';
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
    const updates = vi.spyOn(KonvaRenderer, 'updateContainer');
    await act(async () => root.render(<PresetCanvas {...props} settings={{
      ...props.settings, targetStart: 5, sourceStart: 2, sourceEnd: 8, trackName: 'other',
    }} />));
    expect(updates).not.toHaveBeenCalled();
    await act(async () => root.render(<PresetCanvas {...props} settings={{ ...props.settings, rotation: 15 }} />));
    expect(node.rotation()).toBe(15);
    updates.mockRestore();
    await act(async () => {
      node.x(node.x() + 4.375);
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

  it.each([[2160, 3840], [540, 960], [1920, 1080]])(
    '预设 %i×%i 适配目标画布，缩放和位置往返一致',
    async (mediaWidth, mediaHeight) => {
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
      const onChange = vi.fn();
      await act(async () => root.render(<PresetCanvas preset={{ preset_id: 'reference' }}
        metadata={{ width: mediaWidth, height: mediaHeight }} canvas={{ width: 1080, height: 1920 }}
        settings={{ positionX: -358, positionY: 651, scaleXPercent: 16, scaleYPercent: 16,
          rotation: 0, uniformScale: true }} onChange={onChange} />));
      const node = Konva.stages.at(-1).findOne('.preset-object');
      const ratio = 280 / 1920;
      const fit = Math.min(1080 / mediaWidth, 1920 / mediaHeight);
      expect(node.width() * node.scaleX()).toBeCloseTo(mediaWidth * fit * ratio * 0.16);
      expect(node.height() * node.scaleY()).toBeCloseTo(mediaHeight * fit * ratio * 0.16);
      expect(node.x() / (1080 * ratio)).toBeCloseTo(0.5 - 358 / 2160);
      expect(node.y() / 280).toBeCloseTo(0.5 - 651 / 3840);
      await act(async () => node.fire('dragend'));
      expect(onChange.mock.lastCall[0]).toMatchObject({
        positionX: -358, positionY: 651, scaleXPercent: 16, scaleYPercent: 16,
      });
    },
  );
});
