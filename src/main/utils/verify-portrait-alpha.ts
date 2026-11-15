import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { resolveFfmpegPath, resolveFfprobePath } from './prepare-subtitle-audio'

const execFileAsync = promisify(execFile)
const PROBE_TIMEOUT_MS = 30_000
const SAMPLE_TIMEOUT_MS = 60_000
const SAMPLE_SIDE = 96
const SAMPLE_BYTES = SAMPLE_SIDE * SAMPLE_SIDE
const MAX_SOURCE_DURATION_SECONDS = 10 * 60

interface MatteProbe {
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    codec_tag_string?: string
    profile?: string
    pix_fmt?: string
    width?: number
    height?: number
    duration?: string | number
  }>
  format?: { format_name?: string; duration?: string | number }
}

export interface PortraitAlphaVerification {
  format: 'MOV'
  container: 'mov'
  codec: 'prores'
  codec_tag: string
  pixel_format: string
  width: number
  height: number
  duration_seconds: number
  alpha_verified: true
  alpha_verification: 'sampled_decoded_frames'
  alpha_samples: Array<{ time_seconds: number; min: number; max: number }>
  jianying_compatible: true
}

/**
 * Do not infer transparency from .mov, ProRes, or an AlphaMode tag alone.
 * Decode the real alpha plane without inserting an alpha-capable format first:
 * `format=rgba,alphaextract` would manufacture an all-opaque plane for RGB input.
 * Frame sampling verifies the output contract; it is not an edge-quality score.
 */
export async function verifyPortraitMovAlpha(source: string, signal?: AbortSignal, ffmpegPath = resolveFfmpegPath()): Promise<PortraitAlphaVerification> {
  signal?.throwIfAborted()
  const { stdout } = await execFileAsync(resolveFfprobePath(), [
    '-v', 'error', '-rw_timeout', '15000000',
    '-show_entries', 'stream=codec_type,codec_name,codec_tag_string,profile,pix_fmt,width,height,duration:format=format_name,duration',
    '-of', 'json', source
  ], { windowsHide: true, timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024, signal })

  let probe: MatteProbe
  try {
    probe = JSON.parse(String(stdout)) as MatteProbe
  } catch {
    throw new Error('无法解析人像抠像输出信息')
  }
  const stream = probe.streams?.find(item => item.codec_type === 'video')
  if (!stream) throw new Error('人像抠像结果中没有视频轨道')
  if (!probe.format?.format_name?.split(',').includes('mov') || stream.codec_name !== 'prores' ||
      !['ap4h', 'ap4x'].includes(String(stream.codec_tag_string)) || !/^yuva444p(?:\d+le)?$/.test(stream.pix_fmt || '')) {
    throw new Error('人像抠像结果不是带 Alpha 的 ProRes 4444 MOV；不能仅修改扩展名或转换为普通 H.264 MP4 后导入剪映')
  }
  const duration = Math.max(...[probe.format?.duration, stream.duration]
    .map(Number).filter(value => Number.isFinite(value) && value > 0))
  if (!Number.isFinite(duration) || duration > MAX_SOURCE_DURATION_SECONDS) {
    throw new Error('无法验证人像抠像输出时长，或输出超过 10 分钟限制')
  }
  if (!Number.isInteger(stream.width) || !Number.isInteger(stream.height) || stream.width! <= 0 || stream.height! <= 0) {
    throw new Error('人像抠像输出尺寸无效')
  }

  const times = [...new Set([0.1, 0.5, 0.9].map(ratio => Number((duration * ratio).toFixed(4))))]
  const samples: PortraitAlphaVerification['alpha_samples'] = []
  for (const time of times) {
    signal?.throwIfAborted()
    const result = await execFileAsync(ffmpegPath, [
      '-nostdin', '-v', 'error', '-rw_timeout', '15000000', '-ss', String(time), '-i', source,
      '-map', '0:v:0', '-an', '-vf', `alphaextract,scale=${SAMPLE_SIDE}:${SAMPLE_SIDE},format=gray`,
      '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'
    ], { windowsHide: true, timeout: SAMPLE_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'buffer', signal })
    const data = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout)
    if (data.length !== SAMPLE_BYTES) throw new Error('无法解码人像抠像结果的 Alpha 通道')
    let min = 255
    let max = 0
    for (const value of data) { min = Math.min(min, value); max = Math.max(max, value) }
    samples.push({ time_seconds: time, min, max })
  }
  // A codec can carry alpha yet store only 255. Never label that as a transparent cutout.
  if (!samples.some(sample => sample.min < 250)) {
    throw new Error('人像抠像结果的 Alpha 采样全部不透明；不会将黑底/白底视频标记为透明素材')
  }
  if (!samples.some(sample => sample.max > 5)) {
    throw new Error('人像抠像结果的 Alpha 采样全部透明，没有可见人物')
  }
  return {
    format: 'MOV', container: 'mov', codec: 'prores', codec_tag: String(stream.codec_tag_string),
    pixel_format: String(stream.pix_fmt), width: stream.width!, height: stream.height!, duration_seconds: duration,
    alpha_verified: true, alpha_verification: 'sampled_decoded_frames', alpha_samples: samples,
    jianying_compatible: true
  }
}
