// Run: pnpm exec vitest run src/components/ModelSettings/modelCatalog.test.js
import { describe, expect, it } from 'vitest';
import { resolveModelConfig, resolveCustomReasoningMap, MODEL_CONFIG_RULES } from './modelCatalog.js';
import { compileCustomReasoningMap } from '../../main/services/agents/services/claudecode/reasoning-map';

const legacyMap = resolveModelConfig('unknown-model', 'openai-chat-completions').reasoning_level_map;

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
  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-5', 'gpt-10', 'o1', 'o3-mini', 'o4-mini', 'openai/gpt-6-astra', 'OPENAI/GPT-5.6-SOL'])(
    'uses only reasoning_effort for %s chat completions, including disabled reasoning', (modelId) => {
      const source = resolveModelConfig(modelId, 'openai-chat-completions').reasoning_level_map;
      const compiled = compileCustomReasoningMap(source);
      for (const [level, effort] of [['disabled', 'none'], ['enabled', 'high'], ['none', 'none'], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh']]) {
        expect(compiled.evaluate(level)).toEqual({ reasoning_effort: effort });
      }
      expect(resolveCustomReasoningMap(modelId, 'openai', legacyMap)).toBe(source);
    },
  );
  it('only replaces the exact old default for the intended models and protocol', () => {
    expect(compileCustomReasoningMap(legacyMap).evaluate('none')).toHaveProperty('thinking');
    for (const modelId of ['deepseek-chat', 'glm-5', 'kimi-k2.5', 'gpt-4o', 'gpt-50custom', 'other-gpt-6-astra', 'o3custom']) {
      expect(resolveCustomReasoningMap(modelId, 'openai', legacyMap)).toBe(legacyMap);
    }
    for (const protocol of ['anthropic', 'openai-responses']) {
      expect(resolveCustomReasoningMap('gpt-6-astra', protocol, legacyMap)).toBe(legacyMap);
    }
    for (const source of [undefined, '', '  ', '{}', '{"thinking":{"type":"enabled"}}', `${legacyMap} `]) {
      expect(resolveCustomReasoningMap('gpt-6-astra', 'openai', source)).toBe(source);
    }
    const responses = resolveModelConfig('gpt-6-astra', 'openai-responses').reasoning_level_map;
    expect(compileCustomReasoningMap(responses).evaluate('high')).toEqual({ reasoning: { effort: 'high' } });
    const anthropic = resolveModelConfig('claude-sonnet-5', 'anthropic-messages').reasoning_level_map;
    expect(compileCustomReasoningMap(anthropic).evaluate('high')).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });
    expect(resolveCustomReasoningMap('gpt-5.4', 'openai', legacyMap)).toBe('{"reasoning_effort": reasoningLevel}');
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