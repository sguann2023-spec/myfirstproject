import { net } from 'electron'
import { isVectcutApiUrl, withClientTypeHeader } from '@shared/network/clientMeta'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type ElectronFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const MAIN_HTTP_CLIENT_INSTALLED = Symbol.for('vectcut.mainHttpClient.installed')

const buildRequestInit = (input: RequestInfo | URL, init: RequestInit = {}) => {
  if (!isVectcutApiUrl(input)) return init

  const requestHeaders = typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined
  const headers = withClientTypeHeader(init.headers || requestHeaders)

  return {
    ...init,
    headers
  }
}

export const mainHttpClient = {
  fetch(input: RequestInfo | URL, init: RequestInit = {}) {
    return net.fetch(input as RequestInfo, buildRequestInit(input, init))
  },

  globalFetch(input: RequestInfo | URL, init: RequestInit = {}) {
    return fetch(input, buildRequestInit(input, init))
  },

  buildRequestInit
}

export const installMainHttpClient = () => {
  const state = globalThis as typeof globalThis & { [MAIN_HTTP_CLIENT_INSTALLED]?: boolean }
  if (state[MAIN_HTTP_CLIENT_INSTALLED]) return
  state[MAIN_HTTP_CLIENT_INSTALLED] = true

  const originalNetFetch = net.fetch.bind(net) as ElectronFetchLike
  ;(net as typeof net & { fetch: ElectronFetchLike }).fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    return originalNetFetch(input as RequestInfo, buildRequestInit(input, init))
  }

  if (typeof globalThis.fetch === 'function') {
    const originalGlobalFetch = globalThis.fetch.bind(globalThis) as FetchLike
    globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
      return originalGlobalFetch(input, buildRequestInit(input, init))
    }) as typeof fetch
  }
}
