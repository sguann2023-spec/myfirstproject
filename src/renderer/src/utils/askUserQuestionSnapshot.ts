import {
  selectPendingPermission,
  selectUniqueActivePermissionByToolName,
  type ToolPermissionsState
} from '../store/toolPermissions'
import type { MCPToolResponse, NormalToolResponse } from '../types'
import { resolveToolArguments } from '@shared/parseToolArguments'

export function preserveAskUserQuestionInput<T extends MCPToolResponse | NormalToolResponse>(
  response: T,
  permissions: ToolPermissionsState
): T {
  if (response.tool?.name !== 'AskUserQuestion') return response

  const isTerminal = ['done', 'error', 'cancelled'].includes(response.status)
  const request = selectPendingPermission(permissions, response.toolCallId ?? response.id)
    ?? selectPendingPermission(permissions, response.id)
    ?? (isTerminal ? undefined : selectUniqueActivePermissionByToolName(permissions, 'AskUserQuestion'))
  const args = resolveToolArguments(response.arguments, response.partialArguments, request?.input)
  if (args === response.arguments) return response

  // Copy request-only questions into the durable snapshot before permission cleanup.
  return { ...response, arguments: args }
}
