import { describe, expect, it } from 'vitest';
import { analyzeEditorDocument } from '../../../main/template/editorModel';
import { createEditorPreset } from '../../../main/template/editorPresets';
import { indexEditorTree } from '../editorView';
import {
  collectPreviewFrame, composeTransform, fitMediaSize, formatPreviewTime,
  IDENTITY_TRANSFORM, parseTextStyle, sampleVisualTransform, textCanvasMetrics,
} from './previewModel';

const buildNativeIndex = (template) => {
  const result = new Map();
  result.set('__root__', template);
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string') result.set(value.id, value);
    Object.values(value).forEach(visit);
  };
  visit(template);
  return result;
};

const setup = (template) => {
  const model = analyzeEditorDocument({ templateJson: JSON.stringify(template) });
  return { model, index: indexEditorTree(model.tree), nativeIndex: buildNativeIndex(template) };
};

const frameAt = (context, time, scopeId = null) =>
  collectPreviewFrame({ ...context, scopeId, time });

describe('collectPreviewFrame 一句一图预设', () => {
  const context = setup(createEditorPreset('sentence-image'));

  it('第一组时间窗内自底向顶返回图片与文字', () => {
    const frame = frameAt(context, 2.5);
    expect(frame.canvas).toEqual({ width: 720, height: 1280 });
    expect(frame.items.map(item => item.id)).toEqual(['image-1', 'text-1']);
    expect(frame.items[1].textStyle.text).toBe('清晨，阳光洒进安静的房间。');
    expect(frame.items[0].url).toContain('https://');
    expect(frame.audio).toEqual([]);
  });

  it('嵌套分镜时钟按组切换', () => {
    expect(frameAt(context, 7).items.map(item => item.id)).toEqual(['image-2', 'text-2']);
    expect(frameAt(context, 12).items.map(item => item.id)).toEqual(['image-3', 'text-3']);
    expect(frameAt(context, 15).items).toEqual([]);
    expect(frameAt(context, 4.99).items.map(item => item.id)).toEqual(['image-1', 'text-1']);
    expect(frameAt(context, 5).items.map(item => item.id)).toEqual(['image-2', 'text-2']);
  });

  it('进入子分镜后使用局部时间', () => {
    const frame = frameAt(context, 2, 'sentence-scene-2');
    expect(frame.items.map(item => item.id)).toEqual(['image-2', 'text-2']);
    expect(frame.items[0].start).toBe(0);
    expect(frame.items[0].duration).toBe(5);
    expect(frameAt(context, 6, 'sentence-scene-2').items).toEqual([]);
  });
});

describe('collectPreviewFrame 自定义模版', () => {
  const template = {
    canvas_config: { width: 1080, height: 1920 },
    duration: 8_000_000,
    materials: {
      videos: [{ id: 'photo', type: 'photo', remote_url: 'https://example.com/a.png' }],
      texts: [{ id: 'title', type: 'text', content: JSON.stringify({ text: '你好' }) }],
      audios: [{ id: 'bgm', type: 'extract_music', remote_url: 'https://example.com/a.mp3' }],
      effects: [{ id: 'filter-1', type: 'filter', filter_type: '黑白' }],
    },
    scenes: [{
      id: 'scene', target_timerange: { start: 0, duration: 8_000_000 },
      common_keyframes: [{
        id: 'scene-scale', property_type: 'KFTypeScaleX',
        keyframe_list: [
          { id: 's0', time_offset: 0, values: [1] },
          { id: 's1', time_offset: 4_000_000, values: [2] },
        ],
      }],
      tracks: [
        { id: 'image-track', type: 'video', track_relative_index: 0, segments: [{
          id: 'image-1', material_id: 'photo', target_timerange: { start: 0, duration: 6_000_000 },
          clip: { transform: { x: 0.25, y: -0.5 }, scale: { x: 1, y: 1 }, alpha: 0.8, flip: { horizontal: true } },
          common_keyframes: [{
            id: 'pos-x', property_type: 'KFTypePositionX',
            keyframe_list: [
              { id: 'p0', time_offset: 0, values: [0] },
              { id: 'p1', time_offset: 2_000_000, values: [1] },
            ],
          }],
        }] },
        { id: 'text-track', type: 'text', track_relative_index: 1, segments: [{
          id: 'text-1', material_id: 'title', target_timerange: { start: 1_000_000, duration: 4_000_000 },
          global_alpha: 0.4,
        }] },
        { id: 'audio-track', type: 'audio', track_relative_index: 2, segments: [{
          id: 'audio-1', material_id: 'bgm', target_timerange: { start: 0, duration: 8_000_000 },
          source_timerange: { start: 2_000_000 }, volume: 0.6,
        }] },
        { id: 'filter-track', type: 'filter', track_relative_index: 3, segments: [{
          id: 'filter-seg', material_id: 'filter-1', target_timerange: { start: 0, duration: 8_000_000 },
        }] },
      ],
    }],
  };
  const context = setup(template);

  it('关键帧线性插值并继承父分镜缩放', () => {
    const frame = frameAt(context, 1);
    const image = frame.items.find(item => item.id === 'image-1');
    // 父分镜 scaleX 在 1s 时为 1.25；子位置关键帧 0.5 乘父缩放。
    expect(image.transform.x).toBeCloseTo(0.5 * 1.25, 6);
    expect(image.transform.scaleX).toBeCloseTo(1.25, 6);
    expect(image.transform.y).toBeCloseTo(-0.5, 6);
    expect(image.transform.alpha).toBeCloseTo(0.8, 6);
    expect(image.transform.flipX).toBe(true);
    const after = frameAt(context, 3).items.find(item => item.id === 'image-1');
    expect(after.transform.x).toBeCloseTo(1 * 1.75, 6);
  });

  it('文字 global_alpha 与可见窗口', () => {
    expect(frameAt(context, 0.5).items.map(item => item.id)).toEqual(['image-1']);
    const frame = frameAt(context, 2);
    expect(frame.items.map(item => item.id)).toEqual(['image-1', 'text-1']);
    expect(frame.items[1].transform.alpha).toBeCloseTo(0.4, 6);
    expect(frameAt(context, 5.5).items.map(item => item.id)).toEqual(['image-1']);
    expect(frameAt(context, 6.5).items).toEqual([]);
  });

  it('音频独立收集并带源裁切与音量', () => {
    const frame = frameAt(context, 2);
    expect(frame.audio).toEqual([{
      id: 'audio-1', name: 'audio-1', url: 'https://example.com/a.mp3',
      start: 0, duration: 8, sourceStart: 2, volume: 0.6,
    }]);
  });

  it('滤镜不进入画布但给出提示', () => {
    const frame = frameAt(context, 2);
    expect(frame.items.some(item => item.kind === 'filter')).toBe(false);
    expect(frame.notices).toContain('滤镜与特效暂不参与画布预览');
  });
});

