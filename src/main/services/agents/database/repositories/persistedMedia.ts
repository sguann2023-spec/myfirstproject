import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { realpathSync } from 'node:fs'
import { getDataPath } from '@main/utils'
import { extensions, PI_HISTORY_IMAGE_LIMITS, publishHistoryMediaFile } from './piHistoryImages'

/** Resolve only our content-addressed references after Data directory migration. */
export function resolvePersistedMedia<T>(value: T, root = getDataPath()): T {
  if (typeof value === 'string') {
    const reference = /^(Previously loaded image: )("(?:[^"\\]|\\.)*")(\. (?:Raw image omitted when restoring history\. )?Use ReadImageAsContent with this file_path(?: or URL)? if visual inspection is needed again\.)$/.exec(value)
    if (reference) return `${reference[1]}${JSON.stringify(resolvePersistedMedia(JSON.parse(reference[2]), root))}${reference[3]}` as T
    const match = /(?:^|[/\\])history-media[/\\]((?:image|media)-[a-f0-9]{64}\.[a-z0-9]+)$/.exec(value)
    if (match) {
      let resolved = root
      try { resolved = realpathSync(root) } catch { /* A restore may not have published Data yet. */ }
      return path.join(resolved, 'history-media', match[1]) as T
    }
    if (/^\s*[\[{\"]/.test(value)) {
      try { const parsed = JSON.parse(value); const next = resolvePersistedMedia(parsed, root); return (JSON.stringify(next) === JSON.stringify(parsed) ? value : JSON.stringify(next)) as T } catch { return value }
    }
    return value
  }
  if (Array.isArray(value)) return value.map(child => resolvePersistedMedia(child, root)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolvePersistedMedia(child, root)])) as T
  return value
}

// Kept under Data (including attachment-free backups), never the temporary directory.
export async function offloadPersistedMedia<T>(value: T, root = getDataPath(), type?: string): Promise<T> {
  const files = new Map<string, Promise<string>>()
  let nodes = 0
  let bytes = 0
  const save = async (encoded: string, mime: string): Promise<string> => {
    if (encoded.length > Math.ceil(PI_HISTORY_IMAGE_LIMITS.imageBytes / 3) * 4) throw new Error('Inline media exceeds persistence limit')
    const buffer = Buffer.from(encoded, 'base64')
    if (!encoded || buffer.toString('base64') !== encoded) throw new Error('Invalid inline media base64')
    bytes += buffer.length
    if (buffer.length > PI_HISTORY_IMAGE_LIMITS.imageBytes || bytes > PI_HISTORY_IMAGE_LIMITS.totalImageBytes) throw new Error('Inline media exceeds persistence limit')
    const digest = createHash('sha256').update(buffer).digest('hex')
    const filename = `${mime.startsWith('image/') ? 'image' : 'media'}-${digest}.${extensions[mime] ?? 'bin'}`
    let pending = files.get(filename)
    if (!pending) {
      pending = (async () => {
        const directory = path.join(await realpath(root), 'history-media')
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const stat = await lstat(directory)
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe media directory')
        const target = path.join(directory, filename)
        const staging = path.join(directory, `.pending-${randomUUID()}`)
        try {
          const handle = await open(staging, 'wx', 0o600)
          try { await handle.writeFile(buffer); await handle.sync() } finally { await handle.close() }
          await publishHistoryMediaFile(staging, target, digest, buffer.length)
          return target
        } finally { await rm(staging, { force: true }) }
      })()
      files.set(filename, pending)
    }
    return pending
  }
  const visit = async (item: unknown, depth: number, context?: Record<string, unknown>, key?: string): Promise<unknown> => {
    if (++nodes > PI_HISTORY_IMAGE_LIMITS.nodes || depth > 100) throw new Error('Media persistence traversal limit')
    if (typeof item === 'string') {
      const published = /(?:^|[/\\])history-media[/\\]((?:image|media)-[a-f0-9]{64}\.[a-z0-9]+)$/.exec(item)
      if (published) return path.join(await realpath(root), 'history-media', published[1])
      const match = /^data:((?:image|audio|video)\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(item)
      if (match) return save(match[2], match[1].toLowerCase())
      const mime = String(context?.mimeType ?? context?.mediaType ?? context?.media_type ?? '')
      const typed = /^(image|audio|video|input_audio)$/.test(String(context?.type))
      // buildInlineToolResultPayload keeps an image-shaped summary, not raw media.
      if (key === 'data' && context?.type === 'image' && context.inlineImage === true &&
          /^\[image base64 omitted from inline tool log, [1-9][0-9]* chars\]$/.test(item)) return item
      if (['data', 'base64', 'image_base64', 'audio_base64', 'video_base64', 'blob'].includes(key ?? '') &&
          (typed || /^(image|audio|video)\//.test(mime) || /^(image|audio|video)_base64$/.test(key ?? '')) &&
          !/^(?:[a-z]:[\\/]|[a-z][a-z0-9+.-]*:)/i.test(item) &&
          (!item.startsWith('/') || (/^[A-Za-z0-9+/]*={0,2}$/.test(item) && Buffer.from(item, 'base64').toString('base64') === item))) {
        return save(item, mime || (key?.startsWith('audio') || context?.type === 'audio' || context?.type === 'input_audio' ? 'audio/mpeg' : key?.startsWith('video') || context?.type === 'video' ? 'video/mp4' : 'image/png'))
      }
      if (/^\s*[\[{\"]/.test(item)) {
        let parsed: unknown
        try { parsed = JSON.parse(item) } catch { return item }
        const copy = await visit(parsed, depth + 1)
        return JSON.stringify(copy) === JSON.stringify(parsed) ? item : JSON.stringify(copy)
      }
      return item
    }
    if (!item || typeof item !== 'object') return item
    if (Array.isArray(item)) return Promise.all(item.map(child => visit(child, depth + 1)))
    const source = item as Record<string, unknown>
    const recognition = depth === 0 && type ? { ...source, type } : source
    const copy: Record<string, unknown> = {}
    for (const [field, child] of Object.entries(source)) Object.defineProperty(copy, field, { value: await visit(child, depth + 1, recognition, field), enumerable: true, writable: true, configurable: true })
    // Encoded data fields become explicit source references, not fake base64.
    for (const field of ['data', 'base64', 'image_base64', 'audio_base64', 'video_base64', 'blob']) {
      if (copy[field] !== source[field] && typeof copy[field] === 'string' && (copy[field] as string).startsWith('/')) {
        copy.url ??= copy[field]
        copy.source = copy[field]
        delete copy[field]
        if (copy.type === 'base64') copy.type = 'url'
      }
    }
    return copy
  }
  return await visit(value, 0) as T
}
