import * as fs from 'node:fs'
import path from 'node:path'

export type WorkspaceSkillSurface = {
  exists: boolean
  skillDirCount: number
  skillMdCount: number
  skillMdBytes: number
  largestSkillMdBytes: number
  skillNamesPreview: string[]
  error?: string
}

export async function scanWorkspaceSkillSurface(workspacePath: string): Promise<WorkspaceSkillSurface> {
  const skillsDir = path.join(workspacePath, '.claude', 'skills')
  try {
    const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
    const skillDirNames: string[] = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const skillPath = path.join(skillsDir, entry.name)
      try {
        const stats = await fs.promises.stat(skillPath)
        if (stats.isDirectory()) {
          skillDirNames.push(entry.name)
        }
      } catch {
        // Ignore unreadable entries.
      }
    }

    const skillDirs = skillDirNames.sort()
    let skillMdCount = 0
    let skillMdBytes = 0
    let largestSkillMdBytes = 0

    for (const skillName of skillDirs) {
      const skillMdPath = path.join(skillsDir, skillName, 'SKILL.md')
      try {
        const stats = await fs.promises.stat(skillMdPath)
        skillMdCount += 1
        skillMdBytes += stats.size
        largestSkillMdBytes = Math.max(largestSkillMdBytes, stats.size)
      } catch {
        // A directory without SKILL.md is not loadable as a Claude skill.
      }
    }

    return {
      exists: true,
      skillDirCount: skillDirs.length,
      skillMdCount,
      skillMdBytes,
      largestSkillMdBytes,
      skillNamesPreview: skillDirs.slice(0, 30)
    }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT') {
      return {
        exists: false,
        skillDirCount: 0,
        skillMdCount: 0,
        skillMdBytes: 0,
        largestSkillMdBytes: 0,
        skillNamesPreview: []
      }
    }

    return {
      exists: false,
      skillDirCount: 0,
      skillMdCount: 0,
      skillMdBytes: 0,
      largestSkillMdBytes: 0,
      skillNamesPreview: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
