export type SkillMountMode = 'none' | 'awareness' | 'invoke'

export type SkillTriggerMode = 'explicit' | 'implicit'

export type SkillMatchSignal =
  | 'name'
  | 'filename'
  | 'description'
  | 'alias'
  | 'tag'
  | 'skill-md-trigger'
  | 'skill-md-scope'

export type SkillMountPromptHintLevel = 'none' | 'soft' | 'hard'

export type SkillMountPacket = {
  workspaceId: string
  sessionId: string
  turn: number
  mountMode: SkillMountMode
  triggerMode: SkillTriggerMode
  source: 'workspace-local' | 'global-cache'
  sdkDiscovered: boolean
  skill: {
    id: string
    folderName: string
    displayName: string
    skillMdPath: string
    description?: string
    aliases: string[]
    tags: string[]
    contentHash: string
    updatedAt: number
  }
  matchedBy: SkillMatchSignal[]
  matchedEvidence: string[]
  routeReason: string[]
  promptHintLevel: SkillMountPromptHintLevel
}
