import type { ApiModel, ApiModelsFilter } from '@renderer/types'
import { merge } from 'lodash'
import { useCallback } from 'react'
import useSWR from 'swr'

import { useApiServer } from '../useApiServer'
import { useAgentClient } from './useAgentClient'

export const useApiModels = (filter?: ApiModelsFilter) => {
  const client = useAgentClient()
  const { apiServerConfig, apiServerRunning } = useApiServer()
  // const defaultFilter = { limit: -1 } satisfies ApiModelsFilter
  const defaultFilter = {} satisfies ApiModelsFilter
  const finalFilter = merge(filter, defaultFilter)
  const path = apiServerConfig.enabled && apiServerRunning ? client.getModelsPath(finalFilter) : null
  const fetcher = useCallback(async () => {
    if (!apiServerConfig.enabled || !apiServerRunning) {
      return { data: [], total: 0 }
    }
    const limit = finalFilter.limit || 100
    let offset = finalFilter.offset || 0
    const allModels: ApiModel[] = []
    let total = Infinity

    while (offset < total) {
      const pageFilter = { ...finalFilter, limit, offset }
      const res = await client.getModels(pageFilter)
      allModels.push(...(res.data || []))
      total = res.total ?? 0
      offset += limit
    }
    return { data: allModels, total }
  }, [apiServerConfig.enabled, apiServerRunning, client, finalFilter])
  const { data, error, isLoading } = useSWR(path, fetcher)
  return {
    models: data?.data ?? [],
    error,
    isLoading
  }
}
