import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn() }) } }))
vi.mock('@main/utils', async () => {
  const os = await import('node:os')
  // An existing path satisfies binary discovery without requiring a bundled ripgrep.
  return { toAsarUnpackedPath: () => os.tmpdir() }
})
vi.mock('@main/utils/file', async () => {
  const os = await import('node:os')
  return {
    getFilesDir: () => os.tmpdir(), getNotesDir: () => os.tmpdir(), getTempDir: () => os.tmpdir()
  }
})
vi.mock('@main/utils/locales', () => ({ t: vi.fn() }))
vi.mock('@shared/config/constant', () => ({ documentExts: [], imageExts: [], KB: 1024, MB: 1048576 }))
vi.mock('@shared/utils', () => ({ parseDataUrl: vi.fn() }))
vi.mock('@types', () => ({ FILE_TYPE: {} }))
vi.mock('electron', () => ({ dialog: {}, net: {}, shell: {} }))
vi.mock('chardet', () => ({ default: {} }))
vi.mock('chokidar', () => ({ default: {} }))
vi.mock('isbinaryfile', () => ({ isBinaryFile: vi.fn() }))
vi.mock('officeparser', () => ({ default: {} }))
vi.mock('pdf-lib', () => ({ PDFDocument: {} }))
vi.mock('word-extractor', () => ({ default: class {} }))

import { fileStorage } from '../FileStorage'

const roots: string[] = []
const event = {} as Electron.IpcMainInvokeEvent
const shallow = { typed: true, recursive: false }

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-storage-list-'))
  roots.push(root)
  for (const name of ['Zoo', 'AppDir', '.hiddenDir']) await fs.mkdir(path.join(root, name))
  for (const name of ['zeta.txt', 'b-APP.txt', 'a.txt', 'app*.txt', '.app-hidden']) {
    await fs.writeFile(path.join(root, name), 'content-only-needle')
  }
  await fs.writeFile(path.join(root, 'AppDir', 'nested-app.txt'), '')
  return root
}

const entry = (name: string, type = 'file') => ({ name, path: name, type })

