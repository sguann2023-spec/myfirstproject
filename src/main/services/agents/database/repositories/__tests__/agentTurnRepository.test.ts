import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn(),
  ModelValidationError: class ModelValidationError extends Error {}
}))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/tmp/data')
}))

vi.mock('@shared/mcp', () => ({
  buildFunctionCallToolName: vi.fn((serverName: string, toolName: string) => `mcp__${serverName}__${toolName}`)
}))

vi.mock('@types', () => ({
  objectKeys: Object.keys
}))

vi.mock('../../../BaseService', () => ({
  BaseService: class BaseService {}
}))

import { isTurnEligibleForRecentContext } from '../agentTurnRepository'

describe('isTurnEligibleForRecentContext', () => {
  it('includes completed turns', () => {
    expect(
      isTurnEligibleForRecentContext({
        status: 'completed',
        userText: '用户问题',
        assistantText: '助手回答'
      })
    ).toBe(true)
  })

  it('excludes cancelled requests even when user text or partial replies remain', () => {
    expect(
      isTurnEligibleForRecentContext({
        status: 'cancelled',
        userText: '继续',
        assistantText: ''
      })
    ).toBe(false)

    expect(
      isTurnEligibleForRecentContext({
        status: 'cancelled',
        userText: '',
        assistantText: '部分回答'
      })
    ).toBe(false)
  })

  it('excludes cancelled turns without any user or assistant text', () => {
    expect(
      isTurnEligibleForRecentContext({
        status: 'cancelled',
        userText: '',
        assistantText: '   '
      })
    ).toBe(false)
  })

  it('includes failed turns when they contain recoverable text', () => {
    expect(
      isTurnEligibleForRecentContext({
        status: 'failed',
        userText: '用户问题',
        assistantText: '助手回答'
      })
    ).toBe(true)
  })

  it('excludes failed turns without any user or assistant text', () => {
    expect(
      isTurnEligibleForRecentContext({
        status: 'failed',
        userText: '',
        assistantText: '   '
      })
    ).toBe(false)
  })
})
