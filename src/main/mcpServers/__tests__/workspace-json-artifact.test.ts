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

  it('should prefer the current project workspace in development when runtime workspace is an internal sandbox path', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-project-'))
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
    await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"workspace-json-artifact-test"}', 'utf8')

    vi.stubEnv('NODE_ENV', 'development')
    vi.spyOn(process, 'cwd').mockReturnValue(projectRoot)

    const artifact = await persistWorkspaceJsonArtifact({
      toolName: 'subtitle-recognition',
      taskId: 'task-002',
      payload: { ok: true },
      workspaceRoot: runtimeWorkspace
    })

    expect(artifact?.filePath).toBe(path.join(projectRoot, '.capcut', 'tool-results', 'subtitle-recognition', 'task-002.json'))
    await fs.rm(projectRoot, { recursive: true, force: true })
    await fs.rm(path.join(os.tmpdir(), 'Library'), { recursive: true, force: true })
  })
})
