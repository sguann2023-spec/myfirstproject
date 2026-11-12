// 模版画布预览的纯数据层：可见性、层级、嵌套分镜时钟、关键帧采样与文字样式解析。
// 换算比例与 TextAddDetail / ImageAddDetailTool 的 Konva 示例保持一致：
//  - clip.transform.x/y 为归一化比例，1 个单位 = 半个画布宽/高（+Y 向上）；
//  - 图片/视频先 contain 内切画布，再乘 clip.scale；
//  - 文字字号/字距/行距沿用 TextAddDetail 的视觉标定常数。
import { readStaticProperty, readTemplateProperty } from '../../../shared/templateProperties';

// 与 TextAddDetail/index.js 完全一致的视觉标定常数。
export const PREVIEW_FONT_SIZE_CALIBRATION = 120 / 95;
export const PREVIEW_LETTER_SPACING_CALIBRATION = 75 / 55;
export const PREVIEW_LINE_SPACING_CALIBRATION = 1.9;
export const PREVIEW_TEXT_PADDING = 8;
export const PREVIEW_BASE_LINE_HEIGHT = 1.2;

export const IDENTITY_TRANSFORM = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, flipX: false, flipY: false };

const number = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

export const mediaSource = (material) => String(material?.remote_url || material?.path || '').trim();

const rgbToHex = (value, fallback) => {
  if (!Array.isArray(value) || value.length < 3 || value.some(channel => typeof channel !== 'number' || !Number.isFinite(channel))) return fallback;
  return `#${value.slice(0, 3).map(channel => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0')).join('')}`;
};

// 解析剪映文字素材的全局样式。多段富文本只取首段（与配置接口边界一致），并标记 rich。
export function parseTextStyle(material) {
  let content = {};
  try { content = JSON.parse(material?.content ?? '{"text":""}') || {}; } catch { content = {}; }
  const styles = Array.isArray(content.styles) ? content.styles : [];
  const style = styles[0] && typeof styles[0] === 'object' ? styles[0] : {};
  const solid = style.fill?.content?.solid ?? {};
  const stroke = Array.isArray(style.strokes) ? style.strokes[0] ?? {} : {};
  const strokeSolid = stroke.content?.solid ?? {};
  return {
    text: typeof content.text === 'string' ? content.text : '',
    rich: styles.length > 1,
    size: number(style.size, 8),
    color: rgbToHex(solid.color, '#FFFFFF'),
    alpha: number(solid.alpha, 1),
    bold: style.bold === true,
    italic: style.italic === true,
    underline: style.underline === true,
    letterSpacing: number(material?.letter_spacing, 0) / 0.05,
    lineSpacing: (number(material?.line_spacing, 0.02) - 0.02) / 0.05,
    align: [0, 1, 2].includes(material?.alignment) ? material.alignment : 1,
    vertical: material?.typesetting === 1,
    border: {
      width: number(stroke.width, 0) * 500,
      color: rgbToHex(strokeSolid.color, '#000000'),
      alpha: number(strokeSolid.alpha, 1),
    },
    background: {
      style: material?.background_style === 2 ? 2 : 1,
      color: rgbToHex(material?.background_color, '#000000'),
      alpha: number(material?.background_alpha, 0),
      roundRadius: number(material?.background_round_radius, 0),
      height: number(material?.background_height, 0.14),
      width: number(material?.background_width, 0.14),
      horizontalOffset: number(material?.background_horizontal_offset, 0.5),
      verticalOffset: number(material?.background_vertical_offset, 0.5),
    },
    shadow: {
      enabled: material?.has_shadow === true,
      color: rgbToHex(material?.shadow_color, '#000000'),
      alpha: number(material?.shadow_alpha, 0.9),
      angle: number(material?.shadow_angle, -45),
      distance: number(material?.shadow_distance, 5),
      smoothing: number(material?.shadow_smoothing, 0.45) / 3,
    },
  };
}

// 画布像素空间的文字度量；渲染端再乘画布→显示缩放。
export function textCanvasMetrics(style) {
  const fontSize = Math.max(0.5, style.size * PREVIEW_FONT_SIZE_CALIBRATION);
  return {
    fontSize,
    letterSpacing: style.letterSpacing * PREVIEW_LETTER_SPACING_CALIBRATION,
    lineHeight: Math.max(1, fontSize * PREVIEW_BASE_LINE_HEIGHT + style.lineSpacing * PREVIEW_LINE_SPACING_CALIBRATION),
    padding: PREVIEW_TEXT_PADDING,
  };
}

// 图片/视频先内切画布（contain），与 ImageCanvas/PresetCanvas 的 mediaFit 一致。
export function fitMediaSize(canvas, natural) {
  if (!natural?.width || !natural?.height) return { width: canvas.width, height: canvas.height };
  const fit = Math.min(canvas.width / natural.width, canvas.height / natural.height);
  return { width: natural.width * fit, height: natural.height * fit };
}

export function composeTransform(parent, child) {
  return {
    x: parent.x + child.x * parent.scaleX,
    y: parent.y + child.y * parent.scaleY,
    scaleX: parent.scaleX * child.scaleX,
    scaleY: parent.scaleY * child.scaleY,
    rotation: parent.rotation + child.rotation,
    alpha: parent.alpha * child.alpha,
    flipX: parent.flipX !== child.flipX,
    flipY: parent.flipY !== child.flipY,
  };
}

