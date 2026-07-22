import { describe, expect, it } from 'vitest'

import { buildHostSkillInvocationPrompt } from '../SkillPromptBridge'

describe('buildHostSkillInvocationPrompt', () => {
  it('injects resolved skill markdown and preserves the original user request', () => {
    const result = buildHostSkillInvocationPrompt({
      prompt: '@儿童绘本 制作一个绘本',
      skillName: '儿童绘本',
      skillMdPath: '/workspace/.claude/skills/儿童绘本/SKILL.md',
      skillMarkdown: '# 儿童绘本技能\n\n先创建草稿。',
      triggerMode: 'explicit'
    })

    expect(result).toContain('[Host-resolved local skill invocation]')
    expect(result).toContain('`儿童绘本`')
    expect(result).toContain('`/workspace/.claude/skills/儿童绘本/SKILL.md`')
    expect(result).toContain('<skill_md>')
    expect(result).toContain('先创建草稿。')
    expect(result).toContain('[User request]')
    expect(result).toContain('@儿童绘本 制作一个绘本')
    expect(result).toContain('Do not spend tools rediscovering the skill')
  })
})
