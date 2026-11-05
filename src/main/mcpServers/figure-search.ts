import type { Tool } from '@modelcontextprotocol/sdk/types.js'

import { ASSET_SEARCH_ROUTING } from './asset-search-routing'
import StatelessMediaProxyServer, { isMediaRecord, mediaReference } from './media-proxy'

const TOOLS: Tool[] = [{
  name: 'search_images', title: '\u706b\u67f4\u4eba\u7d20\u6750\u641c\u7d22',
  description: 'Specialized stick-figure image library: choose only for stickman characters, gestures/actions and simple stick-figure explainer scenes, not general photos, broad illustrations, video or audio. Describe the desired figure/action in one precise query; start with topk=3-5 rather than several separate searches. Each successful search consumes 1 resource unit. Never use as an automatic general fallback, comparison fan-out or speculative probe. Never automatically retry, including authorization or uncertain failures; confirm the outcome first. You can also consider existing figures before custom generation when this style fits. No recoloring or guaranteed transparency; check reuse rights. ' + ASSET_SEARCH_ROUTING,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object', properties: {
      query: { type: 'string', minLength: 1, maxLength: 2000, description: 'One precise natural-language description combining the stick-figure pose, action and desired scene.' },
      topk: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
    }, required: ['query'], additionalProperties: false
  }
}]

function projectResult(data: unknown, _toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (!isMediaRecord(data) || !Array.isArray(data.results) || data.results.length > (args.topk as number)) {
    throw new Error('Invalid figure results')
  }
  const results = data.results.map((item: unknown) => {
    if (!isMediaRecord(item) || typeof item.id !== 'string' || !item.id || item.id.length > 256) {
      throw new Error('Invalid figure result')
    }
    const url = mediaReference(item.url)
    if (!url || (item.score !== null && (typeof item.score !== 'number' || !Number.isFinite(item.score)))) {
      throw new Error('Invalid figure reference or score')
    }
    return {
      id: item.id, score: item.score, url,
      category: typeof item.category === 'string' ? item.category.slice(0, 256) : null
    }
  })
  return { mediaType: 'image', query: args.query, results }
}

export default class FigureSearchServer extends StatelessMediaProxyServer {
  constructor(endpoint = process.env.FIGURE_SEARCH_MCP_URL || 'https://open.vectcut.com/stickman/mcp') {
    super({
      name: 'figure-search', endpoint, allowedPaths: ['/stickman/mcp'], tools: TOOLS,
      upstreamTools: { search_images: 'search_stickman' }, projectResult, timeoutMs: 195_000,
      errorMessage: 'Figure search is unavailable. Check parameters, login, resource balance and service deployment.'
    })
  }
}
