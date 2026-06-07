export type ZhipuSearchResult = {
  title: string
  content: string
  url: string
  media?: string
  icon?: string
  publish_date?: string
}

export type ZhipuSearchResponse = {
  query?: string
  results: ZhipuSearchResult[]
  meta?: {
    request_id?: string
    id?: string
    created?: number
    provider?: string
    search_engine?: string
  }
}

export function zhipuSearch(params: {
  query: string
  max_results?: number
  search_engine?: string
  search_intent?: boolean
  apiHost?: string
}): Promise<ZhipuSearchResponse>
