import { describe, expect, it } from 'vitest'

import { resolveExplicitSkillMention } from '../ExplicitSkillMention'

const skills = [
  {
    name: '网感口播',
    filename: 'viral-talking-head',
    path: '/skills/viral-talking-head',
    source: 'global' as const
  },
  {
    name: '网感',
    filename: 'viral',
    path: '/skills/viral',
    source: 'global' as const
  }
]

describe('resolveExplicitSkillMention', () => {
  it('matches the exact display name selected by the composer', () => {
    const result = resolveExplicitSkillMention('@网感口播 处理一下这条口播', skills)

    expect(result?.skill.filename).toBe('viral-talking-head')
    expect(result?.matchedLabel).toBe('网感口播')
  })

  it('matches a folder name and prefers the longest exact label', () => {
    const result = resolveExplicitSkillMention('请用 @viral-talking-head 处理视频', skills)

    expect(result?.skill.name).toBe('网感口播')
    expect(result?.matchedLabel).toBe('viral-talking-head')
  })

  it('does not perform implicit or partial skill matching', () => {
    expect(resolveExplicitSkillMention('请做一个网感口播视频', skills)).toBeUndefined()
    expect(resolveExplicitSkillMention('@网感口播增强 处理视频', skills)).toBeUndefined()
  })
})
