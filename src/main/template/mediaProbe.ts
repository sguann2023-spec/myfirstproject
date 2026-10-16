import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { EditorPayload } from './editorModel'

const execFileAsync = promisify(execFile)
const ffprobeStatic = require('ffprobe-static') as { path?: string }

type ProbeStream = { duration?: number | string }
type ProbeResult = { streams?: ProbeStream[]; format?: { duration?: number | string } }

function resolveFfprobePath() {
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

function durationSeconds(probe: ProbeResult) {
  const values = [probe.format?.duration, ...(probe.streams ?? []).map((stream) => stream.duration)]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
  return values.length ? Math.max(...values) : undefined
}

export async function probeMediaDurationMicros(source: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(resolveFfprobePath(), [
      '-v', 'error',
      '-show_entries', 'stream=duration:format=duration',
      '-of', 'json',
      source
    ], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 })
    const seconds = durationSeconds(JSON.parse(String(stdout || '{}')) as ProbeResult)
    const micros = seconds === undefined ? undefined : Math.round(seconds * 1_000_000)
    return micros && Number.isSafeInteger(micros) && micros > 0 ? micros : undefined
  } catch {
    return undefined
  }
}

function materialSource(material: Record<string, unknown>) {
  for (const key of ['path', 'remote_url', 'source', 'url']) {
    const value = material[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function hasDuration(material: Record<string, unknown>) {
  const duration = Number(material.duration)
  return Number.isSafeInteger(duration) && duration > 0
}

export async function hydrateMediaDurations(payload: EditorPayload): Promise<{ payload: EditorPayload; changed: boolean }> {
  let draft: any
  try { draft = JSON.parse(payload.templateJson) } catch { return { payload, changed: false } }
  if (!draft?.materials || typeof draft.materials !== 'object') return { payload, changed: false }
  let changed = false
  const candidates = [
    ...(Array.isArray(draft.materials.videos) ? draft.materials.videos.filter((material: any) => material?.type === 'video') : []),
    ...(Array.isArray(draft.materials.audios) ? draft.materials.audios : [])
  ]
  await Promise.all(candidates.map(async (material: Record<string, unknown>) => {
    if (hasDuration(material)) return
    const source = materialSource(material)
    if (!source) return
    const duration = await probeMediaDurationMicros(source)
    if (!duration) return
    material.duration = duration
    changed = true
  }))
  return changed ? { payload: { ...payload, templateJson: JSON.stringify(draft, null, 2) }, changed } : { payload, changed }
}
