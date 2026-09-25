// don't reorder this file, it's used to initialize the app data dir and
// other which should be run before the main process is ready
// eslint-disable-next-line
import './bootstrap'

import '@main/config'

import { loggerService } from '@logger'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { replaceDevtoolsFont } from '@main/utils/windowUtil'
import { app, crashReporter } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from 'electron-devtools-installer'
import { isDev, isLinux, isWin } from './constant'

import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'

import { registerIpc } from './ipc'
import { schedulerService } from './services/agents/services/SchedulerService'
import { bootstrapBuiltinAgents } from './services/agents/services/builtin/BuiltinAgentBootstrap'
import { channelManager } from './services/agents/services/channels'
import { apiServerService } from './services/ApiServerService'
import { appMenuService } from './services/AppMenuService'
import { configManager } from './services/ConfigManager'
import { crashReportService, describeDiagnosticError } from './services/CrashReportService'
import { loggerService as mainLoggerService } from './services/LoggerService'
import { lanTransferClientService } from './services/lanTransfer'
import mcpService from './services/MCPService'
import { localTransferService } from './services/LocalTransferService'
import { openClawService } from './services/OpenClawService'
import { nodeTraceService } from './services/NodeTraceService'
import powerMonitorService from './services/PowerMonitorService'
import {
  CHERRY_STUDIO_PROTOCOL,
  handleProtocolUrl,
  registerProtocolClient,
  setupAppImageDeepLink
} from './services/ProtocolClient'
import selectionService, { initSelectionService } from './services/SelectionService'
import { registerShortcuts } from './services/ShortcutService'
// import { TrayService } from './services/TrayService'
import { versionService } from './services/VersionService'
import { registerLegacyMainCompatIpc } from './services/LegacyMainCompatIpc'
import { windowService } from './services/WindowService'
import { initWebviewHotkeys } from './services/WebviewService'
import { runAsyncFunction } from './utils'
import { getResourcePath } from './utils'
import { isOvmsSupported } from './services/OvmsManager'
import { extractRtkBinaries } from './utils/rtk'

const logger = loggerService.withContext('MainEntry')

// Ensure userData root uses VectCut instead of legacy app names.
app.setName('VectCut')

// Keep legacy behavior: set Chromium locale before window creation so hosted auth pages
// follow persisted app language.
try {
  const savedLanguage = String(configManager.getLanguage() || '').toLowerCase()
  const chromiumLang = !savedLanguage ? 'zh-CN' : savedLanguage.startsWith('zh') ? 'zh-CN' : 'en-US'
  app.commandLine.appendSwitch('lang', chromiumLang)
  logger.info('Chromium lang switch set', { chromiumLang })
} catch (error) {
  logger.warn('Failed to set Chromium lang switch', error as Error)
}

// enable local crash reports
crashReporter.start({
  companyName: 'CherryHQ',
  productName: 'VectCut',
  submitURL: '',
  uploadToServer: false
})

/**
 * Disable hardware acceleration if setting is enabled
 */
const disableHardwareAcceleration = configManager.getDisableHardwareAcceleration()
if (disableHardwareAcceleration) {
  app.disableHardwareAcceleration()
}

/**
 * Disable chromium's window animations
 * main purpose for this is to avoid the transparent window flashing when it is shown
 * (especially on Windows for SelectionAssistant Toolbar)
 * Know Issue: https://github.com/electron/electron/issues/12130#issuecomment-627198990
 */
if (isWin) {
  app.commandLine.appendSwitch('wm-window-animations-disabled')
}

/**
 * Enable GlobalShortcutsPortal for Linux Wayland Protocol
 * see: https://www.electronjs.org/docs/latest/api/global-shortcut
 */
if (isLinux && process.env.XDG_SESSION_TYPE === 'wayland') {
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
}

/**
 * Set window class and name for Linux
 * This ensures the window manager identifies the app correctly on both X11 and Wayland
 */
if (isLinux) {
  app.commandLine.appendSwitch('class', 'VectCut')
  app.commandLine.appendSwitch('name', 'VectCut')
}

