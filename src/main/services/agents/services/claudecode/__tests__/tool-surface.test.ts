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
  toolLayer: args.toolLayer,
  toolLayerReasons: ['prompt:chat'],
  ...args
})

describe('buildToolSurface', () => {
  it('exposes InspectImage and AskUserQuestion for plain chat turns', () => {
    const surface = buildToolSurface({
      decision: makeDecision({ toolLayer: 'chat' }),
      sessionAllowedTools: ['Bash', 'mcp__skills__*'],
      isAssistant: false
    })

    expect(surface.toolsOption).toEqual(['InspectImage', 'AskUserQuestion'])
    expect(surface.builtinTools).toEqual(['InspectImage', 'AskUserQuestion'])
    expect(surface.allowedToolsOption).toEqual(['InspectImage', 'mcp__skills__*'])
  })

  it('exposes InspectImage, AskUserQuestion and Bash for chat.bash turns without auto-allowing Bash', () => {
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

    expect(surface.toolsOption).toEqual(['InspectImage', 'AskUserQuestion', 'Bash'])
    expect(surface.builtinTools).toEqual(['InspectImage', 'AskUserQuestion', 'Bash'])
    expect(surface.allowedToolsOption).not.toContain('Bash')
    expect(surface.allowedToolsOption).toContain('InspectImage')
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

    expect(surface.toolsOption).toEqual([
      'InspectImage',
      'AskUserQuestion',
      'Read',
      'Bash',
      'Write',
      'Edit',
      'MultiEdit',
      'NotebookRead',
      'NotebookEdit',
      'Task',
      'TodoWrite'
    ])
    expect(surface.allowedToolsOption).toEqual(['InspectImage', 'NotebookRead', 'Read', 'TodoWrite'])
  })

  it('adds InspectImage, AskUserQuestion and Bash to web turns while keeping workspace builtins hidden', () => {
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

    expect(surface.toolsOption).toEqual(['InspectImage', 'AskUserQuestion', 'WebSearch', 'WebFetch', 'Bash'])
    expect(surface.builtinTools).toEqual(['InspectImage', 'AskUserQuestion', 'WebSearch', 'WebFetch', 'Bash'])
    expect(surface.allowedToolsOption).toEqual(['InspectImage', 'mcp__browser__*', 'mcp__search__*'])
  })

  it('adds InspectImage, AskUserQuestion and Bash to cut turns', () => {
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

    expect(surface.toolsOption).toEqual(['InspectImage', 'AskUserQuestion', 'Bash'])
    expect(surface.builtinTools).toEqual(['InspectImage', 'AskUserQuestion', 'Bash'])
    expect(surface.allowedToolsOption).toContain('mcp__ffmpeg-media__*')
    expect(surface.allowedToolsOption).not.toContain('Bash')
    expect(surface.allowedToolsOption).toContain('InspectImage')
  })

  it('adds InspectImage, AskUserQuestion and Bash to materials turns', () => {
    const surface = buildToolSurface({
      decision: makeDecision({
        toolLayer: 'chat',
        activeDomains: [{ domain: 'materials', subdomains: ['folder_links'], role: 'primary', score: 6 }],
        primaryDomain: 'materials',
        subdomains: ['folder_links']
      }),
      sessionAllowedTools: ['mcp__materials__*'],
      isAssistant: false
    })

    expect(surface.toolsOption).toEqual(['InspectImage', 'AskUserQuestion', 'Bash'])
    expect(surface.builtinTools).toEqual(['InspectImage', 'AskUserQuestion', 'Bash'])
    expect(surface.allowedToolsOption).toContain('mcp__materials__*')
    expect(surface.allowedToolsOption).not.toContain('Bash')
    expect(surface.allowedToolsOption).toContain('InspectImage')
  })

  it('keeps ai_media turns free of Bash while still exposing InspectImage and AskUserQuestion', () => {
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

    expect(surface.toolsOption).toEqual(['InspectImage', 'AskUserQuestion'])
    expect(surface.builtinTools).toEqual(['InspectImage', 'AskUserQuestion'])
    expect(surface.allowedToolsOption).toEqual(['InspectImage', 'mcp__speech__*'])
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
    expect(surface.builtinTools).toContain('InspectImage')
    expect(surface.builtinTools).toContain('AskUserQuestion')
    expect(surface.allowedToolsOption).not.toContain('Write')
    expect(surface.allowedToolsOption).not.toContain('Edit')
    expect(surface.allowedToolsOption).not.toContain('Bash')
    expect(surface.allowedToolsOption).toContain('InspectImage')
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
      expect.arrayContaining([
        'Read',
        'Write',
        'Edit',
        'MultiEdit',
        'Bash',
        'Task',
        'WebSearch',
        'WebFetch',
        'InspectImage',
        'AskUserQuestion'
      ])
    )
  })

  it('updates the sorted auto-allow option when MCP patterns are added', () => {
    const surface = buildToolSurface({
      decision: makeDecision({ toolLayer: 'chat' }),
      sessionAllowedTools: [],
      isAssistant: false
    })

    addAutoAllowedTool(surface, 'mcp__skills__*')

    expect(surface.allowedToolsOption).toEqual(['InspectImage', 'mcp__skills__*'])
  })
})
