import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

type PersistWorkspaceJsonArtifactInput = {
  toolName: string
  taskId?: string
  payload: unknown
  workspaceRoot?: string
}

type PersistWorkspaceJsonArtifactResult = {
  filePath: string
  relativePath: string
}

function sanitizePathSegment(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isInternalRuntimeWorkspacePath(value: string): boolean {
  const normalized = path.normalize(String(value || '')).toLowerCase()
  return normalized.includes(`${path.sep}data${path.sep}workspaces${path.sep}`)
}

function resolveArtifactWorkspaceRoot(explicitWorkspaceRoot?: string): string {
  const workspaceRoot = String(explicitWorkspaceRoot || process.env.WORKSPACE_ROOT || '').trim()
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    return ''
  }

  const devWorkspaceRoot = String(process.cwd() || '').trim()
  const shouldPreferDevWorkspace =
    process.env.NODE_ENV === 'development'
    && isInternalRuntimeWorkspacePath(workspaceRoot)
    && path.isAbsolute(devWorkspaceRoot)
    && existsSync(path.join(devWorkspaceRoot, 'package.json'))

  return shouldPreferDevWorkspace ? path.normalize(path.resolve(devWorkspaceRoot)) : workspaceRoot
}

export async function persistWorkspaceJsonArtifact(
  input: PersistWorkspaceJsonArtifactInput
): Promise<PersistWorkspaceJsonArtifactResult | null> {
  const workspaceRoot = resolveArtifactWorkspaceRoot(input.workspaceRoot)
  if (!workspaceRoot) {
    return null
  }

  const toolDirName = sanitizePathSegment(input.toolName) || 'tool-result'
  const taskId = sanitizePathSegment(input.taskId || '') || `result-${Date.now()}`
  const artifactDir = path.join(workspaceRoot, '.capcut', 'tool-results', toolDirName)
  const filePath = path.join(artifactDir, `${taskId}.json`)

  await fs.mkdir(artifactDir, { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(input.payload, null, 2), 'utf8')

  return {
    filePath,
    relativePath: path.relative(workspaceRoot, filePath) || path.basename(filePath)
  }
}
