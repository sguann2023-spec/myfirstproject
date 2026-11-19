import { resolve } from 'node:path'
import { getStaticTOMLValue, parseTOML, traverseNodes, type AST } from 'toml-eslint-parser'
import {
  SWITCH_CODEX_BASE_URL,
  SWITCH_PROVIDER_ID,
  type SwitchModel
} from '../../../packages/shared/switchSettings'

const PROVIDER_NAME = 'VectCut Switch'
const ROOT_FIELDS = ['model', 'model_provider', 'model_catalog_json', 'model_reasoning_effort', 'review_model', 'web_search']
const PROVIDER_PATH = ['model_providers', SWITCH_PROVIDER_ID]
const PROVIDER_FIELDS = [
  ['name'], ['base_url'], ['experimental_bearer_token'], ['requires_openai_auth'], ['wire_api'],
  ['http_headers', 'X-Client-Type'], ['query_params', 'client_type']
]
const REASONING_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const EXTERNAL_CATALOG_ERROR = '检测到外部模型目录配置，请先在 Codex 中确认并移除该引用后重试'
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const ABSENT = Symbol('absent')
type Missing = typeof ABSENT
type Path = string[]
type Entry = { path: (string | number)[]; node: AST.TOMLKeyValue }
type Document = { text: string; bom: string; eol: string; ast: AST.TOMLProgram; value: Record<string, unknown>; entries: Entry[] }
type Change = { start: number; end: number; text: string }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]))
  if (object(a) && object(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(k => own(b, k) && same(a[k], b[k]))
  }
  return false
}

function at(value: unknown, path: Path): unknown | Missing {
  let cursor = value
  for (const key of path) {
    if (!object(cursor) || !own(cursor, key)) return ABSENT
    cursor = cursor[key]
  }
  return cursor
}

function starts(path: (string | number)[], prefix: Path): boolean {
  return prefix.length <= path.length && prefix.every((part, i) => path[i] === part)
}

function samePath(a: (string | number)[], b: Path): boolean {
  return a.length === b.length && starts(a, b)
}

function read(source: string): Document {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const text = source.slice(bom.length)
  try {
    const ast = parseTOML(text, { tomlVersion: '1.0' })
    // Check every key, including inline tables nested inside arrays, before static evaluation.
    traverseNodes(ast, {
      enterNode(node) {
        if (node.type === 'TOMLKey' && getStaticTOMLValue(node).some(part => ['__proto__', 'constructor', 'prototype'].includes(part))) {
          throw new Error('unsafe key')
        }
      },
      leaveNode() {}
    })
    const entries: Entry[] = []
    const collect = (node: AST.TOMLKeyValue, parent: (string | number)[]) => {
      const path = [...parent, ...getStaticTOMLValue(node.key)]
      entries.push({ path, node })
      if (node.value.type === 'TOMLInlineTable') node.value.body.forEach(child => collect(child, path))
    }
    for (const node of ast.body[0].body) {
      if (node.type === 'TOMLKeyValue') collect(node, [])
      else node.body.forEach(child => collect(child, node.resolvedKey))
    }
    // getStaticTOMLValue creates ordinary objects; refuse prototype-sensitive keys before evaluating it.
    const unsafe = (path: (string | number)[]) => path.some(key => key === '__proto__' || key === 'constructor' || key === 'prototype')
    if (entries.some(entry => unsafe(entry.path)) || ast.body[0].body.some(node => node.type === 'TOMLTable' && unsafe(node.resolvedKey))) {
      throw new Error('unsafe key')
    }
    return { text, bom, eol: text.includes('\r\n') ? '\r\n' : '\n', ast, value: getStaticTOMLValue(ast) as Record<string, unknown>, entries }
  } catch {
    // Parser messages may contain the bearer token or another user's secret. Never propagate them.
    throw new Error('Codex configuration is not supported valid TOML.')
  }
}

function quote(value: string): string {
  return JSON.stringify(value).replace(/\u007f/g, '\\u007f')
}

function key(path: Path): string {
  return path.map(part => /^[A-Za-z0-9_-]+$/.test(part) ? part : quote(part)).join('.')
}

