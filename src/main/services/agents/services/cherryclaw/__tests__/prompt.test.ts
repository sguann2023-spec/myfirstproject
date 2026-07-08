import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn()
}))

import { readdir, readFile, stat } from 'node:fs/promises'

import { PromptBuilder, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '../prompt'

const mockedStat = vi.mocked(stat)
const mockedReadFile = vi.mocked(readFile)
const mockedReaddir = vi.mocked(readdir)

function setupFiles(files: Record<string, string>) {
  const dirs = new Map<string, string[]>()
  for (const filePath of Object.keys(files)) {
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    const name = filePath.substring(filePath.lastIndexOf('/') + 1)
    if (!dirs.has(dir)) dirs.set(dir, [])
    dirs.get(dir)!.push(name)
  }

  mockedStat.mockImplementation(async (filePath) => {
    const p = typeof filePath === 'string' ? filePath : filePath.toString()
    if (files[p] !== undefined) {
      return { mtimeMs: 1000 } as any
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  mockedReadFile.mockImplementation(async (filePath) => {
    const p = typeof filePath === 'string' ? filePath : filePath.toString()
    if (files[p] !== undefined) {
      return files[p]
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  mockedReaddir.mockImplementation(async (dirPath) => {
    const p = typeof dirPath === 'string' ? dirPath : dirPath.toString()
    return (dirs.get(p) ?? []) as any
  })
}

describe('PromptBuilder', () => {
  let builder: PromptBuilder

  beforeEach(() => {
    builder = new PromptBuilder()
    vi.clearAllMocks()
  })

  it('builds a claw-style prompt without Soul bootstrap content', async () => {
    setupFiles({})

    const result = await builder.buildSystemPrompt('/workspace')

    expect(result).toContain('You are VectcutClaw')
    expect(result).toContain('# System')
    expect(result).toContain('# Doing tasks')
    expect(result).toContain('Never write pseudo tool-call markup')
    expect(result).toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
    expect(result).toContain('# Environment context')
    expect(result).not.toContain('## Bootstrap Mode')
    expect(result).not.toContain('## Memories')
    expect(result).not.toContain('<soul>')
    expect(result).not.toContain('<user>')
  })

  it('loads capped workspace instruction files instead of Soul memory files', async () => {
    setupFiles({
      '/workspace/CLAUDE.md': 'Root project instructions',
      '/workspace/.claw/instructions.md': 'Claw local instructions',
      '/workspace/SOUL.md': 'Legacy soul content should not load',
      '/workspace/USER.md': 'Legacy user content should not load'
    })

    const result = await builder.buildSystemPrompt('/workspace')

    expect(result).toContain('# Workspace instructions')
    expect(result).toContain('Root project instructions')
    expect(result).toContain('Claw local instructions')
    expect(result).not.toContain('Legacy soul content')
    expect(result).not.toContain('Legacy user content')
  })

  it('resolves instruction filenames case-insensitively', async () => {
    setupFiles({
      '/workspace/claude.md': 'lowercase instructions',
      '/workspace/.claw/Instructions.md': 'mixed instructions'
    })

    const result = await builder.buildSystemPrompt('/workspace')

    expect(result).toContain('lowercase instructions')
    expect(result).toContain('mixed instructions')
  })

  it('truncates oversized instruction content', async () => {
    setupFiles({
      '/workspace/CLAUDE.md': 'x'.repeat(5000)
    })

    const result = await builder.buildSystemPrompt('/workspace')

    expect(result).toContain('[truncated]')
    expect(result.length).toBeLessThan(7000)
  })

  it('uses mtime cache for repeated reads', async () => {
    setupFiles({
      '/workspace/CLAUDE.md': 'Cached instructions'
    })

    await builder.buildSystemPrompt('/workspace')
    await builder.buildSystemPrompt('/workspace')

    const readCalls = mockedReadFile.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('CLAUDE.md')
    )
    expect(readCalls).toHaveLength(1)
  })

  describe('buildToolGuidance', () => {
    it('returns empty guidance when no capability is selected', () => {
      expect(builder.buildToolGuidance('/workspace')).toBe('')
    })

    it('adds only capability-scoped guidance', () => {
      const result = builder.buildToolGuidance('/workspace', {
        hasWeb: true,
        hasWorkspaceTools: true,
        hasWriteTools: true
      })

      expect(result).toContain('## Web and browser')
      expect(result).toContain('## Workspace work')
      expect(result).toContain('## File editing')
      expect(result).not.toContain('## Skills')
      expect(result).not.toContain('## Workspace memory')
      expect(result).not.toContain('## Content creation')
    })

    it('keeps self-media guidance concise and opt-in', () => {
      const result = builder.buildToolGuidance('/workspace', { hasContentCreation: true })

      expect(result).toContain('## Content creation')
      expect(result).toContain('distribution strength')
      expect(result).toContain('prefer the dedicated copylab tool')
      expect(result.length).toBeLessThan(700)
    })
  })

  describe('buildFactsSection', () => {
    it('returns undefined when no FACT.md exists', async () => {
      setupFiles({})

      const result = await builder.buildFactsSection('/workspace')

      expect(result).toBeUndefined()
    })

    it('wraps memory/FACT.md content in a capped workspace knowledge block', async () => {
      setupFiles({
        '/workspace/memory/FACT.md': '- Project: VectCut\n'.repeat(400)
      })

      const result = await builder.buildFactsSection('/workspace')

      expect(result).toBeDefined()
      expect(result).toContain('## Workspace knowledge')
      expect(result).toContain('<facts>')
      expect(result).toContain('[truncated]')
      expect(result!.length).toBeLessThan(4300)
    })
  })
})
