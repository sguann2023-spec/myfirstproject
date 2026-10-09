import { describe, expect, it } from 'vitest'

import { addAutoAllowedTool, buildToolSurface } from '../tool-surface'

describe('buildToolSurface', () => {
  it('always exposes AskUserQuestion and Bash as direct builtin tools', () => {
    const surface = buildToolSurface({
      sessionAllowedTools: ['Bash', 'Read', 'Write', 'mcp__skills__*'],
      isAssistant: false
    })

    expect(surface.layer).toBe('codemode')
    expect(surface.toolsOption).toEqual(['AskUserQuestion', 'Bash'])
    expect(surface.builtinTools).toEqual(['AskUserQuestion', 'Bash'])
    expect(Array.from(surface.autoAllowedTools)).toEqual(['mcp__skills__*'])
  })

  it('keeps Bash available but hides local file builtins for assistant sessions', () => {
    const surface = buildToolSurface({
      sessionAllowedTools: ['Bash', 'Read', 'Write'],
      isAssistant: true
    })

    expect(surface.builtinTools).toEqual(['AskUserQuestion', 'Bash'])
    expect(Array.from(surface.autoAllowedTools)).toEqual([])
  })

  it('temporarily exposes Read for an explicit skill invocation', () => {
    const surface = buildToolSurface({
      sessionAllowedTools: [],
      isAssistant: false,
      hasExplicitSkillInvocation: true
    })

    expect(surface.builtinTools).toEqual(['AskUserQuestion', 'Bash', 'Read'])
    expect(surface.toolsOption).toEqual(['AskUserQuestion', 'Bash', 'Read'])
  })

  it('updates the sorted auto-allow option when MCP patterns are added', () => {
    const surface = buildToolSurface({
      sessionAllowedTools: [],
      isAssistant: false
    })

    addAutoAllowedTool(surface, 'mcp__skills__*')
    addAutoAllowedTool(surface, 'mcp__draft-management__*')

    expect(Array.from(surface.autoAllowedTools).sort()).toEqual(['mcp__draft-management__*', 'mcp__skills__*'])
  })
})
