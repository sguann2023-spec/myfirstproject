import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { getResourcePath } from '@main/utils'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'

const logger = loggerService.withContext('MCPServer:FfmpegMedia')
const execFileAsync = promisify(execFile)
const ffprobeStatic = require('ffprobe-static') as { path?: string }
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000
const FFPROBE_TIMEOUT_MS = 15 * 1000
const PROCESS_MAX_BUFFER = 1024 * 1024

const EXTRACT_AUDIO_TOOL: Tool = {
  name: 'extract_audio_from_video',
  description:
    'Separate the audio track from a video file or URL with the bundled ffmpeg and output a standalone audio file.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Required local media path, file URL, or remote URL.'
      },
      outputPath: {
        type: 'string',
        description: 'Optional output path. Defaults to a temp mp3 file when omitted.'
      },
      format: {
        type: 'string',
        enum: ['mp3', 'wav', 'aac', 'm4a'],
        description: 'Optional output audio format. Defaults to mp3.'
      }
    },
    required: ['source'],
    additionalProperties: false
  }
}

const CAPTURE_FRAME_TOOL: Tool = {
  name: 'capture_frame_at_timestamp',
  description:
    'Capture a frame image from a video at a specific timestamp with the bundled ffmpeg.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Required local video path, file URL, or remote URL.'
      },
      timestamp: {
        anyOf: [{ type: 'number' }, { type: 'string' }],
        description: 'Required frame timestamp in seconds or hh:mm:ss(.ms).'
      },
      outputPath: {
        type: 'string',
        description: 'Optional output image path. Defaults to a temp png file when omitted.'
      },
      format: {
        type: 'string',
        enum: ['png', 'jpg', 'jpeg'],
        description: 'Optional image format. Defaults to png.'
      }
    },
    required: ['source', 'timestamp'],
    additionalProperties: false
  }
}

const GET_DURATION_TOOL: Tool = {
  name: 'get_media_duration',
  description:
    'Read the duration and basic stream info of an audio or video source with bundled ffprobe.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Required local media path, file URL, or remote URL.'
      }
    },
    required: ['source'],
    additionalProperties: false
  }
}

const TRIM_MEDIA_TOOL: Tool = {
  name: 'trim_media_segment',
  description:
    'Trim a video or audio segment for any time range with the bundled ffmpeg and output a standalone clip.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Required local media path, file URL, or remote URL.'
      },
      start: {
        anyOf: [{ type: 'number' }, { type: 'string' }],
        description: 'Required clip start time in seconds or hh:mm:ss(.ms).'
      },
      end: {
        anyOf: [{ type: 'number' }, { type: 'string' }],
        description: 'Optional clip end time in seconds or hh:mm:ss(.ms).'
      },
      duration: {
        anyOf: [{ type: 'number' }, { type: 'string' }],
        description: 'Optional clip duration in seconds or hh:mm:ss(.ms). Use this instead of end.'
      },
      outputPath: {
        type: 'string',
        description: 'Optional output path. Defaults to mp4 for video sources and mp3 for audio-only sources.'
      }
    },
    required: ['source', 'start'],
    additionalProperties: false
  }
}

type FfprobeStream = {
  codec_name?: string
  codec_type?: string
  duration?: number | string
  height?: number
  width?: number
}

type FfprobeResult = {
  format?: {
    bit_rate?: string
    duration?: number | string
    format_name?: string
  }
  streams?: FfprobeStream[]
}

type TrimOutputKind = 'audio' | 'video'

const TOOLS = [EXTRACT_AUDIO_TOOL, CAPTURE_FRAME_TOOL, GET_DURATION_TOOL, TRIM_MEDIA_TOOL]

const asTextResult = (payload: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
})

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)

const normalizeSource = (value: unknown): string => {
  const raw = String(value || '').trim()
  if (!raw) {
    throw new Error('`source` is required')
  }
  if (raw.startsWith('file://')) {
    return fileURLToPath(raw)
  }
  return raw
}

const ensureLocalSourceExists = (source: string) => {
  if (!isHttpLikeUrl(source) && !fs.existsSync(source)) {
    throw new Error(`Source file not found: ${source}`)
  }
}

