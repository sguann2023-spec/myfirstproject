import { randomUUID } from 'node:crypto'
import type { DraftTemplate, DraftScene, DraftSegment, DraftTrackItem, DraftKeyframeGroup } from './draftTemplate'
import { isSceneSegment } from './draftTracks'
import { createWelcomePreset, welcomeAnimation } from './welcomePreset'

const backgrounds = new Set(['welcome-intro-background', 'welcome-journey-background', 'welcome-brand-background'])
const decorations = new Set(['welcome-intro-bar-1', 'welcome-intro-bar-2', 'welcome-intro-bar-3', 'welcome-intro-bar-4',
  'welcome-logo-left', 'welcome-logo-right', 'welcome-logo-dot'])

/** Only migrate the known built-in example; do not drop unrelated user tracks/materials. */
export function upgradeLegacyWelcomePreset(source: DraftTemplate): { template: DraftTemplate; changed: boolean } {
  if (!source?.scenes?.some(scene => scene.id === 'welcome-root') || !source.materials) return { template: source, changed: false }
  const template = structuredClone(source)
  const materials = new Map(Object.values(template.materials).flat().map(material => [material.id, material]))
  const replacement = createWelcomePreset()
  const photos = new Map(replacement.materials.videos.map(material => [material.id, material]))
  const ids = new Set<string>()
  const collectIds = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(collectIds); return }
    const object = value as Record<string, unknown>
    if (typeof object.id === 'string') ids.add(object.id)
    Object.values(object).forEach(collectIds)
  }
  collectIds(template)
  const uniqueId = (preferred: string) => {
    let id = preferred
    while (ids.has(id)) id = randomUUID()
    ids.add(id)
    return id
  }
  const uniqueAnimation = (group: DraftKeyframeGroup) => {
    group.id = uniqueId(group.id)
    for (const frame of group.keyframe_list) frame.id = uniqueId(frame.id)
    return group
  }
  let changed = false
  const removedMaterials = new Set<string>()
  const removedDecorations = new Set<string>()
  const visit = (scene: DraftScene) => {
    const emptied = new Set<string>()
    let removedLogo = false
    for (const track of scene.tracks) {
      const hadSegments = track.segments.length > 0
      let convertedBackground = false
      track.segments = track.segments.filter((item: DraftTrackItem) => {
        if (isSceneSegment(item)) { visit(item); return true }
        const material = materials.get(item.material_id)
        if (material?.type !== 'shape') return true
        if (backgrounds.has(item.id)) {
          const photo = photos.get(`${item.id}-material`)!
          removedMaterials.add(item.material_id)
          const id = uniqueId(`${item.id}-image-material`)
          const image = { ...photo, id }
          ;(template.materials.videos ??= []).push(image)
          materials.set(id, image)
          item.material_id = id
          convertedBackground = true
          changed = true
          return true
        }
        if (!decorations.has(item.id)) return true
        removedMaterials.add(item.material_id)
        removedDecorations.add(item.id)
        removedLogo ||= item.id.startsWith('welcome-logo-')
        changed = true
        return false
      })
      if (convertedBackground && track.type === 'shape') {
        track.type = track.segments.every(item => !isSceneSegment(item) && materials.get(item.material_id)?.type === 'photo')
          ? 'video' : 'mixed'
      }
      if (hadSegments && !track.segments.length) emptied.add(track.id)
    }
    scene.tracks = scene.tracks.filter(track => !emptied.has(track.id))
    scene.scenes?.forEach(visit)
    if (['welcome-journey', 'welcome-brand'].includes(scene.id) && scene.preview_transition?.type === 'circular-wipe') {
      delete scene.preview_transition
      if (!scene.common_keyframes?.some(group => group.property_type === 'KFTypeAlpha')) {
        const animation = uniqueAnimation(welcomeAnimation(scene.id, 'KFTypeAlpha', [[0, 0], [1_000_000, 1]]))
        scene.common_keyframes = [...(scene.common_keyframes ?? []), animation]
      }
      changed = true
    }
    if (scene.id === 'welcome-brand' && removedLogo && !scene.tracks.some(track => track.segments.some(item => item.id === 'welcome-brand-logo'))) {
      const brand = replacement.scenes[0].tracks[2].segments.find(isSceneSegment)!
      const logoTrack = structuredClone(brand.tracks.find(track => track.id === 'welcome-brand-logo-track')!)
      const logo = logoTrack.segments[0] as DraftSegment
      const photo = structuredClone(photos.get(logo.material_id)!)
      logoTrack.id = uniqueId(logoTrack.id)
      logo.id = uniqueId(logo.id)
      photo.id = uniqueId(photo.id)
      logo.material_id = photo.id
      logo.common_keyframes?.forEach(uniqueAnimation)
      logoTrack.track_relative_index = Math.max(-1, ...scene.tracks.map((track, index) => track.track_relative_index ?? index)) + 1
      scene.tracks.push(logoTrack)
      ;(template.materials.videos ??= []).push(photo)
    }
  }
  template.scenes.filter(scene => scene.id === 'welcome-root').forEach(visit)
  if (!changed) return { template: source, changed: false }
  const used = new Set<string>()
  const collect = (scene: DraftScene) => {
    const checkTiming = (item: DraftScene | DraftSegment) => {
      for (const anchor of [item.auto_timing?.start, item.auto_timing?.end]) {
        if (anchor && removedDecorations.has(anchor.target)) {
          throw new Error(`请先解除 ${item.id} 对装饰 ${anchor.target} 的自动对齐关联，再更新欢迎模版`)
        }
      }
    }
    checkTiming(scene)
    scene.tracks.forEach(track => track.segments.forEach(item => {
      if (isSceneSegment(item)) collect(item)
      else {
        checkTiming(item)
        used.add(item.material_id)
        for (const refs of [item.extra_material_refs, item.keyframe_refs]) {
          if (Array.isArray(refs)) refs.forEach(id => { if (typeof id === 'string') used.add(id) })
        }
      }
    }))
    scene.scenes?.forEach(collect)
  }
  template.scenes.forEach(collect)
  // Prior property edits leave unreferenced shape copies; only remove the built-in example's known material ids.
  const knownMaterials = new Set([...backgrounds, ...decorations].map(id => `${id}-material`))
  if (template.materials.shapes) {
    template.materials.shapes = template.materials.shapes.filter(material => used.has(material.id) ||
      (!knownMaterials.has(material.id) && !removedMaterials.has(material.id)))
    if (!template.materials.shapes.length) delete template.materials.shapes
  }
  return { template, changed: true }
}
