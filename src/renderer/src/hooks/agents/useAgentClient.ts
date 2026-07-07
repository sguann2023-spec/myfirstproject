import { loggerService } from '@logger'
import { AgentApiClient } from '@renderer/api/agent'
import { useMemo } from 'react'

import { useSettings } from '../useSettings'

const logger = loggerService.withContext('useAgentClient')

const describeApiKey = (value?: string | null) => {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return {
      exists: false,
      length: 0,
      prefix: '',
      suffix: ''
    }
  }

  return {
    exists: true,
    length: normalized.length,
    prefix: normalized.slice(0, 6),
    suffix: normalized.slice(-6)
  }
}

export const useAgentClient = () => {
  const { apiServer } = useSettings()
  const { enabled, host, port, apiKey } = apiServer
  return useMemo(
    () => {
      if (!enabled) {
        logger.info('AgentApiClient disabled because API Server entry is turned off', { host, port })
      } else {
        logger.info('Creating AgentApiClient with apiServer config', {
          host,
          port,
          apiKey: describeApiKey(apiKey)
        })
      }

      return new AgentApiClient({
        baseURL: `http://${host}:${port}`,
        headers: {
          Authorization: `Bearer ${apiKey || 'disabled'}`
        }
      })
    },
    [enabled, host, port, apiKey]
  )
}
