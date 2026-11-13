export interface CustomChatModel {
  id: string
  name: string
  protocol: 'openai' | 'anthropic' | 'openai-responses'
  baseUrl: string
  apiKey: string
  modelId: string
  read_image: boolean
}

export interface CustomChatProvider {
  id: string
  name: string
  protocol: 'openai' | 'anthropic' | 'openai-responses'
  baseUrl: string
  apiKey: string
  /** 供应商级开关（对齐 ZCode provider.enabled）；缺省视为启用。 */
  enabled?: boolean
  /** 模板携带的 API Key 管理页地址（对齐 ZCode access.apiKeyManagementUrl）。 */
  apiKeyUrl?: string
  /** 品牌标识 key（对齐 ZCode config.logo）：清空 Base URL 后图标不丢失。 */
  logoKey?: string
  models: { id: string; name: string; modelId: string; read_image: boolean; enabled: boolean; context_window_tokens?: number }[]
}

/** 内置（官方）模型的本地偏好：被禁用的模型 ID 列表，跨窗口持久化。 */
export interface OfficialChatModelPrefs {
  disabledModelIds: string[]
}
