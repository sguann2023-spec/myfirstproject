import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const state = vi.hoisted(() => ({ handlers: new Map(), data: new Map(), send: vi.fn() }))
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({ McpServer: class { server = { setRequestHandler(schema: unknown, handler: unknown) { state.handlers.set(schema, handler) } } } }))
vi.mock('electron-store', () => ({ default: class { get(key: string, fallback: unknown) { return state.data.get(key) ?? fallback } set(key: string, value: unknown) { state.data.set(key, value) } } }))
vi.mock('@main/services/WindowService', () => ({ windowService: { getMainWindow: () => ({ webContents: { send: state.send } }) } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) } }))
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import ArtifactServer from '../artifact-server'
vi.mock('electron', () => ({ net: { fetch: vi.fn(async () => new Response('media')) } }))
describe('artifact MCP document authorization', () => {
  it('registers existing allowed files, rejects escapes, symlinks, remote and unsupported documents', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-test-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-outside-'))
    try {
      await fs.writeFile(path.join(root, 'a.md'), 'hello')
      await fs.writeFile(path.join(root, 'a.html'), '<script>alert(1)</script>')
      await fs.writeFile(path.join(root, 'a.js'), 'hello')
      await fs.writeFile(path.join(outside, 'secret.md'), 'secret')
      await fs.symlink(path.join(outside, 'secret.md'), path.join(root, 'link.md'))
      new ArtifactServer(root, 'session')
      const call = (args: object, name = 'add_artifact') => state.handlers.get(CallToolRequestSchema)({ params: { name, arguments: args } })
      expect((await call({ type: 'document', filePath: 'a.md' })).isError).toBeUndefined()
      expect((await call({ type: 'document', filePath: 'a.html' })).isError).toBeUndefined()
      const registered = JSON.parse((await call({ type: 'document', filePath: 'a.md' })).content[0].text)
      expect(await fs.realpath(path.dirname(registered.filePath))).toBe(await fs.realpath(path.join(root, 'artifact')))
      expect(registered.name).toBe('a.md')
      expect(await fs.readFile(registered.filePath, 'utf8')).toBe('hello')
      expect(await fs.readFile(path.join(root, 'a.md'), 'utf8')).toBe('hello')
      expect((await call({ type: 'document', filePath: registered.filePath })).isError).toBeUndefined()
      for (const filePath of ['missing.md', 'a.js', '.', 'link.md', path.join(outside, 'secret.md')]) {
        expect((await call({ type: 'document', filePath })).isError).toBe(true)
      }
      expect((await call({ type: 'document', url: 'https://example.com/a.md' })).isError).toBe(true)
      expect(JSON.parse((await call({ type: 'document' }, 'list_artifacts')).content[0].text)).toHaveLength(2)
      new ArtifactServer(root, 'authorized', [outside])
      expect((await call({ type: 'document', filePath: path.join(outside, 'secret.md') })).isError).toBeUndefined()
      for (const type of ['video', 'image', 'audio']) {
        expect((await call({ type, url: `https://example.com/${type}` })).isError).toBeUndefined()
        expect(state.send).toHaveBeenLastCalledWith('app:artifact-registered', expect.objectContaining({ type, runtimeSessionId: 'authorized' }))
      }
      expect((await call({ type: 'draft', draftId: 'manual' })).isError).toBeUndefined()
      expect(state.send).toHaveBeenLastCalledWith('app:artifact-registered', expect.objectContaining({ type: 'draft' }))
      new ArtifactServer(root)
      expect((await call({}, 'list_artifacts')).isError).toBe(true)
    } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }) }
  })
})
