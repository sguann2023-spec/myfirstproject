import type { SceneElement, TimingAnchor, TimingRule } from './sceneTemplate'

export interface TimingFields<T> {
  start?: T
  end?: T
  endAtParent?: boolean
  duration?: T
  offset: (anchor: TimingAnchor, side: 'start' | 'end') => T
}

export interface TimingMath<T> {
  value: (value: number) => T
  add: (a: T, b: T) => T
  subtract: (a: T, b: T) => T
  max: (a: T, b: T) => T
  store: (value: T) => T
  validate: (element: SceneElement, start: T, duration: T) => void
  validateContent: (element: SceneElement, duration: T) => void
}

// Numeric preview and symbolic Workflow use the same dependency and duration rules.
export function createSceneTimingEngine<T>(
  rules: Record<string, TimingRule>,
  fields: (element: SceneElement) => TimingFields<T>,
  math: TimingMath<T>
) {
  const contentCache = new Map<string, T>()
  const measuring = new Set<string>()
  function contentDuration(element: SceneElement): T {
    if (contentCache.has(element.id)) return contentCache.get(element.id)!
    if (measuring.has(element.id)) throw new Error(`Scene 内容时长存在循环依赖：${element.id}`)
    measuring.add(element.id)
    const children = element.elements ?? []
    const independent = scope(children)
    let duration = math.value(0)
    let candidates = 0
    for (const child of children) {
      const timing = independent.resolve(child)
      // Parent-filling and parent-end-dependent children follow the measured duration.
      if (!timing) continue
      duration = math.store(math.max(duration, math.add(timing.localStart, timing.duration)))
      candidates++
    }
    if (!candidates) {
      throw new Error(`${element.id} 无法从内部内容推导时长，请至少给一个片段设置独立的目标时长或结束时间`)
    }
    math.validateContent(element, duration)
    contentCache.set(element.id, duration)
    measuring.delete(element.id)
    return duration
  }

  function scope(elements: SceneElement[], parentDuration?: T) {
    const siblings = new Map(elements.map((element) => [element.id, element]))
    const cache = new Map<string, { localStart: T; duration: T } | undefined>()
    const resolving = new Set<string>()
    function resolve(element: SceneElement): { localStart: T; duration: T } | undefined {
      if (cache.has(element.id)) return cache.get(element.id)
      if (resolving.has(element.id)) throw new Error(`时间关联存在循环依赖：${element.id}`)
      resolving.add(element.id)
      const settings = fields(element)
      const rule = rules[element.id]
      function anchorTime(anchor: TimingAnchor, side: 'start' | 'end'): T | undefined {
        const targetElement = siblings.get(anchor.element_id)
        if (!targetElement) throw new Error(`${element.id} 的时间关联必须引用同一父级的有效元素：${anchor.element_id}`)
        const target = resolve(targetElement)
        if (!target) return undefined
        return math.add(math.add(target.localStart,
          anchor.anchor === 'end' ? target.duration : math.value(0)), settings.offset(anchor, side))
      }
      function unavailable() {
        cache.set(element.id, undefined)
        resolving.delete(element.id)
        return undefined
      }
      const linkedEnd = rule?.end ? anchorTime(rule.end, 'end')
        : settings.endAtParent ? parentDuration : settings.end
      if ((rule?.end || settings.endAtParent) && linkedEnd === undefined) return unavailable()
      const explicitDuration = element.auto_duration ? contentDuration(element) : settings.duration
      let localStart: T | undefined
      if (rule?.start) localStart = anchorTime(rule.start, 'start')
      else if (settings.start === undefined && linkedEnd !== undefined && explicitDuration !== undefined) {
        localStart = math.subtract(linkedEnd, explicitDuration)
      } else localStart = settings.start ?? math.value(0)
      if (localStart === undefined) return unavailable()
      const duration = linkedEnd !== undefined ? math.subtract(linkedEnd, localStart)
        : explicitDuration ?? (parentDuration === undefined ? undefined
          : math.max(math.value(0), math.subtract(parentDuration, localStart)))
      if (duration === undefined) return unavailable()
      math.validate(element, localStart, duration)
      const timing = { localStart: math.store(localStart), duration: math.store(duration) }
      cache.set(element.id, timing)
      resolving.delete(element.id)
      return timing
    }
    return { resolve }
  }
  return { scope, contentDuration }
}
