import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useApiServer } from '../useApiServer'
import { useAgentClient } from './useAgentClient'
import { useUpdateSession } from './useUpdateSession'

export const useSession = (agentId: string | null, sessionId: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const { apiServerConfig, apiServerRunning } = useApiServer()
  const key =
    apiServerConfig.enabled && apiServerRunning && agentId && sessionId
      ? client.getSessionPaths(agentId).withId(sessionId)
      : null
  const { updateSession } = useUpdateSession(agentId)

  const fetcher = async () => {
    if (!agentId) throw new Error(t('agent.get.error.null_id'))
    if (!sessionId) throw new Error(t('agent.session.get.error.null_id'))
    if (!apiServerConfig.enabled || !apiServerRunning) {
      throw new Error(t('apiServer.messages.notEnabled'))
    }
    const data = await client.getSession(agentId, sessionId)
    return data
  }
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  return {
    session: data,
    error,
    isLoading,
    updateSession,
    mutate
  }
}
