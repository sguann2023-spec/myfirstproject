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
  BaseService: class BaseService { async getDatabase() { return (globalThis as any).__artifactTestDatabase } }
}))

import { agentArtifactRepository } from '../agentArtifactRepository'
import { agentTurnRepository, isTurnEligibleForRecentContext } from '../agentTurnRepository'
import { insertMissingTaskSubscriptions } from '../taskSubscriptionRepository'

it.each(['SQLITE_BUSY', 'SQLITE_CONSTRAINT'])('artifact writes propagate %s without retrying', async (code) => {
  const inserted: any[] = []
  const failure = Object.assign(new Error('private SQL and payload'), { code })
  const returning = vi.fn().mockRejectedValue(failure)
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: (row: any) => {
    inserted.push(row)
    return { returning }
  } }) }
  ;(globalThis as any).__artifactTestDatabase = db
  try {
    const save = agentArtifactRepository.save({ topicId: 'topic', segmentId: 'segment', turnId: 'turn', sourceType: 'tool_result', content: 'blob', contentHash: 'hash' } as any)
    await expect(save).rejects.toBe(failure)
    expect(returning).toHaveBeenCalledTimes(1)
    expect(inserted).toHaveLength(1)
    expect(new Set(inserted.map(row => row.id)).size).toBe(1)
    expect(new Set(inserted.map(row => row.created_at)).size).toBe(1)
  } finally {
    delete (globalThis as any).__artifactTestDatabase
  }
})

it('propagates a lost artifact acknowledgement without resubmitting the committed blob', async () => {
  let committed: any
  const rows = new Map<string, any>()
  const failure = Object.assign(new Error('lost acknowledgement'), { code: 'SQLITE_BUSY' })
  const returning = vi.fn(async () => {
    if (rows.size === 0) {
      rows.set(committed.id, committed)
      throw failure
    }
    return []
  })
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [...rows.values()] }) }) }))
  ;(globalThis as any).__artifactTestDatabase = {
    insert: () => ({ values: (row: any) => { committed = row; return { returning } } }),
    select
  }
  try {
    const save = agentArtifactRepository.save({ topicId: 'topic', segmentId: 'segment', turnId: 'turn', sourceType: 'tool_result', content: 'full blob', contentHash: 'hash' } as any)
    await expect(save).rejects.toBe(failure)
    expect(rows.get(committed.id).content).toBe('full blob')
    expect(rows.size).toBe(1)
    expect(returning).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledTimes(1)
  } finally {
    delete (globalThis as any).__artifactTestDatabase
  }
})

it('does not return an artifact reference when conflict lookup has no blob', async () => {
  ;(globalThis as any).__artifactTestDatabase = {
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) })
  }
  try {
    await expect(agentArtifactRepository.save({ id: 'missing', topicId: 'topic', segmentId: 'segment', turnId: 'turn', sourceType: 'tool_result', content: 'blob', contentHash: 'hash' } as any)).rejects.toThrow('Artifact ID conflict')
  } finally { delete (globalThis as any).__artifactTestDatabase }
})

describe('query-first writes', () => {
  const turn = { id: 'turn', topicId: 'topic', segmentId: 'segment', userMessageId: 'user', assistantMessageId: 'assistant', startedAt: 'new-start', status: 'completed', cumulativeInputTokens: 3 } as any

  it('inserts a missing turn and updates only the original mutable fields for an existing turn', async () => {
    let stored: any
    const values = vi.fn(async (row: any) => { stored = row; return [stored] })
    const set = vi.fn((updates: any) => {
      stored = { ...stored, ...Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)) }
      return { where: () => ({ returning: async () => [stored] }) }
    })
    ;(globalThis as any).__artifactTestDatabase = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => stored ? [stored] : [] }) }) }),
      insert: () => ({ values: (row: any) => ({ returning: () => values(row) }) }),
      update: () => ({ set })
    }
    try {
      await agentTurnRepository.save({ ...turn, traceId: 'original-trace', userText: 'original-text', completedAt: 'original-end' })
      const saved = await agentTurnRepository.save({ ...turn, topicId: 'ignored-topic', startedAt: 'ignored-start', segmentId: 'new-segment' })
      expect(values).toHaveBeenCalledTimes(1)
      expect(set).toHaveBeenCalledTimes(1)
      expect(saved).toMatchObject({ topicId: 'topic', startedAt: 'new-start', segmentId: 'new-segment', traceId: 'original-trace', userText: 'original-text', completedAt: 'original-end' })
      expect(set.mock.calls[0][0]).not.toHaveProperty('topic_id')
      expect(set.mock.calls[0][0]).not.toHaveProperty('started_at')
    } finally { delete (globalThis as any).__artifactTestDatabase }
  })

  it.each(['userMessageId', 'assistantMessageId'])('validates %s before reading or writing a turn', async (field) => {
    const select = vi.fn()
    ;(globalThis as any).__artifactTestDatabase = { select }
    try {
      await expect(agentTurnRepository.save({ ...turn, [field]: ' ' })).rejects.toThrow(`requires a nonempty ${field}`)
      expect(select).not.toHaveBeenCalled()
    } finally { delete (globalThis as any).__artifactTestDatabase }
  })

  it.each(['content', 'content_hash', 'topic_id', 'turn_id', 'tool_call_id'])('rejects mismatched artifact %s without writing', async (field) => {
    const existing = { id: 'artifact', topic_id: 'topic', turn_id: 'turn', content: 'blob', content_hash: 'hash', tool_call_id: null, [field]: 'different' }
    const insert = vi.fn()
    ;(globalThis as any).__artifactTestDatabase = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [existing] }) }) }), insert
    }
    try {
      await expect(agentArtifactRepository.save({ id: 'artifact', topicId: 'topic', segmentId: 'segment', turnId: 'turn', sourceType: 'tool_result', content: 'blob', contentHash: 'hash' } as any)).rejects.toThrow('Artifact ID conflict')
      expect(insert).not.toHaveBeenCalled()
    } finally { delete (globalThis as any).__artifactTestDatabase }
  })

  it('deduplicates subscriptions, skips existing rows, and skips empty batches', async () => {
    const where = vi.fn().mockResolvedValue([{ channelId: 'existing' }])
    const values = vi.fn().mockResolvedValue(undefined)
    const db = { select: () => ({ from: () => ({ where }) }), insert: () => ({ values }) } as any
    await insertMissingTaskSubscriptions(db, 'task', ['existing', 'new', 'new'])
    expect(values).toHaveBeenCalledWith([{ channelId: 'new', taskId: 'task' }])
    await insertMissingTaskSubscriptions(db, 'task', ['existing'])
    await insertMissingTaskSubscriptions(db, 'task', [])
    expect(values).toHaveBeenCalledTimes(1)
    expect(where).toHaveBeenCalledTimes(2)
  })
})

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

  it('includes cancelled turns when user text or partial replies remain', () => {
    expect(
      isTurnEligibleForRecentContext({
        status: 'cancelled',
        userText: '继续',
        assistantText: ''
      })
    ).toBe(true)

    expect(
      isTurnEligibleForRecentContext({
        status: 'cancelled',
        userText: '',
        assistantText: '部分回答'
      })
    ).toBe(true)
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

  it('includes interrupted turns when partial factual context remains', () => {
    expect(
      isTurnEligibleForRecentContext({
        status: 'interrupted',
        userText: '用户问题',
        assistantText: '部分回答'
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
