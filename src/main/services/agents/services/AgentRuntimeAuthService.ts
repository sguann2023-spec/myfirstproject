import Store from 'electron-store'
import { net } from 'electron'

const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'

type PendingToken = {
  accessToken: string
  expiresAt: number
}

export class AgentRuntimeAuthService {
  private readonly store = new Store({ name: 'vectcut', watch: true })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null
  private accessTokenSourceRefreshToken: string | null = null
  private refreshPromiseSourceRefreshToken: string | null = null

  constructor() {
    this.store.onDidChange('auth.refresh_token', (newValue) => {
      const normalizedNewValue = String(newValue || '').trim()
      const normalizedSourceRefreshToken = String(this.accessTokenSourceRefreshToken || '').trim()
      const matchesCurrentAccessTokenSource =
        Boolean(normalizedNewValue) &&
        Boolean(normalizedSourceRefreshToken) &&
        normalizedNewValue === normalizedSourceRefreshToken

      if (this.accessToken && !matchesCurrentAccessTokenSource) {
        this.invalidateCachedAccessToken()
      }
    })
  }

  async ensureValidAccessToken(forceRefresh = false): Promise<string> {
    const refreshToken = String(this.store.get('auth.refresh_token') || '').trim()
    const currentSourceRefreshToken = String(this.accessTokenSourceRefreshToken || '').trim()
    const matchesCurrentStoreRefreshToken =
      Boolean(refreshToken) && Boolean(currentSourceRefreshToken) && refreshToken === currentSourceRefreshToken

    if (this.accessToken && !matchesCurrentStoreRefreshToken) {
      this.invalidateCachedAccessToken()
    }

    if (!forceRefresh && this.accessToken && Date.now() < this.accessToken.expiresAt - 30_000) {
      return this.accessToken.accessToken
    }

    if (
      !forceRefresh &&
      this.refreshPromise &&
      refreshToken &&
      refreshToken === String(this.refreshPromiseSourceRefreshToken || '').trim()
    ) {
      return this.refreshPromise
    }
    if (!refreshToken) {
      throw new Error('No refresh token found, please sign in first')
    }

    this.refreshPromiseSourceRefreshToken = refreshToken
    this.refreshPromise = this.refreshAccessToken(refreshToken)
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
      this.refreshPromiseSourceRefreshToken = null
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET
    }).toString()

    const response = await net.fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Token refresh failed (${response.status}): ${text || 'unknown error'}`)
    }

    const payload = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    const accessToken = String(payload.access_token || '').trim()
    if (!accessToken) {
      throw new Error('Token refresh returned no access token')
    }

    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
    const nextStoredRefreshToken =
      typeof payload.refresh_token === 'string' && payload.refresh_token.trim() ? payload.refresh_token.trim() : refreshToken
    const currentStoreRefreshToken = String(this.store.get('auth.refresh_token') || '').trim()

    if (
      currentStoreRefreshToken &&
      currentStoreRefreshToken !== refreshToken &&
      currentStoreRefreshToken !== nextStoredRefreshToken
    ) {
      throw new Error('Refresh token changed during runtime access token refresh')
    }

    this.accessToken = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000
    }
    this.accessTokenSourceRefreshToken = nextStoredRefreshToken

    if (typeof payload.refresh_token === 'string' && payload.refresh_token.trim()) {
      this.store.set('auth.refresh_token', payload.refresh_token.trim())
    }
    this.store.set('auth.vectcut_api_key', accessToken)

    return accessToken
  }

  private invalidateCachedAccessToken() {
    this.accessToken = null
    this.accessTokenSourceRefreshToken = null
  }
}

export const agentRuntimeAuthService = new AgentRuntimeAuthService()
