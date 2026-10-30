import { describe, expect, it } from 'vitest'
import { formatDatabaseInitializationProgress } from '../../../../../../shared/databaseInitializationProgress'

describe('database initialization progress text', () => {
  it('shows only the copy label and real percentage', () => {
    expect(formatDatabaseInitializationProgress({ status: 'initializing', phase: 'copy-baseline', count: 512, total: 2048, startedAt: 0 })).toBe('正在复制数据 25%')
  })

  it('does not invent a percentage when the total is unknown', () => {
    const result = formatDatabaseInitializationProgress({ status: 'initializing', phase: 'import-records', count: 1200, detail: 'agent_message_events' })
    expect(result).toBe('正在迁移记录 已处理1,200条')
  })

  it('distinguishes database completion from other service initialization', () => {
    expect(formatDatabaseInitializationProgress({ status: 'initialized', phase: 'cleanup' })).toBe('正在初始化服务')
    expect(formatDatabaseInitializationProgress({ status: 'failed', phase: 'verify' })).toBe('数据库初始化失败')
  })

  it('handles the initial snapshot before initialization starts', () => {
    expect(formatDatabaseInitializationProgress({ status: 'idle', phase: 'opening' })).toBe('正在初始化数据库')
  })

  it('shows only the verification label and percentage without table names or counts', () => {
    expect(formatDatabaseInitializationProgress({ status: 'initializing', phase: 'verify', count: 9, total: 18, detail: 'agent_artifacts' })).toBe('正在校验结果 50%')
  })

  it('identifies the one-time index upgrade without exposing internal names', () => {
    expect(formatDatabaseInitializationProgress({ status: 'initializing', phase: 'index-rebuild', count: 9, total: 18, detail: 'agent_messages' })).toBe('正在建立查询索引 50%')
  })
})
