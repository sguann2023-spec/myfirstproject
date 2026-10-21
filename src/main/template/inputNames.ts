import type { TemplateWorkflow, WorkflowStep } from './workflowTypes'

export function inputName(label: string, used: Set<string>, reserved = new Set<string>()): string {
  let base = label.normalize('NFKC').trim().replace(/[^\p{L}\p{N}_]/gu, '_') || '元素'
  if (!/^[_\p{L}]/u.test(base)) base = `_${base}`
  if (reserved.has(base) || ['item', 'index', '__proto__', 'constructor', 'prototype'].includes(base) ||
    base.startsWith('__template_') || base.startsWith('template_literal_')) base = `input_${base}`
  base = executionInputName(base)
  if (reserved.has(base)) base = `input_${base}`
  let name = base
  let count = 2
  while (used.has(name)) name = `${base}_${count++}`
  used.add(name)
  return name
}

// Display labels stay readable; backend variable paths use an injective ASCII encoding.
export function executionInputName(name: string, prefix = '__label_'): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
    !['__proto__', 'constructor', 'prototype'].includes(name)
    ? name : `${prefix}${Buffer.from(name, 'utf8').toString('hex')}`
}

export function encodeWorkflowInputNames(workflow: TemplateWorkflow): TemplateWorkflow {
  const result = structuredClone(workflow)
  const variables = new Set(Object.keys(result.inputs))
  function collect(steps: WorkflowStep[]) {
    for (const step of steps) {
      if (step.name) variables.add(step.name)
      if (step.type === 'for') { variables.add('item'); variables.add('index') }
      collect(step.loop ?? []); collect(step.then ?? []); collect(step.else ?? [])
    }
  }
  collect(result.script)
  const keys = [...variables]
  function collectKeys(value: unknown) {
    if (Array.isArray(value)) { value.forEach(collectKeys); return }
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) { keys.push(key); collectKeys(item) }
  }
  collectKeys(result.inputs)
  let prefix = '__label_'
  while (keys.some(key => key.startsWith(prefix))) prefix += '_'
  const encodeName = (name: string) => executionInputName(name, prefix)
  const labels = new Map((result.input_labels ?? []).map(item => {
    const converted = { ...item, path: item.path.map(part => part === '*' ? part : encodeName(part)) }
    return [JSON.stringify(converted.path), converted]
  }))
  function encodeInputs(value: unknown, path: string[]): unknown {
    if (Array.isArray(value)) return value.map(item => encodeInputs(item, [...path, '*']))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      const name = encodeName(key)
      const next = [...path, name]
      if (name !== key && !labels.has(JSON.stringify(next))) labels.set(JSON.stringify(next), { path: next, label: key })
      return [name, encodeInputs(item, next)]
    }))
  }
  function encodeReferences(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(encodeReferences)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeReferences(item)]))
    if (typeof value !== 'string') return value
    return value.replace(/\$\{([^}]+)\}/g, (original, path: string) => {
      if (!variables.has(path.split(/[.\[]/)[0])) return original
      const encoded = path.replace(/(^|\.)([^.[\]]+)/g, (_match, separator: string, part: string) =>
        `${separator}${separator && /^\d+$/.test(part) ? part : encodeName(part)}`)
      return `\${${encoded}}`
    })
  }
  function encodeSteps(steps: WorkflowStep[]) {
    for (const step of steps) {
      if (step.type === 'set_var' && step.name) step.name = encodeName(step.name)
      if (step.value !== undefined) step.value = encodeReferences(step.value) as string | number
      if (step.in !== undefined) step.in = encodeReferences(step.in) as string
      if (step.loopCount !== undefined) step.loopCount = encodeReferences(step.loopCount) as string | number
      if (step.condition !== undefined) step.condition = encodeReferences(step.condition) as string
      if (step.params) step.params = encodeReferences(step.params) as Record<string, unknown>
      encodeSteps(step.loop ?? []); encodeSteps(step.then ?? []); encodeSteps(step.else ?? [])
    }
  }
  result.inputs = encodeInputs(result.inputs, []) as Record<string, unknown>
  encodeSteps(result.script)
  if (labels.size) result.input_labels = [...labels.values()]
  return result
}
