#!/usr/bin/env node
/**
 * plan.mjs —— 本地生活团购促销片：spec.json → 完整 MCP 调用计划（确定性装配器）
 *
 *   node scripts/plan.mjs <spec.json> > plan.json
 *   node scripts/plan.mjs <spec.json> --table     # 只看时间轴与自检结果
 *
 * 输出 { calls:[{tool,args}], timeline:[...], self_check:{...} }
 * 模型只负责填 spec（素材 URL、文案、ASR 字级时间戳），不再手算坐标/字号/阴影。
 * 所有常量都是预渲染实测标定值，改之前先读 references/parameters.md。
 */
import { readFileSync } from "node:fs";

// —————————————————————————— 标定常量（勿凭感觉改）——————————————————————————
export const W = 1080, H = 1920;
export const TY = (yPx) => Math.round((H / 2 - yPx) * 2); // 系数 0.5，不是像素
export const TX = (xPx) => Math.round((xPx - W / 2) * 2);

export const ANCHOR = { titleY: 180, promoY: 1150, noteY: 1345, subY: 1430, arrowX: 185, arrowY: 1180 };

// 字号：12 号 ≈ 满屏宽。以下仅为已验证回退值；本次字体/模版选择来自 prerender_calibration。
export const SIZE = { title: 13, sub: 9, promoMax: 23, promoMid: 17, note: 6.5 };
export const FONT_FALLBACK = { title: "汉仪英雄体", sub: "抖音美好体", promo: "霸燃手书", note: "抖音美好体" };
export const COLOR = { white: "#FFFFFF", red: "#E8000D", black: "#000000", yellow: "#FFE600", brown: "#7A2E00" };
export const TPL_FALLBACK = { opener: "8386843559160502412", price: null, cta: "8598293479899663030" };
export const ARROW_SCALE = 0.20; // 倍数，写 20 会白屏

// v2 硬规则：所有手调文字层必带阴影（模版层不加，会和模版自带描边打架）
export const shadow = (a, d, ang = 45) => ({
  shadow_enabled: true, shadow_color: COLOR.black, shadow_alpha: a,
  shadow_distance: d, shadow_angle: ang, shadow_smoothing: 0.3,
});

const T = (s) => `mcp__vectcut__draft-elements__${s}`;

// —————————————————————————— 层与音轨表 ——————————————————————————
export function buildLayers(c, t, rc) {
  const base = { width: W, height: H, align: 1 };
  const fonts = { ...FONT_FALLBACK, ...(rc.fonts || {}) };
  const templates = { ...TPL_FALLBACK, ...(rc.templates || {}) };
  const scales = { opener: 1.0, price: null, cta: null, ...(rc.scales || {}) };
  let tplN = 0, addN = 0;
  const promos = t.promos.map((p) => {
    // 价格爆点是强制模版层；由头可用本次选中的模版，其余加码保持普通文字。
    const templateId = p.max ? templates.price : (p.tpl ? (templates.opener || p.tpl) : null);
    const track = p.max ? "促销爆点" : templateId ? `花字${++tplN}` : `促销加码${++addN}`;
    if (p.max && !templateId) throw new Error("价格爆点必须使用预渲染选中的剪映文字模版：缺少 prerender_calibration.templates.price");
    return { track, range: p.range,
      kind: templateId ? "template" : "text", template_id: templateId, texts: templateId ? [p.text] : undefined,
      args: templateId
        ? { transform_y_px: TY(ANCHOR.promoY), transform_x_px: 0,
            scale_x: p.max ? scales.price : scales.opener, scale_y: p.max ? scales.price : scales.opener, ...base }
        : { text: p.text, font: fonts.promo, font_size: SIZE.promoMid,
            font_color: COLOR.yellow, border_color: COLOR.brown, border_width: 9, border_alpha: 1,
            ...shadow(0.55, 8, 90), transform_y_px: TY(ANCHOR.promoY), rotation: -6,
            intro_animation: "波浪弹入", intro_duration: 0.35, ...base } };
  });

  return [
    { track: "顶部标题", range: [0, t.end], kind: "text", args: {
        text: c.店名, font: fonts.title, font_size: SIZE.title,
        font_color: COLOR.white, border_color: COLOR.red, border_width: 6, border_alpha: 1,
        ...shadow(0.5, 5), transform_y_px: TY(ANCHOR.titleY),
        intro_animation: "向上露出", intro_duration: 0.4, ...base } },

    ...t.subs.map((s, i) => ({ track: `字幕${i + 1}`, range: s.range, kind: "text", args: {
        text: s.text, font: fonts.sub, font_size: SIZE.sub,
        font_color: COLOR.white, border_color: COLOR.black, border_width: 5, border_alpha: 1,
        ...shadow(0.55, 5), transform_y_px: TY(ANCHOR.subY),
        intro_animation: "渐显", intro_duration: 0.2, ...base } })),

    ...promos,

    { track: "规则小字", range: t.noteRange, kind: "text", args: {
        text: c.规则小字, font: fonts.note, font_size: SIZE.note,
        font_color: COLOR.white, border_color: COLOR.black, border_width: 4, border_alpha: 1,
        ...shadow(0.55, 4), transform_y_px: TY(ANCHOR.noteY), line_spacing: 8,
        intro_animation: "渐显", intro_duration: 0.25, ...base } },

    { track: "箭头", range: t.noteRange, kind: "image", args: {
        scale_x: ARROW_SCALE, scale_y: ARROW_SCALE, rotation: 14,
        transform_x_px: TX(ANCHOR.arrowX), transform_y_px: TY(ANCHOR.arrowY), ...base } },

    { track: "结尾CTA", range: t.ctaRange, kind: "template", template_id: templates.cta, texts: [c.CTA],
      args: { transform_y_px: TY(ANCHOR.promoY), transform_x_px: 0,
              scale_x: scales.cta, scale_y: scales.cta, ...base } },
  ];
}

