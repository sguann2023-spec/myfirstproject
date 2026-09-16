import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockIsWin = false

vi.mock('electron', () => ({
  net: {}
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@main/constant', () => ({
  get isWin() {
    return mockIsWin
  }
}))

vi.mock('@main/utils/process', () => ({
  findGitBash: vi.fn(),
  validateGitBashPath: vi.fn()
}))

vi.mock('@shared/sessionPayloadLimits', () => {
  const textEncoder = new TextEncoder()
  const getUtf8ByteLength = (value: string) => textEncoder.encode(value).length
  const MAX_INLINE_TOOL_PAYLOAD_BYTES = 16 * 1024

  return {
    limitInlineToolPayload(value: unknown, options: { label?: string } = {}) {
      const label = options.label || '工具回包'
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      if (getUtf8ByteLength(text) <= MAX_INLINE_TOOL_PAYLOAD_BYTES) {
        return value
      }
      const notice = `\n\n[${label} 已截断]`
      const maxBodyBytes = MAX_INLINE_TOOL_PAYLOAD_BYTES - getUtf8ByteLength(notice)
      let best = ''
      let low = 0
      let high = text.length
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        const candidate = text.slice(0, mid)
        if (getUtf8ByteLength(candidate) <= maxBodyBytes) {
          best = candidate
          low = mid + 1
        } else {
          high = mid - 1
        }
      }
      return `${best}${notice}`
    }
  }
})

import { findGitBash, validateGitBashPath } from '@main/utils/process'

import { buildLimitedPiToolPayload, resolveShellExecutable } from '../harness/create-harness'

const textEncoder = new TextEncoder()
const getUtf8ByteLength = (value: string) => textEncoder.encode(value).length
const MAX_INLINE_TOOL_PAYLOAD_BYTES = 16 * 1024
const mockedFindGitBash = vi.mocked(findGitBash)
const mockedValidateGitBashPath = vi.mocked(validateGitBashPath)

beforeEach(() => {
  mockIsWin = false
  vi.clearAllMocks()
})

describe('buildLimitedPiToolPayload', () => {
  it('keeps small MCP payloads structured for PI harness', () => {
    const payload = buildLimitedPiToolPayload(
      {
        content: [{ type: 'text', text: 'small result' }],
        structuredContent: { progress: 25, status: 'processing' }
      },
      'mcp__demo__tool 回包'
    )

    expect(payload).toEqual({
      content: [{ type: 'text', text: 'small result' }],
      details: { progress: 25, status: 'processing' }
    })
  })

  it('hard truncates oversized MCP payloads before they enter PI harness', () => {
    const payload = buildLimitedPiToolPayload(
      {
        content: [{ type: 'text', text: 'x'.repeat(80 * 1024) }],
        structuredContent: { preview: 'y'.repeat(16 * 1024) }
      },
      'mcp__demo__tool 回包'
    )

    expect(payload.details).toBeUndefined()
    expect(payload.content).toHaveLength(1)
    expect(payload.content[0]).toMatchObject({
      type: 'text'
    })

    const text = (payload.content[0] as { text?: string }).text || ''
    expect(text).toContain('已截断')
    expect(text).toContain('mcp__demo__tool 回包')
    expect(getUtf8ByteLength(text)).toBeLessThanOrEqual(MAX_INLINE_TOOL_PAYLOAD_BYTES)
  })
})

describe('resolveShellExecutable', () => {
  it('prefers configured Git Bash path on Windows', () => {
    mockIsWin = true
    mockedValidateGitBashPath.mockReturnValue('C:\\PortableGit\\bin\\bash.exe')
    mockedFindGitBash.mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    const result = resolveShellExecutable({
      CLAUDE_CODE_GIT_BASH_PATH: 'C:\\PortableGit\\bin\\bash.exe'
    })

    expect(result).toBe('C:\\PortableGit\\bin\\bash.exe')
  })

  it('falls back to discovered Git Bash on Windows', () => {
    mockIsWin = true
    mockedValidateGitBashPath.mockReturnValue(null)
    mockedFindGitBash.mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    const result = resolveShellExecutable({})

    expect(result).toBe('C:\\Program Files\\Git\\bin\\bash.exe')
  })

  it('throws when Windows Git Bash is unavailable', () => {
    mockIsWin = true
    mockedValidateGitBashPath.mockReturnValue(null)
    mockedFindGitBash.mockReturnValue(null)

    expect(() => resolveShellExecutable({})).toThrow('Git Bash is required for shell execution on Windows')
  })
})
