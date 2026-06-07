import { http } from '../http';

const BASE_URL = 'https://open.vectcut.com';
const DEFAULT_ZHIPU_SEARCH_URL = `${BASE_URL}/search/zhipu`;

export async function zhipuSearch({
  query,
  max_results = 5,
  search_engine = 'search_std',
  search_intent = false,
  apiHost = DEFAULT_ZHIPU_SEARCH_URL
} = {}) {
  if (!query) {
    throw new Error('query is required');
  }

  return http.postJson(apiHost, {
    query,
    max_results,
    search_engine,
    search_intent
  });
}
