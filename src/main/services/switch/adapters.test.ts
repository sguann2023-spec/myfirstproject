import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser'
import {
  SWITCH_CODEX_BASE_URL,
  SWITCH_OWNER_FIELD,
  SWITCH_PROVIDER_ID,
  SWITCH_WORKBUDDY_URL,
  type SwitchModel
} from '../../../packages/shared/switchSettings'
import { inspectCodexSwitchConfig, planCodexConfig, rebaseCodexConfig, restoreCodexConfig } from './codexConfig'
import { inspectWorkBuddySwitchConfig, planWorkBuddyConfig, restoreWorkBuddyConfig } from './workbuddyConfig'

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
const options = { models, modelId: models[0].model_id, key: SECRET, catalogPath: '/fixture/cache/catalog.json' }
const toml = (source: string) => getStaticTOMLValue(parseTOML(source.replace(/^\uFEFF/, ''), { tomlVersion: '1.0' })) as Record<string, any>
const json = (source: string) => JSON.parse(source.replace(/^\uFEFF/, ''))
const owner = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID, ...extra })
// Construct legacy catalog snapshots explicitly; the planner no longer emits this pointer.
function withLegacyCatalog(config: string): string {
  return `model_catalog_json = "${options.catalogPath}"\n` + config
}
// Emulate snapshots from the adapter that managed routing but left root search untouched.
function legacyCodexConfig(before: string): string {
  const search = toml(before).web_search
  return withLegacyCatalog(planCodexConfig(before, options).config.replace('web_search = "disabled"\n', search === undefined ? '' : `web_search = "${search}"\n`))
}
function errorWithoutSecrets(action: () => unknown): void {
  let error: unknown
  try { action() } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error)
  expect(String(error)).not.toContain(SECRET)
}