const normalizeTimestamp = (value: unknown, fieldName: string): string => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return `${value}`
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  throw new Error(`\`${fieldName}\` must be a non-negative number or timestamp string`)
}

const sanitizeFileName = (value: string) => value.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'media'

const getSourceBaseName = (source: string) => {
  if (isHttpLikeUrl(source)) {
    try {
      return sanitizeFileName(path.parse(new URL(source).pathname).name || 'media')
    } catch {
      return 'media'
    }
  }
  return sanitizeFileName(path.parse(source).name || 'media')
}

const getExtensionFromOutputPath = (outputPath?: string) => {
  if (!outputPath) return ''
  return path.extname(outputPath).replace(/^\./, '').toLowerCase()
}

const resolveOutputPath = async (options: {
  source: string
  outputPath?: string
  defaultExtension: string
  suffix: string
}) => {
  const { source, outputPath, defaultExtension, suffix } = options
  let finalPath = ''
  if (outputPath && outputPath.trim()) {
    finalPath = path.resolve(outputPath.trim())
  } else if (!isHttpLikeUrl(source)) {
    finalPath = path.join(path.dirname(source), `${getSourceBaseName(source)}_${suffix}.${defaultExtension}`)
  } else {
    finalPath = path.join(
      await fsPromises.mkdtemp(path.join(os.tmpdir(), 'vectcut-ffmpeg-media-')),
      `${getSourceBaseName(source)}_${suffix}.${defaultExtension}`
    )
  }
  await fsPromises.mkdir(path.dirname(finalPath), { recursive: true })
  return finalPath
}

const parseJsonFromFfprobe = (rawOutput: string): FfprobeResult => {
  const text = String(rawOutput || '').trim()
  const jsonStart = text.indexOf('{')
  if (jsonStart === -1) {
    throw new Error('ffprobe did not return JSON output')
  }
  return JSON.parse(text.slice(jsonStart)) as FfprobeResult
}

const toPositiveNumber = (value: unknown) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

const getProbeDurationSeconds = (probe: FfprobeResult) => {
  const formatDuration = toPositiveNumber(probe.format?.duration)
  if (formatDuration !== null) {
    return formatDuration
  }
  const streamDurations = (probe.streams || [])
    .map((stream) => toPositiveNumber(stream.duration))
    .filter((value): value is number => value !== null)
  return streamDurations.length > 0 ? Math.max(...streamDurations) : null
}

const hasVideoStream = (probe: FfprobeResult) => (probe.streams || []).some((stream) => stream.codec_type === 'video')

const hasAudioStream = (probe: FfprobeResult) => (probe.streams || []).some((stream) => stream.codec_type === 'audio')

const inferTrimOutputKind = (probe: FfprobeResult): TrimOutputKind => (hasVideoStream(probe) ? 'video' : 'audio')

const pickAudioCodecArgs = (extension: string) => {
  switch (extension) {
    case 'wav':
      return ['-c:a', 'pcm_s16le']
    case 'aac':
      return ['-c:a', 'aac']
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', '192k']
    case 'mp3':
    default:
      return ['-c:a', 'libmp3lame', '-q:a', '2']
  }
}

const pickTrimOutputExtension = (kind: TrimOutputKind, outputPath?: string) => {
  const fromOutputPath = getExtensionFromOutputPath(outputPath)
  if (fromOutputPath) {
    return fromOutputPath
  }
  return kind === 'video' ? 'mp4' : 'mp3'
}

