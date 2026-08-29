import fs from 'node:fs'
import { arch } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { loggerService } from '@logger'
import { isLinux, isMac, isPortable, isWin } from '@main/constant'
import anthropicService from '@main/services/AnthropicService'
import { getIpCountry } from '@main/utils/ipService'
import {
  autoDiscoverGitBash,
  crossPlatformSpawn,
  findExecutableInEnv,
  findBundledPython,
  getBinaryPath,
  getGitBashPathInfo,
  isBinaryExists,
  runInstallScript,
  validateGitBashPath
} from '@main/utils/process'
import { handleZoomFactor } from '@main/utils/zoom'
import type { SpanEntity, TokenUsage } from '@mcp-trace/trace-core'
import type { UpgradeChannel } from '@shared/config/constant'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@shared/config/constant'
import type { LocalTransferConnectPayload } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { normalizeWebviewRuntimeEnv } from '@shared/webview/runtimeEnv'
import { extractPdfText } from '@shared/utils/pdf'
import type {
  AgentPersistedMessage,
  FileMetadata,
  Notification,
  OcrProvider,
  Provider,
  Shortcut,
  SupportedOcrFile,
  ThemeMode
} from '@types'
import checkDiskSpace from 'check-disk-space'
import Store from 'electron-store'
import type { ProxyConfig } from 'electron'
import { app, BrowserWindow, dialog, ipcMain, screen, session, shell, systemPreferences, webContents } from 'electron'
import fontList from 'font-list'
import ImageGenerateServer from './mcpServers/image-generate'
import VideoGenerateServer from './mcpServers/video-generate'

import { agentMessageRepository } from './services/agents/database'
import { skillService } from './services/agents/skills/SkillService'
import { apiServerService } from './services/ApiServerService'
import appService from './services/AppService'
import AppUpdater from './services/AppUpdater'
import BackupManager from './services/BackupManager'
import { browserPreviewService } from './services/BrowserPreviewService'
import CherryINOAuthService from './services/CherryINOAuthService'
import { codeToolsService } from './services/CodeToolsService'
import { ConfigKeys, configManager } from './services/ConfigManager'
import CopilotService from './services/CopilotService'
import DxtService from './services/DxtService'
import { ExportService } from './services/ExportService'
import { externalAppsService } from './services/ExternalAppsService'
import { feedbackMailService } from './services/FeedbackMailService'
import { fileStorage as fileManager } from './services/FileStorage'
import FileService from './services/FileSystemService'
import { lanTransferClientService } from './services/lanTransfer'
import { localTransferService } from './services/LocalTransferService'
import mcpService from './services/MCPService'
import { openTraceWindow, setTraceWindowTitle } from './services/NodeTraceService'
import NotificationService from './services/NotificationService'
import * as NutstoreService from './services/NutstoreService'
import ObsidianVaultService from './services/ObsidianVaultService'
import { ocrService } from './services/ocr/OcrService'
import { openClawService } from './services/OpenClawService'
import { isOvmsSupported } from './services/OvmsManager'
import powerMonitorService from './services/PowerMonitorService'
import { proxyManager } from './services/ProxyManager'
import { pythonService } from './services/PythonService'
import { FileServiceManager } from './services/remotefile/FileServiceManager'
import { searchService } from './services/SearchService'
import { isSafeExternalUrl } from './services/security'
import { SelectionService } from './services/SelectionService'
import { registerShortcuts, unregisterAllShortcuts } from './services/ShortcutService'
import { loggerService as mainLoggerService } from './services/LoggerService'
import { agentRuntimeAuthService } from './services/agents/services/AgentRuntimeAuthService'
import { seedWorkspaceTemplates } from './services/agents/services/cherryclaw/seedWorkspace'
import {
  addEndMessage,
  addStreamMessage,
  bindTopic,
  cleanHistoryTrace,
  cleanLocalData,
  cleanTopic,
  getEntity,
  getSpans,
  saveEntity,
  saveSpans,
  tokenUsage
} from './services/SpanCacheService'
import storeSyncService from './services/StoreSyncService'
import { themeService } from './services/ThemeService'
import VertexAIService from './services/VertexAIService'
import { setOpenLinkExternal } from './services/WebviewService'
import { windowService } from './services/WindowService'
import { calculateDirectorySize, getDataPath, getResourcePath } from './utils'
import { decrypt, encrypt } from './utils/aes'
import {
  getCacheDir,
  getConfigDir,
  getFilesDir,
  getNotesDir,
  hasWritePermission,
  isPathInside,
  untildify
} from './utils/file'
import { updateAppDataConfig } from './utils/init'
import { getCpuName, getDeviceType, getHostname } from './utils/system'
import { compress, decompress } from './utils/zip'
import { installBuiltinSkills } from './utils/builtinSkills'

const logger = loggerService.withContext('IPC')
const imageGenerateServer = new ImageGenerateServer()
const videoGenerateServer = new VideoGenerateServer()

void app.whenReady().then(async () => {
  try {
    await imageGenerateServer.getImageModelList()
  } catch (error) {
    logger.warn('Failed to preload image generation capabilities for IPC bridge', error as Error)
  }

  try {
    await videoGenerateServer.getVideoModelList()
  } catch (error) {
    logger.warn('Failed to preload video generation capabilities for IPC bridge', error as Error)
  }
})

type SkillWatcherEntry = {
  watcher: fs.FSWatcher
  refCount: number
  skillsRoot: string
  notifyTimer?: NodeJS.Timeout
}

const SKILL_WATCH_DEBOUNCE_MS = 150
const skillWatcherEntries = new Map<string, SkillWatcherEntry>()
const vectcutStore = new Store({ name: 'vectcut' })

function getCachedVectcutApiKey(): string {
  return String(
    vectcutStore.get('auth.vectcut_api_key') || process.env.VECTCUT_API_KEY || process.env.VECTCUT_APIKEY || ''
  ).trim()
}

async function resolveCurrentVectcutApiKey(): Promise<string> {
  try {
    const accessToken = await agentRuntimeAuthService.ensureValidAccessToken()
    if (typeof accessToken === 'string' && accessToken.trim()) {
      return accessToken.trim()
    }
  } catch (error) {
    logger.warn('Failed to refresh vectcut api key for skill example run, falling back to cached key', {
      error: error instanceof Error ? error.message : String(error)
    })
  }

  const cachedToken = getCachedVectcutApiKey()
  if (cachedToken) {
    return cachedToken
  }
  throw new Error('未获取到当前 API Key，请先登录或配置 VECTCUT_API_KEY')
}

async function resolveSkillExamplePythonRuntime(): Promise<{ command: string; argsPrefix: string[] }> {
  if (process.platform === 'win32') {
    const bundledPythonPath = findBundledPython()
    if (bundledPythonPath) {
      return { command: bundledPythonPath, argsPrefix: [] }
    }

    logger.warn('Bundled Python runtime not found for skill example, falling back to system Python lookup')
  }

  const candidates = process.platform === 'win32'
    ? [
        { commandName: 'python', argsPrefix: [] as string[] },
        { commandName: 'py', argsPrefix: ['-3'] }
      ]
    : [
        { commandName: 'python3', argsPrefix: [] as string[] },
        { commandName: 'python', argsPrefix: [] as string[] }
      ]

  for (const candidate of candidates) {
    const resolvedCommand = await findExecutableInEnv(candidate.commandName)
    if (resolvedCommand) {
      return {
        command: resolvedCommand,
        argsPrefix: candidate.argsPrefix
      }
    }
  }

  throw new Error('未找到可用的 Python 3 解释器，请先安装 Python，并确保 `python` 或 `py` 命令可用')
}

