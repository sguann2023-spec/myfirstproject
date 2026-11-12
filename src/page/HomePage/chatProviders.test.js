import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildProvidersState, customModelToOption, toModelOption } from './chatProviders';

const custom = (overrides = {}) => ({
  id: 'custom-12345678-1234-1234-1234-123456789abc', name: 'Private model',
  protocol: 'openai', baseUrl: 'https://private.example/v1', apiKey: 'SECRET-CUSTOM-KEY',
  modelId: 'claude-private:latest', read_image: false, ...overrides,
});

describe('chat provider integration', () => {
  it('exposes only safe selection metadata, never credentials or endpoint', () => {
    const model = custom();
    const option = customModelToOption(model);
    expect(option).toEqual({ value: `${model.id}:${model.modelId}`, label: model.name, read_image: false, isCustom: true });
    expect(JSON.stringify(option)).not.toContain(model.apiKey);
    expect(JSON.stringify(option)).not.toContain(model.baseUrl);
    expect(model).not.toHaveProperty('value');
  });

  it.each(['openai', 'anthropic'])('uses explicit %s protocol, not the model name', (protocol) => {
    const model = custom({ protocol, modelId: protocol === 'openai' ? 'claude-test' : 'gpt-test' });
    const state = buildProvidersState([customModelToOption(model)], 'gateway-key', [model]);
    expect(state.llm.providers).toEqual([{
      id: model.id, name: model.name, type: protocol, enabled: true,
      apiHost: model.baseUrl, apiKey: model.apiKey,
      models: [{ id: model.modelId, name: model.name, provider: model.id, read_image: false }],
    }]);
  });

  it('isolates equal model IDs across providers and refreshes changed credentials', () => {
    const a = custom({ modelId: 'gpt-test' });
    const b = custom({ id: 'custom-87654321-1234-1234-1234-123456789abc', modelId: a.modelId, apiKey: 'second-key' });
    const options = [toModelOption(a.modelId, 'Built in'), ...[a, b].map(customModelToOption)];
    const first = buildProvidersState(options, ' gateway ', [a, b]);
    const next = buildProvidersState(options, 'gateway', [{ ...a, apiKey: 'rotated-key' }, b]);
    expect(first.llm.providers.map((p) => p.apiKey)).toEqual(['gateway', a.apiKey, b.apiKey]);
    expect(next.llm.providers[1].apiKey).toBe('rotated-key');
    expect(first.llm.providers[1].apiKey).toBe(a.apiKey);
    expect(buildProvidersState([customModelToOption(a)], 'gateway', []).llm.providers).toEqual([]);
  });

  it('preserves built-in routing, image flags, and optional token metadata', () => {
    const option = toModelOption('claude-test', 'Claude', '', true, { input: 1 }, '', '', [' fast ', ''], { max_output_tokens: 42 });
    expect(option.badges).toEqual(['fast']);
    expect(option.max_output_tokens).toBe(42);
    const state = buildProvidersState([option, 'qwen-test', 'gemini-test', 'gpt-test', '', null], ' key ');
    expect(state.llm.providers.map((p) => p.id)).toEqual(['anthropic', 'bailian', 'gemini', 'openai']);
    expect(state.llm.providers[0].models[0].read_image).toBe(true);
    expect(state.llm.providers.every((p) => p.apiKey === 'key')).toBe(true);
  });

  // Extract only the pure metadata helpers, not the HomePage component or its dependencies.
  const source = readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
  const helpers = source.slice(source.indexOf('const canonicalizeChatModelId ='), source.indexOf('const normalizeMembershipSummary ='));
  const buildMeta = new Function(`${helpers}; return buildChatMessageModelMeta;`)();
  it('matches the exact custom selection before a built-in model with the same ID', () => {
    const model = custom({ modelId: 'gpt-test' });
    const meta = buildMeta(`${model.id}:${model.modelId}`, [toModelOption('gpt-test', 'Built in'), customModelToOption(model)]);
    expect(meta).toMatchObject({ id: model.modelId, name: model.name, provider: model.id });
    expect(JSON.stringify(meta)).not.toContain(model.apiKey);
  });
  it('preserves colon-containing custom model IDs in history metadata', () => {
    const model = custom();
    expect(buildMeta(`${model.id}:${model.modelId}`, [customModelToOption(model)])).toMatchObject({ id: model.modelId, provider: model.id });
  });
});
