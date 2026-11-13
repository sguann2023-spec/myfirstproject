import { execFile } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { getResourcePath } from '@main/utils'
import { resolveFfprobePath } from './prepare-subtitle-audio'
import { verifyPortraitMovAlpha } from './verify-portrait-alpha'
import { normalizeProresAlphaHeaders } from './normalize-prores-alpha-header'

const execFileAsync = promisify(execFile)

/** Strict: never silently use Homebrew/PATH ffmpeg for the editor output. */
export function resolvePortraitFfmpegPath(): string {
  if (!['darwin', 'win32'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch)) {
    throw new Error(`不支持的随包 FFmpeg 平台：${process.platform}/${process.arch}`)
  }
  const binary = path.join(getResourcePath(), 'ffmpeg', process.platform, process.arch, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  if (!fsSync.existsSync(binary)) throw new Error(`缺少随包 FFmpeg：${binary}；请运行 prepare:portable-ffmpeg 或重新安装完整应用，不会回退到系统 FFmpeg`)
  return binary
}

/** Backend only produces WebM; the desktop makes the editor-compatible MOV locally. */
export async function preparePortraitMovForJianying(source: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const ffmpeg = resolvePortraitFfmpegPath()
  const run = (args: string[], timeout = 60_000) => execFileAsync(ffmpeg, args, {
    windowsHide: true, timeout, maxBuffer: 1024 * 1024, signal
  })
  const { stdout } = await execFileAsync(resolveFfprobePath(), [
    '-v', 'error', '-rw_timeout', '15000000', '-show_entries',
    'stream=codec_type,codec_name,width,height,duration:format=format_name,duration', '-of', 'json', source
  ], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024, signal })
  const probe = JSON.parse(String(stdout)) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }>
    format?: { format_name?: string; duration?: string }
  }
  const video = probe.streams?.find(s => s.codec_type === 'video')
  const decoder = video?.codec_name === 'vp8' ? 'libvpx' : video?.codec_name === 'vp9' ? 'libvpx-vp9' : ''
  if (!decoder || !probe.format?.format_name?.split(',').some(f => f === 'webm' || f === 'matroska')) {
    throw new Error('抠像后端必须返回 VP8/VP9 WebM；不会将未知格式或后端 MOV 直接标为剪映兼容')
  }
  const duration = Math.max(...[probe.format?.duration, video?.duration].map(Number).filter(n => Number.isFinite(n) && n > 0))
  if (!Number.isFinite(duration) || duration > 600.25) throw new Error('WebM 输出时长无效或超过 10 分钟限制')
  const decoders = await run(['-hide_banner', '-decoders'])
  const encoders = await run(['-hide_banner', '-encoders'])
  if (!new RegExp(`\\b${decoder}\\s`).test(String(decoders.stdout))) throw new Error(`随包 FFmpeg 缺少 ${decoder} 解码器，无法保留 WebM Alpha`)
  if (!/\bprores_ks\s/.test(String(encoders.stdout)) || !/\baac\s/.test(String(encoders.stdout))) {
    throw new Error('随包 FFmpeg 缺少 prores_ks 或 AAC 编码器，无法生成透明 MOV')
  }
  // Decode REAL alpha first. Do not insert format=rgba here, which fabricates
  // opaque alpha for non-transparent WebM and would conceal provider failures.
  const alphaSamples: Array<{ time_seconds: number; min: number; max: number }> = []
  for (const ratio of [0.1, 0.5, 0.9]) {
    const time = Number((duration * ratio).toFixed(4))
    const result = await execFileAsync(ffmpeg, [
      '-nostdin', '-v', 'error', '-rw_timeout', '15000000', '-c:v', decoder,
      '-ss', String(time), '-i', source, '-map', '0:v:0', '-an',
      '-vf', 'alphaextract,scale=96:96,format=gray', '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'
    ], { windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024, encoding: 'buffer', signal })
    const data = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout)
    if (data.length !== 96 * 96) throw new Error('无法读取 WebM 真实 Alpha 通道')
    let min = 255; let max = 0
    for (const value of data) { min = Math.min(min, value); max = Math.max(max, value) }
    alphaSamples.push({ time_seconds: time, min, max })
  }
  if (!alphaSamples.some(s => s.min < 250) || !alphaSamples.some(s => s.max > 5)) {
    throw new Error('WebM Alpha 全不透明或全透明，不能生成有效的人物透明素材')
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vectcut-portrait-mov-'))
  const videoPath = path.join(dir, 'portrait-prores4444.mov')
  const cleanup = () => fs.rm(dir, { recursive: true, force: true })
  try {
    await run([
      '-nostdin', '-y', '-v', 'error', '-rw_timeout', '15000000', '-c:v', decoder, '-i', source,
      '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1',
      '-vf', 'setsar=1', '-c:v', 'prores_ks', '-profile:v', '4',
      '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', videoPath
    ], 35 * 60_000)
    const headerNormalization = await normalizeProresAlphaHeaders(videoPath, signal)
    const verification = await verifyPortraitMovAlpha(videoPath, signal, ffmpeg)
    if (verification.width !== video?.width || verification.height !== video?.height ||
        Math.abs(verification.duration_seconds - duration) > 0.25) {
      throw new Error('透明 MOV 转码后尺寸或时长发生异常变化')
    }
    signal?.throwIfAborted()
    return {
      videoPath, verification: { ...verification, jianying_compatible: 'pending_editor_confirmation' as const, editor_import_verified: false },
      normalization: {
        ...headerNormalization,
        backend_format: 'WEBM', decoder, encoder: 'prores_ks', ffmpeg_path: ffmpeg,
        profile: '4444', encoder_pixel_format: 'yuva444p10le', alpha_bits: 16,
        video_track_first: true, square_pixels: true, source_alpha_samples: alphaSamples
      },
      cleanup
    }
  } catch (error) {
    await cleanup().catch(() => undefined)
    throw error
  }
}
