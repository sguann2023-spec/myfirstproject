import * as fs from 'node:fs'
import path from 'node:path'

import type { SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ClaudeCodeRuntimePlugins')

export async function discoverClaudeCodePlugins(input: {
  cwd: string
  enabled: boolean
  agentId: string
  sessionId: string
}): Promise<SdkPluginConfig[] | undefined> {
  const { cwd, enabled, agentId, sessionId } = input

  if (!enabled) {
    logger.info('[ToolRouter] skipped plugin discovery without workspace access', {
      agentId,
      sessionId
    })
    return undefined
  }

  try {
    const pluginsDir = path.join(cwd, '.claude', 'plugins')
    const entries = await fs.promises.readdir(pluginsDir, { withFileTypes: true }).catch(() => [])
    const pluginPaths: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(pluginsDir, entry.name, '.claude-plugin', 'plugin.json')
      try {
        await fs.promises.access(manifestPath, fs.constants.R_OK)
        pluginPaths.push(path.join(pluginsDir, entry.name))
      } catch {
        // No manifest, skip
      }
    }

    if (pluginPaths.length === 0) {
      return undefined
    }

    return pluginPaths.map((pluginPath) => ({ type: 'local', path: pluginPath }))
  } catch (error) {
    logger.warn('Failed to load plugin packages for Claude Code', {
      agentId,
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}
