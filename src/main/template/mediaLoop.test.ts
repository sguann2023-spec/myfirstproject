import { expect, it } from 'vitest'
import { compileDraftTemplate, type DraftTemplate } from './draftTemplate'
import { compileSceneTemplate } from './sceneTemplate'
import { mediaLoopSlices, MAX_MEDIA_LOOP_ACTIONS } from './mediaLoop'

function fixture(type: 'audio' | 'video'): DraftTemplate {
  return {
    canvas_config: { width: 720, height: 1280 },
    materials: { [type === 'audio' ? 'audios' : 'videos']: [{
      id: 'source', type, path: `/tmp/source.${type === 'audio' ? 'mp3' : 'mp4'}`, duration: 8_000_000
    }] },
    scenes: [{ id: 'scene', target_timerange: { duration: 5_000_000 }, tracks: [{
      id: 'media-track', type, track_relative_index: 3, segments: [{
        id: 'media', material_id: 'source', loop: true,
        target_timerange: { start: 0, duration: 5_000_000 },
        source_timerange: { start: 1_000_000, duration: 2_000_000 }
      }]
    }] }]
  }
}
for (const type of ['audio', 'video'] as const) {
  it(`${type} 循环按源区间拆分且末段裁切，轨道和媒体地址不变`, () => {
    const draft = fixture(type)
    const original = structuredClone(draft)
    const actions = compileDraftTemplate(draft).workflow.script
    expect(actions).toHaveLength(3)
    expect(actions.map(action => action.params)).toMatchObject([
      { target_start: 0, start: 1, end: 3, duration: 2 },
      { target_start: 2, start: 1, end: 3, duration: 2 },
      { target_start: 4, start: 1, end: 2, duration: 1 }
    ])
    expect(new Set(actions.map(action => action.params?.track_name)).size).toBe(1)
    expect(new Set(actions.map(action => action.id)).size).toBe(3)
    expect(actions.every(action => action.params?.[`${type}_url`] === `/tmp/source.${type === 'audio' ? 'mp3' : 'mp4'}`)).toBe(true)
    if (type === 'audio') expect(actions.every(action => action.params?.relative_index === undefined)).toBe(true)
    expect(draft).toEqual(original)
  })
}

it('父级左裁切保持循环相位，而不是从源片段头重新开始', () => {
  const draft = fixture('video')
  draft.scenes[0].target_timerange.duration = 4_000_000
  const segment = draft.scenes[0].tracks[0].segments[0]
  segment.target_timerange = { duration: 9_000_000 }
  segment.auto_timing = { end: { target: 'parent', anchor: 'end' } }
  const result = compileDraftTemplate(draft)
  expect(result.workflow.script.map(action => action.params)).toMatchObject([
    { target_start: 0, start: 2, end: 3, duration: 1 },
    { target_start: 1, start: 1, end: 3, duration: 2 },
    { target_start: 3, start: 1, end: 2, duration: 1 }
  ])
  expect(result.timeline.find(item => item.id === 'media')).toMatchObject({ sourceStart: 2, sourceEnd: 3 })
})

it('十进制时间在整数微秒上分段，整轮边界不多出一段', () => {
  expect(mediaLoopSlices(0, .6, 0, 1, .2)).toEqual([
    { target_start: 0, start: 1, end: 1.2, duration: .2 },
    { target_start: .2, start: 1, end: 1.2, duration: .2 },
    { target_start: .4, start: 1, end: 1.2, duration: .2 }
  ])
})

it('缺少源时长不猜测循环区间，不接受图片循环', () => {
  const draft = fixture('video')
  delete draft.materials.videos[0].duration
  delete draft.scenes[0].tracks[0].segments[0].source_timerange
  expect(() => compileDraftTemplate(draft)).toThrow('源时长')
  expect(() => compileSceneTemplate({
    width: 720, height: 1280, duration: 5,
    elements: [{ id: 'image', type: 'image', source: '/tmp/image.png', duration: 5, loop: true }]
  })).toThrow('loop')
})

it('超大循环次数明确拒绝，不生成无限动作', () => {
  expect(() => mediaLoopSlices(0, MAX_MEDIA_LOOP_ACTIONS + 1, 0, 0, 1)).toThrow('10000')
})

it('生成的循环动作 ID 不与其他真实元素重名', () => {
  const result = compileSceneTemplate({
    width: 720, height: 1280, duration: 5, elements: [
      { id: 'media', type: 'audio', source: '/tmp/source.mp3', duration: 5, source_duration: 2, loop: true, track: 1 },
      { id: 'media__loop_1', type: 'text', text: '独立文案', duration: 1, track: 2 }
    ]
  })
  expect(new Set(result.workflow.script.map(action => action.id)).size).toBe(4)
})
