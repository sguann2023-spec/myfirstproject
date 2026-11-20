import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { handle: vi.fn() }, net: {}, app: { getPath: () => '/unused', getVersion: () => '1' } }))
vi.mock('../AccountApiKeyService', () => ({ accountApiKeyService: {} }))
vi.mock('../LocalMcpAgentService', () => ({ localMcpAgentService: {} }))
import { parseOfficialModelCatalog } from '@shared/officialModelCatalog'
import { SWITCH_ERROR_MESSAGES } from '@shared/switchSettings'
import { switchCatalog, switchConfigPaths } from '../SwitchService'

const rich = (id: string) => ({ model_id: id, name: `Display ${id}` })

describe('official PC model catalog', () => {
  it('preserves canonical model IDs, all existing optional metadata and backend defaults', () => {
    const parsed = parseOfficialModelCatalog({ model_items: [{
      ...rich('gpt-fixture-new'), id: 'provider:new-model', description: ' Description ', badges: [' good ', ''],
      provider_id: ' provider ', provider_type: ' custom ', provider_name: ' Provider ', provider_model_id: ' upstream ',
      thinking_levels: [' LOW ', 'high'], thinking_default: ' HIGH ', read_image: true,
      context_window_tokens: 1050000, max_input_tokens: 1000000, max_output_tokens: 50000, compaction_trigger_tokens: 900000,
      price_text: ' Price ', price_multiplier_text: ' Multiplier ', pricing: { amount: 1 }
    }, rich('gpt-fixture-new')], default_model: 'gpt-fixture-new' })
    expect(parsed.models).toEqual(['gpt-fixture-new'])
    expect(parsed.modelItems).toHaveLength(1)
    expect(parsed.modelItems[0]).toEqual({
      model_id: 'gpt-fixture-new', name: 'Display gpt-fixture-new', id: 'provider:new-model', description: 'Description', badges: ['good'],
      provider_id: 'provider', provider_type: 'custom', provider_name: 'Provider', provider_model_id: 'upstream',
      thinking_levels: ['low', 'high'], thinking_default: 'high', read_image: true,
      context_window_tokens: 1050000, max_input_tokens: 1000000, max_output_tokens: 50000, compaction_trigger_tokens: 900000,
      price_text: 'Price', price_multiplier_text: 'Multiplier', pricing: { amount: 1 }
    })
    expect(parsed.defaultModel).toBe('gpt-fixture-new')
  })

  it.each(['gpt-6.2', 'gpt-fixture-unseen', 'gpt-fixture/pc:new'])('supports unseen live GPT-native ID %s without extra metadata', id => {
    const catalog = switchCatalog({ models: [id] })
    expect(catalog.models).toEqual([{ model_id: id, name: id, codexSupported: true, codexReason: undefined }])
  })

  it.each([
    undefined, null, 'responses', [], ['chat_completions'], ['responses'], ['responses', 1], { responses: true }
  ].map(value => [value]))('does not gate a live GPT ID on extraneous protocol claims %j', supported_protocols => {
    const catalog = switchCatalog({ models: ['gpt-fixture-new'], model_items: [{
      ...rich('gpt-fixture-new'), supported_protocols, provider_type: 'not-openai', provider_model_id: 'non-gpt-alias', name: 'Unrelated name'
    }] })
    expect(catalog.models[0].codexSupported).toBe(true)
    expect(catalog.models[0].codexReason).toBeUndefined()
  })

  it.each([
    'qwen4-max', 'claude-fixture', 'gemini-fixture', 'GPT-6.2', 'Gpt-fixture', 'gpt6.2', 'provider/gpt-fixture', 'new-gpt-fixture'
  ])('does not promote non-GPT ID %s via providers, names, aliases or malicious compatibility claims', id => {
    const catalog = switchCatalog({ models: [id], model_items: [{
      model_id: id, name: 'gpt-fixture Responses', id: 'gpt-fixture', provider_type: 'openai', provider_name: 'OpenAI',
      provider_id: 'responses', provider_model_id: 'gpt-fixture', supported_protocols: ['responses'],
      codexSupported: true, supports_responses: true, wire_api: 'responses'
    }] })
    expect(catalog.models[0]).toMatchObject({ model_id: id, codexSupported: false })
    expect(catalog.models[0].codexReason).toContain('WorkBuddy')
  })

  it('uses live model IDs/order, joins metadata only by model_id, and ignores stale rich extras', () => {
    const payload = {
      models: ['gpt-second', 'gpt-missing', 'first', 'gpt-second', 'alias-only', 'gpt-alias-only'], default_model: 'gpt-second',
      model_items: [rich('gpt-stale'), rich('first'), rich('gpt-second'),
        { model_id: 'not-listed', provider_model_id: 'alias-only', name: 'gpt-alias-only', read_image: true },
        { provider_model_id: 'gpt-alias-only', read_image: true }]
    }
    const parsed = parseOfficialModelCatalog(payload)
    expect(parsed.models).toEqual(['gpt-second', 'gpt-missing', 'first', 'alias-only', 'gpt-alias-only'])
    expect(parsed.modelItems.map(model => model.model_id)).toEqual(parsed.models)
    expect(parsed.modelItems[0].name).toBe('Display gpt-second')
    expect(parsed.modelItems[1]).toEqual({ model_id: 'gpt-missing', name: 'gpt-missing' })
    expect(parsed.modelItems[3]).toEqual({ model_id: 'alias-only', name: 'alias-only' })
    expect(parsed.modelItems[4]).toEqual({ model_id: 'gpt-alias-only', name: 'gpt-alias-only' })
    const catalog = switchCatalog(payload)
    expect(catalog.models.map(model => model.model_id)).toEqual(parsed.models)
    expect(catalog.models.map(model => model.codexSupported)).toEqual([true, true, false, false, true])
  })

  it.each([
    { models: [], model_items: [rich('gpt-stale')] },
    { data: { models: [], model_items: [rich('gpt-stale')] } },
    { models: [], data: { model_items: [rich('gpt-stale')] } },
    { models: [], data: { list: ['gpt-stale'] }, model_items: [rich('gpt-stale')] },
    { models: [], data: ['gpt-stale'], model_items: [rich('gpt-stale')] },
    { data: { models: [] }, model_items: [rich('gpt-stale')] }
  ])('honors explicitly empty lists instead of resurrecting rich-only models', payload => {
    expect(parseOfficialModelCatalog(payload)).toMatchObject({ models: [], modelItems: [] })
    expect(() => switchCatalog(payload)).toThrow(SWITCH_ERROR_MESSAGES.noModels)
  })

  it('accepts nested rich-only catalogs when no models list is present', () => {
    const catalog = switchCatalog({ data: { model_items: [rich('gpt-fixture-new'), rich('new-other')], default_model: 'gpt-fixture-new' } })
    expect(catalog.models.map(model => model.model_id)).toEqual(['gpt-fixture-new', 'new-other'])
    expect(catalog.models.map(model => model.codexSupported)).toEqual([true, false])
    expect(catalog.defaultModel).toBe('gpt-fixture-new')
  })

  it.each([
    ['plain array', [' a ', 'a', 'b']],
    ['data array', { data: ['a', 'b'] }],
    ['data models', { data: { models: ['a', 'a', 'b'] } }],
    ['data list', { data: { list: ['a', 'b'] } }],
    ['models', { models: ['a', 'b'] }],
    ['model_list', { model_list: ['a', 'b'] }],
    ['list', { list: ['a', 'b'] }]
  ])('preserves legacy %s envelopes without fabricating capabilities', (_name, payload) => {
    expect(parseOfficialModelCatalog(payload)).toMatchObject({ models: ['a', 'b'], modelItems: [{ model_id: 'a', name: 'a' }, { model_id: 'b', name: 'b' }] })
    expect(switchCatalog(payload).models.every(model => model.codexSupported === false)).toBe(true)
  })

  it('preserves legacy envelope priority and optional metadata normalization', () => {
    const parsed = parseOfficialModelCatalog({
      models: ['ignored'], defaultModel: ' top-default ',
      data: {
        models: [{ provider_model_id: 'canonical', id: 'provider:alias', display_name: ' Name ', readImage: 'yes', thinking_levels: [' OFF ', 1, 'on'], thinking_default: ' ON ', max_input_tokens: '100', max_output_tokens: 0, badges: [' good ', ''], pricing: { amount: 1 } }],
        defaultModel: 'nested-default', prices: { canonical: 2 }, black_icon: { ' canonical ': ' https://example.test/icon ', empty: '' }
      }
    })
    expect(parsed).toMatchObject({ models: ['canonical'], defaultModel: 'top-default', prices: { canonical: 2 }, blackIconMap: { canonical: 'https://example.test/icon' } })
    expect(parsed.modelItems[0]).toMatchObject({ model_id: 'canonical', id: 'provider:alias', name: 'Name', read_image: true, thinking_levels: ['off', 'on'], thinking_default: 'on', max_input_tokens: 100, badges: ['good'], pricing: { amount: 1 } })
    expect(parsed.modelItems[0].max_output_tokens).toBeUndefined()
  })

  it('rejects invalid identifiers and empty/malformed catalogs without fallback models', () => {
    for (const payload of [undefined, null, {}, { models: [] }]) expect(() => switchCatalog(payload)).toThrow(SWITCH_ERROR_MESSAGES.noModels)
    expect(() => switchCatalog({ models: ['model\nsecret'] })).toThrow(SWITCH_ERROR_MESSAGES.invalidConfig)
  })

  it('honors only absolute native config environment roots', () => {
    expect(switchConfigPaths('codex', '/users/example', {})).toEqual({ config: '/users/example/.codex/config.toml', catalog: '/users/example/.codex/vectcut-switch-model-catalog.json' })
    expect(switchConfigPaths('codex', '/users/example', { CODEX_HOME: '/custom/codex' }).config).toBe('/custom/codex/config.toml')
    expect(switchConfigPaths('workbuddy', '/users/example', { WORKBUDDY_CONFIG_DIR: '/custom/workbuddy' }).config).toBe('/custom/workbuddy/models.json')
    expect(() => switchConfigPaths('codex', '/users/example', { CODEX_HOME: '../relative' })).toThrow(SWITCH_ERROR_MESSAGES.fileAccess)
  })
})
