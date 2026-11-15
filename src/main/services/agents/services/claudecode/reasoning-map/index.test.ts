import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCustomReasoningPatch, compileCustomReasoningMap, CustomReasoningMapError, evaluateCustomReasoningMap } from './index';

const levels = ['disabled', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'enabled'];
function catalogMaps(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const object = value as Record<string, any>;
  const own = typeof object.reasoningLevel?.map === 'string' ? [object.reasoningLevel.map] : [];
  return own.concat(Object.values(object).flatMap(catalogMaps));
}
const maps = catalogMaps(JSON.parse(readFileSync(new URL('../../../../../../components/ModelSettings/modelCatalog.json', import.meta.url), 'utf8')));

describe('catalog restricted reasoning maps', () => {
  it('covers all catalog expressions across every reasoning level', () => {
    expect(maps.length).toBeGreaterThan(50);
    for (const source of maps) {
      const program = compileCustomReasoningMap(source);
      for (const level of levels) {
        const patch = program.evaluate(level);
        expect(JSON.parse(JSON.stringify(patch))).toEqual(patch);
        expect(applyCustomReasoningPatch({ model: 'test' }, patch).model).toBe('test');
      }
    }
  });
  it('maps representative provider values exactly', () => {
    expect(evaluateCustomReasoningMap('{"thinking":{"type":reasoningLevel == "disabled" ? "disabled":"adaptive"},"output_config":{"effort":reasoningLevel}}', 'high'))
      .toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });
    expect(evaluateCustomReasoningMap('{"enable_thinking": reasoningLevel != "disabled" && reasoningLevel != "none"}', 'none'))
      .toEqual({ enable_thinking: false });
  });
  it.each(['', '  \n ', '{}'])('treats %j as a no-op', source => {
    expect(evaluateCustomReasoningMap(source, 'high')).toEqual({});
  });
});

describe('syntax and safety', () => {
  it.each([
    'process.exit()', 'globalThis', 'reasoningLevel.constructor', 'reasoningLevel[0]',
    '(()=>{})()', 'new Function("return 1")', 'eval("1")', '{"model":"bad"}',
    '{"messages":[]}', '{"tools":[]}', '{"thinking":{"__proto__":{}}}',
    '{"thinking":{"constructor":1}}', '{"thinking":{"prototype":1}}',
    '{"thinking":{"\\u005f_proto__":1}}', 'true ? {} : {"model":"bad"}',
    'true ? {} : {"thinking":{"constructor":1}}', '{};{}', '{"thinking":1,"thinking":2}',
    '[]', 'null', 'reasoningLevel', '{thinking: true}', '{"thinking": maxOutputTokens}',
  ])('rejects malicious/unsupported source %s', source => {
    expect(() => evaluateCustomReasoningMap(source, 'high')).toThrow(CustomReasoningMapError);
  });
  it('supports typed arithmetic, equality, strings, containers and short circuit', () => {
    expect(evaluateCustomReasoningMap('{"thinking":{"budget":(2 + 3) * 4,"enabled":!false,"values":[null,-2,+3],"same":[1] == [1],"safe":false && (1/0 > 0)},"reasoning_effort":reasoningLevel + "!"}', 'low'))
      .toEqual({ thinking: { budget: 20, enabled: true, values: [null, -2, 3], same: true, safe: false }, reasoning_effort: 'low!' });
  });
  it.each(['{"thinking":1/0}', '{"thinking":9007199254740992}', '{"thinking":1 + true}', '{"thinking":1 && true}', '{"thinking":1e999}'])('rejects invalid evaluated values %s', source => {
    expect(() => evaluateCustomReasoningMap(source, 'high')).toThrow(CustomReasoningMapError);
  });
  it('bounds UTF-8 source, tokens, syntax depth, unary depth and binary tree depth', () => {
    for (const source of [' '.repeat(16385), '界'.repeat(6000), '{"thinking":[' + '0,'.repeat(1100) + '0]}', '('.repeat(1000) + '{}' + ')'.repeat(1000), '{"thinking":' + '!'.repeat(1000) + 'true}', '{"thinking":' + '1+'.repeat(100) + '1}']) {
      expect(() => compileCustomReasoningMap(source)).toThrow(CustomReasoningMapError);
    }
  });
  it('bounds direct patch node counts and depth', () => {
    expect(() => applyCustomReasoningPatch({}, { thinking: Array(2048).fill(0) })).toThrow(CustomReasoningMapError);
    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 65; index++) nested = { nested };
    expect(() => applyCustomReasoningPatch({}, { thinking: nested })).toThrow(CustomReasoningMapError);
  });
  it('accepts source at the byte boundary and rejects one extra byte before trimming', () => {
    expect(evaluateCustomReasoningMap('{}' + ' '.repeat(16382), 'high')).toEqual({});
    expect(() => compileCustomReasoningMap('{}' + ' '.repeat(16383))).toThrow(CustomReasoningMapError);
  });
  it('bounds evaluated strings and aggregate result bytes', () => {
    expect(() => evaluateCustomReasoningMap('{"reasoning_effort":' + Array(8).fill('reasoningLevel').join('+') + '}', 'x'.repeat(16000))).toThrow(CustomReasoningMapError);
    expect(() => evaluateCustomReasoningMap('{"thinking":[' + Array(10).fill('reasoningLevel').join(',') + ']}', 'x'.repeat(16000))).toThrow(CustomReasoningMapError);
  });
});

