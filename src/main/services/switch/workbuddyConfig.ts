import { applyEdits, modify, parseTree, type Node as JSONNode } from 'jsonc-parser'
import {
  SWITCH_OWNER_FIELD,
  SWITCH_PROVIDER_ID,
  SWITCH_WORKBUDDY_URL,
  type SwitchModel
} from '../../../packages/shared/switchSettings'

type ModelEntry = Record<string, unknown> & { id: string }
type Document = {
  text: string
  bom: string
  eol: string
  value: unknown
  shape: 'object' | 'array' | 'null' | 'empty'
  root: Record<string, unknown>
  models: ModelEntry[]
}
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => same(value, b[i]))
  if (object(a) && object(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && same(a[key], b[key]))
  }
  return false
}

function read(source: string): Document {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const text = source.slice(bom.length)
  try {
    let value: unknown = null
    const empty = !text.trim()
    if (!empty) {
      const errors: Parameters<typeof parseTree>[1] = []
      const ast = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true, allowEmptyContent: false })
      if (!ast || errors.length) throw new Error('invalid JSON')
      const checkDuplicates = (node: JSONNode) => {
        if (node.type === 'object') {
          const keys = node.children?.map(child => child.children?.[0]?.value) ?? []
          if (new Set(keys).size !== keys.length) throw new Error('duplicate JSON property')
        }
        node.children?.forEach(checkDuplicates)
      }
      checkDuplicates(ast)
      value = JSON.parse(text)
    }
    if (value !== null && !Array.isArray(value) && !object(value)) throw new Error('invalid root')
    const shape = empty ? 'empty' : value === null ? 'null' : Array.isArray(value) ? 'array' : 'object'
    const root = object(value) ? value : {}
    const rawModels = Array.isArray(value) ? value : root.models
    if (rawModels !== undefined && rawModels !== null && !Array.isArray(rawModels)) throw new Error('invalid models')
    const models = (rawModels ?? []) as ModelEntry[]
    const ids = new Set<string>()
    for (const model of models) {
      if (!object(model) || typeof model.id !== 'string' || !model.id.trim() || ids.has(model.id)) throw new Error('invalid models')
      ids.add(model.id)
    }
    if (own(root, 'availableModels') && (!Array.isArray(root.availableModels) || !root.availableModels.every(id => typeof id === 'string'))) {
      throw new Error('invalid available models')
    }
    return { text, bom, eol: text.includes('\r\n') ? '\r\n' : '\n', value, shape, root, models }
  } catch {
    // JSON parser errors can quote an API key. Expose a fixed error, never parser input/errors.
    throw new Error('WorkBuddy configuration is not supported valid JSON.')
  }
}

function owned(model: ModelEntry): boolean {
  return model[SWITCH_OWNER_FIELD] === SWITCH_PROVIDER_ID
}

