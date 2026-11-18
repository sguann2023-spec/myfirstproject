import { describe, expect, it } from 'vitest';
import { analyzeEditorDocument } from '../../../main/template/editorModel';
import { createEditorPreset } from '../../../main/template/editorPresets';
import { indexEditorTree } from '../editorView';
import {
  collectPreviewFrame, composeTransform, fitMediaSize, formatPreviewTime,
  IDENTITY_TRANSFORM, mediaSource, parseTextStyle, sampleSceneMask, sampleVisualTransform, textCanvasMetrics,
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

describe('personalized-welcome motion sample', () => {
  const context = setup(createEditorPreset('personalized-welcome'));

  it('uses ordinary images and text with sampled greeting motion', () => {
    const first = frameAt(context, 0.1);
    const settled = frameAt(context, 2);
    expect(first.items.map(item => item.kind)).toEqual(['image', 'text', 'text']);
    expect(first.items[0].url).toBe('/resources/template-presets/personalized-welcome/background-yellow.png');
    const firstName = first.items.find(item => item.id === 'welcome-name');
    const settledName = settled.items.find(item => item.id === 'welcome-name');
    expect(firstName.transform.y).not.toBe(settledName.transform.y);
    expect(firstName.transform.alpha).toBe(0);
    expect(settledName.transform.alpha).toBe(1);
    expect(settledName.textStyle.text).toBe('嗨，小明！');
    expect(settled.notices).toEqual([]);
    expect(settled.items.every(item => item.masks.length === 0)).toBe(true);
  });

  it('fades incoming image/text scenes and samples the ordinary logo image keyframes', () => {
    const overlap = frameAt(context, 4);
    const outgoing = overlap.items.find(item => item.id === 'welcome-intro-background');
    const incoming = overlap.items.filter(item => item.id.startsWith('welcome-journey-'));
    expect(outgoing.transform.alpha).toBe(1);
    expect(incoming.map(item => item.kind)).toEqual(['image', 'text']);
    expect(incoming[0].transform.alpha).toBe(0.5);
    expect(incoming[1].parentTransform.alpha).toBe(0.5);
    expect(overlap.items.every(item => item.masks.length === 0)).toBe(true);
    const final = frameAt(context, 7);
    const logo = final.items.find(item => item.id === 'welcome-brand-logo');
    expect(logo.kind).toBe('image');
    expect(logo.url).toBe('/resources/template-presets/personalized-welcome/logo/vectcut.png');
    expect(logo.transform.scaleX).toBeGreaterThan(0.28);
    expect(logo.transform.scaleX).toBeLessThan(0.36);
    expect(logo.transform.alpha).toBeGreaterThan(0);
    expect(logo.transform.alpha).toBeLessThan(0.5);
    expect(final.items.find(item => item.id === 'welcome-brand-background').transform.alpha).toBe(0.5);
    const settledLogo = frameAt(context, 8).items.find(item => item.id === 'welcome-brand-logo');
    expect(settledLogo.transform).toMatchObject({ scaleX: 0.34, scaleY: 0.34, alpha: 1 });
    expect(final.items.every(item => item.masks.length === 0)).toBe(true);
    expect(frameAt(context, 9.5).items).toEqual([]);
  });
});

describe('composition circular reveal', () => {
  const segment = (id, material_id = 'photo') => ({
    id, material_id, target_timerange: { start: 0, duration: 4_000_000 },
    clip: { transform: { x: 0.25, y: -0.2 }, scale: { x: 0.8, y: 1.2 }, rotation: 15, alpha: 0.6 },
    common_keyframes: [{ id: `${id}-x`, property_type: 'KFTypePositionX', keyframe_list: [
      { id: `${id}-a`, time_offset: 0, values: [0] },
      { id: `${id}-b`, time_offset: 1_000_000, values: [1] },
    ] }],
  });
  const track = (id, segments, order = 0, type = 'video') => ({ id, type, track_relative_index: order, segments });
  const transition = { type: 'circular-wipe', duration: 1_000_000 };
  const template = {
    canvas_config: { width: 800, height: 600 }, duration: 5_000_000,
    materials: {
      videos: [{ id: 'photo', type: 'photo', remote_url: 'https://example.com/photo.png' }],
      texts: [{ id: 'title', type: 'text', content: JSON.stringify({ text: 'Welcome' }) }],
    },
    scenes: [
      { id: 'outgoing', target_timerange: { start: 0, duration: 4_000_000 }, tracks: [track('old-track', [segment('old')])] },
      { id: 'incoming', target_timerange: { start: 1_000_000, duration: 4_000_000 }, preview_transition: transition,
        tracks: [track('new-track', [segment('new')]), track('title-track', [segment('new-title', 'title')], 1, 'text')] },
    ],
  };

  it('keeps ordinary media transforms and keyframe sampling independent from masks', () => {
    const frame = frameAt(setup(template), 1.5);
    expect(frame.items.map(item => item.id)).toEqual(['old', 'new', 'new-title']);
    expect(frame.items.map(item => item.kind)).toEqual(['image', 'image', 'text']);
    expect(frame.items[1].url).toBe('https://example.com/photo.png');
    expect(frame.items[1].transform).toMatchObject({ x: 0.5, y: -0.2, scaleX: 0.8, scaleY: 1.2, rotation: 15, alpha: 0.6 });
    expect(frame.items[2].textStyle.text).toBe('Welcome');
    expect(frame.notices).toEqual([]);
  });

  it('reveals the entire incoming composition from zero to canvas diagonal, preserving outgoing outside', () => {
    const context = setup(template);
    for (const [time, progress, radius] of [[1, 0, 0], [1.5, 0.5, 250], [1.999, 0.999, 499.5]]) {
      const frame = frameAt(context, time);
      expect(frame.items[0].masks).toEqual([]);
      expect(frame.items.slice(1).map(item => item.masks.length)).toEqual([1, 1]);
      expect(frame.items[1].masks[0]).toMatchObject({ sceneId: 'incoming', transform: IDENTITY_TRANSFORM });
      expect(frame.items[1].masks[0].progress).toBeCloseTo(progress);
      expect(frame.items[1].masks[0].radius).toBeCloseTo(radius);
      expect(frame.items[2].masks).toEqual(frame.items[1].masks);
    }
    expect(frameAt(context, 2).items.every(item => item.masks.length === 0)).toBe(true);
    expect(frameAt(context, 4.5).items.map(item => item.id)).toEqual(['new', 'new-title']);
  });

  it('applies one composition aperture to every image and text layer', () => {
    const mixed = structuredClone(template);
    mixed.scenes[1].tracks.push(
      track('image-track', [segment('image')], 2),
      track('text-track', [segment('text', 'title')], 3, 'text'),
    );
    const items = frameAt(setup(mixed), 1.5).items.slice(1);
    expect(items.map(item => item.kind)).toEqual(['image', 'text', 'image', 'text']);
    expect(items.every(item => item.masks.length === 1 && item.masks[0].sceneId === 'incoming')).toBe(true);
    expect(items.map(item => item.masks)).toEqual(Array(4).fill(items[0].masks));
  });

  it('seek and reverse are pure cursor sampling, with no remembered mask state', () => {
    const context = setup(template);
    const first = frameAt(context, 1.2);
    frameAt(context, 3);
    frameAt(context, 1.8);
    expect(frameAt(context, 1.2)).toEqual(first);
    expect(frameAt(context, 0.5).items.map(item => item.id)).toEqual(['old']);
  });

  it('intersects nested masks at their local clocks and keeps leaf transforms out of crop space', () => {
    const nested = structuredClone(template);
    nested.scenes[1].common_keyframes = [{ id: 'parent-scale', property_type: 'KFTypeScaleX', keyframe_list: [
      { id: 's0', time_offset: 0, values: [1] }, { id: 's1', time_offset: 1_000_000, values: [2] },
    ] }];
    nested.scenes[1].tracks.push({ id: 'nested-track', type: 'scene', track_relative_index: 1, segments: [{
      id: 'nested', type: 'scene', target_timerange: { start: 250_000, duration: 2_000_000 },
      preview_transition: transition,
      tracks: [track('nested-media', [segment('inner')])],
    }] });
    const context = setup(nested);
    const frame = frameAt(context, 1.5);
    const child = frame.items.find(item => item.id === 'inner');
    expect(child.masks.map(mask => [mask.sceneId, mask.progress, mask.radius])).toEqual([
      ['incoming', 0.5, 250], ['nested', 0.25, 125],
    ]);
    expect(child.masks[0].transform.scaleX).toBe(1.5);
    expect(child.masks[1].transform.scaleX).toBe(1.5);
    expect(child.transform.x).toBeCloseTo(0.375);
    expect(child.masks[1].transform.x).toBe(0);
    const scoped = frameAt(context, 0.25, 'nested');
    expect(scoped.items.map(item => item.id)).toEqual(['inner']);
    expect(scoped.items[0].masks.map(mask => mask.sceneId)).toEqual(['nested']);
    expect(scoped.items[0].masks[0].radius).toBe(125);
    expect(scoped.items[0].masks[0].transform.scaleX).toBe(1);
  });

  it('scope uses its own transition clock without sibling or ancestor masks', () => {
    const frame = frameAt(setup(template), 0.5, 'incoming');
    expect(frame.items.map(item => item.id)).toEqual(['new', 'new-title']);
    expect(frame.items[0].masks[0].progress).toBe(0.5);
    expect(frameAt(setup(template), 1, 'incoming').items[0].masks).toEqual([]);
  });

  it('invalid or completed transitions do not add masks', () => {
    const canvas = { width: 800, height: 600 };
    for (const native of [{}, { preview_transition: { type: 'fade', duration: 1_000_000 } },
      { preview_transition: { type: 'circular-wipe', duration: 0 } }]) {
      expect(sampleSceneMask(native, 0.5, canvas, IDENTITY_TRANSFORM)).toBeNull();
    }
    expect(sampleSceneMask({ preview_transition: transition }, -1, canvas, IDENTITY_TRANSFORM)).toBeNull();
    expect(sampleSceneMask({ preview_transition: transition }, 1, canvas, IDENTITY_TRANSFORM)).toBeNull();
  });
});

describe('mediaSource', () => {
  it('preserves canonical URLs and browser root-relative assets without OS conversion', () => {
    for (const path of [
      'https://example.com/photo.png',
      'file:///Users/editor/My%20Assets/photo.png',
      '/resources/template-presets/personalized-welcome/background-yellow.png',
      '/Users/editor/My Assets/photo.png',
      'C:\\Users\\editor\\My Assets\\photo.png',
    ]) expect(mediaSource({ path })).toBe(path);
    expect(mediaSource({ remote_url: 'https://example.com/canonical.png', path: '/tmp/local.png' }))
      .toBe('https://example.com/canonical.png');
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
