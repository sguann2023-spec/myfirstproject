import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Build-time only. No provider credentials or network discovery ship in the runtime catalog.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const key = process.env.SCRAPT_TIKHUB_API_KEY
if (!key) throw new Error('Set SCRAPT_TIKHUB_API_KEY for catalog generation')
const apiOrigin = 'https://api.tikhub.io'
const mcpOrigin = 'https://mcp.tikhub.io'
const spec = await fetch(`${apiOrigin}/openapi.json`).then((response) => response.json())
const { platforms } = await fetch(`${mcpOrigin}/platforms`).then((response) => response.json())

function rpcResult(raw) {
  if (raw.trim().startsWith('{')) return JSON.parse(raw)
  const events = raw.split(/\r?\n\r?\n/).flatMap((event) => {
    const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n')
    return data ? [JSON.parse(data)] : []
  })
  return events.find((event) => event.result || event.error)
}

async function readTools(platform) {
  const headers = {
    Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  }
  async function rpc(id, method, params) {
    const response = await fetch(`${mcpOrigin}${platform.mcp_url}`, {
      method: 'POST', headers, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    })
    if (!response.ok) throw new Error(`${platform.slug} ${method}: HTTP ${response.status}`)
    const session = response.headers.get('mcp-session-id')
    if (session) headers['Mcp-Session-Id'] = session
    const message = rpcResult(await response.text())
    if (!message?.result) throw new Error(`${platform.slug} ${method}: missing result`)
    return message.result
  }
  await rpc(1, 'initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'catalog-builder', version: '1.0' }
  })
  const tools = []
  let cursor
  do {
    const result = await rpc(2, 'tools/list', cursor ? { cursor } : {})
    tools.push(...result.tools)
    cursor = result.nextCursor
  } while (cursor)
  console.log(`${platform.slug}: ${tools.length}`)
  return tools.map((tool) => ({ platform: platform.slug, tool }))
}

const operations = Object.entries(spec.paths).flatMap(([apiPath, item]) =>
  Object.entries(item).filter(([method]) => ['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method))
    .map(([method, operation]) => ({
      path: apiPath, method: method.toUpperCase(), operation,
      parameters: [...(item.parameters || []), ...(operation.parameters || [])],
      name: apiPath.replace(/^\/api\/v1\//, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/_$/, '')
    }))
)

function dereference(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => dereference(item, seen))
  if (value.$ref) {
    if (seen.has(value.$ref)) throw new Error(`Recursive schema ${value.$ref}`)
    const target = value.$ref.slice(2).split('/').reduce((item, segment) => item?.[segment], spec)
    if (!target) throw new Error(`Missing schema ${value.$ref}`)
    const { $ref, ...rest } = value
    return { ...dereference(target, new Set([...seen, $ref])), ...dereference(rest, seen) }
  }
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, dereference(item, seen)]))
}

function clean(value) {
  if (typeof value === 'string') {
    return value.replace(/https?:\/\/[^\s"'<>)]*tikhub[^\s"'<>)]*/gi, '[service]')
      .replace(/tikhub/gi, 'VectCut')
  }
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, clean(item)]))
  }
  return value
}

const sourceTools = []
// A few concurrent metadata requests avoid overloading the provider.
for (let index = 0; index < platforms.length; index += 3) {
  const groups = await Promise.all(platforms.slice(index, index + 3).map(readTools))
  sourceTools.push(...groups.flat())
}
const entries = []
const unmatched = []
for (const { platform, tool } of sourceTools) {
  const name = tool.name.replace(/^tikhub_/, 'media_')
  let candidates = operations.filter((operation) => operation.name.toLowerCase() === tool.name.toLowerCase())
  if (!candidates.length && platform === 'instagram') {
    candidates = operations.filter((operation) => operation.name.replace(/^instagram_v1_/, 'instagram_') === tool.name)
  }
  if (!candidates.length) {
    candidates = operations.filter((operation) => `${operation.name}_${operation.method.toLowerCase()}` === tool.name)
  }
  if (candidates.length !== 1) {
    unmatched.push({ platform, name: tool.name, description: tool.description, candidates: candidates.map((item) => item.path) })
    continue
  }
  const operation = candidates[0]
  // Service-account identity, usage and pricing are not client functionality.
  if (operation.path.startsWith('/api/v1/tikhub/user/')) continue
  const inputSchema = dereference(tool.inputSchema)
  const parameters = operation.parameters.map((parameter) => dereference(parameter))
  for (const parameter of parameters) {
    const property = inputSchema.properties?.[parameter.name]
    if (!property || typeof property !== 'object') continue
    if (parameter.description || parameter.schema?.description) {
      property.description = parameter.description || parameter.schema.description
    }
    if (tool.name === 'tiktok_web_fetch_search_video' && parameter.name === 'count') {
      property.description = '每页数量，官方建议保持默认值 20。Number per page; the provider recommends keeping the default of 20.'
    }
  }
  const content = operation.operation.requestBody
    ? dereference(operation.operation.requestBody).content : undefined
  const contentType = content && (content['application/json'] ? 'application/json' : Object.keys(content)[0])
  const bodySchema = contentType ? dereference(content[contentType].schema) : undefined
  // The hosted MCP occasionally omits POST body fields. Recover them from its REST contract.
  if (bodySchema?.type === 'object') {
    inputSchema.properties = { ...bodySchema.properties, ...inputSchema.properties }
    inputSchema.required = [...new Set([...(inputSchema.required || []), ...(bodySchema.required || [])])]
  }
  entries.push({
    tool: clean({ name, description: tool.description, inputSchema }),
    platform: platform === 'tikhub' ? 'media' : platform,
    route: {
      path: operation.path, method: operation.method,
      parameters: parameters.map(({ name, in: location, schema, style, explode }) => ({
        name, location, schema: dereference(schema), ...(style ? { style } : {}),
        ...(explode !== undefined ? { explode } : {})
      })),
      ...(bodySchema ? { contentType, bodySchema } : {})
    }
  })
}
await fs.mkdir(path.join(root, 'tmp'), { recursive: true })
await fs.writeFile(path.join(root, 'tmp/scrapt-source-tools.json'), JSON.stringify(sourceTools))
await fs.writeFile(path.join(root, 'tmp/scrapt-unmatched.json'), JSON.stringify(unmatched, null, 2))
console.log(`Matched ${entries.length}/${sourceTools.length}; unmatched ${unmatched.length}`)
if (unmatched.length) {
  console.log(JSON.stringify(unmatched, null, 2))
  process.exitCode = 1
} else {
  const catalog = {
    version: spec.info.version, generatedAt: new Date().toISOString(),
    count: entries.length, entries
  }
  await fs.writeFile(
    path.join(root, 'src/main/mcpServers/scrapt-catalog.json'),
    JSON.stringify(catalog, null, 2) + '\n'
  )
}
