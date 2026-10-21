import type { TemplateWorkflow, WorkflowStep } from './workflowTypes'
import type { DraftTemplate } from './draftTemplate'
import { createEditorPreset } from './editorPresets'
import { isSceneSegment } from './draftTracks'

// Keep fixed, flat timing coverage independent from the nested built-in preset.
export function flatSentenceImageFixture(): DraftTemplate {
  const template = createEditorPreset('sentence-image')
  const scene = template.scenes[0]
  const children = scene.tracks[0].segments.filter(isSceneSegment)
  scene.tracks = children.flatMap((child, index) => child.tracks.map((track) => {
    track.track_relative_index = track.type === 'text' ? children.length + index : index
    if (track.type === 'text') {
      track.segments[0].target_timerange.start = index * 5_000_000
      track.segments[0].dynamic = ['target_timerange.start', 'target_timerange.duration']
    }
    return track
  }))
  scene.auto_duration = false
  scene.target_timerange.duration = 15_000_000
  template.duration = 15_000_000
  return template
}

export function mixedTrackFixture(): DraftTemplate {
  return {
    canvas_config: { width: 720, height: 1280 }, duration: 8_000_000,
    materials: {
      videos: [{ id: 'photo', type: 'photo', path: '/tmp/photo.png' },
        { id: 'movie', type: 'video', path: '/tmp/movie.mp4' }],
      texts: [{ id: 'title', type: 'text', content: JSON.stringify({ text: '一句话' }) }],
      audios: [{ id: 'sound', type: 'extract_music', path: '/tmp/sound.wav' }]
    },
    scenes: [{
      id: 'scene', name: '混排分镜', target_timerange: { duration: 8_000_000 },
      tracks: [{ id: 'mixed', name: '混排轨道', type: 'mixed', segments: [
        { id: 'image', material_id: 'photo', target_timerange: { start: 0, duration: 2_000_000 } },
        { id: 'text', material_id: 'title', target_timerange: { start: 2_000_000, duration: 2_000_000 } },
        { id: 'audio', material_id: 'sound', target_timerange: { start: 4_000_000, duration: 2_000_000 },
          source_timerange: { start: 1_000_000 } },
        { id: 'video', material_id: 'movie', target_timerange: { start: 6_000_000, duration: 2_000_000 },
          source_timerange: { start: 3_000_000 } }
      ] }]
    }]
  }
}

export function workflowActions(workflow: TemplateWorkflow): Array<WorkflowStep & { params: Record<string, unknown> }> {
  return workflow.script.flatMap(function collect(step): Array<WorkflowStep & { params: Record<string, unknown> }> {
    if (step.type === 'action') {
      const params = { ...step.params }
      for (const [key, value] of Object.entries(params)) {
        const match = typeof value === 'string' ? value.match(/^\$\{(template_literal_[a-zA-Z0-9_]*)\}$/) : null
        if (match && Object.hasOwn(workflow.inputs, match[1])) params[key] = workflow.inputs[match[1]]
      }
      return [{ ...step, params }]
    }
    return [...(step.then ?? []), ...(step.else ?? []), ...(step.loop ?? [])].flatMap(collect)
  })
}
