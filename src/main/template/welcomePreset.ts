import type { DraftTemplate, DraftSceneSegment, DraftSegment, DraftKeyframeGroup } from './draftTemplate'
import { WELCOME_ASSETS } from '../../shared/templateWelcomeAssets'

export function welcomeAnimation(id: string, property_type: string, points: number[][]): DraftKeyframeGroup {
  return { id: `${id}-${property_type}`, property_type,
    keyframe_list: points.map(([time_offset, value], index) => ({
      id: `${id}-${property_type}-${index}`, time_offset, values: [value], curveType: 'Line'
    })) }
}

/** Ordinary image/text materials and editable common_keyframes; no vector shapes or preview-only transitions. */
export function createWelcomePreset(): DraftTemplate {
  const template: DraftTemplate = {
    canvas_config: { width: 720, height: 1280 }, duration: 9_500_000,
    materials: { texts: [], videos: [], audios: [] },
    scenes: [{ id: 'welcome-root', name: '个性化欢迎 · VectCut',
      target_timerange: { start: 0, duration: 9_500_000 }, tracks: [] }]
  }
  function scene(id: string, name: string, start: number, duration: number, order: number): DraftSceneSegment {
    const child: DraftSceneSegment = { id, name, type: 'scene',
      target_timerange: { start, duration }, tracks: [],
      ...(start > 0 ? { common_keyframes: [welcomeAnimation(id, 'KFTypeAlpha', [[0, 0], [1_000_000, 1]])] } : {}) }
    template.scenes[0].tracks.push({ id: `${id}-track`, name, type: 'scene', track_relative_index: order, segments: [child] })
    return child
  }
  function segment(scene: DraftSceneSegment, id: string, name: string, type: string, duration: number,
    x = 0, y = 0, order = scene.tracks.length): DraftSegment {
    const clip: DraftSegment = { id, name, material_id: `${id}-material`,
      target_timerange: { start: 0, duration }, clip: { transform: { x, y }, scale: { x: 1, y: 1 }, rotation: 0, alpha: 1 } }
    scene.tracks.push({ id: `${id}-track`, name, type, track_relative_index: order, segments: [clip] })
    return clip
  }
  function image(scene: DraftSceneSegment, id: string, name: string, source: string, duration: number, y = 0) {
    template.materials.videos.push({ id: `${id}-material`, type: 'photo', path: source })
    return segment(scene, id, name, 'video', duration, 0, y)
  }
  function text(scene: DraftSceneSegment, id: string, name: string, value: string, size: number,
    color: string, duration: number, y: number, delay = 0) {
    template.materials.texts.push({ id: `${id}-material`, type: 'text', dynamic: ['content'],
      ...(id === 'welcome-name' ? { editor_role: 'welcome-name' } : {}),
      alignment: 1, line_spacing: 0.02, letter_spacing: 0,
      content: JSON.stringify({ text: value, styles: [{ range: [0, Array.from(value).length],
        size, bold: true, italic: false, underline: false,
        fill: { content: { solid: { color: [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255), alpha: 1 } } } }] }) })
    const clip = segment(scene, id, name, 'text', duration, 0, y)
    clip.common_keyframes = [
      welcomeAnimation(id, 'KFTypeGlobalAlpha', [[0, 0], ...(delay ? [[delay, 0]] : []), [delay + 350_000, 1]]),
      welcomeAnimation(id, 'KFTypePositionY', [[0, y - 0.07], ...(delay ? [[delay, y - 0.07]] : []), [delay + 550_000, y]])
    ]
    return clip
  }
  const intro = scene('welcome-intro', '问候 · 嗨，小明！', 0, 4_500_000, 0)
  image(intro, 'welcome-intro-background', '暖黄背景', WELCOME_ASSETS.yellow, 4_500_000)
  text(intro, 'welcome-name', '你的姓名 · 问候', '嗨，小明！', 52, '#151515', 4_500_000, 0.14, 250_000)
  text(intro, 'welcome-greeting', '欢迎语', '欢迎使用 VectCut 🎉', 42, '#151515', 4_500_000, -0.18, 550_000)

  const middle = scene('welcome-journey', '启程 · 视频创作之旅', 3_500_000, 4_000_000, 1)
  image(middle, 'welcome-journey-background', '创作蓝背景', WELCOME_ASSETS.blue, 4_000_000)
  text(middle, 'welcome-journey-copy', '创作宣言', '从今天开始，\n开启你的视频\n创作之旅 🚀', 43, '#FFFFFF', 4_000_000, 0, 450_000)

  const final = scene('welcome-brand', '品牌 · VectCut', 6_500_000, 3_000_000, 2)
  image(final, 'welcome-brand-background', '纯白背景', WELCOME_ASSETS.white, 3_000_000)
  const logo = image(final, 'welcome-brand-logo', 'VectCut 官方 Logo', WELCOME_ASSETS.logo, 3_000_000, 0.12)
  logo.clip = { transform: { x: 0, y: 0.12 }, scale: { x: 0.34, y: 0.34 }, rotation: 0, alpha: 1 }
  logo.common_keyframes = [
    welcomeAnimation(logo.id, 'UNIFORM_SCALE', [[0, 0.28], [450_000, 0.28], [950_000, 0.36], [1_150_000, 0.34]]),
    welcomeAnimation(logo.id, 'KFTypeAlpha', [[0, 0], [400_000, 0], [850_000, 1]])
  ]
  text(final, 'welcome-brand-name', '品牌名称', 'VectCut', 38, '#151515', 3_000_000, -0.2, 650_000)
  return template
}
