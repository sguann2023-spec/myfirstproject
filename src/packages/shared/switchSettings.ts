export type SwitchToolId = 'codex' | 'workbuddy'

export interface SwitchModel {
  model_id: string
  name: string
  description?: string
  read_image?: boolean
  context_window_tokens?: number
  max_input_tokens?: number
  max_output_tokens?: number
  compaction_trigger_tokens?: number
  thinking_levels?: string[]
  thinking_default?: string
  codexSupported: boolean
  codexReason?: string
}

export interface SwitchCatalog {
  models: SwitchModel[]
  defaultModel: string
}

export interface SwitchToolState {
  id: SwitchToolId
  name: string
  installed: boolean
  path: string
  enabled: boolean
  hasManagedConfig?: boolean
  needsUpdate: boolean
  modelId?: string
  error?: string
}

export interface SwitchState {
  signedIn: boolean
  tools: SwitchToolState[]
}

export interface SwitchApplyInput {
  tool: SwitchToolId
  modelId?: string
}

export const SWITCH_ERROR_MESSAGES = {
  invalidConfig: '配置格式不受支持，请检查工具配置。',
  ownershipConflict: '存在未标记的同名配置，未进行修改。',
  fileAccess: '无法安全读写配置，请检查路径和权限。',
  concurrentChange: '配置已被其他程序修改，请重试。',
  locked: '配置正在由其他进程处理，请稍后重试。',
  accountChanged: '当前账号已变化，请重试。',
  unavailable: '配置操作失败，请稍后重试。',
  noModels: '暂无可用后端模型。',
  unsupportedModel: '所选模型不适用于 Codex，请重试。',
  credentials: '无法获取当前账号凭据，请重新登录后重试。'
} as const

export const SWITCH_PROVIDER_ID = 'vectcut_switch'
export const SWITCH_OWNER_FIELD = 'vectcutSwitchProviderId'
export const SWITCH_CODEX_BASE_URL = 'https://open.vectcut.com/llm/chat/v1'
export const SWITCH_WORKBUDDY_URL = 'https://open.vectcut.com/llm/chat/v1/chat/completions?client_type=pc'
