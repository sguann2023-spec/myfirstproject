import { SkillCatalogApiClient } from '@renderer/api/skillCatalog'
import { mockSkillCatalog } from '@renderer/services/mock/skillCatalogMock'

const USE_MOCK = false
const DEFAULT_SKILL_CATALOG_API_BASE_URL = 'https://open.vectcut.com'
export const SKILL_CATALOG_REFRESH_INTERVAL_MS = 10 * 60 * 1000
const apiClient = new SkillCatalogApiClient({
  baseURL: String((globalThis as any).__SKILL_CATALOG_API_BASE_URL__ || '') || DEFAULT_SKILL_CATALOG_API_BASE_URL
})

type FeaturedResult = Awaited<ReturnType<typeof apiClient.listFeatured>>
const featuredCache = new Map<string, { data: FeaturedResult; fetchedAt: number }>()
const featuredRequests = new Map<string, Promise<FeaturedResult>>()

const fetchFeatured = async (limit: number, offset: number) => {
  const cacheKey = `${limit}:${offset}`
  const now = Date.now()
  const cached = featuredCache.get(cacheKey)
  if (
    cached &&
    now - cached.fetchedAt < SKILL_CATALOG_REFRESH_INTERVAL_MS
  ) {
    return cached.data
  }

  const activeRequest = featuredRequests.get(cacheKey)
  if (activeRequest) return activeRequest

  const request = apiClient.listFeatured({ limit, offset })
    .then((result) => {
      featuredCache.set(cacheKey, { data: result, fetchedAt: Date.now() })
      return result
    })
    .finally(() => {
      featuredRequests.delete(cacheKey)
    })
  featuredRequests.set(cacheKey, request)

  return request
}

export const skillCatalogService = {
  async listFeatured(options: { limit?: number; offset?: number } = {}) {
    const limit = options.limit ?? 20
    const offset = options.offset ?? 0
    if (USE_MOCK) return mockSkillCatalog.listFeatured(limit, offset)
    return fetchFeatured(limit, offset)
  },
  async searchSkills(query: string, options: { limit?: number; offset?: number } = {}) {
    const limit = options.limit ?? 20
    const offset = options.offset ?? 0
    if (USE_MOCK) return mockSkillCatalog.searchSkills(query, limit, offset)
    return apiClient.searchSkills(query, { limit, offset })
  },
  async getSkillDetail(skillId: string) {
    if (USE_MOCK) {
      const response = await mockSkillCatalog.getSkillDetail(skillId)
      return response.data
    }
    return apiClient.getSkillDetail(skillId)
  }
}
