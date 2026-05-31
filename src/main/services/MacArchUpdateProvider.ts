import { loggerService } from '@logger'
import { HttpError, newError } from 'builder-util-runtime'
import type { GenericServerOptions, UpdateInfo } from 'builder-util-runtime'
import type { AppUpdater as ElectronAppUpdater } from 'electron-updater/out/AppUpdater'
import type { ResolvedUpdateFileInfo } from 'electron-updater/out/types'
import { newUrlFromBase } from 'electron-updater/out/util'
import { Provider, parseUpdateInfo, resolveFiles, type ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'

const logger = loggerService.withContext('MacArchUpdateProvider')

const MAC_CHANNEL_SUFFIX = '-mac'
const CHANNEL_FILE_EXTENSION = '.yml'

function createBaseUrl(url: string) {
  const result = new URL(url)
  if (!result.pathname.endsWith('/')) {
    result.pathname += '/'
  }
  return result
}

function buildMacChannelFileName(channel: string, arch?: string) {
  if (arch) {
    return `${channel}${MAC_CHANNEL_SUFFIX}-${arch}${CHANNEL_FILE_EXTENSION}`
  }
  return `${channel}${MAC_CHANNEL_SUFFIX}${CHANNEL_FILE_EXTENSION}`
}

export default class MacArchUpdateProvider extends Provider<UpdateInfo> {
  private readonly configuration: GenericServerOptions
  private readonly updater: ElectronAppUpdater & { isAddNoCacheQuery?: boolean }
  private readonly baseUrl: URL

  constructor(
    configuration: GenericServerOptions,
    updater: ElectronAppUpdater,
    runtimeOptions: ProviderRuntimeOptions
  ) {
    super(runtimeOptions)
    this.configuration = configuration
    this.updater = updater as ElectronAppUpdater & { isAddNoCacheQuery?: boolean }
    this.baseUrl = createBaseUrl(this.configuration.url)
  }

  private get channel() {
    return this.updater.channel || this.configuration.channel || 'latest'
  }

  private getChannelFileCandidates() {
    const currentArch = process.arch
    const candidates = [buildMacChannelFileName(this.channel, currentArch)]

    // Keep backward compatibility until all clients publish arch-specific manifests.
    if (currentArch === 'x64') {
      candidates.push(buildMacChannelFileName(this.channel))
    }

    return candidates
  }

  async getLatestVersion() {
    const candidates = this.getChannelFileCandidates()
    let lastError: Error | null = null

    for (const [index, channelFile] of candidates.entries()) {
      const channelUrl = newUrlFromBase(
        channelFile,
        this.baseUrl,
        Boolean(this.updater.isAddNoCacheQuery)
      )

      try {
        if (index > 0) {
          logger.warn(`Falling back to legacy mac update manifest: ${channelFile}`)
        } else {
          logger.info(`Checking mac update manifest: ${channelFile}`)
        }

        const rawData = await this.httpRequest(channelUrl)
        return parseUpdateInfo(rawData, channelFile, channelUrl)
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 404 && index < candidates.length - 1) {
          lastError = error
          logger.warn(`Mac update manifest not found, trying next candidate: ${channelFile}`)
          continue
        }

        throw error
      }
    }

    throw (
      lastError ||
      newError(
        `Cannot find any mac update manifest: ${candidates.join(', ')}`,
        'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'
      )
    )
  }

  resolveFiles(updateInfo: UpdateInfo): Array<ResolvedUpdateFileInfo> {
    return resolveFiles(updateInfo, this.baseUrl)
  }
}
