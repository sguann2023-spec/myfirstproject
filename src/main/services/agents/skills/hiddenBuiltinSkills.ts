import path from 'node:path'

import { getDataPath } from '../../../utils'

export const HIDDEN_BUILTIN_SKILL_FOLDERS = new Set(['cutskill-creator'])
export const HIDDEN_SKILL_MARKER_FILE = '.cherry-hidden-skill'

export function isHiddenBuiltinSkillFolder(folderName: string): boolean {
  return HIDDEN_BUILTIN_SKILL_FOLDERS.has(folderName)
}

export function getHiddenBuiltinSkillsRoot(): string {
  return getDataPath('GlobalSkills')
}

export function getHiddenBuiltinSkillPath(folderName: string): string {
  return path.join(getHiddenBuiltinSkillsRoot(), folderName)
}

export function getHiddenBuiltinSkillMdPath(folderName: string): string {
  return path.join(getHiddenBuiltinSkillPath(folderName), 'SKILL.md')
}
