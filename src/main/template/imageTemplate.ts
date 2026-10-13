export const IMAGE_TEMPLATE_ID = '20007c76-1086-4d74-9366-c11b1adde6e8'

export const exampleImageTemplate = {
  output_format: 'mp4',
  gif_quality: 'best',
  gif_compression: 100,
  width: 720,
  height: 1280,
  duration: 9.5,
  snapshot_time: 3.18,
  emoji_style: 'apple',
  fill_color: '#ffffff',
  elements: [{
    id: IMAGE_TEMPLATE_ID,
    name: 'Image-TSS',
    type: 'image',
    track: 1,
    source: '/Users/sunguannan/Downloads/tmp4uu0of5p.png'
  }]
}

function seconds(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name}必须是大于或等于 0 的秒数`)
  }
  return value
}

export function compileImageTemplate(
  template: typeof exampleImageTemplate,
  input: { source?: string; start?: number; end?: number } = {}
) {
  if (!template || !Array.isArray(template.elements) || template.elements.length !== 1) {
    throw new Error('首版仅支持一个图片元素')
  }
  const image = template.elements[0] as typeof exampleImageTemplate.elements[0] & {
    time?: number; duration?: number
  }
  if (image.type !== 'image') throw new Error('首版仅支持图片元素')
  const allowed = new Set(['id', 'name', 'type', 'track', 'source', 'time', 'duration'])
  for (const key of Object.keys(image)) {
    if (!allowed.has(key)) throw new Error(`暂不支持图片属性：${key}`)
  }
  for (const dimension of [template.width, template.height]) {
    if (!Number.isInteger(dimension) || dimension <= 0) throw new Error('画布尺寸必须是正整数')
  }
  const total = seconds(template.duration, '模版时长')
  const start = seconds(input.start === undefined ? image.time ?? 0 : input.start, '开始时间')
  const end = seconds(input.end === undefined ? (image.duration == null ? total : start + image.duration) : input.end, '结束时间')
  if (end <= start) throw new Error('结束时间必须大于开始时间')
  if (end > total) throw new Error('结束时间不能超过模版时长')
  const source = (input.source ?? image.source)?.trim()
  if (!source) throw new Error('请输入或选择一张图片')
  const renderScript = {
    ...template,
    elements: [{ ...image, source, time: start, duration: end - start }]
  }
  return {
    template: renderScript,
    workflow: {
      width: template.width,
      height: template.height,
      inputs: {},
      script: [{
        type: 'action',
        id: image.id,
        index: 0,
        action_type: 'add_image',
        params: {
          image_url: source,
          start,
          end,
          width: template.width,
          height: template.height,
          track_name: image.name || 'image_main',
          relative_index: 0
        }
      }]
    },
    warnings: [
      '当前只生成图片草稿操作，背景色和导出设置不参与 workflow 执行。',
      '图片按后端默认布局显示，尚未适配 Creatomate 的裁剪和填充规则。'
    ]
  }
}
