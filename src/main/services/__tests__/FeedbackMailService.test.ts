import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  close: vi.fn(),
  createTransport: vi.fn()
}))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn() }) }
}))
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.createTransport } }))

describe('automatic crash email', () => {
  const payload = {
    reportId: 'report-123',
    version: '1.7.5',
    platform: 'win32',
    summary: 'Crash summary',
    archive: Buffer.from('zip')
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('FEEDBACK_SMTP_USER', 'sender@example.test')
    vi.stubEnv('FEEDBACK_SMTP_PASS', 'test-password')
    vi.stubEnv('FEEDBACK_TO_EMAIL', 'feedback@example.test')
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, close: mocks.close })
    mocks.sendMail.mockResolvedValue({ accepted: ['feedback@example.test'], rejected: [] })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('uses existing SMTP settings, a stable message ID, and only the supplied archive', async () => {
    const { feedbackMailService } = await import('../FeedbackMailService')
    await feedbackMailService.sendCrashReport(payload)
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      connectionTimeout: 15_000, socketTimeout: 30_000
    }))
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'feedback@example.test',
      messageId: '<crash-report-123@vectcut.local>',
      text: 'Crash summary',
      attachments: [{
        filename: 'crash-report-123.zip',
        contentType: 'application/zip',
        content: payload.archive
      }]
    }))
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('closes the SMTP transport on rejection without retrying', async () => {
    const { feedbackMailService } = await import('../FeedbackMailService')
    mocks.sendMail.mockRejectedValue(new Error('network unavailable'))
    await expect(feedbackMailService.sendCrashReport(payload)).rejects.toThrow('network unavailable')
    expect(mocks.sendMail).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('reports recipient rejection honestly', async () => {
    const { feedbackMailService } = await import('../FeedbackMailService')
    mocks.sendMail.mockResolvedValue({ accepted: [], rejected: ['feedback@example.test'] })
    await expect(feedbackMailService.sendCrashReport(payload)).rejects.toThrow('not fully accepted')
  })

  it('does not attempt SMTP when configuration is missing', async () => {
    vi.stubEnv('FEEDBACK_SMTP_PASS', '')
    const { feedbackMailService } = await import('../FeedbackMailService')
    expect(feedbackMailService.isConfigured()).toBe(false)
    await expect(feedbackMailService.sendCrashReport(payload)).rejects.toThrow('not configured')
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })
})