function serialize(value: unknown): string {
  if (typeof value === 'string') return quote(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return `[${value.map(serialize).join(', ')}]`
  if (object(value)) return `{ ${Object.entries(value).map(([k, v]) => `${key([k])} = ${serialize(v)}`).join(', ')} }`
  throw new Error('Codex managed field has an unsupported value.')
}

function splice(doc: Document, changes: Change[]): string {
  let result = doc.text
  for (const change of changes.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, change.start) + change.text + result.slice(change.end)
  }
  return doc.bom + result
}

function lineEnd(doc: Document, offset: number): number {
  const next = doc.text.indexOf('\n', offset)
  return next < 0 ? doc.text.length : next + 1
}

function removeEntry(doc: Document, node: AST.TOMLKeyValue): Change {
  if (node.parent.type === 'TOMLInlineTable') {
    const siblings = node.parent.body
    const i = siblings.indexOf(node)
    if (siblings.length === 1) return { start: node.range[0], end: node.range[1], text: '' }
    if (i < siblings.length - 1) return { start: node.range[0], end: siblings[i + 1].range[0], text: '' }
    return { start: siblings[i - 1].range[1], end: node.range[1], text: '' }
  }
  const start = doc.text.lastIndexOf('\n', node.range[0] - 1) + 1
  const end = lineEnd(doc, node.range[1])
  const suffix = doc.text.slice(node.range[1], end)
  // Preserve a user's trailing comment as a comment-only line.
  const hash = suffix.indexOf('#')
  return { start, end, text: hash < 0 ? '' : doc.text.slice(start, node.range[0]) + suffix.slice(hash) }
}

function setField(source: string, path: Path, value: unknown | Missing, rawValue?: string): string {
  const doc = read(source)
  const entry = doc.entries.find(item => samePath(item.path, path))
  const old = at(doc.value, path)
  if (same(old, value)) return source
  if (entry) {
    if (value === ABSENT) return splice(doc, [removeEntry(doc, entry.node)])
    return splice(doc, [{ start: entry.node.value.range[0], end: entry.node.value.range[1], text: rawValue ?? serialize(value) }])
  }
  if (old !== ABSENT) {
    // An explicitly defined table/array cannot safely be replaced as a scalar field.
    throw new Error('Codex managed field uses an unsupported TOML structure.')
  }
  if (value === ABSENT) return source

  // Inline tables cannot be extended outside their braces. Patch the deepest AST container.
  const container = doc.entries.filter(item => item.path.length < path.length && starts(path, item.path as Path))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (container) {
    if (container.node.value.type !== 'TOMLInlineTable') throw new Error('Codex managed field uses an unsupported TOML structure.')
    const table = container.node.value
    const pos = table.range[1] - 1
    const prefix = table.body.length ? ', ' : ' '
    return splice(doc, [{ start: pos, end: pos, text: `${prefix}${key(path.slice(container.path.length))} = ${rawValue ?? serialize(value)} ` }])
  }

  const tables = doc.ast.body[0].body.filter((node): node is AST.TOMLTable => node.type === 'TOMLTable' && node.kind === 'standard')
  const parent = tables.filter(table => table.resolvedKey.length < path.length && starts(path, table.resolvedKey as Path))
    .sort((a, b) => b.resolvedKey.length - a.resolvedKey.length)[0]
  const top = doc.ast.body[0].body
  const nextTable = parent ? top[top.indexOf(parent) + 1] : top.find(node => node.type === 'TOMLTable')
  const firstRoot = top.find(node => node.type === 'TOMLKeyValue')
  const pos = !parent && firstRoot ? doc.text.lastIndexOf('\n', firstRoot.range[0] - 1) + 1
    : nextTable ? doc.text.lastIndexOf('\n', nextTable.range[0] - 1) + 1 : doc.text.length
  const relative = path.slice(parent?.resolvedKey.length ?? 0)
  const prefix = pos > 0 && doc.text[pos - 1] !== '\n' ? doc.eol : ''
  return splice(doc, [{ start: pos, end: pos, text: `${prefix}${key(relative)} = ${rawValue ?? serialize(value)}${doc.eol}` }])
}

