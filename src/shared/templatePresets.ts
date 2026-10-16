export const TEMPLATE_PRESETS = [
  { id: 'empty', name: '空白模版', description: 'Empty template · 从零开始添加素材' },
  { id: 'sentence-image', name: '一句一图', description: '每个子分镜一句一图，图片与文字同步，分镜自动串联' },
  { id: 'mixed-track', name: '混排演示', description: '同轨图片与文字交替出现，演示混排与上下层级' }
] as const

export type TemplatePresetId = typeof TEMPLATE_PRESETS[number]['id']

export function isTemplatePresetId(value: unknown): value is TemplatePresetId {
  return TEMPLATE_PRESETS.some((preset) => preset.id === value)
}
