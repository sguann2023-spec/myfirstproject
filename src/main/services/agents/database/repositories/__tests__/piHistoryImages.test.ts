import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import { sql, type SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareHistoryImageProjection, relocateHistoryImageReferences, PI_HISTORY_IMAGE_LIMITS, type HistoryImageDatabase, type HistoryImageProjectionStats } from '../piHistoryImages'

describe('relocateHistoryImageReferences', () => {
  let root: string
  let oldWorkspace: string
  let newWorkspace: string
  const filename = `image-${createHash('sha256').update('abc').digest('hex')}.png`
  const imagePath = (workspace: string) => path.join(workspace, '.tool-results', 'history-images', filename)
  const referenceText = (file: string) => `Previously loaded image: ${JSON.stringify(file)}. Raw image omitted when restoring history. Use ReadImageAsContent with this file_path if visual inspection is needed again.`

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-relocation-')))
    oldWorkspace = path.join(root, 'old workspace')
    newWorkspace = path.join(root, 'new "workspace"')
    await mkdir(path.dirname(imagePath(oldWorkspace)), { recursive: true })
    await writeFile(imagePath(oldWorkspace), 'abc')
    await rename(oldWorkspace, newWorkspace)
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('relocates managed files and both known texts after a rename without mutating the input', async () => {
    const oldFile = imagePath(oldWorkspace), newFile = imagePath(newWorkspace)
    const canonicalText = `Previously loaded image: ${JSON.stringify(oldFile)}. Use ReadImageAsContent with this file_path or URL if visual inspection is needed again.`
    const input = { source: oldFile, url: oldFile, content: [{ type: 'text', text: referenceText(oldFile) }, { type: 'text', text: canonicalText }] }
    const before = structuredClone(input)
    const result = await relocateHistoryImageReferences(input, oldWorkspace, newWorkspace)
    expect(result.source).toBe(newFile)
    expect(result.url).toBe(newFile)
    expect(result.content[0].text).toBe(referenceText(newFile))
    expect(result.content[1].text).toBe(canonicalText.replace(JSON.stringify(oldFile), JSON.stringify(newFile)))
    expect(input).toEqual(before)
    expect(await readFile(newFile, 'utf8')).toBe('abc')
    expect(await relocateHistoryImageReferences(result, oldWorkspace, newWorkspace)).toEqual(result)
  })

  it('relocates managed media URL references inside serialized results', async () => {
    const mediaName = `media-${createHash('sha256').update('abc').digest('hex')}.mp4`
    const oldFile = path.join(oldWorkspace, '.tool-results', 'history-images', mediaName)
    const newFile = path.join(newWorkspace, '.tool-results', 'history-images', mediaName)
    await writeFile(newFile, 'abc')
    const input = { output: JSON.stringify({ video_url: oldFile }), source: oldFile }
    const result = await relocateHistoryImageReferences(input, oldWorkspace, newWorkspace)
    expect(JSON.parse(result.output).video_url).toBe(newFile)
    expect(result.source).toBe(newFile)
    expect(input.source).toBe(oldFile)
  })

  it('preserves JSON-in-text wrappers and only interprets known result fields or text blocks', async () => {
    const oldFile = imagePath(oldWorkspace), newFile = imagePath(newWorkspace)
    const encoded = JSON.stringify(JSON.stringify({ source: oldFile, content: [{ type: 'text', text: referenceText(oldFile) }] }))
    const input = { output: encoded, content: [{ type: 'text', text: encoded }], arguments: encoded,
      metadata: encoded, text: encoded, result: ' { "ok": true } ', rawOutput: '{malformed' }
    const result = await relocateHistoryImageReferences(input, oldWorkspace, newWorkspace)
    expect(JSON.parse(JSON.parse(result.output)).source).toBe(newFile)
    expect(JSON.parse(JSON.parse(result.content[0].text)).content[0].text).toBe(referenceText(newFile))
    for (const key of ['arguments', 'metadata', 'text', 'result', 'rawOutput'] as const) expect(result[key]).toBe(input[key])
    expect(JSON.parse(JSON.parse(await relocateHistoryImageReferences(encoded, oldWorkspace, newWorkspace))).source).toBe(newFile)
  })

  it('does not replace prose, arbitrary paths, staging files, traversal or other workspaces', async () => {
    const oldFile = imagePath(oldWorkspace)
    const input = [
      `Please inspect ${oldFile}`, `prefix ${referenceText(oldFile)}`, `${referenceText(oldFile)} extra`, `${referenceText(oldFile)}\n`,
      referenceText(path.join(oldWorkspace, 'photo.png')), path.join(oldWorkspace, 'photo.png'),
      path.join(oldWorkspace, '.tool-results', 'history-images', '.pending-abc'),
      path.join(oldWorkspace, '.tool-results', 'history-images', 'image-short.png'),
      `${oldFile}\n`,
      path.join(oldWorkspace, '.tool-results', 'history-images', filename.replace('.png', '.bmp')),
      `${oldWorkspace}/.tool-results/history-images/../history-images/${filename}`,
      path.join(`${oldWorkspace}-other`, '.tool-results', 'history-images', filename),
      'https://example.com/' + filename, `Previously loaded image: "bad\\q". Raw image omitted when restoring history. Use ReadImageAsContent with this file_path if visual inspection is needed again.`
    ]
    expect(await relocateHistoryImageReferences(input, oldWorkspace, newWorkspace)).toEqual(input)
  })

  it('retains references when the destination is missing, a directory or a symlink', async () => {
    const oldFile = imagePath(oldWorkspace), newFile = imagePath(newWorkspace)
    const input = { source: oldFile, text: referenceText(oldFile) }
    await rm(newFile)
    expect(await relocateHistoryImageReferences(input, oldWorkspace, newWorkspace)).toEqual(input)
    await mkdir(newFile)
    expect(await relocateHistoryImageReferences(input, oldWorkspace, newWorkspace)).toEqual(input)
    await rm(newFile, { recursive: true })
    const outside = path.join(root, 'outside.png')
    await writeFile(outside, 'abc')
    await symlink(outside, newFile)
    expect(await relocateHistoryImageReferences(input, oldWorkspace, newWorkspace)).toEqual(input)
    await rm(path.join(newWorkspace, '.tool-results'), { recursive: true })
    await mkdir(path.join(root, 'outside', 'history-images'), { recursive: true })
    await writeFile(path.join(root, 'outside', 'history-images', filename), 'abc')
    await symlink(path.join(root, 'outside'), path.join(newWorkspace, '.tool-results'))
    expect(await relocateHistoryImageReferences(input, oldWorkspace, newWorkspace)).toEqual(input)
  })

  it('handles empty/unchanged workspaces and cyclic containers without altering unrelated values', async () => {
    const input: { source: string; self?: unknown } = { source: imagePath(oldWorkspace) }
    input.self = input
    expect(await relocateHistoryImageReferences(input, '', newWorkspace)).toBe(input)
    expect(await relocateHistoryImageReferences(input, oldWorkspace, oldWorkspace)).toBe(input)
    const result = await relocateHistoryImageReferences(input, oldWorkspace, newWorkspace)
    expect(result.source).toBe(imagePath(newWorkspace))
    expect(result.self).toBe(result)
    expect(input.source).toBe(imagePath(oldWorkspace))
  })
})