function removeSubtree(source: string, prefix: Path): string {
  let result = source
  // Inline/dotted assignments may contain a whole provider. Remove the highest
  // matching assignment first, then its remaining explicit table headers.
  while (true) {
    const doc = read(result)
    const entry = doc.entries.filter(item => starts(item.path, prefix))
      .sort((a, b) => a.path.length - b.path.length)[0]
    if (!entry) break
    result = splice(doc, [removeEntry(doc, entry.node)])
  }
  const doc = read(result)
  const changes: Change[] = []
  for (const node of doc.ast.body[0].body) {
    if (node.type !== 'TOMLTable' || !starts(node.resolvedKey, prefix)) continue
    const start = doc.text.lastIndexOf('\n', node.range[0] - 1) + 1
    const end = lineEnd(doc, node.key.range[1])
    const header = doc.text.slice(start, end)
    const comment = header.indexOf('#', node.key.range[1] - start)
    changes.push({ start, end, text: comment < 0 ? '' : header.slice(comment) })
  }
  return splice(doc, changes)
}

function dropEmptyTables(source: string, before: Document, prefixes: Path[]): string {
  let result = source
  // Remove only app-created empty tables, keeping any current comments and unrelated table contents.
  for (const prefix of [...prefixes].sort((a, b) => b.length - a.length)) {
    const doc = read(result)
    const existsBefore = before.ast.body[0].body.some(node => node.type === 'TOMLTable' && samePath(node.resolvedKey, prefix))
    const table = doc.ast.body[0].body.find((node): node is AST.TOMLTable => node.type === 'TOMLTable' && samePath(node.resolvedKey, prefix))
    if (existsBefore || !table || table.body.length || Object.keys((at(doc.value, prefix) as object) ?? {}).length) continue
    const start = doc.text.lastIndexOf('\n', table.range[0] - 1) + 1
    const end = lineEnd(doc, table.key.range[1])
    const header = doc.text.slice(start, end)
    const comment = header.indexOf('#', table.key.range[1] - start)
    result = splice(doc, [{ start, end, text: comment < 0 ? '' : header.slice(comment) }])
  }
  return result
}

function validateProfile(doc: Document, fields = ROOT_FIELDS): void {
  const profile = at(doc.value, ['profile'])
  if (profile === ABSENT) return
  if (typeof profile !== 'string') throw new Error('Codex active profile is invalid.')
  const selected = at(doc.value, ['profiles', profile])
  if (selected !== ABSENT && !object(selected)) throw new Error('Codex active profile is invalid.')
  if (fields.some(field => at(selected, [field]) !== ABSENT)) {
    throw new Error('Codex active profile overrides Switch-managed fields. Remove its overrides before switching.')
  }
}

// PC toggle capabilities map to native efforts, not an invented full effort
// range. Use the identical mapping for the declared default.
function nativeEffort(level = ''): string {
  return level === 'off' ? 'none' : level === 'on' ? 'high' : level
}

function levels(model: SwitchModel): string[] {
  return [...new Set((model.thinking_levels ?? []).map(nativeEffort).filter(level => REASONING_LEVELS.includes(level)))]
}

function effort(model: SwitchModel, doc: Document): string {
  const supported = levels(model)
  const current = at(doc.value, ['model_reasoning_effort'])
  if (at(doc.value, ['model']) === model.model_id && typeof current === 'string' && REASONING_LEVELS.includes(current) &&
    (!supported.length || supported.includes(current))) return current
  const fallback = nativeEffort(model.thinking_default)
  if (supported.includes(fallback)) return fallback
  return supported.includes('medium') ? 'medium' : supported[0] ?? 'medium'
}

function validateProviderRouting(provider: unknown): void {
  if (!object(provider)) return
  const forbiddenAuth = ['env_key', 'env_key_instructions', 'env_http_headers', 'auth', 'aws']
  const invalidTable = ['http_headers', 'query_params'].some(field => own(provider, field) && !object(provider[field]))
  const headers = provider.http_headers
  const forbiddenHeader = object(headers) && Object.keys(headers).some(header => ['authorization', 'host'].includes(header.trim().toLowerCase()))
  if (forbiddenAuth.some(field => own(provider, field)) || invalidTable || forbiddenHeader) {
    throw new Error('Codex Switch provider has conflicting authentication or routing settings.')
  }
}

