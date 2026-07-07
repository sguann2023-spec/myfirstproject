import { describe, expect, it } from 'vitest'

import { addAutoAllowedTool, buildToolSurface } from '../tool-surface'

describe('buildToolSurface', () => {
  it('disables all built-in tools for chat turns', () => {
    const surface = buildToolSurface({
      layer: 'chat',
      sessionAllowedTools: ['Bash', 'mcp__filesystem__*'],
      isAssistant: false
    })

    expect(surface.toolsOption).toEqual([])
    expect(surface.builtinTools).toEqual([])
    expect(surface.allowedToolsOption).toEqual(['mcp__filesystem__*'])
  })

  it('enables only read tools for workspace-read turns', () => {
    const surface = buildToolSurface({
      layer: 'workspace-read',
      sessionAllowedTools: [],
      isAssistant: false
    })

    expect(surface.toolsOption).toEqual(['Read', 'Glob', 'Grep', 'NotebookRead'])
    expect(surface.allowedToolsOption).toEqual(['Glob', 'Grep', 'NotebookRead', 'Read'])
  })

  it('does not auto-allow write tools merely because the write layer is available', () => {
    const surface = buildToolSurface({
      layer: 'workspace-write',
      sessionAllowedTools: [],
      isAssistant: false
    })

    expect(surface.builtinTools).toContain('Write')
    expect(surface.allowedToolsOption).not.toContain('Write')
    expect(surface.allowedToolsOption).not.toContain('Edit')
  })

  it('filters known expensive or unsupported defaults from auto-allow lists', () => {
    const surface = buildToolSurface({
      layer: 'agentic',
      sessionAllowedTools: ['WebFetch', 'mcp__exa__web_fetch_exa', 'mcp__search__*'],
      isAssistant: false
    })

    expect(surface.allowedToolsOption).toContain('mcp__search__*')
    expect(surface.allowedToolsOption).not.toContain('WebFetch')
    expect(surface.allowedToolsOption).not.toContain('mcp__exa__web_fetch_exa')
  })

  it('updates the sorted auto-allow option when MCP patterns are added', () => {
    const surface = buildToolSurface({
      layer: 'chat',
      sessionAllowedTools: [],
      isAssistant: false
    })

    addAutoAllowedTool(surface, 'mcp__skills__*')

    expect(surface.allowedToolsOption).toEqual(['mcp__skills__*'])
  })
})
