import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser'
import {
  SWITCH_CODEX_BASE_URL,
  SWITCH_ERROR_MESSAGES,
  SWITCH_OWNER_FIELD,
  SWITCH_PROVIDER_ID,
  SWITCH_WORKBUDDY_URL,
  type SwitchModel
} from '../../../packages/shared/switchSettings'
import { inspectCodexSwitchConfig, planCodexConfig, removeCodexSwitchConfig } from './codexConfig'
import { inspectWorkBuddySwitchConfig, planWorkBuddyConfig, removeWorkBuddySwitchConfig } from './workbuddyConfig'

const SECRET = 'fixture-secret-DO-NOT-PRINT'
const models: SwitchModel[] = [
  {
    model_id: 'gpt-fixture/coding-model', name: 'Coding Model', codexSupported: true, read_image: true,
    context_window_tokens: 200000, max_input_tokens: 180000, max_output_tokens: 32000,
    compaction_trigger_tokens: 170000, thinking_levels: ['off', 'low', 'medium', 'high'], thinking_default: 'high'
  },
  { model_id: 'gpt-fixture-unknown-limits', name: 'Unknown Limits', codexSupported: true },
  { model_id: 'chat-only', name: 'Chat Only', codexSupported: false, thinking_levels: ['off', 'max'], thinking_default: 'max' }
]
const options = { models, modelId: models[0].model_id, key: SECRET }
const toml = (source: string) => getStaticTOMLValue(parseTOML(source.replace(/^\uFEFF/, ''), { tomlVersion: '1.0' })) as Record<string, any>
const json = (source: string) => JSON.parse(source.replace(/^\uFEFF/, ''))
const owner = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID, ...extra })
const providerMarker = `# vectcut-switch:provider:${SWITCH_PROVIDER_ID}`
const rootMarker = (field: string) => `# vectcut-switch:root:${field}`
const providerConflict = SWITCH_ERROR_MESSAGES.ownershipConflict
const nativeProvider = {
  name: 'VectCut Switch', base_url: SWITCH_CODEX_BASE_URL,
  experimental_bearer_token: SECRET, requires_openai_auth: false, wire_api: 'responses',
  http_headers: { 'X-Client-Type': 'pc' }, query_params: { client_type: 'pc' }
}
const legacyProvider = () => `[model_providers.${SWITCH_PROVIDER_ID}]\n` +
  `name = "VectCut Switch"\nbase_url = "${SWITCH_CODEX_BASE_URL}"\nexperimental_bearer_token = "${SECRET}"\n` +
  'requires_openai_auth = false\nwire_api = "responses"\nhttp_headers."X-Client-Type" = "pc"\nquery_params.client_type = "pc"\n'

function errorWithoutSecrets(action: () => unknown): void {
  let error: unknown
  try { action() } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error)
  expect(String(error)).not.toContain(SECRET)
}

function expectNoTopLevelReasoning(model: Record<string, unknown>): void {
  for (const field of ['supportedEfforts', 'defaultEffort', 'canDisableThinking']) expect(model).not.toHaveProperty(field)
}

function expectRemoved(config: string): void {
  expect(toml(config).model_providers?.[SWITCH_PROVIDER_ID]).toBeUndefined()
  expect(inspectCodexSwitchConfig(config)).toMatchObject({ enabled: false, hasManagedConfig: false })
  expect(removeCodexSwitchConfig(config)).toBe(config)
}

