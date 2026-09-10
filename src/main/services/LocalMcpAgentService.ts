import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

import { loggerService } from '@logger'
import { apiServer } from '@main/apiServer'
import type { LocalMcpDetectedAgent, SetLocalMcpAgentRegistrationResult } from '@types'
import { API_SERVER_DEFAULTS } from '@shared/config/constant'
import { app } from 'electron'
import { getMacInstalledApps, getWinInstalledApps, type ReturnData } from 'node-get-installed-apps'
import { isMac, isWin } from '@main/constant'

const logger = loggerService.withContext('LocalMcpAgentService')

const COMMAND_LOOKUP_TIMEOUT_MS = 1500
const TEN_DAYS_IN_MS = 10 * 24 * 60 * 60 * 1000
type MacInstalledApp = ReturnData<'darwin', 'mdls'> | ReturnData<'darwin', 'plutil'>
type WinInstalledApp = ReturnData<'win32', 'registry'>
type DesktopInstalledApp = MacInstalledApp | WinInstalledApp

type AgentDetectionSpec = {
  id: LocalMcpDetectedAgent['id']
  label: string
  desktopAppNames?: string[]
  desktopAppIdentifiers?: string[]
  commandNames?: string[]
  protocolAppId?: string
}

type DetectionResult = {
  installed: boolean
  path: string | null
  installType: LocalMcpDetectedAgent['installType']
  detectionHint: string
}

type RegistrationResult = {
  registrationSupported: boolean
  registrationStatus: LocalMcpDetectedAgent['registrationStatus']
  registrationHint: string
  registrationPath: string | null
}

const LOCAL_MCP_AGENT_SPECS: AgentDetectionSpec[] = [
  {
    id: 'workbuddy',
    label: 'WorkBuddy',
    desktopAppNames: ['WorkBuddy'],
    desktopAppIdentifiers: ['com.tencent.workbuddy.mac']
  },
  {
    id: 'claude_code',
    label: 'Claude Code',
    desktopAppNames: ['Claude', 'Claude Code'],
    commandNames: ['claude']
  },
  {
    id: 'cursor',
    label: 'Cursor',
    desktopAppNames: ['Cursor'],
    protocolAppId: 'cursor'
  },
  {
    id: 'codex_cli',
    label: 'Codex(ChatGPT)',
    desktopAppNames: ['Codex', 'ChatGPT'],
    desktopAppIdentifiers: ['com.openai.codex'],
    commandNames: ['codex']
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    commandNames: ['opencode'],
    desktopAppNames: ['OpenCode']
  }
]

const VECTCUT_MCP_SERVER_NAME = 'vectcut'
const CODEX_SERVER_SECTION_HEADER = `[mcp_servers.${VECTCUT_MCP_SERVER_NAME}]`
const LEGACY_CAPCUTHELPER_SERVER_SECTION_HEADER = '[mcp_servers.capcuthelper_desktop]'
const LEGACY_CAPCUTHELPER_SERVER_ENV_SECTION_HEADER = '[mcp_servers.capcuthelper_desktop.env]'
const LEGACY_CHATCUT_SERVER_SECTION_HEADER = '[mcp_servers.chatcut_desktop]'
const LEGACY_CHATCUT_SERVER_ENV_SECTION_HEADER = '[mcp_servers.chatcut_desktop.env]'

async function findCommandPathForDetection(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false
    const safeResolve = (value: string | null) => {
      if (resolved) return
      resolved = true
      resolve(value)
    }

    if (isWin) {
      const child = spawn('where', [command], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      })

      let output = ''
      const timeoutId = setTimeout(() => {
        child.kill('SIGKILL')
        safeResolve(null)
      }, COMMAND_LOOKUP_TIMEOUT_MS)

      child.stdout.on('data', (data) => {
        output += data.toString()
      })

      child.on('close', () => {
        clearTimeout(timeoutId)
        const paths = output
          .trim()
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean)
        const executablePath = paths.find((item) =>
          /\.(exe|cmd|bat|ps1)$/i.test(item)
        )
        safeResolve(executablePath || null)
      })

      child.on('error', () => {
        clearTimeout(timeoutId)
        safeResolve(null)
      })

      return
    }

    const child = spawn('/bin/sh', ['-c', 'command -v "$1"', '--', command], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore']
    })

    let output = ''
    const timeoutId = setTimeout(() => {
      child.kill('SIGKILL')
      safeResolve(null)
    }, COMMAND_LOOKUP_TIMEOUT_MS)

    child.stdout.on('data', (data) => {
      output += data.toString()
    })

    child.on('close', () => {
      clearTimeout(timeoutId)
      const commandPath = output.trim().split(/\r?\n/)[0]?.trim() || ''
      safeResolve(path.isAbsolute(commandPath) ? commandPath : null)
    })

    child.on('error', () => {
      clearTimeout(timeoutId)
      safeResolve(null)
    })
  })
}

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

