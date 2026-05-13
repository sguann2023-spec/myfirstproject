import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { app, ipcMain } from 'electron'

import { handleProvidersProtocolUrl } from './urlschema/handle-providers'
import { handleMcpProtocolUrl } from './urlschema/mcp-install'
import { windowService } from './WindowService'

const logger = loggerService.withContext('ProtocolClient')

export const CHERRY_STUDIO_PROTOCOL = 'vectcut'
const DOWNLOAD_PROTOCOL_ROUTE = 'download'
const PROTOCOL_RENDERER_READY_CHANNEL = 'protocol-renderer-ready'

type ProtocolPayload = {
  url: string
  route: string
  params: Record<string, string>
}

const pendingProtocolPayloads: ProtocolPayload[] = []
let isProtocolRendererReady = false
let isProtocolIpcRegistered = false

export function registerProtocolClient(app: Electron.App) {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(CHERRY_STUDIO_PROTOCOL, process.execPath, [process.argv[1]])
    }
  }

  app.setAsDefaultProtocolClient(CHERRY_STUDIO_PROTOCOL)
  ensureProtocolIpcRegistered()
}

function ensureProtocolIpcRegistered() {
  if (isProtocolIpcRegistered) return
  isProtocolIpcRegistered = true

  ipcMain.on(PROTOCOL_RENDERER_READY_CHANNEL, () => {
    isProtocolRendererReady = true
    flushPendingProtocolPayloads()
  })

  app.on('browser-window-created', (_event, window) => {
    if (window === windowService.getMainWindow()) {
      isProtocolRendererReady = false
    }
  })
}

function parseProtocolPayload(url: string): ProtocolPayload | null {
  if (!url) return null

  try {
    const urlObj = new URL(url)
    if (urlObj.protocol.replace(':', '').toLowerCase() !== CHERRY_STUDIO_PROTOCOL) {
      return null
    }

    const params = new URLSearchParams(urlObj.search)
    return {
      url,
      route: urlObj.hostname.toLowerCase(),
      params: Object.fromEntries(params.entries())
    }
  } catch (error) {
    logger.warn('Ignored invalid protocol url', { url, error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

function dispatchProtocolPayload(payload: ProtocolPayload): boolean {
  const mainWindow = windowService.getMainWindow()
  if (!isProtocolRendererReady || !mainWindow || mainWindow.isDestroyed()) {
    return false
  }

  mainWindow.webContents.send('protocol-data', payload)
  return true
}

function flushPendingProtocolPayloads() {
  while (pendingProtocolPayloads.length > 0) {
    const payload = pendingProtocolPayloads[0]
    if (!dispatchProtocolPayload(payload)) {
      return
    }
    pendingProtocolPayloads.shift()
  }
}

export function handleProtocolUrl(url: string) {
  const payload = parseProtocolPayload(url)
  if (!payload) return

  // Process the URL that was used to open the app
  // The url will be in the format: vectcut://download?param1=value1&param2=value2
  const urlObj = new URL(payload.url)

  switch (payload.route) {
    case 'mcp':
      handleMcpProtocolUrl(urlObj)
      return
    case 'providers':
      void handleProvidersProtocolUrl(urlObj)
      return
    case DOWNLOAD_PROTOCOL_ROUTE:
      windowService.showMainWindow()
      break
    default:
      logger.warn('Ignored unsupported protocol route', { route: payload.route, url: payload.url })
      return
  }

  if (dispatchProtocolPayload(payload)) {
    return
  }

  pendingProtocolPayloads.push(payload)
  logger.info('Queued download protocol payload until renderer is ready', {
    route: payload.route,
    draftId: payload.params.draft_id || ''
  })
}

const execAsync = promisify(exec)

const DESKTOP_FILE_NAME = 'cherrystudio-url-handler.desktop'

/**
 * Sets up deep linking for the AppImage build on Linux by creating a .desktop file.
 * This allows the OS to open vectcut:// URLs with this App.
 */
export async function setupAppImageDeepLink(): Promise<void> {
  // Only run on Linux and when packaged as an AppImage
  if (process.platform !== 'linux' || !process.env.APPIMAGE) {
    return
  }

  logger.debug('AppImage environment detected on Linux, setting up deep link.')

  try {
    const appPath = app.getPath('exe')
    if (!appPath) {
      logger.error('Could not determine App path.')
      return
    }

    const homeDir = app.getPath('home')
    const applicationsDir = path.join(homeDir, '.local', 'share', 'applications')
    const desktopFilePath = path.join(applicationsDir, DESKTOP_FILE_NAME)

    // Ensure the applications directory exists
    await fs.mkdir(applicationsDir, { recursive: true })

    // Content of the .desktop file
    // %U allows passing the URL to the application
    // NoDisplay=true hides it from the regular application menu
    const desktopFileContent = `[Desktop Entry]
Name=Cherry Studio
Exec=${escapePathForExec(appPath)} %U
Terminal=false
Type=Application
MimeType=x-scheme-handler/${CHERRY_STUDIO_PROTOCOL};
NoDisplay=true
`

    // Write the .desktop file (overwrite if exists)
    await fs.writeFile(desktopFilePath, desktopFileContent, 'utf-8')
    logger.debug(`Created/Updated desktop file: ${desktopFilePath}`)

    // Update the desktop database
    // It's important to update the database for the changes to take effect
    try {
      const { stdout, stderr } = await execAsync(`update-desktop-database ${escapePathForExec(applicationsDir)}`)
      if (stderr) {
        logger.warn(`update-desktop-database stderr: ${stderr}`)
      }
      logger.debug(`update-desktop-database stdout: ${stdout}`)
      logger.debug('Desktop database updated successfully.')
    } catch (updateError) {
      logger.error('Failed to update desktop database:', updateError as Error)
      // Continue even if update fails, as the file is still created.
    }
  } catch (error) {
    // Log the error but don't prevent the app from starting
    logger.error('Failed to setup AppImage deep link:', error as Error)
  }
}

/**
 * Escapes a path for safe use within the Exec field of a .desktop file
 * and for shell commands. Handles spaces and potentially other special characters
 * by quoting.
 */
function escapePathForExec(filePath: string): string {
  // Simple quoting for paths with spaces.
  return `'${filePath.replace(/'/g, "'\\''")}'`
}
