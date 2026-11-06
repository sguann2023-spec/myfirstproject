import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { sql, type SQL } from 'drizzle-orm'

// Only these operations are needed; both local and worker-backed Drizzle use them.
export interface HistoryImageDatabase {
  all<T = Record<string, unknown>>(query: SQL): Promise<T[]> | T[]
  run(query: SQL): unknown
}

export const PI_HISTORY_IMAGE_LIMITS = {
  rows: 100000,
  nodes: 1000000,
  nestedJsonDepth: 8,
  pathBytes: 4096,
  sourceBytes: 512 * 1024 * 1024,
  imageBytes: 64 * 1024 * 1024,
  totalImageBytes: 256 * 1024 * 1024,
  chunkChars: 64 * 1024
} as const

export const extensions: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav',
  'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac',
  'audio/mp4': 'm4a', 'audio/webm': 'webm'
}

// JSON stored as text is meaningful only in known tool-result fields. Ordinary
// strings (arguments, prose, metadata) must not be recursively reinterpreted.
const resultFields = ['content', 'output', 'rawOutput', 'result', 'responseRaw', 'structuredContent']
const metadataPageSize = 128

function limitError(): Error {
  return Object.assign(new Error('PI history images exceed safe projection limits'), { name: 'PiHistoryLimitError' })
}

/** Relocate only published history images and complete, known reference texts.
 * Missing/unsafe targets leave references intact. No input or file is mutated.
 */
export async function relocateHistoryImageReferences<T>(value: T, oldWorkspace: string, newWorkspace: string): Promise<T> {
  if (!oldWorkspace.trim() || !newWorkspace.trim()) return value
  const oldRoot = path.resolve(oldWorkspace, '.tool-results', 'history-images')
  if (path.resolve(oldWorkspace) === path.resolve(newWorkspace)) return value
  const filenames = /^(?:image-[0-9a-f]{64}\.(?:png|jpg|gif|webp|avif|svg)|media-[0-9a-f]{64}\.(?:mp4|webm|mov|mp3|wav|ogg|flac|m4a))$/
  const reference = /^Previously loaded image: ("(?:[^"\\]|\\.)*")(\. Raw image omitted when restoring history\. Use ReadImageAsContent with this file_path if visual inspection is needed again\.|\. Use ReadImageAsContent with this file_path or URL if visual inspection is needed again\.)$/
  const targets = new Map<string, Promise<string>>()
  const copies = new WeakMap<object, object>()
  let nodes = 0
  let targetWorkspace: Promise<string> | undefined

  const relocateFile = async (file: string): Promise<string> => {
    const filename = path.basename(file)
    if (filenames.exec(filename)?.[0] !== filename || file !== path.join(oldRoot, filename)) return file
    let target = targets.get(file)
    if (!target) {
      target = (async () => {
        try {
          const workspace = await (targetWorkspace ??= realpath(newWorkspace))
          const root = path.join(workspace, '.tool-results')
          const directory = path.join(root, 'history-images')
          for (const folder of [root, directory]) {
            const stat = await lstat(folder)
            if (!stat.isDirectory() || stat.isSymbolicLink()) return file
          }
          const destination = path.join(directory, filename)
          const stat = await lstat(destination)
          return stat.isFile() && !stat.isSymbolicLink() ? destination : file
        } catch (error) {
          if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return file
          throw error
        }
      })()
      targets.set(file, target)
    }
    return target
  }

  const visit = async (item: unknown, jsonDepth: number, parseJson: boolean): Promise<unknown> => {
    if (++nodes > PI_HISTORY_IMAGE_LIMITS.nodes) throw limitError()
    if (typeof item === 'string') {
      const file = await relocateFile(item)
      if (file !== item) return file
      const match = reference.exec(item)
      if (match && match[0] === item) {
        try {
          const source = JSON.parse(match[1]) as string
          const destination = await relocateFile(source)
          if (destination !== source) return `Previously loaded image: ${JSON.stringify(destination)}${match[2]}`
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error
        }
        return item
      }
      // Only result fields/text blocks (or a serialized root value) are JSON.
      if (parseJson && jsonDepth < PI_HISTORY_IMAGE_LIMITS.nestedJsonDepth && /^[\s]*[\[{"]/.test(item)) {
        let parsed: unknown
        try { parsed = JSON.parse(item) } catch { return item }
        const relocated = await visit(parsed, jsonDepth + 1, true)
        if (JSON.stringify(relocated) !== JSON.stringify(parsed)) return JSON.stringify(relocated)
      }
      return item
    }
    if (!item || typeof item !== 'object') return item
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return item
    const previous = copies.get(item)
    if (previous) return previous
    const copy: Record<string, unknown> | unknown[] = Array.isArray(item) ? new Array(item.length) : Object.create(Object.getPrototypeOf(item))
    copies.set(item, copy)
    for (const [key, child] of Object.entries(item)) {
      const nested = resultFields.includes(key) || (key === 'text' && (item as { type?: unknown }).type === 'text')
      Object.defineProperty(copy, key, { value: await visit(child, jsonDepth, nested), enumerable: true, writable: true, configurable: true })
    }
    return copy
  }

  return await visit(value, 0, true) as T
}

/** Publish a fully synced staging inode without replacing any existing content. */
export async function publishHistoryMediaFile(staging: string, file: string, digest: string, bytes: number): Promise<void> {
  try { await link(staging, file) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size !== bytes) throw new Error('Invalid existing history image file')
      const hash = createHash('sha256')
      const buffer = Buffer.alloc(PI_HISTORY_IMAGE_LIMITS.chunkChars)
      let offset = 0
      while (offset < bytes) {
        const read = await handle.read(buffer, 0, Math.min(buffer.length, bytes - offset), offset)
        if (!read.bytesRead) throw new Error('Invalid existing history image file')
        hash.update(buffer.subarray(0, read.bytesRead))
        offset += read.bytesRead
      }
      if (hash.digest('hex') !== digest) throw new Error('Invalid existing history image file')
    } finally { await handle.close() }
  }
}