// 采样片段本地时间下的视觉变换；非法关键帧回退静态值，预览不因脏数据崩溃。
export function sampleVisualTransform(native, type, localTime) {
  const time = Number.isFinite(localTime) && localTime >= 0 ? localTime : 0;
  const read = (key, fallback) => {
    try { return readTemplateProperty(native ?? {}, type, key, time).value; } catch { /* fall through */ }
    try { return readStaticProperty(native ?? {}, type, key); } catch { return fallback; }
  };
  const flip = native?.clip?.flip ?? {};
  return {
    x: read('position_x', 0),
    y: read('position_y', 0),
    scaleX: read('scale_x', 1),
    scaleY: read('scale_y', 1),
    rotation: read('rotation', 0),
    alpha: read('alpha', 1),
    flipX: flip.horizontal === true,
    flipY: flip.vertical === true,
  };
}

const MICRO = 1_000_000;

// 收集当前_scope_在 time（scope 本地秒）下的可见元素，返回自底向顶的渲染顺序。
export function collectPreviewFrame({ model, index, nativeIndex, scopeId = null, time = 0 }) {
  const items = [];
  const audio = [];
  const notices = new Set();
  const times = new Map((model?.timeline ?? []).map(item => [item.id, item]));
  const root = nativeIndex?.get('__root__') ?? {};
  const canvas = {
    width: number(root.canvas_config?.width, 0) || 1080,
    height: number(root.canvas_config?.height, 0) || 1920,
  };
  const cursor = Number.isFinite(time) ? Math.max(0, time) : 0;

  const pushMedia = (segmentNode, timing, offset, inherit, local) => {
    const native = nativeIndex?.get(segmentNode.id) ?? {};
    const material = nativeIndex?.get(native.material_id) ?? {};
    const kind = segmentNode.type;
    const start = offset + timing.localStart;
    const sourceStart = number(timing.sourceStart, number(native.source_timerange?.start, 0) / MICRO);
    if (kind === 'audio') {
      const url = mediaSource(material);
      if (url) audio.push({ id: segmentNode.id, name: segmentNode.name, url, start, duration: timing.duration,
        sourceStart, volume: number(native.volume, 1) });
      else notices.add('音频缺少资源地址，未参与播放');
      return;
    }
    if (kind === 'filter' || kind === 'effect') {
      notices.add('滤镜与特效暂不参与画布预览');
      return;
    }
    const transform = composeTransform(inherit, sampleVisualTransform(native, kind, local));
    const item = {
      id: segmentNode.id, name: segmentNode.name || segmentNode.id, kind,
      url: mediaSource(material), start, duration: timing.duration, sourceStart,
      localTime: local, transform, parentTransform: inherit, material, segment: native,
    };
    if (kind === 'text') {
      item.textStyle = parseTextStyle(material);
      if (item.textStyle.rich) notices.add('多段富文本仅预览首段样式');
    }
    if (kind === 'sticker' && !item.url) notices.add('贴纸缺少资源地址，仅显示占位框');
    if (!item.url && (kind === 'image' || kind === 'video')) notices.add('部分素材缺少资源地址，仅显示占位框');
    items.push(item);
  };

  const walkScene = (sceneNode, baseTime, offset, inherit) => {
    if (!sceneNode) return;
    const tracks = sceneNode.children.filter(node => node.type === 'track')
      .sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));
    const visitSegment = (segmentNode, sceneOffset) => {
      const timing = times.get(segmentNode.id);
      if (!timing || !timing.visible) return;
      const local = baseTime - timing.localStart;
      if (local < 0 || local >= timing.duration) return;
      if (segmentNode.type === 'composition') {
        // 子分镜：时钟相对子分镜，变换递归继承（位置/旋转相加，缩放/不透明度相乘）。
        const sceneTransform = sampleVisualTransform(nativeIndex?.get(segmentNode.id) ?? {}, 'composition', local);
        walkScene(index?.get(segmentNode.id), local, sceneOffset + timing.localStart, composeTransform(inherit, sceneTransform));
        return;
      }
      pushMedia(segmentNode, timing, sceneOffset, inherit, local);
    };
    for (const track of tracks) for (const segmentNode of track.children) visitSegment(segmentNode, offset);
    // 旧 Scene.scenes 写法：放在父级所有轨道之后。
    for (const child of sceneNode.children.filter(node => node.type === 'composition')) visitSegment(child, offset);
  };

  if (scopeId) {
    const scopeNode = index?.get(scopeId);
    const scopeTransform = sampleVisualTransform(nativeIndex?.get(scopeId) ?? {}, 'composition', cursor);
    walkScene(scopeNode, cursor, 0, composeTransform(IDENTITY_TRANSFORM, scopeTransform));
  } else {
    for (const sceneNode of model?.tree ?? []) {
      const timing = times.get(sceneNode.id);
      if (!timing || !timing.visible) continue;
      const local = cursor - timing.localStart;
      if (local < 0 || local >= timing.duration) continue;
      const sceneTransform = sampleVisualTransform(nativeIndex?.get(sceneNode.id) ?? {}, 'composition', local);
      walkScene(sceneNode, local, timing.localStart, composeTransform(IDENTITY_TRANSFORM, sceneTransform));
    }
  }
  return { canvas, items, audio, notices: [...notices] };
}

// Creatomate 式百分秒时间码：mm:ss.cc。
export const formatPreviewTime = (seconds) => {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  const whole = Math.floor(rest);
  const cents = Math.floor((rest - whole) * 100 + 1e-6);
  return `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(cents).padStart(2, '0')}`;
};
