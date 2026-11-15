import { RestrictedCelError } from './types';

/** Limits apply independently to source, syntax tree and each evaluated patch. */
export const CUSTOM_REASONING_MAP_LIMITS = Object.freeze({
  sourceBytes: 16 * 1024, tokens: 2048, nodes: 2048, depth: 64, resultBytes: 64 * 1024,
});
export const REASONING_ROOTS = new Set([
  'thinking', 'enable_thinking', 'reasoning', 'reasoning_effort', 'output_config', 'chat_template_kwargs',
]);
export function assertSafeKey(key: string): void {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw new RestrictedCelError(`dangerous property ${JSON.stringify(key)}`, 0);
  }
}
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/** Validates without invoking getters or toJSON; also rejects cycles and non-JSON values. */
export function assertReasoningPatch(value: unknown): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new RestrictedCelError('reasoning map must return a JSON object', 0);
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  function visit(entry: unknown, depth: number): void {
    if (++nodes > CUSTOM_REASONING_MAP_LIMITS.nodes || depth > CUSTOM_REASONING_MAP_LIMITS.depth) {
      throw new RestrictedCelError('result node/depth limit exceeded', 0);
    }
    if (entry === null || typeof entry === 'boolean') bytes += 5;
    else if (typeof entry === 'string') bytes += Buffer.byteLength(JSON.stringify(entry), 'utf8');
    else if (typeof entry === 'number' && Number.isFinite(entry) && (!Number.isInteger(entry) || Number.isSafeInteger(entry))) bytes += 24;
    else if (Array.isArray(entry) || isPlainObject(entry)) {
      if (ancestors.has(entry)) throw new RestrictedCelError('cyclic patch', 0);
      ancestors.add(entry);
      bytes += 2;
      for (const key of Reflect.ownKeys(entry)) {
        if (Array.isArray(entry) && key === 'length') continue;
        if (typeof key !== 'string') throw new RestrictedCelError('symbol properties are not JSON-safe', 0);
        assertSafeKey(key);
        const descriptor = Object.getOwnPropertyDescriptor(entry, key)!;
        if (!('value' in descriptor) || !descriptor.enumerable) throw new RestrictedCelError('accessors/non-enumerable properties are not allowed', 0);
        if (depth === 1 && !REASONING_ROOTS.has(key)) throw new RestrictedCelError(`unsupported reasoning root ${JSON.stringify(key)}`, 0);
        bytes += Buffer.byteLength(JSON.stringify(key), 'utf8') + 2;
        if (bytes > CUSTOM_REASONING_MAP_LIMITS.resultBytes) throw new RestrictedCelError('result size limit exceeded', 0);
        visit(descriptor.value, depth + 1);
      }
      ancestors.delete(entry);
    } else throw new RestrictedCelError('result must contain only JSON values', 0);
    if (bytes > CUSTOM_REASONING_MAP_LIMITS.resultBytes) throw new RestrictedCelError('result size limit exceeded', 0);
  }
  visit(value, 1);
}
