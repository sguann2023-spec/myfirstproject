import { loggerService } from '@logger'
import AdmZip from 'adm-zip'
import fs from 'fs'
import type Mail from 'nodemailer/lib/mailer'
import nodemailer from 'nodemailer'
import path from 'path'

const logger = loggerService.withContext('FeedbackMailService')

const SMTP_HOST = 'smtp.qq.com'
const SMTP_PORT = 465
const SMTP_USER = 'sguann@qq.com'
const SMTP_PASS = 'nvfnwtchhzgibbcj'
const FEEDBACK_TO = 'sguann@qq.com'

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
  private transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  })

  public async sendFeedbackMail(payload: FeedbackMailPayload): Promise<void> {
    const message = String(payload.message || '').trim()
    if (!message) {
      throw new Error('反馈内容不能为空')
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

    await this.transporter.sendMail({
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
        `日志目录：${payload.logsPath || '未获取到日志目录'}`
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