describe('Codex ownership planning', () => {
  it('creates a native provider and AST comment ownership without catalog or invented schema fields', () => {
    const { config, catalog } = planCodexConfig('', options)
    expect(toml(config)).toEqual({
      model: models[0].model_id, model_provider: SWITCH_PROVIDER_ID, model_reasoning_effort: 'high',
      model_providers: { [SWITCH_PROVIDER_ID]: nativeProvider }
    })
    for (const field of ['model', 'model_provider', 'model_reasoning_effort']) expect(config).toContain(rootMarker(field))
    expect(config).toContain(providerMarker)
    expect(config).not.toContain(SWITCH_OWNER_FIELD)
    expect(config).not.toContain('auth.json')
    expect(config).not.toContain('model_catalog_json')
    expect(catalog).toBeNull()
    expect(planCodexConfig('', { ...options, catalogPath: '/fixture/unused/catalog.json' })).toEqual({ config, catalog: null })
    expect(planCodexConfig(config, options)).toEqual({ config, catalog: null })
    const removed = removeCodexSwitchConfig(config)
    expect(toml(removed)).toEqual({})
    expectRemoved(removed)
  })

  it('protects external catalogs on enable, never reads/claims/deletes them, and never blocks disable', () => {
    const reads = [
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('unexpected file read') }),
      vi.spyOn(fs, 'readFile').mockImplementation(() => { throw new Error('unexpected file read') }),
      vi.spyOn(fsPromises, 'readFile').mockImplementation(() => { throw new Error('unexpected file read') })
    ]
    try {
      for (const value of [JSON.stringify(`/external/${SECRET}/catalog.json`), JSON.stringify('/fixture/cache/catalog.json'), 'false', '42', '[]', '{}', '""']) {
        const pointer = `model_catalog_json = ${value} # user pointer\n`
        for (const removeManagedCatalog of [undefined, false, true]) {
          expect(() => planCodexConfig(pointer, {
            ...options, catalogPath: '/fixture/cache/catalog.json', removeManagedCatalog, overwriteProvider: true
          })).toThrow('检测到外部模型目录配置，请先在 Codex 中确认并移除该引用后重试')
        }
        const removed = removeCodexSwitchConfig(pointer + planCodexConfig('', options).config)
        expect(removed).toContain(pointer)
        expectRemoved(removed)
        expect(removeCodexSwitchConfig(pointer)).toBe(pointer)
      }
      for (const read of reads) expect(read).not.toHaveBeenCalled()
    } finally {
      reads.forEach(read => read.mockRestore())
    }
  })

  it('leaves unrelated instructions, MCP, provider and inactive profiles byte-for-byte', () => {
    const unrelated = [
      "approval_policy = 'on-request' # user policy",
      "sandbox_mode = 'workspace-write'",
      'developer_instructions = """',
      'model = "this is text, not a setting"',
      providerMarker,
      rootMarker('model'),
      '"""',
      'custom_tools = { enabled = true, names = ["my-tool"] }',
      'context_window = 123456 # user limit',
      '[mcp_servers."server.with.dot"] # preserve',
      'command = "fixture-tool"',
      'args = ["--flag", "#literal"]',
      '[model_providers.other]',
      'name = "custom"',
      '[profiles.work]',
      'model = "profile-model"',
      'model_provider = "another-provider"',
      "web_search = 'live' # inactive profile remains untouched"
    ].join('\r\n') + '\r\n'
    const source = '\uFEFF# keep top\r\n"model" = \'old\' # keep model comment\r\nmodel_reasoning_effort = "low"\r\n' + unrelated
    const { config } = planCodexConfig(source, options)
    expect(config.startsWith('\uFEFF# keep top\r\n')).toBe(true)
    expect(config).toContain(`"model" = "${models[0].model_id}" # keep model comment\r\n`)
    expect(config).toContain(unrelated)
    expect(config.replace(/\r\n/g, '')).not.toContain('\n')
    const removed = removeCodexSwitchConfig(config)
    expect(removed).toContain(unrelated)
    // Existing common fields were updated, but never claimed or rolled back.
    expect(toml(removed)).toMatchObject({ model: models[0].model_id, model_reasoning_effort: 'high' })
    expectRemoved(removed)
  })

  it.each([undefined, 'enabled', 'cached', 'live', 'disabled'])('does not overwrite or claim web_search %s', search => {
    const root = search === undefined ? '' : `"web_search" = '${search}' # user search\r\n`
    const source = '\uFEFF# search fixture\r\n' + root + 'profile = "work"\r\n[profiles.work]\r\nweb_search = "live" # keep profile\r\n'
    const planned = planCodexConfig(source, options)
    expect(toml(planned.config).web_search).toBe(search)
    expect(planned.config).toContain(root)
    expect(toml(planned.config).profiles.work.web_search).toBe('live')
    expect(planned.config).not.toContain(rootMarker('web_search'))
    expect(planCodexConfig(planned.config, options)).toEqual(planned)
    const removed = removeCodexSwitchConfig(planned.config)
    expect(toml(removed).web_search).toBe(search)
    expect(toml(removed).profiles.work.web_search).toBe('live')
    expectRemoved(removed)
  })

  it.each([
    'model_providers = { other = { name = "custom", base_url = "https://fixture.invalid" } }\n',
    '[model_providers]\nother.name = "custom"\nother.base_url = "https://fixture.invalid"\n',
    '[model_providers.other]\nname="custom"\nbase_url="https://fixture.invalid"\n',
    `${providerMarker}\nmodel_providers.${SWITCH_PROVIDER_ID}.name = "manual"\nmodel_providers.${SWITCH_PROVIDER_ID}.base_url = "https://fixture.invalid"\n`,
    `${providerMarker}\n[model_providers."${SWITCH_PROVIDER_ID}"] # keep header comment\nname = "manual"\n[model_providers."${SWITCH_PROVIDER_ID}".http_headers]\nkeep = "yes"\n`,
    `${providerMarker}\nmodel_providers = { other = { name = "custom" }, ${SWITCH_PROVIDER_ID} = { name = "manual", http_headers = { keep = "yes" } } } # inline comment\n`,
    `[model_providers]\n${providerMarker}\n"${SWITCH_PROVIDER_ID}" = { name = "manual" }\nother.name = "custom"\n`
  ])('supports table/dotted/inline/quoted provider ownership and preserves siblings', source => {
    const planned = planCodexConfig(source, options)
    const value = toml(planned.config)
    expect(value.model_providers[SWITCH_PROVIDER_ID]).toMatchObject(nativeProvider)
    if (source.includes('other')) expect(value.model_providers.other.name).toBe('custom')
    if (source.includes('keep =')) expect(value.model_providers[SWITCH_PROVIDER_ID].http_headers.keep).toBe('yes')
    expect(planCodexConfig(planned.config, options)).toEqual(planned)
    const removed = removeCodexSwitchConfig(planned.config)
    if (source.includes('other')) expect(toml(removed).model_providers.other.name).toBe('custom')
    if (source.includes('# keep header comment')) expect(removed).toContain('# keep header comment')
    if (source.includes('# inline comment')) expect(removed).toContain('# inline comment')
    expectRemoved(removed)
  })

  it('claims only newly added or already marked common fields across repeated latest-config updates', () => {
    const source = 'model = "original" # user model\nmodel_reasoning_effort = "low" # user effort\nreview_model = "old-review" # user review\n'
    const applied = planCodexConfig(source, options).config
    expect(applied).not.toContain(rootMarker('model') + '\n')
    expect(applied).not.toContain(rootMarker('model_reasoning_effort'))
    expect(applied).not.toContain(rootMarker('review_model'))
    expect(applied).toContain(rootMarker('model_provider'))
    const current = applied.replace(`model = "${options.modelId}"`, 'model = "manual"')
      .replace('model_reasoning_effort = "high"', 'model_reasoning_effort = "max"')
      .replace(SECRET, 'rotated-key') + '[mcp_servers.user]\ncommand = "new"\n'
    const updated = planCodexConfig(current, { ...options, key: 'latest-key' }).config
    const removed = removeCodexSwitchConfig(updated)
    expect(toml(removed)).toMatchObject({
      model: options.modelId, model_reasoning_effort: 'high', review_model: options.modelId,
      mcp_servers: { user: { command: 'new' } }
    })
    expect(removed).toContain('# user model')
    expect(removed).not.toContain('latest-key')
    expectRemoved(removed)
  })

  it('only changes an explicit review model when it is ineligible for the selected provider', () => {
    const retained = planCodexConfig('review_model = "gpt-fixture-unknown-limits" # review\n', options).config
    expect(retained).toContain('review_model = "gpt-fixture-unknown-limits" # review')
    const rerouted = planCodexConfig('review_model = "old-native" # review\n', options).config
    expect(rerouted).toContain('review_model = "gpt-fixture/coding-model" # review')
    expect(toml(planCodexConfig('', options).config)).not.toHaveProperty('review_model')
  })

  it.each(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])('uses and preserves native reasoning effort %s when advertised', level => {
    const changed = [{ ...models[0], thinking_default: level, thinking_levels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] }]
    expect(toml(planCodexConfig('', { ...options, models: changed }).config).model_reasoning_effort).toBe(level)
    const source = `model = "${options.modelId}"\nmodel_reasoning_effort = '${level}' # user choice\n`
    const planned = planCodexConfig(source, { ...options, models: changed })
    expect(planned.config).toContain(`model_reasoning_effort = '${level}' # user choice\n`)
    expect(planCodexConfig(planned.config, { ...options, models: changed })).toEqual(planned)
  })

  it.each([
    { thinking_levels: undefined, thinking_default: undefined },
    { thinking_levels: [], thinking_default: 'high' },
    { thinking_levels: ['max', 'ultra', 'invented'], thinking_default: 'ultra' }
  ])('retains sparse same-model xhigh but defaults new selections to medium for %j', metadata => {
    const changed = [{ ...models[1], ...metadata }]
    const selected = { ...options, models: changed, modelId: changed[0].model_id }
    const sameModel = `model = "${selected.modelId}"\nmodel_reasoning_effort = 'xhigh' # keep choice\n`
    expect(planCodexConfig(sameModel, selected).config).toContain("model_reasoning_effort = 'xhigh' # keep choice\n")
    const newModel = planCodexConfig('model = "previous"\nmodel_reasoning_effort = "xhigh" # keep note\n', selected).config
    expect(newModel).toContain('model_reasoning_effort = "medium" # keep note\n')
    expect(toml(planCodexConfig('', selected).config).model_reasoning_effort).toBe('medium')
  })

  it.each(['max', 'ultra', 'off', 'on', 'invented', 1, true])('does not preserve non-native effort %j even for sparse metadata', level => {
    const source = `model = "${models[1].model_id}"\nmodel_reasoning_effort = ${JSON.stringify(level)} # note\n`
    const config = planCodexConfig(source, { ...options, modelId: models[1].model_id }).config
    expect(toml(config).model_reasoning_effort).toBe('medium')
    expect(config).toContain('model_reasoning_effort = "medium" # note\n')
  })

  it.each([
    { thinking_levels: ['high', 'medium', 'invented'], thinking_default: 'invented', expected: 'medium' },
    { thinking_levels: ['low', 'medium', 'high'], thinking_default: 'high', expected: 'high' },
    { thinking_levels: ['low', 'high'], thinking_default: 'invented', expected: 'low' },
    { thinking_levels: ['max', 'ultra', 'high', 'low'], thinking_default: 'max', expected: 'high' },
    { thinking_levels: ['max', 'ultra', 'medium', 'high'], thinking_default: 'ultra', expected: 'medium' },
    { thinking_levels: ['low', 'high'], thinking_default: 'medium', expected: 'low' }
  ])('chooses valid default, supported medium or first native level for %j', ({ expected, ...metadata }) => {
    const changed = [{ ...models[0], ...metadata }]
    const unsupportedCurrent = `model = "${options.modelId}"\nmodel_reasoning_effort = "xhigh"\n`
    expect(toml(planCodexConfig('', { ...options, models: changed }).config).model_reasoning_effort).toBe(expected)
    expect(toml(planCodexConfig(unsupportedCurrent, { ...options, models: changed }).config).model_reasoning_effort).toBe(expected)
  })

  it.each(['off', 'on'])('maps generic toggle levels/default %s to only none/high', thinking_default => {
    const changed = [{ ...models[0], model_id: 'gpt-fixture-toggle', thinking_levels: ['off', 'on'], thinking_default }]
    const selected = { ...options, models: changed, modelId: changed[0].model_id }
    expect(toml(planCodexConfig('', selected).config).model_reasoning_effort).toBe(thinking_default === 'off' ? 'none' : 'high')
    const sameModel = `model = "${selected.modelId}"\nmodel_reasoning_effort = 'none' # native choice\n`
    expect(planCodexConfig(sameModel, selected).config).toContain("model_reasoning_effort = 'none' # native choice\n")
  })

  it('does not invent efforts from an undeclared on default', () => {
    const changed = [{ ...models[0], thinking_levels: ['off'], thinking_default: 'on' }]
    expect(toml(planCodexConfig('', { ...options, models: changed }).config).model_reasoning_effort).toBe('none')
  })

  it.each(['true', 1, {}, undefined, null])('requires literal true for Codex eligibility, not truthy %j', codexSupported => {
    const unsafe = { ...models[0], model_id: 'unsafe', codexSupported } as unknown as SwitchModel
    expect(toml(planCodexConfig('', { ...options, models: [models[0], unsafe] }).config).model).toBe(models[0].model_id)
    errorWithoutSecrets(() => planCodexConfig('', { ...options, models: [unsafe], modelId: 'unsafe' }))
  })

  it.each(['model', 'model_provider', 'model_catalog_json', 'model_reasoning_effort', 'review_model'])('rejects active-profile override %s on enable only', field => {
    errorWithoutSecrets(() => planCodexConfig(`profile = "work"\n[profiles.work]\n${field} = "${SECRET}"\n`, options))
    expect(toml(planCodexConfig('profile = "work"\n[profiles.work]\nsandbox_mode = "read-only"\n', options).config).profiles.work.sandbox_mode).toBe('read-only')
  })

  it.each([
    'profile = 1\n', 'profile = "work"\nprofiles.work = "invalid"\n',
    'profile = "work"\nprofiles = { work = { model = "override" } }\n',
    'profile = "work"\nprofiles.work.model_provider = "override"\n'
  ])('guards invalid or overriding profile structures', source => {
    errorWithoutSecrets(() => planCodexConfig(source, options))
  })

  it.each([
    `model = "${SECRET}\n`, `model = "one"\nmodel = "${SECRET}"\n`,
    `model_providers = "${SECRET}"\n`, `__proto__.secret = "${SECRET}"\n`,
    `items = [{ __proto__ = { secret = "${SECRET}" } }]`,
    `items = [{ constructor = { prototype = "${SECRET}" } }]`
  ])('fails safely on malformed/unsafe structures in every public operation', source => {
    errorWithoutSecrets(() => planCodexConfig(source, options))
    // A scalar provider collection is invalid for enable but contains nothing owned.
    if (source.startsWith('model_providers =')) {
      expect(inspectCodexSwitchConfig(source)).toMatchObject({ enabled: false, hasManagedConfig: false })
      expect(removeCodexSwitchConfig(source)).toBe(source)
    } else {
      errorWithoutSecrets(() => inspectCodexSwitchConfig(source))
      errorWithoutSecrets(() => removeCodexSwitchConfig(source))
    }
  })

  it.each([
    'env_key = "override"', 'env_key_instructions = "override"', 'auth = { token = "override" }',
    'aws = { region = "fixture" }', 'env_http_headers = { Authorization = "override" }',
    'http_headers.Authorization = "override"', 'http_headers.aUtHoRiZaTiOn = "override"',
    'http_headers.Host = "fixture.invalid"', 'http_headers.hOsT = "fixture.invalid"',
    'http_headers = "override"', 'query_params = "override"'
  ])('rejects unsafe routing on enable but allows marked provider cleanup: %s', declaration => {
    const source = `${providerMarker}\n[model_providers.${SWITCH_PROVIDER_ID}]\nname = "manual"\n${declaration.replace('override', SECRET)}\n`
    errorWithoutSecrets(() => planCodexConfig(source, options))
    expectRemoved(removeCodexSwitchConfig(source))
  })

  it('rejects missing/unsupported/duplicate models and empty credentials without leaking keys', () => {
    errorWithoutSecrets(() => planCodexConfig('', { ...options, modelId: SECRET }))
    errorWithoutSecrets(() => planCodexConfig('', { ...options, modelId: 'chat-only' }))
    errorWithoutSecrets(() => planCodexConfig('', { ...options, models: [models[0], models[0]] }))
    errorWithoutSecrets(() => planCodexConfig('', { ...options, key: ' ' }))
  })
})

