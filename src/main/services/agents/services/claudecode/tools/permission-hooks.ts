import * as fs from 'node:fs'

import type { CanUseTool, HookCallback } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'

import { buildNamespacedToolCallId } from '../claude-stream-state'
import { promptForToolApproval } from '../tool-permissions'

const logger = loggerService.withContext('ClaudeCodeToolPermissions')
const shouldAutoApproveTools = process.env.CHERRY_AUTO_ALLOW_TOOLS !== '0'

type ApprovalCacheValue =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

export function createToolPermissionHandlers(input: {
  sessionId: string
  cwd: string
  autoAllowTools: Set<string>
  sessionAllowedTools: Set<string>
  readFilesInSession: Set<string>
  interactiveApprovalCache: Map<string, ApprovalCacheValue>
  capturePendingFileChanges: (toolName: string, toolInput: unknown, toolCallId: string) => Promise<void>
  normalizeToolName: (name: string) => string
  requiresInteractiveApproval: (name: string) => boolean
  isRecord: (value: unknown) => value is Record<string, unknown>
  attachInternalToolContext: (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolCallId: string
  ) => Record<string, unknown>
  resolveToolFilePath: (toolInput: unknown, defaultCwd: string) => string | null
}): {
  canUseTool: CanUseTool
  preToolUseHook: HookCallback
  postToolUseHook: HookCallback
} {
  const {
    sessionId,
    cwd,
    autoAllowTools,
    sessionAllowedTools,
    readFilesInSession,
    interactiveApprovalCache,
    capturePendingFileChanges,
    normalizeToolName,
    requiresInteractiveApproval,
    isRecord,
    attachInternalToolContext,
    resolveToolFilePath
  } = input

  const canUseTool: CanUseTool = async (toolName, toolInput, options) => {
    logger.info('Handling tool permission check', {
      toolName,
      suggestionCount: options.suggestions?.length ?? 0
    })
    const normalizedToolName = normalizeToolName(toolName)

    if (options.signal.aborted) {
      logger.debug('Permission request signal already aborted; denying tool', { toolName })
      return {
        behavior: 'deny',
        message: 'Tool request was cancelled before prompting the user'
      }
    }

    if (requiresInteractiveApproval(toolName)) {
      const namespacedToolCallId = buildNamespacedToolCallId(sessionId, options.toolUseID)
      const cachedApproval = interactiveApprovalCache.get(namespacedToolCallId)
      if (cachedApproval) {
        interactiveApprovalCache.delete(namespacedToolCallId)
        logger.info('Reusing cached interactive approval for tool', {
          toolName,
          normalizedToolName,
          namespacedToolCallId,
          behavior: cachedApproval.behavior
        })
        return cachedApproval.behavior === 'allow'
          ? { behavior: 'allow', updatedInput: cachedApproval.updatedInput }
          : { behavior: 'deny', message: cachedApproval.message }
      }

      logger.debug('Forcing interactive approval for tool', {
        toolName,
        normalizedToolName,
        namespacedToolCallId
      })
      return promptForToolApproval(toolName, toolInput, {
        ...options,
        toolCallId: namespacedToolCallId
      })
    }

    if (shouldAutoApproveTools) {
      logger.debug('Auto-approving tool due to CHERRY_AUTO_ALLOW_TOOLS flag', { toolName })
      return { behavior: 'allow', updatedInput: toolInput }
    }

    if (autoAllowTools.has(toolName) || autoAllowTools.has(normalizedToolName)) {
      logger.debug('Auto-allowing tool from allowed list', {
        toolName,
        normalizedToolName
      })
      if (normalizedToolName === 'Bash') {
        logger.info('CURL_PROBE Bash canUseTool decision', {
          toolName,
          normalizedToolName,
          decision: 'allow:autoAllowTools'
        })
      }
      return { behavior: 'allow', updatedInput: toolInput }
    }

    if (normalizedToolName === 'Bash') {
      logger.info('CURL_PROBE Bash canUseTool decision', {
        toolName,
        normalizedToolName,
        decision: 'promptForApproval'
      })
    }

    return promptForToolApproval(toolName, toolInput, {
      ...options,
      toolCallId: buildNamespacedToolCallId(sessionId, options.toolUseID)
    })
  }

  const preToolUseHook: HookCallback = async (hookEvent, toolUseID, options) => {
    if (hookEvent.hook_event_name !== 'PreToolUse') {
      return {}
    }

    const toolName = hookEvent.tool_name
    const normalizedToolName = normalizeToolName(toolName)

    logger.debug('PreToolUse hook triggered', {
      session_id: hookEvent.session_id,
      tool_name: hookEvent.tool_name,
      tool_use_id: toolUseID,
      tool_input: hookEvent.tool_input,
      cwd: hookEvent.cwd,
      permission_mode: hookEvent.permission_mode,
      autoAllowTools
    })

    if (toolName === 'Bash' || toolName === 'builtin_Bash') {
      const bypassAll = hookEvent.permission_mode === 'bypassPermissions'
      const autoAllowed = autoAllowTools.has(toolName) || autoAllowTools.has(normalizedToolName)
      logger.info('CURL_PROBE Bash PreToolUse snapshot', {
        sessionId,
        toolName,
        normalizedToolName,
        permissionMode: hookEvent.permission_mode,
        bypassAll,
        autoAllowed,
        sessionAllowsBash: sessionAllowedTools.has('Bash') || sessionAllowedTools.has('builtin_Bash'),
        sessionAllowedTools: Array.from(sessionAllowedTools).sort()
      })
    }

    if (options?.signal?.aborted) {
      logger.debug('PreToolUse hook signal already aborted; skipping tool use', {
        tool_name: hookEvent.tool_name
      })
      return {}
    }

    if (normalizedToolName === 'Write') {
      const targetFilePath = resolveToolFilePath(hookEvent.tool_input, hookEvent.cwd || cwd)
      if (targetFilePath && fs.existsSync(targetFilePath) && !readFilesInSession.has(targetFilePath)) {
        logger.warn('Blocked Write without prior Read in current invoke session', {
          sessionId,
          toolUseID: toolUseID ?? '',
          targetFilePath
        })
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'Write to existing files requires Read first in the same session.',
            additionalContext: `Use Read with file_path="${targetFilePath}" first, then retry Write.`
          }
        }
      }
    }

    if (toolUseID) {
      const bypassAll = hookEvent.permission_mode === 'bypassPermissions'
      const autoAllowed = autoAllowTools.has(toolName) || autoAllowTools.has(normalizedToolName)
      const needsInteractiveApproval = requiresInteractiveApproval(toolName)
      const namespacedToolCallId = buildNamespacedToolCallId(sessionId, toolUseID)

      await capturePendingFileChanges(toolName, hookEvent.tool_input, namespacedToolCallId)

      if (needsInteractiveApproval && (bypassAll || autoAllowed)) {
        logger.info('Forcing interactive PreToolUse approval for tool', {
          toolName,
          normalizedToolName,
          namespacedToolCallId,
          permission_mode: hookEvent.permission_mode,
          bypassAll,
          autoAllowed
        })
        const updatedToolInput = attachInternalToolContext(
          toolName,
          isRecord(hookEvent.tool_input) ? hookEvent.tool_input : {},
          namespacedToolCallId
        )
        const approval = await promptForToolApproval(toolName, updatedToolInput, {
          ...options,
          toolCallId: namespacedToolCallId
        })

        if (approval.behavior === 'allow') {
          interactiveApprovalCache.set(namespacedToolCallId, {
            behavior: 'allow',
            updatedInput: isRecord(approval.updatedInput) ? approval.updatedInput : updatedToolInput
          })
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              updatedInput: isRecord(approval.updatedInput) ? approval.updatedInput : updatedToolInput
            }
          }
        }

        interactiveApprovalCache.set(namespacedToolCallId, {
          behavior: 'deny',
          message: approval.message ?? 'User denied permission for this tool'
        })
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: approval.message ?? 'User denied permission for this tool'
          }
        }
      }

      if (bypassAll || autoAllowed) {
        logger.debug('handling auto approved tools', {
          toolName,
          normalizedToolName,
          namespacedToolCallId,
          permission_mode: hookEvent.permission_mode,
          autoAllowTools
        })
        const updatedToolInput = attachInternalToolContext(
          toolName,
          isRecord(hookEvent.tool_input) ? hookEvent.tool_input : {},
          namespacedToolCallId
        )

        await promptForToolApproval(toolName, updatedToolInput, {
          ...options,
          toolCallId: namespacedToolCallId,
          autoApprove: true
        })
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            updatedInput: updatedToolInput
          }
        }
      }
    }

    return {}
  }

  const postToolUseHook: HookCallback = async (hookEvent) => {
    if (hookEvent.hook_event_name !== 'PostToolUse') {
      return {}
    }

    const normalizedToolName = normalizeToolName(hookEvent.tool_name)
    if (normalizedToolName !== 'Read') {
      return {}
    }

    const filePath = resolveToolFilePath(hookEvent.tool_input, hookEvent.cwd || cwd)
    if (!filePath) {
      return {}
    }

    readFilesInSession.add(filePath)
    logger.debug('Recorded Read tool path for Write guard', {
      sessionId,
      filePath,
      trackedReadFileCount: readFilesInSession.size
    })
    return {}
  }

  return {
    canUseTool,
    preToolUseHook,
    postToolUseHook
  }
}
