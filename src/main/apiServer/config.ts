import { API_SERVER_DEFAULTS } from '@shared/config/constant'
import type { ApiServerConfig } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { reduxService } from '../services/ReduxService'

const normalizeApiServerPort = (port?: number | null): number => {
  const numericPort = Number(port)
  if (
    Number.isInteger(numericPort)
    && numericPort >= API_SERVER_DEFAULTS.PORT
    && numericPort <= API_SERVER_DEFAULTS.MAX_PORT
  ) {
    return numericPort
  }

  return API_SERVER_DEFAULTS.PORT
}

class ConfigManager {
  private _config: ApiServerConfig | null = null

  private generateApiKey(): string {
    return `cs-sk-${uuidv4()}`
  }

  async load(): Promise<ApiServerConfig> {
    try {
      const settings = await reduxService.select('state.settings')
      const serverSettings = settings?.apiServer
      let apiKey = serverSettings?.apiKey
      if (!apiKey || apiKey.trim() === '') {
        apiKey = this.generateApiKey()
        await reduxService.dispatch({
          type: 'settings/setApiServerApiKey',
          payload: apiKey
        })
      }
      this._config = {
        enabled: true,
        port: normalizeApiServerPort(serverSettings?.port),
        host: serverSettings?.host ?? API_SERVER_DEFAULTS.HOST,
        apiKey: apiKey
      }
      return this._config
    } catch (error: any) {
      this._config = {
        enabled: true,
        port: normalizeApiServerPort(API_SERVER_DEFAULTS.PORT),
        host: API_SERVER_DEFAULTS.HOST,
        apiKey: this.generateApiKey()
      }
      return this._config
    }
  }

  async get(): Promise<ApiServerConfig> {
    if (!this._config) {
      await this.load()
    }
    if (!this._config) {
      throw new Error('Failed to load API server configuration')
    }
    return this._config
  }

  async reload(): Promise<ApiServerConfig> {
    return await this.load()
  }
}

export const config = new ConfigManager()