interface Leaf {
  node: number
  location: string | null
  parentPath: string | null
  key: string | null
  chars: number
  prefix: string
  parentType: string | null
  mime: string | null
  nested: number
}

/** Snapshot and project entirely in TEMP. The expression is correlated by idColumn.
 * Callers must keep the same SQLite connection until dispose, and must supply a
 * unique, non-null id within predicate. Successful files outlive dispose.
 * sourceExpression, when supplied, runs before image offloading (including
 * budgets and the no-workspace/fallback expression).
 */
export async function prepareHistoryImageProjection(
  db: HistoryImageDatabase,
  table: string,
  column: string,
  predicate: SQL,
  idColumn: string,
  workspacePath?: string | null,
  sourceExpression?: SQL
): Promise<{ expression: SQL; dispose: () => Promise<void> }> {
  const source = sourceExpression ?? sql`${sql.identifier(table)}.${sql.identifier(column)}`
  if (!workspacePath?.trim()) return { expression: source, dispose: async () => {} }

  const name = `pi_history_images_${randomUUID().replaceAll('-', '')}`
  const docs = sql.identifier(name)
  const tempDocs = sql`temp.${docs}`
  const metadata = sql.identifier(`${name}_leaves`)
  const tempMetadata = sql`temp.${metadata}`
  let directory: string | undefined
  let imageBytes = 0
  let nodes = 0
  let visits = 0
  let documentCount = 0
  let disposal: Promise<void> | undefined
  const dispose = () => disposal ??= Promise.resolve().then(async () => {
    await db.run(sql`DROP TABLE IF EXISTS ${tempMetadata}`)
    await db.run(sql`DROP TABLE IF EXISTS ${tempDocs}`)
  }).catch(error => { disposal = undefined; throw error })

  const ensureDirectory = async () => {
    if (directory) return directory
    const workspace = await realpath(workspacePath)
    const root = path.join(workspace, '.tool-results')
    await mkdir(root, { recursive: true })
    const stat = await lstat(root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe history image output directory')
    const target = path.join(root, 'history-images')
    await mkdir(target, { recursive: true, mode: 0o700 })
    const targetStat = await lstat(target)
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error('Unsafe history image output directory')
    directory = target
    return directory
  }

  const saveImage = async (doc: number, leaf: Leaf, mime: string, start: number) => {
    const chars = leaf.chars - start + 1
    if (chars <= 0 || chars % 4 !== 0) return undefined
    if (chars / 4 * 3 > PI_HISTORY_IMAGE_LIMITS.imageBytes + 2) throw limitError()
    // BLOB substr uses byte offsets and avoids reparsing the complete JSON for
    // every chunk. The payload remains in SQLite, never in a JS string.
    await db.run(sql`UPDATE ${tempDocs} SET payload=CAST(json_extract(body,${leaf.location}) AS BLOB) WHERE doc=${doc}`)
    const root = await ensureDirectory()
    const staging = path.join(root, `.pending-${randomUUID()}`)
    try {
      const handle = await open(staging, 'wx', 0o600)
      const hash = createHash('sha256')
      let written = 0
      try {
        for (let offset = 0; offset < chars; offset += PI_HISTORY_IMAGE_LIMITS.chunkChars) {
          const count = Math.min(PI_HISTORY_IMAGE_LIMITS.chunkChars, chars - offset)
          const [row] = await db.all<{ chunk: string }>(sql`
            SELECT CAST(substr(payload, ${start + offset}, ${count}) AS TEXT) AS chunk
            FROM ${tempDocs} WHERE doc=${doc}
          `)
          const chunk = row?.chunk
          const final = offset + count === chars
          if (typeof chunk !== 'string' || chunk.length !== count ||
            !(final ? /^[A-Za-z0-9+/]*={0,2}$/ : /^[A-Za-z0-9+/]*$/).test(chunk)) return undefined
          const buffer = Buffer.from(chunk, 'base64')
          // Reject non-canonical padding rather than silently changing bytes.
          if (buffer.toString('base64') !== chunk) return undefined
          written += buffer.length
          if (written > PI_HISTORY_IMAGE_LIMITS.imageBytes ||
            imageBytes + written > PI_HISTORY_IMAGE_LIMITS.totalImageBytes) throw limitError()
          hash.update(buffer)
          await handle.writeFile(buffer)
        }
        await handle.sync()
      } finally {
        await handle.close()
      }
      const digest = hash.digest('hex')
      const file = path.join(root, `${mime.startsWith('image/') ? 'image' : 'media'}-${digest}.${extensions[mime]}`)
      await publishHistoryMediaFile(staging, file, digest, written)
      imageBytes += written
      return file
    } finally {
      // Published files may already be referenced by another recovery. Never
      // delete them, even if a later database projection operation fails.
      try { await rm(staging, { force: true }) } finally {
        await db.run(sql`UPDATE ${tempDocs} SET payload=NULL WHERE doc=${doc}`)
      }
    }
  }

  const projectDocument = async (doc: number, depth: number, canonical: boolean): Promise<void> => {
    if (++documentCount > PI_HISTORY_IMAGE_LIMITS.nodes) throw limitError()
    const [size] = await db.all<{ count: number; largestPath: number }>(sql`
      SELECT count(*) AS count, coalesce(max(octet_length(fullkey)),0) AS largestPath
      FROM ${tempDocs}, json_tree(CASE WHEN json_valid(body) THEN body ELSE 'null' END)
      WHERE doc=${doc}
    `)
    nodes += Number(size.count)
    if (nodes > PI_HISTORY_IMAGE_LIMITS.nodes || Number(size.largestPath) > PI_HISTORY_IMAGE_LIMITS.pathBytes) throw limitError()
    // Materialize bounded scalar metadata once. Container values/base64 bodies
    // never enter this table or cross the worker boundary. Parent attributes
    // are indexed joins rather than repeated json_extract of the full body.
    await db.run(sql`INSERT INTO ${tempMetadata}(doc,node,parent,location,parentPath,key,kind,chars,prefix,nested)
      SELECT ${doc},j.id,j.parent,j.fullkey,j.path,substr(CAST(j.key AS TEXT),1,128),j.type,
        CASE WHEN j.type='text' THEN length(j.value) ELSE 0 END,
        CASE WHEN j.type='text' THEN substr(j.value,1,128) END,
        CASE WHEN j.type='text' AND (j.key IN (${sql.join(resultFields.map(field => sql`${field}`), sql`, `)})
          OR j.key='text' OR (${depth}>0 AND j.fullkey='$')) AND ${depth}<${PI_HISTORY_IMAGE_LIMITS.nestedJsonDepth}
          THEN CASE WHEN json_valid(j.value) THEN
            CASE WHEN json_type(j.value) IN ('object','array','text') THEN 1 ELSE 0 END
          ELSE 0 END ELSE 0 END
      FROM ${tempDocs},json_tree(CASE WHEN json_valid(body) THEN body ELSE 'null' END) j
      WHERE doc=${doc} LIMIT ${Number(size.count)}
    `)
    let cursor = -1
    while (true) {
      const page = await db.all<Leaf>(sql`
        SELECT j.node,j.location,j.parentPath,j.key,j.chars,j.prefix,t.prefix AS parentType,
          coalesce(m.prefix,mt.prefix,ms.prefix) AS mime,
          CASE WHEN j.key='text' THEN CASE WHEN t.prefix='text' THEN j.nested ELSE 0 END ELSE j.nested END AS nested
        FROM ${tempMetadata} j
        LEFT JOIN ${tempMetadata} t ON t.doc=j.doc AND t.parent=j.parent AND t.key='type' AND t.kind='text'
        LEFT JOIN ${tempMetadata} m ON m.doc=j.doc AND m.parent=j.parent AND m.key='mimeType' AND m.kind='text'
        LEFT JOIN ${tempMetadata} mt ON mt.doc=j.doc AND mt.parent=j.parent AND mt.key='mediaType' AND mt.kind='text'
        LEFT JOIN ${tempMetadata} ms ON ms.doc=j.doc AND ms.parent=j.parent AND ms.key='media_type' AND ms.kind='text'
        WHERE j.doc=${doc} AND j.kind='text' AND j.node>${cursor} ORDER BY j.node LIMIT ${metadataPageSize}
      `)
      if (!page.length) break
      for (const leaf of page) {
        if (++visits > PI_HISTORY_IMAGE_LIMITS.nodes) throw limitError()
        if (!leaf.location || !leaf.parentPath) throw limitError()
        cursor = Number(leaf.node)
        // Audio/video are supported only as explicit data URLs in URL/source
        // fields. Never infer media from arbitrary base64 strings or rewrite
        // encoded-data fields as paths while retaining a base64 discriminator.
        const imageUrl = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(leaf.prefix)
        const mediaUrl = ['url', 'source', 'audio_url', 'video_url'].includes(leaf.key ?? '')
          ? /^data:((?:audio|video)\/[a-z0-9.+-]+);base64,/i.exec(leaf.prefix) : null
        const dataUrl = imageUrl ?? mediaUrl
        const typed = leaf.key === 'data' && (leaf.parentType === 'image' ||
          (leaf.parentType === 'base64' && leaf.mime?.startsWith('image/')))
        const rootImage = canonical && leaf.parentPath === '$' && ['data', 'base64', 'image_base64'].includes(leaf.key ?? '')
        const namedImage = leaf.key === 'image_base64' ||
          (leaf.key === 'base64' && leaf.mime?.startsWith('image/'))
        const mime = (dataUrl?.[1] ?? leaf.mime ?? ((typed || rootImage || namedImage) ? 'image/png' : '')).toLowerCase()
        if (dataUrl || typed || rootImage || namedImage || leaf.nested) {
          // A previous container replacement can remove a snapshotted descendant.
          const [current] = await db.all<{ present: number }>(sql`SELECT
            json_type(body,${leaf.location})='text' AS present FROM ${tempDocs} WHERE doc=${doc}`)
          if (!current?.present) continue
        }
        if ((mediaUrl || ((imageUrl || typed || rootImage || namedImage) && mime.startsWith('image/'))) && Object.prototype.hasOwnProperty.call(extensions, mime)) {
          const file = await saveImage(doc, leaf, mime, dataUrl ? dataUrl[0].length + 1 : 1)
          if (!file) continue
          const text = `Previously loaded image: ${JSON.stringify(file)}. Raw image omitted when restoring history. Use ReadImageAsContent with this file_path if visual inspection is needed again.`
          if (mediaUrl) {
            await db.run(sql`UPDATE ${tempDocs} SET body=json_set(body,${leaf.location},${file}) WHERE doc=${doc}`)
          } else if (leaf.parentType === 'image' && leaf.key === 'data' && !rootImage) {
            await db.run(sql`UPDATE ${tempDocs} SET body=json_set(body,${leaf.parentPath},
              json_object('type','text','text',${text})) WHERE doc=${doc}`)
          } else if (rootImage) {
            await db.run(sql`UPDATE ${tempDocs} SET body=json_set(json_remove(body,${leaf.location}),
              '$.text',${text},'$.content',${text},'$.source',${file}) WHERE doc=${doc}`)
          } else {
            await db.run(sql`UPDATE ${tempDocs} SET body=json_set(body,${leaf.location},${file}) WHERE doc=${doc}`)
          }
        } else if (leaf.nested) {
          await db.run(sql`INSERT INTO ${tempDocs}(body) SELECT json_extract(body,${leaf.location})
            FROM ${tempDocs} WHERE doc=${doc}`)
          const [child] = await db.all<{ doc: number }>(sql`SELECT max(doc) AS doc FROM ${tempDocs}`)
          await projectDocument(Number(child.doc), depth + 1, false)
          // A JSON-in-text field must stay a string, not become an object.
          await db.run(sql`UPDATE ${tempDocs} SET body=json_set(body,${leaf.location},
            (SELECT body FROM ${tempDocs} WHERE doc=${child.doc})) WHERE doc=${doc}
            AND json_extract(body,${leaf.location}) IS NOT (SELECT body FROM ${tempDocs} WHERE doc=${child.doc})`)
          await db.run(sql`DELETE FROM ${tempDocs} WHERE doc=${child.doc}`)
        }
      }
    }
    await db.run(sql`DELETE FROM ${tempMetadata} WHERE doc=${doc}`)
  }

  try {
    const [size] = await db.all<{ count: number; bytes: number; ids: number; nonnull: number; idBytes: number }>(sql`
      SELECT count(*) AS count, coalesce(sum(octet_length(${source})),0) AS bytes,
        count(DISTINCT ${sql.identifier(idColumn)}) AS ids, count(${sql.identifier(idColumn)}) AS nonnull,
        coalesce(max(octet_length(${sql.identifier(idColumn)})),0) AS idBytes
      FROM ${sql.identifier(table)} WHERE ${predicate}
    `)
    if (Number(size.count) > PI_HISTORY_IMAGE_LIMITS.rows || Number(size.bytes) > PI_HISTORY_IMAGE_LIMITS.sourceBytes ||
      Number(size.idBytes) > PI_HISTORY_IMAGE_LIMITS.pathBytes) throw limitError()
    if (Number(size.ids) !== Number(size.count) || Number(size.nonnull) !== Number(size.count)) {
      throw new Error('History image projection requires unique non-null ids')
    }
    await db.run(sql`CREATE TEMP TABLE ${docs}(doc INTEGER PRIMARY KEY, source_id UNIQUE, body, canonical INTEGER, payload BLOB)`)
    await db.run(sql`CREATE TEMP TABLE ${metadata}(
      doc INTEGER, node INTEGER, parent INTEGER, location TEXT, parentPath TEXT,
      key TEXT, kind TEXT, chars INTEGER, prefix TEXT, nested INTEGER, PRIMARY KEY(doc,node))`)
    await db.run(sql`CREATE INDEX ${sql.identifier(`${name}_parents`)} ON ${metadata}(doc,parent,key,kind)`)
    const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier(table)})`)
    const canonical = column === 'data_json' && columns.some(field => field.name === 'type')
      ? sql`${sql.identifier('type')}='image'` : sql`0`
    await db.run(sql`INSERT INTO ${tempDocs}(source_id,body,canonical)
      SELECT ${sql.identifier(idColumn)},${source},${canonical}
      FROM ${sql.identifier(table)} WHERE ${predicate}`)
    // Recheck the snapshot so a concurrent source update cannot bypass budgets.
    const [snapshot] = await db.all<{ count: number; bytes: number; maximum: number; idBytes: number }>(sql`
      SELECT count(*) AS count, coalesce(sum(octet_length(body)),0) AS bytes, coalesce(max(doc),0) AS maximum,
        coalesce(max(octet_length(source_id)),0) AS idBytes FROM ${tempDocs}
    `)
    if (Number(snapshot.count) !== Number(size.count) || Number(snapshot.bytes) > PI_HISTORY_IMAGE_LIMITS.sourceBytes ||
      Number(snapshot.idBytes) > PI_HISTORY_IMAGE_LIMITS.pathBytes) throw limitError()
    for (let doc = 1; doc <= Number(snapshot.maximum); doc++) {
      const [row] = await db.all<{ canonical: number }>(sql`SELECT canonical FROM ${tempDocs} WHERE doc=${doc}`)
      await projectDocument(doc, 0, Boolean(row.canonical))
    }
    return {
      expression: sql`coalesce((SELECT body FROM ${tempDocs} WHERE source_id=${sql.identifier(table)}.${sql.identifier(idColumn)}),${source})`,
      dispose
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
