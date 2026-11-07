import type { GetAgentResponse } from '@renderer/types'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useApiServer } from '../useApiServer'
import { useAgentClient } from './useAgentClient'

// SWR mutations can be requested by several mounted consumers at once.
const agentRequests = new Map<string, Promise<GetAgentResponse>>()

export const useAgent = (id: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = id ? client.agentPaths.withId(id) : null
  const { apiServerConfig, apiServerRunning } = useApiServer()

  // Disable SWR fetching when server is not running by setting key to null
  const swrKey = apiServerRunning && id ? key : null

  const fetcher = useCallback(async () => {
    if (!id) {
      throw new Error(t('agent.get.error.null_id'))
    }
    if (!apiServerConfig.enabled) {
      throw new Error(t('apiServer.messages.notEnabled'))
    }
    const requestKey = client.agentPaths.withId(id)
    const pending = agentRequests.get(requestKey)
    if (pending) return pending
    const request = client.getAgent(id)
    agentRequests.set(requestKey, request)
    try {
      return await request
    } finally {
      if (agentRequests.get(requestKey) === request) agentRequests.delete(requestKey)
    }
  }, [apiServerConfig.enabled, client, id, t])
  const {
    data,
    error,
    isLoading,
    mutate: revalidate
  } = useSWR(swrKey, fetcher, {
    // Agent config may be modified externally (e.g. claw MCP tool in main process),
    // so always revalidate on mount and reduce dedup window to get fresh data.
    revalidateOnMount: true,
    dedupingInterval: 2000,
    shouldRetryOnError: false
  })

  const [toolsTimedOut, setToolsTimedOut] = useState(false)
  const [retryGeneration, setRetryGeneration] = useState(0)
  const toolsLoading = data?.tools_loading === true && !data?.tools_error

  useEffect(() => {
    setToolsTimedOut(false)
    if (!swrKey || !toolsLoading || error) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    // Schedule only after the previous request settles, and cap the entire window.
    const deadline = setTimeout(() => {
      cancelled = true
      clearTimeout(timer)
      setToolsTimedOut(true)
    }, 30_000)
    const poll = async () => {
      try {
        const agent = await revalidate()
        if (cancelled || !agent?.tools_loading || agent.tools_error) return
        timer = setTimeout(poll, 2_000)
      } catch {
        if (!cancelled) setToolsTimedOut(true)
      }
    }
    timer = setTimeout(poll, 2_000)
    return () => {
      cancelled = true
      clearTimeout(timer)
      clearTimeout(deadline)
    }
  }, [swrKey, toolsLoading, error, revalidate, retryGeneration])

  const retryTools = useCallback(async () => {
    setToolsTimedOut(false)
    setRetryGeneration((generation) => generation + 1)
    await revalidate()
  }, [revalidate])

  return {
    toolsTimedOut,
    retryTools,
    agent: data,
    error,
    isLoading,
    revalidate
  }
}
