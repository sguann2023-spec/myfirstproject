import { loggerService } from '@logger'
import { isMac, isWin } from '@main/constant'
import { generateUserAgent } from '@main/utils/systemInfo'
import { APP_NAME, FeedUrl, UpdateConfigUrl, UpdateMirror, UpgradeChannel } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import type { UpdateInfo } from 'builder-util-runtime'
import { CancellationToken } from 'builder-util-runtime'
import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, net } from 'electron'
import type { AppUpdater as _AppUpdater, Logger, NsisUpdater, UpdateCheckResult } from 'electron-updater'
import { autoUpdater } from 'electron-updater'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'path'
import semver from 'semver'

import { configManager } from './ConfigManager'
import { crashReportService } from './CrashReportService'
import MacArchUpdateProvider from './MacArchUpdateProvider'

const logger = loggerService.withContext('AppUpdater')

const DEFAULT_GITHUB_PROXY_PREFIXES = [
  'https://github.chenc.dev/',
  'https://github.tbap.top/',
  'https://github.dpik.top/',
  'https://gh-proxy.org/',
  'https://gh.acmsz.top/'
] as const
const GITHUB_PROXY_CHECK_TIMEOUT_MS = 15 * 1000
const DOWNLOAD_THROTTLE_WINDOW_MS = 60 * 60 * 1000
const LAST_DOWNLOAD_TRIGGERED_AT_CONFIG_KEY = 'appUpdater.lastDownloadTriggeredAt'
const LEGACY_AUTO_UPDATER_FEED_URL = 'https://player.install-ai-guider.top/client/latest'
const BINGO_CHANNEL_SEGMENT = 'bingo'
const MAC_CHANNEL_SUFFIX = '-mac'
const CHANNEL_FILE_EXTENSION = '.yml'
const WINDOWS_UPDATE_QUIT_TIMEOUT_MS = 10 * 1000
const PREPARED_WINDOWS_UPDATE_KEY = 'appUpdater.preparedWindowsUpdate'
const LOCAL_UPDATE_TEST_DIRECTORY = 'C:\\VectCut-update-test'

interface PreparedWindowsUpdate {
  version: string
  installerPath: string
}

type FeedSourceName = 'github-proxy' | 'legacy-oss' | 'local-test'

interface FeedSource {
  name: FeedSourceName
  feedUrl: string
}

type ChannelKey = 'default' | 'bingo'

function detectChannelKeyFromPath(): ChannelKey {
  try {
    const exePath = String(app.getPath('exe') || '').trim().toLowerCase()
    if (exePath.includes('bingocut')) {
      return 'bingo'
    }
  } catch (error) {
    logger.warn('Failed to detect updater channel from executable path', error as Error)
  }
  return 'default'
}

function getLegacyAutoUpdaterFeedUrl() {
  const channelKey = detectChannelKeyFromPath()
  if (channelKey === 'bingo') {
    return `${LEGACY_AUTO_UPDATER_FEED_URL}/${BINGO_CHANNEL_SEGMENT}`
  }
  return LEGACY_AUTO_UPDATER_FEED_URL
}

function getGitHubFeedUrlByChannel(channelKey: ChannelKey) {
  if (channelKey === 'bingo') {
    return FeedUrl.GITHUB_LATEST_BINGO
  }
  return FeedUrl.GITHUB_LATEST
}

function normalizeGitHubProxyPrefixes(prefixes: string[] | undefined) {
  if (!Array.isArray(prefixes)) {
    return []
  }

  return Array.from(
    new Set(
      prefixes
        .map((prefix) => String(prefix || '').trim())
        .filter((prefix) => /^https?:\/\//i.test(prefix))
        .map((prefix) => (prefix.endsWith('/') ? prefix : `${prefix}/`))
    )
  )
}

function getGitHubProxyFeedUrls(channelKey: ChannelKey, proxyPrefixes: readonly string[]) {
  const upstreamFeedUrl = getGitHubFeedUrlByChannel(channelKey)
  return proxyPrefixes.map((proxyPrefix) => `${proxyPrefix}${upstreamFeedUrl}`)
}

function buildMacChannelFileName(channel: string, arch?: string) {
  if (arch) {
    return `${channel}${MAC_CHANNEL_SUFFIX}-${arch}${CHANNEL_FILE_EXTENSION}`
  }
  return `${channel}${MAC_CHANNEL_SUFFIX}${CHANNEL_FILE_EXTENSION}`
}

function createFeedBaseUrl(feedUrl: string) {
  const url = new URL(feedUrl)
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/'
  }
  return url
}

