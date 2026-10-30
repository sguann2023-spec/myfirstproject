import { createHash, randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { fileURLToPath } from 'node:url'
import type { OverlayOptions } from './persistentRecordStore'

const MAX_FRAME_BYTES = 256 * 1024 * 1024

export type OverlayStorageOptions = OverlayOptions

function canonicalStoragePath(filename: string): string {
  const absolute = path.resolve(filename)
  try { return realpathSync(absolute) } catch {
    const parent = path.dirname(absolute)
    return parent === absolute ? absolute : path.join(canonicalStoragePath(parent), path.basename(absolute))
  }
}

/** Source order is precedence, so it is part of the broker configuration identity. */
export function storageConfiguration(options?: OverlayStorageOptions): string {
  if (!options) return JSON.stringify({ mode: 'legacy' })
  if (!Array.isArray(options.legacyPaths) || options.legacyPaths.some(filename => typeof filename !== 'string') || typeof options.migrationDir !== 'string') {
    throw new Error('Invalid overlay storage configuration')
  }
  return JSON.stringify({ mode: 'overlay', legacyPaths: options.legacyPaths.map(canonicalStoragePath), migrationDir: canonicalStoragePath(options.migrationDir) })
}

export function databaseIdentity(url: string, overlayStorage?: OverlayStorageOptions): string {
  if (url === ':memory:' || url.startsWith('file::memory:')) return `memory:${randomUUID()}`
  if (!url.startsWith('file:')) throw new Error('Append storage supports local file databases only')
  const requested = path.resolve(url.startsWith('file://') ? fileURLToPath(url) : url.slice(5))
  let filename = requested
  try {
    filename = overlayStorage ? realpathSync(requested) : realpathSync(`${requested}.v2.db`).slice(0, -'.v2.db'.length)
  } catch {
    try { filename = realpathSync(requested) } catch {
      try { filename = path.join(realpathSync(path.dirname(requested)), path.basename(requested)) } catch { /* Not created yet. */ }
    }
  }
  // Existing ancestors reveal filesystem case sensitivity without creating files.
  for (let directory = path.dirname(filename); directory !== path.dirname(directory); directory = path.dirname(directory)) {
    const basename = path.basename(directory)
    const variant = basename.replace(/[a-zA-Z]/, ch => ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase())
    if (variant === basename) continue
    try {
      const original = statSync(directory), alternate = statSync(path.join(path.dirname(directory), variant))
      if (original.dev === alternate.dev && original.ino === alternate.ino) return filename.toLowerCase()
      return filename
    } catch { return filename }
  }
  return filename
}

export function databaseEndpoint(identity: string): { host: string; port: number } {
  const digest = createHash('sha256').update(identity).digest()
  return { host: '127.0.0.1', port: 10000 + digest.readUInt32BE(0) % 50000 }
}

export function encodeFrame(value: unknown): Buffer {
  const payload = serialize(value)
  if (payload.length > MAX_FRAME_BYTES) throw new Error('Database frame exceeds size limit')
  const frame = Buffer.allocUnsafe(payload.length + 4)
  frame.writeUInt32BE(payload.length)
  payload.copy(frame, 4)
  return frame
}

export class FrameDecoder {
  private readonly header = Buffer.allocUnsafe(4)
  private headerBytes = 0
  private payload?: Buffer
  private payloadBytes = 0

  push(chunk: Buffer, receive: (value: any) => void): void {
    let offset = 0
    while (offset < chunk.length) {
      if (!this.payload) {
        const bytes = Math.min(4 - this.headerBytes, chunk.length - offset)
        chunk.copy(this.header, this.headerBytes, offset, offset + bytes)
        this.headerBytes += bytes
        offset += bytes
        if (this.headerBytes < 4) return
        const length = this.header.readUInt32BE(0)
        if (length === 0 || length > MAX_FRAME_BYTES) throw new Error('Database frame exceeds size limit')
        this.payload = Buffer.allocUnsafe(length)
        this.payloadBytes = 0
      }
      const bytes = Math.min(this.payload.length - this.payloadBytes, chunk.length - offset)
      chunk.copy(this.payload, this.payloadBytes, offset, offset + bytes)
      this.payloadBytes += bytes
      offset += bytes
      if (this.payloadBytes === this.payload.length) {
        const frame = this.payload
        this.payload = undefined
        this.headerBytes = 0
        this.payloadBytes = 0
        receive(deserialize(frame))
      }
    }
  }
}