export function inspectCodexSwitchConfig(source: string): {
  enabled: boolean; hasProvider: boolean; searchDisabled: boolean; hasModelCatalog: boolean; modelCatalogPath?: string
} {
  const doc = read(source)
  const hasProvider = at(doc.value, PROVIDER_PATH) !== ABSENT
  const selected = at(doc.value, ['model_provider']) === SWITCH_PROVIDER_ID
  const profile = at(doc.value, ['profile'])
  const profileSearch = typeof profile === 'string' ? at(doc.value, ['profiles', profile, 'web_search']) : ABSENT
  // Report migration state without imposing new planning checks on old backups.
  const searchDisabled = at(doc.value, ['web_search']) === 'disabled' && profileSearch === ABSENT
  const modelCatalog = at(doc.value, ['model_catalog_json'])
  return {
    enabled: selected && hasProvider, hasProvider: hasProvider || selected, searchDisabled,
    hasModelCatalog: modelCatalog !== ABSENT,
    ...(typeof modelCatalog === 'string' ? { modelCatalogPath: modelCatalog } : {})
  }
}

export function planCodexConfig(
  source: string,
  options: { models: SwitchModel[]; modelId: string; key: string; catalogPath: string; overwriteProvider?: boolean; removeManagedCatalog?: boolean }
): { config: string; catalog: null } {
  if (options.overwriteProvider) source = removeSubtree(source, PROVIDER_PATH)
  const doc = read(source)
  validateProfile(doc)
  const modelCatalog = at(doc.value, ['model_catalog_json'])
  // Ownership and file contents must be verified by the caller before opting in.
  // Only compare paths here; never open or inspect a referenced catalog.
  if (modelCatalog !== ABSENT && !(options.removeManagedCatalog === true && typeof modelCatalog === 'string' &&
    modelCatalog.trim() && options.catalogPath.trim() && resolve(modelCatalog) === resolve(options.catalogPath))) {
    throw new Error(EXTERNAL_CATALOG_ERROR)
  }
  if (!options.key.trim()) throw new Error('Codex Switch credentials are missing.')
  const supported = options.models.filter(model => model.codexSupported === true)
  if (supported.some(model => !model.model_id.trim()) || new Set(supported.map(model => model.model_id)).size !== supported.length) {
    throw new Error('Codex model catalog contains invalid or duplicate identifiers.')
  }
  const selected = supported.find(model => model.model_id === options.modelId)
  if (!selected) throw new Error('Selected model is not supported by Codex.')
  const providers = at(doc.value, ['model_providers'])
  if (providers !== ABSENT && !object(providers)) throw new Error('Codex model providers must be a table.')
  const provider = at(doc.value, PROVIDER_PATH)
  if (provider !== ABSENT && (!object(provider) || provider.name !== PROVIDER_NAME || provider.base_url !== SWITCH_CODEX_BASE_URL)) {
    throw new Error('Codex Switch provider conflicts with an existing provider.')
  }
  validateProviderRouting(provider)

  let config = source
  config = setField(config, ['model'], selected.model_id)
  config = setField(config, ['model_provider'], SWITCH_PROVIDER_ID)
  if (modelCatalog !== ABSENT) config = setField(config, ['model_catalog_json'], ABSENT)
  config = setField(config, ['model_reasoning_effort'], effort(selected, doc))
  config = setField(config, ['web_search'], 'disabled')
  const review = at(doc.value, ['review_model'])
  if (review !== ABSENT && (typeof review !== 'string' || !supported.some(model => model.model_id === review))) {
    config = setField(config, ['review_model'], selected.model_id)
  }
  // A dedicated table is easier for native clients and humans to inspect than serializing the document.
  if (provider === ABSENT && providers === ABSENT) {
    const current = read(config)
    const prefix = current.text && !current.text.endsWith('\n') ? current.eol : ''
    config += `${prefix}${current.eol}[model_providers.${SWITCH_PROVIDER_ID}]${current.eol}`
  } else if (provider === ABSENT && !doc.entries.some(entry => samePath(entry.path, ['model_providers']))) {
    const current = read(config)
    config += `${current.text && !current.text.endsWith('\n') ? current.eol : ''}${current.eol}[model_providers.${SWITCH_PROVIDER_ID}]${current.eol}`
  }
  const values: unknown[] = [PROVIDER_NAME, SWITCH_CODEX_BASE_URL, options.key, false, 'responses', 'pc', 'pc']
  PROVIDER_FIELDS.forEach((path, i) => { config = setField(config, [...PROVIDER_PATH, ...path], values[i]) })
  read(config)
  return { config, catalog: null }
}

