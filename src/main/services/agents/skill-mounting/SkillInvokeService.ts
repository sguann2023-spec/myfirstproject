import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { getGlobalSkillsRoot } from '../skills/paths'

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
  skillMdPath?: string
  triggerMode: SkillTriggerMode
}): Promise<ResolvedWorkspaceSkillInvocation> {
  const skillName = String(args.skillName || '').trim()
  const skillMdPath = String(args.skillMdPath || '').trim() || path.join(getGlobalSkillsRoot(), skillName, 'SKILL.md')
  const skillMarkdown = await readFile(skillMdPath, 'utf-8')

  return {
    skillName,
    skillMdPath,
    skillMarkdown,
    triggerMode: args.triggerMode
  }
}
