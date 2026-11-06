import { isAskUserQuestionTool } from '@shared/userInteraction'
import {
  selectPendingPermission,
  selectUniqueActivePermissionByToolName,
  type ToolPermissionsState
} from '../store/toolPermissions'
import type { MCPToolResponse, NormalToolResponse } from '../types'
import { resolveToolArguments } from '@shared/parseToolArguments'

export function restorePendingAskUserQuestion<T extends MCPToolResponse | NormalToolResponse>(
  response: T,
  permissions: ToolPermissionsState
): T {
  if (!isAskUserQuestionTool(response.tool?.name) || ['done', 'error', 'cancelled'].includes(response.status))
    return response
  // Restoration requires an exact call/alias match, never the global tool-name fallback.
  const request =
    selectPendingPermission(permissions, response.toolCallId ?? response.id) ??
    selectPendingPermission(permissions, response.id)
  if (!request || !['pending', 'submitting-allow', 'submitting-deny'].includes(request.status)) return response
  return {
    ...response,
    status: 'pending',
    arguments: resolveToolArguments(request.input, response.arguments, response.partialArguments)
  }
}

export function preserveAskUserQuestionInput<T extends MCPToolResponse | NormalToolResponse>(
  response: T,
  permissions: ToolPermissionsState
): T {
  if (!isAskUserQuestionTool(response.tool?.name)) return response

  const isTerminal = ['done', 'error', 'cancelled'].includes(response.status)
  const request =
    selectPendingPermission(permissions, response.toolCallId ?? response.id) ??
    selectPendingPermission(permissions, response.id) ??
    (isTerminal ? undefined : selectUniqueActivePermissionByToolName(permissions, 'AskUserQuestion'))
  const args = resolveToolArguments(response.arguments, response.partialArguments, request?.input)
  const resolved =
    permissions.resolvedInputs[response.toolCallId ?? response.id] ??
    permissions.resolvedInputs[response.id] ??
    request?.resolvedInput
  if (resolved) return { ...response, arguments: { ...args, ...resolved } }
  if (args === response.arguments) return response

  // Copy request-only questions into the durable snapshot before permission cleanup.
  return { ...response, arguments: args }
}
