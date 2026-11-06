import { beforeEach, describe, expect, it, vi } from 'vitest'
const data = vi.hoisted(() => new Map())
vi.mock('electron-store', () => ({ default: class { get(key: string, fallback: unknown) { return data.get(key) ?? fallback } set(key: string, value: unknown) { data.set(key, value) } } }))
import { listArtifacts, registerArtifact } from '../../services/artifactIndex'
import { syncLegacyArtifacts } from '../../services/artifactLegacySync'
describe('session artifact index', () => {
  beforeEach(() => data.clear())
  it('isolates sessions and filters types', () => {
    registerArtifact({ runtimeSessionId: 'a', type: 'video', url: 'https://example.com/a' })
    registerArtifact({ runtimeSessionId: 'a', type: 'draft', draftId: 'draft' })
    expect(listArtifacts('b')).toEqual([])
    expect(listArtifacts('a', 'video')).toHaveLength(1)
    expect(listArtifacts('a')).toHaveLength(2)
  })
  it('deduplicates manual URLs against automatic tasks', () => {
    const first = registerArtifact({ runtimeSessionId: 'a', type: 'video', url: 'https://example.com/a', source: 'video-generate', taskId: 'task' })
    expect(registerArtifact({ runtimeSessionId: 'a', type: 'video', url: 'https://example.com/a#preview' })).toEqual(first)
    expect(registerArtifact({ runtimeSessionId: 'a', type: 'video', url: 'https://example.com/new', source: 'video-generate', taskId: 'task' })).toEqual(first)
    expect(listArtifacts('a')).toHaveLength(1)
  })
  it('deduplicates drafts and normalized paths', () => {
    for (let i = 0; i < 2; i++) registerArtifact({ runtimeSessionId: 'a', type: 'draft', draftId: 'draft' })
    registerArtifact({ runtimeSessionId: 'a', type: 'document', filePath: '/workspace/sub/../a.md' })
    registerArtifact({ runtimeSessionId: 'a', type: 'document', filePath: '/workspace/a.md' })
    expect(listArtifacts('a')).toHaveLength(2)
  })
  it('hides legacy pending draft placeholders so edits do not duplicate drafts', () => {
    registerArtifact({ runtimeSessionId: 'a', type: 'draft', draftId: 'pending:request-1', name: '草稿' })
    const real = registerArtifact({ runtimeSessionId: 'a', type: 'draft', draftId: 'draft-1', name: '草稿' })
    expect(listArtifacts('a')).toEqual([real])
  })
  it('imports only same-session legacy media and whitelisted fields', () => {
    const items = syncLegacyArtifacts('a', [
      { type: 'audio', runtimeSessionId: 'a', id: 'audio', url: 'https://example.com/a', malicious: 'drop' },
      { type: 'video', runtimeSessionId: 'b', url: 'https://example.com/b' },
      { type: 'document', runtimeSessionId: 'a', filePath: '/secret.md' },
      { type: 'image', runtimeSessionId: 'a', url: 'javascript:alert(1)' }
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).not.toHaveProperty('malicious')
    expect(listArtifacts('b')).toEqual([])
  })
  it('never falls back to an active session', () => {
    expect(() => listArtifacts('')).toThrow('runtime session')
    expect(() => registerArtifact({ runtimeSessionId: '', type: 'draft', draftId: 'd' })).toThrow('runtime session')
  })
})
