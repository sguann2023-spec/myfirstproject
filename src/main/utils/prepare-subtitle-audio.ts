import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { getResourcePath } from '@main/utils'

const execFileAsync = promisify(execFile)
const ffprobeStatic = require('ffprobe-static') as { path?: string }
const MAX_MEDIA_DURATION_SECONDS = 2 * 60 * 60
const PROCESS_TIMEOUT_MS = 15 * 60 * 1000
const PROCESS_MAX_BUFFER = 1024 * 1024

type ProbeStream = { codec_type?: string; duration?: number | string }
type ProbeResult = { streams?: ProbeStream[]; format?: { duration?: number | string } }

const resolveFfmpegPath = () => {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidate = path.join(getResourcePath(), 'ffmpeg', process.platform, arch, binaryName)
  return fs.existsSync(candidate) ? candidate : 'ffmpeg'
}

const resolveFfprobePath = () => {
  const executableName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  let packaged = ''
  if (process.resourcesPath) {
    if (process.platform === 'darwin') {
      packaged = path.join(process.resourcesPath, '..', 'Frameworks', 'ffprobe', 'darwin', process.arch, executableName)
    } else if (process.platform === 'win32') {
      packaged = path.join(process.resourcesPath, 'ffprobe', 'win32', process.arch, executableName)
    }
  }
  const bundled = String(ffprobeStatic?.path || '').trim()
  const unpacked = bundled.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1')
  return [packaged, bundled, unpacked, 'ffprobe'].find((candidate) =>
    candidate && (candidate === 'ffprobe' || fs.existsSync(candidate))
  ) || 'ffprobe'
}

const parseDuration = (probe: ProbeResult) => {
  const values = [probe.format?.duration, ...(probe.streams || []).map((stream) => stream.duration)]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
  return values.length ? Math.max(...values) : null
}

/** Verify a local or remote source is a video of known duration before sending it to a video-only API. */
export async function probeVideoSource(source: string, maxDurationSeconds: number): Promise<number> {
  let probeOutput: string
  try {
    const { stdout } = await execFileAsync(
      resolveFfprobePath(),
      ['-v', 'error', '-rw_timeout', '15000000', '-show_entries', 'stream=codec_type,duration:format=duration', '-of', 'json', source],
      { windowsHide: true, timeout: 30_000, maxBuffer: PROCESS_MAX_BUFFER }
    )
    probeOutput = String(stdout || '')
  } catch (error) {
    throw new Error(`无法读取视频信息：${error instanceof Error ? error.message : String(error)}`)
  }

  let probe: ProbeResult
  try {
    probe = JSON.parse(probeOutput) as ProbeResult
  } catch {
    throw new Error('无法解析视频信息')
  }
  if (!probe.streams?.some((stream) => stream.codec_type === 'video')) {
    throw new Error('仅支持视频类型的文件或链接')
  }
  const duration = parseDuration(probe)
  if (duration === null) throw new Error('无法读取视频时长，无法确认是否在时长限制内')
  if (duration > maxDurationSeconds) throw new Error(`视频时长不能超过 ${maxDurationSeconds / 60} 分钟`)
  return duration
}

/** Probe duration, enforce the recognition limit, and transcode local media to compact MP3. */
export async function prepareSubtitleAudio(sourcePath: string): Promise<{
  audioPath: string
  durationSeconds: number
  cleanup: () => Promise<void>
}> {
  const ffprobePath = resolveFfprobePath()
  let probeOutput: string
  try {
    const { stdout, stderr } = await execFileAsync(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'stream=codec_type,duration:format=duration', '-of', 'json', sourcePath],
      { windowsHide: true, timeout: 30_000, maxBuffer: PROCESS_MAX_BUFFER }
    )
    probeOutput = `${stdout || ''}\n${stderr || ''}`
  } catch (error) {
    throw new Error(`无法读取音视频信息：${error instanceof Error ? error.message : String(error)}`)
  }

  const jsonStart = probeOutput.indexOf('{')
  if (jsonStart < 0) throw new Error('无法读取音视频时长')
  let probe: ProbeResult
  try {
    probe = JSON.parse(probeOutput.slice(jsonStart)) as ProbeResult
  } catch {
    throw new Error('无法解析音视频信息')
  }
  const durationSeconds = parseDuration(probe)
  if (durationSeconds === null) throw new Error('无法读取音视频时长')
  if (durationSeconds > MAX_MEDIA_DURATION_SECONDS) throw new Error('音视频时长不能超过 2 小时')
  if (!(probe.streams || []).some((stream) => stream.codec_type === 'audio')) {
    throw new Error('该视频没有可识别的音轨')
  }

  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'vectcut-subtitle-audio-'))
  const audioPath = path.join(tempDir, 'recognition-audio.mp3')
  try {
    await execFileAsync(
      resolveFfmpegPath(),
      ['-nostdin', '-y', '-i', sourcePath, '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-q:a', '2', audioPath],
      { windowsHide: true, timeout: PROCESS_TIMEOUT_MS, maxBuffer: PROCESS_MAX_BUFFER }
    )
    return {
      audioPath,
      durationSeconds,
      cleanup: () => fsPromises.rm(tempDir, { recursive: true, force: true })
    }
  } catch (error) {
    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    throw new Error(`提取识别音频失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
