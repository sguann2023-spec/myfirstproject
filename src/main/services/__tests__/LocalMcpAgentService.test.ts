import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { getMacInstalledApps } from 'node-get-installed-apps'
import { localMcpAgentService } from '../LocalMcpAgentService'

const logger = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => logger }
}))
vi.mock('@main/apiServer', () => ({ apiServer: {} }))
vi.mock('@main/constant', () => ({ isMac: true, isWin: false }))
vi.mock('@shared/config/constant', () => ({ API_SERVER_DEFAULTS: { PORT: 18845 } }))
vi.mock('electron', () => ({ app: { getApplicationInfoForProtocol: vi.fn() } }))
vi.mock('node:fs', () => ({ default: { existsSync: () => false, statSync: vi.fn() } }))
vi.mock('node-get-installed-apps', () => ({
  getMacInstalledApps: vi.fn(),
  getWinInstalledApps: vi.fn()
}))

// Desktop matches keep these tests independent of locally installed CLI tools.
const apps = ['WorkBuddy', 'Claude', 'Cursor', 'Codex', 'OpenCode'].map((appName) => ({
  appName,
  appIdentifier: appName.toLowerCase(),
  installPath: `/Applications/${appName}.app`
}))

describe('local MCP application detection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw Object.assign(new Error('missing file'), { code: 'ENOENT' })
    })
  })

  const mockBundle = (appPath: string) => {
    vi.mocked(fs.statSync).mockImplementation((filePath) => {
      if (filePath === path.join(appPath, 'Contents', 'Info.plist')) {
        return { isFile: () => true } as any
      }
      throw Object.assign(new Error('missing file'), { code: 'ENOENT' })
    })
  }

  it('continues detecting system apps when the user Applications directory is absent', async () => {
    vi.mocked(getMacInstalledApps).mockImplementation(async (directory) => {
      if (directory === '/Applications') return apps as any
      throw Object.assign(new Error('missing directory'), { code: 'ENOENT' })
    })

    const result = await localMcpAgentService.detectAgents()
    expect(getMacInstalledApps).toHaveBeenCalledWith(path.join(os.homedir(), 'Applications'))
    expect(result).toHaveLength(5)
    expect(result.every((agent) => agent.installed)).toBe(true)
    expect(logger.info).toHaveBeenCalledWith('Skipped missing local MCP application directory', {
      directory: path.join(os.homedir(), 'Applications')
    })
    expect(logger.info).toHaveBeenCalledWith('Scanned local MCP application directory', {
      directory: '/Applications',
      count: 5
    })
  })

  it('continues detecting user apps when the system Applications directory is absent', async () => {
    vi.mocked(getMacInstalledApps).mockImplementation(async (directory) => {
      if (directory !== '/Applications') return apps as any
      throw Object.assign(new Error('missing directory'), { code: 'ENOENT' })
    })

    const result = await localMcpAgentService.detectAgents()
    expect(result.every((agent) => agent.installed)).toBe(true)
  })

  it.each(['EACCES', 'EPERM', 'EIO'])('does not disguise %s as an empty app list', async (code) => {
    const error = Object.assign(new Error('scan failed'), { code })
    vi.mocked(getMacInstalledApps).mockRejectedValue(error)
    await expect(localMcpAgentService.detectAgents()).rejects.toBe(error)
    expect(logger.error).toHaveBeenCalledWith('Failed to scan installed applications in /Applications', error)
  })

  it('still detects apps when both directories are readable', async () => {
    vi.mocked(getMacInstalledApps).mockResolvedValue(apps as any)
    const result = await localMcpAgentService.detectAgents()
    expect(result).toHaveLength(5)
    expect(result.every((agent) => agent.installed)).toBe(true)
  })

  it('recognizes WorkBuddy by bundle identifier even when its display name differs', async () => {
    vi.mocked(getMacInstalledApps).mockResolvedValue([
      { ...apps[0], appName: 'Renamed app', appIdentifier: 'com.tencent.workbuddy.mac' },
      ...apps.slice(1)
    ] as any)

    const result = await localMcpAgentService.detectAgents()
    expect(result.find((agent) => agent.id === 'workbuddy')).toMatchObject({
      installed: true,
      path: '/Applications/WorkBuddy.app'
    })
  })

  it('logs detection results without including registration configuration', async () => {
    vi.mocked(getMacInstalledApps).mockResolvedValue(apps as any)
    await localMcpAgentService.detectAgents()

    expect(logger.info).toHaveBeenCalledWith('Detected local MCP agents', {
      platform: process.platform,
      desktopAppCount: 5,
      detected: apps.map((appInfo, index) => ({
        id: ['workbuddy', 'claude_code', 'cursor', 'codex_cli', 'opencode'][index],
        installed: true,
        installType: 'app',
        path: appInfo.installPath,
        detectionHint: '已检测到桌面应用'
      }))
    })
  })

  it.each(['/Applications', path.join(os.homedir(), 'Applications')])(
    'detects WorkBuddy directly in %s when metadata scanning omits it',
    async (directory) => {
      vi.mocked(getMacInstalledApps).mockResolvedValue(apps.slice(1) as any)
      const appPath = path.join(directory, 'WorkBuddy.app')
      mockBundle(appPath)

      const result = await localMcpAgentService.detectAgents()
      expect(result.find((agent) => agent.id === 'workbuddy')).toMatchObject({
        installed: true,
        path: appPath,
        installType: 'app',
        detectionHint: '已直接检测到应用包'
      })
      expect(app.getApplicationInfoForProtocol).not.toHaveBeenCalled()
    }
  )

  it('detects WorkBuddy when scanned metadata has neither a name nor an identifier', async () => {
    vi.mocked(getMacInstalledApps).mockResolvedValue([
      { ...apps[0], appName: null, appIdentifier: null },
      ...apps.slice(1)
    ] as any)
    mockBundle('/Applications/WorkBuddy.app')

    const result = await localMcpAgentService.detectAgents()
    expect(result.find((agent) => agent.id === 'workbuddy')?.installed).toBe(true)
  })

  it('finds a renamed WorkBuddy outside application directories through its registered protocol', async () => {
    vi.mocked(getMacInstalledApps).mockResolvedValue(apps.slice(1) as any)
    const appPath = path.join(os.homedir(), 'Downloads', 'My WorkBuddy.app')
    vi.mocked(app.getApplicationInfoForProtocol).mockResolvedValue({ path: appPath } as any)
    mockBundle(appPath)

    const result = await localMcpAgentService.detectAgents()
    expect(app.getApplicationInfoForProtocol).toHaveBeenCalledWith('workbuddy://')
    expect(result.find((agent) => agent.id === 'workbuddy')).toMatchObject({
      installed: true,
      path: appPath,
      installType: 'protocol'
    })
  })

  it.each(['missing', 'stale', 'error', 'not-a-bundle'])(
    'does not report WorkBuddy as installed for a %s protocol lookup',
    async (scenario) => {
      vi.mocked(getMacInstalledApps).mockResolvedValue(apps.slice(1) as any)
      if (scenario === 'stale') {
        vi.mocked(app.getApplicationInfoForProtocol).mockResolvedValue({ path: '/Applications/Removed.app' } as any)
      } else if (scenario === 'error') {
        vi.mocked(app.getApplicationInfoForProtocol).mockRejectedValue(new Error('No handler'))
      } else if (scenario === 'not-a-bundle') {
        const appPath = '/Applications/NotAnApp'
        mockBundle(appPath)
        vi.mocked(app.getApplicationInfoForProtocol).mockResolvedValue({ path: appPath } as any)
      }

      const result = await localMcpAgentService.detectAgents()
      expect(result.find((agent) => agent.id === 'workbuddy')).toMatchObject({
        installed: false,
        path: null
      })
      expect(result.filter((agent) => agent.id !== 'workbuddy').every((agent) => agent.installed)).toBe(true)
    }
  )

  it('does not accept a directory masquerading as an Info.plist file', async () => {
    vi.mocked(getMacInstalledApps).mockResolvedValue(apps.slice(1) as any)
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false } as any)

    const result = await localMcpAgentService.detectAgents()
    expect(result.find((agent) => agent.id === 'workbuddy')?.installed).toBe(false)
  })

  it('keeps successful desktop matches ahead of all fallback checks', async () => {
    vi.mocked(getMacInstalledApps).mockResolvedValue(apps as any)
    const result = await localMcpAgentService.detectAgents()

    expect(result.every((agent) => agent.installed)).toBe(true)
    expect(fs.statSync).not.toHaveBeenCalled()
    expect(app.getApplicationInfoForProtocol).not.toHaveBeenCalled()
  })
})
