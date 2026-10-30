import { describe, expect, it, vi } from 'vitest'
import { databaseIdentity, encodeFrame, FrameDecoder } from '../../brokerProtocol'
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

it('uses the active overlay file identity without following the legacy .v2.db alias', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'broker-identity-'))
  try {
    const active = path.join(directory, 'records.db')
    const legacy = path.join(directory, 'legacy.db')
    writeFileSync(active, '')
    writeFileSync(legacy, '')
    symlinkSync(legacy, `${active}.v2.db`)
    const overlay = { legacyPaths: [], migrationDir: directory }
    expect(databaseIdentity(`file:${active}`, overlay)).toBe(databaseIdentity(`file:${directory}/./records.db`, overlay))
    expect(databaseIdentity(`file:${active}`, overlay)).not.toBe(databaseIdentity(`file:${active}`))
    const alias = path.join(directory, 'alias.db')
    symlinkSync(active, alias)
    expect(databaseIdentity(`file:${alias}`, overlay)).toBe(databaseIdentity(`file:${active}`, overlay))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

describe('database frame decoder', () => {
  it('copies a fragmented multi-megabyte response linearly, without repeated concatenation', () => {
    const value = { rows: [['x'.repeat(8 * 1024 * 1024)]] }
    const frame = encodeFrame(value)
    const decoder = new FrameDecoder()
    const received: unknown[] = []
    const concat = vi.spyOn(Buffer, 'concat')
    try {
      for (let offset = 0; offset < frame.length; offset += 32768) {
        decoder.push(frame.subarray(offset, offset + 32768), result => received.push(result))
      }
      expect(concat).not.toHaveBeenCalled()
      expect(received).toEqual([value])
    } finally { concat.mockRestore() }
  })

  it('handles split headers, split payloads and multiple frames in one chunk', () => {
    const frames = Buffer.concat([encodeFrame({ id: 1 }), encodeFrame({ id: 2 }), encodeFrame({ id: 3 })])
    const decoder = new FrameDecoder()
    const received: unknown[] = []
    for (let offset = 0; offset < 7; offset++) decoder.push(frames.subarray(offset, offset + 1), value => received.push(value))
    decoder.push(frames.subarray(7), value => received.push(value))
    expect(received).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
  })

  it('rejects invalid frame lengths before allocating the payload', () => {
    const header = Buffer.alloc(4)
    header.writeUInt32BE(256 * 1024 * 1024 + 1)
    expect(() => new FrameDecoder().push(header, () => undefined)).toThrow(/size limit/)
    header.writeUInt32BE(0)
    expect(() => new FrameDecoder().push(header, () => undefined)).toThrow(/size limit/)
  })
})
