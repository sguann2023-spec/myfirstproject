import { loggerService } from '@logger'
import type { SlashCommand } from '@types'

import { sessionService } from '../../SessionService'

const logger = loggerService.withContext('ClaudeCodeSlashCommands')

export async function syncSlashCommandsFromSdk(input: {
  agentId: string
  sessionId: string
  sdkSlashCommands: string[]
}): Promise<void> {
  const { agentId, sessionId, sdkSlashCommands } = input

  logger.info('Received init message with slash commands', {
    sessionId,
    commands: sdkSlashCommands
  })

  try {
    const existingCommands = await sessionService.listSlashCommands('claude-code', agentId)
    const normalizedSdkCommands: SlashCommand[] = sdkSlashCommands.map((command) => ({
      command: command.startsWith('/') ? command : `/${command}`,
      description: undefined
    }))

    const commandMap = new Map<string, SlashCommand>()

    for (const command of existingCommands) {
      commandMap.set(command.command, command)
    }

    for (const command of normalizedSdkCommands) {
      if (!commandMap.has(command.command)) {
        commandMap.set(command.command, command)
      }
    }

    const mergedCommands = Array.from(commandMap.values())
    const existingCommandNames = existingCommands
      .map((command) => String(command.command || ''))
      .filter(Boolean)
      .sort()
    const sdkCommandNames = normalizedSdkCommands
      .map((command) => String(command.command || ''))
      .filter(Boolean)
      .sort()
    const mergedCommandNames = mergedCommands
      .map((command) => String(command.command || ''))
      .filter(Boolean)
      .sort()

    logger.info('Slash command source breakdown', {
      sessionId,
      agentId,
      existingCount: existingCommandNames.length,
      sdkCount: sdkCommandNames.length,
      mergedCount: mergedCommandNames.length,
      existingCommands: existingCommandNames,
      sdkCommands: sdkCommandNames,
      mergedCommands: mergedCommandNames
    })

    await sessionService.updateSession(agentId, sessionId, {
      slash_commands: mergedCommands
    })

    logger.info('Updated session with merged slash commands', {
      sessionId,
      existingCount: existingCommands.length,
      sdkCount: normalizedSdkCommands.length,
      totalCount: mergedCommands.length
    })
  } catch (error) {
    logger.error('Failed to update session slash_commands', {
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