/** volume 当前API单位dB，人物对白+20dB；导出检查线性10 */
export function buildAudios(a, t) {
  const list = [
    { track: "人物原生对白", url: a.dialogue, target_start: 0, duration: t.end, fade_in_duration: 0, fade_out_duratioin: 0 },
    { track: "BGM", url: a.bgm, target_start: 0, duration: t.end, fade_in_duration: 0.3, fade_out_duratioin: 0.6 },
    { track: "品类环境声", url: a.ambient, target_start: 0, duration: t.end, fade_in_duration: 0.5, fade_out_duratioin: 0.8 },
  ];
  if (!a.ambient) list.splice(2, 1);
  (t.whooshAt || []).forEach((s, i) => list.push({ track: `SFX_whoosh${i + 1}`, url: a.whoosh, target_start: s, duration: 0.6, fade_in_duration: 0, fade_out_duratioin: 0 }));
  (t.popAt || []).forEach((s, i) => list.push({ track: `SFX_pop${i + 1}`, url: a.pop, target_start: s, duration: 0.4, fade_in_duration: 0, fade_out_duratioin: 0 }));
  (t.dingAt || []).forEach((s, i) => list.push({ track: `SFX_ding${i + 1}`, url: a.ding, target_start: s, duration: 1.1, fade_in_duration: 0, fade_out_duratioin: 0 }));
  return list;
}

