import * as fs from 'node:fs'
import path from 'node:path'

import { fileChangeJournalService } from '../session-architecture/FileChangeJournalService'

export type PendingFileChangeSnapshot = {
  filePath: string
  operation: 'create' | 'update' | 'delete'
  existedBefore: boolean
  beforeSnapshot?: string
  beforeHash?: string
}

export type ApprovalCacheValue =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

export const normalizeToolName = (name: string): string =>
  name.startsWith('builtin_') ? name.slice('builtin_'.length) : name

export const requiresInteractiveApproval = (name: string): boolean => normalizeToolName(name) === 'AskUserQuestion'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export const attachInternalToolContext = (
  toolName: string,
  toolInput: Record<string, unknown>,
  toolCallId: string
): Record<string, unknown> => {
  if (normalizeToolName(toolName) === 'mcp__copylab__derive_copy_prompt') {
    return {
      ...toolInput,
      __toolCallId: toolCallId
    }
  }
  return toolInput
}

export const resolveToolFilePath = (toolInput: unknown, defaultCwd: string): string | null => {
  const input = isRecord(toolInput) ? toolInput : null
  if (!input) return null
  const candidateKeys = ['file_path', 'path', 'filePath', 'target_file']
  for (const key of candidateKeys) {
    const rawPath = input[key]
    if (typeof rawPath !== 'string') continue
    const trimmed = rawPath.trim()
    if (!trimmed) continue
    return path.normalize(path.isAbsolute(trimmed) ? trimmed : path.resolve(defaultCwd, trimmed))
  }
  return null
}

const resolveAbsoluteToolPath = (rawPath: string, defaultCwd: string): string =>
  path.normalize(path.isAbsolute(rawPath) ? rawPath : path.resolve(defaultCwd, rawPath))

export const resolveToolFileTargets = (
  toolName: string,
  toolInput: unknown,
  defaultCwd: string
): Array<{ filePath: string; operation: 'create' | 'update' | 'delete' }> => {
  const normalizedToolName = normalizeToolName(toolName)
  const input = isRecord(toolInput) ? toolInput : null
  if (!input) return []

  if (normalizedToolName === 'DeleteFile') {
    const rawPaths = Array.isArray(input.file_paths)
      ? input.file_paths
      : Array.isArray(input.paths)
        ? input.paths
        : typeof input.file_path === 'string'
          ? [input.file_path]
          : []
    return rawPaths
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((rawPath) => ({
        filePath: resolveAbsoluteToolPath(rawPath.trim(), defaultCwd),
        operation: 'delete' as const
      }))
  }

  const filePath = resolveToolFilePath(toolInput, defaultCwd)
  if (!filePath) {
    return []
  }

  if (normalizedToolName === 'Edit' || normalizedToolName === 'MultiEdit') {
    return [{ filePath, operation: 'update' }]
  }

  if (normalizedToolName === 'Write') {
    return [{ filePath, operation: fs.existsSync(filePath) ? 'update' : 'create' }]
  }

  return []
}

export async function capturePendingFileChanges(input: {
  toolName: string
  toolInput: unknown
  toolCallId: string
  cwd: string
  pendingFileChanges: Map<string, PendingFileChangeSnapshot[]>
}): Promise<void> {
  const { toolName, toolInput, toolCallId, cwd, pendingFileChanges } = input
  const targets = resolveToolFileTargets(toolName, toolInput, cwd)
  if (targets.length === 0) {
    return
  }

  const snapshots = await Promise.all(
    targets.map(async (target) => {
      const before = await fileChangeJournalService.readSnapshot(target.filePath)
      return {
        filePath: target.filePath,
        operation: target.operation,
        existedBefore: before.exists,
        beforeSnapshot: before.content,
        beforeHash: before.hash
      }
    })
  )

  pendingFileChanges.set(toolCallId, snapshots)
}
