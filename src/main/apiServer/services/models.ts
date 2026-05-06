import type { ApiModel, ApiModelsFilter, ApiModelsResponse } from '../../../renderer/src/types/apiModels'
import { loggerService } from '../../services/LoggerService'

const logger = loggerService.withContext('ModelsService')
const CHAT_MODELS_URL = 'https://open.vectcut.com/llm/chat/model_list'

type ParsedModelItem = {
  modelId: string
  name: string
  providerId?: string
  providerType?: string
  providerName?: string
}

const normalizeModelItem = (item: unknown): ParsedModelItem | undefined => {
  if (typeof item === 'string') {
    const value = item.trim()
    return value ? { modelId: value, name: value } : undefined
  }
  if (!item || typeof item !== 'object') return undefined
  const record = item as Record<string, unknown>
  const modelId = String(
    record.model_id || record.provider_model_id || record.model || record.name || record.id || record.value || record.model_name || ''
  ).trim()
  if (!modelId) return undefined
  return {
    modelId,
    name: String(record.name || record.display_name || modelId).trim() || modelId,
    providerId: String(record.provider_id || '').trim() || undefined,
    providerType: String(record.provider_type || '').trim() || undefined,
    providerName: String(record.provider_name || '').trim() || undefined
  }
}

const parseModelList = (payload: any): ParsedModelItem[] => {
  const candidates = [
    payload?.model_items,
    payload?.data?.model_items,
    payload?.data?.models,
    payload?.data?.list,
    payload?.data,
    payload?.models,
    payload?.model_list,
    payload?.list,
    payload
  ]
  const rawList = candidates.find((item) => Array.isArray(item)) || []
  const modelSet = new Set<string>()
  const parsed: ParsedModelItem[] = []
  rawList.forEach((item: unknown) => {
    const model = normalizeModelItem(item)
    if (!model || modelSet.has(model.modelId)) return
    modelSet.add(model.modelId)
    parsed.push(model)
  })
  return parsed
}

const resolveProviderMeta = (modelId: string): {
  providerId: string
  providerName: string
  providerType: 'openai' | 'anthropic' | 'gemini' | 'openai-response'
} => {
  const lower = String(modelId || '').toLowerCase()
  if (lower.startsWith('claude-')) {
    return { providerId: 'anthropic', providerName: 'Anthropic', providerType: 'anthropic' }
  }
  if (lower.startsWith('gemini-')) {
    return { providerId: 'gemini', providerName: 'Gemini', providerType: 'gemini' }
  }
  return { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' }
}

// Re-export for backward compatibility

export type ModelsFilter = ApiModelsFilter

export class ModelsService {
  private async fetchBackendModelList(): Promise<ParsedModelItem[]> {
    const res = await fetch(CHAT_MODELS_URL, {
      method: 'GET',
      headers: { Accept: '*/*' }
    })
    if (!res.ok) throw new Error(`model_list request failed: ${res.status}`)
    const payload = await res.json()
    return parseModelList(payload)
  }

  async getModels(filter: ModelsFilter): Promise<ApiModelsResponse> {
    try {
      logger.debug('Getting available models from backend model_list', { filter })

      const providerType = String(filter.providerType || '').trim().toLowerCase()
      const offset = filter?.offset || 0
      const limit = filter?.limit

      const rawModels = await this.fetchBackendModelList()
      let modelData: ApiModel[] = rawModels.map((entry) => {
        const fallback = resolveProviderMeta(entry.modelId)
        const providerId = entry.providerId || fallback.providerId
        const providerType = (entry.providerType as any) || fallback.providerType
        const providerName = entry.providerName || fallback.providerName
        return {
          id: `${providerId}:${entry.modelId}`,
          object: 'model',
          created: 0,
          name: entry.name || entry.modelId,
          owned_by: providerId,
          provider: providerId,
          provider_name: providerName,
          provider_type: providerType,
          provider_model_id: entry.modelId
        }
      })

      if (providerType) {
        modelData = modelData.filter((item) => {
          const itemType = String(item.provider_type || '').toLowerCase()
          if (providerType === 'openai-response') return itemType === 'openai' || itemType === 'openai-response'
          return itemType === providerType
        })
      }

      const total = modelData.length
      if (limit !== undefined) {
        modelData = modelData.slice(offset, offset + limit)
      } else if (offset > 0) {
        modelData = modelData.slice(offset)
      }

      logger.info('Models retrieved', {
        returned: modelData.length,
        discovered: rawModels.length,
        filter,
        providerBreakdown: modelData.reduce<Record<string, number>>((acc, item) => {
          const key = String(item.provider || 'unknown')
          acc[key] = Number(acc[key] || 0) + 1
          return acc
        }, {})
      })

      return {
        object: 'list',
        data: modelData,
        ...(limit !== undefined || offset !== 0 ? { total, offset } : {}),
        ...(limit !== undefined ? { limit } : {})
      }
    } catch (error: any) {
      logger.error('Error getting models', { error, filter })
      return {
        object: 'list',
        data: []
      }
    }
  }
}

// Export singleton instance
export const modelsService = new ModelsService()
