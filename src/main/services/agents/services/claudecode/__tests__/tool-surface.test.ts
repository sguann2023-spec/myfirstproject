import { describe, expect, it } from 'vitest'

import { addAutoAllowedTool, buildToolSurface } from '../tool-surface'

const BASE_BUILTIN_TOOLS = ['AskUserQuestion', 'Bash', 'Read', 'Write', 'Edit']
const BASE_AUTO_ALLOWED_TOOLS = ['Write', 'Edit']

describe('buildToolSurface', () => {
  it('always exposes AskUserQuestion, Bash and the file builtins as direct builtin tools', () => {
    const surface = buildToolSurface({
      sessionAllowedTools: ['Bash', 'Read', 'Write', 'mcp__skills__*'],
      isAssistant: false
    })

    expect(surface.layer).toBe('codemode')
    expect(surface.toolsOption).toEqual(BASE_BUILTIN_TOOLS)
    expect(surface.builtinTools).toEqual(BASE_BUILTIN_TOOLS)
    expect(Array.from(surface.autoAllowedTools)).toEqual([...BASE_AUTO_ALLOWED_TOOLS, 'mcp__skills__*'])
  })

  it('keeps Bash and the file builtins available for assistant sessions', () => {
    const surface = buildToolSurface({
      sessionAllowedTools: ['Bash', 'Read', 'Write'],
      isAssistant: true
    })

    expect(surface.builtinTools).toEqual(BASE_BUILTIN_TOOLS)
    expect(Array.from(surface.autoAllowedTools)).toEqual(BASE_AUTO_ALLOWED_TOOLS)
  })

  it('exposes the file builtins regardless of an explicit skill invocation', () => {
    const surface = buildToolSurface({
      sessionAllowedTools: [],
      isAssistant: false,
      hasExplicitSkillInvocation: true
    })

    expect(surface.builtinTools).toEqual(BASE_BUILTIN_TOOLS)
    expect(surface.toolsOption).toEqual(BASE_BUILTIN_TOOLS)
  })

  it('updates the sorted auto-allow option when MCP patterns are added', () => {
    const surface = buildToolSurface({
      sessionAllowedTools: [],
      isAssistant: false
    })

    addAutoAllowedTool(surface, 'mcp__skills__*')
    addAutoAllowedTool(surface, 'mcp__draft-management__*')

    expect(Array.from(surface.autoAllowedTools).sort()).toEqual([
      'Edit',
      'Write',
      'mcp__draft-management__*',
      'mcp__skills__*'
    ])
  })
})
