import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { persistWorkspaceJsonArtifact } from '../workspace-json-artifact'

describe('persistWorkspaceJsonArtifact', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('should persist under the provided workspace root by default', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-workspace-'))

    const artifact = await persistWorkspaceJsonArtifact({
      toolName: 'subtitle-recognition',
      taskId: 'task-001',
      payload: { ok: true },
      workspaceRoot
    })

    expect(artifact?.filePath).toBe(path.join(workspaceRoot, '.capcut', 'tool-results', 'subtitle-recognition', 'task-001.json'))
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  })

  it('should keep using the provided runtime workspace path in development', async () => {
    const runtimeWorkspace = path.join(
      os.tmpdir(),
      'Library',
      'Application Support',
      '@sun-guannan',
      'vectcutDev',
      'Data',
      'Workspaces',
      'vectcut_claw_default',
      'ws-test'
    )

    await fs.mkdir(runtimeWorkspace, { recursive: true })

    vi.stubEnv('NODE_ENV', 'development')

    const artifact = await persistWorkspaceJsonArtifact({
      toolName: 'subtitle-recognition',
      taskId: 'task-002',
      payload: { ok: true },
      workspaceRoot: runtimeWorkspace
    })

    expect(artifact?.filePath).toBe(
      path.join(runtimeWorkspace, '.capcut', 'tool-results', 'subtitle-recognition', 'task-002.json')
    )
    await fs.rm(path.join(os.tmpdir(), 'Library'), { recursive: true, force: true })
  })

  it('should support writing directly under the workspace root', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-flat-workspace-'))

    const artifact = await persistWorkspaceJsonArtifact({
      toolName: 'subtitle-recognition',
      taskId: 'task-003',
      payload: { ok: true },
      workspaceRoot,
      relativeDirSegments: []
    })

    expect(artifact?.filePath).toBe(path.join(workspaceRoot, 'task-003.json'))
    expect(artifact?.relativePath).toBe('task-003.json')
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  })
})
