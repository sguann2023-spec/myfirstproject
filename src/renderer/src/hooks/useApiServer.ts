import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setApiServerRunningAction } from '@renderer/store/runtime'
import { setApiServerEnabled as setApiServerEnabledAction } from '@renderer/store/settings'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useApiServer')
const API_SERVER_DISABLED_MESSAGE = 'API Server has been disabled in this build.'

// Module-level single instance subscription to prevent EventEmitter memory leak
// Only one IPC listener will be registered regardless of how many components use this hook
const onReadyCallbacks = new Set<() => void>()
let removeIpcListener: (() => void) | null = null

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
  const apiServerConfig = {
    ...storedApiServerConfig,
    enabled: false
  }
  const dispatch = useAppDispatch()

  const apiServerRunning = false
  // Is checking the API server status
  const [apiServerLoading, setApiServerLoading] = useState(true)

  const setApiServerRunning = useCallback(
    (running: boolean) => {
      dispatch(setApiServerRunningAction(running))
    },
    [dispatch]
  )

  const setApiServerEnabled = useCallback(
    (enabled: boolean) => {
      dispatch(setApiServerEnabledAction(enabled))
    },
    [dispatch]
  )

  // API Server functions
  const checkApiServerStatus = useCallback(async () => {
    setApiServerLoading(true)
    try {
      setApiServerRunning(false)
      setApiServerEnabled(false)
    } catch (error: any) {
      logger.error('Failed to check API server status:', error)
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerConfig.enabled, setApiServerEnabled, setApiServerLoading, setApiServerRunning])

  const startApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      setApiServerRunning(false)
      setApiServerEnabled(false)
      window.toast.error(API_SERVER_DISABLED_MESSAGE)
    } catch (error: any) {
      window.toast.error(t('apiServer.messages.startError') + (error.message || error))
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, setApiServerEnabled, setApiServerLoading, setApiServerRunning, t])

  const stopApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      setApiServerRunning(false)
      setApiServerEnabled(false)
    } catch (error: any) {
      window.toast.error(t('apiServer.messages.stopError') + (error.message || error))
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, setApiServerEnabled, setApiServerLoading, setApiServerRunning, t])

  const restartApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      setApiServerRunning(false)
      setApiServerEnabled(false)
      window.toast.error(API_SERVER_DISABLED_MESSAGE)
    } catch (error) {
      window.toast.error(t('apiServer.messages.restartFailed') + (error as Error).message)
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, checkApiServerStatus, setApiServerEnabled, setApiServerLoading, t])

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
    logger.info('API server ready event received, checking status')
    void checkStatusRef.current()
  }, [])

  // Listen for API server ready event using single instance subscription
  useEffect(() => {
    if (!apiServerConfig.enabled) {
      dispatch(setApiServerEnabledAction(false))
      dispatch(setApiServerRunningAction(false))
    }
  }, [apiServerConfig.enabled, dispatch])

  useEffect(() => {
    if (!apiServerConfig.enabled) {
      return
    }
    ensureIpcSubscribed()
    onReadyCallbacks.add(handleReady)

    return () => {
      onReadyCallbacks.delete(handleReady)
      cleanupIpcIfEmpty()
    }
  }, [handleReady])

  return {
    apiServerConfig,
    apiServerRunning,
    apiServerLoading,
    startApiServer,
    stopApiServer,
    restartApiServer,
    checkApiServerStatus,
    setApiServerEnabled
  }
}
