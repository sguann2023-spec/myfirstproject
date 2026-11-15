// Run: pnpm exec vitest run src/components/ModelSettings/modelCatalog.test.js
import { describe, expect, it } from 'vitest';
import { resolveModelConfig, MODEL_CONFIG_RULES } from './modelCatalog.js';

describe('modelCatalog resolveModelConfig (ZCode rule semantics)', () => {
  it('ships the full ZCode rule catalog with a .* fallback first', () => {
    expect(MODEL_CONFIG_RULES.length).toBeGreaterThanOrEqual(80);
    expect(MODEL_CONFIG_RULES[0].modelMatch).toBe('.*');
  });
  it('always resolves a non-empty ID via the fallback default', () => {
    const r = resolveModelConfig('totally-unknown-model');
    expect(r).not.toBeNull();
    expect(r.matchedSpecific).toBe(false);
    expect(r.context_window_tokens).toBe(1000000);
    expect(r.max_output_tokens).toBe(128000);
    expect(r.reasoning_levels).toEqual(['disabled', 'enabled']);
    expect(resolveModelConfig('')).toBeNull();
    expect(resolveModelConfig('   ')).toBeNull();
  });
  it('overlays specific rules over the default and reports a specific match', () => {
    const r = resolveModelConfig('gpt-5.4');
    expect(r.matchedSpecific).toBe(true);
    expect(r.context_window_tokens).toBe(1050000);
    expect(r.supports_json_schema).toBe(true);
    expect(r.read_image).toBe(true);
    expect(r.reasoning_levels).toEqual(['none', 'low', 'medium', 'high', 'xhigh']);
  });
  it('matches case-insensitively', () => {
    expect(resolveModelConfig('GPT-5.4').context_window_tokens).toBe(1050000);
    expect(resolveModelConfig('CLAUDE-SONNET-5').context_window_tokens).toBe(1000000);
    expect(resolveModelConfig('claude-sonnet-5').supports_json_schema).toBe(true);
  });
  it('later rules override earlier ones for the same field', () => {
    // GLM-5.2 专用规则把上下文从 glm-5 的 200000 提升到 1000000。
    expect(resolveModelConfig('GLM-5.2').context_window_tokens).toBe(1000000);
    expect(resolveModelConfig('GLM-5-Turbo').context_window_tokens).toBe(200000);
  });
  it('derives the reasoning parameter map from modelApiRules by API type', () => {
    // 推理参数映射（CEL）来自 modelApiRules，按供应商 API 格式命中。
    const openai = resolveModelConfig('gpt-5.4', 'openai-chat-completions');
    expect(openai.reasoning_level_map).toBe('{"reasoning_effort": reasoningLevel}');
    const anthropic = resolveModelConfig('claude-sonnet-5', 'anthropic-messages');
    expect(anthropic.reasoning_level_map).toContain('thinking');
    // 不传 API 格式时不应用 modelApiRules，仅 modelRules 兜底 map。
    expect(resolveModelConfig('gpt-5.4').reasoning_level_map).toBe('{}');
  });
});