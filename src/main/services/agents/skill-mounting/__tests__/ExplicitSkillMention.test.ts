import { describe, expect, it } from 'vitest'

import { resolveExplicitSkillMention, resolveSkillInvocationMention } from '../ExplicitSkillMention'

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
  it('pins homepage execution to the selected hidden package while preserving installed member usage', () => {
    const hidden = [{ ...skills[0], version: '2.0.0', path: '/quick/viral-talking-head/2.0.0' }]
    const prompt = '使用@网感口播 技能，剪辑'
    expect(resolveSkillInvocationMention(prompt, skills, hidden)?.skill.path).toBe('/skills/viral-talking-head')
    expect(resolveSkillInvocationMention(prompt, skills, hidden, { folderName: 'viral-talking-head', version: '2.0.0' })?.skill.path).toBe('/quick/viral-talking-head/2.0.0')
    expect(() => resolveSkillInvocationMention(prompt, skills, hidden, { folderName: 'viral-talking-head', version: '1.0.0' })).toThrow('版本已不可用')
    expect(() => resolveSkillInvocationMention('删除了技能提及', skills, hidden, { folderName: 'viral-talking-head', version: '2.0.0' })).toThrow('保留模版的技能提及')
  })
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

  it('resolves the template prompt prefix without a space before @', () => {
    expect(resolveExplicitSkillMention('使用@网感口播 技能，处理视频', skills)?.skill.filename).toBe('viral-talking-head')
  })

  it('does not perform implicit or partial skill matching', () => {
    expect(resolveExplicitSkillMention('请做一个网感口播视频', skills)).toBeUndefined()
    expect(resolveExplicitSkillMention('@网感口播增强 处理视频', skills)).toBeUndefined()
  })
})