const buildTrimCodecArgs = (kind: TrimOutputKind, extension: string) => {
  if (kind === 'audio') {
    return ['-vn', ...pickAudioCodecArgs(extension)]
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k']
}

class FfmpegMediaServer {
  public mcpServer: McpServer

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'ffmpeg-media',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'extract_audio_from_video':
            return await this.extractAudioFromVideo(args as Record<string, unknown>)
          case 'capture_frame_at_timestamp':
            return await this.captureFrameAtTimestamp(args as Record<string, unknown>)
          case 'get_media_duration':
            return await this.getMediaDuration(args as Record<string, unknown>)
          case 'trim_media_segment':
            return await this.trimMediaSegment(args as Record<string, unknown>)
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const message = toErrorMessage(error)
        logger.error(`Tool error: ${toolName}`, { error: message, args })
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
    })
  }

  private resolveBundledFfmpegPath() {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const candidate = path.join(getResourcePath(), 'ffmpeg', process.platform, arch, binaryName)
    return fs.existsSync(candidate) ? candidate : null
  }

  private resolveFfprobePath() {
    const executableName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
    let packaged = ''
    if (process.resourcesPath) {
      if (process.platform === 'darwin') {
        packaged = path.join(process.resourcesPath, '..', 'Frameworks', 'ffprobe', 'darwin', process.arch, executableName)
      } else if (process.platform === 'win32') {
        packaged = path.join(process.resourcesPath, 'ffprobe', 'win32', process.arch, executableName)
      }
    }

    const bundled = String((ffprobeStatic as { path?: string } | undefined)?.path || '').trim()
    const unpacked = bundled.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1')
    const candidates = [packaged, bundled, unpacked, 'ffprobe'].filter(Boolean)

    for (const candidate of candidates) {
      if (candidate === 'ffprobe' || fs.existsSync(candidate)) {
        return candidate
      }
    }

    return 'ffprobe'
  }

  private async runFfmpeg(args: string[]) {
    const bundledFfmpegPath = this.resolveBundledFfmpegPath()
    const ffmpegCommand = bundledFfmpegPath || 'ffmpeg'

    try {
      await execFileAsync(ffmpegCommand, args, {
        windowsHide: true,
        timeout: FFMPEG_TIMEOUT_MS,
        maxBuffer: PROCESS_MAX_BUFFER
      })
    } catch (error) {
      throw new Error(
        `Failed to run ffmpeg. Checked bundled binary: ${bundledFfmpegPath || 'not found'}, then PATH fallback. ${toErrorMessage(error)}`
      )
    }

    return ffmpegCommand
  }

  private async probeMedia(source: string) {
    const ffprobePath = this.resolveFfprobePath()

    try {
      const { stdout, stderr } = await execFileAsync(
        ffprobePath,
        ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height,duration:format=duration,format_name,bit_rate', '-of', 'json', source],
        {
          windowsHide: true,
          timeout: FFPROBE_TIMEOUT_MS,
          maxBuffer: PROCESS_MAX_BUFFER
        }
      )
      return {
        ffprobePath,
        probe: parseJsonFromFfprobe(`${String(stdout || '')}\n${String(stderr || '')}`)
      }
    } catch (error) {
      throw new Error(`Failed to probe media with ffprobe (${ffprobePath}): ${toErrorMessage(error)}`)
    }
  }

  private async extractAudioFromVideo(args: Record<string, unknown>) {
    const source = normalizeSource(args.source)
    ensureLocalSourceExists(source)

    const { ffprobePath, probe } = await this.probeMedia(source)
    if (!hasVideoStream(probe)) {
      throw new Error('The source does not contain a video stream')
    }
    if (!hasAudioStream(probe)) {
      throw new Error('The source does not contain an audio stream')
    }

    const format = String(args.format || getExtensionFromOutputPath(typeof args.outputPath === 'string' ? args.outputPath : '') || 'mp3')
      .trim()
      .toLowerCase()
    if (!['mp3', 'wav', 'aac', 'm4a'].includes(format)) {
      throw new Error('`format` must be one of: mp3, wav, aac, m4a')
    }

    const outputPath = await resolveOutputPath({
      source,
      outputPath: typeof args.outputPath === 'string' ? args.outputPath : undefined,
      defaultExtension: format,
      suffix: 'audio'
    })

    const ffmpegPath = await this.runFfmpeg(['-y', '-i', source, '-vn', ...pickAudioCodecArgs(format), outputPath])
    const stats = await fsPromises.stat(outputPath)

    return asTextResult({
      ok: true,
      tool: 'extract_audio_from_video',
      source,
      outputPath,
      outputFormat: format,
      sizeBytes: stats.size,
      ffmpegPath,
      ffprobePath
    })
  }

  private async captureFrameAtTimestamp(args: Record<string, unknown>) {
    const source = normalizeSource(args.source)
    ensureLocalSourceExists(source)

    const { ffprobePath, probe } = await this.probeMedia(source)
    if (!hasVideoStream(probe)) {
      throw new Error('The source does not contain a video stream')
    }

    const timestamp = normalizeTimestamp(args.timestamp, 'timestamp')
    const format = String(args.format || getExtensionFromOutputPath(typeof args.outputPath === 'string' ? args.outputPath : '') || 'png')
      .trim()
      .toLowerCase()
    if (!['png', 'jpg', 'jpeg'].includes(format)) {
      throw new Error('`format` must be one of: png, jpg, jpeg')
    }

    const outputPath = await resolveOutputPath({
      source,
      outputPath: typeof args.outputPath === 'string' ? args.outputPath : undefined,
      defaultExtension: format,
      suffix: `frame_${sanitizeFileName(timestamp)}`
    })

    const ffmpegPath = await this.runFfmpeg(['-y', '-ss', timestamp, '-i', source, '-frames:v', '1', outputPath])
    const stats = await fsPromises.stat(outputPath)

    return asTextResult({
      ok: true,
      tool: 'capture_frame_at_timestamp',
      source,
      timestamp,
      outputPath,
      outputFormat: format,
      sizeBytes: stats.size,
      ffmpegPath,
      ffprobePath
    })
  }

  private async getMediaDuration(args: Record<string, unknown>) {
    const source = normalizeSource(args.source)
    ensureLocalSourceExists(source)

    const { ffprobePath, probe } = await this.probeMedia(source)
    const durationSeconds = getProbeDurationSeconds(probe)
    if (durationSeconds === null) {
      throw new Error('Could not determine media duration from ffprobe output')
    }

    return asTextResult({
      ok: true,
      tool: 'get_media_duration',
      source,
      durationSeconds,
      durationMilliseconds: Math.round(durationSeconds * 1000),
      hasVideo: hasVideoStream(probe),
      hasAudio: hasAudioStream(probe),
      formatName: probe.format?.format_name || null,
      ffprobePath
    })
  }

  private async trimMediaSegment(args: Record<string, unknown>) {
    const source = normalizeSource(args.source)
    ensureLocalSourceExists(source)

    const { ffprobePath, probe } = await this.probeMedia(source)
    if (!hasVideoStream(probe) && !hasAudioStream(probe)) {
      throw new Error('The source does not contain an audio or video stream')
    }

    const start = normalizeTimestamp(args.start, 'start')
    const end = args.end === undefined ? undefined : normalizeTimestamp(args.end, 'end')
    const duration = args.duration === undefined ? undefined : normalizeTimestamp(args.duration, 'duration')
    if (!end && !duration) {
      throw new Error('Either `end` or `duration` is required')
    }
    if (end && duration) {
      throw new Error('Use either `end` or `duration`, not both')
    }

    const outputKind = inferTrimOutputKind(probe)
    const outputExtension = pickTrimOutputExtension(outputKind, typeof args.outputPath === 'string' ? args.outputPath : undefined)
    const outputPath = await resolveOutputPath({
      source,
      outputPath: typeof args.outputPath === 'string' ? args.outputPath : undefined,
      defaultExtension: outputExtension,
      suffix: 'clip'
    })

    const ffmpegArgs = ['-y', '-i', source, '-ss', start]
    if (end) {
      ffmpegArgs.push('-to', end)
    } else if (duration) {
      ffmpegArgs.push('-t', duration)
    }
    ffmpegArgs.push(...buildTrimCodecArgs(outputKind, outputExtension), outputPath)

    const ffmpegPath = await this.runFfmpeg(ffmpegArgs)
    const stats = await fsPromises.stat(outputPath)

    return asTextResult({
      ok: true,
      tool: 'trim_media_segment',
      source,
      start,
      end: end || null,
      duration: duration || null,
      outputPath,
      outputKind,
      outputExtension,
      sizeBytes: stats.size,
      ffmpegPath,
      ffprobePath
    })
  }
}

export default FfmpegMediaServer
