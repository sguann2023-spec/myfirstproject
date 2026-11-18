import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubEnv('CHERRY_AUTO_ALLOW_TOOLS', '1')
const approval = vi.hoisted(() => vi.fn())
vi.mock('../tool-permissions', () => ({ promptForToolApproval: approval }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ debug() {}, info() {}, warn() {} }) } }))
vi.mock('../session-architecture/FileChangeJournalService', () => ({ fileChangeJournalService: {} }))

import { createToolPermissionHandlers } from '../tools/permission-hooks'
import { requiresInteractiveApproval, normalizeToolName, isRecord } from '../tools/runtime-file-helpers'

function createHandlers(autoAllowTools = new Set<string>()) {
  return createToolPermissionHandlers({
    sessionId: 'session-1', cwd: '/tmp/workspace', autoAllowTools,
    sessionAllowedTools: new Set(), readFilesInSession: new Set(), interactiveApprovalCache: new Map(),
    capturePendingFileChanges: vi.fn(async () => {}), normalizeToolName, requiresInteractiveApproval, isRecord,
    attachInternalToolContext: (_name, input) => input, resolveToolFilePath: () => null
  })
}

beforeEach(() => {
  approval.mockReset()
  approval.mockResolvedValue({ behavior: 'allow', updatedInput: {} })
})

describe('local Blender uses the existing tool execution policy', () => {
  const name = 'mcp__vectcut__blender-local__blender_render'

  it.each([name, 'mcp__blender-local__blender_render', `builtin_${name}`, 'blender-local:blender_render'])(
    'does not require extra interaction for %s', tool => {
      expect(requiresInteractiveApproval(tool)).toBe(false)
    }
  )

  it('preserves business question interaction', () => {
    expect(requiresInteractiveApproval('AskUserQuestion')).toBe(true)
    expect(requiresInteractiveApproval('mcp__vectcut__user-interaction__AskUserQuestion')).toBe(true)
    expect(requiresInteractiveApproval('mcp__vectcut__blender-local__blender_status')).toBe(false)
  })

  it('runs under the existing automatic policy without an approval request', async () => {
    const input = { script: 'import bpy' }
    const result = await createHandlers().canUseTool(name, input, {
      signal: new AbortController().signal, toolUseID: 'render-1'
    } as any)
    expect(result).toEqual({ behavior: 'allow', updatedInput: input })
    expect(approval).not.toHaveBeenCalled()
  })

  it('retains the existing bypass hook without forcing manual approval', async () => {
    const handlers = createHandlers()
    const signal = new AbortController().signal
    const input = { script: 'import bpy' }
    const decision = await handlers.preToolUseHook({
      hook_event_name: 'PreToolUse', tool_name: name, tool_input: input,
      permission_mode: 'bypassPermissions', cwd: '/tmp/workspace', session_id: 'session-1'
    } as any, 'render-2', { signal } as any)
    expect(decision).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } })
    expect(approval).toHaveBeenCalledWith(name, input, expect.objectContaining({ autoApprove: true }))
  })

  it('still denies an already-cancelled request without prompting', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await createHandlers().canUseTool(name, {}, { signal: controller.signal, toolUseID: 'cancelled' } as any))
      .toMatchObject({ behavior: 'deny' })
    expect(approval).not.toHaveBeenCalled()
  })
})
