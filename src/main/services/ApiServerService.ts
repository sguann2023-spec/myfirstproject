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

export class ApiServerService {
  constructor() {
    // Use the new clean implementation
  }

  async start(): Promise<void> {
    await apiServer.start()
    logger.info('API Server started successfully')
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
    await apiServer.restart()
    logger.info('API Server restarted successfully')
  }

  isRunning(): boolean {
    return apiServer.isRunning()
  }

  async getCurrentConfig(): Promise<ApiServerConfig> {
    return await config.reload()
  }

  getListeningPort(): number | null {
    return apiServer.getListeningPort()
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
          config,
          actualPort: this.getListeningPort()
        }
      } catch (error: any) {
        return {
          running: this.isRunning(),
          config: null,
          actualPort: this.getListeningPort()
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
