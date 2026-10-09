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
  const explicitPath = String(args.skillMdPath || '').trim()
  const workspacePath = path.join(args.workspacePath, '.claude', 'skills', skillName, 'SKILL.md')

  if (explicitPath) {
    return readSkillInvocation(explicitPath, skillName, args.triggerMode)
  }

  try {
    return await readSkillInvocation(workspacePath, skillName, args.triggerMode)
  } catch (workspaceError) {
    const globalPath = path.join(getGlobalSkillsRoot(), skillName, 'SKILL.md')
    try {
      return await readSkillInvocation(globalPath, skillName, args.triggerMode)
    } catch {
      throw workspaceError
    }
  }
}

async function readSkillInvocation(
  skillMdPath: string,
  skillName: string,
  triggerMode: SkillTriggerMode
): Promise<ResolvedWorkspaceSkillInvocation> {
  const skillMarkdown = await readFile(skillMdPath, 'utf-8')
  return {
    skillName,
    skillMdPath,
    skillMarkdown,
    triggerMode
  }
}
