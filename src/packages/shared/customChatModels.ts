export interface CustomChatModel {
  id: string
  name: string
  protocol: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  modelId: string
  read_image: boolean
}

export interface CustomChatProvider {
  id: string
  name: string
  protocol: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  /** 供应商级开关（对齐 ZCode provider.enabled）；缺省视为启用。 */
  enabled?: boolean
  models: { id: string; name: string; modelId: string; read_image: boolean; enabled: boolean }[]
}

/** 内置（官方）模型的本地偏好：被禁用的模型 ID 列表，跨窗口持久化。 */
export interface OfficialChatModelPrefs {
  disabledModelIds: string[]
}
