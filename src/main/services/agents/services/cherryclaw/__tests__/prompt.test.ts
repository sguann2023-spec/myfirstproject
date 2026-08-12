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
    expect(result).toContain('# Workspace root')
    expect(result).toContain('This workspace root applies to every turn and every domain')
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

  it('makes the workspace root a global prompt rule instead of capability-scoped guidance', async () => {
    setupFiles({})

    const result = await builder.buildSystemPrompt('/workspace')

    expect(result).toContain('The current workspace root for this session is: /workspace')
    expect(result).toContain('including chat, skills, web, and workspace tasks')
    expect(result).toContain('answer with this exact path verbatim: /workspace')
    expect(result).toContain('Do not answer workspace-location questions with a remembered path from another project or session')
    expect(result).toContain('default generated, exported, and downloaded files to the current workspace root')
    expect(result).toContain('prefer saving the output next to the source file')
    expect(result).toContain('Do not default outputs to system temporary folders')
    expect(result).toContain('Do not invent alternate roots such as app install folders')
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
    expect(result.length).toBeLessThan(8000)
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
      expect(result).toContain('copy `old_string` exactly from the latest Read output')
      expect(result).toContain('including whitespace, indentation, emojis, quotes, and escape sequences')
      expect(result).toContain('prefer `MultiEdit` so related edits are grouped into one tool call')
      expect(result).toContain('Use `Edit` for a single localized change')
      expect(result).toContain('Prefer the smallest unique snippet')
      expect(result).toContain('read the file again and retry with a freshly copied, smaller snippet')
      expect(result).toContain('do not dump the full body inline into the conversation')
      expect(result).toContain('write intermediate full inputs/outputs to files inside the workspace')
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

    it('adds preferred draft download guidance when routed to draft download', () => {
      const result = builder.buildToolGuidance('/workspace', {
        preferredMcpTools: ['mcp__draft-download__download_draft']
      })

      expect(result).toContain('## Tool selection for this turn')
      expect(result).toContain('downloading a VectCut draft')
      expect(result).toContain('`mcp__draft-download__download_draft`')
    })

    it('adds preferred draft creation guidance when routed to draft creation', () => {
      const result = builder.buildToolGuidance('/workspace', {
        preferredMcpTools: ['mcp__draft-management__create_draft'],
        hasWorkspaceTools: true,
        hasWriteTools: true
      })

      expect(result).toContain('## Tool selection for this turn')
      expect(result).toContain('creating a VectCut draft')
      expect(result).toContain('`mcp__draft-management__create_draft`')
      expect(result).toContain('do not manually create local draft folders')
      expect(result).toContain('创建一个剪辑草稿')
    })

    it('adds preferred file upload guidance when routed to workspace upload', () => {
      const result = builder.buildToolGuidance('/workspace', {
        preferredMcpTools: ['mcp__file-upload__upload_file_to_oss']
      })

      expect(result).toContain('## Tool selection for this turn')
      expect(result).toContain('uploading a local file to VectCut OSS')
      expect(result).toContain('`mcp__file-upload__upload_file_to_oss`')
    })

    it('adds local image reference upload guidance when image generation also needs upload', () => {
      const result = builder.buildToolGuidance('/workspace', {
        preferredMcpTools: ['mcp__file-upload__upload_file_to_oss', 'mcp__image__generate_or_edit_image']
      })

      expect(result).toContain('## Image references')
      expect(result).toContain('reference-driven image generation')
      expect(result).toContain('upload it first')
      expect(result).toContain('`mcp__image__generate_or_edit_image`')
      expect(result).toContain('prefer using `mcp__image__generate_or_edit_image` directly')
      expect(result).toContain('instead of first reading the image content with `InspectImage`')
    })

    it('adds explicit Seedance reference video preservation guidance for AI video generation', () => {
      const result = builder.buildToolGuidance('/workspace', {
        preferredMcpTools: ['mcp__video__generate_video']
      })

      expect(result).toContain('## AI video generation')
      expect(result).toContain('keep it as `video_url` with role `reference_video`')
      expect(result).toContain('do not silently replace that video with extracted frame images plus separated audio')
    })

    it('adds local skill execution guidance when a workspace skill is matched', () => {
      const result = builder.buildToolGuidance(
        '/workspace',
        {
          hasSkills: true,
          preferredLocalSkillFilename: '儿童绘本',
          preferredLocalSkillTriggerMode: 'implicit',
          preferredLocalSkillMatchedEvidence: ['儿童绘本', '绘本'],
          preferredLocalSkillSdkDiscovered: true
        },
        {
          activeSkillNames: ['儿童绘本']
        }
      )

      expect(result).toContain('## Skills')
      expect(result).toContain('read its `SKILL.md` first')
      expect(result).toContain('Do not bypass a matched local skill with a general answer')
      expect(result).toContain('## Tool selection for this turn')
      expect(result).toContain('The host has already selected the target skill for this turn')
      expect(result).toContain('implicitly matches the local workspace skill')
      expect(result).toContain('Match evidence:')
      expect(result).toContain('should be available to the SDK project-level skill loader')
      expect(result).toContain('`/workspace/.claude/skills/儿童绘本/SKILL.md`')
      expect(result).toContain('If the host already embeds a resolved local `SKILL.md` in the current turn prompt')
      expect(result).toContain('do not search the skill directory again before execution')
      expect(result).toContain('Execute the request according to that `SKILL.md`')
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