function getPreflightManifestCandidates(channel: string) {
  if (!isMac) {
    return ['latest.yml']
  }

  const currentArch = process.arch
  const candidates = [buildMacChannelFileName(channel, currentArch)]

  // Keep backward compatibility until all channels publish arch-specific manifests.
  if (currentArch === 'x64') {
    candidates.push(buildMacChannelFileName(channel))
  }

  return candidates
}

function getCommonHeaders() {
  return {
    'User-Agent': generateUserAgent(),
    'Cache-Control': 'no-cache',
    'Client-Id': configManager.getClientId(),
    'App-Name': APP_NAME,
    'App-Version': `v${app.getVersion()}`,
    OS: process.platform
  }
}

// Language markers constants for multi-language release notes
const LANG_MARKERS = {
  EN_START: '<!--LANG:en-->',
  ZH_CN_START: '<!--LANG:zh-CN-->',
  END: '<!--LANG:END-->'
}

interface UpdateConfig {
  lastUpdated: string
  githubProxyPrefixes?: string[]
  versions: {
    [versionKey: string]: VersionConfig
  }
}

interface VersionConfig {
  minCompatibleVersion: string
  description: string
  channels: {
    latest: ChannelConfig | null
    rc: ChannelConfig | null
    beta: ChannelConfig | null
  }
}

interface ChannelConfig {
  version: string
  feedUrls: Record<UpdateMirror, string>
}

interface CheckForUpdatesResponse {
  currentVersion: unknown
  updateInfo: UpdateInfo | null
}

export default class AppUpdater {
  autoUpdater: _AppUpdater = autoUpdater
  private cancellationToken: CancellationToken = new CancellationToken()
  private updateCheckResult: UpdateCheckResult | null = null
  private checkForUpdatesPromise: Promise<CheckForUpdatesResponse> | null = null
  private isInstallingUpdate = false
  private installQuitTimer: ReturnType<typeof setTimeout> | null = null
  private installQuitListener: (() => void) | null = null
  private isDownloadInProgress = false
  private downloadedUpdateVersion: string | null = null
  private readonly preparedUpdateAtLaunch: PreparedWindowsUpdate | null
  private localUpdateServer: Server | null = null

  private broadcastUpdateEvent(channel: string, ...args: unknown[]) {
    const windows = BrowserWindow.getAllWindows().filter((browserWindow) => !browserWindow.isDestroyed())
    windows.forEach((browserWindow) => browserWindow.webContents.send(channel, ...args))
  }

  constructor() {
    // Snapshot before this session can download anything: only a later launch installs it.
    this.preparedUpdateAtLaunch = isWin
      ? configManager.get<PreparedWindowsUpdate | null>(PREPARED_WINDOWS_UPDATE_KEY, null)
      : null
    autoUpdater.logger = logger as Logger
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
    // Keep auto download under our control so we can separate "check" from "download".
    autoUpdater.autoDownload = false
    // Windows installs during login pre-init, never during an ordinary quit.
    autoUpdater.autoInstallOnAppQuit = !isWin && configManager.getAutoUpdate()
    autoUpdater.requestHeaders = {
      ...autoUpdater.requestHeaders,
      ...getCommonHeaders()
    }

    autoUpdater.on('error', (error) => {
      if (this.isInstallingUpdate) {
        this.resetInstallState()
      }
      logger.error('update error', error)
      this.broadcastUpdateEvent(IpcChannel.UpdateError, error)
    })

    autoUpdater.on('update-available', (releaseInfo: UpdateInfo) => {
      logger.info('update available', releaseInfo)
      const processedReleaseInfo = this.processReleaseInfo(releaseInfo)
      this.broadcastUpdateEvent(IpcChannel.UpdateAvailable, processedReleaseInfo)
    })

    // 检测到不需要更新时
    autoUpdater.on('update-not-available', () => {
      this.broadcastUpdateEvent(IpcChannel.UpdateNotAvailable)
    })

    // 更新下载进度
    autoUpdater.on('download-progress', (progress) => {
      this.isDownloadInProgress = true
      this.broadcastUpdateEvent(IpcChannel.DownloadProgress, progress)
    })

    // 当需要更新的内容下载完成后
    autoUpdater.on('update-downloaded', (releaseInfo: UpdateInfo) => {
      this.isDownloadInProgress = false
      this.downloadedUpdateVersion = releaseInfo.version
      const processedReleaseInfo = this.processReleaseInfo(releaseInfo)
      this.broadcastUpdateEvent(IpcChannel.UpdateDownloaded, processedReleaseInfo)
      logger.info('update downloaded', processedReleaseInfo)
    })

    if (isWin) {
      ;(autoUpdater as NsisUpdater).installDirectory = path.dirname(app.getPath('exe'))
    }

    this.autoUpdater = autoUpdater
  }

