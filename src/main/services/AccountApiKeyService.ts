import { net } from 'electron'
import Store from 'electron-store'

import { findCachedAccountApiKey, normalizeAccountApiKey, normalizeAccountUserId } from '../../packages/shared/accountApiKey'
import { resolveClientType } from '../../packages/shared/network/clientMeta'
import { agentRuntimeAuthService } from './agents/services/AgentRuntimeAuthService'

const ACCOUNT_API_KEY_URL = 'https://open.vectcut.com/user_manager/get_token'

/** Service-issued, main-process-only owner snapshot. Contains no OAuth credentials. */
export type AccountApiKeySessionSnapshot = Readonly<{ userId: string; generation: number }>
export type AccountApiKeyResult = Readonly<{ key: string; owner: AccountApiKeySessionSnapshot }>

const hasRefreshToken = (value: unknown): boolean => typeof value === 'string' && Boolean(value.trim())

export class AccountApiKeyService {
  private readonly store = new Store({ name: 'vectcut', watch: true })
  private readonly snapshots = new WeakSet<AccountApiKeySessionSnapshot>()
  private readonly inflight = new Map<number, Promise<AccountApiKeyResult>>()
  private generation = 0
  private observedUserId = normalizeAccountUserId((this.store.get('user') as { id?: unknown } | undefined)?.id)
  private observedHasRefreshToken = hasRefreshToken(this.store.get('auth.refresh_token'))

  constructor() {
    // A refresh-token rotation is not an account change. Removal/user changes are,
    // including A -> signed-out/B -> A while an asynchronous export is pending.
    this.store.onDidChange('user', (user) => {
      this.observeSession(normalizeAccountUserId((user as { id?: unknown } | undefined)?.id), this.observedHasRefreshToken)
    })
    this.store.onDidChange('auth.refresh_token', (refreshToken) => {
      this.observeSession(this.observedUserId, hasRefreshToken(refreshToken))
    })
  }

  captureSession(): AccountApiKeySessionSnapshot {
    this.synchronizeSession()
    if (!this.observedUserId || !this.observedHasRefreshToken) {
      throw new Error('Please sign in before accessing your account API key')
    }
    const snapshot = Object.freeze({ userId: this.observedUserId, generation: this.generation })
    this.snapshots.add(snapshot)
    return snapshot
  }

  /** Call after every awaited export step, and immediately before exposing/writing a key. */
  assertSession(snapshot: AccountApiKeySessionSnapshot): void {
    this.synchronizeSession()
    if (
      !snapshot ||
      !this.snapshots.has(snapshot) ||
      !this.observedHasRefreshToken ||
      !this.observedUserId ||
      snapshot.userId !== this.observedUserId ||
      snapshot.generation !== this.generation
    ) {
      throw new Error('Account session changed; please retry for the current account')
    }
  }

  async getForCurrentSession(): Promise<AccountApiKeyResult> {
    const owner = this.captureSession()
    const user = (this.store.get('user') || {}) as Record<string, unknown>
    const cachedKey = findCachedAccountApiKey(
      [this.store.get('auth.vectcut_api_key'), user.agentApiKey, user.vectcutApiKey, user.apiKey],
      owner.userId
    )
    this.assertSession(owner)
    if (cachedKey) return Object.freeze({ key: cachedKey, owner })

    const pending = this.inflight.get(owner.generation)
    if (pending) return pending
    const task = this.fetchForSession(owner)
    this.inflight.set(owner.generation, task)
    try {
      return await task
    } finally {
      this.inflight.delete(owner.generation)
    }
  }

  private async fetchForSession(owner: AccountApiKeySessionSnapshot): Promise<AccountApiKeyResult> {
    try {
      // OAuth stays runtime-only: it authenticates this request, never becomes an API key.
      const accessToken = await agentRuntimeAuthService.ensureValidAccessToken()
      this.assertSession(owner)
      if (!accessToken) throw new Error('Missing runtime authentication')
      const response = await net.fetch(ACCOUNT_API_KEY_URL, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Client-Type': resolveClientType()
        },
        body: JSON.stringify({ user_id: owner.userId, login_type: 'authing' })
      })
      this.assertSession(owner)
      if (!response.ok) throw new Error('Account API key request failed')
      const data = (await response.json()) as { token?: unknown; api_key?: unknown } | null
      this.assertSession(owner)
      const key = normalizeAccountApiKey(data?.token, owner.userId) || normalizeAccountApiKey(data?.api_key, owner.userId)
      if (!key) throw new Error('Invalid account API key response')
      this.store.set('auth.vectcut_api_key', key)
      this.assertSession(owner)
      return Object.freeze({ key, owner })
    } catch {
      // Never forward raw transport/backend/runtime-auth errors: they can contain secrets.
      this.assertSession(owner)
      throw new Error('Unable to retrieve a long-lived API key for the current account')
    }
  }

  private synchronizeSession(): void {
    this.observeSession(
      normalizeAccountUserId((this.store.get('user') as { id?: unknown } | undefined)?.id),
      hasRefreshToken(this.store.get('auth.refresh_token'))
    )
  }

  private observeSession(userId: string, signedIn: boolean): void {
    if (userId !== this.observedUserId || signedIn !== this.observedHasRefreshToken) {
      this.generation += 1
      this.observedUserId = userId
      this.observedHasRefreshToken = signedIn
    }
  }
}

export const accountApiKeyService = new AccountApiKeyService()