function escapeTomlString(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getCodexConfigPath(): string {
  return path.join(os.homedir(), '.codex', 'config.toml')
}

function getWorkBuddyConfigPath(): string {
  return path.join(os.homedir(), '.workbuddy', 'mcp.json')
}

function getWorkBuddyApprovalsPath(): string {
  return path.join(os.homedir(), '.workbuddy', 'mcp-approvals.json')
}

function getLocalMcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/api/v1/mcp`
}

function calculateWorkBuddyConfigHash(entry: Record<string, unknown>): string {
  let raw = ''

  if (entry?.command) {
    const args = Array.isArray(entry.args) ? entry.args.map((arg) => String(arg)).sort() : []
    const envKeys = entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)
      ? Object.keys(entry.env).sort()
      : []
    raw = `${String(entry.command || '')}|${args.join(',')}|${envKeys.join(',')}`
  } else if (entry?.url) {
    try {
      raw = new URL(String(entry.url)).origin
    } catch {
      raw = String(entry.url)
    }
  } else {
    raw = JSON.stringify(entry)
  }

  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
}

function getWorkBuddyApprovalKey(entry: Record<string, unknown>, serverName: string): string {
  return `${calculateWorkBuddyConfigHash(entry)}::${serverName}`
}

function getWorkBuddyApprovalTimestamp(): number {
  return Date.now() - TEN_DAYS_IN_MS
}

function buildCodexRegistrationBlock(input: { url: string }): string {
  return [
    CODEX_SERVER_SECTION_HEADER,
    `url = "${escapeTomlString(input.url)}"`,
    ''
  ].join('\n')
}

function hasCodexRegistration(content: string): boolean {
  return content.includes(CODEX_SERVER_SECTION_HEADER)
}

function removeSectionBlocks(content: string, sectionHeaders: string[]): string {
  const lines = String(content || '').split(/\r?\n/)
  const output: string[] = []
  let skipping = false

  for (const line of lines) {
    const trimmed = line.trim()
    const isSectionStart = /^\[[^\]]+\]$/.test(trimmed)

    if (sectionHeaders.includes(trimmed)) {
      skipping = true
      continue
    }

    if (skipping && isSectionStart) {
      skipping = false
    }

    if (!skipping) {
      output.push(line)
    }
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trimEnd()
}

function removeCodexRegistrationBlock(content: string): string {
  return removeSectionBlocks(content, [
    CODEX_SERVER_SECTION_HEADER,
    LEGACY_CAPCUTHELPER_SERVER_SECTION_HEADER,
    LEGACY_CAPCUTHELPER_SERVER_ENV_SECTION_HEADER,
    LEGACY_CHATCUT_SERVER_SECTION_HEADER,
    LEGACY_CHATCUT_SERVER_ENV_SECTION_HEADER
  ])
}

function upsertCodexRegistrationBlock(content: string, input: { url: string }): string {
  const nextContent = removeCodexRegistrationBlock(content)
  const suffix = nextContent ? '\n\n' : ''
  return `${nextContent}${suffix}${buildCodexRegistrationBlock(input)}`.trimStart()
}

function getCodexRegistrationState(): RegistrationResult {
  const configPath = getCodexConfigPath()

  try {
    if (!fs.existsSync(configPath)) {
      return {
        registrationSupported: true,
        registrationStatus: 'not_registered',
        registrationHint: '可写入 Codex 配置',
        registrationPath: configPath
      }
    }

    const content = fs.readFileSync(configPath, 'utf8')
    const registered = hasCodexRegistration(content)
    return {
      registrationSupported: true,
      registrationStatus: registered ? 'registered' : 'not_registered',
      registrationHint: registered ? '已写入 Codex MCP 配置' : '可写入 Codex 配置',
      registrationPath: configPath
    }
  } catch (error) {
    logger.warn('Failed to read Codex registration state', { error, configPath })
    return {
      registrationSupported: true,
      registrationStatus: 'not_registered',
      registrationHint: 'Codex 配置读取失败',
      registrationPath: configPath
    }
  }
}

function hasWorkBuddyRegistration(content: string): boolean {
  try {
    const parsed = JSON.parse(String(content || '{}'))
    const entry = parsed?.mcpServers?.[VECTCUT_MCP_SERVER_NAME]
    return Boolean(entry && typeof entry === 'object' && entry.url)
  } catch {
    return false
  }
}

function hasWorkBuddyApproval(content: string, entry: Record<string, unknown> | null): boolean {
  if (!entry) return false

  try {
    const parsed = JSON.parse(String(content || '{}'))
    const approvalKey = getWorkBuddyApprovalKey(entry, VECTCUT_MCP_SERVER_NAME)
    return Number.isFinite(Number(parsed?.[approvalKey])) || typeof parsed?.[approvalKey] === 'string'
  } catch {
    return false
  }
}

function getWorkBuddyRegistrationState(): RegistrationResult {
  const configPath = getWorkBuddyConfigPath()
  const approvalsPath = getWorkBuddyApprovalsPath()

  try {
    if (!fs.existsSync(configPath) || !fs.existsSync(approvalsPath)) {
      return {
        registrationSupported: true,
        registrationStatus: 'not_registered',
        registrationHint: '可写入 ~/.workbuddy/mcp.json 与 mcp-approvals.json',
        registrationPath: configPath
      }
    }

    const configContent = fs.readFileSync(configPath, 'utf8')
    const approvalsContent = fs.readFileSync(approvalsPath, 'utf8')
    const config = JSON.parse(String(configContent || '{}'))
    const entry = config?.mcpServers?.[VECTCUT_MCP_SERVER_NAME]
    const registered = hasWorkBuddyRegistration(configContent) && hasWorkBuddyApproval(approvalsContent, entry)
    return {
      registrationSupported: true,
      registrationStatus: registered ? 'registered' : 'not_registered',
      registrationHint: registered ? '已写入 ~/.workbuddy/mcp.json 与 mcp-approvals.json' : '可写入 ~/.workbuddy/mcp.json 与 mcp-approvals.json',
      registrationPath: configPath
    }
  } catch (error) {
    logger.warn('Failed to read WorkBuddy registration state', { error, configPath })
    return {
      registrationSupported: true,
      registrationStatus: 'not_registered',
      registrationHint: 'WorkBuddy 配置读取失败（~/.workbuddy/mcp.json / mcp-approvals.json）',
      registrationPath: configPath
    }
  }
}

function getRegistrationResult(agentId: LocalMcpDetectedAgent['id']): RegistrationResult {
  if (agentId === 'workbuddy') {
    return getWorkBuddyRegistrationState()
  }

  if (agentId === 'codex_cli') {
    return getCodexRegistrationState()
  }

  return {
    registrationSupported: false,
    registrationStatus: 'unsupported',
    registrationHint: '暂不支持自动注册',
    registrationPath: null
  }
}

function dedupeDesktopApps(apps: DesktopInstalledApp[]): DesktopInstalledApp[] {
  const seen = new Set<string>()
  return apps.filter((appInfo) => {
    const dedupeKey = [normalizeText(appInfo.appIdentifier), normalizeText(appInfo.appName), normalizeText(appInfo.installPath)].join('::')
    if (seen.has(dedupeKey)) {
      return false
    }
    seen.add(dedupeKey)
    return true
  })
}

function getDesktopAppMatchPath(appInfo: DesktopInstalledApp): string | null {
  if (typeof appInfo.installPath === 'string' && appInfo.installPath.trim()) {
    return appInfo.installPath.trim()
  }
  return null
}

function findMatchedDesktopApp(
  desktopApps: DesktopInstalledApp[],
  spec: Pick<AgentDetectionSpec, 'desktopAppIdentifiers' | 'desktopAppNames'>
): DesktopInstalledApp | null {
  return desktopApps.find((appInfo) => {
    const appIdentifier = normalizeText(appInfo.appIdentifier)
    const appName = normalizeText(appInfo.appName)

    const matchesIdentifier = Array.isArray(spec.desktopAppIdentifiers)
      && spec.desktopAppIdentifiers.some((identifier) => normalizeText(identifier) === appIdentifier)
    if (matchesIdentifier) {
      return true
    }

    return Array.isArray(spec.desktopAppNames)
      && spec.desktopAppNames.some((candidateName) => {
        const normalizedCandidate = normalizeText(candidateName)
        return appName === normalizedCandidate || appName.includes(normalizedCandidate)
      })
  }) || null
}

async function getInstalledDesktopApps(): Promise<DesktopInstalledApp[]> {
  if (isMac) {
    const [systemApps, userApps] = await Promise.all([
      getMacInstalledApps('/Applications') as Promise<MacInstalledApp[]>,
      getMacInstalledApps(path.join(os.homedir(), 'Applications')) as Promise<MacInstalledApp[]>
    ])

    return dedupeDesktopApps([
      ...(Array.isArray(systemApps) ? systemApps : []),
      ...(Array.isArray(userApps) ? userApps : [])
    ])
  }

  if (isWin) {
    const windowsApps = await getWinInstalledApps() as WinInstalledApp[]
    return dedupeDesktopApps(Array.isArray(windowsApps) ? windowsApps : [])
  }

  return []
}

class LocalMcpAgentService {
  hasPersistentRegistration(): boolean {
    return (
      getWorkBuddyRegistrationState().registrationStatus === 'registered'
      || getCodexRegistrationState().registrationStatus === 'registered'
    )
  }

  async detectAgents(): Promise<LocalMcpDetectedAgent[]> {
    const desktopApps = await getInstalledDesktopApps()
    const agents = await Promise.all(
      LOCAL_MCP_AGENT_SPECS.map(async (spec) => {
        const detection = await this.detectSingleAgent(spec, desktopApps)
        const registration = getRegistrationResult(spec.id)
        return {
          id: spec.id,
          label: spec.label,
          status: detection.installed ? 'installed' : 'not_installed',
          installed: detection.installed,
          installType: detection.installType,
          detectionHint: detection.detectionHint,
          path: detection.path,
          registrationSupported: registration.registrationSupported,
          registrationStatus: registration.registrationStatus,
          registrationHint: registration.registrationHint,
          registrationPath: registration.registrationPath
        } satisfies LocalMcpDetectedAgent
      })
    )

    logger.info('Detected local MCP agents', {
      detected: agents.map((agent) => ({ id: agent.id, installed: agent.installed, path: agent.path }))
    })

    return agents
  }

  async setAgentRegistration(
    agentId: LocalMcpDetectedAgent['id'],
    enabled: boolean
  ): Promise<SetLocalMcpAgentRegistrationResult> {
    try {
      if (agentId === 'workbuddy') {
        const configPath = getWorkBuddyConfigPath()
        const approvalsPath = getWorkBuddyApprovalsPath()
        const parentDir = path.dirname(configPath)
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true })
        }

        const currentContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '{}'
        const currentConfig = currentContent.trim() ? JSON.parse(currentContent) : {}
        const nextConfig = currentConfig && typeof currentConfig === 'object' && !Array.isArray(currentConfig)
          ? { ...currentConfig }
          : {}
        const currentMcpServers = nextConfig.mcpServers && typeof nextConfig.mcpServers === 'object' && !Array.isArray(nextConfig.mcpServers)
          ? { ...nextConfig.mcpServers }
          : {}

        if (enabled) {
          const runningPort = apiServer.getListeningPort()
          if (!runningPort) {
            return {
              success: false,
              error: '本地 MCP 服务未启动，无法写入动态 endpoint'
            }
          }

          const url = getLocalMcpUrl(Number(runningPort || API_SERVER_DEFAULTS.PORT) || API_SERVER_DEFAULTS.PORT)
          currentMcpServers[VECTCUT_MCP_SERVER_NAME] = { url }
        } else {
          delete currentMcpServers[VECTCUT_MCP_SERVER_NAME]
        }
        nextConfig.mcpServers = currentMcpServers

        fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')

        const currentApprovalsContent = fs.existsSync(approvalsPath) ? fs.readFileSync(approvalsPath, 'utf8') : '{}'
        const currentApprovals = currentApprovalsContent.trim() ? JSON.parse(currentApprovalsContent) : {}
        const nextApprovals = currentApprovals && typeof currentApprovals === 'object' && !Array.isArray(currentApprovals)
          ? { ...currentApprovals }
          : {}

        Object.keys(nextApprovals).forEach((key) => {
          if (key.endsWith(`::${VECTCUT_MCP_SERVER_NAME}`)) {
            delete nextApprovals[key]
          }
        })

        const workBuddyEntry = currentMcpServers[VECTCUT_MCP_SERVER_NAME]
        if (enabled && workBuddyEntry && typeof workBuddyEntry === 'object') {
          nextApprovals[getWorkBuddyApprovalKey(workBuddyEntry, VECTCUT_MCP_SERVER_NAME)] = getWorkBuddyApprovalTimestamp()
        }

        fs.writeFileSync(approvalsPath, `${JSON.stringify(nextApprovals, null, 2)}\n`, 'utf8')

        logger.info('Updated WorkBuddy MCP registration', {
          enabled,
          configPath,
          approvalsPath,
          registration: currentMcpServers[VECTCUT_MCP_SERVER_NAME] || null
        })

        return { success: true }
      }

      if (agentId === 'codex_cli') {
        const runningPort = apiServer.getListeningPort()
        if (!runningPort && enabled) {
          return {
            success: false,
            error: '本地 MCP 服务未启动，无法写入动态 endpoint'
          }
        }

        const url = getLocalMcpUrl(Number(runningPort || API_SERVER_DEFAULTS.PORT) || API_SERVER_DEFAULTS.PORT)
        const configPath = getCodexConfigPath()
        const parentDir = path.dirname(configPath)
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true })
        }

        const currentContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
        const nextContent = enabled
          ? upsertCodexRegistrationBlock(currentContent, { url })
          : removeCodexRegistrationBlock(currentContent)

        fs.writeFileSync(configPath, nextContent ? `${nextContent}\n` : '', 'utf8')

        logger.info('Updated Codex MCP registration', {
          enabled,
          configPath,
          url
        })

        return { success: true }
      }

      return {
        success: false,
        error: '当前 Agent 暂不支持自动注册'
      }
    } catch (error) {
      logger.error('Failed to update local MCP registration', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async detectSingleAgent(spec: AgentDetectionSpec, desktopApps: DesktopInstalledApp[]): Promise<DetectionResult> {
    const desktopApp = findMatchedDesktopApp(desktopApps, spec)
    if (desktopApp) {
      return {
        installed: true,
        path: getDesktopAppMatchPath(desktopApp),
        installType: 'app',
        detectionHint: '已检测到桌面应用'
      }
    }

    if (spec.protocolAppId) {
      try {
        const protocolApp = await app.getApplicationInfoForProtocol(`${spec.protocolAppId}://`)
        if (protocolApp?.path) {
          return {
            installed: true,
            path: protocolApp.path,
            installType: 'protocol',
            detectionHint: '已检测到桌面应用'
          }
        }
      } catch {
        // Ignore protocol lookup failures and continue to other detection methods.
      }
    }

    if (spec.commandNames?.length) {
      for (const commandName of spec.commandNames) {
        const commandPath = await findCommandPathForDetection(commandName)
        if (commandPath) {
          return {
            installed: true,
            path: commandPath,
            installType: 'cli',
            detectionHint: '已检测到命令行工具'
          }
        }
      }
    }

    if (spec.commandNames?.length) {
      return {
        installed: false,
        path: null,
        installType: 'cli',
        detectionHint: '未检测到桌面应用或命令行工具'
      }
    }

    return {
      installed: false,
      path: null,
      installType: spec.protocolAppId ? 'protocol' : 'app',
      detectionHint: '未检测到桌面应用'
    }
  }
}

export const localMcpAgentService = new LocalMcpAgentService()