describe('FileStorage typed shallow directory pagination', () => {
  it('preserves default directory-first stable sorting and relative typed entries', async () => {
    const root = await fixture()
    expect(await fileStorage.listDirectory(event, root, shallow)).toEqual([
      entry('AppDir', 'directory'), entry('Zoo', 'directory'),
      ...['a.txt', 'app*.txt', 'b-APP.txt', 'zeta.txt'].sort((a, b) => a.localeCompare(b)).map(name => entry(name))
    ])
    const first = await fileStorage.listDirectory(event, root, { ...shallow, maxEntries: 2 })
    const second = await fileStorage.listDirectory(event, root, { ...shallow, offset: 2, maxEntries: 2 })
    const third = await fileStorage.listDirectory(event, root, { ...shallow, offset: 4, maxEntries: 2 })
    expect([...first, ...second, ...third]).toEqual(await fileStorage.listDirectory(event, root, shallow))
    expect(await fileStorage.listDirectory(event, root, { ...shallow, offset: 6 })).toEqual([])
    expect(await fileStorage.listDirectory(event, root, { ...shallow, maxEntries: 0 })).toEqual([])
  })

  it('filters literal names case-insensitively before sorting and paging', async () => {
    const root = await fixture()
    const matches = [entry('AppDir', 'directory'), entry('app*.txt'), entry('b-APP.txt')]
    expect(await fileStorage.listDirectory(event, root, { ...shallow, nameQuery: 'aPp' })).toEqual(matches)
    expect(await fileStorage.listDirectory(event, root, { ...shallow, nameQuery: 'APP', offset: 1, maxEntries: 1 })).toEqual([matches[1]])
    expect(await fileStorage.listDirectory(event, root, { ...shallow, nameQuery: '*' })).toEqual([entry('app*.txt')])
    for (const nameQuery of [path.basename(root), 'nested-app', 'AppDir/', 'content-only-needle', ' app ']) {
      expect(await fileStorage.listDirectory(event, root, { ...shallow, nameQuery })).toEqual([])
    }
    expect(await fileStorage.listDirectory(event, root, { ...shallow, nameQuery: '' })).toEqual(
      await fileStorage.listDirectory(event, root, shallow)
    )
  })

  it('keeps hidden and entry-kind filters compatible with pagination', async () => {
    const root = await fixture()
    expect(await fileStorage.listDirectory(event, root, { ...shallow, nameQuery: 'app', includeDirectories: false, offset: 1, maxEntries: 1 })).toEqual([entry('b-APP.txt')])
    expect(await fileStorage.listDirectory(event, root, { ...shallow, includeFiles: false, offset: 1 })).toEqual([entry('Zoo', 'directory')])
    expect(await fileStorage.listDirectory(event, root, { ...shallow, nameQuery: 'app', includeHidden: true, includeDirectories: false, maxEntries: 1 })).toEqual([entry('.app-hidden')])
    expect(await fileStorage.listDirectory(event, root, { ...shallow, includeFiles: false, includeDirectories: false })).toEqual([])
  })

  it.each([-1, -1.8, NaN, Infinity, -Infinity, undefined, null, '2'])('safely normalizes invalid or negative offset %s to zero', async (offset) => {
    const root = await fixture()
    expect(await fileStorage.listDirectory(event, root, { ...shallow, offset: offset as number, maxEntries: 1 })).toEqual([entry('AppDir', 'directory')])
  })

  it('floors fractional offsets and handles huge or exhausted pages', async () => {
    const root = await fixture()
    expect(await fileStorage.listDirectory(event, root, { ...shallow, offset: 1.9, maxEntries: 1 })).toEqual([entry('Zoo', 'directory')])
    expect(await fileStorage.listDirectory(event, root, { ...shallow, offset: Number.MAX_VALUE })).toEqual([])
    expect(await fileStorage.listDirectory(event, root, { ...shallow, offset: 100, nameQuery: 'app' })).toEqual([])
  })

  it('preserves the default maximum of twenty entries', async () => {
    const root = await fixture()
    for (let i = 0; i < 25; i++) await fs.writeFile(path.join(root, `extra-${i}.txt`), '')
    expect(await fileStorage.listDirectory(event, root, shallow)).toHaveLength(20)
    expect(await fileStorage.listDirectory(event, root, { ...shallow, offset: 20 })).toHaveLength(11)
  })

  it('does not apply shallow options to recursive reference search', async () => {
    const root = await fixture()
    const options = { referenceSearch: true, searchPattern: 'nested-app', maxEntries: 1 }
    expect(await fileStorage.listDirectory(event, root, { ...options, ...shallow, nameQuery: 'missing', offset: 999 })).toEqual(
      await fileStorage.listDirectory(event, root, options)
    )
    expect(await fileStorage.listDirectory(event, root, options)).toEqual(['AppDir/nested-app.txt'])
  })

  it.each([{ typed: true }, { typed: false, recursive: false }, {}])('keeps legacy ripgrep routing unchanged for %j', async (options) => {
    const root = await fixture()
    // Stub only the legacy implementation; assert the public IPC handler still delegates unchanged.
    const legacy = vi.spyOn(fileStorage as any, 'listDirectoryWithRipgrep').mockResolvedValue(['legacy.txt'])
    expect(await fileStorage.listDirectory(event, root, { ...options, offset: 999, nameQuery: 'missing' })).toEqual(['legacy.txt'])
    expect(legacy).toHaveBeenCalledWith(root, expect.objectContaining({ ...options, offset: 999, nameQuery: 'missing' }))
  })

  it('continues to surface missing roots and non-directory errors', async () => {
    const root = await fixture()
    await expect(fileStorage.listDirectory(event, path.join(root, 'gone'), shallow)).rejects.toThrow()
    await expect(fileStorage.listDirectory(event, path.join(root, 'a.txt'), shallow)).rejects.toThrow('Path is not a directory')
  })
})
