/** 模型级可选元数据（对齐 ZCode ProviderModelMetadataDialog 的字段）。
 *  均为可选：旧存档没有这些字段时按缺省语义处理，存储往返无损保留。 */
export interface CustomChatModelMetadata {
  /** 最大输出 Token（正整数）。 */
  max_output_tokens?: number
  /** 输入类型：图片由 read_image 表达；视频/PDF 独立布尔。文本恒为必选。 */
  supports_video?: boolean
  supports_pdf?: boolean
  /** 模型能力：结构化输出 / 原生联网搜索 / 对话中系统消息。 */
  supports_json_schema?: boolean
  supports_native_web_search?: boolean
  supports_mid_conversation_system?: boolean
  /** 推理等级（从低到高，非空、不重复）。 */
  reasoning_levels?: string[]
  /** 推理参数映射（CEL/JSON 字符串，原样保存）。 */
  reasoning_level_map?: string
  /** 智能配置开关（缺省视为开启）。 */
  use_recommended_config?: boolean
}

export interface CustomChatModel extends CustomChatModelMetadata {
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
  models: ({ id: string; name: string; modelId: string; read_image: boolean; enabled: boolean; context_window_tokens?: number } & CustomChatModelMetadata)[]
}

/** 内置（官方）模型的本地偏好：被禁用的模型 ID 列表，跨窗口持久化。 */
export interface OfficialChatModelPrefs {
  disabledModelIds: string[]
}