  public setAutoUpdate(isActive: boolean) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = !isWin && isActive
  }

  private _getChannelByVersion(version: string) {
    if (version.includes(`-${UpgradeChannel.BETA}.`)) {
      return UpgradeChannel.BETA
    }
    if (version.includes(`-${UpgradeChannel.RC}.`)) {
      return UpgradeChannel.RC
    }
    return UpgradeChannel.LATEST
  }

  private _getTestChannel() {
    const currentChannel = this._getChannelByVersion(app.getVersion())
    const savedChannel = configManager.getTestChannel()

    if (currentChannel === UpgradeChannel.LATEST) {
      return savedChannel || UpgradeChannel.RC
    }

    if (savedChannel === currentChannel) {
      return savedChannel
    }

    // if the upgrade channel is not equal to the current channel, use the latest channel
    return UpgradeChannel.LATEST
  }

  /**
   * Fetch update configuration from GitHub or GitCode based on mirror
   * @param mirror - Mirror to fetch config from
   * @returns UpdateConfig object or null if fetch fails
   */
  private async _fetchUpdateConfig(mirror: UpdateMirror): Promise<UpdateConfig | null> {
    const configUrl = mirror === UpdateMirror.GITCODE ? UpdateConfigUrl.GITCODE : UpdateConfigUrl.GITHUB

    try {
      logger.info(`Fetching update config from ${configUrl} (mirror: ${mirror})`)
      const response = await net.fetch(configUrl, {
        headers: {
          ...getCommonHeaders(),
          Accept: 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const config = (await response.json()) as UpdateConfig
      logger.info(`Update config fetched successfully, last updated: ${config.lastUpdated}`)
      return config
    } catch (error) {
      logger.error('Failed to fetch update config:', error as Error)
      return null
    }
  }

  /**
   * Find compatible channel configuration based on current version
   * @param currentVersion - Current app version
   * @param requestedChannel - Requested upgrade channel (latest/rc/beta)
   * @param config - Update configuration object
   * @returns Object containing ChannelConfig and actual channel if found, null otherwise
   */
  private _findCompatibleChannel(
    currentVersion: string,
    requestedChannel: UpgradeChannel,
    config: UpdateConfig
  ): { config: ChannelConfig; channel: UpgradeChannel } | null {
    // Get all version keys and sort descending (newest first)
    const versionKeys = Object.keys(config.versions).sort(semver.rcompare)

    logger.info(
      `Finding compatible channel for version ${currentVersion}, requested channel: ${requestedChannel}, available versions: ${versionKeys.join(', ')}`
    )

    for (const versionKey of versionKeys) {
      const versionConfig = config.versions[versionKey]
      const channelConfig = versionConfig.channels[requestedChannel]
      const latestChannelConfig = versionConfig.channels[UpgradeChannel.LATEST]

      if (!semver.gte(currentVersion, versionConfig.minCompatibleVersion)) {
        continue
      }

      // Check version compatibility and channel availability
      if (channelConfig !== null) {
        logger.info(
          `Found compatible version: ${versionKey} (minCompatibleVersion: ${versionConfig.minCompatibleVersion}), version: ${channelConfig.version}`
        )

        if (
          requestedChannel !== UpgradeChannel.LATEST &&
          latestChannelConfig &&
          semver.gte(latestChannelConfig.version, channelConfig.version)
        ) {
          logger.info(
            `latest channel version is greater than the requested channel version: ${latestChannelConfig.version} > ${channelConfig.version}, using latest instead`
          )
          return { config: latestChannelConfig, channel: UpgradeChannel.LATEST }
        }

        return { config: channelConfig, channel: requestedChannel }
      } else if (requestedChannel !== UpgradeChannel.LATEST && latestChannelConfig !== null) {
        // Fallback: requested channel (rc/beta) is null, but latest channel is available
        logger.info(
          `Requested channel ${requestedChannel} is null for ${versionKey}, falling back to latest channel: ${latestChannelConfig.version}`
        )
        return { config: latestChannelConfig, channel: UpgradeChannel.LATEST }
      }
    }

    logger.warn(`No compatible channel found for version ${currentVersion} and channel ${requestedChannel}`)
    return null
  }

  private _setChannel(channel: UpgradeChannel, feedUrl: string) {
    this.autoUpdater.channel = channel
    this.autoUpdater.setFeedURL(feedUrl)

    // disable downgrade after change the channel
    this.autoUpdater.allowDowngrade = false
    // Allow differential download when the current source supports range requests.
    this.autoUpdater.disableDifferentialDownload = false
  }

  private _applyFeedUrl(feedUrl: string, source: FeedSourceName) {
    const channelKey = detectChannelKeyFromPath()
    this.autoUpdater.channel = UpgradeChannel.LATEST
    if (isMac) {
      this.autoUpdater.setFeedURL({
        provider: 'custom',
        updateProvider: MacArchUpdateProvider,
        url: feedUrl,
        channel: UpgradeChannel.LATEST
      } as any)
    } else {
      // Keep legacy generic feed behavior for non-mac platforms.
      this.autoUpdater.setFeedURL({
        provider: 'generic',
        url: feedUrl,
        channel: UpgradeChannel.LATEST
      })
    }
    this.autoUpdater.allowDowngrade = false
    this.autoUpdater.disableDifferentialDownload = false
    logger.info('Configured auto updater feed URL', {
      feedUrl,
      source,
      channelKey,
      channel: UpgradeChannel.LATEST,
      provider: isMac ? 'custom-mac-arch' : 'generic'
    })
  }

  private async _getGitHubProxyPrefixes() {
    for (const mirror of [UpdateMirror.GITHUB, UpdateMirror.GITCODE]) {
      const config = await this._fetchUpdateConfig(mirror)
      const remoteProxyPrefixes = normalizeGitHubProxyPrefixes(config?.githubProxyPrefixes)
      if (remoteProxyPrefixes.length > 0) {
        logger.info('Using remote-configured GitHub proxy prefixes', {
          mirror,
          proxyPrefixes: remoteProxyPrefixes
        })
        return remoteProxyPrefixes
      }
    }

    return [...DEFAULT_GITHUB_PROXY_PREFIXES]
  }

  private async _canReachFeed(feedUrl: string, source: FeedSourceName): Promise<boolean> {
    const baseUrl = createFeedBaseUrl(feedUrl)
    const manifestCandidates = getPreflightManifestCandidates(UpgradeChannel.LATEST)

    for (let index = 0; index < manifestCandidates.length; index += 1) {
      const manifestName = manifestCandidates[index]
      const manifestUrl = new URL(manifestName, baseUrl).toString()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), GITHUB_PROXY_CHECK_TIMEOUT_MS)

      try {
        const response = await net.fetch(manifestUrl, {
          method: 'GET',
          headers: {
            ...getCommonHeaders(),
            Accept: 'text/yaml, text/plain, application/octet-stream, */*'
          },
          signal: controller.signal as any
        } as any)

        if (response.ok) {
          logger.info('Updater feed preflight succeeded', { source, manifestUrl, status: response.status })
          return true
        }

        if (response.status === 404 && index < manifestCandidates.length - 1) {
          logger.warn('Updater feed manifest not found, trying next candidate', { source, manifestUrl })
          continue
        }

        logger.warn('Updater feed preflight failed', { source, manifestUrl, status: response.status })
        return false
      } catch (error) {
        if (index < manifestCandidates.length - 1) {
          logger.warn('Updater feed preflight candidate failed, trying next candidate', {
            source,
            manifestUrl,
            error: error instanceof Error ? error.message : String(error)
          })
          continue
        }

        logger.warn('Updater feed preflight request failed', {
          source,
          manifestUrl,
          error: error instanceof Error ? error.message : String(error)
        })
        return false
      } finally {
        clearTimeout(timeout)
      }
    }

    return false
  }

  private async _getLocalTestFeedUrl(): Promise<string | null> {
    if (!isWin || !existsSync(LOCAL_UPDATE_TEST_DIRECTORY)) return null
    if (!this.localUpdateServer) {
      // electron-updater requires HTTP; expose only files inside the fixed test folder.
      const server = createServer(async (req, res) => {
        try {
          const filename = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname.slice(1))
          if (!filename || filename !== path.win32.basename(filename) || filename.includes(':') ||
              !/\.(yml|exe|blockmap)$/i.test(filename) || !['GET', 'HEAD'].includes(req.method || '')) {
            res.writeHead(404).end()
            return
          }
          const filePath = path.join(LOCAL_UPDATE_TEST_DIRECTORY, filename)
          const file = await stat(filePath)
          if (!file.isFile()) throw new Error('Not a file')
          res.writeHead(200, { 'Content-Length': file.size, 'Cache-Control': 'no-store' })
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          const stream = createReadStream(filePath)
          stream.on('error', (error) => res.destroy(error))
          res.on('close', () => stream.destroy())
          stream.pipe(res)
        } catch {
          if (!res.headersSent) res.writeHead(404)
          res.end()
        }
      })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      server.unref()
      this.localUpdateServer = server
    }
    const address = this.localUpdateServer.address()
    if (!address || typeof address === 'string') throw new Error('Local update source unavailable')
    return `http://127.0.0.1:${address.port}/`
  }

  private async _setFeedUrl(): Promise<FeedSource> {
    const testFeedUrl = await this._getLocalTestFeedUrl()
    if (testFeedUrl) {
      const source: FeedSource = { name: 'local-test', feedUrl: testFeedUrl }
      this._applyFeedUrl(source.feedUrl, source.name)
      this.autoUpdater.disableDifferentialDownload = true
      logger.warn('Using local Windows update test source; online fallback disabled', source)
      return source
    }

    // Try multiple domestic GitHub proxy nodes in order, and fall back to the
    // existing OSS feed if none of them can be reached quickly enough.
    const channelKey = detectChannelKeyFromPath()
    const proxyPrefixes = await this._getGitHubProxyPrefixes()
    const fallbackSource: FeedSource = {
      name: 'legacy-oss',
      feedUrl: getLegacyAutoUpdaterFeedUrl()
    }

    for (const feedUrl of getGitHubProxyFeedUrls(channelKey, proxyPrefixes)) {
      if (await this._canReachFeed(feedUrl, 'github-proxy')) {
        const preferredSource: FeedSource = {
          name: 'github-proxy',
          feedUrl
        }
        this._applyFeedUrl(preferredSource.feedUrl, preferredSource.name)
        return preferredSource
      }
    }

    this._applyFeedUrl(fallbackSource.feedUrl, fallbackSource.name)
    return fallbackSource
  }

  private _getLastDownloadTriggeredAt() {
    return configManager.get<number>(LAST_DOWNLOAD_TRIGGERED_AT_CONFIG_KEY, 0)
  }

  private _markDownloadTriggeredAt(timestamp: number) {
    configManager.set(LAST_DOWNLOAD_TRIGGERED_AT_CONFIG_KEY, timestamp)
  }

  private _canTriggerDownloadNow() {
    if (this.isDownloadInProgress) {
      return false
    }

    const now = Date.now()
    return now - this._getLastDownloadTriggeredAt() >= DOWNLOAD_THROTTLE_WINDOW_MS
  }

  private async _downloadAvailableUpdate(updateInfo: UpdateInfo) {
    if (this.downloadedUpdateVersion === updateInfo.version) {
      logger.info('Skipping download because the update is already downloaded in this session', {
        version: updateInfo.version
      })
      return
    }

    if (!this._canTriggerDownloadNow()) {
      logger.info('Skipping update download because the hourly download limit is active', {
        version: updateInfo.version,
        lastTriggeredAt: this._getLastDownloadTriggeredAt()
      })
      return
    }

    this._markDownloadTriggeredAt(Date.now())
    this.isDownloadInProgress = true
    this.broadcastUpdateEvent(IpcChannel.DownloadUpdate, updateInfo)
    logger.info('Starting update download', { version: updateInfo.version })

    try {
      const files = await this.autoUpdater.downloadUpdate(this.cancellationToken)
      if (isWin && files?.[0]) {
        configManager.set(PREPARED_WINDOWS_UPDATE_KEY, {
          version: updateInfo.version,
          installerPath: files[0]
        })
      }
    } catch (error) {
      this.isDownloadInProgress = false
      logger.error('downloadUpdate failed after check for updates', error as Error)
    }
  }

  public cancelDownload() {
    this.cancellationToken.cancel()
    this.cancellationToken = new CancellationToken()
    this.isDownloadInProgress = false
  }

  public async checkForUpdates(downloadAutomatically = true): Promise<CheckForUpdatesResponse> {
    if (isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env) {
      return {
        currentVersion: app.getVersion(),
        updateInfo: null
      }
    }

    if (this.checkForUpdatesPromise) {
      logger.info('Reusing in-flight update check request')
      return this.checkForUpdatesPromise
    }

    this.checkForUpdatesPromise = (async () => {
      try {
        const selectedSource = await this._setFeedUrl()
        try {
          this.updateCheckResult = await this.autoUpdater.checkForUpdates()
        } catch (error) {
          if (selectedSource.name === 'github-proxy') {
            logger.warn('Primary updater source failed during check, retrying with OSS fallback', error as Error)
            const fallbackSource: FeedSource = {
              name: 'legacy-oss',
              feedUrl: getLegacyAutoUpdaterFeedUrl()
            }
            this._applyFeedUrl(fallbackSource.feedUrl, fallbackSource.name)
            this.updateCheckResult = await this.autoUpdater.checkForUpdates()
          } else {
            throw error
          }
        }

        logger.info(
          `update check result: ${this.updateCheckResult?.isUpdateAvailable}, channel: ${this.autoUpdater.channel}, currentVersion: ${this.autoUpdater.currentVersion}`
        )

        if (downloadAutomatically && this.updateCheckResult?.isUpdateAvailable && configManager.getAutoUpdate()) {
          void this._downloadAvailableUpdate(this.updateCheckResult.updateInfo)
        }

        return {
          currentVersion: this.autoUpdater.currentVersion,
          updateInfo: this.updateCheckResult?.isUpdateAvailable ? this.updateCheckResult?.updateInfo : null
        }
      } catch (error) {
        logger.error('Failed to check for update:', error as Error)
        return {
          currentVersion: app.getVersion(),
          updateInfo: null
        }
      } finally {
        this.checkForUpdatesPromise = null
      }
    })()

    return this.checkForUpdatesPromise
  }

  public async installWindowsUpdateOnStartup(): Promise<{ installing: boolean }> {
    if (!isWin || !app.isPackaged || !configManager.getAutoUpdate() || 'PORTABLE_EXECUTABLE_DIR' in process.env) {
      return { installing: false }
    }

    const prepared = this.preparedUpdateAtLaunch
    if (!prepared || !semver.valid(prepared.version) || !semver.gt(prepared.version, app.getVersion()) ||
        !existsSync(prepared.installerPath)) {
      // No prepared installer from a previous session: login immediately while downloading.
      void this.checkForUpdates()
      return { installing: false }
    }

    const result = await this.checkForUpdates(false)
    if (!result.updateInfo) {
      return { installing: false }
    }
    if (result.updateInfo.version !== prepared.version) {
      void this._downloadAvailableUpdate(result.updateInfo)
      return { installing: false }
    }

    try {
      // Rehydrate electron-updater's previously verified cache before installing.
      this.isDownloadInProgress = true
      this.broadcastUpdateEvent(IpcChannel.DownloadUpdate, result.updateInfo)
      await this.autoUpdater.downloadUpdate(this.cancellationToken)
      this.isDownloadInProgress = false
      return { installing: await this.quitAndInstall() }
    } catch (error) {
      this.isDownloadInProgress = false
      logger.error('Windows startup update failed; continuing login', error as Error)
      return { installing: false }
    }
  }

  public quitAndInstall(): Promise<boolean> {
    if (this.isInstallingUpdate) {
      logger.info('Ignoring duplicate quitAndInstall request while install is already in progress')
      return Promise.resolve(true)
    }

    this.isInstallingUpdate = true
    app.isQuitting = true
    if (isWin) {
      // Arm only after electron-updater confirms installation was started.
      // before-quit/unload handlers can otherwise leave the old app alive.
      this.installQuitListener = () => {
        this.installQuitListener = null
        this.installQuitTimer = setTimeout(() => {
          logger.warn('Windows update quit timed out; forcing the old app to exit')
          crashReportService.record('update-quit-timeout')
          app.exit(0)
        }, WINDOWS_UPDATE_QUIT_TIMEOUT_MS)
        this.installQuitTimer.unref()
      }
      nativeAutoUpdater.once('before-quit-for-update', this.installQuitListener)
    }
    // Keep the independent Windows installer progress visible after this app exits.
    const isSilent = !isWin
    logger.info('Triggering quitAndInstall', { isSilent, isForceRunAfter: true, platform: process.platform })
    crashReportService.record('quit-and-install-requested', { isSilent })
    return new Promise((resolve) => {
      setImmediate(() => {
        try {
          this.autoUpdater.quitAndInstall(isSilent, true)
          resolve(this.isInstallingUpdate)
        } catch (error) {
          this.resetInstallState()
          logger.error('Failed to start quitAndInstall', error as Error)
          this.broadcastUpdateEvent(IpcChannel.UpdateError, error)
          resolve(false)
        }
      })
    })
  }

  private resetInstallState() {
    if (this.installQuitTimer) {
      clearTimeout(this.installQuitTimer)
      this.installQuitTimer = null
    }
    if (this.installQuitListener) {
      nativeAutoUpdater.removeListener('before-quit-for-update', this.installQuitListener)
      this.installQuitListener = null
    }
    this.isInstallingUpdate = false
    app.isQuitting = false
  }

  /**
   * Check if release notes contain multi-language markers
   */
  private hasMultiLanguageMarkers(releaseNotes: string): boolean {
    return releaseNotes.includes(LANG_MARKERS.EN_START)
  }

  /**
   * Parse multi-language release notes and return the appropriate language version
   * @param releaseNotes - Release notes string with language markers
   * @returns Parsed release notes for the user's language
   *
   * Expected format:
   * <!--LANG:en-->English content<!--LANG:zh-CN-->Chinese content<!--LANG:END-->
   */
  private parseMultiLangReleaseNotes(releaseNotes: string): string {
    try {
      const language = configManager.getLanguage()
      const isChineseUser = language === 'zh-CN' || language === 'zh-TW'

      // Create regex patterns using constants
      const enPattern = new RegExp(
        `${LANG_MARKERS.EN_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${LANG_MARKERS.ZH_CN_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
      )
      const zhPattern = new RegExp(
        `${LANG_MARKERS.ZH_CN_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${LANG_MARKERS.END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
      )

      // Extract language sections
      const enMatch = releaseNotes.match(enPattern)
      const zhMatch = releaseNotes.match(zhPattern)

      // Return appropriate language version with proper fallback
      if (isChineseUser && zhMatch) {
        return zhMatch[1].trim()
      } else if (enMatch) {
        return enMatch[1].trim()
      } else {
        // Clean fallback: remove all language markers
        logger.warn('Failed to extract language-specific release notes, using cleaned fallback')
        return releaseNotes
          .replace(new RegExp(`${LANG_MARKERS.EN_START}|${LANG_MARKERS.ZH_CN_START}|${LANG_MARKERS.END}`, 'g'), '')
          .trim()
      }
    } catch (error) {
      logger.error('Failed to parse multi-language release notes', error as Error)
      // Return original notes as safe fallback
      return releaseNotes
    }
  }

  /**
   * Process release info to handle multi-language release notes
   * @param releaseInfo - Original release info from updater
   * @returns Processed release info with localized release notes
   */
  private processReleaseInfo(releaseInfo: UpdateInfo): UpdateInfo {
    const processedInfo = { ...releaseInfo }

    // Handle multi-language release notes in string format
    if (releaseInfo.releaseNotes && typeof releaseInfo.releaseNotes === 'string') {
      // Check if it contains multi-language markers
      if (this.hasMultiLanguageMarkers(releaseInfo.releaseNotes)) {
        processedInfo.releaseNotes = this.parseMultiLangReleaseNotes(releaseInfo.releaseNotes)
      }
    }

    return processedInfo
  }
}
