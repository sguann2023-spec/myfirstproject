import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveWorkspaceSkillInvocation } from '../SkillInvokeService'

const tempDirs: string[] = []

describe('resolveWorkspaceSkillInvocation', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true }))
    )
  })

  it('reads the full SKILL.md from the workspace local skill directory', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'skill-invoke-'))
    tempDirs.push(workspace)
    const skillDir = path.join(workspace, '.claude', 'skills', '儿童绘本')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), '# 儿童绘本技能\n\n先创建草稿。', 'utf-8')

    const result = await resolveWorkspaceSkillInvocation({
      workspacePath: workspace,
      skillName: '儿童绘本',
      triggerMode: 'explicit'
    })

    expect(result.skillName).toBe('儿童绘本')
    expect(result.triggerMode).toBe('explicit')
    expect(result.skillMdPath).toBe(path.join(skillDir, 'SKILL.md'))
    expect(result.skillMarkdown).toContain('先创建草稿。')
  })
})