describe('prepareHistoryImageProjection', () => {
  let sqlite: DatabaseSync
  let workspace: string
  let db: HistoryImageDatabase
  let transfers: unknown[][]
  const dialect = new SQLiteSyncDialect()
  const compile = (query: SQL) => dialect.sqlToQuery(query)
  const insert = (id: string, body: unknown, type = 'tool', scope = 'selected') => {
    sqlite.prepare('INSERT INTO history VALUES (?,?,?,?)').run(id, JSON.stringify(body), type, scope)
  }
  const prepare = (workspacePath: string | null = workspace, onStats?: (stats: HistoryImageProjectionStats) => void) =>
    prepareHistoryImageProjection(db, 'history', 'data_json', sql`scope=${'selected'}`, 'id', workspacePath, undefined, onStats)
  const read = async (expression: SQL, id = 'one') => {
    const [row] = await db.all<{ body: string }>(sql`SELECT ${expression} AS body FROM history WHERE id=${id}`)
    return JSON.parse(row.body)
  }
  const tempTables = () => sqlite.prepare("SELECT name FROM sqlite_temp_master WHERE type='table'").all()
  const files = async () => {
    try {
      const root = path.join(workspace, '.tool-results')
      return (await Promise.all((await readdir(root)).map(async dir =>
        (await readdir(path.join(root, dir))).map(file => path.join(root, dir, file))))).flat()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  const reference = (text: string) => JSON.parse(/^Previously loaded image: (".*?")\./.exec(text)![1]) as string

  beforeEach(async () => {
    workspace = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-history-images-test-')))
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('CREATE TABLE history(id TEXT, data_json TEXT, type TEXT, scope TEXT)')
    transfers = []
    db = {
      all<T>(query: SQL): T[] {
        const compiled = compile(query)
        const rows = sqlite.prepare(compiled.sql).all(...compiled.params as any[])
        transfers.push(rows)
        return rows as T[]
      },
      run(query: SQL) {
        const compiled = compile(query)
        return sqlite.prepare(compiled.sql).run(...compiled.params as any[])
      }
    }
  })

  afterEach(async () => {
    sqlite.close()
    await rm(workspace, { recursive: true, force: true })
  })

  it('externalizes a multi-chunk typed image without transferring the original body or changing the source', async () => {
    const bytes = Buffer.alloc(256 * 1024 + 1, 0x71)
    const data = bytes.toString('base64')
    const body = { content: [{ type: 'text', text: 'before' }, { type: 'image', mimeType: 'image/png', data }, { type: 'text', text: 'after' }] }
    insert('one', body)
    const original = sqlite.prepare('SELECT data_json FROM history').get()!.data_json
    const projection = await prepare()
    const strings = transfers.flatMap(rows => rows.flatMap(row => Object.values(row as object).filter(value => typeof value === 'string'))) as string[]
    expect(Math.max(...strings.map(value => value.length))).toBeLessThanOrEqual(PI_HISTORY_IMAGE_LIMITS.chunkChars)
    expect(strings).not.toContain(data)
    const result = await read(projection.expression)
    expect(result.content[0]).toEqual(body.content[0])
    expect(result.content[2]).toEqual(body.content[2])
    expect(result.content[1].type).toBe('text')
    const file = reference(result.content[1].text)
    expect(path.basename(file)).toBe(`image-${createHash('sha256').update(bytes).digest('hex')}.png`)
    expect(await readFile(file)).toEqual(bytes)
    expect(sqlite.prepare('SELECT data_json FROM history').get()!.data_json).toBe(original)
    await Promise.all([projection.dispose(), projection.dispose()])
    expect(tempTables()).toEqual([])
    expect(await readFile(file)).toEqual(bytes)
  })

  it('handles named base64, Anthropic sources, data URLs and canonical root images', async () => {
    const bytes = Buffer.from('image bytes')
    const data = bytes.toString('base64')
    insert('one', { image_base64: data, url: `data:image/jpeg;base64,${data}`,
      source: { type: 'base64', media_type: 'image/webp', data }, untouched: data })
    insert('root', { data, mediaType: 'image/png', width: 42 }, 'image')
    const projection = await prepare()
    const result = await read(projection.expression)
    for (const file of [result.image_base64, result.url, result.source.data]) expect(await readFile(file)).toEqual(bytes)
    expect(result.untouched).toBe(data)
    const root = await read(projection.expression, 'root')
    expect(root.data).toBeUndefined()
    expect(root.width).toBe(42)
    expect(root.content).toBe(root.text)
    expect(await readFile(root.source)).toEqual(bytes)
    await projection.dispose()
  })

  it('projects nested JSON text without converting strings into objects', async () => {
    const data = Buffer.from('nested image').toString('base64')
    const inner = { content: [{ type: 'image', mimeType: 'image/gif', data }], ok: true }
    insert('one', { type: 'text', text: JSON.stringify({ output: JSON.stringify(inner) }), other: 'not JSON' })
    const projection = await prepare()
    const result = await read(projection.expression)
    expect(typeof result.text).toBe('string')
    const middle = JSON.parse(result.text)
    expect(typeof middle.output).toBe('string')
    const projected = JSON.parse(middle.output)
    expect(projected.ok).toBe(true)
    expect(await readFile(reference(projected.content[0].text))).toEqual(Buffer.from('nested image'))
    expect(result.other).toBe('not JSON')
    await projection.dispose()
  })

  it('externalizes explicit audio/video URLs inside nested results without reinterpreting encoded data or prose', async () => {
    const bytes = Buffer.alloc(100000, 0x71)
    const data = bytes.toString('base64')
    const url = `data:video/mp4;base64,${data}`
    const inner = { video_url: url, content: [{ type: 'audio_url', audio_url: { url: `data:audio/wav;base64,${data}` } }] }
    const body = { output: JSON.stringify(JSON.stringify(inner)), description: url,
      data: url, content: [{ type: 'audio', mimeType: 'audio/wav', data }], url: 'data:video/unknown;base64,YWJj' }
    insert('one', body)
    const projection = await prepare()
    const result = await read(projection.expression)
    const projected = JSON.parse(JSON.parse(result.output))
    for (const file of [projected.video_url, projected.content[0].audio_url.url]) {
      expect(path.basename(file)).toMatch(/^media-/)
      expect(await readFile(file)).toEqual(bytes)
    }
    expect(projected.content[0].type).toBe('audio_url')
    for (const key of ['description', 'data', 'content', 'url']) expect(result[key]).toEqual(body[key])
    expect(JSON.parse(sqlite.prepare('SELECT data_json FROM history').get()!.data_json as string)).toEqual(body)
    await projection.dispose()
    const second = await prepare()
    expect(await read(second.expression)).toEqual(result)
    expect(await files()).toHaveLength(2)
    await second.dispose()
  })

  it('keeps raw values and performs no database or filesystem work without a workspace', async () => {
    const body = { type: 'image', data: 'YWJj', mimeType: 'image/png' }
    insert('one', body)
    const projection = await prepare(null)
    expect(transfers).toEqual([])
    expect(tempTables()).toEqual([])
    expect(await read(projection.expression)).toEqual(body)
    await projection.dispose()
    expect(await readdir(workspace)).toEqual([])
  })

  it('preserves malformed JSON, invalid base64, unsupported MIME and unselected rows', async () => {
    const body = { content: [{ type: 'image', data: '!!!!', mimeType: 'image/png' },
      { type: 'image', data: 'YWJj', mimeType: 'image/unknown' }], url: 'data:text/plain;base64,YWJj',
      arbitrary: { type: 'base64', data: 'YWJj' } }
    insert('one', body)
    insert('excluded', { type: 'image', data: 'YWJj', mimeType: 'image/png' }, 'tool', 'other')
    sqlite.prepare('INSERT INTO history VALUES (?,?,?,?)').run('bad', '{bad', 'tool', 'selected')
    const projection = await prepare()
    expect(await read(projection.expression)).toEqual(body)
    expect(await read(projection.expression, 'excluded')).toEqual({ type: 'image', data: 'YWJj', mimeType: 'image/png' })
    const [bad] = await db.all<{ body: string }>(sql`SELECT ${projection.expression} AS body FROM history WHERE id='bad'`)
    expect(bad.body).toBe('{bad')
    expect(await files()).toEqual([])
    await projection.dispose()
  })

  it('preserves deeply nested results instead of rejecting unrelated JSON or depth overflow', async () => {
    let text = JSON.stringify({ ['x'.repeat(PI_HISTORY_IMAGE_LIMITS.pathBytes + 1)]: true })
    for (let i = 0; i <= PI_HISTORY_IMAGE_LIMITS.nestedJsonDepth; i++) text = JSON.stringify({ output: text })
    const unrelated = JSON.stringify({ ['x'.repeat(PI_HISTORY_IMAGE_LIMITS.pathBytes + 1)]:
      { type: 'image', data: 'YWJj', mimeType: 'image/png' } })
    const body = { output: text, metadata: text, arguments: unrelated, text: unrelated }
    insert('one', body)
    const projection = await prepare()
    expect(await read(projection.expression)).toEqual(body)
    await projection.dispose()
    expect(tempTables()).toEqual([])
    expect(await files()).toEqual([])
  })

  it('rejects oversized images before transferring any payload', async () => {
    sqlite.prepare('INSERT INTO history VALUES (?,?,?,?)').run('one',
      `{"type":"image","mimeType":"image/png","data":"${'A'.repeat((Math.ceil(PI_HISTORY_IMAGE_LIMITS.imageBytes / 3) + 1) * 4)}"}`, 'tool', 'selected')
    await expect(prepare()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    expect(transfers.flat().some(row => Object.keys(row as object).includes('chunk'))).toBe(false)
    expect(tempTables()).toEqual([])
    expect(await files()).toEqual([])
  })

  it('isolates concurrent projections and rejects duplicate or null identities', async () => {
    insert('one', { type: 'image', data: 'YWJj', mimeType: 'image/png' })
    const [first, second] = await Promise.all([prepare(), prepare()])
    expect(tempTables()).toHaveLength(4)
    expect(reference((await read(first.expression)).text)).toBe(reference((await read(second.expression)).text))
    expect(await files()).toHaveLength(1)
    await first.dispose()
    expect((await read(second.expression)).type).toBe('text')
    await second.dispose()
    insert('one', { ok: true })
    await expect(prepare()).rejects.toThrow('unique non-null ids')
    expect(tempTables()).toEqual([])
    sqlite.exec('DELETE FROM history')
    sqlite.prepare('INSERT INTO history VALUES (NULL,?,?,?)').run('{}', 'tool', 'selected')
    await expect(prepare()).rejects.toThrow('unique non-null ids')
  })

  it('rejects a symlinked output directory without writing outside the workspace', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'pi-history-outside-'))
    try {
      await symlink(outside, path.join(workspace, '.tool-results'))
      insert('one', { type: 'image', data: 'YWJj', mimeType: 'image/png' })
      await expect(prepare()).rejects.toThrow('Unsafe history image output directory')
      expect(await readdir(outside)).toEqual([])
      expect(tempTables()).toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('works on a read-only source database and leaves the persisted database untouched', async () => {
    const databasePath = path.join(workspace, 'source.sqlite')
    const writer = new DatabaseSync(databasePath)
    writer.exec('CREATE TABLE history(id TEXT, data_json TEXT, type TEXT, scope TEXT)')
    writer.prepare('INSERT INTO history VALUES (?,?,?,?)').run('one',
      JSON.stringify({ type: 'image', data: 'YWJj', mimeType: 'image/png' }), 'tool', 'selected')
    writer.close()
    const before = await readFile(databasePath)
    sqlite.close()
    sqlite = new DatabaseSync(databasePath, { readOnly: true })
    const projection = await prepare()
    expect((await read(projection.expression)).type).toBe('text')
    await projection.dispose()
    expect(await readFile(databasePath)).toEqual(before)
  })

  it('bounds JSON paths and does not confuse dotted or quoted keys with ordinary paths', async () => {
    const bytes = Buffer.from('safe paths')
    insert('one', { 'a.b': { 'quote"key': { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' } },
      a: { b: 'preserved' } })
    const projection = await prepare()
    const result = await read(projection.expression)
    expect(result.a.b).toBe('preserved')
    expect(await readFile(reference(result['a.b']['quote"key'].text))).toEqual(bytes)
    await projection.dispose()
    sqlite.exec('DELETE FROM history')
    insert('one', { ['x'.repeat(PI_HISTORY_IMAGE_LIMITS.pathBytes + 1)]: 'value' })
    await expect(prepare()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    expect(tempTables()).toEqual([])
  })

  it('reuses content-addressed files across recoveries without replacing the existing inode', async () => {
    const data = Buffer.alloc(100000, 0x34).toString('base64')
    insert('one', { type: 'image', data, mimeType: 'image/png' })
    const first = await prepare()
    const file = reference((await read(first.expression)).text)
    const before = await stat(file)
    await first.dispose()
    // A second database connection models a new recovery with no process cache.
    sqlite.close()
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('CREATE TABLE history(id TEXT, data_json TEXT, type TEXT, scope TEXT)')
    insert('one', { url: `data:image/png;base64,${data}` })
    const second = await prepare()
    expect((await read(second.expression)).url).toBe(file)
    const after = await stat(file)
    expect(after.ino).toBe(before.ino)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(await files()).toEqual([file])
    await second.dispose()
  })

  it('keeps final filenames invisible during chunk writes and publishes only complete bytes', async () => {
    const bytes = Buffer.alloc(150000, 0x62)
    insert('one', { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' })
    const all: HistoryImageDatabase['all'] = db.all.bind(db)
    let chunks = 0
    db.all = async <T>(query: SQL): Promise<T[]> => {
      if (compile(query).sql.includes('substr(payload')) {
        const current = await files()
        expect(current).toHaveLength(1)
        expect(path.basename(current[0])).toMatch(/^\.pending-/)
        expect((await stat(current[0])).size).toBeLessThan(bytes.length)
        chunks++
      }
      return await all<T>(query)
    }
    const projection = await prepare()
    expect(chunks).toBeGreaterThan(1)
    const file = reference((await read(projection.expression)).text)
    expect(await files()).toEqual([file])
    expect(await readFile(file)).toEqual(bytes)
    await projection.dispose()
  })

  it('cleans partial staging files on a chunk-read failure without deleting previously referenced files', async () => {
    insert('one', { type: 'image', data: 'YWJj', mimeType: 'image/png' })
    const first = await prepare()
    const file = reference((await read(first.expression)).text)
    await first.dispose()
    sqlite.exec('DELETE FROM history')
    insert('one', { type: 'image', data: Buffer.alloc(150000, 0x65).toString('base64'), mimeType: 'image/png' })
    const all: HistoryImageDatabase['all'] = db.all.bind(db)
    let chunks = 0
    db.all = <T>(query: SQL) => {
      if (compile(query).sql.includes('substr(payload') && ++chunks === 2) throw new Error('chunk read failed')
      return all<T>(query)
    }
    await expect(prepare()).rejects.toThrow('chunk read failed')
    expect(await files()).toEqual([file])
    expect(await readFile(file)).toEqual(Buffer.from('abc'))
    expect(tempTables()).toEqual([])
  })

  it('retains a newly published file when another recovery references it before projection failure', async () => {
    insert('one', { type: 'image', data: 'YWJj', mimeType: 'image/png' })
    const run = db.run.bind(db)
    const readerDb = { all: db.all.bind(db), run }
    let referenced: string | undefined
    let other: Awaited<ReturnType<typeof prepare>> | undefined
    db.run = async (query: SQL) => {
      if (compile(query).sql.includes('SET body=json_set')) {
        other = await prepareHistoryImageProjection(readerDb, 'history', 'data_json', sql`scope='selected'`, 'id', workspace)
        referenced = reference((await read(other.expression)).text)
        throw new Error('projection failed after publish')
      }
      return run(query)
    }
    await expect(prepare()).rejects.toThrow('projection failed after publish')
    expect(await files()).toEqual([referenced])
    expect(await readFile(referenced!)).toEqual(Buffer.from('abc'))
    expect(reference((await read(other!.expression)).text)).toBe(referenced)
    await other!.dispose()
    expect(tempTables()).toEqual([])
  })

  it('rejects corrupt existing content-addressed files without overwriting or deleting them', async () => {
    insert('one', { type: 'image', data: 'YWJj', mimeType: 'image/png' })
    const first = await prepare()
    const file = reference((await read(first.expression)).text)
    await first.dispose()
    await writeFile(file, 'bad')
    await expect(prepare()).rejects.toThrow('Invalid existing history image file')
    expect(await readFile(file)).toEqual(Buffer.from('bad'))
    expect(await files()).toEqual([file])
    expect(tempTables()).toEqual([])
  })

  it('parses only known result strings, including quoted wrappers, and preserves unrelated JSON byte-for-byte', async () => {
    const image = { content: [{ type: 'image', data: 'YWJj', mimeType: 'image/png' }] }
    const encoded = JSON.stringify(JSON.stringify(image))
    const unrelated = ' { "output": ' + JSON.stringify(JSON.stringify(image)) + ' } '
    insert('one', { responseRaw: encoded, content: [{ type: 'text', text: JSON.stringify(image) }],
      metadata: unrelated, arguments: unrelated, prompt: unrelated, description: unrelated, text: unrelated,
      result: ' { "ok": true } ' })
    const projection = await prepare()
    const result = await read(projection.expression)
    expect(JSON.parse(JSON.parse(result.responseRaw)).content[0].type).toBe('text')
    expect(JSON.parse(result.content[0].text).content[0].type).toBe('text')
    for (const key of ['metadata', 'arguments', 'prompt', 'description', 'text']) expect(result[key]).toBe(unrelated)
    expect(result.result).toBe(' { "ok": true } ')
    expect(await files()).toHaveLength(1)
    await projection.dispose()
  })

  it('classifies escaped media keys, data prefixes and nested result wrappers after JSON decoding', async () => {
    const rows = [
      ['escaped-key', '{"type":"image","\\u0064ata":"YWJj","mimeType":"image/png"}'],
      ['escaped-prefix', '{"url":"\\u0064ata:image/png;base64,YWJj"}'],
      ['escaped-nested', '{"\\u006futput":' + JSON.stringify(JSON.stringify(JSON.stringify({ image_base64: 'YWJj' }))) + '}']
    ]
    for (const [id, value] of rows) sqlite.prepare('INSERT INTO history VALUES (?,?,?,?)').run(id, value, 'tool', 'selected')
    const originals = sqlite.prepare('SELECT data_json FROM history ORDER BY id').all()
    const projection = await prepare()
    expect((await read(projection.expression, 'escaped-key')).type).toBe('text')
    expect(await readFile((await read(projection.expression, 'escaped-prefix')).url)).toEqual(Buffer.from('abc'))
    expect(await readFile(JSON.parse(JSON.parse((await read(projection.expression, 'escaped-nested')).output)).image_base64)).toEqual(Buffer.from('abc'))
    expect(sqlite.prepare('SELECT data_json FROM history ORDER BY id').all()).toEqual(originals)
    await projection.dispose()
    expect(tempTables()).toEqual([])
  })

  it.each([false, true])('charges skipped roots and nested children exactly once across manifest pages (overflow=%s)', async overflow => {
    for (let index = 0; index < 128; index++) insert(`plain-${index}`, { content: 'ordinary prose' })
    insert('nested', { output: JSON.stringify({ ok: true, next: true }) })
    const all: HistoryImageDatabase['all'] = db.all.bind(db)
    db.all = async <T>(query: SQL) => {
      const rows = await all<T>(query)
      // Model a near-limit first page without allocating a million-node fixture.
      // The real nested document still spends its own three-node budget.
      if (compile(query).sql.includes('AS textCount')) {
        for (const row of rows as Array<{ doc: number; count: number }>) {
          if (row.doc === 1) row.count = PI_HISTORY_IMAGE_LIMITS.nodes - (overflow ? 258 : 259)
        }
      }
      return rows
    }
    if (overflow) {
      await expect(prepare()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    } else {
      const projection = await prepare()
      expect(await read(projection.expression, 'nested')).toEqual({ output: JSON.stringify({ ok: true, next: true }) })
      await projection.dispose()
    }
    expect(tempTables()).toEqual([])
    expect(await files()).toEqual([])
  })

  it('keeps duplicate sibling discriminator documents on the checked projector path', async () => {
    sqlite.prepare('INSERT INTO history VALUES (?,?,?,?)').run('one', '{"type":"text","type":"text","text":"plain"}', 'tool', 'selected')
    const all: HistoryImageDatabase['all'] = db.all.bind(db)
    let scalarPages = 0
    db.all = async <T>(query: SQL) => {
      if (compile(query).sql.includes('SELECT j.node')) scalarPages++
      return await all<T>(query)
    }
    const projection = await prepare()
    expect(await read(projection.expression)).toEqual({ type: 'text', text: 'plain' })
    expect(scalarPages).toBeGreaterThan(0)
    await projection.dispose()
  })

  it.each([false, true])('profiles 1000 history documents with simulated worker latency (media=%s)', async media => {
    const count = 1000
    const body = (index: number) => ({ role: index % 2 ? 'assistant' : 'user', content: `history text ${index}`, timestamp: index })
    sqlite.exec('BEGIN')
    for (let index = 0; index < count; index++) insert(`entry-${index}`, body(index))
    if (media) insert('image', { content: [{ type: 'image', data: 'YWJj', mimeType: 'image/png' }],
      output: JSON.stringify({ url: 'data:image/png;base64,YWJj' }) })
    sqlite.exec('COMMIT')
    const all: HistoryImageDatabase['all'] = db.all.bind(db)
    const run = db.run.bind(db)
    let calls = 0
    db.all = async <T>(query: SQL) => {
      calls++
      await new Promise(resolve => setTimeout(resolve, 1))
      return await all<T>(query)
    }
    db.run = async (query: SQL) => {
      calls++
      await new Promise(resolve => setTimeout(resolve, 1))
      return await run(query)
    }
    const started = performance.now()
    const projection = await prepare()
    const elapsed = performance.now() - started
    console.info(`PI history startup profile: ${count} documents, media=${media}, ${calls} SQL calls, ${elapsed.toFixed(1)} ms (1ms simulated RPC latency)`)
    // Before batching the same fixture made 6007/6033 calls. Guard the actual
    // round trips rather than a machine-dependent timing improvement.
    expect(calls).toBeLessThan(media ? 80 : 30)
    expect(transfers.every(rows => rows.length <= 128)).toBe(true)
    expect(await read(projection.expression, 'entry-0')).toEqual(body(0))
    expect(await read(projection.expression, 'entry-999')).toEqual(body(999))
    if (media) {
      expect((await read(projection.expression, 'image')).content[0].type).toBe('text')
      expect(await files()).toHaveLength(1)
    } else expect(await files()).toEqual([])
    await projection.dispose()
    expect(tempTables()).toEqual([])
  }, 30000)

  it.each([false, true])('profiles 500 serialized tool results with simulated worker latency (media=%s)', async media => {
    const count = 500
    const body = (index: number) => ({ role: 'toolResult', toolCallId: `call-${index}`, toolName: 'ReadFile',
      content: [{ type: 'text', text: ' { "ok": true, "files": ' + JSON.stringify([
        { name: `file-${index}.ts`, lines: 42, status: 'read' }
      ]) + (media && index % 100 === 0 ? ', "url": "data:image/png;base64,YWJj"' : '') + ' } ' }], timestamp: index })
    sqlite.exec('BEGIN')
    for (let index = 0; index < count; index++) insert(`tool-${index}`, body(index))
    sqlite.exec('COMMIT')
    const originals = sqlite.prepare('SELECT data_json FROM history ORDER BY id').all()
    const all: HistoryImageDatabase['all'] = db.all.bind(db)
    const run = db.run.bind(db)
    let calls = 0
    db.all = async <T>(query: SQL) => {
      calls++
      await new Promise(resolve => setTimeout(resolve, 1))
      return await all<T>(query)
    }
    db.run = async (query: SQL) => {
      calls++
      await new Promise(resolve => setTimeout(resolve, 1))
      return await run(query)
    }
    const started = performance.now()
    const projection = await prepare()
    const elapsed = performance.now() - started
    console.info(`PI serialized tool-result profile: ${count} documents, media=${media}, ${calls} SQL calls, ${elapsed.toFixed(1)} ms (1ms simulated RPC latency)`)
    // Measured before these optimizations: 7015 / 7040 preparation calls.
    // Ordinary nested JSON must be proved unchanged in bounded root batches.
    expect(calls).toBe(media ? 119 : 19)
    expect(transfers.every(rows => rows.length <= 128)).toBe(true)
    expect(await read(projection.expression, 'tool-499')).toEqual(body(499))
    if (media) {
      const projected = JSON.parse((await read(projection.expression, 'tool-0')).content[0].text)
      expect(await readFile(projected.url)).toEqual(Buffer.from('abc'))
      expect(await files()).toHaveLength(1)
    } else {
      const rows = await db.all<{ body: string }>(sql`SELECT ${projection.expression} AS body FROM history ORDER BY id`)
      expect(rows.map(row => row.body)).toEqual(originals.map(row => row.data_json))
      expect(await files()).toEqual([])
    }
    expect(sqlite.prepare('SELECT data_json FROM history ORDER BY id').all()).toEqual(originals)
    await projection.dispose()
    expect(tempTables()).toEqual([])
  }, 30000)

  it('classifies many non-image leaves entirely in SQLite without transferring scalar pages', async () => {
    const count = 20000
    const body = Object.fromEntries(Array.from({ length: count }, (_, index) => [`field${index}`, `plain text ${index}`]))
    insert('one', body)
    const queries: string[] = []
    const all: HistoryImageDatabase['all'] = db.all.bind(db)
    const run = db.run.bind(db)
    db.all = <T>(query: SQL) => {
      queries.push(compile(query).sql)
      return all<T>(query)
    }
    db.run = (query: SQL) => {
      queries.push(compile(query).sql)
      return run(query)
    }
    const started = performance.now()
    const projection = await prepare()
    const elapsed = performance.now() - started
    const treeQueries = queries.filter(query => query.includes('json_tree('))
    expect(treeQueries).toHaveLength(2)
    const pages = transfers.filter(rows => rows.length && Object.prototype.hasOwnProperty.call(rows[0], 'node'))
    expect(pages).toHaveLength(0)
    expect(queries.some(query => query.includes('INSERT INTO') && query.includes('chars,prefix,nested'))).toBe(false)
    expect(queries.length).toBeLessThan(15)
    // Generous wall-clock backstop; scan/query counts are the deterministic guard.
    expect(elapsed).toBeLessThan(5000)
    console.info(`PI image-free projection: ${count} leaves, ${treeQueries.length} tree scans, ${pages.length} pages, ${elapsed.toFixed(1)} ms`)
    expect(await read(projection.expression)).toEqual(body)
    expect(await files()).toEqual([])
    await projection.dispose()
    expect(tempTables()).toEqual([])
  })

  it('proves one-level result JSON in batches without transferring scalars or changing a byte', async () => {
    const nested = ' \n { "ok": true, "items": [ { "name": "a.ts" }, 42, null ] } \t '
    const body = { output: nested, rawOutput: nested, result: nested, responseRaw: nested, structuredContent: nested,
      content: [{ type: 'text', text: nested }], metadata: nested, arguments: nested }
    // JSON decoding, not raw spelling, determines key/path eligibility.
    const original = ' \n ' + JSON.stringify(body, null, 2).replace('"output"', '"\\u006futput"') + ' \t '
    sqlite.prepare('INSERT INTO history VALUES (?,?,?,?)').run('one', original, 'tool', 'selected')
    const reports: HistoryImageProjectionStats[] = []
    const projection = await prepare(workspace, stats => reports.push(stats))
    const report = reports[0]
    expect(report).toMatchObject({ queryCount: 10, candidateCount: 1, nestedDocuments: 6, leafPages: 0, rows: 1,
      sourceBytes: Buffer.byteLength(original) })
    const rootCount = sqlite.prepare('SELECT count(*) AS count FROM json_tree(?)').get(original)!.count as number
    const childCount = sqlite.prepare('SELECT count(*) AS count FROM json_tree(?)').get(nested)!.count as number
    const rootText = sqlite.prepare("SELECT count(*) AS count FROM json_tree(?) WHERE type='text'").get(original)!.count as number
    const childText = sqlite.prepare("SELECT count(*) AS count FROM json_tree(?) WHERE type='text'").get(nested)!.count as number
    expect(report.nodes).toBe(rootCount + 6 * childCount)
    expect(report.visits).toBe(rootText + 6 * childText)
    expect(transfers.flat().some(row => Object.prototype.hasOwnProperty.call(row, 'node'))).toBe(false)
    const [row] = await db.all<{ body: string }>(sql`SELECT ${projection.expression} AS body FROM history`)
    expect(row.body).toBe(original)
    await projection.dispose()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toEqual(report)
    expect(tempTables()).toEqual([])
  })

  it('only counts actual text blocks and known result fields when proving nested JSON', async () => {
    const deep = JSON.stringify({ ['x'.repeat(PI_HISTORY_IMAGE_LIMITS.pathBytes + 1)]: { image_base64: 'YWJj' } })
    const body = { text: deep, metadata: deep, arguments: deep, content: [
      { type: 'note', text: deep }, { type: 'text', text: ' { "ok": true } ' }
    ] }
    insert('one', body)
    let report!: HistoryImageProjectionStats
    const projection = await prepare(workspace, stats => { report = stats })
    expect(await read(projection.expression)).toEqual(body)
    expect(report).toMatchObject({ nestedDocuments: 1, leafPages: 0 })
    expect(await files()).toEqual([])
    await projection.dispose()
  })

  it('uses shared child preflight for deeper plain results while preserving serialized bytes', async () => {
    const body = { output: JSON.stringify({ output: ' { "ok": true, "message": "done" } ' }) }
    insert('one', body)
    let report!: HistoryImageProjectionStats
    const projection = await prepare(workspace, stats => { report = stats })
    expect(await read(projection.expression)).toEqual(body)
    expect(report).toMatchObject({ nestedDocuments: 2, candidateCount: 2, leafPages: 2 })
    const pages = transfers.filter(rows => rows.length && Object.prototype.hasOwnProperty.call(rows[0], 'node'))
    expect(pages).toHaveLength(2)
    await projection.dispose()
    expect(tempTables()).toEqual([])
  })

  it.each([0, 1, 7, 8, 9])('preserves quoted root wrappers and nested depth limits (wrappers=%s)', async wrappers => {
    const image = { image_base64: 'YWJj' }
    let encoded = JSON.stringify(image)
    for (let index = 0; index < wrappers; index++) encoded = JSON.stringify(encoded)
    const body = { output: encoded }
    insert('one', body)
    const projection = await prepare()
    const result = await read(projection.expression)
    if (wrappers < PI_HISTORY_IMAGE_LIMITS.nestedJsonDepth) {
      let value = result.output
      for (let index = 0; index <= wrappers; index++) value = JSON.parse(value)
      expect(await readFile(value.image_base64)).toEqual(Buffer.from('abc'))
    } else {
      expect(result).toEqual(body)
      expect(await files()).toEqual([])
    }
    await projection.dispose()
    expect(tempTables()).toEqual([])
  })

  it.each([false, true])('checks paths of eligible plain child JSON (oversized=%s)', async oversized => {
    const key = 'x'.repeat(PI_HISTORY_IMAGE_LIMITS.pathBytes - 2 + (oversized ? 1 : 0))
    const nested = JSON.stringify({ [key]: 'ordinary' })
    insert('one', { content: [{ type: 'text', text: nested }] })
    if (oversized) await expect(prepare()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    else {
      const projection = await prepare()
      expect((await read(projection.expression)).content[0].text).toBe(nested)
      await projection.dispose()
    }
    expect(tempTables()).toEqual([])
  })

  it.each(['type', 'mimeType', 'mediaType', 'media_type'])('keeps nested duplicate %s discriminators on checked scalar pages', async discriminator => {
    const inner = `{ "${discriminator}": "text", "${discriminator}": "text", "message": "plain" }`
    insert('one', { output: inner })
    let report!: HistoryImageProjectionStats
    const projection = await prepare(workspace, stats => { report = stats })
    expect((await read(projection.expression)).output).toBe(inner)
    expect(report).toMatchObject({ nestedDocuments: 1, candidateCount: 2, leafPages: 2 })
    await projection.dispose()
  })

  it.each(['wrapper', '\\u0077rapper'])('does not prove duplicate ancestor/result paths using a different extracted occurrence (%s)', async key => {
    const body = '{"wrapper":{"output":"{\\"ok\\":true}"},"' + key + '":{"output":"{\\"items\\":[1,2,3]}"}}'
    sqlite.prepare('INSERT INTO history VALUES (?,?,?,?)').run('one', body, 'tool', 'selected')
    let report!: HistoryImageProjectionStats
    const projection = await prepare(workspace, stats => { report = stats })
    expect(report.leafPages).toBeGreaterThan(0)
    const expectedChildNodes = sqlite.prepare('SELECT count(*) AS count FROM json_tree(?)').get('{"ok":true}')!.count as number
    const rootNodes = sqlite.prepare('SELECT count(*) AS count FROM json_tree(?)').get(body)!.count as number
    expect(report.nodes).toBe(rootNodes + 2 * expectedChildNodes)
    await projection.dispose()
  })

  it.each(['nodes', 'visits', 'documents'] as const)('charges batched plain children against the %s budget', async budget => {
    insert('one', { output: '{"ok":true}' })
    const all: HistoryImageDatabase['all'] = db.all.bind(db)
    db.all = async <T>(query: SQL) => {
      const rows = await all<T>(query)
      if (compile(query).sql.includes('WITH roots AS MATERIALIZED')) {
        const row = rows[0] as { documents: number; count: number; textCount: number }
        if (budget === 'nodes') row.count = PI_HISTORY_IMAGE_LIMITS.nodes - 1
        if (budget === 'visits') row.textCount = PI_HISTORY_IMAGE_LIMITS.nodes
        if (budget === 'documents') row.documents = PI_HISTORY_IMAGE_LIMITS.nodes
      }
      return rows
    }
    await expect(prepare()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    expect(tempTables()).toEqual([])
  })

  it.each([false, true])('accounts plain proof visits exactly at the boundary (overflow=%s)', async overflow => {
    for (let index = 0; index < 128; index++) insert(`plain-${index}`, { content: 'ordinary' })
    insert('nested', { output: '{"message":"ordinary"}' })
    const all: HistoryImageDatabase['all'] = db.all.bind(db)
    let report!: HistoryImageProjectionStats
    db.all = async <T>(query: SQL) => {
      const rows = await all<T>(query)
      if (compile(query).sql.includes('AS textCount') && !compile(query).sql.includes('WITH roots')) {
        for (const row of rows as Array<{ doc: number; textCount: number }>) {
          if (row.doc === 1) row.textCount = PI_HISTORY_IMAGE_LIMITS.nodes - (overflow ? 128 : 129)
        }
      }
      return rows
    }
    if (overflow) await expect(prepare(workspace, stats => { report = stats })).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    else {
      const projection = await prepare(workspace, stats => { report = stats })
      expect(report.visits).toBe(PI_HISTORY_IMAGE_LIMITS.nodes)
      await projection.dispose()
    }
    expect(tempTables()).toEqual([])
  })

  it('defers metadata/index creation for empty snapshots without skipping the snapshot recheck', async () => {
    const queries: string[] = []
    const all: HistoryImageDatabase['all'] = db.all.bind(db)
    const run = db.run.bind(db)
    db.all = <T>(query: SQL) => { queries.push(compile(query).sql); return all<T>(query) }
    db.run = (query: SQL) => { queries.push(compile(query).sql); return run(query) }
    let report!: HistoryImageProjectionStats
    const projection = await prepare(workspace, stats => { report = stats })
    expect(report).toEqual({ queryCount: 4, candidateCount: 0, nestedDocuments: 0, leafPages: 0,
      sourceBytes: 0, rows: 0, nodes: 0, visits: 0 })
    expect(queries.some(query => query.includes('FROM temp.') && query.includes('AS idBytes'))).toBe(true)
    expect(queries.some(query => query.includes('_leaves') || query.includes('CREATE INDEX'))).toBe(false)
    expect(tempTables()).toHaveLength(1)
    await projection.dispose()
    expect(tempTables()).toEqual([])
    const noWorkspace: HistoryImageProjectionStats[] = []
    await prepare(null, stats => noWorkspace.push(stats))
    expect(noWorkspace[0]).toEqual({ ...report, queryCount: 0 })
  })

  it('rejects insertion between an initial empty count and the checked snapshot', async () => {
    const run = db.run.bind(db)
    db.run = (query: SQL) => {
      if (compile(query).sql.includes('(source_id,body,canonical)')) insert('raced', { image_base64: 'YWJj' })
      return run(query)
    }
    await expect(prepare()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    expect(await files()).toEqual([])
    expect(tempTables()).toEqual([])
  })

  it.each(['source', 'id'] as const)('rechecks %s byte limits against the materialized snapshot', async changed => {
    insert('', { content: 'ordinary' })
    const all: HistoryImageDatabase['all'] = db.all.bind(db)
    db.all = async <T>(query: SQL) => {
      const rows = await all<T>(query)
      const text = compile(query).sql
      if (text.includes('coalesce(max(doc),0) AS maximum')) {
        const snapshot = rows[0] as { bytes: number; idBytes: number }
        if (changed === 'source') snapshot.bytes = PI_HISTORY_IMAGE_LIMITS.sourceBytes + 1
        else snapshot.idBytes = PI_HISTORY_IMAGE_LIMITS.pathBytes + 1
      }
      return rows
    }
    await expect(prepare()).rejects.toMatchObject({ name: 'PiHistoryLimitError' })
    expect(tempTables()).toEqual([])
  })

  it('accepts empty but non-null ids and tolerates throwing diagnostic observers', async () => {
    insert('', { output: '{"ok":true}' })
    const projection = await prepare(workspace, () => { throw new Error('observer failed') })
    expect(await read(projection.expression, '')).toEqual({ output: '{"ok":true}' })
    await projection.dispose()
    expect(tempTables()).toEqual([])
  })

  it('applies sourceExpression before snapshotting/offloading and uses it for fallback and no-workspace reads', async () => {
    const body = { content: [{ type: 'image', data: 'YWJj', mimeType: 'image/png' }], details: { source: '/existing/image.png' } }
    insert('one', body)
    insert('excluded', body, 'tool', 'other')
    const source = sql`json_set(history.data_json,'$.content',json_array(json_object(
      'type','text','text','Existing source: ' || json_extract(history.data_json,'$.details.source'))))`
    const projection = await prepareHistoryImageProjection(db, 'history', 'data_json', sql`scope='selected'`, 'id', workspace, source)
    const expected = { ...body, content: [{ type: 'text', text: 'Existing source: /existing/image.png' }] }
    expect(await read(projection.expression)).toEqual(expected)
    expect(await read(projection.expression, 'excluded')).toEqual(expected)
    expect(await files()).toEqual([])
    expect(JSON.parse(sqlite.prepare("SELECT data_json FROM history WHERE id='one'").get()!.data_json as string)).toEqual(body)
    await projection.dispose()
    transfers = []
    const noWorkspace = await prepareHistoryImageProjection(db, 'history', 'data_json', sql`scope='selected'`, 'id', null, source)
    expect(transfers).toEqual([])
    expect(await read(noWorkspace.expression)).toEqual(expected)
    await noWorkspace.dispose()
  })

  it('still offloads images remaining after sourceExpression and keeps fixed source schema unchanged', async () => {
    insert('one', { type: 'image', data: 'YWJj', mimeType: 'image/png', retained: true })
    const schemaBefore = sqlite.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()
    const projection = await prepareHistoryImageProjection(db, 'history', 'data_json', sql`scope='selected'`, 'id', workspace,
      sql`json_set(history.data_json,'$.projected',1)`)
    const result = await read(projection.expression)
    expect(result.type).toBe('text')
    expect(await readFile(reference(result.text))).toEqual(Buffer.from('abc'))
    expect(sqlite.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).toEqual(schemaBefore)
    await projection.dispose()
    expect(tempTables()).toEqual([])
  })

  it('keeps snapshotted sibling paths stable across pages and skips removed image descendants', async () => {
    const image = (value: string) => ({ type: 'image', data: Buffer.from(value).toString('base64'), mimeType: 'image/png' })
    const removed = JSON.stringify({ content: [image('must not be published')] })
    const middle = Array.from({ length: 260 }, (_, index) => ({ type: 'text', text: `line ${index}` }))
    insert('one', { content: [{ ...image('first'), output: removed }, ...middle, image('last')],
      output: JSON.stringify({ content: [image('nested')] }) })
    const projection = await prepare()
    const result = await read(projection.expression)
    expect(result.content.slice(1, -1)).toEqual(middle)
    expect(await readFile(reference(result.content[0].text))).toEqual(Buffer.from('first'))
    expect(await readFile(reference(result.content[result.content.length - 1].text))).toEqual(Buffer.from('last'))
    expect(await readFile(reference(JSON.parse(result.output).content[0].text))).toEqual(Buffer.from('nested'))
    expect(await files()).toHaveLength(3)
    await projection.dispose()
    expect(tempTables()).toEqual([])
  })
})
