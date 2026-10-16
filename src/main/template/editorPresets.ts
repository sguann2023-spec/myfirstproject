import { isTemplatePresetId } from '../../shared/templatePresets'
import type { DraftTemplate, DraftSceneSegment } from './draftTemplate'

function createMixedTrackPreset(template: DraftTemplate): DraftTemplate {
  delete template.duration
  const scene = template.scenes[0]
  scene.name = '混排演示'
  delete scene.target_timerange.duration
  scene.auto_duration = true
  template.materials.texts = [
    { id: 'mixed-underlay-material', type: 'text',
      content: JSON.stringify({ text: '下层文字：上方混排轨道覆盖本轨道' }), dynamic: ['content'] },
    { id: 'mixed-text-material-1', type: 'text',
      content: JSON.stringify({ text: '同一轨道，图片之后接文字。' }), dynamic: ['content'] },
    { id: 'mixed-text-material-2', type: 'text',
      content: JSON.stringify({ text: '不同类型依次出现，时间不重叠。' }), dynamic: ['content'] }
  ]
  const prompts = [
    'Photorealistic sunlit forest path, lush green trees, soft morning light, detailed nature photography, vertical composition, no text',
    'Photorealistic peaceful mountain lake, calm water reflections, warm sunset light, detailed landscape photography, vertical composition, no text'
  ]
  template.materials.videos = prompts.map((prompt, index) => ({
    id: `mixed-photo-material-${index + 1}`, type: 'photo',
    remote_url: `https://pic1.imgdb.cn/item/68ba8fc058cb8da5c8801ab0.png`,
    dynamic: ['remote_url']
  }))
  scene.tracks = [
    { id: 'mixed-underlay-track', name: '下层 · 持续文字', type: 'text', track_relative_index: 0,
      segments: [{ id: 'mixed-underlay', name: '下层文字', material_id: 'mixed-underlay-material',
        target_timerange: {} }] },
    { id: 'mixed-main-track', name: '上层 · 图片文字混排', type: 'mixed', track_relative_index: 1,
      segments: ['photo', 'text', 'photo', 'text'].map((kind, index) => ({
        id: `mixed-${kind}-${Math.floor(index / 2) + 1}`,
        name: `${kind === 'photo' ? '图片' : '文字'} ${Math.floor(index / 2) + 1}`,
        material_id: `mixed-${kind === 'photo' ? 'photo' : 'text'}-material-${Math.floor(index / 2) + 1}`,
        target_timerange: { ...(index === 1 ? {} : { start: index * 4_000_000 }), duration: 4_000_000 },
        ...(index === 1 ? { auto_timing: { start: { target: 'mixed-photo-1', anchor: 'end' as const } } } : {}),
        dynamic: index === 1 ? ['target_timerange.duration'] : ['target_timerange.start', 'target_timerange.duration']
      })) }
  ]
  return template
}

export function createEditorPreset(presetId: unknown = 'empty'): DraftTemplate {
  if (!isTemplatePresetId(presetId)) throw new Error('不支持的模版')
  const template: DraftTemplate = {
    canvas_config: { width: 720, height: 1280 },
    duration: 15_000_000,
    materials: { videos: [], texts: [], audios: [] },
    scenes: [{
      id: 'scene-1', name: presetId === 'empty' ? '分镜 1' : '一句一图',
      target_timerange: { start: 0, duration: 15_000_000 },
      tracks: []
    }]
  }
  if (presetId === 'empty') return template
  if (presetId === 'mixed-track') return createMixedTrackPreset(template)
  const sentences = [
    { text: '清晨，阳光洒进安静的房间。',
      prompt: 'Photorealistic cozy room at sunrise, warm sunlight through linen curtains, wooden floor, natural light, editorial interior photography, vertical composition, no text' },
    { text: '走出家门，沿着林间小路慢慢前行。',
      prompt: 'Photorealistic quiet forest walking path, lush green trees, soft morning sun rays, tranquil atmosphere, detailed nature photography, vertical composition, no text' },
    { text: '在湖边停下，感受此刻的宁静。',
      prompt: 'Photorealistic peaceful lake with distant mountains, soft morning light, calm water reflections, serene landscape photography, vertical composition, no text' }
  ]
  const scene = template.scenes[0]
  delete template.duration
  delete scene.target_timerange.start
  delete scene.target_timerange.duration
  scene.auto_duration = true
  scene.tracks = [{ id: 'sentence-scenes', name: '一句一图 · 子分镜', type: 'mixed', segments: [] }]
  sentences.forEach(({ text, prompt }, index) => {
    const number = index + 1
    const textId = `text-${number}`
    template.materials.texts.push({
      id: `text-material-${number}`, type: 'text', content: JSON.stringify({ text }),
      dynamic: ['content']
    })
    template.materials.videos.push({
      id: `image-material-${number}`, type: 'photo',
      remote_url: `https://pic1.imgdb.cn/item/68ba8fc058cb8da5c8801ab0.png`,
      dynamic: ['remote_url']
    })
    const child: DraftSceneSegment = {
      id: `sentence-scene-${number}`, name: `第 ${number} 组 · 一句一图`, type: 'scene',
      auto_duration: true, target_timerange: number === 1 ? { start: 0 } : {},
      ...(number > 1 ? { auto_timing: { start: { target: `sentence-scene-${number - 1}`, anchor: 'end' } } } : {}),
      tracks: []
    }
    child.tracks.push({
      id: `text_track_${number}`, name: `文字 ${number}`, type: 'text',
      track_relative_index: 1,
      segments: [{
        id: textId, name: `第 ${number} 句话`, material_id: `text-material-${number}`,
        target_timerange: { start: 0, duration: 5_000_000 },
        dynamic: ['target_timerange.start', 'target_timerange.duration']
      }]
    })
    child.tracks.push({
      id: `image_track_${number}`, name: `图片 ${number}`, type: 'video',
      track_relative_index: 0,
      segments: [{
        id: `image-${number}`, name: `第 ${number} 张图片`, material_id: `image-material-${number}`,
        target_timerange: {},
        auto_timing: {
          start: { target: textId, anchor: 'start' },
          end: { target: textId, anchor: 'end' }
        }
      }]
    })
    scene.tracks[0].segments.push(child)
  })
  return template
}
