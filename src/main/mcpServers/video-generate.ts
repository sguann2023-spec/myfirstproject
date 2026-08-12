import { loggerService } from '@logger'
import Store from 'electron-store'
import { net } from 'electron'

const logger = loggerService.withContext('VideoGenerateServer')

const API_HOST = 'https://open.vectcut.com'
const VIDEO_MODEL_CAPABILITIES_ENDPOINT = '/llm/video/model_capabilities'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'
const VIDEO_CAPABILITIES_CACHE_TTL_MS = 5 * 60 * 1000

const VIDEO_MODEL_ALIASES: Record<string, string[]> = {
  seedance20: ['seedance-2.0'],
  'seedance-2-0': ['seedance-2.0'],
  seedance20fast: ['seedance-2.0-fast'],
  'seedance-2-0-fast': ['seedance-2.0-fast'],
  doubaoseedance20: ['seedance-2.0'],
  doubaoseedance20260128: ['seedance-2.0'],
  doubaoseedance20fast: ['seedance-2.0-fast'],
  doubaoseedance20fast260128: ['seedance-2.0-fast'],
}

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type ResolutionItem = {
  ratio?: string
  size?: string
}

type VideoPriceEntry = {
  project_id?: string
  resource_points_per_unit?: number
}

type VideoModelPrice = Record<string, Record<string, VideoPriceEntry>>

type VideoModelCapability = {
  display_name?: string
  description?: string
  reference_supported?: boolean
  first_frame_extend_supported?: boolean
  first_last_frame_supported?: boolean
  multi_image_reference_supported?: boolean
  generate_audio_supported?: boolean
  seedance_offline_supported?: boolean
  super_resolve_supported?: boolean
  gen_durations?: number[]
  resolutions?: Record<string, ResolutionItem[]>
}

type VideoCapabilitiesResponse = {
  capabilities?: Record<string, VideoModelCapability>
  prices?: Record<string, VideoModelPrice>
  [key: string]: unknown
}

type CachedVideoCapabilities = {
  capabilities: Record<string, VideoModelCapability>
  prices: Record<string, VideoModelPrice>
  expiresAt: number
}

type CachedVideoModelList = {
  models: string[]
  expiresAt: number
}

class VideoGenerateServer {
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null
  private capabilitiesCache: CachedVideoCapabilities | null = null
  private videoModelListCache: CachedVideoModelList | null = null

