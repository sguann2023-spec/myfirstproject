import { execFileSync } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils', () => ({ getResourcePath: () => path.join(process.cwd(), 'resources') }))
vi.mock('../prepare-subtitle-audio', () => ({
  resolveFfprobePath: () => process.env.PORTRAIT_TEST_FFPROBE || 'ffprobe',
  resolveFfmpegPath: () => { throw new Error('System ffmpeg fallback is forbidden') }
}))
import { preparePortraitMovForJianying, resolvePortraitFfmpegPath } from '../prepare-portrait-mov'

const bundled = path.join(process.cwd(), 'resources', 'ffmpeg', process.platform, process.arch, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
if (process.env.PORTRAIT_REQUIRE_BUNDLED === '1') {
  if (!fsSync.existsSync(bundled)) throw new Error('CI requires bundled FFmpeg; skipping is forbidden')
  if (!process.env.PORTRAIT_TEST_FFPROBE || !fsSync.existsSync(process.env.PORTRAIT_TEST_FFPROBE)) throw new Error('CI requires an explicit bundled ffprobe path')
}
describe.skipIf(!fsSync.existsSync(bundled))('bundled FFmpeg WebM → editor MOV', () => {
  it.each(['vp8', 'vp9'] as const)('decodes %s alpha with explicit libvpx and uses bundled prores_ks', async codec => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portrait-webm-test-'))
    try {
      const raw = Buffer.alloc(96 * 64 * 4 * 12)
      for (let i = 0; i < 96 * 64 * 12; i++) {
        const x = i % 96; raw[i * 4] = 220; raw[i * 4 + 1] = 70; raw[i * 4 + 2] = 40; raw[i * 4 + 3] = x > 25 && x < 70 ? 255 : 0
      }
      const file = path.join(dir, 'source.webm')
      execFileSync(bundled, ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '96x64', '-r', '12', '-i', 'pipe:0', '-an', '-c:v', codec === 'vp8' ? 'libvpx' : 'libvpx-vp9', '-auto-alt-ref', '0', '-pix_fmt', 'yuva420p', file], { input: raw, timeout: 30_000 })
      const out = await preparePortraitMovForJianying(file)
      try {
        expect(out.normalization).toMatchObject({ decoder: codec === 'vp8' ? 'libvpx' : 'libvpx-vp9', encoder: 'prores_ks', ffmpeg_path: bundled, backend_format: 'WEBM' })
        expect(out.verification.alpha_verified).toBe(true)
        for (const a of out.verification.alpha_samples) { expect(a.min).toBeLessThan(10); expect(a.max).toBeGreaterThan(245) }
      } finally { await out.cleanup() }
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  }, 60_000)

  it('never falls back to PATH when the packaged executable is missing', () => {
    const spy = vi.spyOn(fsSync, 'existsSync').mockReturnValue(false)
    try { expect(() => resolvePortraitFfmpegPath()).toThrow('缺少随包 FFmpeg') } finally { spy.mockRestore() }
  })

  it.runIf(Boolean(process.env.PORTRAIT_REAL_WEBM))('converts the real user WebM with the exact production helper', async () => {
    const result = await preparePortraitMovForJianying(process.env.PORTRAIT_REAL_WEBM!)
    try {
      expect(result.verification.alpha_verified).toBe(true)
      if (process.env.PORTRAIT_REAL_MOV) await fs.copyFile(result.videoPath, process.env.PORTRAIT_REAL_MOV)
      if (process.env.PORTRAIT_REAL_REPORT) await fs.writeFile(process.env.PORTRAIT_REAL_REPORT, JSON.stringify({ ...result.verification, normalization: result.normalization }, null, 2))
    } finally { await result.cleanup() }
  }, 180_000)
})
