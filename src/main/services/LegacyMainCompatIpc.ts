import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { Worker } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import { configManager } from './ConfigManager'
import { registerSessionStreamIpc } from './agents/services/channels/sessionStreamIpc'
import { windowService } from './WindowService'

const logger = loggerService.withContext('LegacyMainCompatIpc')

let registered = false
let authWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
const pendingArtistUrlRequests = new Map<string, Worker>()
const activeDownloadWorkers = new Map<number, {
  worker: Worker
  sender: any
  draftId: string
  stopReason: string | null
  lastFileList: any[]
}>()

function safeHandle(channel: string, handler: Parameters<typeof ipcMain.handle>[1]) {
  try {
    ipcMain.handle(channel, handler)
  } catch (error) {
    logger.warn(`Skip duplicate ipcMain.handle registration: ${channel}`, error as Error)
  }
}

function safeOn(channel: string, listener: Parameters<typeof ipcMain.on>[1]) {
  try {
    ipcMain.on(channel, listener)
  } catch (error) {
    logger.warn(`Skip duplicate ipcMain.on registration: ${channel}`, error as Error)
  }
}

function getMainWindow() {
  const mainWindow = windowService.getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return null
  return mainWindow
}

type AbortableDownloadRequest = {
  abort: () => void
}

async function downloadViaWindowSession(
  worker: Worker,
  payload: { reqId?: string; url?: string; localFilename?: string; timeout?: number; headers?: Record<string, string> },
  draftId: string,
  jobId: number
) {
  const reqId = String(payload?.reqId || '')
  const url = String(payload?.url || '')
  const localFilename = String(payload?.localFilename || '')
  const timeout = Math.max(1000, Number(payload?.timeout || 180000))

  const reply = (message: Record<string, unknown>) => {
    worker.postMessage({
      reqId,
      ...message
    })
  }

  if (!reqId || !url || !localFilename) {
    reply({
      type: 'session-download-response',
      success: false,
      error: 'invalid session download payload'
    })
    return
  }

  const mainWindow = getMainWindow()
  if (!mainWindow) {
    reply({
      type: 'session-download-response',
      success: false,
      error: 'mainWindow unavailable for session download'
    })
    return
  }

  let activeRequest: AbortableDownloadRequest | null = null
  let timeoutError: Error | null = null
  const timer = setTimeout(() => {
    timeoutError = new Error(`session download timeout after ${timeout}ms`)
    activeRequest?.abort()
  }, timeout)
  let completed = false
  let downloadedBytes = 0
  let totalBytes = 0

  try {
    await fs.promises.mkdir(path.dirname(localFilename), { recursive: true })

    logger.info('[DLTRACE][Main] session download start', {
      jobId,
      draftId,
      reqId,
      url,
      localFilename
    })

    const buildRequestHeaders = async (targetUrl: string) => {
      const headers: Record<string, string> = {
        ...(payload?.headers || {})
      }

      if (!headers.Cookie && !headers.cookie) {
        try {
          const cookies = await mainWindow.webContents.session.cookies.get({ url: targetUrl })
          if (cookies.length > 0) {
            headers.Cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
          }
        } catch (error) {
          logger.warn('[DLTRACE][Main] read session cookies failed', error as Error)
        }
      }

      return headers
    }

    const downloadWithSessionFetch = async (targetUrl: string) => {
      const abortController = new AbortController()
      activeRequest = {
        abort: () => {
          abortController.abort()
        }
      }

      const response = await mainWindow.webContents.session.fetch(targetUrl, {
        method: 'GET',
        headers: payload?.headers || {},
        signal: abortController.signal
      })

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
      }

      if (!response.body) {
        throw new Error('empty response body')
      }

      totalBytes = Number(response.headers.get('content-length') || 0)
      const source = Readable.fromWeb(response.body as NodeReadableStream)

      source.on('data', (chunk) => {
        downloadedBytes += Buffer.byteLength(chunk)
        reply({
          type: 'session-download-progress',
          downloadedBytes,
          totalBytes
        })
      })

      await pipeline(source, fs.createWriteStream(localFilename))
    }

    const downloadWithNodeRequest = async (targetUrl: string, redirectCount = 0): Promise<void> => {
      if (redirectCount >= 5) {
        throw new Error('session download exceeded redirect limit')
      }

      const requestHeaders = await buildRequestHeaders(targetUrl)
      const redirectUrl = await new Promise<string | null>((resolve, reject) => {
        let settled = false

        const finish = (error?: Error, nextUrl?: string | null) => {
          if (settled) return
          settled = true
          if (error) {
            reject(error)
            return
          }
          resolve(nextUrl || null)
        }

        const parsedUrl = new URL(targetUrl)
        const client = parsedUrl.protocol === 'https:' ? https : http
        const request = client.request(
          {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || undefined,
            path: `${parsedUrl.pathname}${parsedUrl.search}`,
            method: 'GET',
            headers: requestHeaders
          },
          (response) => {
            const statusCode = Number(response.statusCode || 0)
            const locationHeader = response.headers.location
            const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader

            if (statusCode >= 300 && statusCode < 400 && location) {
              response.resume()
              finish(undefined, new URL(location, targetUrl).toString())
              return
            }

            if (statusCode < 200 || statusCode >= 300) {
              response.resume()
              finish(new Error(`Request failed with status ${statusCode || 'unknown'}`))
              return
            }

            const contentLengthHeader = response.headers['content-length']
            const contentLengthValue = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader
            totalBytes = Number(contentLengthValue || 0)

            response.on('data', (chunk) => {
              downloadedBytes += Buffer.byteLength(chunk)
              reply({
                type: 'session-download-progress',
                downloadedBytes,
                totalBytes
              })
            })

            response.on('aborted', () => {
              finish(new Error('session download aborted'))
            })

            pipeline(response, fs.createWriteStream(localFilename))
              .then(() => finish())
              .catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
          }
        )

        activeRequest = {
          abort: () => {
            request.destroy(timeoutError || new Error('session download aborted'))
          }
        }

        request.on('error', (error) => {
          finish(timeoutError || (error instanceof Error ? error : new Error(String(error))))
        })

        request.end()
      })

      if (redirectUrl) {
        await downloadWithNodeRequest(redirectUrl, redirectCount + 1)
      }
    }

    try {
      await downloadWithNodeRequest(url)
    } catch (error) {
      const message = timeoutError?.message || (error instanceof Error ? error.message : String(error))
      logger.warn('[DLTRACE][Main] node request failed, fallback to session.fetch', {
        jobId,
        draftId,
        reqId,
        url,
        error: message
      })

      downloadedBytes = 0
      totalBytes = 0
      try {
        await fs.promises.unlink(localFilename)
      } catch {}

      await downloadWithSessionFetch(url)
    }

    completed = true

    reply({
      type: 'session-download-progress',
      downloadedBytes,
      totalBytes: totalBytes || downloadedBytes
    })
    reply({
      type: 'session-download-response',
      success: true
    })

    logger.info('[DLTRACE][Main] session download complete', {
      jobId,
      draftId,
      reqId,
      url,
      downloadedBytes,
      totalBytes
    })
  } catch (error) {
    try {
      await fs.promises.unlink(localFilename)
    } catch {}

    const message = error instanceof Error ? error.message : String(error)
    logger.error('[DLTRACE][Main] session download failed', {
      jobId,
      draftId,
      reqId,
      url,
      error: message
    })
    reply({
      type: 'session-download-response',
      success: false,
      error: message
    })
  } finally {
    clearTimeout(timer)
    if (!completed) {
      activeRequest?.abort()
    }
  }
}

