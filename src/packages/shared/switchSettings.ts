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
  hasBackup?: boolean
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

export const SWITCH_PROVIDER_ID = 'vectcut_switch'
export const SWITCH_OWNER_FIELD = 'vectcutSwitchProviderId'
export const SWITCH_CODEX_BASE_URL = 'https://open.vectcut.com/llm/chat/v1'
export const SWITCH_WORKBUDDY_URL = 'https://open.vectcut.com/llm/chat/v1/chat/completions?client_type=pc'