describe('Codex ownership inspection, migration and removal', () => {
  it('reports current ownership and effective model/provider without historical backup', () => {
    expect(inspectCodexSwitchConfig('')).toMatchObject({ enabled: false, hasManagedConfig: false })
    expect(inspectCodexSwitchConfig('model_provider = "vectcut_switch"')).toMatchObject({ enabled: false, hasManagedConfig: false })
    const applied = planCodexConfig('', options).config
    expect(inspectCodexSwitchConfig(applied)).toMatchObject({ enabled: true, hasManagedConfig: true, modelId: options.modelId })
    const profile = 'profile = "work"\n' + applied + '[profiles.work]\nmodel = "profile-model"\nmodel_provider = "personal"\n'
    expect(inspectCodexSwitchConfig(profile)).toMatchObject({ enabled: false, hasManagedConfig: true, modelId: 'profile-model' })
    const activeOwned = profile.replace('model_provider = "personal"', `model_provider = "${SWITCH_PROVIDER_ID}"`)
    expect(inspectCodexSwitchConfig(activeOwned)).toMatchObject({ enabled: true, modelId: 'profile-model' })
  })

  it('removes changed owned model/effort/provider without treating ordinary edits as conflicts', () => {
    const applied = planCodexConfig('# user top\n', options).config
    const current = applied.replace(`model = "${options.modelId}"`, 'model = "manual-model" # changed')
      .replace('model_reasoning_effort = "high"', 'model_reasoning_effort = "max"')
      .replace('name = "VectCut Switch"', 'name = "Edited name"')
      .replace(SWITCH_CODEX_BASE_URL, 'https://manual.invalid').replace(SECRET, 'rotated-key') +
      'custom_timeout = 123\nhttp_headers."User-Header" = "owned-provider-field"\n[mcp_servers.keep]\ncommand = "after"\n'
    const removed = removeCodexSwitchConfig(current)
    expect(toml(removed)).toEqual({ mcp_servers: { keep: { command: 'after' } } })
    expect(removed).toContain('# user top')
    expect(removed).toContain('# changed')
    expectRemoved(removed)
  })

  it('preserves common model/effort/review values after selecting a different root provider', () => {
    const applied = planCodexConfig('', options).config
    const current = applied.replace(`model_provider = "${SWITCH_PROVIDER_ID}"`, 'model_provider = "personal"')
      .replace(`model = "${options.modelId}"`, 'model = "personal-model"') + '[model_providers.personal]\nname = "Personal"\n'
    const removed = removeCodexSwitchConfig(current)
    expect(toml(removed)).toEqual({ model: 'personal-model', model_provider: 'personal', model_reasoning_effort: 'high', model_providers: { personal: { name: 'Personal' } } })
    expect(removed).not.toContain('vectcut-switch:root:')
    expectRemoved(removed)
  })

  it('preserves common root fields inherited by an active profile switched to another provider', () => {
    const applied = planCodexConfig('', options).config
    const current = 'profile = "personal"\n' + applied + '[profiles.personal]\nmodel_provider = "personal"\n'
    const removed = removeCodexSwitchConfig(current)
    expect(toml(removed)).toMatchObject({ model: options.modelId, model_reasoning_effort: 'high', profiles: { personal: { model_provider: 'personal' } } })
    expect(toml(removed)).not.toHaveProperty('model_provider')
    expectRemoved(removed)
  })

  it('accepts a provider marker at BOM/CRLF/EOF boundaries without accepting string marker text', () => {
    const source = `\uFEFF${providerMarker}\r\nmodel_providers = { other = { name = "keep" }, ${SWITCH_PROVIDER_ID} = { name = "marked" } } # eof`
    expect(inspectCodexSwitchConfig(source)).toMatchObject({ hasManagedConfig: true })
    const planned = planCodexConfig(source, options).config
    expect(planned.replace(/\r\n/g, '')).not.toContain('\n')
    expect(planCodexConfig(planned, options).config).toBe(planned)
    const removed = removeCodexSwitchConfig(planned)
    expect(removed.startsWith('\uFEFF')).toBe(true)
    expect(toml(removed)).toEqual({ model_providers: { other: { name: 'keep' } } })
    expect(removed).toContain('# eof')
    expectRemoved(removed)
  })

  it('removes root and every exact owned-provider profile reference, preserving all other profile fields', () => {
    const source = 'profile = "active"\n' + planCodexConfig('', options).config + [
      '[profiles.active]', `model_provider = "${SWITCH_PROVIDER_ID}" # keep reference comment`,
      'model = "custom-model"', 'model_reasoning_effort = "low"', 'web_search = "live"',
      '[profiles.inactive]', `model_provider = "${SWITCH_PROVIDER_ID}"`, 'sandbox_mode = "read-only"',
      '[profiles.personal]', 'model_provider = "personal"', 'model = "personal-model"',
      '[profiles.not_exact]', `model_provider = "${SWITCH_PROVIDER_ID}-other"`
    ].join('\n') + '\n'
    const removed = removeCodexSwitchConfig(source)
    expect(toml(removed).profiles).toEqual({
      active: { model: 'custom-model', model_reasoning_effort: 'low', web_search: 'live' },
      inactive: { sandbox_mode: 'read-only' }, personal: { model_provider: 'personal', model: 'personal-model' },
      not_exact: { model_provider: `${SWITCH_PROVIDER_ID}-other` }
    })
    expect(removed).toContain('# keep reference comment')
    expect(toml(removed)).not.toHaveProperty('model_provider')
    expectRemoved(removed)
  })

  it.each([
    `profiles = { active = { model_provider = "${SWITCH_PROVIDER_ID}", model = "keep", extra = { flag = true } }, personal = { model_provider = "personal" } }\n`,
    `profiles.active.model_provider = "${SWITCH_PROVIDER_ID}"\nprofiles.active.model = "keep"\nprofiles.active.extra.flag = true\nprofiles.personal.model_provider = "personal"\n`,
    `profiles."active" = { model_provider = "${SWITCH_PROVIDER_ID}", model = "keep", extra = { flag = true } }\nprofiles.personal.model_provider = "personal"\n`
  ])('cleans inline/dotted profile references locally without deleting siblings', profiles => {
    const removed = removeCodexSwitchConfig(profiles + planCodexConfig('', options).config)
    expect(toml(removed).profiles).toEqual({ active: { model: 'keep', extra: { flag: true } }, personal: { model_provider: 'personal' } })
    expectRemoved(removed)
  })

  it('cleans orphan marked root fields with no provider, but never unmarked dangling references', () => {
    const marked = `${rootMarker('model')}\nmodel = "changed"\n${rootMarker('model_reasoning_effort')}\nmodel_reasoning_effort = "xhigh"\n`
    expect(toml(removeCodexSwitchConfig(marked))).toEqual({})
    const unmarked = 'model_provider = "vectcut_switch"\nmodel = "keep"\n[profiles.work]\nmodel_provider = "vectcut_switch"\n'
    expect(removeCodexSwitchConfig(unmarked)).toBe(unmarked)
  })

  it.each(['\n', '\r\n'])('migrates only the complete legacy provider signature without claiming old root fields (%j)', eol => {
    const source = '\uFEFF' + ('model = "legacy-model"\nmodel_provider = "vectcut_switch"\nmodel_reasoning_effort = "low"\nweb_search = "disabled"\n' + legacyProvider()).replace(/\n/g, eol)
    expect(inspectCodexSwitchConfig(source)).toMatchObject({ enabled: true, hasManagedConfig: true, modelId: 'legacy-model' })
    const planned = planCodexConfig(source, options).config
    expect(planned).toContain(providerMarker + eol)
    expect(planned).not.toContain('vectcut-switch:root:')
    expect(planCodexConfig(planned, options).config).toBe(planned)
    const removed = removeCodexSwitchConfig(source)
    expect(toml(removed)).toEqual({ model: 'legacy-model', model_reasoning_effort: 'low', web_search: 'disabled' })
    expect(removed.startsWith('\uFEFF')).toBe(true)
    if (eol === '\r\n') expect(removed.replace(/\r\n/g, '')).not.toContain('\n')
    expectRemoved(removed)
  })

  it('recognizes complete legacy dotted/inline provider shapes but not matching routes at another id', () => {
    const inline = `model_providers = { ${SWITCH_PROVIDER_ID} = { name = "VectCut Switch", base_url = "${SWITCH_CODEX_BASE_URL}", experimental_bearer_token = "${SECRET}", requires_openai_auth = false, wire_api = "responses", http_headers = { "X-Client-Type" = "pc" }, query_params = { client_type = "pc" } }, other = { name = "keep" } }\n`
    expect(inspectCodexSwitchConfig(inline)).toMatchObject({ hasManagedConfig: true, enabled: false })
    expect(toml(removeCodexSwitchConfig(inline))).toEqual({ model_providers: { other: { name: 'keep' } } })
    expectRemoved(removeCodexSwitchConfig(planCodexConfig(inline, options).config))
    const other = legacyProvider().replace(`model_providers.${SWITCH_PROVIDER_ID}`, 'model_providers.personal')
    expect(inspectCodexSwitchConfig(other)).toMatchObject({ hasManagedConfig: false })
    expect(removeCodexSwitchConfig(other)).toBe(other)
  })

  it.each([
    'name', 'base_url', 'experimental_bearer_token', 'requires_openai_auth', 'wire_api', 'http_headers', 'query_params'
  ])('refuses partial legacy signature missing %s even with matching model/name/URL', field => {
    const source = 'model = "gpt-fixture/coding-model"\n' + legacyProvider().split('\n').filter(line => !line.startsWith(field)).join('\n')
    for (const action of [
      () => inspectCodexSwitchConfig(source), () => removeCodexSwitchConfig(source),
      () => planCodexConfig(source, { ...options, overwriteProvider: true })
    ]) expect(action).toThrow(new Error(providerConflict))
  })

  it.each([
    `[model_providers.${SWITCH_PROVIDER_ID}]\nname = "${SECRET}"\n`,
    `[model_providers.${SWITCH_PROVIDER_ID}]\nname = "VectCut Switch"\nbase_url = "${SWITCH_CODEX_BASE_URL}"\n`,
    `model_providers = { ${SWITCH_PROVIDER_ID} = "${SECRET}" }\n`,
    `model_providers.${SWITCH_PROVIDER_ID}.name = "VectCut Switch"\n`,
    `developer_instructions = """\n${providerMarker}\n"""\n[model_providers.${SWITCH_PROVIDER_ID}]\nname = "manual"\n`,
    `${providerMarker}\n[model_providers.other]\nname = "VectCut Switch"\n[model_providers.${SWITCH_PROVIDER_ID}]\nname = "manual"\n`,
    `${providerMarker}\n\n[model_providers.${SWITCH_PROVIDER_ID}]\nname = "manual"\n`
  ])('never overwrites/deletes unknown same-id providers or accepts detached/forged markers', source => {
    for (const action of [
      () => inspectCodexSwitchConfig(source), () => removeCodexSwitchConfig(source),
      () => planCodexConfig(source, { ...options, overwriteProvider: true })
    ]) expect(action).toThrow(new Error(providerConflict))
  })

  it('does not accept root markers inside multiline strings or on another key/table', () => {
    const source = `developer_instructions = """\n${rootMarker('model')}\n"""\nmodel = "keep"\n` +
      `${rootMarker('model_reasoning_effort')}\napproval_policy = "on-request"\nmodel_reasoning_effort = "low"\n` +
      `[profiles.work]\n${rootMarker('model')}\nmodel = "profile-keep"\n`
    expect(inspectCodexSwitchConfig(source)).toMatchObject({ hasManagedConfig: false })
    expect(removeCodexSwitchConfig(source)).toBe(source)
    const removed = removeCodexSwitchConfig(planCodexConfig(source, options).config)
    expect(toml(removed)).toMatchObject({ model: options.modelId, model_reasoning_effort: 'high', profiles: { work: { model: 'profile-keep' } } })
    expect(removed).toContain(source.slice(source.indexOf('[profiles.work]')))
  })

  it('preserves trailing comments, BOM and CRLF at an unterminated final line', () => {
    const source = '\uFEFF# top\r\nmodel = "old" # user model\r\n[mcp_servers.keep]\r\ncommand = "keep" # no final newline'
    const applied = planCodexConfig(source, options).config
    const removed = removeCodexSwitchConfig(applied)
    expect(removed.startsWith('\uFEFF# top\r\n')).toBe(true)
    expect(removed.replace(/\r\n/g, '')).not.toContain('\n')
    expect(removed).toContain('command = "keep" # no final newline')
    expectRemoved(removed)
  })
})

