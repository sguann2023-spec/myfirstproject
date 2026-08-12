import { createHmac, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('OssUploadService')

const STS_BASE_URL = 'https://open.vectcut.com'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const DEFAULT_BUCKET = 'jianying-upload-tmp'
const DEFAULT_REGION = 'oss-cn-hangzhou'
const MAX_FILE_SIZE = 500 * 1024 * 1024
const DEFAULT_OBJECT_KEY_PREFIX = 'vectcut_koubo_tmp_file_'

type CredentialsResponse = {
  bucket_name?: string
  region?: string
  key_prefix?: string
  credentials?: {
    AccessKeyId?: string
    AccessKeySecret?: string
    SecurityToken?: string
  }
}

type AgentTmpInitResponse = {
  success?: boolean
  error?: string
  message?: string
  file_name?: string
  object_key?: string
  upload?: {
    upload_url?: string
    host?: string
    form_data?: Record<string, string>
  }
  download?: {
    signed_url?: string
  }
  signed_url?: string
}

type AgentTmpUploadInit = {
  fileName: string
  objectKey: string
  uploadUrl: string
  formData: Record<string, string>
  signedUrl: string
}

type UploadedImage = {
  objectKey: string
  publicUrl: string
}

type UploadedFile = {
  objectKey: string
  folder: string
  publicUrl: string
  signedPublicUrl: string
  bucket: string
  region: string
  contentType: string
  size: number
}

type UploadLocalFileOptions = {
  bucket?: string
  region?: string
  folder?: string
  contentType?: string
  objectKeyPrefix?: string
  publicEndpoint?: string
  signExpiresSeconds?: number
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

class OssUploadService {
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  public async uploadImageBase64(data: string, mediaType: string): Promise<UploadedImage> {
    const buffer = Buffer.from(data, 'base64')

    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error('IMAGE_TOO_LARGE')
    }

    const credentials = await this.getCredentials()
    const bucket = String(credentials.bucket_name || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET
    const region = String(credentials.region || DEFAULT_REGION).trim() || DEFAULT_REGION
    const uploadHost = `https://${bucket}.${region}.aliyuncs.com`
    const creds = credentials.credentials || {}
    const accessKeyId = String(creds.AccessKeyId || '').trim()
    const accessKeySecret = String(creds.AccessKeySecret || '').trim()
    const securityToken = String(creds.SecurityToken || '').trim()

    if (!accessKeyId || !accessKeySecret) {
      throw new Error('STS_INVALID')
    }

    const keyPrefix = this.buildKeyPrefix(credentials.key_prefix)
    const objectKey = `${keyPrefix}vectcut_koubo_tmp_file_${randomUUID()}${this.detectExtension(mediaType)}`
    const policy = this.makePolicyBase64(keyPrefix, securityToken)
    const signature = this.hmacSha1Base64(policy, accessKeySecret)
    const form = new FormData()
    form.append('key', objectKey)
    form.append('policy', policy)
    form.append('OSSAccessKeyId', accessKeyId)
    if (securityToken) {
      form.append('x-oss-security-token', securityToken)
    }
    form.append('success_action_status', '200')
    form.append('Signature', signature)
    form.append('Content-Type', mediaType || 'application/octet-stream')
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: mediaType || 'application/octet-stream' }),
      pathBasename(objectKey)
    )

    logger.info('Uploading multimodal image to OSS', {
      bucket,
      region,
      keyPrefix,
      objectKey,
      size: buffer.length,
      mediaType
    })

    const response = await net.fetch(uploadHost, {
      method: 'POST',
      body: form
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`UPLOAD_FAILED:${response.status}:${body}`)
    }

    const publicUrl = this.buildPublicUrl(bucket, undefined, uploadHost, objectKey)

    logger.info('Uploaded multimodal image to OSS', {
      objectKey,
      publicUrl
    })

    return {
      objectKey,
      publicUrl
    }
  }

  public async uploadLocalFile(filePath: string, options: UploadLocalFileOptions = {}): Promise<UploadedFile> {
    const normalizedPath = String(filePath || '').trim()
    if (!normalizedPath) {
      throw new Error('FILE_PATH_REQUIRED')
    }

    const stats = await fs.stat(normalizedPath)
    if (!stats.isFile()) {
      throw new Error('FILE_PATH_INVALID')
    }
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error('FILE_TOO_LARGE')
    }

    const requestedBucket = String(options.bucket || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET
    const requestedFolder = this.resolveUploadFolder(options.folder)
    const bucket = requestedBucket
    const region = String(options.region || DEFAULT_REGION).trim() || DEFAULT_REGION

    const bytes = await fs.readFile(normalizedPath)
    const contentType = this.resolveContentType(normalizedPath, options.contentType)
    const fileName = this.resolveUploadFileName(normalizedPath, contentType)
    const upload = await this.initAgentTmpUpload(fileName)

    logger.info('Uploading local file to OSS', {
      filePath: normalizedPath,
      bucket: requestedBucket,
      region: options.region || DEFAULT_REGION,
      objectKey: upload.objectKey,
      size: stats.size,
      contentType
    })

    await this.uploadBytesWithForm(upload.uploadUrl, upload.formData, bytes, upload.fileName, contentType)
    const ossLocation = this.parseOssLocation(upload.uploadUrl)
    const folder = this.resolveObjectFolder(upload.objectKey, requestedFolder)
    const publicUrl = upload.signedUrl
    const signedPublicUrl = upload.signedUrl

    logger.info('Uploaded local file to OSS', {
      filePath: normalizedPath,
      objectKey: upload.objectKey,
      publicUrl,
      signedPublicUrl
    })

    return {
      objectKey: upload.objectKey,
      folder,
      publicUrl,
      signedPublicUrl,
      bucket: ossLocation.bucket || bucket,
      region: ossLocation.region || region,
      contentType,
      size: stats.size
    }
  }

  private async initAgentTmpUpload(fileName: string): Promise<AgentTmpUploadInit> {
    const response = await this.authenticatedJsonFetch('/sts/upload/agent_tmp/init', {
      file_name: fileName
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`STS_UPLOAD_INIT_FAILED:${response.status}:${body}`)
    }

    const payload = (await response.json()) as AgentTmpInitResponse
    if (payload.success === false) {
      throw new Error(String(payload.error || payload.message || 'STS_UPLOAD_INIT_FAILED'))
    }

    const upload = payload.upload
    const uploadUrl = String(upload?.upload_url || upload?.host || '').trim()
    const signedUrl = String(payload.download?.signed_url || payload.signed_url || '').trim()
    const objectKey = String(payload.object_key || '').trim()
    const responseFileName = String(payload.file_name || fileName).trim() || fileName
    const formData = this.normalizeUploadFormData(upload?.form_data)

    if (!uploadUrl) {
      throw new Error('STS_UPLOAD_INIT_INVALID:missing upload_url')
    }
    if (!signedUrl) {
      throw new Error('STS_UPLOAD_INIT_INVALID:missing signed_url')
    }
    if (!objectKey) {
      throw new Error('STS_UPLOAD_INIT_INVALID:missing object_key')
    }

    return {
      fileName: responseFileName,
      objectKey,
      uploadUrl,
      formData,
      signedUrl
    }
  }

  private async getCredentials(payload: Record<string, unknown> = {}): Promise<CredentialsResponse> {
    const response = await this.authenticatedJsonFetch('/sts/get_credentials', payload)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`STS_CREDENTIALS_FAILED:${response.status}:${body}`)
    }

    return (await response.json()) as CredentialsResponse
  }

  private async authenticatedJsonFetch(endpoint: string, payload: unknown): Promise<Response> {
    let accessToken = await this.ensureValidAccessToken()
    let response = await this.makeJsonRequest(endpoint, accessToken, payload)

    if (response.status === 401 || response.status === 400) {
      this.accessToken = null
      accessToken = await this.ensureValidAccessToken(true)
      response = await this.makeJsonRequest(endpoint, accessToken, payload)
    }

    return response
  }

  private async makeJsonRequest(endpoint: string, accessToken: string, payload: unknown): Promise<Response> {
    return net.fetch(`${STS_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload ?? {})
    })
  }

  private async ensureValidAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() < this.accessToken.expiresAt - 30_000) {
      return this.accessToken.accessToken
    }

    if (!forceRefresh && this.refreshPromise) {
      return this.refreshPromise
    }

    const refreshToken = String(this.store.get('auth.refresh_token') || '').trim()
    if (!refreshToken) {
      throw new Error('NO_REFRESH_TOKEN')
    }

    this.refreshPromise = this.refreshAccessToken(refreshToken)

    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET
    }).toString()

    const response = await net.fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`TOKEN_REFRESH_FAILED:${response.status}:${text}`)
    }

    const payload = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    const accessToken = String(payload.access_token || '').trim()
    if (!accessToken) {
      throw new Error('TOKEN_REFRESH_INVALID')
    }

    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
    this.accessToken = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000
    }

    if (typeof payload.refresh_token === 'string' && payload.refresh_token.trim()) {
      this.store.set('auth.refresh_token', payload.refresh_token.trim())
    }

    return accessToken
  }

  private hmacSha1Base64(message: string, secret: string): string {
    return createHmac('sha1', secret).update(message).digest('base64')
  }

  private async uploadBytesWithForm(
    uploadUrl: string,
    rawFormData: Record<string, string>,
    bytes: Buffer,
    fileName: string,
    contentType: string
  ) {
    const form = new FormData()
    Object.entries(rawFormData).forEach(([key, value]) => {
      form.append(key, value)
    })
    form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), fileName)

    const response = await net.fetch(uploadUrl, {
      method: 'POST',
      body: form
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`UPLOAD_FAILED:${response.status}:${body}`)
    }

    const body = (await response.text().catch(() => '')).trim()
    if (body.startsWith('<Error') || body.includes('<Error>')) {
      throw new Error(`UPLOAD_FAILED:200:${body}`)
    }
  }

  private makePolicyBase64(prefix: string, securityToken: string): string {
    const expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    const conditions: Array<Record<string, string> | [string, string, string] | [string, number, number]> = [
      ['starts-with', '$key', prefix],
      ['content-length-range', 0, MAX_FILE_SIZE],
      { success_action_status: '200' },
      ['starts-with', '$Content-Type', '']
    ]

    if (securityToken) {
      conditions.push({ 'x-oss-security-token': securityToken })
    }

    return Buffer.from(
      JSON.stringify({
        expiration,
        conditions
      })
    ).toString('base64')
  }

  private buildKeyPrefix(rawPrefix?: string): string {
    const value = String(rawPrefix || 'uploads').trim() || 'uploads'
    return value.endsWith('/') ? value : `${value}/`
  }

  private detectExtension(mediaType: string): string {
    if (mediaType.includes('jpeg')) return '.jpg'
    if (mediaType.includes('png')) return '.png'
    if (mediaType.includes('webp')) return '.webp'
    if (mediaType.includes('gif')) return '.gif'
    if (mediaType.includes('bmp')) return '.bmp'
    if (mediaType.includes('avif')) return '.avif'
    if (mediaType.includes('mp3')) return '.mp3'
    if (mediaType.includes('wav')) return '.wav'
    if (mediaType.includes('mp4')) return '.mp4'
    if (mediaType.includes('mov')) return '.mov'
    if (mediaType.includes('m4a')) return '.m4a'
    if (mediaType.includes('pdf')) return '.pdf'
    if (mediaType.includes('json')) return '.json'
    if (mediaType.includes('plain')) return '.txt'
    return ''
  }

  private resolveContentType(filePath: string, override?: string): string {
    const explicit = String(override || '').trim()
    if (explicit) {
      return explicit
    }

    const ext = path.extname(filePath).toLowerCase()
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg'
      case '.png':
        return 'image/png'
      case '.webp':
        return 'image/webp'
      case '.gif':
        return 'image/gif'
      case '.bmp':
        return 'image/bmp'
      case '.avif':
        return 'image/avif'
      case '.mp3':
        return 'audio/mpeg'
      case '.wav':
        return 'audio/wav'
      case '.m4a':
        return 'audio/mp4'
      case '.mp4':
        return 'video/mp4'
      case '.mov':
        return 'video/quicktime'
      case '.pdf':
        return 'application/pdf'
      case '.json':
        return 'application/json'
      case '.txt':
      case '.md':
        return 'text/plain'
      default:
        return 'application/octet-stream'
    }
  }

  private resolveUploadFolder(rawFolder?: string): string {
    const requestedFolder = String(rawFolder || 'agent_tmp').trim() || 'agent_tmp'
    if (!requestedFolder.includes('{uid}')) {
      return requestedFolder
    }

    const storedUserId = String(this.store.get('settings.userId') || '').trim()
    const resolvedUserId = storedUserId || 'anonymous'
    return requestedFolder.replaceAll('{uid}', resolvedUserId)
  }

  private buildPublicUrl(bucket: string, publicEndpoint: string | undefined, uploadHost: string, objectKey: string): string {
    const endpoint = String(publicEndpoint || '')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
    if (!endpoint) {
      return `${uploadHost}/${objectKey}`
    }
    const isCname = !endpoint.includes('aliyuncs.com') && !endpoint.includes('oss-')
    return isCname ? `https://${endpoint}/${objectKey}` : `https://${bucket}.${endpoint}/${objectKey}`
  }

  private normalizeUploadFormData(rawFormData: unknown): Record<string, string> {
    if (!rawFormData || typeof rawFormData !== 'object' || Array.isArray(rawFormData)) {
      throw new Error('STS_UPLOAD_INIT_INVALID:missing form_data')
    }

    return Object.fromEntries(
      Object.entries(rawFormData).map(([key, value]) => [key, String(value ?? '')])
    )
  }

  private resolveUploadFileName(filePath: string, contentType: string): string {
    const baseName = path.basename(filePath).trim()
    if (baseName) {
      return baseName
    }

    const ext = this.detectExtension(contentType) || '.bin'
    return `${DEFAULT_OBJECT_KEY_PREFIX}${randomUUID()}${ext}`
  }

  private resolveObjectFolder(objectKey: string, fallbackFolder: string): string {
    const normalizedObjectKey = String(objectKey || '').trim()
    if (!normalizedObjectKey) {
      return fallbackFolder
    }

    const folder = path.posix.dirname(normalizedObjectKey)
    return folder === '.' ? fallbackFolder : folder
  }

  private parseOssLocation(uploadUrl: string): { bucket: string; region: string } {
    try {
      const { hostname } = new URL(uploadUrl)
      const match = hostname.match(/^([^.]+)\.(oss-[^.]+)\.aliyuncs\.com$/)
      if (match) {
        return {
          bucket: match[1] || '',
          region: match[2] || ''
        }
      }
    } catch {
      // Ignore parse failures and fall back to configured values.
    }

    return {
      bucket: '',
      region: ''
    }
  }
}

function pathBasename(objectKey: string): string {
  const segments = objectKey.split('/')
  return segments[segments.length - 1] || 'upload.bin'
}

export const ossUploadService = new OssUploadService()
