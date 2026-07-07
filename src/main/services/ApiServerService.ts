import { IpcChannel } from '@shared/IpcChannel'
import type {
  ApiServerConfig,
  GetApiServerStatusResult,
  RestartApiServerStatusResult,
  StartApiServerStatusResult,
  StopApiServerStatusResult
} from '@types'
import { ipcMain } from 'electron'

import { apiServer } from '../apiServer'
import { config } from '../apiServer/config'
import { loggerService } from './LoggerService'
const logger = loggerService.withContext('ApiServerService')

const API_SERVER_DISABLED_MESSAGE = 'API Server has been disabled in this build.'

export class ApiServerService {
  constructor() {
    // Use the new clean implementation
  }

  async start(): Promise<void> {
    logger.warn(API_SERVER_DISABLED_MESSAGE)
    throw new Error(API_SERVER_DISABLED_MESSAGE)
  }

  async stop(): Promise<void> {
    try {
      await apiServer.stop()
      logger.info('API Server stopped successfully')
    } catch (error: any) {
      logger.error('Failed to stop API Server:', error)
      throw error
    }
  }

  async restart(): Promise<void> {
    logger.warn(API_SERVER_DISABLED_MESSAGE)
    throw new Error(API_SERVER_DISABLED_MESSAGE)
  }

  isRunning(): boolean {
    return apiServer.isRunning()
  }

  async getCurrentConfig(): Promise<ApiServerConfig> {
    const currentConfig = await config.get()
    return {
      ...currentConfig,
      enabled: false
    }
  }

  registerIpcHandlers(): void {
    // API Server
    ipcMain.handle(IpcChannel.ApiServer_Start, async (): Promise<StartApiServerStatusResult> => {
      try {
        await this.start()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiServer_Stop, async (): Promise<StopApiServerStatusResult> => {
      try {
        await this.stop()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiServer_Restart, async (): Promise<RestartApiServerStatusResult> => {
      try {
        await this.restart()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiServer_GetStatus, async (): Promise<GetApiServerStatusResult> => {
      try {
        const config = await this.getCurrentConfig()
        return {
          running: this.isRunning(),
          config
        }
      } catch (error: any) {
        return {
          running: this.isRunning(),
          config: null
        }
      }
    })

    ipcMain.handle(IpcChannel.ApiServer_GetConfig, async () => {
      try {
        return this.getCurrentConfig()
      } catch (error: any) {
        return null
      }
    })
  }
}

// Export singleton instance
export const apiServerService = new ApiServerService()
