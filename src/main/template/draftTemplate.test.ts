import { describe, expect, it } from 'vitest'
import { analyzeDraftTemplate, compileDraftTemplate, normalizeDraftTemplate, wrapDraftAsTemplate, type DraftTemplate } from './draftTemplate'
import { addEditorElement, analyzeEditorDocument, compileEditorDocument, editorInitialTemplate } from './editorModel'

const fixture = () => structuredClone(editorInitialTemplate)
const payload = (template = fixture()) => ({ templateJson: JSON.stringify(template) })
const image = (template: DraftTemplate) => template.scenes[0].tracks[1].segments[0]

describe('Scene 包裹剪映草稿轨道', () => {
  it('全局素材引用，跨轨道双端对齐，编译不修改输入', () => {
    const template = fixture()
    const before = structuredClone(template)
    const result = compileDraftTemplate(template)
    expect(result.template).toEqual(before)
    expect(template).toEqual(before)
    expect(result.workflow.script.find(({ id }) => id === 'image-1')!.params)
      .toMatchObject({ start: 9.2838, end: 21.6308, track_name: 'image_main', relative_index: 15002 })
    expect(analyzeEditorDocument(payload(template)).timeline).toEqual(result.timeline)
    expect(compileEditorDocument(payload(template)).template).toEqual(template)
  })

  it('parent.end 单独锚定结束，保持固定时长并跟随 Scene', () => {
    const template = fixture()
    image(template).auto_timing = { end: { target: 'parent', anchor: 'end' } }
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'image-1'))
      .toMatchObject({ start: 13.9778, end: 21.6308 })
    template.scenes[0].target_timerange.duration = 10_000_000
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'image-1'))
      .toMatchObject({ start: 2.347, end: 10 })
  })

  it('仅 start 保留时长，省略时长填充 Scene；仅 end 反推开始', () => {
    const template = fixture()
    delete image(template).auto_timing!.end
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'image-1'))
      .toMatchObject({ start: 9.2838, end: 16.9368 })
    delete image(template).target_timerange.duration
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'image-1'))
      .toMatchObject({ start: 9.2838, end: 21.6308 })
    image(template).auto_timing = { end: { target: 'text-2', anchor: 'end' } }
    image(template).target_timerange.duration = 5_000_000
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'image-1'))
      .toMatchObject({ start: 16.6308, end: 21.6308 })
  })

  it('嵌套 Scene 按声明区间计算，根截断推进媒体源裁切', () => {
    const template: DraftTemplate = {
      canvas_config: { width: 720, height: 1280 }, duration: 10_000_000,
      materials: { videos: [{ id: 'media', type: 'video', path: '/tmp/video.mp4' }] },
      scenes: [{
        id: 'outer', target_timerange: { start: 3_000_000, duration: 10_000_000 }, tracks: [],
        scenes: [{
          id: 'inner', target_timerange: { duration: 12_000_000 },
          auto_timing: { end: { target: 'parent', anchor: 'end' } },
          tracks: [{ id: 'video-track', type: 'video', segments: [{
            id: 'video', material_id: 'media', target_timerange: { start: 0, duration: 12_000_000 },
            source_timerange: { start: 4_000_000, duration: 12_000_000 }
          }] }]
        }]
      }]
    }
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'video'))
      .toMatchObject({ start: 3, end: 10, sourceStart: 6, sourceEnd: 13 })
    expect(() => compileDraftTemplate(template)).toThrow('暂不支持元素类型')
  })

  it('自动开始覆盖冗余 end，不被草稿原 end 缩短', () => {
    const template = fixture()
    image(template).target_timerange = { start: 0, duration: 5_000_000, end: 5_000_000 }
    image(template).auto_timing = { start: { target: 'text-2', anchor: 'start' } }
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'image-1'))
      .toMatchObject({ start: 9.2838, end: 14.2838 })
  })

  it('拒绝循环、跨 Scene 引用、微秒非法值及不一致区间', () => {
    const template = fixture()
    image(template).auto_timing!.end = { target: 'image-1', anchor: 'end' }
    expect(() => analyzeDraftTemplate(template)).toThrow('循环')
    const next = fixture()
    next.scenes.push({ id: 'next', target_timerange: { start: 0, duration: 5_000_000 }, tracks: [] })
    image(next).auto_timing!.start = { target: 'next', anchor: 'start' }
    expect(() => analyzeDraftTemplate(next)).toThrow('同一父级')
    const invalid = fixture()
    image(invalid).target_timerange.start = 'end' as unknown as number
    expect(() => normalizeDraftTemplate(invalid)).toThrow('整数微秒')
    image(invalid).target_timerange = { start: 0, duration: 5_000_000, end: 6_000_000 }
    expect(() => normalizeDraftTemplate(invalid)).toThrow('不一致')
  })

  it('素材及轨道类型检查，未知特效明确拒绝', () => {
    const template = fixture()
    image(template).material_id = 'missing'
    expect(() => analyzeDraftTemplate(template)).toThrow('material_id')
    image(template).material_id = 'title-1'
    expect(() => analyzeDraftTemplate(template)).toThrow('素材类型')
    template.scenes[0].tracks[1].type = 'unknown'
    expect(() => analyzeDraftTemplate(template)).toThrow('轨道类型')
  })

  it('添加四类素材进入选中 Scene，采用原生引用且不修改输入', () => {
    for (const type of ['text', 'image', 'video', 'audio'] as const) {
      const input = payload()
      const added = addEditorElement(input, { type, selectedId: 'text-1', source: '/tmp/media' })
      const draft = JSON.parse(added.templateJson) as DraftTemplate
      const track = draft.scenes[0].tracks.at(-1)!
      expect(track.segments[0]).toMatchObject({ id: added.selectedId, target_timerange: { start: 0 } })
      expect(Object.values(draft.materials).flat().some(({ id }) => id === track.segments[0].material_id)).toBe(true)
      expect(analyzeEditorDocument({ templateJson: added.templateJson }).timeline.find(({ id }) => id === added.selectedId))
        .toMatchObject({ start: 0, end: 21.6308 })
      expect(input).toEqual(payload())
    }
  })

  it('贴纸滤镜特效添加、层级与跨轨对齐可用，但执行明确拒绝', () => {
    for (const [type, bucket, materialType] of [
      ['sticker', 'stickers', 'sticker'], ['filter', 'effects', 'filter'], ['effect', 'video_effects', 'video_effect']
    ] as const) {
      const input = payload()
      const added = addEditorElement(input, { type, selectedId: 'text-1' })
      const draft = JSON.parse(added.templateJson) as DraftTemplate
      const track = draft.scenes[0].tracks.at(-1)!
      const segment = track.segments[0]
      expect(track.type).toBe('mixed')
      expect(draft.materials[bucket][0]).toMatchObject({ id: segment.material_id, type: materialType, resource_id: '' })
      segment.target_timerange.duration = 5_000_000
      segment.auto_timing = { start: { target: 'text-2', anchor: 'start' }, end: { target: 'text-2', anchor: 'end' } }
      const model = analyzeEditorDocument(payload(draft))
      expect(model.timeline.find(({ id }) => id === segment.id)).toMatchObject({ type, start: 9.2838, end: 21.6308 })
      expect(model.tree[0].children.find((node) => node.id === track.id)!.children[0]).toMatchObject({ id: segment.id, type })
      expect(model.rows.flatMap(({ clips }) => clips).find(({ id }) => id === segment.id)).toMatchObject({ type })
      expect(() => compileEditorDocument(payload(draft))).toThrow('暂未支持 Workflow 执行')
      draft.materials[bucket][0].type = 'text_effect'
      expect(() => analyzeEditorDocument(payload(draft))).toThrow('素材类型')
      expect(input).toEqual(payload())
    }
  })

  it('原生草稿只在 tracks 外包装 Scene，所有原字段保留且独立复制', () => {
    const template = fixture()
    const native = { canvas_config: template.canvas_config, materials: template.materials,
      duration: 21_630_800, tracks: template.scenes[0].tracks, config: { original: true } }
    const wrapped = wrapDraftAsTemplate(native)
    expect(wrapped).not.toHaveProperty('tracks')
    expect(wrapped.scenes[0].tracks).toEqual(native.tracks)
    expect(wrapped.config).toEqual(native.config)
    wrapped.materials.videos[0].path = '/changed'
    expect(native.materials.videos[0].path).not.toBe('/changed')
  })

  it('关键帧保持原生配置与偏移，自动对齐不改写，导出明确拒绝', () => {
    const template = fixture()
    image(template).common_keyframes = [{
      id: 'scale-group', property_type: 'KFTypeScaleY', material_id: '',
      keyframe_list: [
        { id: 'kf-0', time_offset: 0, values: [1], curveType: 'Line' },
        { id: 'kf-1', time_offset: 1_000_000, values: [1.5], curveType: 'Line' }
      ]
    }]
    const before = structuredClone(template)
    expect(normalizeDraftTemplate(template).hasKeyframes).toBe(true)
    expect(analyzeDraftTemplate(template).timeline.find(({ id }) => id === 'image-1'))
      .toMatchObject({ start: 9.2838, end: 21.6308 })
    expect(template).toEqual(before)
    expect(() => compileDraftTemplate(template)).toThrow('关键帧')
    const added = addEditorElement(payload(template), { type: 'text', selectedId: 'scene-1' })
    expect(image(JSON.parse(added.templateJson)).common_keyframes).toEqual(image(template).common_keyframes)
    image(template).common_keyframes![0].keyframe_list[1].time_offset = 0
    expect(() => analyzeDraftTemplate(template)).toThrow('严格递增')
    image(template).common_keyframes![0].keyframe_list[1].time_offset = 1_000_000
    image(template).common_keyframes![0].keyframe_list[1].values = []
    expect(() => analyzeDraftTemplate(template)).toThrow('values')
    delete image(template).common_keyframes
    image(template).keyframe_refs = ['external-kf']
    expect(() => compileDraftTemplate(template)).toThrow('关键帧')
  })
})
