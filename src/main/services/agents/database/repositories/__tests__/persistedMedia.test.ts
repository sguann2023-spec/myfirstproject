import { mkdtemp, readFile, rm, readdir, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@main/utils', () => ({ getDataPath: () => '/unused' }))
import { offloadPersistedMedia, resolvePersistedMedia } from '../persistedMedia'
import { extractPreviewContentFromToolResult } from '../../../../../../renderer/src/pages/home/Messages/Tools/shared/callToolResult'
import { buildInlineToolResultPayload } from '../../../services/claudecode/harness/tool-result-payload'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root() { const dir = await mkdtemp(path.join(os.tmpdir(), 'media-test-')); roots.push(dir); return dir }
describe('persisted media', () => {
  it('offloads all copies including JSON metadata without touching live input; idempotent and concurrent', async () => {
    const dir = await root()
    const media = { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
    const input = { raw: media, content: [media], metadata: JSON.stringify({ copy: media }), prose: 'aGVsbG8=' }
    const before = JSON.stringify(input)
    const [a, b] = await Promise.all([offloadPersistedMedia(input, dir), offloadPersistedMedia(input, dir)])
    expect(a).toEqual(b)
    expect(JSON.stringify(input)).toBe(before)
    expect(a.raw.data).toBeUndefined()
    expect(await readFile((a.raw as any).source, 'utf8')).toBe('hello')
    expect(JSON.stringify(a).split('aGVsbG8=').length).toBe(2) // prose only
    expect(await offloadPersistedMedia(a, dir)).toEqual(a)
    expect(await readdir(path.join(dir, 'history-media'))).toHaveLength(1)
  })
  it('accepts real inline tool summaries alongside raw images and final text without mutating input', async () => {
    const dir = await root()
    const raw = { content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] }
    const inline = buildInlineToolResultPayload(raw) as typeof raw
    const input = { inline, raw, metadata: JSON.stringify({ inline, raw }), finalText: 'Image generated: tiger.png' }
    const before = JSON.stringify(input)
    const saved = await offloadPersistedMedia(input, dir)
    expect(saved.inline).toEqual(inline)
    expect(saved.raw.content[0].data).toBeUndefined()
    expect(await readFile((saved.raw.content[0] as any).source, 'utf8')).toBe('hello')
    expect(JSON.parse(saved.metadata).inline).toEqual(inline)
    expect(JSON.parse(saved.metadata).raw).toEqual(saved.raw)
    expect(saved.finalText).toBe(input.finalText)
    expect(JSON.stringify(input)).toBe(before)
    expect(await offloadPersistedMedia(saved, dir)).toEqual(saved)
    expect(await readdir(path.join(dir, 'history-media'))).toHaveLength(1)
  })
  it('does not exempt malformed raw or merely flagged inline images', async () => {
    const dir = await root()
    const inline = buildInlineToolResultPayload({ content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] }) as any
    const summary = inline.content[0]
    for (const image of [
      { ...summary, inlineImage: false },
      { ...summary, inlineImage: undefined },
      { ...summary, data: 'invalid==' },
      { ...summary, data: '[image base64 omitted from inline tool log, nope chars]' },
      { ...summary, type: 'audio' }
    ]) await expect(offloadPersistedMedia({ content: [image] }, dir)).rejects.toThrow('Invalid inline media base64')
    const rawFlagged = await offloadPersistedMedia({ type: 'image', inlineImage: true, data: 'aGVsbG8=', mimeType: 'image/png' }, dir)
    expect(rawFlagged.data).toBeUndefined()
    expect(await readFile((rawFlagged as any).source, 'utf8')).toBe('hello')
  })
  it('handles typed audio/video, nested base64 and data URLs; preserves URLs and paths', async () => {
    const dir = await root()
    const input = [{ type: 'audio', data: 'aGVsbG8=', mimeType: 'audio/wav' }, { source: { type: 'base64', media_type: 'video/mp4', data: 'aGVsbG8=' } }, { url: 'data:video/mp4;base64,aGVsbG8=' }, { url: 'https://example.com/a', data: '/some/file' }]
    const copy = await offloadPersistedMedia(input, dir)
    expect(JSON.stringify(copy)).not.toContain('aGVsbG8=')
    expect(copy[3]).toEqual(input[3])
    const preview = extractPreviewContentFromToolResult({ content: [copy[0]] })
    expect(preview.media).toHaveLength(1)
    expect(preview.media[0].kind).toBe('url')
  })
  it('restores references after migration and previews images as URLs', async () => {
    const dir = await root()
    const copy = await offloadPersistedMedia({ content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] }, dir)
    const restored = resolvePersistedMedia(copy, '/new/Data')
    expect((restored.content[0] as any).url).toMatch(/^\/new\/Data\/history-media\//)
    const preview = extractPreviewContentFromToolResult(restored)
    expect(preview.images).toHaveLength(1)
    expect(preview.images[0].kind).toBe('url')
    expect(preview.images[0].source).not.toContain('base64')
  })
  it('propagates disk and malformed input failures without mutation', async () => {
    const dir = await root()
    const input = { type: 'image', data: 'aGVsbG8=' }
    await mkdir(path.join(dir, 'history-media'))
    const bad = { ...input, data: 'invalid==' }
    await expect(offloadPersistedMedia(bad, dir)).rejects.toThrow()
    await expect(offloadPersistedMedia(input, path.join(dir, 'absent'))).rejects.toThrow()
    expect(input.data).toBe('aGVsbG8=')
    expect(bad.data).toBe('invalid==')
  })
})
