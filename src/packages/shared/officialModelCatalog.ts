export interface OfficialModelItem {
  model_id: string
  name: string
  description?: string
  badges?: string[]
  provider_id?: string
  provider_type?: string
  provider_name?: string
  provider_model_id?: string
  id?: string
  thinking_levels?: string[]
  thinking_default?: string
  read_image?: boolean
  context_window_tokens?: number
  max_input_tokens?: number
  max_output_tokens?: number
  compaction_trigger_tokens?: number
  price_text?: string
  price_multiplier_text?: string
  pricing?: Record<string, unknown>
}

export interface OfficialModelCatalog {
  models: string[]
  modelItems: OfficialModelItem[]
  defaultModel: string
  prices: Record<string, unknown>
  blackIconMap: Record<string, string>
}

type RecordValue = Record<string, any>
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const positiveInteger = (value: unknown): number | undefined => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}
const booleanFlag = (value: unknown): boolean | undefined => {
  if (value == null) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return ['true', '1', 'yes'].includes(String(value).trim().toLowerCase())
}
const modelId = (item: unknown): string => {
  if (typeof item === 'string') return item.trim()
  const value = record(item)
  return String(value.model_id || value.provider_model_id || value.model || value.name || value.id || value.value || value.model_name || '').trim()
}

/** Shared by the settings renderer and native-client exporter; never invents fallback models. */
export function parseOfficialModelCatalog(input: unknown): OfficialModelCatalog {
  const payload = record(input)
  const data = record(payload.data)
  // A canonical models list wins even when empty. Otherwise retain the legacy
  // envelope precedence (nested list/data, then top-level aliases).
  const listCandidates = [data.models, payload.models, data.list, payload.data, payload.model_list, payload.list, input]
  const rawModels: unknown[] | undefined = listCandidates.find(Array.isArray)
  const rawItems: unknown[] = [payload.model_items, data.model_items].find(Array.isArray) ?? rawModels ?? []
  const seen = new Set<string>()
  const modelItems: OfficialModelItem[] = []
  const metadata = new Map<string, OfficialModelItem>()
  for (const item of rawItems) {
    const id = modelId(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    if (typeof item === 'string') {
      const sparse = { model_id: id, name: id }
      modelItems.push(sparse)
      if (rawItems === rawModels) metadata.set(id, sparse)
      continue
    }
    const value = record(item)
    const normalized: OfficialModelItem = {
      model_id: id,
      name: String(value.name || value.display_name || id).trim(),
      description: String(value.description || '').trim(),
      badges: Array.isArray(value.badges) ? value.badges.map((badge: unknown) => String(badge || '').trim()).filter(Boolean) : [],
      provider_id: String(value.provider_id || '').trim(),
      provider_type: String(value.provider_type || '').trim(),
      provider_name: String(value.provider_name || '').trim(),
      provider_model_id: String(value.provider_model_id || '').trim(),
      id: String(value.id || '').trim(),
      thinking_levels: Array.isArray(value.thinking_levels) ? value.thinking_levels.filter((level: unknown) => typeof level === 'string').map((level: string) => level.trim().toLowerCase()).filter(Boolean) : [],
      thinking_default: typeof value.thinking_default === 'string' ? value.thinking_default.trim().toLowerCase() : undefined,
      read_image: booleanFlag(value.read_image ?? value.readImage),
      context_window_tokens: positiveInteger(value.context_window_tokens),
      max_input_tokens: positiveInteger(value.max_input_tokens),
      max_output_tokens: positiveInteger(value.max_output_tokens),
      compaction_trigger_tokens: positiveInteger(value.compaction_trigger_tokens),
      price_text: String(value.price_text || '').trim(),
      price_multiplier_text: String(value.price_multiplier_text || '').trim(),
      pricing: value.pricing && typeof value.pricing === 'object' && !Array.isArray(value.pricing) ? { ...value.pricing } : undefined
    }
    modelItems.push(normalized)
    // Explicit rich entries join only by canonical model_id, not provider/name aliases.
    if (rawItems === rawModels || (typeof value.model_id === 'string' && value.model_id.trim() === id)) metadata.set(id, normalized)
  }
  const models = [...new Set((rawModels ?? rawItems).map(modelId).filter(Boolean))]
  // Rich metadata cannot add/reorder live IDs or resurrect a removed model.
  const listedItems = rawModels === undefined ? modelItems : models.map(id => metadata.get(id) ?? { model_id: id, name: id })
  const blackIconMap: Record<string, string> = {}
  for (const [key, value] of Object.entries(record(payload.black_icon || data.black_icon))) {
    const id = key.trim()
    const icon = String(value || '').trim()
    if (id && icon) blackIconMap[id] = icon
  }
  return {
    models,
    modelItems: listedItems,
    defaultModel: String(payload.default_model || data.default_model || payload.defaultModel || data.defaultModel || '').trim(),
    prices: { ...record(payload.prices || data.prices) },
    blackIconMap
  }
}