describe('Codex config planning', () => {
  it('creates only a native provider with no catalog, auth files, instructions or invented capabilities', () => {
    const { config, catalog } = planCodexConfig('', options)
    const value = toml(config)
    expect(value).toEqual({
      model: models[0].model_id, model_provider: SWITCH_PROVIDER_ID, model_reasoning_effort: 'high', web_search: 'disabled',
      model_providers: { [SWITCH_PROVIDER_ID]: {
        name: 'VectCut Switch', base_url: SWITCH_CODEX_BASE_URL,
        experimental_bearer_token: SECRET, requires_openai_auth: false, wire_api: 'responses',
        http_headers: { 'X-Client-Type': 'pc' }, query_params: { client_type: 'pc' }
      } }
    })
    expect(config).not.toContain('auth.json')
    expect(config).not.toContain('model_catalog_json')
    expect(config).not.toContain(options.catalogPath)
    expect(catalog).toBeNull()
    // The retained path option is migration-only and is unnecessary without a reference.
    expect(planCodexConfig('', { ...options, catalogPath: '' })).toEqual({ config, catalog: null })
  })

  it('protects every external catalog reference with a fixed error and never reads the referenced file', () => {
    const reads = [
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('unexpected file read') }),
      vi.spyOn(fs, 'readFile').mockImplementation(() => { throw new Error('unexpected file read') }),
      vi.spyOn(fsPromises, 'readFile').mockImplementation(() => { throw new Error('unexpected file read') })
    ]
    const message = '检测到外部模型目录配置，请先在 Codex 中确认并移除该引用后重试'
    try {
      for (const value of [JSON.stringify(`/external/${SECRET}/catalog.json`), JSON.stringify(options.catalogPath), 'false', '42', '[]', '{}', '""']) {
        for (const removeManagedCatalog of [undefined, false, true]) {
          if (value === JSON.stringify(options.catalogPath) && removeManagedCatalog === true) continue
          for (const overwriteProvider of [false, true]) {
            const source = `model_catalog_json = ${value}\n`
            expect(() => planCodexConfig(source, { ...options, removeManagedCatalog, overwriteProvider })).toThrow(new Error(message))
          }
        }
      }
      for (const read of reads) expect(read).not.toHaveBeenCalled()
    } finally {
      reads.forEach(read => read.mockRestore())
    }
  })

  it.each([options.catalogPath, '/fixture/cache/old/../catalog.json'])('removes only an explicitly approved managed pointer %s, preserving BOM, CRLF and comments idempotently', catalogPath => {
    const unrelated = '# keep catalog explanation\r\napproval_policy = \'on-request\' # user choice\r\n[features]\r\nuser_feature = true\r\n'
    const before = '\uFEFF# keep top\r\nmodel = "old"\r\n  "model_catalog_json"  =  ' + JSON.stringify(catalogPath) + ' # keep trailing comment\r\n' + unrelated
    const selected = { ...options, removeManagedCatalog: true }
    const planned = planCodexConfig(before, selected)
    expect(planned.catalog).toBeNull()
    expect(planned.config.startsWith('\uFEFF# keep top\r\n')).toBe(true)
    expect(planned.config).toContain('  # keep trailing comment\r\n' + unrelated)
    expect(planned.config.replace(/\r\n/g, '')).not.toContain('\n')
    expect(toml(planned.config)).not.toHaveProperty('model_catalog_json')
    expect(planCodexConfig(planned.config, selected)).toEqual(planned)
    expect(planCodexConfig(planned.config, options)).toEqual(planned)
    expect(restoreCodexConfig(planned.config, before, planned.config)).toBe(before)
  })

  it('matches managed catalog paths using only native path normalization, not a filename or prefix', () => {
    const selected = { ...options, removeManagedCatalog: true, catalogPath: resolve('fixture/catalog.json') }
    expect(toml(planCodexConfig('model_catalog_json = "fixture/old/../catalog.json"\n', selected).config)).not.toHaveProperty('model_catalog_json')
    for (const path of [selected.catalogPath + '.other', resolve('other/catalog.json'), selected.catalogPath + '/nested']) {
      expect(() => planCodexConfig(`model_catalog_json = ${JSON.stringify(path)}\n`, selected)).toThrow('检测到外部模型目录配置，请先在 Codex 中确认并移除该引用后重试')
    }
  })

  it('leaves unrelated root user options, instructions and capabilities byte-for-byte without injecting catalog defaults', () => {
    const unrelated = [
      "approval_policy = 'on-request' # user policy",
      "sandbox_mode = 'workspace-write'",
      "developer_instructions = 'User instructions, not generated defaults'",
      'custom_tools = { enabled = true, names = ["my-tool"] }',
      'context_window = 123456 # user limit',
      'model_catalog_json_note = "not a pointer"'
    ].join('\n') + '\n'
    const planned = planCodexConfig(unrelated, options)
    expect(planned.config).toContain(unrelated)
    expect(planned.catalog).toBeNull()
    expect(toml(planned.config)).not.toHaveProperty('model_catalog_json')
    expect(planCodexConfig(planned.config, options)).toEqual(planned)
  })

  it('preserves BOM, CRLF, comments, multiline strings, MCP and inactive profiles byte-for-byte', () => {
    const unrelated = [
      '# unrelated block',
      'developer_instructions = """',
      'model = "this is text, not a setting"',
      '"""',
      '[mcp_servers."server.with.dot"] # preserve',
      'command = "fixture-tool"',
      'args = ["--flag", "#literal"]',
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
    expect(toml(config).profiles.work.model).toBe('profile-model')
  })

  it.each([undefined, 'enabled', 'cached', 'live', 'disabled'])('disables root search from %s without touching provider/profile search and is idempotent', search => {
    const root = search === undefined ? '' : `"web_search" = '${search}' # root search\r\n`
    const unrelated = '[mcp_servers.keep]\r\ncommand = "fixture"\r\n[profiles.inactive]\r\nweb_search = "live" # keep profile\r\n'
    const source = '\uFEFF# search fixture\r\n' + root + unrelated
    const planned = planCodexConfig(source, options)
    expect(toml(planned.config).web_search).toBe('disabled')
    expect(toml(planned.config).model_providers[SWITCH_PROVIDER_ID]).not.toHaveProperty('web_search')
    expect(planned.config.startsWith('\uFEFF# search fixture\r\n')).toBe(true)
    expect(planned.config).toContain(unrelated)
    expect(planned.config.replace(/\r\n/g, '')).not.toContain('\n')
    if (search !== undefined) expect(planned.config).toContain(`"web_search" = ${search === 'disabled' ? "'disabled'" : '"disabled"'} # root search\r\n`)
    expect(planCodexConfig(planned.config, options)).toEqual(planned)
  })

  it('preserves an unowned provider-level search setting while disabling the root', () => {
    const source = `[model_providers.${SWITCH_PROVIDER_ID}]\nname = "VectCut Switch"\nbase_url = "${SWITCH_CODEX_BASE_URL}"\nweb_search = 'live' # provider setting\n`
    const config = planCodexConfig(source, options).config
    expect(toml(config).web_search).toBe('disabled')
    expect(toml(config).model_providers[SWITCH_PROVIDER_ID].web_search).toBe('live')
    expect(config).toContain("web_search = 'live' # provider setting\n")
  })

  it.each([
    'model_providers = { other = { name = "custom", base_url = "https://fixture.invalid" } }\n',
    '[model_providers]\nother.name = "custom"\nother.base_url = "https://fixture.invalid"\n',
    '[model_providers.other]\nname="custom"\nbase_url="https://fixture.invalid"\n',
    `model_providers.${SWITCH_PROVIDER_ID}.name = "VectCut Switch"\nmodel_providers.${SWITCH_PROVIDER_ID}.base_url = "${SWITCH_CODEX_BASE_URL}"\n`,
    `[model_providers."${SWITCH_PROVIDER_ID}"]\nname = "VectCut Switch"\nbase_url = "${SWITCH_CODEX_BASE_URL}"\n[model_providers."${SWITCH_PROVIDER_ID}".http_headers]\nkeep = "yes"\n`
  ])('supports inline, dotted and quoted provider structures', source => {
    const { config } = planCodexConfig(source, options)
    const value = toml(config)
    expect(value.model_providers[SWITCH_PROVIDER_ID].http_headers['X-Client-Type']).toBe('pc')
    if (source.includes('other')) expect(value.model_providers.other.name).toBe('custom')
    if (source.includes('keep =')) expect(value.model_providers[SWITCH_PROVIDER_ID].http_headers.keep).toBe('yes')
    expect(planCodexConfig(config, options).config).toBe(config)
  })

  it.each([
    `[model_providers.${SWITCH_PROVIDER_ID}]\nname = "manual"\nbase_url = "https://manual.invalid"\nexperimental_bearer_token = "manual-key"\nenv_key = "MANUAL_KEY"\n[model_providers.${SWITCH_PROVIDER_ID}.http_headers]\nAuthorization = "manual-auth"\n`,
    `model_providers = { other = { name = "keep" }, ${SWITCH_PROVIDER_ID} = { name = "manual", base_url = "https://manual.invalid", aws = { region = "manual" } } }\n`,
    `model_providers.${SWITCH_PROVIDER_ID}.name = "manual"\nmodel_providers.${SWITCH_PROVIDER_ID}.env_key = "MANUAL_KEY"\n`
  ])('explicitly updates only the dedicated provider after manual changes without duplicate keys', provider => {
    const source = '# keep settings\nmodel = "manually-selected"\nmodel_reasoning_effort = "low"\n' + provider + '[mcp_servers.keep]\ncommand = "keep-command"\n'
    const planned = planCodexConfig(source, { ...options, overwriteProvider: true })
    const parsed = toml(planned.config)
    expect(parsed.model).toBe(options.modelId)
    expect(parsed.model_providers[SWITCH_PROVIDER_ID]).toMatchObject({ name: 'VectCut Switch', base_url: SWITCH_CODEX_BASE_URL, experimental_bearer_token: SECRET })
    expect(parsed.model_providers[SWITCH_PROVIDER_ID]).not.toHaveProperty('env_key')
    expect(parsed.model_providers[SWITCH_PROVIDER_ID]).not.toHaveProperty('aws')
    expect(parsed.model_providers[SWITCH_PROVIDER_ID].http_headers).not.toHaveProperty('Authorization')
    if (source.includes('other =')) expect(parsed.model_providers.other.name).toBe('keep')
    expect(parsed.mcp_servers.keep.command).toBe('keep-command')
    expect(planned.config).toContain('# keep settings')
    expect(planCodexConfig(planned.config, options).config).toBe(planned.config)
  })

  it('rebases an explicit update onto first managed values and latest unrelated edits', () => {
    const before = "model = 'original' # preserve root\nmodel_reasoning_effort = 'low'\nweb_search = 'cached'\n[mcp_servers.keep]\ncommand = 'before'\n"
    const applied = planCodexConfig(before, options).config
    const current = applied.replace('model = "gpt-fixture/coding-model"', 'model = "manual-model"').replace('model_reasoning_effort = "high"', 'model_reasoning_effort = "max"').replace("command = 'before'", "command = 'after'").replace(SECRET, 'manual-key')
    const planned = planCodexConfig(current, { ...options, overwriteProvider: true }).config
    const baseline = rebaseCodexConfig(current, before, applied, planned)
    const restored = toml(baseline)
    expect(restored).toMatchObject({ model: 'original', model_reasoning_effort: 'low', web_search: 'cached', mcp_servers: { keep: { command: 'after' } } })
    expect(restored.model_providers?.[SWITCH_PROVIDER_ID]).toBeUndefined()
    expect(baseline).toContain("model = 'original' # preserve root")
    expect(baseline).not.toContain('manual-key')
    expect(restoreCodexConfig(planned, baseline, planned)).toBe(baseline)
  })

  it('only changes an explicit review model when it cannot use the new provider catalog', () => {
    const retained = planCodexConfig('review_model = "gpt-fixture-unknown-limits" # review\n', options).config
    expect(retained).toContain('review_model = "gpt-fixture-unknown-limits" # review')
    const rerouted = planCodexConfig('review_model = "old-native" # review\n', options).config
    expect(rerouted).toContain('review_model = "gpt-fixture/coding-model" # review')
    expect(toml(planCodexConfig('', options).config)).not.toHaveProperty('review_model')
  })

  it.each(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])('uses native reasoning effort %s when advertised', level => {
    const changed = [{ ...models[0], thinking_default: level, thinking_levels: [level] }]
    expect(toml(planCodexConfig('', { ...options, models: changed }).config).model_reasoning_effort).toBe(level)
  })

  it.each(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])('preserves current same-model native effort %s when supported', level => {
    const changed = [{ ...models[0], thinking_levels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], thinking_default: 'medium' }]
    const source = `model = "${options.modelId}"\nmodel_reasoning_effort = '${level}' # user choice\n`
    const planned = planCodexConfig(source, { ...options, models: changed })
    expect(planned.config).toContain(`model_reasoning_effort = '${level}' # user choice\n`)
    expect(planCodexConfig(planned.config, { ...options, models: changed })).toEqual(planned)
  })

  it.each([
    { thinking_levels: undefined, thinking_default: undefined },
    { thinking_levels: [], thinking_default: 'high' },
    { thinking_levels: ['max', 'ultra', 'invented'], thinking_default: 'ultra' }
  ])('retains sparse same-model xhigh but defaults new selections to medium for metadata %j', metadata => {
    const changed = [{ ...models[1], ...metadata }]
    const selected = { ...options, models: changed, modelId: changed[0].model_id }
    const sameModel = `model = "${selected.modelId}"\nmodel_reasoning_effort = 'xhigh' # keep choice\n`
    expect(planCodexConfig(sameModel, selected).config).toContain("model_reasoning_effort = 'xhigh' # keep choice\n")
    const newModel = planCodexConfig('model = "previous"\nmodel_reasoning_effort = "xhigh" # keep note\n', selected).config
    expect(newModel).toContain('model_reasoning_effort = "medium" # keep note\n')
    expect(toml(planCodexConfig('', selected).config).model_reasoning_effort).toBe('medium')
  })

  it.each(['max', 'ultra', 'off', 'on', 'invented', 1, true])('does not preserve non-native current effort %j even for sparse same-model metadata', level => {
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
  ])('chooses valid default, supported medium, or first native level for %j', ({ expected, ...metadata }) => {
    const changed = [{ ...models[0], ...metadata }]
    const unsupportedCurrent = `model = "${options.modelId}"\nmodel_reasoning_effort = "xhigh"\n`
    expect(toml(planCodexConfig('', { ...options, models: changed }).config).model_reasoning_effort).toBe(expected)
    expect(toml(planCodexConfig(unsupportedCurrent, { ...options, models: changed }).config).model_reasoning_effort).toBe(expected)
  })

  it.each(['off', 'on'])('maps generic toggle levels and default %s to only none/high', thinking_default => {
    const changed = [{ ...models[0], model_id: 'gpt-fixture-toggle', thinking_levels: ['off', 'on'], thinking_default }]
    const selected = { ...options, models: changed, modelId: changed[0].model_id }
    const { config, catalog } = planCodexConfig('', selected)
    expect(toml(config).model_reasoning_effort).toBe(thinking_default === 'off' ? 'none' : 'high')
    expect(catalog).toBeNull()
    const sameModel = `model = "${selected.modelId}"\nmodel_reasoning_effort = 'none' # native choice\n`
    expect(planCodexConfig(sameModel, selected).config).toContain("model_reasoning_effort = 'none' # native choice\n")
  })

  it('does not invent efforts from an on default when on is not declared', () => {
    const changed = [{ ...models[0], thinking_levels: ['off'], thinking_default: 'on' }]
    expect(toml(planCodexConfig('', { ...options, models: changed }).config).model_reasoning_effort).toBe('none')
  })

  it.each(['true', 1, {}, undefined, null])('requires literal true for Codex eligibility, not truthy %j', codexSupported => {
    const unsafe = { ...models[0], model_id: 'unsafe', codexSupported } as unknown as SwitchModel
    const { config, catalog } = planCodexConfig('', { ...options, models: [models[0], unsafe] })
    expect(toml(config).model).toBe(models[0].model_id)
    expect(catalog).toBeNull()
    errorWithoutSecrets(() => planCodexConfig('', { ...options, models: [unsafe], modelId: 'unsafe' }))
  })

  it('exposes guarded preflight inspection without evaluating prototype-sensitive keys', () => {
    expect(inspectCodexSwitchConfig('')).toEqual({ enabled: false, hasProvider: false, searchDisabled: false, hasModelCatalog: false })
    expect(inspectCodexSwitchConfig('model_provider = "vectcut_switch"')).toEqual({ enabled: false, hasProvider: true, searchDisabled: false, hasModelCatalog: false })
    expect(inspectCodexSwitchConfig(planCodexConfig('', options).config)).toEqual({ enabled: true, hasProvider: true, searchDisabled: true, hasModelCatalog: false })
    errorWithoutSecrets(() => inspectCodexSwitchConfig(`items = [{ __proto__ = { secret = "${SECRET}" } }]`))
    expect(inspectWorkBuddySwitchConfig('{"models":[]}')).toEqual({ enabled: false })
    expect(inspectWorkBuddySwitchConfig(planWorkBuddyConfig('', models, SECRET))).toEqual({ enabled: true })
    errorWithoutSecrets(() => inspectWorkBuddySwitchConfig(`{"models":[{"apiKey":"${SECRET}"}]}`))
  })

  it('reports root catalog presence and string path for migration, including non-string legacy values', () => {
    expect(inspectCodexSwitchConfig(`model_catalog_json = ${JSON.stringify(options.catalogPath)}\n`)).toMatchObject({ hasModelCatalog: true, modelCatalogPath: options.catalogPath })
    for (const value of ['false', '42', '[]', '{}']) {
      const inspected = inspectCodexSwitchConfig(`model_catalog_json = ${value}\n`)
      expect(inspected.hasModelCatalog).toBe(true)
      expect(inspected).not.toHaveProperty('modelCatalogPath')
    }
    expect(inspectCodexSwitchConfig('[profiles.inactive]\nmodel_catalog_json = "external"\n').hasModelCatalog).toBe(false)
    expect(inspectCodexSwitchConfig('profile = "work"\n[profiles.work]\nmodel_catalog_json = "legacy"\n').hasModelCatalog).toBe(false)
  })

  it('inspects root and active-profile search without applying new profile validation to legacy configs', () => {
    expect(inspectCodexSwitchConfig('web_search = "disabled"\n[profiles.inactive]\nweb_search = "live"\n').searchDisabled).toBe(true)
    expect(inspectCodexSwitchConfig('profile = "work"\nweb_search = "disabled"\n[profiles.work]\nweb_search = "live"\n').searchDisabled).toBe(false)
    expect(inspectCodexSwitchConfig('profile = "work"\nweb_search = "disabled"\n[profiles.work]\nweb_search = "disabled"\n').searchDisabled).toBe(false)
    expect(inspectCodexSwitchConfig('profile = "work"\n[profiles.work]\nweb_search = "disabled"\n').searchDisabled).toBe(false)
  })

  it('is deterministic and idempotent including bearer-key updates', () => {
    const first = planCodexConfig('# fixture\n', options)
    expect(planCodexConfig(first.config, options)).toEqual(first)
    const second = planCodexConfig(first.config, { ...options, key: 'new-fixture-key', modelId: 'gpt-fixture-unknown-limits' })
    expect(toml(second.config).model_providers[SWITCH_PROVIDER_ID].experimental_bearer_token).toBe('new-fixture-key')
    expect(toml(second.config).model).toBe('gpt-fixture-unknown-limits')
    expect(toml(second.config).model_reasoning_effort).toBe('medium')
  })

  it.each(['model', 'model_provider', 'model_catalog_json', 'model_reasoning_effort', 'review_model', 'web_search'])('rejects active profile override %s, but not unrelated active profile options', field => {
    errorWithoutSecrets(() => planCodexConfig(`profile = "work"\n[profiles.work]\n${field} = "${SECRET}"\n`, options))
    expect(toml(planCodexConfig('profile = "work"\n[profiles.work]\nsandbox_mode = "read-only"\n', options).config).profiles.work.sandbox_mode).toBe('read-only')
  })

  it.each([
    'profile = "work"\nweb_search = "disabled"\n[profiles.work]\nweb_search = "disabled"\n',
    'profile = "work"\nprofiles = { work = { web_search = "live" } }\n',
    'profile = "work"\nprofiles.work.web_search = "cached"\n'
  ])('rejects all active-profile search declarations, including disabled and inline/dotted profiles', source => {
    expect(() => planCodexConfig(source, options)).toThrow('active profile overrides')
  })

  it.each([
    `model = "${SECRET}\n`,
    `model = "one"\nmodel = "${SECRET}"\n`,
    `model_providers = "${SECRET}"\n`,
    `[model_providers.${SWITCH_PROVIDER_ID}]\nname = "${SECRET}"\nbase_url = "${SWITCH_CODEX_BASE_URL}"\n`,
    `[model_providers.${SWITCH_PROVIDER_ID}]\nname = "VectCut Switch"\nbase_url = "${SECRET}"\n`,
    `[model_providers.${SWITCH_PROVIDER_ID}]\nname = "VectCut Switch"\nbase_url = "${SWITCH_CODEX_BASE_URL}"\nenv_key = "${SECRET}"\n`,
    `__proto__.secret = "${SECRET}"\n`
  ])('fails safely without exposing invalid/conflicting source', source => {
    errorWithoutSecrets(() => planCodexConfig(source, options))
  })

  it.each([
    'aws = { region = "fixture" }',
    'env_http_headers = { Authorization = "FIXTURE_TOKEN" }',
    'http_headers.Authorization = "override"',
    'http_headers.aUtHoRiZaTiOn = "override"',
    'http_headers.Host = "fixture.invalid"',
    'http_headers.hOsT = "fixture.invalid"'
  ])('rejects alternate auth and route declarations on the owned provider: %s', declaration => {
    const before = `[model_providers.${SWITCH_PROVIDER_ID}]\nname = "VectCut Switch"\nbase_url = "${SWITCH_CODEX_BASE_URL}"\n${declaration.replace('override', SECRET)}\n`
    errorWithoutSecrets(() => planCodexConfig(before, options))
    const applied = planCodexConfig('', options).config
    errorWithoutSecrets(() => restoreCodexConfig(applied + declaration.replace('override', SECRET) + '\n', '', applied))
  })

  it('preserves benign provider headers in planning and restoration', () => {
    const before = `[model_providers.${SWITCH_PROVIDER_ID}]\nname = "VectCut Switch"\nbase_url = "${SWITCH_CODEX_BASE_URL}"\nhttp_headers."X-Trace" = "original"\n`
    const applied = planCodexConfig(before, options).config
    expect(toml(applied).model_providers[SWITCH_PROVIDER_ID].http_headers['X-Trace']).toBe('original')
    const current = applied.replace('"original"', '"changed"')
    const restored = restoreCodexConfig(current, before, applied)
    expect(toml(restored).model_providers[SWITCH_PROVIDER_ID].http_headers).toEqual({ 'X-Trace': 'changed' })
  })

  it('rejects missing, unsupported, duplicate models and empty credentials without leaking keys', () => {
    errorWithoutSecrets(() => planCodexConfig('', { ...options, modelId: SECRET }))
    errorWithoutSecrets(() => planCodexConfig('', { ...options, modelId: 'chat-only' }))
    errorWithoutSecrets(() => planCodexConfig('', { ...options, models: [models[0], models[0]] }))
    errorWithoutSecrets(() => planCodexConfig('', { ...options, key: ' ' }))
  })
})