async function runSkillExampleScript(skillPath: string): Promise<{ stdout: string; stderr: string }> {
  const resolvedSkillPath = path.resolve(String(skillPath || ''))
  if (!resolvedSkillPath) {
    throw new Error('无效的技能路径')
  }

  const examplePath = path.join(resolvedSkillPath, 'examples', 'main.py')
  await fs.promises.access(examplePath, fs.constants.R_OK)

  const vectcutApiKey = await resolveCurrentVectcutApiKey()
  const { command, argsPrefix } = await resolveSkillExamplePythonRuntime()
  const commandArgs = [...argsPrefix, 'main.py']
  const cwd = path.dirname(examplePath)

  logger.info('Running skill example script', {
    skillPath: resolvedSkillPath,
    examplePath,
    cwd,
    command,
    commandArgs,
    hasVectcutApiKey: Boolean(vectcutApiKey)
  })

  return await new Promise((resolve, reject) => {
    const child = crossPlatformSpawn(command, commandArgs, {
      cwd,
      env: {
        ...process.env,
        VECTCUT_API_KEY: vectcutApiKey
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(new Error('执行示例超时，请稍后重试'))
    }, 5 * 60 * 1000)

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      logger.info('Skill example stdout', {
        skillPath: resolvedSkillPath,
        chunk: text.trim().slice(0, 2000)
      })
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      logger.warn('Skill example stderr', {
        skillPath: resolvedSkillPath,
        chunk: text.trim().slice(0, 2000)
      })
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      logger.error('Skill example process error', {
        skillPath: resolvedSkillPath,
        error: error instanceof Error ? error.message : String(error)
      })
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      logger.info('Skill example process closed', {
        skillPath: resolvedSkillPath,
        exitCode: code,
        stdoutLength: stdout.length,
        stderrLength: stderr.length
      })
      if (code === 0) {
        const result = { stdout: stdout.trim(), stderr: stderr.trim() }
        logger.info('Skill example finished successfully', {
          skillPath: resolvedSkillPath,
          stdoutPreview: result.stdout.slice(0, 1000),
          stderrPreview: result.stderr.slice(0, 1000)
        })
        resolve(result)
        return
      }
      reject(new Error((stderr || stdout || `示例执行失败，退出码 ${code}`).trim()))
    })
  })
}

function broadcastSkillChanged(agentId: string, payload: { filename?: string; eventType?: string; skillsRoot?: string } = {}): void {
  const currentMainWindow = windowService.getMainWindow()
  if (!currentMainWindow || currentMainWindow.isDestroyed()) return
  currentMainWindow.webContents.send(IpcChannel.Skill_Changed, { agentId, ...payload })
}

async function ensureSkillWatcher(agentId: string): Promise<string> {
  const existing = skillWatcherEntries.get(agentId)
  if (existing) {
    existing.refCount += 1
    return existing.skillsRoot
  }

  const skillsRoot = await skillService.getAgentSkillsRoot(agentId)
  await fs.promises.mkdir(skillsRoot, { recursive: true })

  const recursive = isMac || isWin
  const watcher = fs.watch(
    skillsRoot,
    { recursive },
    (eventType, filename) => {
      const entry = skillWatcherEntries.get(agentId)
      if (!entry) return

      if (entry.notifyTimer) {
        clearTimeout(entry.notifyTimer)
      }

      entry.notifyTimer = setTimeout(() => {
        const normalizedFilename = filename == null ? undefined : String(filename)
        broadcastSkillChanged(agentId, {
          eventType,
          filename: normalizedFilename,
          skillsRoot: entry.skillsRoot
        })
      }, SKILL_WATCH_DEBOUNCE_MS)
    }
  )

  watcher.on('error', (error) => {
    logger.warn('Skill watcher error', {
      agentId,
      skillsRoot,
      error: error instanceof Error ? error.message : String(error)
    })
  })

  skillWatcherEntries.set(agentId, {
    watcher,
    refCount: 1,
    skillsRoot
  })

  return skillsRoot
}

function releaseSkillWatcher(agentId: string): void {
  const entry = skillWatcherEntries.get(agentId)
  if (!entry) return

  entry.refCount -= 1
  if (entry.refCount > 0) return

  if (entry.notifyTimer) {
    clearTimeout(entry.notifyTimer)
  }
  entry.watcher.close()
  skillWatcherEntries.delete(agentId)
}

const backupManager = new BackupManager()
const exportService = new ExportService()
const obsidianVaultService = new ObsidianVaultService()
const vertexAIService = VertexAIService.getInstance()
const dxtService = new DxtService()
let internalWebsiteWindow: BrowserWindow | null = null