describe('recursive immutable merge patch', () => {
  it('preserves unrelated payload and nested provider fields; replaces arrays and deletes nulls', () => {
    const payload = { model: 'm', messages: [{ role: 'user' }], thinking: { type: 'enabled', budget_tokens: 1000, old: true }, output_config: { format: 'json', effort: 'low' } };
    const before = JSON.stringify(payload);
    const patch = { thinking: { type: 'adaptive', old: null, values: [null, { x: null }] }, output_config: { effort: 'high' } };
    const result = applyCustomReasoningPatch(payload, patch);
    expect(result).toEqual({ model: 'm', messages: payload.messages, thinking: { type: 'adaptive', budget_tokens: 1000, values: [null, { x: null }] }, output_config: { format: 'json', effort: 'high' } });
    expect(JSON.stringify(payload)).toBe(before);
    expect(result.messages).toBe(payload.messages);
    expect(result.thinking).not.toBe(patch.thinking);
    expect(applyCustomReasoningPatch(result, { thinking: null })).not.toHaveProperty('thinking');
    expect(applyCustomReasoningPatch(payload, {})).toEqual(payload);
    expect(applyCustomReasoningPatch(payload, {})).not.toBe(payload);
  });
  it('merges object patch over scalar/array; replaces scalar/array patch', () => {
    expect(applyCustomReasoningPatch({ thinking: false }, { thinking: { type: 'enabled' } })).toEqual({ thinking: { type: 'enabled' } });
    expect(applyCustomReasoningPatch({ thinking: { type: 'enabled' } }, { thinking: false })).toEqual({ thinking: false });
    expect(applyCustomReasoningPatch({ thinking: [1] }, { thinking: [2] })).toEqual({ thinking: [2] });
  });
  it('validates direct patches, rejecting pollution, accessors, cycles, oversized and non-JSON values', () => {
    const cyclic: any = {}; cyclic.thinking = cyclic;
    const getter = Object.defineProperty({}, 'thinking', { enumerable: true, get() { throw new Error('getter ran'); } });
    for (const patch of [JSON.parse('{"thinking":{"__proto__":{"polluted":true}}}'), { model: 'bad' }, { thinking: undefined }, { thinking: NaN }, { thinking: new Date() }, cyclic, getter, { thinking: 'x'.repeat(65536) }]) {
      expect(() => applyCustomReasoningPatch({}, patch)).toThrow(CustomReasoningMapError);
    }
    expect(({} as any).polluted).toBeUndefined();
  });
});
