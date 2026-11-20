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
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
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
  const levels = (model.thinking_levels ?? []).map(level => level.trim().toLowerCase()).filter(Boolean)
  const supportedEfforts = [...new Set(levels.filter(level => EFFORTS.includes(level)))]
  const supportsReasoning = supportedEfforts.length > 0 || levels.some(level => level === 'enabled' || level === 'on')
  const canDisableThinking = levels.some(level => level === 'off' || level === 'none' || level === 'disabled')
  const defaultEffort = model.thinking_default?.trim().toLowerCase()
  // WorkBuddy reads effort and disable capabilities only from the nested schema.
  const reasoning = {
    ...(supportedEfforts.length ? { supportedEfforts } : {}),
    ...(defaultEffort && supportedEfforts.includes(defaultEffort) ? { defaultEffort } : {}),
    ...(supportsReasoning || canDisableThinking ? { canDisableThinking } : {})
  }
  return {
    id: model.name.trim() || model.model_id,
    name: model.name.trim() || model.model_id,
    vendor: 'VectCut',
    url: SWITCH_WORKBUDDY_URL,
    apiKey,
    [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID,
    supportsToolCall: true,
    supportsImages: model.read_image === true,
    supportsReasoning,
    useCustomProtocol: false,
    ...(positive(model.max_input_tokens) ? { maxInputTokens: model.max_input_tokens } : {}),
    ...(positive(model.max_output_tokens) ? { maxOutputTokens: model.max_output_tokens } : {}),
    ...(Object.keys(reasoning).length ? { reasoning } : {}),
    ...(supportsReasoning && !canDisableThinking ? { onlyReasoning: true } : {})
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

export function inspectWorkBuddySwitchConfig(source: string): { enabled: boolean; hasManagedConfig: boolean } {
  const hasManagedConfig = read(source).models.some(owned)
  return { enabled: hasManagedConfig, hasManagedConfig }
}

export function planWorkBuddyConfig(source: string, models: SwitchModel[], key: string): string {
  const doc = read(source)
  validateModels(models)
  if (!key.trim()) throw new Error('WorkBuddy Switch credentials are missing.')
  const occupied = new Set(doc.models.filter(model => !owned(model)).map(model => model.id))
  const ids = new Set<string>()
  const desired = models.flatMap(model => {
    const item = entry(model, key)
    // Preserve existing canonical-ID entries as well as display-ID entries owned by users.
    if (occupied.has(model.model_id) || occupied.has(item.id) || ids.has(item.id)) return []
    ids.add(item.id)
    return [item]
  })
  const oldIds = new Set(doc.models.filter(owned).map(model => model.id))
  if (!desired.length && !oldIds.size) return source
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

/** Strict ownership only: edited owned entries are removed, unmarked models never are. */
export function removeWorkBuddySwitchConfig(source: string): string {
  const doc = read(source)
  const ids = new Set(doc.models.filter(owned).map(model => model.id))
  if (!ids.size) return source
  let config = writeModels(source, doc.models.filter(model => !owned(model)))
  if (Array.isArray(doc.root.availableModels)) {
    const available = doc.root.availableModels as string[]
    const remaining = available.filter(id => !ids.has(id))
    if (!same(available, remaining)) config = patch(config, ['availableModels'], remaining)
  }
  return config
}
