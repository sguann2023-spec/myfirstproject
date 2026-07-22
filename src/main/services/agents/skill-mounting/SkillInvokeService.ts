import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { SkillTriggerMode } from './types'

export type ResolvedWorkspaceSkillInvocation = {
  skillName: string
  skillMdPath: string
  skillMarkdown: string
  triggerMode: SkillTriggerMode
}

export async function resolveWorkspaceSkillInvocation(args: {
  workspacePath: string
  skillName: string
  triggerMode: SkillTriggerMode
}): Promise<ResolvedWorkspaceSkillInvocation> {
  const workspacePath = path.resolve(String(args.workspacePath || ''))
  const skillName = String(args.skillName || '').trim()
  const skillMdPath = path.join(workspacePath, '.claude', 'skills', skillName, 'SKILL.md')
  const skillMarkdown = await readFile(skillMdPath, 'utf-8')

  return {
    skillName,
    skillMdPath,
    skillMarkdown,
    triggerMode: args.triggerMode
  }
}
