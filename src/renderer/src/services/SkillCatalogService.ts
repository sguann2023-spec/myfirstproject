import { SkillCatalogApiClient } from '@renderer/api/skillCatalog'
import { mockSkillCatalog } from '@renderer/services/mock/skillCatalogMock'

const USE_MOCK = true
const apiClient = new SkillCatalogApiClient({
  baseURL: String((globalThis as any).__SKILL_CATALOG_API_BASE_URL__ || '') || undefined
})

export const skillCatalogService = {
  async listFeatured(options: { limit?: number; offset?: number } = {}) {
    const limit = options.limit ?? 20
    const offset = options.offset ?? 0
    if (USE_MOCK) return mockSkillCatalog.listFeatured(limit, offset)
    return apiClient.listFeatured({ limit, offset })
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

