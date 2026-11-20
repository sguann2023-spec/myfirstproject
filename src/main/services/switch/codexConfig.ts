import { getStaticTOMLValue, parseTOML, traverseNodes, type AST } from 'toml-eslint-parser'
import {
  SWITCH_CODEX_BASE_URL,
  SWITCH_ERROR_MESSAGES,
  SWITCH_PROVIDER_ID,
  type SwitchModel
} from '../../../packages/shared/switchSettings'

const PROVIDER_NAME = 'VectCut Switch'
const ROOT_FIELDS = ['model', 'model_provider', 'model_reasoning_effort', 'review_model']
const PROVIDER_MARKER = `vectcut-switch:provider:${SWITCH_PROVIDER_ID}`
const ROOT_MARKER = 'vectcut-switch:root:'
const PROVIDER_CONFLICT = SWITCH_ERROR_MESSAGES.ownershipConflict
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

function setField(source: string, path: Path, value: unknown | Missing): string {
  const doc = read(source)
  const entry = doc.entries.find(item => samePath(item.path, path))
  const old = at(doc.value, path)
  if (same(old, value)) return source
  if (entry) {
    if (value === ABSENT) return splice(doc, [removeEntry(doc, entry.node)])
    return splice(doc, [{ start: entry.node.value.range[0], end: entry.node.value.range[1], text: serialize(value) }])
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
    return splice(doc, [{ start: pos, end: pos, text: `${prefix}${key(path.slice(container.path.length))} = ${serialize(value)} ` }])
  }

  const tables = doc.ast.body[0].body.filter((node): node is AST.TOMLTable => node.type === 'TOMLTable' && node.kind === 'standard')
  const parent = tables.filter(table => table.resolvedKey.length < path.length && starts(path, table.resolvedKey as Path))
    .sort((a, b) => b.resolvedKey.length - a.resolvedKey.length)[0]
  const top = doc.ast.body[0].body
  const nextTable = parent ? top[top.indexOf(parent) + 1] : top.find(node => node.type === 'TOMLTable')
  const firstRoot = top.find(node => node.type === 'TOMLKeyValue')
  const pos = !parent && firstRoot ? managedLineStart(doc, firstRoot)
    : nextTable ? managedLineStart(doc, nextTable) : doc.text.length
  const relative = path.slice(parent?.resolvedKey.length ?? 0)
  const prefix = pos > 0 && doc.text[pos - 1] !== '\n' ? doc.eol : ''
  return splice(doc, [{ start: pos, end: pos, text: `${prefix}${key(relative)} = ${serialize(value)}${doc.eol}` }])
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

type Anchor = AST.TOMLKeyValue | AST.TOMLTable

function lineStart(doc: Document, offset: number): number {
  return doc.text.lastIndexOf('\n', offset - 1) + 1
}

/** Markers are real parser comments immediately before a specific AST assignment/header.
 * Text resembling a marker inside a multiline string never participates in ownership. */
function markerComment(doc: Document, node: Anchor, marker: string): AST.TOMLProgram['comments'][number] | undefined {
  const start = lineStart(doc, node.range[0])
  if (doc.text.slice(start, node.range[0]).trim()) return undefined
  return doc.ast.comments.find(comment => comment.value.trim() === marker &&
    !doc.text.slice(lineStart(doc, comment.range[0]), comment.range[0]).trim() &&
    comment.loc.end.line + 1 === node.loc.start.line &&
    !doc.text.slice(comment.range[1], start).trim())
}

function managedLineStart(doc: Document, node: Anchor): number {
  const marker = doc.ast.comments.find(comment =>
    (comment.value.trim() === PROVIDER_MARKER || ROOT_FIELDS.some(field => comment.value.trim() === ROOT_MARKER + field)) &&
    markerComment(doc, node, comment.value.trim()) === comment)
  return marker ? lineStart(doc, marker.range[0]) : lineStart(doc, node.range[0])
}

function mark(source: string, node: Anchor, marker: string): string {
  const doc = read(source)
  if (markerComment(doc, node, marker)) return source
  const pos = lineStart(doc, node.range[0])
  return splice(doc, [{ start: pos, end: pos, text: `# ${marker}${doc.eol}` }])
}

function providerAnchors(doc: Document): Anchor[] {
  // An inline parent can contain other providers. The marker grants ownership only
  // of PROVIDER_PATH, never of that entire assignment or its sibling providers.
  const assignments = doc.entries.filter(entry => starts(entry.path, PROVIDER_PATH) || starts(PROVIDER_PATH, entry.path as Path))
    .map(entry => {
      let node = entry.node
      while (node.parent.type === 'TOMLInlineTable' && node.parent.parent.type === 'TOMLKeyValue') node = node.parent.parent
      return node
    })
  const tables = doc.ast.body[0].body.filter((node): node is AST.TOMLTable =>
    node.type === 'TOMLTable' && node.kind === 'standard' && starts(node.resolvedKey, PROVIDER_PATH))
  return [...new Set<Anchor>([...tables, ...assignments])].sort((a, b) => a.range[0] - b.range[0])
}

function legacyProvider(provider: unknown): boolean {
  // No URL/name/model heuristic: only the complete native provider emitted by
  // this project at its dedicated id is a safe, backup-free migration candidate.
  return object(provider) && provider.name === PROVIDER_NAME && provider.base_url === SWITCH_CODEX_BASE_URL &&
    typeof provider.experimental_bearer_token === 'string' && !!provider.experimental_bearer_token.trim() &&
    provider.requires_openai_auth === false && provider.wire_api === 'responses' &&
    at(provider, ['http_headers', 'X-Client-Type']) === 'pc' && at(provider, ['query_params', 'client_type']) === 'pc'
}

function ownsProvider(doc: Document): boolean {
  const provider = at(doc.value, PROVIDER_PATH)
  if (provider === ABSENT) return false
  if (providerAnchors(doc).some(node => markerComment(doc, node, PROVIDER_MARKER))) return true
  if (!legacyProvider(provider)) throw new Error(PROVIDER_CONFLICT)
  validateProviderRouting(provider)
  return true
}

function ownedRootFields(doc: Document): string[] {
  return ROOT_FIELDS.filter(field => {
    const entry = doc.entries.find(item => samePath(item.path, [field]))
    return entry && markerComment(doc, entry.node, ROOT_MARKER + field)
  })
}

function setRootField(source: string, field: string, value: unknown): string {
  const before = read(source)
  const claim = at(before.value, [field]) === ABSENT || ownedRootFields(before).includes(field)
  const config = setField(source, [field], value)
  if (!claim) return config
  const doc = read(config)
  const entry = doc.entries.find(item => samePath(item.path, [field]))!
  return mark(config, entry.node, ROOT_MARKER + field)
}

function validateProfile(doc: Document, fields = [...ROOT_FIELDS, 'model_catalog_json']): void {
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
  enabled: boolean; hasManagedConfig: boolean; modelId?: string
  hasProvider: boolean; searchDisabled: boolean; hasModelCatalog: boolean; modelCatalogPath?: string
} {
  const doc = read(source)
  const hasProvider = ownsProvider(doc)
  const profile = at(doc.value, ['profile'])
  const selectedProfile = typeof profile === 'string' ? at(doc.value, ['profiles', profile]) : ABSENT
  const provider = at(selectedProfile, ['model_provider']) === ABSENT
    ? at(doc.value, ['model_provider']) : at(selectedProfile, ['model_provider'])
  const model = at(selectedProfile, ['model']) === ABSENT ? at(doc.value, ['model']) : at(selectedProfile, ['model'])
  const profileSearch = at(selectedProfile, ['web_search'])
  const modelCatalog = at(doc.value, ['model_catalog_json'])
  return {
    enabled: hasProvider && provider === SWITCH_PROVIDER_ID,
    hasManagedConfig: hasProvider || ownedRootFields(doc).length > 0,
    ...(typeof model === 'string' ? { modelId: model } : {}),
    hasProvider,
    searchDisabled: at(doc.value, ['web_search']) === 'disabled' && profileSearch === ABSENT,
    hasModelCatalog: modelCatalog !== ABSENT,
    ...(typeof modelCatalog === 'string' ? { modelCatalogPath: modelCatalog } : {})
  }
}

export function planCodexConfig(
  source: string,
  options: { models: SwitchModel[]; modelId: string; key: string; catalogPath?: string; overwriteProvider?: boolean; removeManagedCatalog?: boolean }
): { config: string; catalog: null } {
  const doc = read(source)
  const providerOwned = ownsProvider(doc)
  validateProfile(doc)
  // No catalog, even at an old app path, is owned by this adapter. A catalog
  // override is unsafe on enable, but never blocks removal of our own provider.
  if (at(doc.value, ['model_catalog_json']) !== ABSENT) throw new Error(EXTERNAL_CATALOG_ERROR)
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
  validateProviderRouting(provider)

  let config = setRootField(source, 'model', selected.model_id)
  config = setRootField(config, 'model_provider', SWITCH_PROVIDER_ID)
  config = setRootField(config, 'model_reasoning_effort', effort(selected, doc))
  const review = at(doc.value, ['review_model'])
  if (review !== ABSENT && (typeof review !== 'string' || !supported.some(model => model.model_id === review))) {
    config = setRootField(config, 'review_model', selected.model_id)
  }
  // Insert a native table unless the user already uses an inline parent.
  if (!providerOwned && !doc.entries.some(entry => samePath(entry.path, ['model_providers']))) {
    const current = read(config)
    config += `${current.text && !current.text.endsWith('\n') ? current.eol : ''}${current.eol}[model_providers.${SWITCH_PROVIDER_ID}]${current.eol}`
  }
  const values: unknown[] = [PROVIDER_NAME, SWITCH_CODEX_BASE_URL, options.key, false, 'responses', 'pc', 'pc']
  PROVIDER_FIELDS.forEach((path, i) => { config = setField(config, [...PROVIDER_PATH, ...path], values[i]) })
  const current = read(config)
  if (!providerAnchors(current).some(node => markerComment(current, node, PROVIDER_MARKER))) {
    config = mark(config, providerAnchors(current)[0], PROVIDER_MARKER)
  }
  read(config)
  return { config, catalog: null }
}

/** Remove current owned content, not a historical snapshot. User edits are not conflicts. */
export function removeCodexSwitchConfig(source: string): string {
  const doc = read(source)
  const providerOwned = ownsProvider(doc)
  const rootFields = ownedRootFields(doc)
  const rootProvider = at(doc.value, ['model_provider'])
  // If the user selected another provider, common model/effort/review values now
  // belong to that selection. Relinquish our comments without removing values.
  const profile = at(doc.value, ['profile'])
  const profileProvider = typeof profile === 'string' ? at(doc.value, ['profiles', profile, 'model_provider']) : ABSENT
  const cleanRoot = (rootProvider === SWITCH_PROVIDER_ID || rootProvider === ABSENT) &&
    (profileProvider === SWITCH_PROVIDER_ID || profileProvider === ABSENT)
  const comments = [
    ...(providerOwned ? providerAnchors(doc).map(node => markerComment(doc, node, PROVIDER_MARKER)) : []),
    ...doc.entries.filter(entry => entry.path.length === 1 && rootFields.includes(String(entry.path[0])))
      .map(entry => markerComment(doc, entry.node, ROOT_MARKER + entry.path[0]))
  ].filter((comment): comment is AST.TOMLProgram['comments'][number] => !!comment)
  let config = splice(doc, [...new Set(comments)].map(comment => ({
    start: lineStart(doc, comment.range[0]), end: lineEnd(doc, comment.range[1]), text: ''
  })))
  if (cleanRoot) {
    for (const field of rootFields) config = setField(config, [field], ABSENT)
  }
  if (providerOwned) {
    if (at(doc.value, ['model_provider']) === SWITCH_PROVIDER_ID) config = setField(config, ['model_provider'], ABSENT)
    const profiles = at(doc.value, ['profiles'])
    if (object(profiles)) {
      for (const name of Object.keys(profiles)) {
        if (at(profiles[name], ['model_provider']) === SWITCH_PROVIDER_ID) {
          config = setField(config, ['profiles', name, 'model_provider'], ABSENT)
        }
      }
    }
    config = removeSubtree(config, PROVIDER_PATH)
  }
  read(config)
  return config
}
