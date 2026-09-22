import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMacInstalledApps } from 'node-get-installed-apps'
import { localMcpAgentService } from '../LocalMcpAgentService'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), info: vi.fn() }) }
}))
vi.mock('@main/apiServer', () => ({ apiServer: {} }))
vi.mock('@main/constant', () => ({ isMac: true, isWin: false }))
vi.mock('@shared/config/constant', () => ({ API_SERVER_DEFAULTS: { PORT: 18845 } }))
vi.mock('electron', () => ({ app: {} }))
vi.mock('node:fs', () => ({ default: { existsSync: () => false } }))
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
  beforeEach(() => vi.clearAllMocks())

  it('continues detecting system apps when the user Applications directory is absent', async () => {
    vi.mocked(getMacInstalledApps).mockImplementation(async (directory) => {
      if (directory === '/Applications') return apps as any
      throw Object.assign(new Error('missing directory'), { code: 'ENOENT' })
    })

    const result = await localMcpAgentService.detectAgents()
    expect(getMacInstalledApps).toHaveBeenCalledWith(path.join(os.homedir(), 'Applications'))
    expect(result).toHaveLength(5)
    expect(result.every((agent) => agent.installed)).toBe(true)
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
  })

  it('still detects apps when both directories are readable', async () => {
    vi.mocked(getMacInstalledApps).mockResolvedValue(apps as any)
    const result = await localMcpAgentService.detectAgents()
    expect(result).toHaveLength(5)
    expect(result.every((agent) => agent.installed)).toBe(true)
  })
})
