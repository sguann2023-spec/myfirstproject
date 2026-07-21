import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn()
}))

import { readFile, stat } from 'node:fs/promises'

import { buildWorkspaceSkillMountPacket } from '../SkillMountPacketBuilder'

const mockedReadFile = vi.mocked(readFile)
const mockedStat = vi.mocked(stat)

describe('buildWorkspaceSkillMountPacket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedReadFile.mockResolvedValue(Buffer.from('skill content'))
    mockedStat.mockResolvedValue({ mtimeMs: 1234 } as any)
  })

  it('records sdk auto-discovery state in the packet', async () => {
    const packet = await buildWorkspaceSkillMountPacket({
      workspaceId: '/workspace',
      sessionId: 'session-1',
      turn: 3,
      workspacePath: '/workspace',
      skill: {
        name: '儿童绘本',
        filename: '儿童绘本',
        description: '生成儿童绘本故事'
      },
      mountMode: 'invoke',
      triggerMode: 'explicit',
      matchedBy: ['name'],
      matchedEvidence: ['儿童绘本'],
      routeReason: ['skills.invoke_skill:explicit'],
      promptHintLevel: 'hard',
      sdkDiscovered: true
    })

    expect(packet.sdkDiscovered).toBe(true)
    expect(packet.skill.skillMdPath).toBe('/workspace/.claude/skills/儿童绘本/SKILL.md')
    expect(packet.matchedBy).toEqual(['name'])
  })
})