describe('Codex three-way restoration', () => {
  const source = '# before\nmodel = \'old\' # chosen model\nmodel_reasoning_effort = "low"\nreview_model = "old-review"\n[mcp_servers.keep]\ncommand = "before"\n'

  it('returns the exact original bytes when current is the applied version', () => {
    const before = '\uFEFF' + source.replace(/\n/g, '\r\n')
    const applied = planCodexConfig(before, options).config
    expect(restoreCodexConfig(applied, before, applied)).toBe(before)
    expect(restoreCodexConfig(before, before, applied)).toBe(before)
  })

  it('preserves unrelated edits, provider additions and all current comments', () => {
    const applied = planCodexConfig(source, options).config
    const current = applied.replace('command = "before"', 'command = "after" # user changed') + '# user tail\n[model_providers.another]\nname = "other"\n'
    const restored = restoreCodexConfig(current, source, applied)
    expect(toml(restored)).toMatchObject({ model: 'old', model_reasoning_effort: 'low', review_model: 'old-review', mcp_servers: { keep: { command: 'after' } } })
    expect(toml(restored)).not.toHaveProperty('model_provider')
    expect(toml(restored).model_providers).toEqual({ another: { name: 'other' } })
    expect(restored).toContain("model = 'old' # chosen model")
    expect(restored).toContain('# user changed')
    expect(restored).toContain('# user tail')
    expect(restoreCodexConfig(restored, source, applied)).toBe(restored)
  })

  it('keeps new unowned provider fields rather than deleting the whole provider', () => {
    const applied = planCodexConfig('', options).config
    const current = applied + 'custom_timeout = 123\nhttp_headers."User-Header" = "keep"\n'
    const restored = restoreCodexConfig(current, '', applied)
    expect(toml(restored).model_providers[SWITCH_PROVIDER_ID]).toEqual({ custom_timeout: 123, http_headers: { 'User-Header': 'keep' } })
    expect(restoreCodexConfig(restored, '', applied)).toBe(restored)
  })

  it('restores old recognized provider fields while preserving unrelated later edits', () => {
    const before = `model_providers = { ${SWITCH_PROVIDER_ID} = { name = "VectCut Switch", base_url = "${SWITCH_CODEX_BASE_URL}", experimental_bearer_token = "previous", custom = 7 } }\n`
    const applied = planCodexConfig(before, options).config
    const current = applied + 'user_setting = "new"\n'
    const restored = restoreCodexConfig(current, before, applied)
    expect(toml(restored).model_providers[SWITCH_PROVIDER_ID]).toEqual({ name: 'VectCut Switch', base_url: SWITCH_CODEX_BASE_URL, experimental_bearer_token: 'previous', custom: 7 })
    expect(toml(restored).user_setting).toBe('new')
  })

  it.each([
    (value: string) => value.replace('model = "gpt-fixture/coding-model"', `model = "${SECRET}"`),
    (value: string) => value.replace('requires_openai_auth = false', 'requires_openai_auth = true'),
    (value: string) => value.replace('query_params.client_type = "pc"', 'query_params.client_type = "external"'),
    (value: string) => value.replace('model_reasoning_effort = "high"\n', ''),
    (value: string) => value.replace('model = "gpt-fixture/coding-model"', 'model = \'old\''),
    (value: string) => value.replace('model_catalog_json = "/fixture/cache/catalog.json"', '') + 'profile = "work"\n[profiles.work]\nmodel = "external"\n'
  ])('rejects external changes to managed fields without leaking secrets', change => {
    const applied = withLegacyCatalog(planCodexConfig(source, options).config)
    errorWithoutSecrets(() => restoreCodexConfig(change(applied), source, applied))
  })

  it.each([undefined, 'enabled', 'cached', 'live'])('restores raw root search from %s while retaining BOM, CRLF and unrelated edits', search => {
    const setting = search === undefined ? '' : `"web_search"  =  '${search}' # keep search note\r\n`
    const before = '\uFEFF# fixture\r\n' + setting + 'model = "old"\r\n[mcp_servers.keep]\r\ncommand = "before"\r\n'
    const applied = planCodexConfig(before, options).config
    const current = applied.replace('command = "before"', 'command = "after"')
    const restored = restoreCodexConfig(current, before, applied)
    expect(restored.startsWith('\uFEFF# fixture\r\n')).toBe(true)
    expect(restored.replace(/\r\n/g, '')).not.toContain('\n')
    if (search === undefined) expect(toml(restored)).not.toHaveProperty('web_search')
    else expect(restored).toContain(setting)
    expect(toml(restored).mcp_servers.keep.command).toBe('after')
    expect(restoreCodexConfig(restored, before, applied)).toBe(restored)
  })

  it.each(['cached', 'live', undefined])('rejects an external change to owned search (%s)', search => {
    const applied = planCodexConfig(source, options).config
    const current = applied.replace('web_search = "disabled"\n', search === undefined ? '' : `web_search = "${search}"\n`)
    expect(() => restoreCodexConfig(current, source, applied)).toThrow('changed outside Switch')
  })

  it('rejects a new active-profile search override only when the snapshot owns search', () => {
    const applied = planCodexConfig(source, options).config
    const current = 'profile = "work"\n' + applied + '[profiles.work]\nweb_search = "live"\n'
    expect(() => restoreCodexConfig(current, source, applied)).toThrow('active profile overrides')
  })

  it('does not acquire ownership of search that was already disabled before applying', () => {
    const before = "web_search = 'disabled' # pre-existing\nmodel = 'old'\n"
    const applied = planCodexConfig(before, options).config
    const current = applied.replace("web_search = 'disabled'", "web_search = 'live'")
    expect(restoreCodexConfig(current, before, applied).trimEnd()).toBe(before.replace("'disabled'", "'live'").trimEnd())
    const withProfile = 'profile = "work"\n' + current + '[profiles.work]\nweb_search = "cached"\n'
    expect(toml(restoreCodexConfig(withProfile, before, applied))).toMatchObject({ web_search: 'live', profiles: { work: { web_search: 'cached' } } })
  })

  it.each([undefined, 'enabled', 'cached', 'live', 'disabled'])('restores legacy snapshots with unchanged search %s without claiming later edits', search => {
    const setting = search === undefined ? '' : `web_search = "${search}"\n`
    const before = setting + 'model = "old"\n'
    const applied = legacyCodexConfig(before)
    expect(toml(applied).web_search).toBe(search)
    expect(restoreCodexConfig(applied, before, applied)).toBe(before)
    const current = search === undefined ? 'web_search = "external"\n' + applied : applied.replace(`web_search = "${search}"`, 'web_search = "external"')
    const restored = restoreCodexConfig(current, before, applied)
    expect(restored.trimEnd()).toBe('web_search = "external"\nmodel = "old"')
    expect(restoreCodexConfig(restored, before, applied)).toBe(restored)
    const updated = planCodexConfig(current, { ...options, removeManagedCatalog: true }).config
    const changedAgain = updated.replace('web_search = "disabled"', 'web_search = "live"')
    expect(() => restoreCodexConfig(changedAgain, restored, updated)).toThrow('changed outside Switch')
    expect(restoreCodexConfig(updated, restored, updated)).toBe(restored)
  })

  it('compares legacy search ownership semantically rather than by original quote style', () => {
    const before = "web_search = 'cached'\nmodel = 'old'\n"
    const applied = legacyCodexConfig(before)
    expect(applied).toContain('web_search = "cached"\n')
    const current = applied.replace('web_search = "cached"', 'web_search = "live"')
    const restored = restoreCodexConfig(current, before, applied)
    expect(restored).toContain('web_search = "live"\n')
    expect(toml(restored).model).toBe('old')
  })

  it.each([undefined, 'cached'])('permits legacy active-profile search on restore with root search %s, but rejects it on next apply', search => {
    const base = (search === undefined ? '' : `web_search = "${search}"\n`) + 'model = "old"\n'
    const profile = '[profiles.work]\nweb_search = "live" # legacy override\n'
    const before = 'profile = "work"\n' + base + profile
    const applied = 'profile = "work"\n' + legacyCodexConfig(base) + profile
    expect(restoreCodexConfig(applied, before, applied)).toBe(before)
    const current = applied.replace('# legacy override', '# changed by user')
    const restored = restoreCodexConfig(current, before, applied)
    expect(toml(restored).profiles.work.web_search).toBe('live')
    expect(restored).toContain('# changed by user')
    expect(() => planCodexConfig(current, options)).toThrow('active profile overrides')
    // Existing managed-field overrides are still conflicts for old snapshots.
    expect(() => restoreCodexConfig(current + 'model = "external"\n', before, applied)).toThrow('active profile overrides')
  })

  it('preserves a newly selected profile with an unowned review/search override on restore, but not on apply', () => {
    const before = 'model = "old"\n'
    const applied = legacyCodexConfig(before)
    const current = 'profile = "work"\n' + applied + '[profiles.work]\nreview_model = "external"\nweb_search = "cached"\n'
    const restored = restoreCodexConfig(current, before, applied)
    expect(toml(restored).profiles.work).toEqual({ review_model: 'external', web_search: 'cached' })
    expect(() => planCodexConfig(current, options)).toThrow('active profile overrides')
  })

  it('restores catalog pointers from legacy snapshots exactly while keeping unrelated edits', () => {
    const before = `model_catalog_json = '/external/original-catalog.json' # original pointer\n` + source
    const applied = withLegacyCatalog(planCodexConfig(source, options).config).replace(`model_catalog_json = "${options.catalogPath}"\n`, `model_catalog_json = "${options.catalogPath}" # original pointer\n`)
    expect(restoreCodexConfig(applied, before, applied)).toBe(before)
    const current = applied.replace('command = "before"', 'command = "after"')
    const restored = restoreCodexConfig(current, before, applied)
    expect(restored).toContain("model_catalog_json = '/external/original-catalog.json' # original pointer\n")
    expect(toml(restored).mcp_servers.keep.command).toBe('after')
    expect(restoreCodexConfig(restored, before, applied)).toBe(restored)
    const changed = applied.replace(options.catalogPath, `/external/${SECRET}.json`)
    errorWithoutSecrets(() => restoreCodexConfig(changed, before, applied))
  })

  it('rebases managed-catalog migration without losing original legacy catalog backup values', () => {
    const before = "model = 'original'\nmodel_catalog_json = '/external/first-catalog.json' # original pointer\n[mcp_servers.keep]\ncommand = 'before'\n"
    const applied = withLegacyCatalog(planCodexConfig("model = 'original'\n[mcp_servers.keep]\ncommand = 'before'\n", options).config)
    const current = applied.replace("command = 'before'", "command = 'after'")
    const planned = planCodexConfig(current, { ...options, removeManagedCatalog: true }).config
    const baseline = rebaseCodexConfig(current, before, applied, planned)
    expect(toml(baseline).model_catalog_json).toBe('/external/first-catalog.json')
    expect(toml(baseline).model).toBe('original')
    expect(toml(baseline).mcp_servers.keep.command).toBe('after')
    expect(toml(planned)).not.toHaveProperty('model_catalog_json')
    expect(restoreCodexConfig(planned, baseline, planned)).toBe(baseline)
  })

  it('preserves formatting/comment-only changes rather than returning stale original text', () => {
    const before = 'model = "old" # original\n'
    const applied = planCodexConfig(before, options).config
    const current = applied.replace('# original', '# changed by user')
    const restored = restoreCodexConfig(current, before, applied)
    expect(restored).toContain('model = "old" # changed by user')
  })
})