// —————————————————————————— 计划生成 ——————————————————————————
export function plan(spec) {
  const { draft_id: id, assets: a, copy: c, timing: t } = spec;
  const rc = spec.prerender_calibration || {};
  if (!rc.templates?.price || !Number.isFinite(Number(rc.scales?.price)) || Number(rc.scales.price) <= 0) {
    throw new Error("缺少价格爆点模版标定：先预渲染比较文字模版，再填写 prerender_calibration.templates.price 与 scales.price");
  }
  if (!rc.templates?.cta || !Number.isFinite(Number(rc.scales?.cta)) || Number(rc.scales.cta) <= 0) {
    throw new Error("缺少 CTA 标定：先预渲染比较候选效果，再填写 prerender_calibration.templates.cta 与 scales.cta");
  }
  if (!["audio_reference_dialogue", "native_dialogue"].includes(spec.audio_mode) || spec.dialogue_verified !== true || spec.lip_sync_verified !== true)
    throw new Error("必须验收音频参考驱动的出镜对白和口型，不能后配旁白冒充");
  const clips = spec.clips;
  if (!Array.isArray(clips) || !clips.length) throw new Error("缺少按完整对白裁切的 clips");
  const calls = [];
  const layers = buildLayers(c, t, rc);
  for (const [i, clip] of clips.entries()) calls.push({ step: `video${i+1}`, tool: T("add_video"), args: {
    draft_id: id, video_url: clip.url, target_start: clip.target_start, duration: clip.duration,
    width: W, height: H, volume: 0, track_name: "主视频" } });
  // 上面必须使用预裁切的静音副本；同步原声已独立抽取，不依赖 volume 静音。

  // 2) 文字 / 贴片（箭头放最后加，保证 z-order 在最上）
  const sorted = layers.filter((x) => x.kind !== "image");
  for (const L2 of [...sorted, ...layers.filter((x) => x.kind === "image")]) {
    const [s, e] = L2.range;
    const common = { draft_id: id, start: s, end: e, track_name: L2.track, width: W, height: H };
    if (L2.kind === "image") calls.push({ step: L2.track, tool: T("add_image"), args: { draft_id: id, image_url: a.arrow, start: s, end: e, track_name: L2.track, width: W, height: H, ...L2.args } });
    else if (L2.kind === "template") calls.push({ step: L2.track, tool: T("add_text_template"), args: { ...common, template_id: L2.template_id, texts: L2.texts, ...L2.args } });
    else calls.push({ step: L2.track, tool: T("add_text"), args: { ...common, ...L2.args } });
  }

  // 3) 音频
  for (const A of buildAudios(a, t)) calls.push({ step: A.track, tool: T("add_audio"), args: {
    draft_id: id, audio_url: A.url, target_start: A.target_start, duration: A.duration, track_name: A.track,
    volume: A.track === "人物原生对白" ? 20 : 0, fade_in_duration: A.fade_in_duration, fade_out_duratioin: A.fade_out_duratioin } });

  return { calls, layers, audios: buildAudios(a, t), self_check: check(spec) };
}

// 自检：装配前挡住必然翻车的写法
export function check({ assets: a, timing: t, copy: c, prerender_calibration: rc, clips }) {
  const bad = [], url = (x, n) => { if (!/^https?:/.test(x || "")) bad.push(`${n} 不是云端 URL（本地路径会写坏素材记录）`); };
  ["arrow","dialogue","bgm","whoosh","ding","pop"].forEach((k) => url(a[k], k));
  let cursor = 0;
  for (const clip of clips || []) {
    url(clip.url, "clip");
    if (!Number.isFinite(clip.target_start) || !Number.isFinite(clip.duration) || clip.duration <= 0 || Math.abs(clip.target_start-cursor)>0.02) bad.push("画面片段必须无缝、时长为正并与原声同剪辑清单");
    cursor = clip.target_start + clip.duration;
  }
  if (Math.abs(cursor-t.end)>0.02) bad.push("画面与原声总时长不一致");
  if (!Array.isArray(rc?.candidates) || rc.candidates.length < 2) bad.push("至少需要预渲染比较两套文字设计候选");
  if (!rc?.templates?.price) bad.push("价格爆点缺少剪映文字模版");
  if (!rc?.fonts?.title || !rc?.fonts?.sub || !rc?.fonts?.note) bad.push("缺少预渲染选中的标题/字幕/小字字体");
  if (!rc?.prerender_verified) bad.push("整套文字设计尚未通过真实背景预渲染验证");
  const promos = [...t.promos, { range: t.ctaRange }];
  for (let i = 0; i < promos.length; i++) for (let j = i + 1; j < promos.length; j++) {
    const [a1, b1] = promos[i].range, [a2, b2] = promos[j].range;
    if (a1 < b2 - 0.01 && a2 < b1 - 0.01) bad.push(`爆点重叠：${promos[i].text ?? "CTA"} / ${promos[j].text ?? "CTA"}`);
  }
  if ((c.规则小字 || "").split("\n").length > 2) bad.push("规则小字超过 2 行");
  if (t.end > 5) bad.push("（提醒）正片 >5s，render_draft 不能渲染全片，另建 <=5s 预览草稿");
  return bad;
}

const file = process.argv[2];
if (!file) { console.error("usage: node plan.mjs <spec.json> [--table]"); process.exit(2); }
const spec = JSON.parse(readFileSync(file, "utf8"));
const out = plan(spec);
if (process.argv.includes("--table")) {
  const rows = out.layers.map((l) => `${l.track.padEnd(10)} ${l.range[0].toFixed(2)}→${l.range[1].toFixed(2)}  ${l.kind.padEnd(9)} ${l.args.text || (l.texts || []).join("")}`);
  console.log(rows.join("\n"));
  console.log("\n自检：", out.self_check.length ? out.self_check : "PASS");
} else console.log(JSON.stringify(out, null, 2));