export async function registerIpc(mainWindow: BrowserWindow, app: Electron.App) {
  const appUpdater = new AppUpdater()
  const notificationService = new NotificationService()

  // Register shutdown handlers
  powerMonitorService.registerShutdownHandler(() => {
    appUpdater.setAutoUpdate(false)
  })

  powerMonitorService.registerShutdownHandler(() => {
    const mw = windowService.getMainWindow()
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send(IpcChannel.App_SaveData)
    }
  })

  const checkMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Main window does not exist or has been destroyed')
    }
  }

  ipcMain.handle(IpcChannel.App_Info, () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    filesPath: getFilesDir(),
    notesPath: getNotesDir(),
    configPath: getConfigDir(),
    appDataPath: app.getPath('userData'),
    resourcesPath: getResourcePath(),
    logsPath: mainLoggerService.getLogsDir(),
    arch: arch(),
    isPortable: isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env,
    installPath: path.dirname(app.getPath('exe'))
  }))

  ipcMain.handle(IpcChannel.App_GetVectcutApiKey, async () => resolveCurrentVectcutApiKey())

  ipcMain.handle(
    IpcChannel.App_SendFeedbackEmail,
    async (
      _,
      payload: {
        message: string
        version: string
        platform: string
        logsPath: string
        user?: { id?: string; name?: string; email?: string }
        attachments?: Array<{ filename: string; mimeType?: string; contentBase64: string }>
      }
    ) => {
      await feedbackMailService.sendFeedbackMail(payload)
      return { success: true }
    }
  )

  ipcMain.handle(IpcChannel.App_Proxy, async (_, proxy: string, bypassRules?: string) => {
    let proxyConfig: ProxyConfig

    if (proxy === 'system') {
      // system proxy will use the system filter by themselves
      proxyConfig = { mode: 'system' }
    } else if (proxy) {
      proxyConfig = { mode: 'fixed_servers', proxyRules: proxy, proxyBypassRules: bypassRules }
    } else {
      proxyConfig = { mode: 'direct' }
    }

    await proxyManager.configureProxy(proxyConfig)
  })

  ipcMain.handle(IpcChannel.App_Reload, () => mainWindow.reload())
  ipcMain.handle(IpcChannel.App_Quit, () => app.quit())
  ipcMain.handle(IpcChannel.Open_Website, (_, url: string) => {
    if (!isSafeExternalUrl(url)) {
      logger.warn(`Blocked shell.openExternal for untrusted URL scheme: ${url}`)
      return
    }
    return shell.openExternal(url)
  })
  ipcMain.handle(IpcChannel.Open_LocalHtmlInBrowser, async (_, url: string) => {
    let filePath = ''
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'file:') {
        logger.warn(`Blocked non-file URL for local html browser open: ${url}`)
        return
      }
      filePath = fileURLToPath(parsed)
    } catch {
      logger.warn(`Blocked invalid file URL for local html browser open: ${url}`)
      return
    }

    const extension = path.extname(filePath).toLowerCase()
    if (!['.html', '.htm'].includes(extension)) {
      logger.warn(`Blocked non-html file for browser open: ${filePath}`)
      return
    }

    if (!fs.existsSync(filePath)) {
      logger.warn(`Blocked missing html file for browser open: ${filePath}`)
      return
    }

    return shell.openExternal(pathToFileURL(filePath).toString())
  })
  ipcMain.on(IpcChannel.Payment_NotifySuccess, (event, payload: Record<string, unknown> = {}) => {
    if (!internalWebsiteWindow || internalWebsiteWindow.isDestroyed()) {
      return
    }

    if (event.sender.id !== internalWebsiteWindow.webContents.id) {
      logger.warn('Blocked payment success notification from unexpected sender')
      return
    }

    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannel.Payment_Success, payload)
    }

    internalWebsiteWindow.close()
  })
  ipcMain.handle(IpcChannel.Open_InternalWebsite, async (_, url: string) => {
    if (!isSafeExternalUrl(url)) {
      logger.warn(`Blocked internal website window for untrusted URL scheme: ${url}`)
      return
    }

    if (internalWebsiteWindow && !internalWebsiteWindow.isDestroyed()) {
      await internalWebsiteWindow.loadURL(url)
      internalWebsiteWindow.show()
      internalWebsiteWindow.focus()
      return
    }

    const { workAreaSize } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

    internalWebsiteWindow = new BrowserWindow({
      width: workAreaSize.width,
      height: workAreaSize.height,
      minWidth: workAreaSize.width,
      minHeight: workAreaSize.height,
      show: false,
      parent: mainWindow,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, '../preload/payment.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    })

    internalWebsiteWindow.on('closed', () => {
      internalWebsiteWindow = null
    })

    internalWebsiteWindow.once('ready-to-show', () => {
      internalWebsiteWindow?.show()
      internalWebsiteWindow?.focus()
    })

    internalWebsiteWindow.webContents.on('did-finish-load', () => {
      void internalWebsiteWindow?.webContents
        .executeJavaScript(
          `(() => {
            if (window.__VECTCUT_INTERNAL_CLOSE_GUARD__) return;
            const blockedClose = () => undefined;
            try {
              Object.defineProperty(window, 'close', {
                configurable: true,
                value: blockedClose
              });
            } catch {}
            try {
              Object.defineProperty(Window.prototype, 'close', {
                configurable: true,
                value: blockedClose
              });
            } catch {}
            window.__VECTCUT_INTERNAL_CLOSE_GUARD__ = true;
          })();`,
          true
        )
        .catch((error) => {
          logger.warn('Failed to install internal payment close guard.', error)
        })
    })

    internalWebsiteWindow.webContents.on('will-navigate', (event, nextUrl) => {
      if (isSafeExternalUrl(nextUrl)) return
      event.preventDefault()
      logger.warn(`Blocked internal website navigation for untrusted URL scheme: ${nextUrl}`)
    })

    internalWebsiteWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
      if (!isSafeExternalUrl(nextUrl)) {
        logger.warn(`Blocked internal website popup for untrusted URL scheme: ${nextUrl}`)
        return { action: 'deny' }
      }

      void internalWebsiteWindow?.loadURL(nextUrl)
      return { action: 'deny' }
    })
    await internalWebsiteWindow.loadURL(url)
  })

  // Update
  ipcMain.handle(IpcChannel.App_QuitAndInstall, () => appUpdater.quitAndInstall())

  // language
  ipcMain.handle(IpcChannel.App_SetLanguage, (_, language) => {
    configManager.setLanguage(language)
  })

  // spell check
  ipcMain.handle(IpcChannel.App_SetEnableSpellCheck, (_, isEnable: boolean) => {
    // disable spell check for all webviews
    const webviews = webContents.getAllWebContents()
    webviews.forEach((webview) => {
      webview.session.setSpellCheckerEnabled(isEnable)
    })
  })

  // spell check languages
  ipcMain.handle(IpcChannel.App_SetSpellCheckLanguages, (_, languages: string[]) => {
    if (languages.length === 0) {
      return
    }
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((window) => {
      window.webContents.session.setSpellCheckerLanguages(languages)
    })
    configManager.set('spellCheckLanguages', languages)
  })

  // launch on boot
  ipcMain.handle(IpcChannel.App_SetLaunchOnBoot, async (_, isLaunchOnBoot: boolean) => {
    await appService.setAppLaunchOnBoot(isLaunchOnBoot)
  })

  // launch to tray
  ipcMain.handle(IpcChannel.App_SetLaunchToTray, (_, isActive: boolean) => {
    configManager.setLaunchToTray(isActive)
  })

  // tray
  ipcMain.handle(IpcChannel.App_SetTray, (_, isActive: boolean) => {
    configManager.setTray(isActive)
  })

  // to tray on close
  ipcMain.handle(IpcChannel.App_SetTrayOnClose, (_, isActive: boolean) => {
    configManager.setTrayOnClose(isActive)
  })

  // auto update
  ipcMain.handle(IpcChannel.App_SetAutoUpdate, (_, isActive: boolean) => {
    appUpdater.setAutoUpdate(isActive)
    configManager.setAutoUpdate(isActive)
  })

  ipcMain.handle(IpcChannel.App_SetTestPlan, async (_, isActive: boolean) => {
    logger.info(`set test plan: ${isActive}`)
    if (isActive !== configManager.getTestPlan()) {
      appUpdater.cancelDownload()
      configManager.setTestPlan(isActive)
    }
  })

  ipcMain.handle(IpcChannel.App_SetTestChannel, async (_, channel: UpgradeChannel) => {
    logger.info(`set test channel: ${channel}`)
    if (channel !== configManager.getTestChannel()) {
      appUpdater.cancelDownload()
      configManager.setTestChannel(channel)
    }
  })

  ipcMain.handle(IpcChannel.AgentMessage_PersistExchange, async (_event, payload) => {
    try {
      return await agentMessageRepository.persistExchange(payload)
    } catch (error) {
      logger.error('Failed to persist agent session messages', error as Error)
      throw error
    }
  })

  ipcMain.handle(
    IpcChannel.AgentMessage_GetHistory,
    async (_event, { sessionId }: { sessionId: string }): Promise<AgentPersistedMessage[]> => {
      try {
        return await agentMessageRepository.getSessionHistory(sessionId)
      } catch (error) {
        logger.error('Failed to get agent session history', error as Error)
        throw error
      }
    }
  )

  //only for mac
  if (isMac) {
    ipcMain.handle(IpcChannel.App_MacIsProcessTrusted, (): boolean => {
      return systemPreferences.isTrustedAccessibilityClient(false)
    })

    //return is only the current state, not the new state
    ipcMain.handle(IpcChannel.App_MacRequestProcessTrust, (): boolean => {
      return systemPreferences.isTrustedAccessibilityClient(true)
    })
  }

  ipcMain.handle(IpcChannel.App_SetFullScreen, (_, value: boolean): void => {
    mainWindow.setFullScreen(value)
  })

  ipcMain.handle(IpcChannel.App_IsFullScreen, (): boolean => {
    return mainWindow.isFullScreen()
  })

  // Get System Fonts
  ipcMain.handle(IpcChannel.App_GetSystemFonts, async () => {
    try {
      const fonts = await fontList.getFonts()
      return fonts.map((font: string) => font.replace(/^"(.*)"$/, '$1')).filter((font: string) => font.length > 0)
    } catch (error) {
      logger.error('Failed to get system fonts:', error as Error)
      return []
    }
  })

  // Get IP Country
  ipcMain.handle(IpcChannel.App_GetIpCountry, async () => {
    return getIpCountry()
  })

  ipcMain.handle(IpcChannel.Config_Set, (_, key: string, value: any, isNotify: boolean = false) => {
    configManager.set(key, value, isNotify)
  })

  ipcMain.handle(IpcChannel.Config_Get, (_, key: string) => {
    return configManager.get(key)
  })

  // theme
  ipcMain.handle(IpcChannel.App_SetTheme, (_, theme: ThemeMode) => {
    themeService.setTheme(theme)
  })

  ipcMain.handle(IpcChannel.App_HandleZoomFactor, (_, delta: number, reset: boolean = false) => {
    const windows = BrowserWindow.getAllWindows()
    handleZoomFactor(windows, delta, reset)
    return configManager.getZoomFactor()
  })

  ipcMain.handle(IpcChannel.App_BootstrapBuiltinSkills, async () => {
    await installBuiltinSkills({ distributeToAgents: true })
    return { success: true }
  })

  // clear cache
  ipcMain.handle(IpcChannel.App_ClearCache, async () => {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]

    try {
      await Promise.all(
        sessions.map(async (session) => {
          await session.clearCache()
          await session.clearStorageData({
            storages: ['cookies', 'filesystem', 'shadercache', 'websql', 'serviceworkers', 'cachestorage']
          })
        })
      )
      await fileManager.clearTemp()
      // do not clear logs for now
      // TODO clear logs
      // await fs.writeFileSync(log.transports.file.getFile().path, '')
      return { success: true }
    } catch (error: any) {
      logger.error('Failed to clear cache:', error)
      return { success: false, error: error.message }
    }
  })

  // get cache size
  ipcMain.handle(IpcChannel.App_GetCacheSize, async () => {
    const cachePath = getCacheDir()
    logger.info(`Calculating cache size for path: ${cachePath}`)

    try {
      const sizeInBytes = await calculateDirectorySize(cachePath)
      const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2)
      return `${sizeInMB}`
    } catch (error: any) {
      logger.error(`Failed to calculate cache size for ${cachePath}: ${error.message}`)
      return '0'
    }
  })

  let preventQuitListener: ((event: Electron.Event) => void) | null = null
  ipcMain.handle(IpcChannel.App_SetStopQuitApp, (_, stop: boolean = false, reason: string = '') => {
    if (stop) {
      // Only add listener if not already added
      if (!preventQuitListener) {
        preventQuitListener = (event: Electron.Event) => {
          event.preventDefault()
          void notificationService.sendNotification({
            title: reason,
            message: reason
          } as Notification)
        }
        app.on('before-quit', preventQuitListener)
      }
    } else {
      // Remove listener if it exists
      if (preventQuitListener) {
        app.removeListener('before-quit', preventQuitListener)
        preventQuitListener = null
      }
    }
  })

  // Select app data path
  ipcMain.handle(IpcChannel.App_Select, async (_, options: Electron.OpenDialogOptions) => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(options)
      if (canceled || filePaths.length === 0) {
        return null
      }
      return filePaths[0]
    } catch (error: any) {
      logger.error('Failed to select app data path:', error)
      return null
    }
  })

  ipcMain.handle(IpcChannel.App_HasWritePermission, async (_, filePath: string) => {
    const hasPermission = await hasWritePermission(filePath)
    return hasPermission
  })

  ipcMain.handle(IpcChannel.App_ResolvePath, async (_, filePath: string) => {
    return path.resolve(untildify(filePath))
  })

  // Check if a path is inside another path (proper parent-child relationship)
  ipcMain.handle(IpcChannel.App_IsPathInside, async (_, childPath: string, parentPath: string) => {
    return isPathInside(childPath, parentPath)
  })

  // Set app data path
  ipcMain.handle(IpcChannel.App_SetAppDataPath, async (_, filePath: string) => {
    updateAppDataConfig(filePath)
    app.setPath('userData', filePath)
  })

  ipcMain.handle(IpcChannel.App_GetDataPathFromArgs, () => {
    return process.argv
      .slice(1)
      .find((arg) => arg.startsWith('--new-data-path='))
      ?.split('--new-data-path=')[1]
  })

  ipcMain.handle(IpcChannel.App_FlushAppData, async () => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.session.flushStorageData()
      await w.webContents.session.cookies.flushStore()
      await w.webContents.session.closeAllConnections()
    }

    session.defaultSession.flushStorageData()
    await session.defaultSession.cookies.flushStore()
    await session.defaultSession.closeAllConnections()
  })

  ipcMain.handle(IpcChannel.App_IsNotEmptyDir, async (_, path: string) => {
    return fs.readdirSync(path).length > 0
  })

  // Copy user data to new location
  ipcMain.handle(IpcChannel.App_Copy, async (_, oldPath: string, newPath: string, occupiedDirs: string[] = []) => {
    try {
      await fs.promises.cp(oldPath, newPath, {
        recursive: true,
        filter: (src) => {
          if (occupiedDirs.some((dir) => src.startsWith(path.resolve(dir)))) {
            return false
          }
          return true
        }
      })
      return { success: true }
    } catch (error: any) {
      logger.error('Failed to copy user data:', error)
      return { success: false, error: error.message }
    }
  })

  // Relaunch app
  ipcMain.handle(IpcChannel.App_RelaunchApp, (_, options?: Electron.RelaunchOptions) => {
    // Fix for .AppImage
    if (isLinux && process.env.APPIMAGE) {
      logger.info(`Relaunching app with options: ${process.env.APPIMAGE}`, options)
      // On Linux, we need to use the APPIMAGE environment variable to relaunch
      // https://github.com/electron-userland/electron-builder/issues/1727#issuecomment-769896927
      options = options || {}
      options.execPath = process.env.APPIMAGE
      options.args = options.args || []
      options.args.unshift('--appimage-extract-and-run')
    }

    if (isWin && isPortable) {
      options = options || {}
      options.execPath = process.env.PORTABLE_EXECUTABLE_FILE
      options.args = options.args || []
    }

    app.relaunch(options)
    app.exit(0)
  })

  // Reset all data (factory reset)
  ipcMain.handle(IpcChannel.App_ResetData, () => backupManager.resetData())

  // check for update
  ipcMain.handle(IpcChannel.App_CheckForUpdate, async () => {
    return await appUpdater.checkForUpdates()
  })

  // notification
  ipcMain.handle(IpcChannel.Notification_Send, async (_, notification: Notification) => {
    await notificationService.sendNotification(notification)
  })
  ipcMain.handle(IpcChannel.Notification_OnClick, (_, notification: Notification) => {
    mainWindow.webContents.send('notification-click', notification)
  })

  // zip
  ipcMain.handle(IpcChannel.Zip_Compress, (_, text: string) => compress(text))
  ipcMain.handle(IpcChannel.Zip_Decompress, (_, text: Buffer) => decompress(text))

  // system
  ipcMain.handle(IpcChannel.System_GetDeviceType, getDeviceType)
  ipcMain.handle(IpcChannel.System_GetHostname, getHostname)
  ipcMain.handle(IpcChannel.System_GetCpuName, getCpuName)
  ipcMain.handle(IpcChannel.System_CheckGitBash, () => {
    if (!isWin) {
      return true // Non-Windows systems don't need Git Bash
    }

    try {
      // Use autoDiscoverGitBash to handle auto-discovery and persistence
      const bashPath = autoDiscoverGitBash()
      if (bashPath) {
        logger.info('Git Bash is available', { path: bashPath })
        return true
      }

      logger.warn('Git Bash not found. Please install Git for Windows from https://git-scm.com/downloads/win')
      return false
    } catch (error) {
      logger.error('Unexpected error checking Git Bash', error as Error)
      return false
    }
  })

  ipcMain.handle(IpcChannel.System_GetGitBashPath, () => {
    if (!isWin) {
      return null
    }

    const customPath = configManager.get(ConfigKeys.GitBashPath) as string | undefined
    return customPath ?? null
  })

  // Returns { path, source } where source is 'manual' | 'auto' | null
  ipcMain.handle(IpcChannel.System_GetGitBashPathInfo, () => {
    return getGitBashPathInfo()
  })

  ipcMain.handle(IpcChannel.System_SetGitBashPath, (_, newPath: string | null) => {
    if (!isWin) {
      return false
    }

    if (!newPath) {
      // Clear manual setting and re-run auto-discovery
      configManager.set(ConfigKeys.GitBashPath, null)
      configManager.set(ConfigKeys.GitBashPathSource, null)
      // Re-run auto-discovery to restore auto-discovered path if available
      autoDiscoverGitBash()
      return true
    }

    const validated = validateGitBashPath(newPath)
    if (!validated) {
      return false
    }

    // Set path with 'manual' source
    configManager.set(ConfigKeys.GitBashPath, validated)
    configManager.set(ConfigKeys.GitBashPathSource, 'manual')
    return true
  })

  ipcMain.handle(IpcChannel.System_ToggleDevTools, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    win && win.webContents.toggleDevTools()
  })

  // backup
  ipcMain.handle(IpcChannel.Backup_Backup, backupManager.backup.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_Restore, backupManager.restore.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_BackupToWebdav, backupManager.backupToWebdav.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_RestoreFromWebdav, backupManager.restoreFromWebdav.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_ListWebdavFiles, backupManager.listWebdavFiles.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_CheckConnection, backupManager.checkConnection.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_CreateDirectory, backupManager.createDirectory.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_DeleteWebdavFile, backupManager.deleteWebdavFile.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_BackupToLocalDir, backupManager.backupToLocalDir.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_RestoreFromLocalBackup, backupManager.restoreFromLocalBackup.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_ListLocalBackupFiles, backupManager.listLocalBackupFiles.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_DeleteLocalBackupFile, backupManager.deleteLocalBackupFile.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_BackupToS3, backupManager.backupToS3.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_RestoreFromS3, backupManager.restoreFromS3.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_ListS3Files, backupManager.listS3Files.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_DeleteS3File, backupManager.deleteS3File.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_CheckS3Connection, backupManager.checkS3Connection.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_CreateLanTransferBackup, backupManager.createLanTransferBackup.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_DeleteLanTransferBackup, backupManager.deleteLanTransferBackup.bind(backupManager))

  // file
  ipcMain.handle(IpcChannel.File_Open, fileManager.open.bind(fileManager))
  ipcMain.handle(IpcChannel.File_OpenPath, fileManager.openPath.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Save, fileManager.save.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Select, fileManager.selectFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Upload, fileManager.uploadFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Clear, fileManager.clear.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Read, fileManager.readFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ReadExternal, fileManager.readExternalFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Delete, fileManager.deleteFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_DeleteDir, fileManager.deleteDir.bind(fileManager))
  ipcMain.handle(IpcChannel.File_DeleteExternalFile, fileManager.deleteExternalFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_DeleteExternalDir, fileManager.deleteExternalDir.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Move, fileManager.moveFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_MoveDir, fileManager.moveDir.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Rename, fileManager.renameFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_RenameDir, fileManager.renameDir.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Get, fileManager.getFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SelectFolder, fileManager.selectFolder.bind(fileManager))
  ipcMain.handle(IpcChannel.File_CreateTempFile, fileManager.createTempFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Mkdir, fileManager.mkdir.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Write, fileManager.writeFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_WriteWithId, fileManager.writeFileWithId.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SaveImage, fileManager.saveImage.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Base64Image, fileManager.base64Image.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SaveBase64Image, fileManager.saveBase64Image.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SavePastedImage, fileManager.savePastedImage.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Base64File, fileManager.base64File.bind(fileManager))
  ipcMain.handle(IpcChannel.File_GetPdfInfo, fileManager.pdfPageCount.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Download, fileManager.downloadFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Copy, fileManager.copyFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_BinaryImage, fileManager.binaryImage.bind(fileManager))
  ipcMain.handle(IpcChannel.File_OpenWithRelativePath, fileManager.openFileWithRelativePath.bind(fileManager))
  ipcMain.handle(IpcChannel.File_IsTextFile, fileManager.isTextFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_IsDirectory, fileManager.isDirectory.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ListDirectory, fileManager.listDirectory.bind(fileManager))
  ipcMain.handle(IpcChannel.File_GetDirectoryStructure, fileManager.getDirectoryStructure.bind(fileManager))
  ipcMain.handle(IpcChannel.File_CheckFileName, fileManager.fileNameGuard.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ValidateNotesDirectory, fileManager.validateNotesDirectory.bind(fileManager))
  ipcMain.handle(IpcChannel.File_StartWatcher, fileManager.startFileWatcher.bind(fileManager))
  ipcMain.handle(IpcChannel.File_StopWatcher, fileManager.stopFileWatcher.bind(fileManager))
  ipcMain.handle(IpcChannel.Image_GetModelList, async () => imageGenerateServer.getImageModelList())
  ipcMain.handle(IpcChannel.Image_GetCapabilities, async (_, filters = {}) => imageGenerateServer.listImageCapabilities(filters))
  ipcMain.handle(IpcChannel.Video_GetModelList, async () => videoGenerateServer.getVideoModelList())
  ipcMain.handle(IpcChannel.Video_GetCapabilities, async (_, filters = {}) => videoGenerateServer.listVideoCapabilities(filters))
  ipcMain.handle(IpcChannel.File_PauseWatcher, fileManager.pauseFileWatcher.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ResumeWatcher, fileManager.resumeFileWatcher.bind(fileManager))
  ipcMain.handle(IpcChannel.File_BatchUploadMarkdown, fileManager.batchUploadMarkdownFiles.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ShowInFolder, fileManager.showInFolder.bind(fileManager))

  // pdf
  ipcMain.handle(IpcChannel.Pdf_ExtractText, (_, data: Uint8Array | ArrayBuffer | string) => extractPdfText(data))

  // file service
  ipcMain.handle(IpcChannel.FileService_Upload, async (_, provider: Provider, file: FileMetadata) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.uploadFile(file)
  })

  ipcMain.handle(IpcChannel.FileService_List, async (_, provider: Provider) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.listFiles()
  })

  ipcMain.handle(IpcChannel.FileService_Delete, async (_, provider: Provider, fileId: string) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.deleteFile(fileId)
  })

  ipcMain.handle(IpcChannel.FileService_Retrieve, async (_, provider: Provider, fileId: string) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.retrieveFile(fileId)
  })

  // fs
  ipcMain.handle(IpcChannel.Fs_Read, FileService.readFile.bind(FileService))
  ipcMain.handle(IpcChannel.Fs_ReadText, FileService.readTextFileWithAutoEncoding.bind(FileService))

  // export
  ipcMain.handle(IpcChannel.Export_Word, exportService.exportToWord.bind(exportService))

  // open path
  ipcMain.handle(IpcChannel.Open_Path, async (_, path: string) => {
    await shell.openPath(path)
  })

  // shortcuts
  ipcMain.handle(IpcChannel.Shortcuts_Update, (_, shortcuts: Shortcut[]) => {
    configManager.setShortcuts(shortcuts)
    // Refresh shortcuts registration
    if (mainWindow) {
      unregisterAllShortcuts()
      registerShortcuts(mainWindow)
    }
  })

  // memory (service removed, keep no-op handlers for compatibility)
  ipcMain.handle(IpcChannel.Memory_Add, async () => ({ memories: [], count: 0, error: 'Memory service removed' }))
  ipcMain.handle(IpcChannel.Memory_Search, async () => ({ memories: [], count: 0, error: 'Memory service removed' }))
  ipcMain.handle(IpcChannel.Memory_List, async () => ({ memories: [], count: 0, error: 'Memory service removed' }))
  ipcMain.handle(IpcChannel.Memory_Delete, async () => undefined)
  ipcMain.handle(IpcChannel.Memory_Update, async () => undefined)
  ipcMain.handle(IpcChannel.Memory_Get, async () => [])
  ipcMain.handle(IpcChannel.Memory_SetConfig, async () => undefined)
  ipcMain.handle(IpcChannel.Memory_DeleteUser, async () => undefined)
  ipcMain.handle(IpcChannel.Memory_DeleteAllMemoriesForUser, async () => undefined)
  ipcMain.handle(IpcChannel.Memory_GetUsersList, async () => [])
  ipcMain.handle(IpcChannel.Memory_MigrateMemoryDb, async () => undefined)

  // window
  ipcMain.handle(IpcChannel.Windows_SetMinimumSize, (_, width: number, height: number) => {
    checkMainWindow()
    mainWindow.setMinimumSize(width, height)
  })

  ipcMain.handle(IpcChannel.Windows_ResetMinimumSize, () => {
    checkMainWindow()

    mainWindow.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    const [width, height] = mainWindow.getSize() ?? [MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT]
    if (width < MIN_WINDOW_WIDTH) {
      mainWindow.setSize(MIN_WINDOW_WIDTH, height)
    }
  })

  ipcMain.handle(IpcChannel.Windows_GetSize, () => {
    checkMainWindow()
    const [width, height] = mainWindow.getSize() ?? [MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT]
    return [width, height]
  })

  ipcMain.handle(IpcChannel.Windows_SetSize, (_, width: number, height: number, animate: boolean = false) => {
    checkMainWindow()
    const nextWidth = Math.max(MIN_WINDOW_WIDTH, Number(width) || MIN_WINDOW_WIDTH)
    const nextHeight = Math.max(MIN_WINDOW_HEIGHT, Number(height) || MIN_WINDOW_HEIGHT)
    mainWindow.setSize(nextWidth, nextHeight, Boolean(animate))
  })

  // Window Controls
  ipcMain.handle(IpcChannel.Windows_Minimize, () => {
    checkMainWindow()
    mainWindow.minimize()
  })

  ipcMain.handle(IpcChannel.Windows_Maximize, () => {
    checkMainWindow()
    mainWindow.maximize()
  })

  ipcMain.handle(IpcChannel.Windows_Unmaximize, () => {
    checkMainWindow()
    mainWindow.unmaximize()
  })

  ipcMain.handle(IpcChannel.Windows_Close, () => {
    checkMainWindow()
    mainWindow.close()
  })

  ipcMain.handle(IpcChannel.Windows_IsMaximized, () => {
    checkMainWindow()
    return mainWindow.isMaximized()
  })

  // Send maximized state changes to renderer
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send(IpcChannel.Windows_MaximizedChanged, true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send(IpcChannel.Windows_MaximizedChanged, false)
  })

  // VertexAI
  ipcMain.handle(IpcChannel.VertexAI_GetAuthHeaders, async (_, params) => {
    return vertexAIService.getAuthHeaders(params)
  })

  ipcMain.handle(IpcChannel.VertexAI_GetAccessToken, async (_, params) => {
    return vertexAIService.getAccessToken(params)
  })

  ipcMain.handle(IpcChannel.VertexAI_ClearAuthCache, async (_, projectId: string, clientEmail?: string) => {
    vertexAIService.clearAuthCache(projectId, clientEmail)
  })

  // mini window
  ipcMain.handle(IpcChannel.MiniWindow_Show, () => windowService.showMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_Hide, () => windowService.hideMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_Close, () => windowService.closeMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_Toggle, () => windowService.toggleMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_SetPin, (_, isPinned) => windowService.setPinMiniWindow(isPinned))

  // aes
  ipcMain.handle(IpcChannel.Aes_Encrypt, (_, text: string, secretKey: string, iv: string) =>
    encrypt(text, secretKey, iv)
  )
  ipcMain.handle(IpcChannel.Aes_Decrypt, (_, encryptedData: string, iv: string, secretKey: string) =>
    decrypt(encryptedData, iv, secretKey)
  )

  // Register MCP handlers
  ipcMain.handle(IpcChannel.Mcp_RemoveServer, mcpService.removeServer)
  ipcMain.handle(IpcChannel.Mcp_RestartServer, mcpService.restartServer)
  ipcMain.handle(IpcChannel.Mcp_StopServer, mcpService.stopServer)
  ipcMain.handle(IpcChannel.Mcp_ListTools, mcpService.listTools)
  ipcMain.handle(IpcChannel.Mcp_CallTool, mcpService.callTool)
  ipcMain.handle(IpcChannel.Mcp_ListPrompts, mcpService.listPrompts)
  ipcMain.handle(IpcChannel.Mcp_GetPrompt, mcpService.getPrompt)
  ipcMain.handle(IpcChannel.Mcp_ListResources, mcpService.listResources)
  ipcMain.handle(IpcChannel.Mcp_GetResource, mcpService.getResource)
  ipcMain.handle(IpcChannel.Mcp_GetInstallInfo, mcpService.getInstallInfo)
  ipcMain.handle(IpcChannel.Mcp_CheckConnectivity, mcpService.checkMcpConnectivity)
  ipcMain.handle(IpcChannel.Mcp_AbortTool, mcpService.abortTool)
  ipcMain.handle(IpcChannel.Mcp_ResolveHubTool, async (_event, nameOrId: string) => {
    const { resolveHubToolName } = await import('@main/mcpServers/hub/mcp-bridge')
    return resolveHubToolName(nameOrId)
  })
  ipcMain.handle(IpcChannel.Mcp_GetServerVersion, mcpService.getServerVersion)
  ipcMain.handle(IpcChannel.Mcp_GetServerLogs, mcpService.getServerLogs)

  // Channel logs & status
  ipcMain.handle(IpcChannel.Channel_GetLogs, async (_event, channelId: string) => {
    const { channelManager } = await import('@main/services/agents/services/channels/ChannelManager')
    return channelManager.getChannelLogs(channelId)
  })

  ipcMain.handle(IpcChannel.Channel_GetStatuses, async () => {
    const { channelManager } = await import('@main/services/agents/services/channels/ChannelManager')
    return channelManager.getAllStatuses()
  })

  // DXT upload handler
  ipcMain.handle(IpcChannel.Mcp_UploadDxt, async (event, fileBuffer: ArrayBuffer, fileName: string) => {
    try {
      // Create a temporary file with the uploaded content
      const tempPath = await fileManager.createTempFile(event, fileName)
      await fileManager.writeFile(event, tempPath, Buffer.from(fileBuffer))

      // Process DXT file using the temporary path
      return await dxtService.uploadDxt(event, tempPath)
    } catch (error) {
      logger.error('DXT upload error:', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload DXT file'
      }
    }
  })

  // Register Python execution handler
  ipcMain.handle(
    IpcChannel.Python_Execute,
    async (_, script: string, context?: Record<string, any>, timeout?: number) => {
      return await pythonService.executeScript(script, context, timeout)
    }
  )

  ipcMain.handle(IpcChannel.App_IsBinaryExist, (_, name: string) => isBinaryExists(name))
  ipcMain.handle(IpcChannel.App_GetBinaryPath, (_, name: string) => getBinaryPath(name))
  ipcMain.handle(IpcChannel.App_InstallUvBinary, () => runInstallScript('install-uv.js'))
  ipcMain.handle(IpcChannel.App_InstallBunBinary, () => runInstallScript('install-bun.js'))
  ipcMain.handle(IpcChannel.App_InstallOvmsBinary, () => runInstallScript('install-ovms.js'))

  //copilot
  ipcMain.handle(IpcChannel.Copilot_GetAuthMessage, CopilotService.getAuthMessage.bind(CopilotService))
  ipcMain.handle(IpcChannel.Copilot_GetCopilotToken, CopilotService.getCopilotToken.bind(CopilotService))
  ipcMain.handle(IpcChannel.Copilot_SaveCopilotToken, CopilotService.saveCopilotToken.bind(CopilotService))
  ipcMain.handle(IpcChannel.Copilot_GetToken, CopilotService.getToken.bind(CopilotService))
  ipcMain.handle(IpcChannel.Copilot_Logout, CopilotService.logout.bind(CopilotService))
  ipcMain.handle(IpcChannel.Copilot_GetUser, CopilotService.getUser.bind(CopilotService))

  // CherryIN OAuth
  ipcMain.handle(IpcChannel.CherryIN_SaveToken, CherryINOAuthService.saveToken.bind(CherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_HasToken, CherryINOAuthService.hasToken.bind(CherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_GetBalance, CherryINOAuthService.getBalance.bind(CherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_Logout, CherryINOAuthService.logout.bind(CherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_StartOAuthFlow, CherryINOAuthService.startOAuthFlow.bind(CherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_ExchangeToken, CherryINOAuthService.exchangeToken.bind(CherryINOAuthService))

  // Obsidian service
  ipcMain.handle(IpcChannel.Obsidian_GetVaults, () => {
    return obsidianVaultService.getVaults()
  })

  ipcMain.handle(IpcChannel.Obsidian_GetFiles, (_event, vaultName) => {
    return obsidianVaultService.getFilesByVaultName(vaultName)
  })

  // nutstore
  ipcMain.handle(IpcChannel.Nutstore_GetSsoUrl, NutstoreService.getNutstoreSSOUrl.bind(NutstoreService))
  ipcMain.handle(IpcChannel.Nutstore_DecryptToken, (_, token: string) => NutstoreService.decryptToken(token))
  ipcMain.handle(IpcChannel.Nutstore_GetDirectoryContents, (_, token: string, path: string) =>
    NutstoreService.getDirectoryContents(token, path)
  )

  // search window
  ipcMain.handle(IpcChannel.SearchWindow_Open, async (_, uid: string, show?: boolean) => {
    await searchService.openSearchWindow(uid, show)
  })
  ipcMain.handle(IpcChannel.SearchWindow_Close, async (_, uid: string) => {
    await searchService.closeSearchWindow(uid)
  })
  ipcMain.handle(IpcChannel.SearchWindow_OpenUrl, async (_, uid: string, url: string) => {
    return await searchService.openUrlInSearchWindow(uid, url)
  })

  // webview
  ipcMain.handle(IpcChannel.Webview_SetOpenLinkExternal, (_, webviewId: number, isExternal: boolean) =>
    setOpenLinkExternal(webviewId, isExternal)
  )
  ipcMain.handle(IpcChannel.Webview_SetSpellCheckEnabled, (_, webviewId: number, isEnable: boolean) => {
    const webview = webContents.fromId(webviewId)
    if (!webview) return
    webview.session.setSpellCheckerEnabled(isEnable)
  })

  // Webview print and save handlers
  ipcMain.handle(IpcChannel.Webview_PrintToPDF, async (_, webviewId: number) => {
    const { printWebviewToPDF } = await import('./services/WebviewService')
    return await printWebviewToPDF(webviewId)
  })

  ipcMain.handle(IpcChannel.Webview_SaveAsHTML, async (_, webviewId: number) => {
    const { saveWebviewAsHTML } = await import('./services/WebviewService')
    return await saveWebviewAsHTML(webviewId)
  })
  ipcMain.handle(IpcChannel.Webview_PrimeRuntimeEnv, async () => {
    const vectcutApiKey = await resolveCurrentVectcutApiKey()
    return normalizeWebviewRuntimeEnv({ VECTCUT_API_KEY: vectcutApiKey })
  })
  ipcMain.on(IpcChannel.Webview_GetRuntimeEnv, (event) => {
    const vectcutApiKey = getCachedVectcutApiKey()
    event.returnValue = normalizeWebviewRuntimeEnv({ VECTCUT_API_KEY: vectcutApiKey })
  })
  ipcMain.handle(IpcChannel.BrowserPreview_StateSync, (_event, payload) => {
    return browserPreviewService.syncState(payload)
  })
  ipcMain.handle(IpcChannel.BrowserPreview_CommandResult, (_event, payload) => {
    return browserPreviewService.resolveCommandResult(payload)
  })

  // store sync
  storeSyncService.registerIpcHandler()

  // selection assistant
  SelectionService.registerIpcHandler()

  ipcMain.handle(IpcChannel.App_QuoteToMain, (_, text: string) => windowService.quoteToMainWindow(text))
  ipcMain.handle(IpcChannel.App_SendTextToMain, (_, text: string) => windowService.sendTextToMainWindow(text))

  ipcMain.handle(IpcChannel.App_SetDisableHardwareAcceleration, (_, isDisable: boolean) => {
    configManager.setDisableHardwareAcceleration(isDisable)
  })
  ipcMain.handle(IpcChannel.App_SetUseSystemTitleBar, (_, isActive: boolean) => {
    configManager.setUseSystemTitleBar(isActive)
  })
  ipcMain.handle(IpcChannel.TRACE_SAVE_DATA, (_, topicId: string) => saveSpans(topicId))
  ipcMain.handle(IpcChannel.TRACE_GET_DATA, (_, topicId: string, traceId: string, modelName?: string) =>
    getSpans(topicId, traceId, modelName)
  )
  ipcMain.handle(IpcChannel.TRACE_SAVE_ENTITY, (_, entity: SpanEntity) => saveEntity(entity))
  ipcMain.handle(IpcChannel.TRACE_GET_ENTITY, (_, spanId: string) => getEntity(spanId))
  ipcMain.handle(IpcChannel.TRACE_BIND_TOPIC, (_, topicId: string, traceId: string) => bindTopic(traceId, topicId))
  ipcMain.handle(IpcChannel.TRACE_CLEAN_TOPIC, (_, topicId: string, traceId?: string) => cleanTopic(topicId, traceId))
  ipcMain.handle(IpcChannel.TRACE_TOKEN_USAGE, (_, spanId: string, usage: TokenUsage) => tokenUsage(spanId, usage))
  ipcMain.handle(IpcChannel.TRACE_CLEAN_HISTORY, (_, topicId: string, traceId: string, modelName?: string) =>
    cleanHistoryTrace(topicId, traceId, modelName)
  )
  ipcMain.handle(
    IpcChannel.TRACE_OPEN_WINDOW,
    (_, topicId: string, traceId: string, autoOpen?: boolean, modelName?: string) =>
      openTraceWindow(topicId, traceId, autoOpen, modelName)
  )
  ipcMain.handle(IpcChannel.TRACE_SET_TITLE, (_, title: string) => setTraceWindowTitle(title))
  ipcMain.handle(IpcChannel.TRACE_ADD_END_MESSAGE, (_, spanId: string, modelName: string, message: string) =>
    addEndMessage(spanId, modelName, message)
  )
  ipcMain.handle(IpcChannel.TRACE_CLEAN_LOCAL_DATA, () => cleanLocalData())
  ipcMain.handle(
    IpcChannel.TRACE_ADD_STREAM_MESSAGE,
    (_, spanId: string, modelName: string, context: string, msg: any) =>
      addStreamMessage(spanId, modelName, context, msg)
  )

  ipcMain.handle(IpcChannel.App_GetDiskInfo, async (_, directoryPath: string) => {
    try {
      const diskSpace = await checkDiskSpace(directoryPath) // { free, size } in bytes
      logger.debug('disk space', diskSpace)
      const { free, size } = diskSpace
      return {
        free,
        size
      }
    } catch (error) {
      logger.error('check disk space error', error as Error)
      return null
    }
  })
  // API Server
  apiServerService.registerIpcHandlers()

  // Anthropic OAuth
  ipcMain.handle(IpcChannel.Anthropic_StartOAuthFlow, () => anthropicService.startOAuthFlow())
  ipcMain.handle(IpcChannel.Anthropic_CompleteOAuthWithCode, (_, code: string) =>
    anthropicService.completeOAuthWithCode(code)
  )
  ipcMain.handle(IpcChannel.Anthropic_CancelOAuthFlow, () => anthropicService.cancelOAuthFlow())
  ipcMain.handle(IpcChannel.Anthropic_GetAccessToken, () => anthropicService.getValidAccessToken())
  ipcMain.handle(IpcChannel.Anthropic_HasCredentials, () => anthropicService.hasCredentials())
  ipcMain.handle(IpcChannel.Anthropic_ClearCredentials, () => anthropicService.clearCredentials())

  // ExternalApps
  ipcMain.handle(IpcChannel.ExternalApps_DetectInstalled, () => externalAppsService.detectInstalledApps())

  // CodeTools
  ipcMain.handle(IpcChannel.CodeTools_Run, codeToolsService.run)
  ipcMain.handle(IpcChannel.CodeTools_GetAvailableTerminals, () => codeToolsService.getAvailableTerminalsForPlatform())
  ipcMain.handle(IpcChannel.CodeTools_SetCustomTerminalPath, (_, terminalId: string, path: string) =>
    codeToolsService.setCustomTerminalPath(terminalId, path)
  )
  ipcMain.handle(IpcChannel.CodeTools_GetCustomTerminalPath, (_, terminalId: string) =>
    codeToolsService.getCustomTerminalPath(terminalId)
  )
  ipcMain.handle(IpcChannel.CodeTools_RemoveCustomTerminalPath, (_, terminalId: string) =>
    codeToolsService.removeCustomTerminalPath(terminalId)
  )

  // OCR
  ipcMain.handle(IpcChannel.OCR_ocr, (_, file: SupportedOcrFile, provider: OcrProvider) =>
    ocrService.ocr(file, provider)
  )
  ipcMain.handle(IpcChannel.OCR_ListProviders, () => ocrService.listProviderIds())

  // OVMS
  ipcMain.handle(IpcChannel.Ovms_IsSupported, () => isOvmsSupported)
  if (isOvmsSupported) {
    const { ovmsManager } = await import('./services/OvmsManager')
    if (ovmsManager) {
      ipcMain.handle(
        IpcChannel.Ovms_AddModel,
        (_, modelName: string, modelId: string, modelSource: string, task: string) =>
          ovmsManager.addModel(modelName, modelId, modelSource, task)
      )
      ipcMain.handle(IpcChannel.Ovms_StopAddModel, () => ovmsManager.stopAddModel())
      ipcMain.handle(IpcChannel.Ovms_GetModels, () => ovmsManager.getModels())
      ipcMain.handle(IpcChannel.Ovms_IsRunning, () => ovmsManager.initializeOvms())
      ipcMain.handle(IpcChannel.Ovms_GetStatus, () => ovmsManager.getOvmsStatus())
      ipcMain.handle(IpcChannel.Ovms_RunOVMS, () => ovmsManager.runOvms())
      ipcMain.handle(IpcChannel.Ovms_StopOVMS, () => ovmsManager.stopOvms())
    } else {
      logger.error('Unexpected behavior: undefined ovmsManager, but OVMS should be supported.')
    }
  } else {
    const fallback = () => {
      throw new Error('OVMS is only supported on Windows with intel CPU.')
    }
    ipcMain.handle(IpcChannel.Ovms_AddModel, fallback)
    ipcMain.handle(IpcChannel.Ovms_StopAddModel, fallback)
    ipcMain.handle(IpcChannel.Ovms_GetModels, fallback)
    ipcMain.handle(IpcChannel.Ovms_IsRunning, fallback)
    ipcMain.handle(IpcChannel.Ovms_GetStatus, fallback)
    ipcMain.handle(IpcChannel.Ovms_RunOVMS, fallback)
    ipcMain.handle(IpcChannel.Ovms_StopOVMS, fallback)
  }

  // CherryAI
  ipcMain.handle(IpcChannel.Cherryai_GetSignature, (_, params) => {})

  // Global Skills
  ipcMain.handle(IpcChannel.Skill_List, async (_, agentId?: string) => {
    try {
      const data = await skillService.list(agentId)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to list skills', { error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_ListActive, async (_, agentId: string) => {
    try {
      const data = await skillService.listActive(agentId)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to list active agent skills', { agentId, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_SubscribeChanges, async (_, agentId: string) => {
    try {
      const skillsRoot = await ensureSkillWatcher(agentId)
      return { success: true, data: { agentId, skillsRoot } }
    } catch (error) {
      logger.error('Failed to subscribe skill watcher', { agentId, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_UnsubscribeChanges, async (_, agentId: string) => {
    try {
      releaseSkillWatcher(agentId)
      return { success: true }
    } catch (error) {
      logger.error('Failed to unsubscribe skill watcher', { agentId, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_Install, async (_, options) => {
    try {
      const data = await skillService.install(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to install skill', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_Uninstall, async (_, skillId: string) => {
    try {
      await skillService.uninstall(skillId)
      return { success: true, data: undefined }
    } catch (error) {
      logger.error('Failed to uninstall skill', { skillId, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_Toggle, async (_, options) => {
    try {
      if (
        !options ||
        typeof options.skillId !== 'string' ||
        !options.skillId ||
        typeof options.agentId !== 'string' ||
        !options.agentId ||
        typeof options.isEnabled !== 'boolean'
      ) {
        return { success: false, error: 'Invalid toggle options' }
      }
      const data = await skillService.toggle(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to toggle skill', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_InstallFromZip, async (_, options) => {
    try {
      const data = await skillService.installFromZip(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to install skill from ZIP', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_InstallFromRemotePackage, async (_, options) => {
    try {
      const data = await skillService.installFromRemotePackage(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to install skill from remote package', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_UpdateMetadata, async (_, options) => {
    try {
      const data = await skillService.updateMetadata(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to update local skill metadata', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_InstallFromDirectory, async (_, options) => {
    try {
      const data = await skillService.installFromDirectory(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to install skill from directory', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_CopyDirectoryToWorkspace, async (_, payload) => {
    try {
      const agentId = typeof payload?.agentId === 'string' ? payload.agentId : 'vectcut_claw_default'
      const directoryPath = typeof payload?.directoryPath === 'string' ? payload.directoryPath : ''
      const workspace = typeof payload?.workspace === 'string' ? payload.workspace : ''
      const sourceSubdir = typeof payload?.sourceSubdir === 'string' ? payload.sourceSubdir : ''
      const targetRelativePath = typeof payload?.targetRelativePath === 'string' ? payload.targetRelativePath : ''
      const excludeSubdirs = Array.isArray(payload?.excludeSubdirs)
        ? payload.excludeSubdirs.map((item: unknown) => String(item || '')).filter(Boolean)
        : []
      const data = await skillService.copyDirectoryToWorkspace(directoryPath, workspace, {
        sourceSubdir,
        targetRelativePath,
        excludeSubdirs
      })
      if (!sourceSubdir && !targetRelativePath) {
        broadcastSkillChanged(agentId, {
          filename: data?.folderName,
          eventType: 'copy-directory-to-workspace',
          skillsRoot: path.dirname(data?.targetPath || '')
        })
      }
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to copy skill directory to workspace', { payload, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_ReadFile, async (_, skillId: string, filename: string) => {
    try {
      const data = await skillService.readFile(skillId, filename)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to read skill file', { skillId, filename, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_ListFiles, async (_, skillId: string) => {
    try {
      const data = await skillService.listFiles(skillId)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to list skill files', { skillId, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_ListLocal, async (_, workdir: string) => {
    try {
      if (!workdir || typeof workdir !== 'string') {
        return { success: false, error: 'Invalid workdir' }
      }
      const data = await skillService.listLocal(workdir)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to list local plugins', { workdir, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_SeedWorkspace, async (_, workspace: string) => {
    try {
      if (!workspace || typeof workspace !== 'string') {
        return { success: false, error: 'Invalid workspace' }
      }
      await seedWorkspaceTemplates(workspace)
      await skillService.seedWorkspaceSkillsFromGlobal(workspace)
      return { success: true }
    } catch (error) {
      logger.error('Failed to seed workspace skills', { workspace, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_RunExample, async (_, payload: { skillPath?: string }) => {
    try {
      const skillPath = String(payload?.skillPath || '').trim()
      if (!skillPath) {
        return { success: false, error: 'Invalid skill path' }
      }

      logger.info('IPC received skill example run request', { skillPath })
      const data = await runSkillExampleScript(skillPath)
      logger.info('IPC finished skill example run request', {
        skillPath,
        stdoutLength: data.stdout.length,
        stderrLength: data.stderr.length
      })
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to run skill example', {
        skillPath: payload?.skillPath,
        error
      })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle(IpcChannel.LocalTransfer_ListServices, () => localTransferService.getState())
  ipcMain.handle(IpcChannel.LocalTransfer_StartScan, () => localTransferService.startDiscovery({ resetList: true }))
  ipcMain.handle(IpcChannel.LocalTransfer_StopScan, () => localTransferService.stopDiscovery())
  ipcMain.handle(IpcChannel.LocalTransfer_Connect, (_, payload: LocalTransferConnectPayload) =>
    lanTransferClientService.connectAndHandshake(payload)
  )
  ipcMain.handle(IpcChannel.LocalTransfer_Disconnect, () => lanTransferClientService.disconnect())
  ipcMain.handle(IpcChannel.LocalTransfer_SendFile, (_, payload: { filePath: string }) =>
    lanTransferClientService.sendFile(payload.filePath)
  )
  ipcMain.handle(IpcChannel.LocalTransfer_CancelTransfer, () => lanTransferClientService.cancelTransfer())

  ipcMain.handle(IpcChannel.APP_CrashRenderProcess, () => {
    mainWindow.webContents.forcefullyCrashRenderer()
  })

  // OpenClaw
  ipcMain.handle(IpcChannel.OpenClaw_CheckInstalled, openClawService.checkInstalled)
  ipcMain.handle(IpcChannel.OpenClaw_Install, openClawService.install)
  ipcMain.handle(IpcChannel.OpenClaw_Uninstall, openClawService.uninstall)
  ipcMain.handle(IpcChannel.OpenClaw_StartGateway, openClawService.startGateway)
  ipcMain.handle(IpcChannel.OpenClaw_StopGateway, openClawService.stopGateway)
  ipcMain.handle(IpcChannel.OpenClaw_GetStatus, openClawService.getStatus)
  ipcMain.handle(IpcChannel.OpenClaw_CheckHealth, openClawService.checkHealth)
  ipcMain.handle(IpcChannel.OpenClaw_GetDashboardUrl, openClawService.getDashboardUrl)
  ipcMain.handle(IpcChannel.OpenClaw_SyncConfig, openClawService.syncProviderConfig)
  ipcMain.handle(IpcChannel.OpenClaw_GetChannels, openClawService.getChannelStatus)
  ipcMain.handle(IpcChannel.OpenClaw_CheckUpdate, openClawService.checkUpdate)
  ipcMain.handle(IpcChannel.OpenClaw_PerformUpdate, openClawService.performUpdate)

  // WeChat
  ipcMain.handle(IpcChannel.WeChat_HasCredentials, async (_, channelId: string) => {
    const tokenPath = path.join(getDataPath('Channels'), `weixin_bot_${channelId}.json`)
    try {
      const raw = await fs.promises.readFile(tokenPath, 'utf8')
      const parsed = JSON.parse(raw)
      return { exists: true, userId: parsed.userId as string | undefined }
    } catch {
      return { exists: false }
    }
  })

}
