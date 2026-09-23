import AdmZip from 'adm-zip'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  configured: vi.fn(() => true),
  logger: { info: vi.fn(), warn: vi.fn() }
}))
vi.mock('@logger', () => ({ loggerService: { withContext: () => mocks.logger } }))
vi.mock('../FeedbackMailService', () => ({
  feedbackMailService: { isConfigured: mocks.configured, sendCrashReport: mocks.send }
}))

import { CrashReportService, describeDiagnosticError, redactDiagnosticText } from '../CrashReportService'

describe('CrashReportService', () => {
  let directory: string
  let options: Parameters<CrashReportService['start']>[0]
  const queue = () => path.join(directory, 'crash-reports')
  const markers = () => fs.readdirSync(queue()).filter((name) => name.endsWith('.attempted'))
  const reports = () => fs.readdirSync(queue())
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(queue(), name), 'utf8')))
  const nextSession = () => {
    vi.setSystemTime(Date.now() + 60_000)
    const service = new CrashReportService()
    service.start(options)
    return service
  }
  const archive = () => new AdmZip(mocks.send.mock.calls[0][0].archive)
  const addDump = (name = 'renderer.dmp', bytes = Buffer.from('native dump')) => {
    const target = path.join(options.dumpsPath, 'pending', name)
    fs.writeFileSync(target, bytes)
    fs.utimesSync(target, new Date(), new Date())
    return target
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-19T01:00:00Z'))
    vi.clearAllMocks()
    mocks.configured.mockReturnValue(true)
    mocks.send.mockResolvedValue(undefined)
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vectcut-crash-test-'))
    options = {
      userDataPath: directory,
      logsPath: path.join(directory, 'logs'),
      dumpsPath: path.join(directory, 'Crashpad'),
      version: '1.7.5',
      hardwareAccelerationDisabled: false
    }
    fs.mkdirSync(options.logsPath)
    fs.mkdirSync(path.join(options.dumpsPath, 'pending'), { recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('keeps a bounded process-memory history in the crash report', async () => {
    const previous = nextSession()
    for (let index = 0; index < 125; index++) {
      previous.recordProcessMemorySample([{
        pid: 123,
        type: 'Tab',
        memory: { workingSetSize: index * 1024, peakWorkingSetSize: index * 1024 }
      }])
    }
    previous.record('render-process-gone', { reason: 'oom' }, true)
    const current = nextSession()
    await current.sendPendingReports()

    const report = JSON.parse(archive().readAsText('report.json'))
    expect(report.processMemorySamples).toHaveLength(120)
    expect(report.processMemorySamples[0].processes[0].memory.workingSetSize).toBe(5 * 1024)
    expect(report.processMemorySamples.at(-1).processes[0].memory.workingSetSize).toBe(124 * 1024)
  })

  it('persists crash details synchronously and defers the current session', async () => {
    const service = nextSession()
    service.record('render-process-gone', { reason: 'crashed', exitCode: -1 }, true)
    expect(reports()[0]).toMatchObject({
      hasIncident: true,
      events: [{ kind: 'render-process-gone', details: { reason: 'crashed', exitCode: -1 } }]
    })
    await service.sendPendingReports()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('attaches the previous session dump and claims delivery before calling SMTP', async () => {
    const previous = nextSession()
    previous.record('render-process-gone', { reason: 'crashed' }, true)
    addDump()
    const current = nextSession()
    mocks.send.mockImplementation(async () => {
      expect(markers()).toHaveLength(1)
      expect(JSON.parse(fs.readFileSync(path.join(queue(), markers()[0]), 'utf8')).status).toBe('attempted')
    })
    await current.sendPendingReports()
    const report = JSON.parse(archive().readAsText('report.json'))
    expect(report.attachments[0].status).toBe('attached')
    expect(archive().readAsText(report.attachments[0].archivePath)).toBe('native dump')
    expect(report.environment.version).toBe('1.7.5')
    expect(report.dumpStatus).toBe('see-attachments')
  })

  it('does not retry a failed send, even after another startup', async () => {
    nextSession().record('render-process-gone', { reason: 'oom' }, true)
    const current = nextSession()
    mocks.send.mockRejectedValue(new Error('SMTP timeout'))
    await Promise.all([current.sendPendingReports(), current.sendPendingReports()])
    await current.sendPendingReports()
    current.finish(0)
    await nextSession().sendPendingReports()
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(markers()).toHaveLength(1)
  })

  it('does not retry a successful send or a pre-existing incomplete attempt marker', async () => {
    nextSession().record('child-process-gone', { reason: 'crashed' }, true)
    const current = nextSession()
    await current.sendPendingReports()
    // A truncated marker after an interrupted write must still suppress retries.
    fs.writeFileSync(path.join(queue(), markers()[0]), '')
    await current.sendPendingReports()
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('keeps reports pending while SMTP is unconfigured', async () => {
    nextSession().record('render-process-gone', { reason: 'crashed' }, true)
    const current = nextSession()
    mocks.configured.mockReturnValue(false)
    await current.sendPendingReports()
    expect(markers()).toHaveLength(0)
    expect(mocks.send).not.toHaveBeenCalled()
    mocks.configured.mockReturnValue(true)
    await current.sendPendingReports()
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('does not report unclean sessions without crash evidence', async () => {
    nextSession()
    await nextSession().sendPendingReports()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(markers()).toHaveLength(0)
  })

  it.each([0, 1])('does not report ordinary JS errors with exit code %i', async (exitCode) => {
    const previous = nextSession()
    previous.record('unhandled-rejection', { message: 'bonjour-service did not export a Bonjour constructor' }, true)
    previous.record('uncaught-exception', { message: 'Recoverable error' }, true)
    previous.finish(exitCode)
    await nextSession().sendPendingReports()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(markers()).toHaveLength(0)
  })

  it.each([1, 6])('ignores legacy reports containing %i ordinary rejections', async (count) => {
    const previous = nextSession()
    for (let i = 0; i < count; i++) {
      previous.record('unhandled-rejection', { message: i ? '[object Object]' : 'Bonjour error' }, true)
    }
    previous.finish(0)
    const legacy = reports()[0]
    delete legacy.hasCrash
    fs.writeFileSync(path.join(queue(), `${legacy.reportId}.json`), JSON.stringify(legacy))
    await nextSession().sendPendingReports()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('still reports legacy renderer crashes even after a clean exit', async () => {
    const previous = nextSession()
    previous.record('render-process-gone', { reason: 'crashed' }, true)
    previous.finish(0)
    const legacy = reports()[0]
    delete legacy.hasCrash
    fs.writeFileSync(path.join(queue(), `${legacy.reportId}.json`), JSON.stringify(legacy))
    await nextSession().sendPendingReports()
    expect(JSON.parse(archive().readAsText('report.json')).classification).toBe('process-crash')
    expect(JSON.parse(mocks.send.mock.calls[0][0].summary).classification).toBe('process-crash')
  })

  it.each(['clean-exit', 'killed', 'launch-failed'])('does not report a process %s without crash evidence', async (reason) => {
    const previous = nextSession()
    previous.record('render-process-gone', { reason }, true)
    previous.record('child-process-gone', { reason }, true)
    previous.record('renderer-recovery-action', { action: 'exit', exitCode: 1 }, true)
    previous.finish(1)
    await nextSession().sendPendingReports()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it.each(['crashed', 'oom', 'abnormal-exit', 'integrity-failure'])('reports a process %s without a dump', async (reason) => {
    const previous = nextSession()
    previous.record('child-process-gone', { reason }, true)
    previous.finish(0)
    await nextSession().sendPendingReports()
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(JSON.parse(archive().readAsText('report.json')).dumpStatus).toBe('no-dump-found')
  })

  it('retains crash evidence after the event history rolls over', async () => {
    const previous = nextSession()
    previous.record('render-process-gone', { reason: 'oom' }, true)
    for (let i = 0; i < 90; i++) previous.record('event')
    previous.finish(0)
    expect(reports()[0].events.some((event: { kind: string }) => event.kind === 'render-process-gone')).toBe(false)
    await nextSession().sendPendingReports()
    expect(mocks.send).toHaveBeenCalledOnce()
  })

  it('does not classify renderer or child-process failures during Windows session shutdown as app crashes', async () => {
    const previous = nextSession()
    previous.record('windows-session-ending', { phase: 'query-session-end' })
    previous.record('render-process-gone', { reason: 'crashed', exitCode: -1, isQuitting: true }, false)
    previous.record('child-process-gone', { type: 'GPU', reason: 'killed', exitCode: 1073807364, isQuitting: true }, false)
    previous.finish(0)

    await nextSession().sendPendingReports()

    expect(reports()[0].hasCrash).toBe(false)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('does not report ordinary clean exits', async () => {
    nextSession().finish(0)
    await nextSession().sendPendingReports()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('keeps preparation failures pending without consuming the send attempt', async () => {
    nextSession().record('render-process-gone', { reason: 'crashed' }, true)
    const current = nextSession()
    const prepare = vi.spyOn(current as unknown as { buildArchive(): Promise<Buffer> }, 'buildArchive')
      .mockRejectedValueOnce(new Error('temporary IO failure'))
    await current.sendPendingReports()
    expect(markers()).toHaveLength(0)
    expect(mocks.send).not.toHaveBeenCalled()
    prepare.mockRestore()
    await current.sendPendingReports()
    expect(mocks.send).toHaveBeenCalledOnce()
  })

  it('skips malformed session records without blocking a valid report', async () => {
    nextSession().record('render-process-gone', { reason: 'crashed' }, true)
    fs.writeFileSync(path.join(queue(), '00000000-0000-0000-0000-000000000000.json'), '{')
    await nextSession().sendPendingReports()
    expect(mocks.send).toHaveBeenCalledOnce()
  })

  it('selects diagnostic logs from the previous session even after a long restart delay', async () => {
    nextSession().record('render-process-gone', { reason: 'crashed' }, true)
    const timestamp = new Date(Date.now() + 30_000).toISOString()
    fs.writeFileSync(path.join(options.logsPath, 'app.2026-09-19.log'), [
      JSON.stringify({ timestamp, module: 'MainEntry', level: 'error', message: 'Failure Bearer test-token' }),
      JSON.stringify({ timestamp, module: 'Chat', level: 'info', message: 'private conversation' })
    ].join('\n'))
    vi.setSystemTime(Date.now() + 3 * 60 * 60_000)
    await nextSession().sendPendingReports()
    const text = archive().readAsText('diagnostic.log')
    expect(text).toContain('Failure Bearer [redacted]')
    expect(text).not.toMatch(/test-token|private conversation/)
  })

  it('reports a dump even if the session exited cleanly after a renderer crash', async () => {
    const previous = nextSession()
    addDump()
    previous.finish(0)
    await nextSession().sendPendingReports()
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(archive().readAsText('report.json')).attachments).toHaveLength(1)
    expect(JSON.parse(archive().readAsText('report.json')).classification).toBe('crash-dump')
  })

  it('excludes old dumps and marks oversized dumps explicitly', async () => {
    nextSession()
    const oldDump = addDump('old.dmp')
    fs.utimesSync(oldDump, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000))
    addDump('large.dmp', Buffer.alloc(12 * 1024 * 1024 + 1))
    await nextSession().sendPendingReports()
    const report = JSON.parse(archive().readAsText('report.json'))
    expect(report.attachments).toEqual([
      expect.objectContaining({ name: 'large.dmp', status: 'omitted-size-limit' })
    ])
  })

  it('does not follow dump symlinks outside Crashpad', async () => {
    nextSession().record('render-process-gone', { reason: 'crashed' }, true)
    const outside = path.join(directory, 'private.dmp')
    fs.writeFileSync(outside, 'private')
    fs.symlinkSync(outside, path.join(options.dumpsPath, 'pending', 'linked.dmp'))
    await nextSession().sendPendingReports()
    expect(JSON.parse(archive().readAsText('report.json')).dumpStatus).toBe('no-dump-found')
  })

  it('preserves crash reports when event persistence fails without throwing into the crash handler', () => {
    const service = nextSession()
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('disk unavailable') })
    expect(() => service.record('render-process-gone', {}, true)).not.toThrow()
    expect(mocks.logger.warn).toHaveBeenCalled()
  })

  it('never sends if the durable attempt marker cannot be written', async () => {
    nextSession().record('render-process-gone', { reason: 'crashed' }, true)
    const current = nextSession()
    vi.spyOn(fs, 'openSync').mockImplementation(() => { throw new Error('disk unavailable') })
    await current.sendPendingReports()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('bounds event history and redacts strings without corrupting JSON paths', () => {
    const service = nextSession()
    for (let i = 0; i < 90; i++) {
      service.record('event', { path: 'C:\\Users\\alice\\test', token: 'Bearer secret' })
    }
    expect(reports()[0].events).toHaveLength(80)
    expect(reports()[0].droppedEvents).toBe(10)
    expect(reports()[0].events[0].details.path).toBe('C:\\Users\\[user]\\test')
    expect(reports()[0].events[0].details.token).toBe('Bearer [redacted]')
    expect(redactDiagnosticText('api_key=secret a@b.com https://example.com/?token=secret'))
      .not.toMatch(/secret|a@b.com|example.com/)
  })
})

describe('describeDiagnosticError', () => {
  it('preserves object rejection details and redacts sensitive text', () => {
    const details = describeDiagnosticError({ code: 400, message: 'Request failed', password: 'secret-value' })
    expect(details.message).toContain('400')
    expect(details.message).toContain('Request failed')
    expect(details.message).not.toContain('secret-value')
    expect(details.message).not.toBe('[object Object]')
  })

  it('handles circular references and bigint without throwing', () => {
    const reason: Record<string, unknown> = { code: 123n }
    reason.self = reason
    expect(describeDiagnosticError(reason).message).toContain('123n')
    expect(describeDiagnosticError(reason).message).toContain('Circular')
  })

  it('preserves Error messages and stacks', () => {
    const reason = new Error('Failure')
    expect(describeDiagnosticError(reason)).toEqual({ message: 'Failure', stack: redactDiagnosticText(reason.stack!) })
  })

  it('does not invoke custom inspection hooks or getters', () => {
    const getter = vi.fn(() => { throw new Error('getter called') })
    const reason = Object.defineProperty({}, 'message', { get: getter, enumerable: true })
    expect(() => describeDiagnosticError(reason)).not.toThrow()
    expect(getter).not.toHaveBeenCalled()
  })

  it.each([null, undefined, 'string rejection', 123])('handles primitive rejection %s', (reason) => {
    expect(describeDiagnosticError(reason).message).toBe(String(reason))
  })

  it('bounds the recorded message length', () => {
    expect(describeDiagnosticError('x'.repeat(20_000)).message.length).toBe(8192)
  })
})