  private async ensureValidAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() < this.accessToken.expiresAt - 30_000) {
      return this.accessToken.accessToken
    }

    if (!forceRefresh && this.refreshPromise) {
      return this.refreshPromise
    }

    const refreshToken = String(this.store.get('auth.refresh_token') || '').trim()
    if (!refreshToken) {
      throw new Error('No refresh token found, please sign in first')
    }

    this.refreshPromise = this.refreshAccessToken(refreshToken)

    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
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
    this.accessToken = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000
    }

    if (typeof payload.refresh_token === 'string' && payload.refresh_token.trim()) {
      this.store.set('auth.refresh_token', payload.refresh_token.trim())
    }

    return accessToken
  }

  private async requestWithAuth(endpoint: string): Promise<Response> {
    const buildRequest = async (accessToken: string) =>
      net.fetch(`${API_HOST}${endpoint}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

    let response = await buildRequest(await this.ensureValidAccessToken())
    if (response.status === 401) {
      response = await buildRequest(await this.ensureValidAccessToken(true))
    }
    return response
  }

  public async getVideoModelList(forceRefresh = false) {
    if (!forceRefresh && this.videoModelListCache && Date.now() < this.videoModelListCache.expiresAt) {
      return {
        models: this.videoModelListCache.models,
        defaultModel: ''
      }
    }

    if (!forceRefresh && this.capabilitiesCache && Date.now() < this.capabilitiesCache.expiresAt) {
      const models = Object.keys(this.capabilitiesCache.capabilities)
      this.videoModelListCache = {
        models,
        expiresAt: this.capabilitiesCache.expiresAt
      }
      return {
        models,
        defaultModel: ''
      }
    }

    const capabilitiesPayload = await this.fetchVideoCapabilitiesPayload(forceRefresh)
    const models = Object.keys(capabilitiesPayload.capabilities)
    this.videoModelListCache = {
      models,
      expiresAt: capabilitiesPayload.expiresAt
    }

    return {
      models,
      defaultModel: ''
    }
  }

  public async listVideoCapabilities(
    filters: { model?: string; tier?: string; ratio?: string; includePrices?: boolean } = {}
  ) {
    const modelFilter = typeof filters.model === 'string' ? filters.model.trim() : ''
    const tier = typeof filters.tier === 'string' ? filters.tier.trim() : ''
    const ratio = typeof filters.ratio === 'string' ? filters.ratio.trim() : ''
    const includePrices = typeof filters.includePrices === 'boolean' ? filters.includePrices : true

    const { capabilities, prices } = await this.fetchVideoCapabilitiesPayload()
    const availableModels = Object.keys(capabilities)
    const resolvedModelFilter = modelFilter ? this.findClosestModelMatch(modelFilter, availableModels) : null

    if (modelFilter && !resolvedModelFilter) {
      throw new Error(`Unknown video model: ${modelFilter}`)
    }

    const targetModels = modelFilter ? [resolvedModelFilter!.model] : availableModels
    const models = targetModels
      .map((model) =>
        this.normalizeModelCapability(model, capabilities[model], prices, {
          tier: tier || undefined,
          ratio: ratio || undefined,
          includePrices
        })
      )
      .filter(
        (item) =>
          Object.keys((item.resolutions as Record<string, ResolutionItem[]>) ?? {}).length > 0 || (!tier && !ratio)
      )

    logger.info('Video model capabilities queried', {
      model: resolvedModelFilter?.model ?? (modelFilter || undefined),
      requestedModel: modelFilter || undefined,
      tier: tier || undefined,
      ratio: ratio || undefined,
      count: models.length
    })

    return {
      requestedModel: modelFilter || undefined,
      resolvedModel: resolvedModelFilter?.model,
      models
    }
  }

  private async fetchVideoCapabilitiesPayload(forceRefresh = false): Promise<CachedVideoCapabilities> {
    if (!forceRefresh && this.capabilitiesCache && Date.now() < this.capabilitiesCache.expiresAt) {
      return this.capabilitiesCache
    }

    const response = await this.requestWithAuth(VIDEO_MODEL_CAPABILITIES_ENDPOINT)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Video model capabilities query failed (${response.status}): ${body || 'unknown error'}`)
    }

    const payload = (await response.json()) as VideoCapabilitiesResponse
    this.capabilitiesCache = {
      capabilities: payload.capabilities ?? {},
      prices: payload.prices ?? {},
      expiresAt: Date.now() + VIDEO_CAPABILITIES_CACHE_TTL_MS
    }
    this.videoModelListCache = {
      models: Object.keys(this.capabilitiesCache.capabilities),
      expiresAt: this.capabilitiesCache.expiresAt
    }

    return this.capabilitiesCache
  }

  private normalizeModelName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  private levenshtein(a: string, b: string): number {
    if (a === '' || b === '') {
      return Math.max(a.length, b.length)
    }

    const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    )

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
      }
    }

    return matrix[a.length][b.length]
  }

  private findClosestModelMatch(requestedModel: string, availableModels: string[]) {
    const trimmedRequestedModel = requestedModel.trim()
    if (!trimmedRequestedModel || availableModels.length === 0) {
      return null
    }

    const exactMatch = availableModels.find((model) => model === trimmedRequestedModel)
    if (exactMatch) {
      return { model: exactMatch, score: 1, matchType: 'exact' }
    }

    const requestedLower = trimmedRequestedModel.toLowerCase()
    const caseInsensitiveMatch = availableModels.find((model) => model.toLowerCase() === requestedLower)
    if (caseInsensitiveMatch) {
      return { model: caseInsensitiveMatch, score: 0.99, matchType: 'case_insensitive' }
    }

    const normalizedRequestedModel = this.normalizeModelName(trimmedRequestedModel)
    if (!normalizedRequestedModel) {
      return null
    }

    const aliasedModels = VIDEO_MODEL_ALIASES[normalizedRequestedModel] ?? []
    for (const aliasTarget of aliasedModels) {
      const matchedAliasTarget = availableModels.find((model) => model === aliasTarget)
      if (matchedAliasTarget) {
        return { model: matchedAliasTarget, score: 0.995, matchType: 'alias' }
      }
    }

    let bestMatch: { model: string; score: number; matchType: string } | null = null

    for (const candidate of availableModels) {
      const normalizedCandidate = this.normalizeModelName(candidate)
      if (!normalizedCandidate) {
        continue
      }

      let score = 0
      let matchType = 'fuzzy'

      if (normalizedCandidate === normalizedRequestedModel) {
        score = 0.98
        matchType = 'normalized'
      } else if (normalizedCandidate.startsWith(normalizedRequestedModel)) {
        score = 0.94 - (normalizedCandidate.length - normalizedRequestedModel.length) / 100
        matchType = 'prefix'
      } else if (normalizedCandidate.includes(normalizedRequestedModel)) {
        score = 0.9 - (normalizedCandidate.length - normalizedRequestedModel.length) / 100
        matchType = 'contains'
      } else if (normalizedRequestedModel.includes(normalizedCandidate)) {
        score = 0.82 - (normalizedRequestedModel.length - normalizedCandidate.length) / 100
        matchType = 'reverse_contains'
      } else {
        const distance = this.levenshtein(normalizedRequestedModel, normalizedCandidate)
        const maxLength = Math.max(normalizedRequestedModel.length, normalizedCandidate.length)
        score = maxLength === 0 ? 0 : 1 - distance / maxLength
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { model: candidate, score, matchType }
      }
    }

    if (!bestMatch || bestMatch.score < 0.55) {
      return null
    }

    return bestMatch
  }

  private normalizeModelCapability(
    model: string,
    capability: VideoModelCapability | undefined,
    prices: Record<string, VideoModelPrice>,
    filters: {
      tier?: string
      ratio?: string
      includePrices: boolean
    }
  ) {
    const tierFilter = filters.tier?.trim()
    const ratioFilter = filters.ratio?.trim()
    const resolutions = capability?.resolutions ?? {}
    const normalizedResolutions = Object.entries(resolutions).reduce<Record<string, ResolutionItem[]>>((acc, [tier, items]) => {
      if (tierFilter && tier !== tierFilter) {
        return acc
      }

      const normalizedItems = (Array.isArray(items) ? items : []).filter((item) => {
        if (!ratioFilter) {
          return true
        }
        return item?.ratio === ratioFilter
      })

      if (normalizedItems.length > 0) {
        acc[tier] = normalizedItems.map((item) => ({
          ratio: item?.ratio ?? '',
          size: item?.size ?? ''
        }))
      }

      return acc
    }, {})

    const normalized: Record<string, unknown> = {
      model,
      display_name: typeof capability?.display_name === 'string' ? capability.display_name : undefined,
      description: typeof capability?.description === 'string' ? capability.description : undefined,
      reference_supported: Boolean(capability?.reference_supported),
      first_frame_extend_supported: Boolean(capability?.first_frame_extend_supported),
      first_last_frame_supported: Boolean(capability?.first_last_frame_supported),
      multi_image_reference_supported: Boolean(capability?.multi_image_reference_supported),
      generate_audio_supported: Boolean(capability?.generate_audio_supported),
      seedance_offline_supported: Boolean(capability?.seedance_offline_supported),
      super_resolve_supported: Boolean(capability?.super_resolve_supported),
      gen_durations: Array.isArray(capability?.gen_durations) ? capability.gen_durations : [],
      resolutions: normalizedResolutions
    }

    if (filters.includePrices && prices[model]) {
      normalized.price = prices[model]
    }

    return normalized
  }
}

export default VideoGenerateServer
