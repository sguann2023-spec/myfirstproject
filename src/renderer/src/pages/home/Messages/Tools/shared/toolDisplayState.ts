import type { MCPToolResponse, MCPToolResponseStatus, NormalToolResponse } from '@renderer/types'

import { extractTextPreviewFromToolResult } from './callToolResult'

const BASH_EOF_ERROR_MARKER = 'EOFError: EOF when reading a line'

function isBashTool(toolName?: string): boolean {
  return toolName === 'Bash' || toolName === 'builtin_Bash'
}

export function isBenignBashEofResponse(toolResponse?: MCPToolResponse | NormalToolResponse): boolean {
  if (!toolResponse || !isBashTool(toolResponse.tool?.name) || toolResponse.status !== 'error') {
    return false
  }

  const responseText = extractTextPreviewFromToolResult(toolResponse.responseRaw ?? toolResponse.response)
  return responseText.includes(BASH_EOF_ERROR_MARKER)
}

export function getDisplayToolStatus(
  toolResponse: MCPToolResponse | NormalToolResponse | undefined,
  fallbackStatus?: MCPToolResponseStatus
): MCPToolResponseStatus | undefined {
  const status = fallbackStatus ?? toolResponse?.status
  if (status === 'error' && isBenignBashEofResponse(toolResponse)) {
    return 'done'
  }
  return status
}

export function getDisplayToolHasError(
  toolResponse: MCPToolResponse | NormalToolResponse | undefined,
  fallbackHasError?: boolean
): boolean {
  if (isBenignBashEofResponse(toolResponse)) {
    return false
  }
  return fallbackHasError ?? toolResponse?.response?.isError === true
}
