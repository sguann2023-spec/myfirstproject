export const BLENDER_INSTALL_URL = 'https://www.blender.org/download/'
export const BLENDER_RENDER_TIMEOUT_MS = 3_600_000
export const BLENDER_MCP_TIMEOUT_SECONDS = 3660

export interface BlenderPathInfo {
  configuredPath: string | null
  path: string | null
  source: 'manual' | 'auto' | null
  status: 'ready' | 'not-found' | 'invalid' | 'error'
  version: string | null
  error?: string
  installUrl: string
}

export interface BlenderPathInfoOptions {
  force?: boolean
}
