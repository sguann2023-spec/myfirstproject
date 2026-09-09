export type ApiServerConfig = {
  enabled: boolean
  host: string
  port: number
  apiKey: string
}

export const LOCAL_MCP_EXTERNAL_AGENT_IDS = [
  'workbuddy',
  'claude_code',
  'cursor',
  'codex_cli',
  'opencode'
] as const

export type LocalMcpExternalAgentId = (typeof LOCAL_MCP_EXTERNAL_AGENT_IDS)[number]

export type LocalMcpExternalAgentExposure = {
  enabled: boolean
  serverIds: string[]
}

export type LocalMcpExposureConfig = {
  agents: Record<LocalMcpExternalAgentId, LocalMcpExternalAgentExposure>
}

export type LocalMcpAgentDetectionStatus = 'installed' | 'not_installed' | 'manual'

export type LocalMcpAgentRegistrationStatus = 'registered' | 'not_registered' | 'unsupported'

export type LocalMcpDetectedAgent = {
  id: LocalMcpExternalAgentId
  label: string
  status: LocalMcpAgentDetectionStatus
  installed: boolean
  installType: 'protocol' | 'cli' | 'manual' | 'app'
  detectionHint: string
  path: string | null
  registrationSupported: boolean
  registrationStatus: LocalMcpAgentRegistrationStatus
  registrationHint: string
  registrationPath: string | null
}

export type SetLocalMcpAgentRegistrationResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
    }

export const DEFAULT_LOCAL_MCP_EXPOSURE_CONFIG: LocalMcpExposureConfig = {
  agents: {
    workbuddy: {
      enabled: false,
      serverIds: []
    },
    claude_code: {
      enabled: false,
      serverIds: []
    },
    cursor: {
      enabled: false,
      serverIds: []
    },
    codex_cli: {
      enabled: false,
      serverIds: []
    },
    opencode: {
      enabled: false,
      serverIds: []
    }
  }
}

export type GetApiServerStatusResult = {
  running: boolean
  config: ApiServerConfig | null
  actualPort: number | null
}

export type StartApiServerStatusResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
    }

export type RestartApiServerStatusResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
    }

export type StopApiServerStatusResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
    }
