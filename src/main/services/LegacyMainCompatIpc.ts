import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { Worker } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'

import { configManager } from './ConfigManager'
import { registerSessionStreamIpc } from './agents/services/channels/sessionStreamIpc'
import { windowService } from './WindowService'

const logger = loggerService.withContext('LegacyMainCompatIpc')

let registered = false
let authWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
const pendingArtistUrlRequests = new Map<string, Worker>()

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
    logger.info('[DLTRACE][Main] process-parameters received', {
      draftId,
      draftName: String(params?.draft_name || ''),
      hasScript: Boolean(params?.script),
      scriptMaterialsKeys: Object.keys(params?.script?.materials || {}),
      draftFolder: String(params?.draftFolder || params?.draft_folder || ''),
      hasDraftFolderCamel: Boolean(params?.draftFolder),
      hasDraftFolderSnake: Boolean(params?.draft_folder)
    })
    if (!draftId) {
      event.reply('download-error', 'missing draft_id')
      return
    }

    const workerScriptPath = resolveWorkerScriptPath()
    logger.info('[DLTRACE][Main] worker script resolved', {
      draftId,
      workerScriptPath
    })
    if (!workerScriptPath) {
      event.reply('download-error', 'download worker script not found')
      return
    }

    const worker = new Worker(workerScriptPath, {
      workerData: {
        ...params
      }
    })
    logger.info('[DLTRACE][Main] worker started', {
      draftId,
      hasDraftFolderCamel: Boolean(params?.draftFolder),
      hasDraftFolderSnake: Boolean(params?.draft_folder)
    })

    let lastFileList: unknown[] = []
    worker.on('message', (message: any) => {
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

      if (message?.type === 'progress') {
        logger.debug('[DLTRACE][Main] worker progress', {
          draftId,
          progress: Number(message.progress || 0),
          text: String(message.message || ''),
          fileListCount: Array.isArray(message.fileList) ? message.fileList.length : -1
        })
        if (Array.isArray(message.fileList)) lastFileList = message.fileList
        event.reply('download-progress', {
          progress: Number(message.progress || 0),
          text: String(message.message || ''),
          fileList: message.fileList
        })
        return
      }

      if (message?.type === 'complete') {
        logger.info('[DLTRACE][Main] worker complete', {
          draftId,
          message: String(message.message || 'download complete')
        })
        event.reply('download-complete', {
          draft_id: draftId,
          message: message.message || 'download complete'
        })
        return
      }

      if (message?.type === 'error') {
        logger.error('[DLTRACE][Main] worker error', {
          draftId,
          error: String(message.error || 'download failed'),
          message: String(message.message || ''),
          fileListCount: Array.isArray(lastFileList) ? lastFileList.length : -1
        })
        event.reply('download-error', {
          error: String(message.error || 'download failed'),
          fileList: lastFileList
        })
      }
    })

    worker.on('error', (error) => {
      logger.error('Download worker failed', error)
      const message = error instanceof Error ? error.message : String(error)
      event.reply('download-error', message || 'download worker error')
    })
    worker.on('exit', (code) => {
      logger.info('[DLTRACE][Main] worker exit', {
        draftId,
        code
      })
    })
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

      const logsDir = loggerService.getLogsDir()
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
    if (level === 'error') logger.error(...(messages as any[]))
    else if (level === 'warn') logger.warn(...(messages as any[]))
    else if (level === 'debug') logger.debug(...(messages as any[]))
    else logger.info(...(messages as any[]))
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
