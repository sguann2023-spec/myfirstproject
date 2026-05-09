import { makeAutoObservable, runInAction } from 'mobx';
import { getStorage, setStorage, removeStorage } from './storage';
import { refreshTokensRequest } from './authClient';
import { loggerService } from '@logger';
const logger = loggerService.withContext('TokenStore');
class TokenStore {
  idToken = null;
  accessToken = null;
  refreshToken = getStorage('auth.refresh_token') || null;
  accessTokenExpiresAt = null;
  idTokenExpiresAt = null;
  isRefreshing = false;
  refreshPromise = null;

  constructor() {
    makeAutoObservable(this);
  }

  setTokens({
    idToken,
    accessToken,
    refreshToken,
    accessTokenExpiresIn,
    idTokenExpiresIn,
  }) {
    if (idToken) this.idToken = idToken;
    if (accessToken) this.accessToken = accessToken;

    if (typeof accessTokenExpiresIn === 'number') {
      this.accessTokenExpiresAt = Date.now() + accessTokenExpiresIn * 1000;
    }
    if (typeof idTokenExpiresIn === 'number') {
      this.idTokenExpiresAt = Date.now() + idTokenExpiresIn * 1000;
    }

    if (refreshToken) {
      this.refreshToken = refreshToken;
      logger.debug('set refreshToken', refreshToken);
      setStorage('auth.refresh_token', refreshToken);
    }
  }

  clearTokens() {
    this.idToken = null;
    this.accessToken = null;
    this.accessTokenExpiresAt = null;
    this.idTokenExpiresAt = null;
    this.isRefreshing = false;
  }

  signOut() {
    this.clearTokens();
    this.refreshToken = null;
    removeStorage('auth.refresh_token');
  }

  get isAuthenticated() {
    const notExpired =
      !this.accessTokenExpiresAt || Date.now() < this.accessTokenExpiresAt;
    return Boolean(this.accessToken && notExpired);
  }

  async ensureValidAccessToken() {
    if (this.isAuthenticated) return this.accessToken;

    // 兜底：内存缺失时从 localStorage 读取
    const rt = this.refreshToken || getStorage('auth.refresh_token');
    if (!rt) return null;
    if (this.isRefreshing && this.refreshPromise) {
      await this.refreshPromise;
      return this.accessToken;
    }
    this.refreshToken = rt;

    this.isRefreshing = true;
    try {
      this.refreshPromise = (async () => {
        const res = await refreshTokensRequest(this.refreshToken);
        runInAction(() => {
          this.setTokens({
            accessToken: res.access_token,
            idToken: res.id_token,
            refreshToken: res.refresh_token || this.refreshToken,
            accessTokenExpiresIn: res.expires_in,
          });
        });
      })();
      await this.refreshPromise;
      return this.accessToken;
    } catch (e) {
      runInAction(() => {
        this.signOut();
      });
      throw e;
    } finally {
      runInAction(() => {
        this.isRefreshing = false;
        this.refreshPromise = null;
      });
    }
  }
  async refreshAccessToken() {
      logger.debug('refreshAccessToken');
      logger.debug('refreshToken', getStorage('auth.refresh_token'));

      // 兜底：刷新前确保 refreshToken 可用
      const rt = this.refreshToken || getStorage('auth.refresh_token');
      if (!rt) throw new Error('No refresh token');
      if (this.isRefreshing && this.refreshPromise) {
        await this.refreshPromise;
        return this.accessToken;
      }
      this.refreshToken = rt;

      this.isRefreshing = true;
      try {
          this.refreshPromise = (async () => {
            const res = await refreshTokensRequest(this.refreshToken);
            runInAction(() => {
              this.setTokens({
                accessToken: res.access_token,
                idToken: res.id_token,
                refreshToken: res.refresh_token || this.refreshToken,
                accessTokenExpiresIn: res.expires_in,
              });
            });
          })();
          await this.refreshPromise;
          return this.accessToken;
      } finally {
          runInAction(() => {
              this.isRefreshing = false;
              this.refreshPromise = null;
          });
      }
  }
}

export const tokenStore = new TokenStore();
