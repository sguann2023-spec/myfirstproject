import { createHash } from 'node:crypto'

type AuthStore = { get: (key: string) => unknown }

export function getStoredVectcutApiKey(store: AuthStore): string {
  const user = store.get('user') as Record<string, unknown> | undefined
  const candidates = [
    store.get('auth.vectcut_api_key'), user?.agentApiKey, user?.vectcutApiKey, user?.apiKey,
    process.env.VECTCUT_API_KEY, process.env.VECTCUT_APIKEY
  ]
  return String(candidates.find((value) => typeof value === 'string' && value.trim()) || '').trim()
}

export function getVectcutBackgroundAccountId(store: AuthStore): string {
  const user = store.get('user') as Record<string, unknown> | undefined
  const userId = String(user?.id || store.get('settings.userId') || '').trim()
  if (userId) return userId
  const apiKey = getStoredVectcutApiKey(store)
  // API-key-only clients have no login profile; isolate their jobs without persisting the key.
  return apiKey ? `api-key:${createHash('sha256').update(apiKey).digest('hex')}` : ''
}

export async function requestWithVectcutAuth(
  store: AuthStore,
  refreshToken: (force?: boolean) => Promise<string>,
  fetchWithToken: (token: string) => Promise<Response>
): Promise<Response> {
  let token: string
  try {
    token = await refreshToken()
  } catch (error) {
    token = getStoredVectcutApiKey(store)
    if (!token) throw error
  }
  let response = await fetchWithToken(token)
  if (response.status === 401) {
    let refreshed: string
    try {
      refreshed = await refreshToken(true)
    } catch {
      refreshed = getStoredVectcutApiKey(store)
    }
    if (!refreshed || refreshed === token) return response
    response = await fetchWithToken(refreshed)
    const apiKey = getStoredVectcutApiKey(store)
    if (response.status === 401 && apiKey && apiKey !== refreshed && apiKey !== token) {
      response = await fetchWithToken(apiKey)
    }
  }
  return response
}
