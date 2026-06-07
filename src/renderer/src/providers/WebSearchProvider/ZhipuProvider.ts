import { loggerService } from '@logger'
import { zhipuSearch } from '../../../../api/search'
import type { WebSearchState } from '@renderer/store/websearch'
import type { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('ZhipuProvider')
const LEGACY_ZHIPU_API_HOST = 'https://open.bigmodel.cn/api/paas/v4/web_search'

export default class ZhipuProvider extends BaseWebSearchProvider {
  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!this.apiHost) {
      throw new Error('API host is required for Zhipu provider')
    }
  }

  public async search(query: string, websearch: WebSearchState): Promise<WebSearchProviderResponse> {
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const data = await zhipuSearch({
        query,
        max_results: websearch.maxResults,
        search_engine: 'search_std',
        search_intent: false,
        apiHost: this.apiHost === LEGACY_ZHIPU_API_HOST ? undefined : this.apiHost
      })

      return {
        query: data.query || query,
        results: data.results.slice(0, websearch.maxResults).map((result) => ({
          title: result.title || 'No title',
          content: result.content || '',
          url: result.url || ''
        }))
      }
    } catch (error) {
      logger.error('Zhipu search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