// DocumentPolicyIncludeJSCallStacksInCrashReports: Enable features for unresponsive renderer js call stacks
// EarlyEstablishGpuChannel,EstablishGpuChannelAsync: Enable features for early establish gpu channel
// speed up the startup time
// https://github.com/microsoft/vscode/pull/241640/files
app.commandLine.appendSwitch(
  'enable-features',
  'DocumentPolicyIncludeJSCallStacksInCrashReports,EarlyEstablishGpuChannel,EstablishGpuChannelAsync'
)
app.on('web-contents-created', (_, webContents) => {
  // Register before window-specific handlers, which may immediately call app.exit().
  webContents.on('render-process-gone', (_, details) => {
    crashReportService.record('render-process-gone', {
      ...details,
      webContentsId: webContents.id,
      isQuitting: Boolean(app.isQuitting)
    }, details.reason !== 'clean-exit' && !app.isQuitting)
  })

  webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Document-Policy': ['include-js-call-stacks-in-crash-reports']
      }
    })
  })

  webContents.on('unresponsive', async () => {
    // Interrupt execution and collect call stack from unresponsive renderer
    logger.error('Renderer unresponsive start')
    crashReportService.record('renderer-unresponsive', { webContentsId: webContents.id })
    try {
      const callStack = await webContents.mainFrame.collectJavaScriptCallStack()
      logger.error(`Renderer unresponsive js call stack\n ${callStack}`)
      crashReportService.record('renderer-unresponsive-stack', { webContentsId: webContents.id, callStack })
    } catch (error) {
      logger.warn('Failed to collect unresponsive renderer stack', error as Error)
      crashReportService.record('renderer-stack-unavailable', {
        webContentsId: webContents.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })
})

// in production mode, handle uncaught exception and unhandled rejection globally
if (!isDev) {
  // handle uncaught exception
  process.on('uncaughtException', (error) => {
    crashReportService.record('uncaught-exception', describeDiagnosticError(error), true)
    logger.error('Uncaught Exception:', error)
  })

  // handle unhandled rejection
  process.on('unhandledRejection', (reason) => {
    const details = describeDiagnosticError(reason)
    crashReportService.record('unhandled-rejection', details, true)
    logger.error(`Unhandled Rejection: ${details.message}`, details)
  })
}

// Check for single instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
} else {
  if (app.isPackaged) {
    crashReportService.start({
      userDataPath: app.getPath('userData'),
      logsPath: mainLoggerService.getLogsDir(),
      dumpsPath: app.getPath('crashDumps'),
      version: app.getVersion(),
      hardwareAccelerationDisabled: disableHardwareAcceleration
    })
  }
  app.on('child-process-gone', (_, details) => {
    const isQuitting = Boolean(app.isQuitting)
    crashReportService.record(
      'child-process-gone',
      { ...details, isQuitting },
      !isQuitting && details.reason !== 'clean-exit'
    )
  })
  app.on('quit', (_, exitCode) => crashReportService.finish(exitCode))
  process.on('exit', (exitCode) => crashReportService.finish(exitCode))

  // Independent of optional startup services, and never awaited by the UI startup.
  void app.whenReady().then(() => {
    const timer = setTimeout(() => void crashReportService.sendPendingReports(), 15_000)
    timer.unref()
  })

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.

  void app.whenReady().then(async () => {
    const resourcePath = getResourcePath()
    logger.info('Resource path resolved', {
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      processResourcesPath: process.resourcesPath,
      resourcePath,
      resourcePathExists: fs.existsSync(resourcePath),
      builtinSkillsExists: fs.existsSync(path.join(resourcePath, 'skills')),
      migrationDirExists: fs.existsSync(path.join(resourcePath, 'database', 'drizzle'))
    })

    // Record current version for tracking
    // A preparation for v2 data refactoring
    versionService.recordCurrentVersion()

    initWebviewHotkeys()
    // Set app user model id for windows
    electronApp.setAppUserModelId(import.meta.env.VITE_MAIN_BUNDLE_ID || 'com.vectcut.app')

    // Mac: Hide dock icon before window creation when launch to tray is set
    const isLaunchToTray = configManager.getLaunchToTray()
    if (isLaunchToTray) {
      app.dock?.hide()
    }

    // Check for backup restore marker and complete restoration (highest priority, before window creation)
    const { BackupManager } = await import('./services/BackupManager')
    await BackupManager.handleStartupRestore()

    const mainWindow = windowService.createMainWindow()

    await registerIpc(mainWindow, app)
    registerLegacyMainCompatIpc()

    // 禁用系统托盘图标创建（保留原逻辑，按需可恢复）
    // new TrayService()

    // Setup macOS application menu
    appMenuService?.setupApplicationMenu()

    nodeTraceService.init()
    powerMonitorService.init()

    // Extract bundled rtk binary to ~/.cherrystudio/bin/ on first run
    extractRtkBinaries().catch((error) => {
      logger.warn('Failed to extract rtk binaries (non-fatal)', {
        error: error instanceof Error ? error.message : String(error)
      })
    })

    app.on('activate', function () {
      const mainWindow = windowService.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) {
        windowService.createMainWindow()
      } else {
        windowService.showMainWindow()
      }
    })

    registerShortcuts(mainWindow)

    localTransferService.startDiscovery({ resetList: true })

    replaceDevtoolsFont(mainWindow)

    // Setup deep link for AppImage on Linux
    await setupAppImageDeepLink()

    if (isDev) {
      installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS])
        .then((name) => logger.info(`Added Extension:  ${name}`))
        .catch((err) => logger.error('An error occurred: ', err))
    }

    //start selection assistant service
    initSelectionService()

    void runAsyncFunction(async () => {
      try {
        logger.info('Starting API server during app startup')
        await apiServerService.start()
      } catch (error: any) {
        logger.error('Failed to start API server during app startup:', error)
      }
    })

    void runAsyncFunction(async () => {
      // Initialize built-in skills and agents (sequential to avoid SQLITE_BUSY)
      // TODO: v2 lifecycle
      await bootstrapBuiltinAgents()

      try {
        // Restore VectcutClaw schedulers after services are ready
        await schedulerService.restoreSchedulers()

        // Start VectcutClaw channel adapters (Telegram, etc.)
        await channelManager.start()
      } catch (error: any) {
        logger.error('Failed to finish post-bootstrap startup tasks:', error)
      }
    })
  })

  registerProtocolClient(app)

  // macOS specific: handle protocol when app is already running

  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleProtocolUrl(url)
  })

  const handleOpenUrl = (args: string[]) => {
    const url = args.find((arg) => {
      if (!arg.startsWith(CHERRY_STUDIO_PROTOCOL + '://')) {
        return false
      }

      try {
        return new URL(arg).hostname.toLowerCase() === 'download'
      } catch {
        return false
      }
    })
    if (url) handleProtocolUrl(url)
  }

  // for windows to start with url
  handleOpenUrl(process.argv)

  // Listen for second instance
  app.on('second-instance', (_event, argv) => {
    windowService.showMainWindow()

    // Protocol handler for Windows/Linux
    // The commandLine is an array of strings where the last item might be the URL
    handleOpenUrl(argv)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('before-quit', () => {
    crashReportService.record('before-quit', { isQuitting: Boolean(app.isQuitting) })
    app.isQuitting = true

    // quit selection service
    if (selectionService) {
      selectionService.quit()
    }

    lanTransferClientService.dispose()
    localTransferService.dispose()
  })

  app.on('will-quit', async () => {
    crashReportService.record('will-quit')
    // 简单的资源清理，不阻塞退出流程
    if (isOvmsSupported) {
      const { ovmsManager } = await import('./services/OvmsManager')
      if (ovmsManager) {
        await ovmsManager.stopOvms()
      } else {
        logger.warn('Unexpected behavior: undefined ovmsManager, but OVMS should be supported.')
      }
    }

    try {
      schedulerService.stopAll()
      await channelManager.stop()
      await openClawService.stopGateway()
      await mcpService.cleanup()
      await apiServerService.stop()
    } catch (error) {
      logger.warn('Error cleaning up services:', error as Error)
    }

    // finish the logger
    logger.finish()
  })

  // In this file you can include the rest of your app"s specific main process
  // code. You can also put them in separate files and require them here.
}
