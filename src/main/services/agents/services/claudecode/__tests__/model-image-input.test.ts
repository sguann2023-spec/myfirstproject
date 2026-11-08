import { describe, expect, it, vi } from 'vitest'
import { buildProvidersState, toModelOption } from '../../../../../../page/HomePage/chatProviders'
import { modelSupportsImageInput } from '../runtime/build-invoke-context'
import type { ClaudeRuntimeEnvironment } from '../runtime/build-runtime'

vi.mock('@main/services/agents/skills/paths', () => ({ getGlobalSkillsRoot: () => '/tmp/skills' }))

const supports = (id: string, metadata?: boolean, name = id) => {
  const state = buildProvidersState([toModelOption(id, name, '', metadata)], 'key')
  return modelSupportsImageInput({ modelInfo: { modelId: id, provider: state.llm.providers[0] } } as unknown as ClaudeRuntimeEnvironment)
}

describe('backend image input metadata', () => {
  it.each([true, false, undefined])('passes gpt-6.1-sol metadata %s into runtime', flag => {
    expect(supports('gpt-6.1-sol', flag)).toBe(flag === true)
  })
  it('honors false over a recognized vision name', () => {
    expect(supports('gpt-4o', false)).toBe(false)
    expect(supports('gpt-4o')).toBe(true)
  })
  it('retains display-name fallback only when metadata is absent', () => {
    expect(supports('custom-model', undefined, 'Claude Sonnet 4 vision')).toBe(true)
    expect(supports('custom-model', false, 'Claude Sonnet 4 vision')).toBe(false)
  })
  it('supports legacy ID lists without inventing negative metadata', () => {
    const models = buildProvidersState(['gpt-4o', 'claude-sonnet-4'], ' key ').llm.providers
    expect(models.map(provider => provider.models[0].id)).toEqual(['gpt-4o', 'claude-sonnet-4'])
    expect(models[0].models[0]).not.toHaveProperty('read_image')
    expect(models[0].apiKey).toBe('key')
  })
  it('rebuilds provider metadata when model IDs do not change', () => {
    const states = [true, false, undefined].map(flag => buildProvidersState([toModelOption('gpt-6.1-sol', 'GPT', '', flag)]))
    expect(states.map(state => state.llm.providers[0].models[0].read_image)).toEqual([true, false, undefined])
  })
})
