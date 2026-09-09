import { loggerService } from '@logger'
import { handleSaveData, useAppDispatch, useAppSelector } from '@renderer/store'
import { setApiServerPortAction, setApiServerRunningAction } from '@renderer/store/runtime'
import { API_SERVER_DEFAULTS } from '@shared/config/constant'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setApiServerApiKey, setApiServerEnabled as setApiServerEnabledAction } from '../store/settings'

const logger = loggerService.withContext('useApiServer')

// Module-level single instance subscription to prevent EventEmitter memory leak
// Only one IPC listener will be registered regardless of how many components use this hook
const onReadyCallbacks = new Set<() => void>()
let removeIpcListener: (() => void) | null = null
let recoveryStartPromise: Promise<void> | null = null

const ensureIpcSubscribed = () => {
  if (!removeIpcListener) {
    removeIpcListener = window.api.apiServer.onReady(() => {
      onReadyCallbacks.forEach((cb) => cb())
    })
  }
}

const cleanupIpcIfEmpty = () => {
  if (onReadyCallbacks.size === 0 && removeIpcListener) {
    removeIpcListener()
    removeIpcListener = null
  }
}

export const useApiServer = () => {
  const { t } = useTranslation()
  // FIXME: We currently store two copies of the config data in both the renderer and the main processes,
  // which carries the risk of data inconsistency. This should be modified so that the main process stores
  // the data, and the renderer retrieves it.
  const storedApiServerConfig = useAppSelector((state) => state.settings.apiServer)
  const apiServerPort = useAppSelector((state) => state.runtime.apiServerPort)
  const dispatch = useAppDispatch()

  const apiServerRunning = useAppSelector((state) => state.runtime.apiServerRunning)
  const apiServerKeyRef = useRef(String(storedApiServerConfig.apiKey || '').trim())
  // Is checking the API server status
  const [apiServerLoading, setApiServerLoading] = useState(true)
  const [apiServerPreferredPort, setApiServerPreferredPort] = useState<number | null>(null)

  const setApiServerRunning = useCallback(
    (running: boolean) => {
      dispatch(setApiServerRunningAction(running))
    },
    [dispatch]
  )

  const setResolvedApiServerPort = useCallback(
    (port: number | null) => {
      dispatch(setApiServerPortAction(port))
    },
    [dispatch]
  )

  const setApiServerEnabled = useCallback(
    (enabled: boolean) => {
      dispatch(setApiServerEnabledAction(enabled))
    },
    [dispatch]
  )

  const syncApiServerApiKey = useCallback(
    (apiKey?: string | null) => {
      const normalized = String(apiKey || '').trim()
      if (!normalized || normalized === apiServerKeyRef.current) {
        return
      }
      apiServerKeyRef.current = normalized
      dispatch(setApiServerApiKey(normalized))
    },
    [dispatch]
  )

  // API Server functions
  const checkApiServerStatus = useCallback(async () => {
    setApiServerLoading(true)
    try {
      const result = await window.api.apiServer.getStatus()
      syncApiServerApiKey(result?.config?.apiKey)
      setApiServerRunning(Boolean(result?.running))
      setApiServerEnabled(Boolean(result?.config?.enabled))
      setApiServerPreferredPort(Number(result?.config?.port) || null)
      setResolvedApiServerPort(Number(result?.actualPort) || null)
    } catch (error: any) {
      logger.error('Failed to check API server status:', error)
      setApiServerPreferredPort(null)
      setResolvedApiServerPort(null)
    } finally {
      setApiServerLoading(false)
    }
  }, [setApiServerEnabled, setApiServerLoading, setApiServerRunning, setResolvedApiServerPort, syncApiServerApiKey])

  const startApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      const result = await window.api.apiServer.start()
      if (!result?.success) {
        throw new Error('error' in result ? result.error : 'Unknown error')
      }
      setApiServerEnabled(true)
      await handleSaveData()
      await checkApiServerStatus()
    } catch (error: any) {
      window.toast.error(t('apiServer.messages.startError') + (error.message || error))
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, checkApiServerStatus, setApiServerEnabled, setApiServerLoading, t])

  const stopApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      const result = await window.api.apiServer.stop()
      if (!result?.success) {
        throw new Error('error' in result ? result.error : 'Unknown error')
      }
      setApiServerEnabled(false)
      setApiServerRunning(false)
      setResolvedApiServerPort(null)
      await handleSaveData()
    } catch (error: any) {
      window.toast.error(t('apiServer.messages.stopError') + (error.message || error))
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, setApiServerLoading, setApiServerRunning, setResolvedApiServerPort, t])

  const restartApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      const result = await window.api.apiServer.restart()
      if (!result?.success) {
        throw new Error('error' in result ? result.error : 'Unknown error')
      }
      setApiServerEnabled(true)
      await handleSaveData()
      await checkApiServerStatus()
    } catch (error) {
      window.toast.error(t('apiServer.messages.restartFailed') + (error as Error).message)
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, checkApiServerStatus, setApiServerEnabled, setApiServerLoading, t])

  useEffect(() => {
    apiServerKeyRef.current = String(storedApiServerConfig.apiKey || '').trim()
  }, [storedApiServerConfig.apiKey])

  useEffect(() => {
    void checkApiServerStatus()
  }, [checkApiServerStatus])

  // Use ref to keep the latest checkApiServerStatus without causing re-subscription
  const checkStatusRef = useRef(checkApiServerStatus)
  useEffect(() => {
    checkStatusRef.current = checkApiServerStatus
  })

  // Create stable callback for the single instance subscription
  const handleReady = useCallback(() => {
    void checkStatusRef.current()
  }, [])

  // Listen for API server ready event using single instance subscription
  useEffect(() => {
    if (!storedApiServerConfig.enabled) {
      dispatch(setApiServerEnabledAction(false))
      dispatch(setApiServerRunningAction(false))
      dispatch(setApiServerPortAction(null))
    }
  }, [storedApiServerConfig.enabled, dispatch])

  useEffect(() => {
    if (!storedApiServerConfig.enabled) {
      return
    }
    ensureIpcSubscribed()
    onReadyCallbacks.add(handleReady)

    return () => {
      onReadyCallbacks.delete(handleReady)
      cleanupIpcIfEmpty()
    }
  }, [handleReady, storedApiServerConfig.enabled])

  useEffect(() => {
    if (apiServerLoading || !storedApiServerConfig.enabled || apiServerRunning) {
      return
    }

    if (!recoveryStartPromise) {
      recoveryStartPromise = startApiServer().finally(() => {
        recoveryStartPromise = null
      })
    }
  }, [apiServerLoading, apiServerRunning, startApiServer, storedApiServerConfig.enabled])

  const apiServerConfig = {
    ...storedApiServerConfig,
    port: apiServerPort ?? apiServerPreferredPort ?? storedApiServerConfig.port ?? API_SERVER_DEFAULTS.PORT
  }

  return {
    apiServerConfig,
    apiServerRunning,
    apiServerLoading,
    apiServerPort,
    startApiServer,
    stopApiServer,
    restartApiServer,
    checkApiServerStatus,
    setApiServerEnabled
  }
}