describe('WorkBuddy config planning', () => {
  it('uses exact native model metadata, all backend models, and no invented limits', () => {
    const config = json(planWorkBuddyConfig('', models, SECRET))
    expect(config.models.map((model: any) => model.id)).toEqual(models.map(model => model.model_id))
    expect(config.models[0]).toEqual({
      id: 'gpt-fixture/coding-model', name: 'Coding Model', vendor: '流光剪辑', url: SWITCH_WORKBUDDY_URL,
      apiKey: SECRET, [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID,
      supportsToolCall: true, supportsImages: true, supportsReasoning: true,
      maxInputTokens: 180000, maxOutputTokens: 32000,
      supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'high', canDisableThinking: true
    })
    expect(config.models[1]).toEqual({
      id: 'gpt-fixture-unknown-limits', name: 'Unknown Limits', vendor: '流光剪辑', url: SWITCH_WORKBUDDY_URL,
      apiKey: SECRET, [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID,
      supportsToolCall: true, supportsImages: false, supportsReasoning: false
    })
    expect(config.models[2]).toMatchObject({ supportedEfforts: ['max'], defaultEffort: 'max', canDisableThinking: true })
    expect(config).not.toHaveProperty('availableModels')
    expect(config.models[0]).not.toHaveProperty('contextWindow')
    expect(config.models[0]).not.toHaveProperty('reasoningLevels')
  })

  it('does not derive input/output token limits from context size or invent effort levels', () => {
    const input = [{ ...models[1], context_window_tokens: 100000, thinking_levels: ['off', 'invented'], thinking_default: 'invented' }]
    const model = json(planWorkBuddyConfig('{}', input, SECRET)).models[0]
    expect(model).not.toHaveProperty('maxInputTokens')
    expect(model).not.toHaveProperty('maxOutputTokens')
    expect(model).not.toHaveProperty('supportedEfforts')
    expect(model).not.toHaveProperty('defaultEffort')
    expect(model.canDisableThinking).toBe(true)
  })

  it('preserves unrelated models/root fields and updates only owned selections', () => {
    const userModel = { id: 'personal', name: 'Personal', apiKey: 'other-fixture-key', extra: { nested: true } }
    const source = JSON.stringify({ before: { theme: 'dark' }, models: [userModel, owner('old')], availableModels: ['personal', 'old', 'personal'], after: true })
    const config = planWorkBuddyConfig(source, models, SECRET)
    expect(json(config)).toMatchObject({ before: { theme: 'dark' }, after: true })
    expect(json(config).models[0]).toEqual(userModel)
    expect(json(config).models.filter((model: any) => model[SWITCH_OWNER_FIELD] === SWITCH_PROVIDER_ID)).toHaveLength(models.length)
    expect(json(config).availableModels).toEqual(['personal', 'personal', ...models.map(model => model.model_id)])
    expect(planWorkBuddyConfig(config, models, SECRET)).toBe(config)
  })

  it.each(['{}', '{"models":null}', '{"models":[],"availableModels":[]}'])('keeps empty/missing availableModels unchanged', source => {
    const config = json(planWorkBuddyConfig(source, models, SECRET))
    if (source.includes('availableModels')) expect(config.availableModels).toEqual([])
    else expect(config).not.toHaveProperty('availableModels')
  })

  it.each(['null', '', '\uFEFF', '[]', '[{"id":"personal","name":"Keep"}]'])('accepts empty/null/legacy arrays and preserves array shape', source => {
    const config = planWorkBuddyConfig(source, models, SECRET)
    expect(config.startsWith('\uFEFF')).toBe(source.startsWith('\uFEFF'))
    expect(Array.isArray(json(config))).toBe(source.startsWith('['))
    if (source.includes('personal')) expect(json(config)[0]).toEqual({ id: 'personal', name: 'Keep' })
    expect(planWorkBuddyConfig(config, models, SECRET)).toBe(config)
  })

  it('preserves BOM and CRLF with unrelated JSON bytes intact', () => {
    const source = '\uFEFF{\r\n  "theme": {"keep" : true},\r\n  "models": [],\r\n  "other": [1,  2]\r\n}\r\n'
    const config = planWorkBuddyConfig(source, models, SECRET)
    expect(config.startsWith('\uFEFF')).toBe(true)
    expect(config).toContain('"theme": {"keep" : true}')
    expect(config).toContain('"other": [1,  2]')
    expect(config.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it.each([
    `{"models": ["${SECRET}"]}`, `{"models": {"key":"${SECRET}"}}`,
    `{"models": [{"id":"one"},{"id":"one","apiKey":"${SECRET}"}]}`,
    `{"models": [{"name":"${SECRET}"}]}`, `{"availableModels":"${SECRET}"}`,
    `{"models":[],"models":[{"id":"${SECRET}"}]}`,
    `{"models":[], // ${SECRET}\n}`, `{"models":[],"apiKey":"${SECRET}",}`, `"${SECRET}"`,
    `{"models":[{"id":"broken","apiKey":"${SECRET}`
  ])('rejects malformed/ambiguous JSON with fixed non-sensitive error', source => {
    errorWithoutSecrets(() => planWorkBuddyConfig(source, models, SECRET))
  })

  it('rejects collisions instead of overwriting unowned models', () => {
    errorWithoutSecrets(() => planWorkBuddyConfig(JSON.stringify({ models: [{ id: models[0].model_id, apiKey: SECRET }] }), models, SECRET))
    errorWithoutSecrets(() => planWorkBuddyConfig(JSON.stringify({ models: [{ id: models[0].model_id, [SWITCH_OWNER_FIELD]: 'someone_else', apiKey: SECRET }] }), models, SECRET))
    errorWithoutSecrets(() => planWorkBuddyConfig('{}', [models[0], models[0]], SECRET))
    errorWithoutSecrets(() => planWorkBuddyConfig('{}', [], SECRET))
    errorWithoutSecrets(() => planWorkBuddyConfig('{}', models, ' '))
  })
})

describe('WorkBuddy three-way restoration', () => {
  it.each(['', 'null', '[]', '\uFEFF{"models":null,"availableModels":[]}\r\n', '{"user":1}', '[{"id":"personal","name":"Personal"}]'])('restores exact original input and is idempotent', before => {
    const applied = planWorkBuddyConfig(before, models, SECRET)
    const restored = restoreWorkBuddyConfig(applied, before, applied)
    expect(restored).toBe(before)
    expect(restoreWorkBuddyConfig(restored, before, applied)).toBe(restored)
  })

  it('preserves unrelated user fields/model edits/selections and restores previous owned models', () => {
    const before = JSON.stringify({ models: [{ id: 'personal', name: 'Before' }, owner('old-owned', { apiKey: 'old-key' })], availableModels: ['personal', 'old-owned'], user: false })
    const applied = planWorkBuddyConfig(before, models, SECRET)
    const current = json(applied)
    current.user = true
    current.added = { preserved: 1 }
    current.models[0].name = 'After'
    current.models.push({ id: 'another', name: 'New personal' })
    current.availableModels.push('another')
    const restored = restoreWorkBuddyConfig(JSON.stringify(current), before, applied)
    expect(json(restored)).toEqual({
      models: [{ id: 'personal', name: 'After' }, owner('old-owned', { apiKey: 'old-key' }), { id: 'another', name: 'New personal' }],
      availableModels: ['personal', 'another', 'old-owned'], user: true, added: { preserved: 1 }
    })
    expect(restoreWorkBuddyConfig(restored, before, applied)).toBe(restored)
  })

  it('restores only changed selections while retaining unrelated availableModels edits', () => {
    const before = '{"models":[],"availableModels":["personal"]}'
    const applied = planWorkBuddyConfig(before, models, SECRET)
    const value = json(applied)
    value.availableModels = [...models.map(model => model.model_id), 'new-selection']
    const restored = json(restoreWorkBuddyConfig(JSON.stringify(value), before, applied))
    expect(restored.models).toEqual([])
    expect(restored.availableModels).toEqual(['new-selection'])
  })

  it('retains unrelated fields when restoring originally empty/null inputs', () => {
    for (const before of ['', 'null']) {
      const applied = planWorkBuddyConfig(before, models, SECRET)
      const current = json(applied)
      current.userAdded = true
      const restored = restoreWorkBuddyConfig(JSON.stringify(current), before, applied)
      expect(json(restored)).toEqual({ models: [], userAdded: true })
      expect(restoreWorkBuddyConfig(restored, before, applied)).toBe(restored)
    }
  })

  it('retains legacy root array shape through unrelated model changes', () => {
    const before = '[{"id":"personal","name":"Old"}]'
    const applied = planWorkBuddyConfig(before, models, SECRET)
    const current = json(applied)
    current[0].name = 'New'
    const restored = restoreWorkBuddyConfig(JSON.stringify(current), before, applied)
    expect(json(restored)).toEqual([{ id: 'personal', name: 'New' }])
    expect(restoreWorkBuddyConfig(restored, before, applied)).toBe(restored)
  })

  it.each([
    (current: any) => { current.models[0].apiKey = 'external' },
    (current: any) => { delete current.models[0][SWITCH_OWNER_FIELD] },
    (current: any) => { current.models.shift() },
    (current: any) => { current.models.push(owner('external-owned', { apiKey: SECRET })) },
    (current: any) => { current.availableModels.splice(1, 1) },
    (current: any) => { delete current.availableModels }
  ])('rejects managed entry/selection modifications and partial manual restores', change => {
    const before = '{"models":[],"availableModels":["personal"]}'
    const applied = planWorkBuddyConfig(before, models, SECRET)
    const current = json(applied)
    change(current)
    errorWithoutSecrets(() => restoreWorkBuddyConfig(JSON.stringify(current), before, applied))
  })
})