function resolveWorkerScriptPath() {
  const candidates = [
    path.resolve(process.cwd(), 'util/downloadWorker.js'),
    path.resolve(app.getAppPath(), 'util/downloadWorker.js'),
    path.resolve(app.getAppPath(), 'out/util/downloadWorker.js')
  ]
  return candidates.find((filePath) => fs.existsSync(filePath)) || ''
}

function registerLegacyLoginInitChannels() {
  safeHandle('app:register-extended-ipc', async () => ({ success: true }))
  safeHandle('app:initialize-login-services', async () => ({ success: true }))
  safeHandle('app:initialize-agent-services', async () => {
    registerSessionStreamIpc()
    return { success: true }
  })
}

function registerLegacySettingsChannels() {
  safeHandle('get-draft-folder', () => {
    const draftFolder = configManager.get('draftFolder', '') as string
    const isCapcut = configManager.get('isCapcut', true) as boolean
    const apiHost = configManager.get('apiHost', '') as string
    return { draftFolder, isCapcut, apiHost }
  })

  safeHandle('select-draft-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths?.length) return null
    return result.filePaths[0]
  })

  safeOn('save-settings', (_event, settings: any = {}) => {
    const updated: Record<string, any> = {}
    if (typeof settings?.draftFolder === 'string') {
      configManager.set('draftFolder', settings.draftFolder)
      updated.draftFolder = settings.draftFolder
    }
    if (typeof settings?.isCapcut === 'boolean') {
      configManager.set('isCapcut', settings.isCapcut)
      updated.isCapcut = settings.isCapcut
    }
    if (typeof settings?.apiHost === 'string') {
      configManager.set('apiHost', settings.apiHost)
      updated.apiHost = settings.apiHost
    }
    if (typeof settings?.language === 'string' && settings.language.trim()) {
      const normalizedLanguage = settings.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
      configManager.setLanguage(normalizedLanguage)
      updated.language = normalizedLanguage
    }
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('settings-updated', updated)
    })
  })
}