/** Keep the first managed values while accepting manual edits on explicit update. */
export function rebaseCodexConfig(current: string, before: string, applied: string, planned: string): string {
  if (current === applied) return before
  const original = read(before)
  const expected = read(applied)
  const actual = read(current)
  const next = read(planned)
  let restored = current
  for (const field of ROOT_FIELDS) {
    const path = [field]
    const owned = !same(at(original.value, path), at(expected.value, path))
    const changed = !same(at(actual.value, path), at(next.value, path))
    if (!owned && !changed) continue
    const source = owned ? original : actual
    const entry = source.entries.find(item => samePath(item.path, path))
    const raw = entry ? source.text.slice(entry.node.value.range[0], entry.node.value.range[1]) : undefined
    restored = setField(restored, path, at(source.value, path), raw)
  }
  restored = removeSubtree(restored, PROVIDER_PATH)
  const provider = at(original.value, PROVIDER_PATH)
  if (provider !== ABSENT) restored = setField(restored, PROVIDER_PATH, provider)
  restored = dropEmptyTables(restored, original, [['model_providers']])
  const doc = read(restored)
  const providers = at(doc.value, ['model_providers'])
  if (at(original.value, ['model_providers']) === ABSENT && object(providers) && !Object.keys(providers).length && doc.entries.some(item => samePath(item.path, ['model_providers']))) {
    restored = setField(restored, ['model_providers'], ABSENT)
  }
  read(restored)
  return restored
}

/** Three-way semantic restore: only managed leaves are reverted; unrelated current edits survive. */
export function restoreCodexConfig(current: string, before: string, applied: string): string {
  const original = read(before)
  const expected = read(applied)
  const actual = read(current)
  validateProviderRouting(at(actual.value, PROVIDER_PATH))
  const fields = ROOT_FIELDS.filter(field => {
    if (field === 'review_model') return at(original.value, [field]) !== ABSENT || at(expected.value, [field]) !== ABSENT
    // Old snapshots never changed search. Do not retroactively own it (including
    // absent or differently quoted equal values), or an already-disabled setting.
    if (field === 'web_search') return !same(at(original.value, [field]), at(expected.value, [field]))
    return true
  })
  const paths: Path[] = [
    ...fields.map(field => [field]),
    ...PROVIDER_FIELDS.map(path => [...PROVIDER_PATH, ...path])
  ]
  validateProfile(actual, fields)
  if (paths.every(path => same(at(actual.value, path), at(original.value, path)))) return current
  if (paths.some(path => !same(at(actual.value, path), at(expected.value, path)))) {
    throw new Error('Codex managed fields were changed outside Switch; restore was cancelled.')
  }
  if (current === applied) return before
  let restored = current
  for (const path of paths) {
    const entry = original.entries.find(item => samePath(item.path, path))
    const raw = entry ? original.text.slice(entry.node.value.range[0], entry.node.value.range[1]) : undefined
    restored = setField(restored, path, at(original.value, path), raw)
  }
  const cleanup = [PROVIDER_PATH, [...PROVIDER_PATH, 'http_headers'], [...PROVIDER_PATH, 'query_params'], ['model_providers']]
  restored = dropEmptyTables(restored, original, cleanup)
  // Drop app-created inline parents only if no unowned values were added to them.
  for (const path of cleanup.sort((a, b) => b.length - a.length)) {
    const doc = read(restored)
    const value = at(doc.value, path)
    if (at(original.value, path) === ABSENT && object(value) && Object.keys(value).length === 0 && doc.entries.some(item => samePath(item.path, path))) {
      restored = setField(restored, path, ABSENT)
    }
  }
  read(restored)
  return restored
}
