import type { DraftTemplate } from './draftTemplate'

export interface DynamicInput {
  key: string
  targetId: string | null
  property: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null'
  defaultValue: unknown
}

function valueType(value: unknown): DynamicInput['type'] {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value as DynamicInput['type']
}

const reserved = new Set(['__proto__', 'prototype', 'constructor', 'id', 'dynamic'])

function targets(template: DraftTemplate) {
  const inputs = new Map<string, {
    input: DynamicInput
    owner: Record<string, unknown>
    field: string
    path: string[]
  }>()
  function visit(value: unknown, path: string[]) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]))
      return
    }
    const node = value as Record<string, unknown>
    if (Object.hasOwn(node, 'dynamic')) {
      const label = path.join('.') || '模版'
      if (!Array.isArray(node.dynamic) || node.dynamic.some((field) => typeof field !== 'string')) {
        throw new Error(`${label}.dynamic 必须是字段路径字符串数组`)
      }
      if (path.length && (typeof node.id !== 'string' || !node.id.trim())) {
        throw new Error(`${label} 声明 dynamic 时必须有非空 id；嵌套属性请在所属对象声明`)
      }
      const declared = new Set<string>()
      for (const property of node.dynamic as string[]) {
        const parts = property.split('.')
        if (parts.some((part) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part) || reserved.has(part))) {
          throw new Error(`${label}.dynamic 不支持字段路径：${property}`)
        }
        if (declared.has(property)) throw new Error(`${label}.dynamic 重复字段：${property}`)
        declared.add(property)
        let owner = node
        for (const part of parts.slice(0, -1)) {
          const child = Object.hasOwn(owner, part) ? owner[part] : undefined
          if (!child || typeof child !== 'object' || Array.isArray(child)) {
            throw new Error(`${label}.dynamic 字段不存在或不是对象：${property}`)
          }
          owner = child as Record<string, unknown>
        }
        const field = parts.at(-1)!
        if (!Object.hasOwn(owner, field)) throw new Error(`${label}.dynamic 字段不存在：${property}`)
        const key = path.length ? `${node.id}.${property}` : property
        if (inputs.has(key)) throw new Error(`dynamic 输入键不唯一：${key}，请区分对象 id`)
        inputs.set(key, {
          input: {
            key, targetId: path.length ? node.id as string : null, property,
            type: valueType(owner[field]), defaultValue: structuredClone(owner[field])
          },
          owner, field, path: [...path, ...parts]
        })
      }
    }
    for (const [field, child] of Object.entries(node)) {
      if (field !== 'dynamic') visit(child, [...path, field])
    }
  }
  visit(template, [])
  return inputs
}

export function getDynamicInputs(template: DraftTemplate): DynamicInput[] {
  return [...targets(template).values()].map(({ input }) => input)
}

// Bind before time resolution; never evaluate strings or modify the source template.
export function applyDynamicInputs(
  template: DraftTemplate,
  modifications: Record<string, unknown> = {}
): DraftTemplate {
  if (!modifications || typeof modifications !== 'object' || Array.isArray(modifications)) {
    throw new Error('modifications 必须是对象')
  }
  const result = structuredClone(template)
  const declared = targets(result)
  const changes = Object.entries(modifications).map(([key, value]) => {
    const target = declared.get(key)
    if (!target) throw new Error(`未声明的 dynamic 输入：${key}`)
    if (value === undefined || valueType(value) !== target.input.type) {
      throw new Error(`${key} 必须是 ${target.input.type} 类型`)
    }
    return { ...target, key, value }
  })
  for (const [index, change] of changes.entries()) {
    if (changes.slice(index + 1).some((other) => {
      const length = Math.min(change.path.length, other.path.length)
      return change.path.slice(0, length).every((part, i) => part === other.path[i])
    })) {
      throw new Error(`modifications 包含重叠的字段替换：${change.key}`)
    }
  }
  for (const { owner, field, value } of changes) owner[field] = structuredClone(value)
  // A structural array replacement may introduce or remove dynamic declarations.
  getDynamicInputs(result)
  return result
}
