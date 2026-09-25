import { loggerService } from '@logger'
import AdmZip from 'adm-zip'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inspect } from 'node:util'

import { feedbackMailService } from './FeedbackMailService'

const logger = loggerService.withContext('CrashReportService')
const MAX_EVENTS = 80
const MAX_DUMP_BYTES = 12 * 1024 * 1024
const MAX_LOG_BYTES = 256 * 1024
const MAX_PROCESS_MEMORY_SAMPLES = 120
const REPORT_FILE = /^[0-9a-f-]{36}\.json$/

type StartOptions = {
  userDataPath: string
  logsPath: string
  dumpsPath: string
  version: string
  hardwareAccelerationDisabled: boolean
}

type DiagnosticEvent = {
  timestamp: string
  kind: string
  details: Record<string, unknown>
}

type ProcessMemorySample = {
  timestamp: string
  processes: Array<{
    pid: number
    type: string
    name?: string
    serviceName?: string
    memory: {
      workingSetSize: number
      peakWorkingSetSize: number
      privateBytes?: number
    }
  }>
}

type SessionReport = {
  schemaVersion: 1
  reportId: string
  startedAt: string
  endedAt?: string
  exitCode?: number
  hasIncident: boolean
  hasCrash?: boolean
  droppedEvents: number
  environment: Record<string, unknown> & { version: string; platform: string }
  events: DiagnosticEvent[]
  processMemorySamples?: ProcessMemorySample[]
}

type DumpFile = { absolutePath: string; name: string; size: number; mtimeMs: number }

const CRASH_REASONS = new Set(['crashed', 'oom', 'abnormal-exit', 'integrity-failure'])

function isCrashEvent(kind: string, details: Record<string, unknown>): boolean {
  if (details.isQuitting === true) return false
  return (kind === 'render-process-gone' || kind === 'child-process-gone') &&
    typeof details.reason === 'string' && CRASH_REASONS.has(details.reason)
}

function crashClassification(report: SessionReport, dumps: DumpFile[]): string | undefined {
  // Older reports used hasIncident for ordinary JS errors too; do not use it for delivery.
  if (report.hasCrash === true || report.events.some((event) =>
    event && event.details && isCrashEvent(event.kind, event.details))) return 'process-crash'
  if (dumps.length) return 'crash-dump'
  return undefined
}

// Text redaction is best effort. Binary dumps are intentionally attached unchanged.
export function redactDiagnosticText(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)\s*["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[user]')
    .replace(/\/(?:Users|home)\/[^/\s]+/g, '/home/[user]')
}

export function describeDiagnosticError(reason: unknown): { message: string; stack?: string } {
  try {
    const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : inspect(reason, {
      depth: 4, maxArrayLength: 20, maxStringLength: 2048, customInspect: false, getters: false
    })
    return {
      message: redactDiagnosticText(message).slice(0, 8192),
      stack: reason instanceof Error && reason.stack ? redactDiagnosticText(reason.stack).slice(0, 8192) : undefined
    }
  } catch {
    return { message: '[Unable to serialize error]' }
  }
}

export class CrashReportService {
  private options?: StartOptions
  private directory = ''
  private current?: SessionReport
  private sending = false

  public start(options: StartOptions): void {
    if (this.current) return
    try {
      this.options = options
      this.directory = path.join(options.userDataPath, 'crash-reports')
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      this.current = {
        schemaVersion: 1,
        reportId: randomUUID(),
        startedAt: new Date().toISOString(),
        hasIncident: false,
        hasCrash: false,
        droppedEvents: 0,
        environment: {
          version: options.version,
          platform: process.platform,
          arch: process.arch,
          osRelease: os.release(),
          electron: process.versions.electron,
          chromium: process.versions.chrome,
          node: process.versions.node,
          pid: process.pid,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          hardwareAccelerationDisabled: options.hardwareAccelerationDisabled
        },
        events: []
      }
      this.persistCurrent()
      logger.info('Crash diagnostics started', {
        reportId: this.current.reportId,
        crashDumpsPath: options.dumpsPath
      })
    } catch (error) {
      this.current = undefined
      logger.warn('Failed to initialize crash diagnostics', error as Error)
    }
  }

  public record(kind: string, details: Record<string, unknown> = {}, incident = false): void {
    if (!this.current) return
    try {
      this.current.hasIncident ||= incident
      // Keep crash evidence even when the bounded event history rolls over.
      this.current.hasCrash ||= isCrashEvent(kind, details)
      const timestamp = new Date().toISOString()
      const memory = process.memoryUsage()
      const safeDetails = JSON.parse(JSON.stringify(details, (_key, value) =>
        typeof value === 'string' ? redactDiagnosticText(value).slice(0, 8192) : value))
      this.current.events.push({
        timestamp,
        kind,
        details: {
          ...safeDetails,
          uptimeSeconds: Math.round(process.uptime()),
          mainProcessMemory: { sampledAt: timestamp, rss: memory.rss, heapUsed: memory.heapUsed }
        }
      })
      if (this.current.events.length > MAX_EVENTS) {
        this.current.events.shift()
        this.current.droppedEvents++
      }
      this.persistCurrent()
    } catch (error) {
      // Diagnostics must never interfere with the original crash/quit handler.
      logger.warn('Failed to persist crash diagnostic event', error as Error)
    }
  }