function positive(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function entry(model: SwitchModel, apiKey: string): ModelEntry {
  const levels = model.thinking_levels ?? []
  const supportedEfforts = [...new Set(levels.filter(level => EFFORTS.includes(level)))]
  const supportsReasoning = supportedEfforts.length > 0 || levels.some(level => level === 'enabled' || level === 'on')
  const canDisableThinking = levels.some(level => level === 'off' || level === 'none' || level === 'disabled')
  return {
    id: model.model_id,
    name: model.name.trim() || model.model_id,
    vendor: '流光剪辑',
    url: SWITCH_WORKBUDDY_URL,
    apiKey,
    [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID,
    supportsToolCall: true,
    supportsImages: model.read_image === true,
    supportsReasoning,
    ...(positive(model.max_input_tokens) ? { maxInputTokens: model.max_input_tokens } : {}),
    ...(positive(model.max_output_tokens) ? { maxOutputTokens: model.max_output_tokens } : {}),
    ...(supportedEfforts.length ? { supportedEfforts } : {}),
    ...(model.thinking_default && supportedEfforts.includes(model.thinking_default) ? { defaultEffort: model.thinking_default } : {}),
    ...(levels.length ? { canDisableThinking } : {})
  }
}

function patch(source: string, path: (string | number)[], value: unknown): string {
  const doc = read(source)
  return doc.bom + applyEdits(doc.text, modify(doc.text, path, value, {
    formattingOptions: { insertSpaces: !/\n\t/.test(doc.text), tabSize: 2, eol: doc.eol }
  }))
}

function writeModels(source: string, models: ModelEntry[]): string {
  const doc = read(source)
  if (same(doc.models, models) && (doc.shape === 'array' || Array.isArray(doc.root.models))) return source
  if (doc.shape === 'array') return patch(source, [], models)
  if (doc.shape === 'null' || doc.shape === 'empty') {
    return doc.bom + JSON.stringify({ models }, null, 2).replace(/\n/g, doc.eol) + doc.eol
  }
  return patch(source, ['models'], models)
}

function validateModels(models: SwitchModel[]): void {
  if (!models.length || models.some(model => !model.model_id.trim()) || new Set(models.map(model => model.model_id)).size !== models.length) {
    throw new Error('WorkBuddy model catalog contains invalid or duplicate identifiers.')
  }
}

export function inspectWorkBuddySwitchConfig(source: string): { enabled: boolean } {
  return { enabled: read(source).models.some(owned) }
}

export function planWorkBuddyConfig(source: string, models: SwitchModel[], key: string): string {
  const doc = read(source)
  validateModels(models)
  if (!key.trim()) throw new Error('WorkBuddy Switch credentials are missing.')
  const desired = models.map(model => entry(model, key))
  const ids = new Set(desired.map(model => model.id))
  if (doc.models.some(model => !owned(model) && ids.has(model.id))) {
    throw new Error('WorkBuddy Switch model conflicts with an existing model.')
  }
  const oldIds = new Set(doc.models.filter(owned).map(model => model.id))
  const firstOwned = doc.models.findIndex(owned)
  const next = doc.models.filter(model => !owned(model))
  const insertion = firstOwned < 0 ? next.length : doc.models.slice(0, firstOwned).filter(model => !owned(model)).length
  next.splice(insertion, 0, ...desired)
  let config = writeModels(source, next)
  if (Array.isArray(doc.root.availableModels) && doc.root.availableModels.length) {
    const available = doc.root.availableModels as string[]
    const updated = [...available.filter(id => !oldIds.has(id) && !ids.has(id)), ...desired.map(model => model.id)]
    if (!same(available, updated)) config = patch(config, ['availableModels'], updated)
  }
  return config
}

/** Owned entries are replaced atomically; other models/root settings and unrelated selections survive. */
export function restoreWorkBuddyConfig(current: string, before: string, applied: string): string {
  const original = read(before)
  const expected = read(applied)
  const actual = read(current)
  const oldOwned = original.models.filter(owned)
  const newOwned = expected.models.filter(owned)
  const ids = new Set([...oldOwned, ...newOwned].map(model => model.id))
  if (actual.models.some(model => owned(model) && !ids.has(model.id))) {
    throw new Error('WorkBuddy managed models were changed outside Switch; restore was cancelled.')
  }
  const modelsMatch = (doc: Document) => [...ids].every(id => same(actual.models.find(model => model.id === id), doc.models.find(model => model.id === id)))
  const oldAvailable = original.root.availableModels as string[] | undefined
  const expectedAvailable = expected.root.availableModels as string[] | undefined
  const currentAvailable = actual.root.availableModels as string[] | undefined
  const managesAvailable = !same(oldAvailable, expectedAvailable)
  const projection = (values: string[] | undefined) => values?.filter(id => ids.has(id)).sort()
  const availableBefore = !managesAvailable || (Array.isArray(currentAvailable) && same(projection(currentAvailable), projection(oldAvailable)))
  const availableExpected = !managesAvailable || (Array.isArray(currentAvailable) && same(projection(currentAvailable), projection(expectedAvailable)))
  if (modelsMatch(original) && availableBefore) return current
  if (!modelsMatch(expected)) throw new Error('WorkBuddy managed models were changed outside Switch; restore was cancelled.')
  if (!availableExpected) throw new Error('WorkBuddy managed model selections were changed outside Switch; restore was cancelled.')
  if (current === applied) return before

  const restoredModels = actual.models.filter(model => !ids.has(model.id))
  for (const model of oldOwned) {
    const position = original.models.indexOf(model)
    const next = original.models.slice(position + 1).find(item => restoredModels.some(current => current.id === item.id))
    const previous = [...original.models.slice(0, position)].reverse().find(item => restoredModels.some(current => current.id === item.id))
    const insertion = next ? restoredModels.findIndex(item => item.id === next.id)
      : previous ? restoredModels.findIndex(item => item.id === previous.id) + 1 : Math.min(position, restoredModels.length)
    restoredModels.splice(insertion, 0, model)
  }
  let config = same(actual.models, restoredModels) ? current : writeModels(current, restoredModels)
  if (managesAvailable && currentAvailable && oldAvailable) {
    const restored = currentAvailable.filter(id => !ids.has(id))
    for (const id of oldAvailable.filter(id => ids.has(id))) {
      const position = oldAvailable.indexOf(id)
      const next = oldAvailable.slice(position + 1).find(item => restored.includes(item))
      restored.splice(next ? restored.indexOf(next) : restored.length, 0, id)
    }
    if (!same(currentAvailable, restored)) config = patch(config, ['availableModels'], restored)
  }
  const result = read(config)
  if (original.shape === 'object' && !own(original.root, 'models') && result.models.length === 0 && own(result.root, 'models')) {
    config = patch(config, ['models'], undefined)
  } else if (original.shape === 'object' && original.root.models === null && result.models.length === 0) {
    config = patch(config, ['models'], null)
  } else if ((original.shape === 'null' || original.shape === 'empty') && result.models.length === 0 && Object.keys(result.root).every(key => key === 'models')) {
    return before
  }
  return config
}