describe('样式与几何换算', () => {
  it('parseTextStyle 还原原生字段到 UI 单位', () => {
    const style = parseTextStyle({
      content: JSON.stringify({
        text: '标题',
        styles: [{
          size: 12, bold: true,
          fill: { content: { solid: { color: [1, 0, 0], alpha: 0.5 } } },
          strokes: [{ width: 0.08, content: { solid: { color: [0, 0, 1], alpha: 0.25 } } }],
        }, { size: 8 }],
      }),
      letter_spacing: 0.5, line_spacing: 0.12, alignment: 2, typesetting: 1,
      background_alpha: 0.6, background_color: [0, 0, 0],
      has_shadow: true, shadow_smoothing: 0.45,
    });
    expect(style.text).toBe('标题');
    expect(style.rich).toBe(true);
    expect(style.size).toBe(12);
    expect(style.color).toBe('#ff0000');
    expect(style.alpha).toBe(0.5);
    expect(style.border).toEqual({ width: 40, color: '#0000ff', alpha: 0.25 });
    expect(style.letterSpacing).toBe(10);
    expect(style.lineSpacing).toBeCloseTo(2, 6);
    expect(style.align).toBe(2);
    expect(style.vertical).toBe(true);
    expect(style.background.alpha).toBe(0.6);
    expect(style.shadow.enabled).toBe(true);
    expect(style.shadow.smoothing).toBeCloseTo(0.15, 6);
  });

  it('parseTextStyle 缺省值与坏 content 不崩溃', () => {
    const style = parseTextStyle({ content: '{bad json' });
    expect(style.text).toBe('');
    expect(style.size).toBe(8);
    expect(style.color).toBe('#FFFFFF');
    expect(style.vertical).toBe(false);
  });

  it('文字度量沿用 TextAddDetail 标定', () => {
    const metrics = textCanvasMetrics({ size: 24, letterSpacing: 0, lineSpacing: 0 });
    expect(metrics.fontSize).toBeCloseTo(24 * (120 / 95), 6);
    expect(metrics.lineHeight).toBeCloseTo(metrics.fontSize * 1.2, 6);
  });

  it('媒体 contain 内切', () => {
    expect(fitMediaSize({ width: 720, height: 1280 }, { width: 1000, height: 1000 })).toEqual({ width: 720, height: 720 });
    expect(fitMediaSize({ width: 720, height: 1280 }, { width: 100, height: 400 })).toEqual({ width: 320, height: 1280 });
    expect(fitMediaSize({ width: 720, height: 1280 }, null)).toEqual({ width: 720, height: 1280 });
  });

  it('变换合成与时间格式化', () => {
    const composed = composeTransform(
      { ...IDENTITY_TRANSFORM, x: 1, scaleX: 2, rotation: 10, alpha: 0.5 },
      { ...IDENTITY_TRANSFORM, x: 0.5, rotation: 5, alpha: 0.5 },
    );
    expect(composed.x).toBe(2);
    expect(composed.scaleX).toBe(2);
    expect(composed.rotation).toBe(15);
    expect(composed.alpha).toBe(0.25);
    expect(formatPreviewTime(65.25)).toBe('01:05.25');
    expect(formatPreviewTime(0)).toBe('00:00.00');
  });

  it('非法关键帧回退静态值', () => {
    const transform = sampleVisualTransform({
      clip: { transform: { x: 0.3 } },
      common_keyframes: [{ id: 'bad', property_type: 'KFTypePositionX', keyframe_list: [
        { id: 'a', time_offset: 10, values: [0] },
        { id: 'b', time_offset: 5, values: [1] },
      ] }],
    }, 'image', 0.5);
    expect(transform.x).toBe(0.3);
  });
});
