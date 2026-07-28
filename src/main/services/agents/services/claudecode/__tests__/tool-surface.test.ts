import { describe, expect, it } from 'vitest'

import type { CapabilityDecision } from '../capability-router'
import { addAutoAllowedTool, buildToolSurface } from '../tool-surface'

const makeDecision = (args: Partial<CapabilityDecision> & Pick<CapabilityDecision, 'toolLayer'>): CapabilityDecision => ({
  turn: 1,
  selected: new Set(),
  reasons: {},
  stickyApplied: [],
  activeDomains: [],
  primaryDomain: 'chat',
  subdomains: [],
  companionDomains: [],
  domainReasons: ['chat:default'],
  preferredMcpTools: [],
  toolLayer: args.toolLayer,
  toolLayerReasons: ['prompt:chat'],
  ...args
})

describe('buildToolSurface', () => {
  it('disables all built-in tools for chat turns', () => {
    const surface = buildToolSurface({
      decision: makeDecision({ toolLayer: 'chat' }),
      sessionAllowedTools: ['Bash', 'mcp__skills__*'],
      isAssistant: false
    })

    expect(surface.toolsOption).toEqual([])
    expect(surface.builtinTools).toEqual([])
    expect(surface.allowedToolsOption).toEqual(['mcp__skills__*'])
  })

  it('exposes Bash for chat.bash turns without auto-allowing it', () => {
    const surface = buildToolSurface({
      decision: makeDecision({
        toolLayer: 'chat',
        activeDomains: [{ domain: 'chat', subdomains: ['bash'], role: 'primary', score: 2 }],
        primaryDomain: 'chat',
        subdomains: ['bash'],
        domainReasons: ['chat.bash:capability:chat-bash'],
        selected: new Set(['bash'] as any)
      }),
      sessionAllowedTools: [],
      isAssistant: false
    })

    expect(surface.toolsOption).toEqual(['Bash'])
    expect(surface.builtinTools).toEqual(['Bash'])
    expect(surface.allowedToolsOption).not.toContain('Bash')
  })

  it('enables only read tools for workspace-read turns', () => {
    const surface = buildToolSurface({
      decision: makeDecision({
        toolLayer: 'workspace-read',
        activeDomains: [{ domain: 'workspace', subdomains: ['read'], role: 'primary', score: 2 }],
        primaryDomain: 'workspace',
        subdomains: ['read']
      }),
      sessionAllowedTools: [],
      isAssistant: false
    })

    expect(surface.toolsOption).toEqual(['Read', 'Glob', 'Grep'])
    expect(surface.allowedToolsOption).toEqual(['Glob', 'Grep', 'Read'])
  })

  it('adds Bash to web turns while keeping workspace builtins hidden', () => {
    const surface = buildToolSurface({
      decision: makeDecision({
        toolLayer: 'web',
        activeDomains: [{ domain: 'web', subdomains: ['browser'], role: 'primary', score: 3 }],
        primaryDomain: 'web',
        subdomains: ['browser']
      }),
      sessionAllowedTools: ['mcp__search__*', 'mcp__browser__*'],
      isAssistant: false
    })

    expect(surface.toolsOption).toEqual(['Bash'])
    expect(surface.builtinTools).toEqual(['Bash'])
    expect(surface.allowedToolsOption).toEqual(['mcp__browser__*', 'mcp__search__*'])
  })

  it('adds Bash to cut turns', () => {
    const surface = buildToolSurface({
      decision: makeDecision({
        toolLayer: 'chat',
        activeDomains: [{ domain: 'cut', subdomains: ['audio_concat'], role: 'primary', score: 8 }],
        primaryDomain: 'cut',
        subdomains: ['audio_concat']
      }),
      sessionAllowedTools: ['mcp__ffmpeg-media__*'],
      isAssistant: false
    })

    expect(surface.toolsOption).toEqual(['Bash'])
    expect(surface.builtinTools).toEqual(['Bash'])
    expect(surface.allowedToolsOption).toContain('mcp__ffmpeg-media__*')
    expect(surface.allowedToolsOption).not.toContain('Bash')
  })

  it('keeps ai_media turns free of Bash while allowing MCP speech tools', () => {
    const surface = buildToolSurface({
      decision: makeDecision({
        toolLayer: 'chat',
        activeDomains: [{ domain: 'ai_media', subdomains: ['speech'], role: 'primary', score: 6 }],
        primaryDomain: 'ai_media',
        subdomains: ['speech']
      }),
      sessionAllowedTools: ['mcp__speech__*'],
      isAssistant: false
    })

    expect(surface.toolsOption).toEqual([])
    expect(surface.builtinTools).toEqual([])
    expect(surface.allowedToolsOption).toEqual(['mcp__speech__*'])
  })

  it('exposes Bash in the workspace-write layer without auto-allowing write tools', () => {
    const surface = buildToolSurface({
      decision: makeDecision({
        toolLayer: 'workspace-write',
        activeDomains: [{ domain: 'workspace', subdomains: ['write', 'execute'], role: 'primary', score: 8 }],
        primaryDomain: 'workspace',
        subdomains: ['execute', 'write']
      }),
      sessionAllowedTools: [],
      isAssistant: false
    })

    expect(surface.builtinTools).toContain('Write')
    expect(surface.builtinTools).toContain('Bash')
    expect(surface.allowedToolsOption).not.toContain('Write')
    expect(surface.allowedToolsOption).not.toContain('Edit')
    expect(surface.allowedToolsOption).not.toContain('Bash')
  })

  it('filters known expensive or unsupported defaults from auto-allow lists', () => {
    const surface = buildToolSurface({
      decision: makeDecision({
        toolLayer: 'agentic',
        activeDomains: [{ domain: 'workspace', subdomains: ['task'], role: 'primary', score: 3 }],
        primaryDomain: 'workspace',
        subdomains: ['task']
      }),
      sessionAllowedTools: ['WebFetch', 'mcp__exa__web_fetch_exa', 'mcp__search__*'],
      isAssistant: false
    })

    expect(surface.allowedToolsOption).toContain('mcp__search__*')
    expect(surface.allowedToolsOption).not.toContain('WebFetch')
    expect(surface.allowedToolsOption).not.toContain('mcp__exa__web_fetch_exa')
  })

  it('exposes all builtin tools when the skills domain is active', () => {
    const surface = buildToolSurface({
      decision: makeDecision({
        toolLayer: 'agentic',
        activeDomains: [{ domain: 'skills', subdomains: ['create_skill'], role: 'primary', score: 6 }],
        primaryDomain: 'skills',
        subdomains: ['create_skill']
      }),
      sessionAllowedTools: [],
      isAssistant: false
    })

    expect(surface.builtinTools).toEqual(
      expect.arrayContaining(['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Task', 'WebSearch', 'WebFetch'])
    )
  })

  it('updates the sorted auto-allow option when MCP patterns are added', () => {
    const surface = buildToolSurface({
      decision: makeDecision({ toolLayer: 'chat' }),
      sessionAllowedTools: [],
      isAssistant: false
    })

    addAutoAllowedTool(surface, 'mcp__skills__*')

    expect(surface.allowedToolsOption).toEqual(['mcp__skills__*'])
  })
})
