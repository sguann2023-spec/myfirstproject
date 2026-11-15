import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

// Deliberately exercise the real decoder/encoder, not mocks of its output. These
// tests are optional on machines without local ffmpeg + ffprobe binaries.
vi.mock('../prepare-subtitle-audio', () => ({
  resolveFfmpegPath: () => 'ffmpeg',
  resolveFfprobePath: () => 'ffprobe'
}))
import { verifyPortraitMovAlpha } from '../verify-portrait-alpha'

const hasMediaTools = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch { return false }
})()
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})

async function fixture(alpha: 'mixed' | 'opaque' | 'empty', codec: 'prores' | 'h264' = 'prores') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vectcut-alpha-test-'))
  dirs.push(dir)
  const width = 96
  const height = 64
  const data = Buffer.alloc(width * height * 4 * 12)
  for (let f = 0; f < 12; f++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (f * width * height + y * width + x) * 4
        data[i] = 220; data[i + 1] = 80; data[i + 2] = 40
        data[i + 3] = alpha === 'opaque' ? 255 : alpha === 'empty' ? 0 : x > 24 && x < 72 && y > 8 && y < 56 ? 255 : 0
      }
    }
  }
  const file = path.join(dir, 'portrait.mov')
  execFileSync('ffmpeg', [
    '-nostdin', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`, '-r', '12', '-i', 'pipe:0', '-an',
    ...(codec === 'prores'
      ? ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16']
      : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']),
    file
  ], { input: data, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 })
  return file
}

describe.skipIf(!hasMediaTools)('verifyPortraitMovAlpha real media', () => {
  it('accepts a real transparent ProRes 4444 MOV', async () => {
    const file = await fixture('mixed')
    const result = await verifyPortraitMovAlpha(file)
    expect(result).toMatchObject({ codec: 'prores', codec_tag: 'ap4h', width: 96, height: 64, alpha_verified: true })
    for (const sample of result.alpha_samples) {
      expect(sample.min).toBeLessThan(10)
      expect(sample.max).toBeGreaterThan(245)
    }
  }, 30_000)

  it.each([
    ['opaque', '全部不透明'], ['empty', '全部透明']
  ] as const)('rejects actual %s ProRes 4444 even though its codec carries alpha', async (alpha, message) => {
    await expect(verifyPortraitMovAlpha(await fixture(alpha))).rejects.toThrow(message)
  }, 30_000)

  it('rejects a real H.264 MOV: the extension alone is insufficient', async () => {
    await expect(verifyPortraitMovAlpha(await fixture('mixed', 'h264'))).rejects.toThrow('ProRes 4444 MOV')
  }, 30_000)
})