describe('WorkBuddy ownership planning', () => {
  it('uses exact native metadata, all backend models and no invented limits', () => {
    const config = json(planWorkBuddyConfig('', models, SECRET))
    expect(config.models.map((model: any) => model.id)).toEqual(['Coding Model', 'Unknown Limits', 'Chat Only'])
    expect(config.models.every((model: any) => model.id === model.name)).toBe(true)
    expect(config.models[0]).toEqual({
      id: 'Coding Model', name: 'Coding Model', vendor: 'VectCut', url: SWITCH_WORKBUDDY_URL,
      apiKey: SECRET, [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID, useCustomProtocol: false,
      supportsToolCall: true, supportsImages: true, supportsReasoning: true,
      maxInputTokens: 180000, maxOutputTokens: 32000,
      reasoning: { supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'high', canDisableThinking: true }
    })
    expect(config.models[1]).toEqual({
      id: 'Unknown Limits', name: 'Unknown Limits', vendor: 'VectCut', url: SWITCH_WORKBUDDY_URL,
      apiKey: SECRET, [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID, useCustomProtocol: false,
      supportsToolCall: true, supportsImages: false, supportsReasoning: false
    })
    expect(config.models[2]).toMatchObject({ reasoning: { supportedEfforts: ['max'], defaultEffort: 'max', canDisableThinking: true } })
    config.models.forEach(expectNoTopLevelReasoning)
    expect(config).not.toHaveProperty('availableModels')
    expect(config.models[0]).not.toHaveProperty('contextWindow')
    expect(config.models[0]).not.toHaveProperty('reasoningLevels')
  })

  it.each([
    { family: 'GPT', levels: ['low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], canDisable: false },
    { family: 'Gemini', levels: ['low', 'medium', 'high'], defaultLevel: 'medium', efforts: ['low', 'medium', 'high'], canDisable: false },
    { family: 'Claude', levels: ['off', 'low', 'medium', 'high'], defaultLevel: 'high', efforts: ['low', 'medium', 'high'], canDisable: true },
    { family: 'DeepSeek', levels: ['off', 'low', 'high', 'max'], defaultLevel: 'max', efforts: ['low', 'high', 'max'], canDisable: true },
    { family: 'GLM', levels: ['off', 'low', 'high', 'max'], defaultLevel: 'high', efforts: ['low', 'high', 'max'], canDisable: true },
    { family: 'Kimi', levels: ['low', 'high', 'max'], defaultLevel: 'low', efforts: ['low', 'high', 'max'], canDisable: false },
    { family: 'Qwen', levels: ['off', 'on'], defaultLevel: 'on', efforts: [], canDisable: true }
  ])('maps $family thinking metadata using the same native fields', ({ family, levels, defaultLevel, efforts, canDisable }) => {
    const input: SwitchModel[] = [{
      model_id: `${family.toLowerCase()}-fixture`, name: `${family} Fixture`, codexSupported: false,
      thinking_levels: levels, thinking_default: defaultLevel
    }]
    const planned = planWorkBuddyConfig('', input, SECRET)
    const [model] = json(planned).models
    expect(model).toEqual({
      id: `${family} Fixture`, name: `${family} Fixture`, vendor: 'VectCut', url: SWITCH_WORKBUDDY_URL,
      apiKey: SECRET, [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID, useCustomProtocol: false,
      supportsToolCall: true, supportsImages: false, supportsReasoning: true,
      reasoning: {
        ...(efforts.length ? { supportedEfforts: efforts, defaultEffort: defaultLevel } : {}),
        canDisableThinking: canDisable
      },
      ...(canDisable ? {} : { onlyReasoning: true })
    })
    expectNoTopLevelReasoning(model)
    expect(planWorkBuddyConfig(planned, input, SECRET)).toBe(planned)
  })

  it.each<{
    label: string
    metadata: Pick<SwitchModel, 'thinking_levels' | 'thinking_default'>
    expected: Record<string, unknown>
  }>([
    { label: 'no metadata', metadata: {}, expected: { supportsReasoning: false } },
    { label: 'empty levels with a default', metadata: { thinking_levels: [], thinking_default: 'high' }, expected: { supportsReasoning: false } },
    { label: 'default without levels', metadata: { thinking_default: 'max' }, expected: { supportsReasoning: false } },
    { label: 'only off', metadata: { thinking_levels: ['off'], thinking_default: 'off' }, expected: { supportsReasoning: false, reasoning: { canDisableThinking: true } } },
    { label: 'only none', metadata: { thinking_levels: ['none'], thinking_default: 'none' }, expected: { supportsReasoning: false, reasoning: { canDisableThinking: true } } },
    { label: 'only disabled', metadata: { thinking_levels: ['disabled'], thinking_default: 'disabled' }, expected: { supportsReasoning: false, reasoning: { canDisableThinking: true } } },
    { label: 'only on', metadata: { thinking_levels: ['on'], thinking_default: 'on' }, expected: { supportsReasoning: true, reasoning: { canDisableThinking: false }, onlyReasoning: true } },
    { label: 'only enabled', metadata: { thinking_levels: ['enabled'], thinking_default: 'enabled' }, expected: { supportsReasoning: true, reasoning: { canDisableThinking: false }, onlyReasoning: true } },
    { label: 'toggle default off', metadata: { thinking_levels: ['off', 'on'], thinking_default: 'off' }, expected: { supportsReasoning: true, reasoning: { canDisableThinking: true } } },
    { label: 'toggle aliases', metadata: { thinking_levels: ['none', 'enabled', 'disabled'] }, expected: { supportsReasoning: true, reasoning: { canDisableThinking: true } } },
    { label: 'unknown only', metadata: { thinking_levels: ['ultra', 'invented'], thinking_default: 'ultra' }, expected: { supportsReasoning: false } },
    { label: 'off with unknown', metadata: { thinking_levels: ['off', 'invented'], thinking_default: 'invented' }, expected: { supportsReasoning: false, reasoning: { canDisableThinking: true } } },
    {
      label: 'native minimal effort', metadata: { thinking_levels: ['off', 'minimal', 'high'], thinking_default: 'minimal' },
      expected: { supportsReasoning: true, reasoning: { supportedEfforts: ['minimal', 'high'], defaultEffort: 'minimal', canDisableThinking: true } }
    },
    {
      label: 'duplicates preserve first advertised order',
      metadata: { thinking_levels: ['max', 'low', 'max', 'xhigh', 'high', 'medium', 'low', 'invented'], thinking_default: 'max' },
      expected: { supportsReasoning: true, onlyReasoning: true, reasoning: { supportedEfforts: ['max', 'low', 'xhigh', 'high', 'medium'], defaultEffort: 'max', canDisableThinking: false } }
    },
    {
      label: 'undeclared default', metadata: { thinking_levels: ['high', 'low'], thinking_default: 'medium' },
      expected: { supportsReasoning: true, onlyReasoning: true, reasoning: { supportedEfforts: ['high', 'low'], canDisableThinking: false } }
    },
    {
      label: 'unknown default', metadata: { thinking_levels: ['off', 'low', 'high'], thinking_default: 'ultra' },
      expected: { supportsReasoning: true, reasoning: { supportedEfforts: ['low', 'high'], canDisableThinking: true } }
    },
    {
      label: 'toggle default is not an effort', metadata: { thinking_levels: ['off', 'on', 'high'], thinking_default: 'on' },
      expected: { supportsReasoning: true, reasoning: { supportedEfforts: ['high'], canDisableThinking: true } }
    },
    {
      label: 'no effort default is invented', metadata: { thinking_levels: ['low', 'high'] },
      expected: { supportsReasoning: true, onlyReasoning: true, reasoning: { supportedEfforts: ['low', 'high'], canDisableThinking: false } }
    },
    {
      label: 'blank default', metadata: { thinking_levels: ['high'], thinking_default: ' \t ' },
      expected: { supportsReasoning: true, onlyReasoning: true, reasoning: { supportedEfforts: ['high'], canDisableThinking: false } }
    },
    {
      label: 'trim and lowercase levels/default on direct calls',
      metadata: { thinking_levels: [' MAX ', ' Low', 'max', ' XHIGH ', ' HIGH ', ' Medium ', ' low ', 'unknown'], thinking_default: ' XhIgH ' },
      expected: { supportsReasoning: true, onlyReasoning: true, reasoning: { supportedEfforts: ['max', 'low', 'xhigh', 'high', 'medium'], defaultEffort: 'xhigh', canDisableThinking: false } }
    },
    { label: 'trimmed mixed-case toggle', metadata: { thinking_levels: [' OFF ', ' On '], thinking_default: ' ON ' }, expected: { supportsReasoning: true, reasoning: { canDisableThinking: true } } },
    { label: 'trimmed mixed-case aliases', metadata: { thinking_levels: [' NONE ', ' Enabled ', ' DISABLED '], thinking_default: ' Enabled ' }, expected: { supportsReasoning: true, reasoning: { canDisableThinking: true } } }
  ])('handles $label without inventing reasoning metadata', ({ metadata, expected }) => {
    const input: SwitchModel[] = [{ model_id: 'metadata-fixture', name: 'Metadata Fixture', codexSupported: false, ...metadata }]
    const [model] = json(planWorkBuddyConfig('', input, SECRET)).models
    // Exact equality also requires absent fields (rather than false or undefined),
    // including efforts/defaults for toggles and reasoning for unknown metadata.
    expect(model).toEqual({
      id: 'Metadata Fixture', name: 'Metadata Fixture', vendor: 'VectCut', url: SWITCH_WORKBUDDY_URL,
      apiKey: SECRET, [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID, useCustomProtocol: false,
      supportsToolCall: true, supportsImages: false, ...expected
    })
    expectNoTopLevelReasoning(model)
  })

  it('exports identical native reasoning for DeepSeek Pro and Flash without inventing medium', () => {
    const input: SwitchModel[] = ['Pro', 'Flash'].map(variant => ({
      model_id: `deepseek-${variant.toLowerCase()}-fixture`, name: `DeepSeek ${variant}`, codexSupported: false,
      thinking_levels: ['off', 'low', 'high', 'max'], thinking_default: 'high'
    }))
    const planned = planWorkBuddyConfig('', input, SECRET)
    const exported = json(planned).models
    expect(exported.map((model: any) => model.id)).toEqual(['DeepSeek Pro', 'DeepSeek Flash'])
    for (const model of exported) {
      expect(model).toMatchObject({
        vendor: 'VectCut', useCustomProtocol: false, supportsReasoning: true,
        reasoning: { supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: true }
      })
      expect(model.reasoning.supportedEfforts).not.toContain('medium')
      expect(model).not.toHaveProperty('onlyReasoning')
      expectNoTopLevelReasoning(model)
    }
    expect(planWorkBuddyConfig(planned, input, SECRET)).toBe(planned)
  })

  it('does not derive input/output limits from context size or invent efforts', () => {
    const input = [{ ...models[1], context_window_tokens: 100000, thinking_levels: ['off', 'invented'], thinking_default: 'invented' }]
    const model = json(planWorkBuddyConfig('{}', input, SECRET)).models[0]
    expect(model).not.toHaveProperty('maxInputTokens')
    expect(model).not.toHaveProperty('maxOutputTokens')
    expectNoTopLevelReasoning(model)
    expect(model.reasoning).toEqual({ canDisableThinking: true })
  })

  it('preserves unrelated models/root fields and replaces only current owned selections', () => {
    const userModel = { id: 'personal', name: 'Personal', apiKey: 'other-fixture-key', extra: { nested: true } }
    const source = JSON.stringify({ before: { theme: 'dark' }, models: [userModel, owner('old')], availableModels: ['personal', 'old', 'personal'], after: true })
    const config = planWorkBuddyConfig(source, models, SECRET)
    expect(json(config)).toMatchObject({ before: { theme: 'dark' }, after: true })
    expect(json(config).models[0]).toEqual(userModel)
    expect(json(config).models.filter((model: any) => model[SWITCH_OWNER_FIELD] === SWITCH_PROVIDER_ID)).toHaveLength(models.length)
    expect(json(config).availableModels).toEqual(['personal', 'personal', 'Coding Model', 'Unknown Limits', 'Chat Only'])
    expect(planWorkBuddyConfig(config, models, SECRET)).toBe(config)
  })

  it('migrates old owned canonical IDs to display IDs and refreshes only their availableModels references', () => {
    const personal = { id: 'personal', name: 'Personal', apiKey: 'keep-key', extra: { preserved: true } }
    const source = JSON.stringify({
      models: [personal, ...models.map(model => owner(model.model_id, { name: model.name, apiKey: 'old-key' }))],
      availableModels: ['personal', models[0].model_id, 'personal', models[1].model_id, models[0].model_id, models[2].model_id],
      theme: 'dark'
    })
    const planned = planWorkBuddyConfig(source, models, SECRET)
    const parsed = json(planned)
    expect(parsed.models[0]).toEqual(personal)
    expect(parsed.models.map((model: any) => model.id)).toEqual(['personal', 'Coding Model', 'Unknown Limits', 'Chat Only'])
    expect(parsed.models.slice(1).every((model: any) => model.id === model.name && model.apiKey === SECRET)).toBe(true)
    expect(parsed.availableModels).toEqual(['personal', 'personal', 'Coding Model', 'Unknown Limits', 'Chat Only'])
    expect(parsed.theme).toBe('dark')
    expect(planWorkBuddyConfig(planned, models, SECRET)).toBe(planned)
    expect(json(removeWorkBuddySwitchConfig(planned))).toEqual({ models: [personal], availableModels: ['personal', 'personal'], theme: 'dark' })
  })

  it.each(['', ' \t\n '])('falls back to canonical ID for a blank display name %j and trims nonblank names', name => {
    const input = [{ ...models[0], name }, { ...models[1], name: '  Trimmed Display  ' }]
    const planned = planWorkBuddyConfig('{"models":[],"availableModels":["personal"]}', input, SECRET)
    expect(json(planned).models.map((model: any) => [model.id, model.name])).toEqual([
      [models[0].model_id, models[0].model_id], ['Trimmed Display', 'Trimmed Display']
    ])
    expect(json(planned).availableModels).toEqual(['personal', models[0].model_id, 'Trimmed Display'])
    expect(planWorkBuddyConfig(planned, input, SECRET)).toBe(planned)
  })

  it('exports only the first candidate for each display ID, including trimmed and fallback collisions, idempotently', () => {
    const input = [
      { ...models[0], name: ' Shared Display ' },
      { ...models[1], name: 'Shared Display' },
      { ...models[2], name: '   ' },
      { ...models[1], model_id: 'another-canonical-id', name: models[2].model_id }
    ]
    const source = JSON.stringify({ models: [owner('stale')], availableModels: ['personal', 'stale'] })
    const planned = planWorkBuddyConfig(source, input, SECRET)
    const parsed = json(planned)
    expect(parsed.models.map((model: any) => [model.id, model.name])).toEqual([
      ['Shared Display', 'Shared Display'], [models[2].model_id, models[2].model_id]
    ])
    // Distinct capabilities prove the first candidate won, not merely that IDs were deduplicated.
    expect(parsed.models[0]).toMatchObject({ supportsImages: true, maxInputTokens: 180000, reasoning: { defaultEffort: 'high' } })
    expect(parsed.models[1]).toMatchObject({ reasoning: { supportedEfforts: ['max'], defaultEffort: 'max' } })
    parsed.models.forEach(expectNoTopLevelReasoning)
    expect(new Set(parsed.models.map((model: any) => model.id)).size).toBe(parsed.models.length)
    expect(parsed.availableModels).toEqual(['personal', 'Shared Display', models[2].model_id])
    expect(planWorkBuddyConfig(planned, input, SECRET)).toBe(planned)
    expect(json(removeWorkBuddySwitchConfig(planned))).toEqual({ models: [], availableModels: ['personal'] })
  })

  it.each(['{}', '{"models":null}', '{"models":[],"availableModels":[]}'])('keeps empty/missing availableModels unchanged: %s', source => {
    const config = json(planWorkBuddyConfig(source, models, SECRET))
    if (source.includes('availableModels')) expect(config.availableModels).toEqual([])
    else expect(config).not.toHaveProperty('availableModels')
  })

  it.each(['null', '', '\uFEFF', '[]', '[{"id":"personal","name":"Keep"}]'])('accepts empty/null/legacy arrays and preserves shape: %s', source => {
    const config = planWorkBuddyConfig(source, models, SECRET)
    expect(config.startsWith('\uFEFF')).toBe(source.startsWith('\uFEFF'))
    expect(Array.isArray(json(config))).toBe(source.startsWith('['))
    if (source.includes('personal')) expect(json(config)[0]).toEqual({ id: 'personal', name: 'Keep' })
    expect(planWorkBuddyConfig(config, models, SECRET)).toBe(config)
  })

  it('preserves BOM, CRLF and unrelated JSON bytes when planning and removing', () => {
    const source = '\uFEFF{\r\n  "theme": {"keep" : true},\r\n  "models": [],\r\n  "other": [1,  2]\r\n}\r\n'
    const config = planWorkBuddyConfig(source, models, SECRET)
    for (const result of [config, removeWorkBuddySwitchConfig(config)]) {
      expect(result.startsWith('\uFEFF')).toBe(true)
      expect(result).toContain('"theme": {"keep" : true}')
      expect(result).toContain('"other": [1,  2]')
      expect(result.replace(/\r\n/g, '')).not.toContain('\n')
    }
  })

  it.each([
    `{"models": ["${SECRET}"]}`, `{"models": {"key":"${SECRET}"}}`,
    `{"models": [{"id":"one"},{"id":"one","apiKey":"${SECRET}"}]}`,
    `{"models": [{"name":"${SECRET}"}]}`, `{"availableModels":"${SECRET}"}`,
    `{"models":[],"models":[{"id":"${SECRET}"}]}`,
    `{"models":[], // ${SECRET}\n}`, `{"models":[],"apiKey":"${SECRET}",}`, `"${SECRET}"`,
    `{"models":[{"id":"broken","apiKey":"${SECRET}`,
    `{"models":[{"id":"one","nested":{"key":1,"key":"${SECRET}"}}]}`
  ])('rejects malformed/ambiguous JSON with fixed non-sensitive errors in every operation', source => {
    errorWithoutSecrets(() => planWorkBuddyConfig(source, models, SECRET))
    errorWithoutSecrets(() => inspectWorkBuddySwitchConfig(source))
    errorWithoutSecrets(() => removeWorkBuddySwitchConfig(source))
  })

  it.each([models[0].model_id, models[0].name])('skips unowned canonical or display ID %s without claiming user entries', occupiedId => {
    for (const marker of [undefined, 'someone_else', true, SWITCH_PROVIDER_ID + ' ']) {
      const personal = { id: occupiedId, name: 'Personal unchanged', apiKey: 'personal-key', [SWITCH_OWNER_FIELD]: marker, extra: { keep: true } }
      const source = JSON.stringify({ models: [personal, owner('stale')], availableModels: [personal.id, 'stale', personal.id], theme: 'dark' })
      const result = planWorkBuddyConfig(source, models, SECRET)
      const parsed = json(result)
      expect(parsed.models[0]).toEqual(json(JSON.stringify(personal)))
      expect(parsed.models.map((model: any) => model.id)).toEqual([personal.id, 'Unknown Limits', 'Chat Only'])
      expect(parsed.models.slice(1).every((model: any) => model[SWITCH_OWNER_FIELD] === SWITCH_PROVIDER_ID && model.id === model.name)).toBe(true)
      expect(new Set(parsed.models.map((model: any) => model.id)).size).toBe(parsed.models.length)
      expect(parsed.availableModels).toEqual([personal.id, personal.id, 'Unknown Limits', 'Chat Only'])
      expect(parsed.theme).toBe('dark')
      expect(planWorkBuddyConfig(result, models, SECRET)).toBe(result)
      expect(json(removeWorkBuddySwitchConfig(result))).toEqual({ models: [json(JSON.stringify(personal))], availableModels: [personal.id, personal.id], theme: 'dark' })
    }
  })

  it('removes an old owned canonical entry instead of migrating onto an occupied user display ID', () => {
    const personal = { id: models[0].name, name: 'Personal', apiKey: 'keep-user-key' }
    const source = JSON.stringify({
      models: [owner(models[0].model_id), personal],
      availableModels: [models[0].model_id, personal.id, personal.id]
    })
    const planned = planWorkBuddyConfig(source, models, SECRET)
    expect(json(planned).models.map((model: any) => model.id)).toEqual(['Unknown Limits', 'Chat Only', personal.id])
    expect(json(planned).models[2]).toEqual(personal)
    expect(json(planned).availableModels).toEqual([personal.id, personal.id, 'Unknown Limits', 'Chat Only'])
    expect(planWorkBuddyConfig(planned, models, SECRET)).toBe(planned)
    expect(json(removeWorkBuddySwitchConfig(planned))).toEqual({ models: [personal], availableModels: [personal.id, personal.id] })
  })

  it.each([
    ['object', 'canonical'], ['array', 'canonical'], ['object', 'display'], ['array', 'display']
  ])('accepts all occupied IDs as an exact no-op (%s, %s)', (shape, identity) => {
    const personal = models.map(model => ({ id: identity === 'canonical' ? model.model_id : model.name, apiKey: 'personal-key', vendor: 'Personal' }))
    const source = shape === 'array' ? JSON.stringify(personal) : JSON.stringify({ models: personal, availableModels: [personal[0].id], theme: 'dark' })
    expect(planWorkBuddyConfig(source, models, SECRET)).toBe(source)
    expect(inspectWorkBuddySwitchConfig(source)).toEqual({ enabled: false, hasManagedConfig: false })
    expect(removeWorkBuddySwitchConfig(source)).toBe(source)
  })

  it('still rejects invalid catalogs and empty credentials', () => {
    errorWithoutSecrets(() => planWorkBuddyConfig('{}', [models[0], models[0]], SECRET))
    errorWithoutSecrets(() => planWorkBuddyConfig('{}', [], SECRET))
    errorWithoutSecrets(() => planWorkBuddyConfig('{}', models, ' '))
  })
})

describe('WorkBuddy current ownership removal', () => {
  it.each(['', 'null', '[]', '\uFEFF{"models":null,"availableModels":[]}\r\n', '{"user":1}', '[{"id":"personal","name":"Personal"}]'])('is an exact no-op without strict markers: %s', source => {
    expect(inspectWorkBuddySwitchConfig(source)).toEqual({ enabled: false, hasManagedConfig: false })
    expect(removeWorkBuddySwitchConfig(source)).toBe(source)
    const applied = planWorkBuddyConfig(source, models, SECRET)
    expect(inspectWorkBuddySwitchConfig(applied)).toEqual({ enabled: true, hasManagedConfig: true })
    const removed = removeWorkBuddySwitchConfig(applied)
    expect(inspectWorkBuddySwitchConfig(removed)).toEqual({ enabled: false, hasManagedConfig: false })
    expect(removeWorkBuddySwitchConfig(removed)).toBe(removed)
  })

  it('removes current edited owned IDs and only their availableModels references, without historical backups', () => {
    const current = JSON.stringify({
      models: [
        { id: 'personal', name: 'After', url: SWITCH_WORKBUDDY_URL },
        owner('new-owned-id', { apiKey: 'edited-key', supportedEfforts: ['manual'], name: 'Edited' }),
        owner('another-owned-id'), { id: 'unmarked-old-id', name: 'Unmarked former owned model' }
      ],
      availableModels: ['personal', 'new-owned-id', 'new-owned-id', 'old-snapshot-id', 'another-owned-id', 'unmarked-old-id'],
      user: true, added: { preserved: 1 }
    })
    const removed = removeWorkBuddySwitchConfig(current)
    expect(json(removed)).toEqual({
      models: [{ id: 'personal', name: 'After', url: SWITCH_WORKBUDDY_URL }, { id: 'unmarked-old-id', name: 'Unmarked former owned model' }],
      availableModels: ['personal', 'old-snapshot-id', 'unmarked-old-id'], user: true, added: { preserved: 1 }
    })
    expect(removeWorkBuddySwitchConfig(removed)).toBe(removed)
  })

  it('does not infer ownership from URL/vendor/id/name or a nested/nonexact marker', () => {
    const source = JSON.stringify({ models: [
      { id: models[0].model_id, name: 'VectCut Switch', vendor: '流光剪辑', url: SWITCH_WORKBUDDY_URL, apiKey: SECRET },
      { id: 'nested', extra: { [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID } },
      { id: 'wrong-marker', [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID + ' ' }
    ], availableModels: [models[0].model_id] })
    expect(inspectWorkBuddySwitchConfig(source)).toEqual({ enabled: false, hasManagedConfig: false })
    expect(removeWorkBuddySwitchConfig(source)).toBe(source)
  })

  it('preserves newly unmarked same-id models and their selections after user drops markers', () => {
    const applied = json(planWorkBuddyConfig('{"models":[],"availableModels":["personal"]}', models, SECRET))
    delete applied.models[0][SWITCH_OWNER_FIELD]
    const removed = json(removeWorkBuddySwitchConfig(JSON.stringify(applied)))
    expect(removed.models).toEqual([applied.models[0]])
    expect(removed.availableModels).toEqual(['personal', 'Coding Model'])
  })

  it('updates latest owned model edits without conflict, then removes only the new current IDs', () => {
    const current = JSON.stringify({ models: [{ id: 'user', extra: true }, owner('manual-id', { apiKey: 'changed' })], availableModels: ['user', 'manual-id'] })
    const planned = planWorkBuddyConfig(current, models, SECRET)
    expect(json(planned).models.map((model: any) => model.id)).toEqual(['user', 'Coding Model', 'Unknown Limits', 'Chat Only'])
    expect(json(removeWorkBuddySwitchConfig(planned))).toEqual({ models: [{ id: 'user', extra: true }], availableModels: ['user'] })
  })

  it('retains legacy array shape through owned and unrelated model edits', () => {
    const current = '[{"id":"personal","name":"New"},' + JSON.stringify(owner('changed-id')) + ']'
    const removed = removeWorkBuddySwitchConfig(current)
    expect(json(removed)).toEqual([{ id: 'personal', name: 'New' }])
    expect(removeWorkBuddySwitchConfig(removed)).toBe(removed)
  })
})
