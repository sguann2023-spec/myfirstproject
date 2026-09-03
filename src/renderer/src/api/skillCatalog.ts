import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'

import {
  SkillCatalogDetailResponseSchema,
  SkillCatalogListResponseSchema,
  type SkillCatalogDetail,
  type SkillCatalogItem
} from '@renderer/types/skillCatalog'

export interface SkillCatalogListOptions {
  limit?: number
  offset?: number
}

export class SkillCatalogApiClient {
  private readonly axios: AxiosInstance

  constructor(config: AxiosRequestConfig = {}) {
    this.axios = axios.create({
      timeout: 15000,
      ...config
    })
  }

  private async getAuthConfig(): Promise<AxiosRequestConfig> {
    const apiKey = await window.api.getVectcutApiKey()
    if (!apiKey?.trim()) {
      throw new Error('未获取到当前 API Key，请先登录')
    }
    return {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`
      }
    }
  }

  async listFeatured(options: SkillCatalogListOptions = {}): Promise<{
    data: SkillCatalogItem[]
    total: number
    limit: number
    offset: number
  }> {
    const response = await this.axios.get('/skill_marketplace/skills/featured', {
      ...(await this.getAuthConfig()),
      params: {
        limit: options.limit ?? 20,
        offset: options.offset ?? 0
      }
    })
    const parsed = SkillCatalogListResponseSchema.parse(response.data)
    if (parsed.code !== 0) throw new Error(parsed.message || '获取精选技能失败')
    return parsed
  }

  async searchSkills(query: string, options: SkillCatalogListOptions = {}): Promise<{
    data: SkillCatalogItem[]
    total: number
    limit: number
    offset: number
  }> {
    const response = await this.axios.get('/skill_marketplace/skills/search', {
      ...(await this.getAuthConfig()),
      params: {
        q: query.trim(),
        limit: options.limit ?? 20,
        offset: options.offset ?? 0
      }
    })
    const parsed = SkillCatalogListResponseSchema.parse(response.data)
    if (parsed.code !== 0) throw new Error(parsed.message || '搜索技能失败')
    return parsed
  }

  async getSkillDetail(skillId: string): Promise<SkillCatalogDetail> {
    const response = await this.axios.get(
      `/skill_marketplace/skills/${encodeURIComponent(skillId)}`,
      await this.getAuthConfig()
    )
    const parsed = SkillCatalogDetailResponseSchema.parse(response.data)
    if (parsed.code !== 0) throw new Error(parsed.message || '获取技能详情失败')
    return parsed.data
  }
}