  public recordProcessMemorySample(
    processes: ProcessMemorySample['processes']
  ): void {
    if (!this.current || processes.length === 0) return
    try {
      const sample: ProcessMemorySample = {
        timestamp: new Date().toISOString(),
        processes
      }
      const samples = this.current.processMemorySamples ??= []
      samples.push(sample)
      if (samples.length > MAX_PROCESS_MEMORY_SAMPLES) {
        samples.splice(0, samples.length - MAX_PROCESS_MEMORY_SAMPLES)
      }
      this.persistCurrent()
    } catch (error) {
      // Memory sampling is best-effort and must never affect app stability.
      logger.warn('Failed to persist process memory sample', error as Error)
    }
  }

  public finish(exitCode: number): void {
    if (!this.current || this.current.endedAt) return
    this.current.endedAt = new Date().toISOString()
    this.current.exitCode = exitCode
    this.record('process-exit', { exitCode }, exitCode !== 0)
  }

  private persistCurrent(): void {
    if (!this.current) return
    const file = path.join(this.directory, `${this.current.reportId}.json`)
    const temporary = `${file}.tmp`
    const fd = fs.openSync(temporary, 'w', 0o600)
    try {
      fs.writeFileSync(fd, JSON.stringify(this.current))
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(temporary, file)
  }

  public async sendPendingReports(): Promise<void> {
    if (!this.current || !this.options || this.sending) return
    if (!feedbackMailService.isConfigured()) {
      logger.info('Crash report delivery deferred: feedback SMTP is not configured')
      return
    }
    this.sending = true
    try {
      const reports = await this.readPreviousReports()
      const dumps = await this.findDumps(this.options.dumpsPath)
      // Session start boundaries also include dumps written shortly after process exit.
      const boundaries = [...reports.map((report) => Date.parse(report.startedAt)), Date.parse(this.current.startedAt)]
        .sort((a, b) => a - b)
      let attempts = 0
      for (const report of reports) {
        const marker = path.join(this.directory, `${report.reportId}.attempted`)
        if (fs.existsSync(marker)) continue
        const start = Date.parse(report.startedAt)
        const end = boundaries.find((time) => time > start) ?? Date.parse(this.current.startedAt)
        const matchingDumps = dumps.filter((dump) => dump.mtimeMs >= start && dump.mtimeMs < end)
        const classification = crashClassification(report, matchingDumps)
        if (!classification) continue
        if (attempts >= 3) break
        try {
          const archive = await this.buildArchive(report, matchingDumps, end)
          // Claim BEFORE SMTP. A failed/ambiguous send is intentionally never retried.
          if (!this.claimAttempt(marker, report.reportId)) continue
          attempts++
          try {
            await feedbackMailService.sendCrashReport({
              reportId: report.reportId,
              version: report.environment.version,
              platform: report.environment.platform,
              summary: JSON.stringify({
                reportId: report.reportId,
                classification,
                startedAt: report.startedAt,
                endedAt: report.endedAt ?? null,
                environment: report.environment,
                dumpCount: matchingDumps.length,
                note: 'Includes raw memory dumps when available. See report.json for missing or omitted attachments.'
              }, null, 2),
              archive
            })
            logger.info('Crash report SMTP accepted', { reportId: report.reportId })
          } catch (error) {
            logger.warn('Crash report send failed; marked attempted and will not retry', {
              reportId: report.reportId,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        } catch (error) {
          // Preparation failures have not attempted delivery and remain pending.
          logger.warn('Failed to prepare crash report', { reportId: report.reportId, error })
        }
      }
    } catch (error) {
      logger.warn('Failed to scan pending crash reports', error as Error)
    } finally {
      this.sending = false
    }
  }

  private claimAttempt(marker: string, reportId: string): boolean {
    let fd: number | undefined
    try {
      fd = fs.openSync(marker, 'wx', 0o600)
      fs.writeFileSync(fd, JSON.stringify({ reportId, status: 'attempted', attemptedAt: new Date().toISOString() }))
      fs.fsyncSync(fd)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        logger.warn('Failed to persist crash report attempt; skipping send', error as Error)
      }
      return false
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  }

  private async readPreviousReports(): Promise<SessionReport[]> {
    const reports: SessionReport[] = []
    for (const name of await fs.promises.readdir(this.directory)) {
      if (!REPORT_FILE.test(name) || name === `${this.current!.reportId}.json`) continue
      try {
        const file = path.join(this.directory, name)
        const stat = await fs.promises.lstat(file)
        if (!stat.isFile() || stat.size > 1024 * 1024) continue
        const report = JSON.parse(await fs.promises.readFile(file, 'utf8')) as SessionReport
        if (report.schemaVersion !== 1 || `${report.reportId}.json` !== name ||
            !Number.isFinite(Date.parse(report.startedAt)) || !report.environment || !Array.isArray(report.events)) continue
        reports.push(report)
      } catch (error) {
        logger.warn('Skipping unreadable crash session', { name, error })
      }
    }
    return reports.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
  }

  private async findDumps(directory: string, depth = 0): Promise<DumpFile[]> {
    const result: DumpFile[] = []
    try {
      for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name)
        if (entry.isDirectory() && depth < 3) {
          result.push(...await this.findDumps(absolutePath, depth + 1))
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.dmp')) {
          const stat = await fs.promises.stat(absolutePath)
          result.push({ absolutePath, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs })
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to scan crash dump directory', error as Error)
      }
    }
    return result.sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  private async buildArchive(report: SessionReport, dumps: DumpFile[], sessionEnd: number): Promise<Buffer> {
    const zip = new AdmZip()
    const attachments: Array<Record<string, unknown>> = []
    let dumpBytes = 0
    for (const [index, dump] of dumps.entries()) {
      const entry: Record<string, unknown> = { name: dump.name, size: dump.size, modifiedAt: new Date(dump.mtimeMs).toISOString() }
      attachments.push(entry)
      if (dumpBytes + dump.size > MAX_DUMP_BYTES) {
        entry.status = 'omitted-size-limit'
        continue
      }
      try {
        const content = await this.readTail(dump.absolutePath, MAX_DUMP_BYTES, true)
        if (dumpBytes + content.length > MAX_DUMP_BYTES) {
          entry.status = 'omitted-size-limit'
          continue
        }
        const archivePath = `dumps/${index}-${dump.name}`
        zip.addFile(archivePath, content)
        dumpBytes += content.length
        entry.status = 'attached'
        entry.archivePath = archivePath
      } catch {
        entry.status = 'unavailable-or-too-large'
      }
    }
    const logEnd = report.endedAt ? Math.min(sessionEnd, Date.parse(report.endedAt) + 60_000) : sessionEnd
    const logs = await this.collectLogs(Date.parse(report.startedAt), logEnd)
    zip.addFile('diagnostic.log', Buffer.from(logs.text))
    zip.addFile('report.json', Buffer.from(JSON.stringify({
      ...report,
      classification: crashClassification(report, dumps),
      attachments,
      dumpStatus: dumps.length ? 'see-attachments' : 'no-dump-found',
      logs: logs.notes,
      limits: { maxDumpBytes: MAX_DUMP_BYTES, maxLogBytes: MAX_LOG_BYTES },
      note: 'Dump association is based on session time range, not proof of the failing process. Raw dumps may contain sensitive memory.'
    }, null, 2)))
    return zip.toBufferPromise()
  }

  private async readTail(file: string, limit: number, requireWholeFile = false): Promise<Buffer> {
    const handle = await fs.promises.open(file, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || (requireWholeFile && stat.size > limit)) throw new Error('Attachment exceeds limit')
      const buffer = Buffer.alloc(Math.min(stat.size, limit))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, stat.size - limit))
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  private async collectLogs(start: number, end: number): Promise<{ text: string; notes: string[] }> {
    const notes: string[] = []
    const lines: Array<{ time: number; text: string }> = []
    let lastLogTime = start
    try {
      const names = (await fs.promises.readdir(this.options!.logsPath))
        .filter((name) => /^app(?:-error)?\.\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(name))
        .filter((name) => {
          const day = Date.parse(`${name.match(/\d{4}-\d{2}-\d{2}/)![0]}T00:00:00`)
          return day <= end && day >= start - 24 * 60 * 60_000
        })
        .sort((a, b) => b.match(/\d{4}-\d{2}-\d{2}/)![0].localeCompare(a.match(/\d{4}-\d{2}-\d{2}/)![0])).slice(0, 8)
      for (const name of names) {
        try {
          const content = await this.readTail(path.join(this.options!.logsPath, name), MAX_LOG_BYTES)
          for (const line of content.toString('utf8').split('\n')) {
            try {
              const item = JSON.parse(line)
              const time = Date.parse(String(item.timestamp).replace(' ', 'T'))
              if (!(time >= start && time < end)) continue
              lastLogTime = Math.max(lastLogTime, time)
              if (!['MainEntry', 'WindowService', 'AppUpdater', 'PowerMonitorService', 'CrashReportService'].includes(item.module)) continue
              lines.push({ time, text: JSON.stringify({
                timestamp: item.timestamp, level: item.level, module: item.module,
                message: redactDiagnosticText(String(item.message)).slice(0, 8192)
              }) })
            } catch { /* Ignore partial or non-JSON lines. */ }
          }
        } catch { notes.push(`Could not read ${name}`) }
      }
    } catch { notes.push('Log directory unavailable') }
    notes.push('Only diagnostic modules and a bounded tail from the last 20 minutes of recorded session activity are included; text redaction is best effort.')
    const selected = lines.filter((line) => line.time >= lastLogTime - 20 * 60_000)
      .sort((a, b) => a.time - b.time).map((line) => line.text)
    return { text: Buffer.from([...new Set(selected)].join('\n')).subarray(-MAX_LOG_BYTES).toString('utf8'), notes }
  }
}

export const crashReportService = new CrashReportService()