function registerLegacyWindowChannels() {
  safeOn('close-window', () => {
    const win = BrowserWindow.getFocusedWindow() || getMainWindow()
    if (!win || win.isDestroyed()) return
    win.close()
  })

  safeOn('minimize-window', () => {
    const win = BrowserWindow.getFocusedWindow() || getMainWindow()
    if (!win || win.isDestroyed()) return
    win.minimize()
  })

  safeOn('maximize-window', () => {
    const win = BrowserWindow.getFocusedWindow() || getMainWindow()
    if (!win || win.isDestroyed()) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })

  safeOn('resize-main-window', (_event, size: { width: number; height: number }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return
    const width = Number(size?.width || 0)
    const height = Number(size?.height || 0)
    if (width > 0 && height > 0) {
      mainWindow.setSize(width, height)
      mainWindow.center()
    }
  })

  safeOn('window-controls', (_event, action: string) => {
    const win = BrowserWindow.getFocusedWindow() || getMainWindow()
    if (!win) return
    if (action === 'minimize') {
      win.minimize()
    } else if (action === 'maximize') {
      win.isMaximized() ? win.unmaximize() : win.maximize()
    } else if (action === 'close') {
      win.close()
    }
  })

  safeOn('open-settings-window', () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return

    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus()
      return
    }

    settingsWindow = new BrowserWindow({
      width: 840,
      height: 730,
      autoHideMenuBar: true,
      frame: false,
      transparent: isWin ? false : true,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 10 },
      titleBarOverlay: isWin ? false : true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
        additionalArguments: [`--app-version=${app.getVersion()}`, `--version-code=${app.getVersion()}`]
      }
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      void settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?view=settings`)
    } else {
      void settingsWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { search: '?view=settings' })
    }

    settingsWindow.on('closed', () => {
      settingsWindow = null
      const draftFolder = String(configManager.get('draftFolder', '') || '')
      if (!draftFolder && !mainWindow.isDestroyed()) {
        if (process.env['ELECTRON_RENDERER_URL']) {
          void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
        } else {
          void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
        }
        mainWindow.setSize(320, 450, true)
        mainWindow.center()
      }
    })
  })

  safeHandle('restart-beginner-guide', async (_event) => {
    const senderWindow = BrowserWindow.fromWebContents(_event.sender)
    const mainWindow = windowService.createMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { success: false }

    mainWindow.show()
    mainWindow.focus()

    const notifyRenderer = () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('restart-beginner-guide')
      }
    }

    if (mainWindow.webContents.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => {
        const handleReady = () => {
          resolve()
        }

        mainWindow.webContents.once('did-finish-load', handleReady)
        mainWindow.once('closed', handleReady)
      })
    }
    notifyRenderer()

    const targetWindow = senderWindow && !senderWindow.isDestroyed()
      ? senderWindow
      : (settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null)

    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.close()
    }
    return { success: true }
  })
}

function registerLegacyUpdaterChannels() {
  safeOn('check-for-updates', (event) => {
    event.reply('update-message', '请在新版设置页中检查更新')
  })

  safeOn('restart-and-update', () => {
    app.isQuitting = true
    app.quit()
  })
}

function registerLegacyDownloadChannels() {
  safeOn('open-download-directory', async (_event, directoryPath: string) => {
    if (!directoryPath) return
    await shell.openPath(directoryPath)
  })

  safeOn('check-file-existence', (event, payload: { id: string; expectedPath: string }) => {
    const filePath = String(payload?.expectedPath || '')
    if (!filePath) return
    if (fs.existsSync(filePath)) {
      event.reply('file-found', {
        id: payload.id,
        filePath
      })
    }
  })

  safeOn('process-parameters', (event, params: any = {}) => {
    const draftId = String(params?.draft_id || '').trim()
    const jobId = Number(params?.jobId || 0) || Date.now()
    if (!draftId) {
      event.reply('download-error', 'missing draft_id')
      return
    }

    const workerScriptPath = resolveWorkerScriptPath()
    if (!workerScriptPath) {
      event.reply('download-error', 'download worker script not found')
      return
    }

    const worker = new Worker(workerScriptPath, {
      workerData: {
        ...params
      }
    })

    const runtime = {
      worker,
      sender: event.sender,
      draftId,
      stopReason: null,
      lastFileList: [] as any[]
    }
    activeDownloadWorkers.set(jobId, runtime)
    worker.on('message', (message: any) => {
      const activeRuntime = activeDownloadWorkers.get(jobId)
      if (!activeRuntime || activeRuntime.worker !== worker) return

      if (message?.type === 'log') {
        const moduleName = String(message.module || 'LegacyWorker')
        const logMessage = String(message.message || '')
        const meta = Array.isArray(message.meta) ? message.meta : []
        const scopedLogger = loggerService.withContext(moduleName)
        const level = String(message.level || 'info')

        if (level === 'error') scopedLogger.error(logMessage, ...meta)
        else if (level === 'warn') scopedLogger.warn(logMessage, ...meta)
        else if (level === 'debug') scopedLogger.debug(logMessage, ...meta)
        else scopedLogger.info(logMessage, ...meta)
        return
      }

      if (message?.type === 'artist-effect-url-request') {
        const reqId = String(message.reqId || '')
        if (reqId) {
          pendingArtistUrlRequests.set(reqId, worker)
        }
        const mainWindow = getMainWindow()
        if (mainWindow) {
          mainWindow.webContents.send('resolve-artist-effect-url', {
            effectId: message.effectId,
            reqId: message.reqId
          })
        }
        return
      }

      if (message?.type === 'session-download-request') {
        void downloadViaWindowSession(worker, message, draftId, jobId)
        return
      }

      if (message?.type === 'progress') {
        if (Array.isArray(message.fileList)) activeRuntime.lastFileList = message.fileList
        activeRuntime.sender.send('download-progress', {
          jobId,
          progress: Number(message.progress || 0),
          text: String(message.message || ''),
          fileList: message.fileList
        })
        return
      }

      if (message?.type === 'complete') {
        activeDownloadWorkers.delete(jobId)
        logger.info('[DLTRACE][Main] worker complete', {
          jobId,
          draftId,
          message: String(message.message || 'download complete')
        })
        activeRuntime.sender.send('download-complete', {
          jobId,
          draft_id: draftId,
          message: message.message || 'download complete',
          fileList: activeRuntime.lastFileList
        })
        return
      }

      if (message?.type === 'error') {
        activeDownloadWorkers.delete(jobId)
        if (activeRuntime.stopReason) {
          logger.info('[DLTRACE][Main] worker stopped by user action', {
            jobId,
            draftId,
            action: activeRuntime.stopReason
          })
          return
        }
        logger.error('[DLTRACE][Main] worker error', {
          jobId,
          draftId,
          error: String(message.error || 'download failed'),
          message: String(message.message || ''),
          fileListCount: Array.isArray(activeRuntime.lastFileList) ? activeRuntime.lastFileList.length : -1
        })
        activeRuntime.sender.send('download-error', {
          jobId,
          error: String(message.error || 'download failed'),
          fileList: activeRuntime.lastFileList
        })
      }
    })

    worker.on('error', (error) => {
      const activeRuntime = activeDownloadWorkers.get(jobId)
      activeDownloadWorkers.delete(jobId)
      if (activeRuntime?.stopReason) {
        logger.info('[DLTRACE][Main] worker error ignored after user stop', {
          jobId,
          draftId,
          action: activeRuntime.stopReason
        })
        return
      }
      if (error instanceof Error) logger.error('Download worker failed', error)
      else logger.error('Download worker failed', { error: String(error) })
      const message = error instanceof Error ? error.message : String(error)
      event.sender.send('download-error', {
        jobId,
        error: message || 'download worker error'
      })
    })
    worker.on('exit', (code) => {
      const activeRuntime = activeDownloadWorkers.get(jobId)
      activeDownloadWorkers.delete(jobId)
      logger.info('[DLTRACE][Main] worker exit', {
        jobId,
        draftId,
        code
      })

      if (!activeRuntime?.stopReason && code !== 0) {
        logger.error('[DLTRACE][Main] worker exit with non-zero code', {
          jobId,
          draftId,
          code,
          fileListCount: Array.isArray(activeRuntime?.lastFileList) ? activeRuntime.lastFileList.length : -1
        })
        activeRuntime?.sender.send('download-error', {
          jobId,
          error: `download worker exited unexpectedly with code ${code}`,
          fileList: activeRuntime?.lastFileList
        })
      }
    })
  })

  safeHandle('control-download-worker', async (_event, payload: any = {}) => {
    const jobId = Number(payload?.jobId || 0)
    const action = String(payload?.action || 'stop')

    if (!jobId) {
      return { ok: false, error: 'missing jobId' }
    }

    const runtime = activeDownloadWorkers.get(jobId)
    if (!runtime) {
      return { ok: true, alreadyStopped: true, action }
    }

    runtime.stopReason = action
    try {
      const exitCode = await runtime.worker.terminate()
      return { ok: true, action, exitCode }
    } catch (error) {
      logger.error('[DLTRACE][Main] terminate worker failed', {
        jobId,
        action,
        message: error instanceof Error ? error.message : String(error)
      })
      return {
        ok: false,
        action,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  safeOn('resolve-artist-effect-url-response', (_event, payload: any) => {
    const reqId = String(payload?.reqId || '')
    if (!reqId) return
    const worker = pendingArtistUrlRequests.get(reqId)
    pendingArtistUrlRequests.delete(reqId)
    if (!worker) return
    worker.postMessage({
      type: 'artist-effect-url-response',
      reqId,
      url: payload?.url,
      error: payload?.error
    })
  })
}

function registerLegacyAuthChannels() {
  safeOn('open-auth-guard-window', (_event, authUrl: string) => {
    const mainWindow = getMainWindow()
    if (!mainWindow || !authUrl) return

    // Keep legacy behavior: always close previous auth window before opening a new one.
    if (authWindow && !authWindow.isDestroyed()) authWindow.close()
    authWindow = null

    const chromeUA =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    authWindow = new BrowserWindow({
      width: 420,
      height: 550,
      show: false,
      parent: mainWindow,
      modal: false,
      resizable: false,
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        javascript: true
      }
    })

    const closeAuthWindow = () => {
      if (authWindow && !authWindow.isDestroyed()) authWindow.close()
      authWindow = null
    }

    authWindow.webContents.setUserAgent(chromeUA)
    authWindow.webContents.setWindowOpenHandler(() => ({ action: 'allow' }))

    authWindow.webContents.on('will-redirect', (event, url) => {
      try {
        const parsed = new URL(url)
        if (parsed.hostname !== 'localhost' || parsed.pathname !== '/authing-guard-callback') return
        event.preventDefault()
        const code = parsed.searchParams.get('code')
        const error = parsed.searchParams.get('error')
        if (code) mainWindow.webContents.send('guard-auth-code', code)
        if (error) mainWindow.webContents.send('guard-auth-error', error)
        closeAuthWindow()
      } catch (err) {
        logger.warn('Failed to parse auth callback url', err as Error)
      }
    })

    authWindow.on('closed', () => {
      authWindow = null
    })

    void authWindow.loadURL(authUrl, { userAgent: chromeUA })
    authWindow.show()
  })
}

function registerLegacyMiscChannels() {
  safeHandle('upload-logs', async (_event, payload: { url?: string; meta?: Record<string, any>; limitBytes?: number } = {}) => {
    try {
      const targetUrl = String(payload?.url || '').trim()
      if (!targetUrl) {
        return { ok: false, error: 'missing upload url' }
      }

      const logsDir = typeof (loggerService as any).getLogsDir === 'function' ? (loggerService as any).getLogsDir() : ''
      const candidates = fs.existsSync(logsDir)
        ? fs
            .readdirSync(logsDir)
            .filter((name) => name.startsWith('app') && name.endsWith('.log'))
            .map((name) => path.join(logsDir, name))
        : []

      if (candidates.length === 0) {
        return { ok: false, error: 'no log files found' }
      }

      const latest = candidates
        .map((filePath) => ({ filePath, mtime: fs.statSync(filePath).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0]
      if (!latest) {
        return { ok: false, error: 'no log files found' }
      }

      const stat = fs.statSync(latest.filePath)
      const limitBytes = Math.max(1024, Number(payload?.limitBytes || 512 * 1024))
      let content = ''
      if (stat.size > limitBytes) {
        const fd = fs.openSync(latest.filePath, 'r')
        try {
          const buf = Buffer.alloc(limitBytes)
          fs.readSync(fd, buf, 0, limitBytes, stat.size - limitBytes)
          content = buf.toString('utf8')
        } finally {
          fs.closeSync(fd)
        }
      } else {
        content = fs.readFileSync(latest.filePath, 'utf8')
      }

      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta: payload?.meta || {},
          fileName: path.basename(latest.filePath),
          size: stat.size,
          content
        })
      })
      return { ok: res.ok, status: res.status }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  safeHandle('get-translation', (_event, key: string) => key)
  safeOn('log-message', (_event, payload: { level?: string; messages?: unknown[] } = {}) => {
    const level = String(payload.level || 'info')
    const messages = Array.isArray(payload.messages) ? payload.messages : []
    const [firstMessage, ...restMessages] = messages as any[]
    if (firstMessage === undefined) return
    const messageText = firstMessage instanceof Error ? firstMessage.message : String(firstMessage)
    const context = restMessages.length > 0
      ? { payload: firstMessage, extraMessages: restMessages }
      : (firstMessage instanceof Error ? firstMessage : { payload: firstMessage })
    if (level === 'error') logger.error(messageText, context)
    else if (level === 'warn') logger.warn(messageText, context)
    else if (level === 'debug') logger.debug(messageText, context)
    else logger.info(messageText, context)
  })
}

export function registerLegacyMainCompatIpc(): void {
  if (registered) return
  registered = true

  registerLegacyLoginInitChannels()
  registerLegacySettingsChannels()
  registerLegacyWindowChannels()
  registerLegacyUpdaterChannels()
  registerLegacyDownloadChannels()
  registerLegacyAuthChannels()
  registerLegacyMiscChannels()

  // Legacy renderer still sends this event during login; keep it harmless.
  safeOn('login-success', () => undefined)

  // Old flow emits guider-finished and expects it back in renderer.
  safeOn('guider-finished', () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return
    mainWindow.webContents.send('guider-finished')
  })
}
