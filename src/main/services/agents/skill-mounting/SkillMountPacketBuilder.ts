import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

import type {
  SkillMatchSignal,
  SkillMountMode,
  SkillMountPacket,
  SkillMountPromptHintLevel,
  SkillTriggerMode
} from './types'

type WorkspaceSkillSnapshot = {
  name: string
  filename: string
  description?: string
  skillMdPath?: string
  source?: 'workspace' | 'global'
}

export async function buildWorkspaceSkillMountPacket(args: {
  workspaceId: string
  sessionId: string
  turn: number
  workspacePath: string
  skill: WorkspaceSkillSnapshot
  mountMode: Extract<SkillMountMode, 'awareness' | 'invoke'>
  triggerMode: SkillTriggerMode
  matchedBy: SkillMatchSignal[]
  matchedEvidence: string[]
  routeReason: string[]
  promptHintLevel: SkillMountPromptHintLevel
  sdkDiscovered: boolean
}): Promise<SkillMountPacket> {
  const skillMdPath = args.skill.skillMdPath ?? path.join(args.workspacePath, '.claude', 'skills', args.skill.filename, 'SKILL.md')
  const contentHash = await readFileHash(skillMdPath)
  const updatedAt = await readFileUpdatedAt(skillMdPath)

  return {
    workspaceId: args.workspaceId,
    sessionId: args.sessionId,
    turn: args.turn,
    mountMode: args.mountMode,
    triggerMode: args.triggerMode,
    source: args.skill.source === 'global' ? 'global-cache' : 'workspace-local',
    sdkDiscovered: args.sdkDiscovered,
    skill: {
      id: `workspace-local:${args.skill.filename}`,
      folderName: args.skill.filename,
      displayName: args.skill.name || args.skill.filename,
      skillMdPath,
      description: args.skill.description,
      aliases: [],
      tags: [],
      contentHash,
      updatedAt
    },
    matchedBy: dedupe(args.matchedBy),
    matchedEvidence: dedupe(args.matchedEvidence),
    routeReason: dedupe(args.routeReason),
    promptHintLevel: args.promptHintLevel
  }
}

async function readFileHash(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath)
    return createHash('sha256').update(content).digest('hex')
  } catch {
    return ''
  }
}

async function readFileUpdatedAt(filePath: string): Promise<number> {
  try {
    const fileStat = await stat(filePath)
    return Number(fileStat.mtimeMs || 0)
  } catch {
    return 0
  }
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}
