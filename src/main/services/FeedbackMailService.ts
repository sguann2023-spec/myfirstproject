import { loggerService } from '@logger'
import AdmZip from 'adm-zip'
import fs from 'fs'
import type Mail from 'nodemailer/lib/mailer'
import nodemailer from 'nodemailer'
import path from 'path'

const logger = loggerService.withContext('FeedbackMailService')

const SMTP_HOST = process.env.FEEDBACK_SMTP_HOST || 'smtp.qq.com'
const SMTP_PORT = Number(process.env.FEEDBACK_SMTP_PORT || '465')
const SMTP_USER = process.env.FEEDBACK_SMTP_USER || ''
const SMTP_PASS = process.env.FEEDBACK_SMTP_PASS || ''
const FEEDBACK_TO = process.env.FEEDBACK_TO_EMAIL || SMTP_USER

export type FeedbackMailAttachment = {
  filename: string
  mimeType?: string
  contentBase64: string
}

export type FeedbackMailPayload = {
  message: string
  version: string
  platform: string
  logsPath: string
  user?: {
    id?: string
    name?: string
    email?: string
  }
  attachments?: FeedbackMailAttachment[]
}

class FeedbackMailService {
  private createTransporter() {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    })
  }

  public async sendFeedbackMail(payload: FeedbackMailPayload): Promise<void> {
    const message = String(payload.message || '').trim()
    if (!message) {
      throw new Error('反馈内容不能为空')
    }

    if (!SMTP_USER || !SMTP_PASS || !FEEDBACK_TO) {
      throw new Error('反馈邮箱未配置，请检查 FEEDBACK_SMTP_USER / FEEDBACK_SMTP_PASS / FEEDBACK_TO_EMAIL')
    }

    const subjectParts = ['流光剪辑反馈']
    if (payload.user?.name) {
      subjectParts.push(String(payload.user.name))
    }
    if (payload.version) {
      subjectParts.push(String(payload.version))
    }

    const attachments: Mail.Attachment[] = Array.isArray(payload.attachments)
      ? payload.attachments
          .filter((item) => item?.filename && item?.contentBase64)
          .map((item) => ({
            filename: item.filename,
            contentType: item.mimeType || 'application/octet-stream',
            content: Buffer.from(item.contentBase64, 'base64')
          }))
      : []

    const logsZipAttachment = await this.buildLogsZipAttachment(payload.logsPath)
    if (logsZipAttachment) {
      attachments.push(logsZipAttachment)
    }

    await this.createTransporter().sendMail({
      from: `"流光剪辑反馈" <${SMTP_USER}>`,
      to: FEEDBACK_TO,
      subject: subjectParts.map((part) => `[${part}]`).join(''),
      text: [
        '问题描述：',
        message,
        '',
        '----------------',
        `用户名：${payload.user?.name || 'unknown'}`,
        `用户ID：${payload.user?.id || 'unknown'}`,
        `邮箱：${payload.user?.email || 'unknown'}`,
        `版本：${payload.version || 'unknown'}`,
        `平台：${payload.platform || 'unknown'}`,
        payload.logsPath ? `日志目录：${payload.logsPath}` : null
      ].join('\n'),
      attachments
    })

    logger.info('Feedback email sent successfully', {
      attachmentCount: attachments.length,
      version: payload.version,
      platform: payload.platform
    })
  }

  private async buildLogsZipAttachment(logsPath: string): Promise<Mail.Attachment | null> {
    const normalizedPath = String(logsPath || '').trim()
    if (!normalizedPath) {
      return null
    }

    try {
      const stats = await fs.promises.stat(normalizedPath)
      const zip = new AdmZip()

      if (stats.isDirectory()) {
        zip.addLocalFolder(normalizedPath)
      } else if (stats.isFile()) {
        zip.addLocalFile(normalizedPath)
      } else {
        return null
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const zipName = `${path.basename(normalizedPath) || 'logs'}-${timestamp}.zip`

      return {
        filename: zipName,
        contentType: 'application/zip',
        content: zip.toBuffer()
      }
    } catch (error) {
      logger.warn('Failed to build logs zip attachment', { logsPath: normalizedPath, error })
      return null
    }
  }
}

export const feedbackMailService = new FeedbackMailService()
