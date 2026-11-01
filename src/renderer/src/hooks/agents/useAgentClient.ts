import { AgentApiClient } from '@renderer/api/agent'
import { useAppSelector } from '@renderer/store'
import { API_SERVER_DEFAULTS } from '@shared/config/constant'
import { useMemo } from 'react'

export const useAgentClient = () => {
  const apiServer = useAppSelector((state) => state.settings.apiServer)
  const actualPort = useAppSelector((state) => state.runtime.apiServerPort)
  const isRunning = useAppSelector((state) => state.runtime.apiServerRunning)
  const { enabled, host, port: storedPort, apiKey } = apiServer
  const port = actualPort ?? storedPort ?? API_SERVER_DEFAULTS.PORT

  return useMemo(
    () =>
      new AgentApiClient({
        baseURL: `http://${host}:${port}`,
        headers: {
          Authorization: `Bearer ${apiKey || 'disabled'}`
        }
      }, undefined, async () => {
        const status = await window.api.apiServer.getStatus()
        const config = status.config
        if (!status.running || !config?.enabled || !config.apiKey || !status.actualPort) return null
        return {
          baseURL: `http://${config.host}:${status.actualPort}`,
          apiKey: config.apiKey
        }
      }),
    [apiKey, enabled, host, isRunning, port]
  )
}
