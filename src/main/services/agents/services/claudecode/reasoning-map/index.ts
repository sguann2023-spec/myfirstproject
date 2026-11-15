// Copyright 2026 Z.AI Co., Ltd. SPDX-License-Identifier: Apache-2.0
// Adapted from ZCode packages/model-option-map/compiler.ts and merge-patch.ts.
// Modified: reasoning-only API, bounded execution, no global caches. See ./LICENSE.
import { evaluateRestrictedCel } from './evaluator';
import { parseRestrictedCel, type RestrictedCelExpression } from './parser';
import { tokenizeRestrictedCel } from './tokenizer';
import { RestrictedCelError } from './types';
import { assertReasoningPatch, assertSafeKey, CUSTOM_REASONING_MAP_LIMITS, isPlainObject, REASONING_ROOTS } from './safety';

export { RestrictedCelError as CustomReasoningMapError } from './types';
export { CUSTOM_REASONING_MAP_LIMITS } from './safety';
export interface CustomReasoningMapProgram {
  evaluate(level: string): Record<string, unknown>;
}

/**
 * Restricted CEL: literals, reasoningLevel, containers, arithmetic/comparison,
 * boolean operators and ternaries. No calls, member/index access, or ambient names.
 * Empty/whitespace source and {} both mean a no-op patch (not built-in fallback).
 * Invalid programs throw CustomReasoningMapError; callers decide their fallback.
 */
export function compileCustomReasoningMap(source: string): CustomReasoningMapProgram {
  if (typeof source !== 'string') throw new RestrictedCelError('source must be a string', 0);
  if (Buffer.byteLength(source, 'utf8') > CUSTOM_REASONING_MAP_LIMITS.sourceBytes) {
    throw new RestrictedCelError('source exceeds 16 KiB', 0);
  }
  const tokens = tokenizeRestrictedCel(source.trim() || '{}');
  if (tokens.length - 1 > CUSTOM_REASONING_MAP_LIMITS.tokens) throw new RestrictedCelError('token limit exceeds 2048', 0);
  const expression = parseRestrictedCel(tokens, 'reasoningLevel');
  validateTree(expression);
  assertObjectResult(expression);
  return Object.freeze({
    evaluate(level: string): Record<string, unknown> {
      if (typeof level !== 'string' || Buffer.byteLength(level, 'utf8') > CUSTOM_REASONING_MAP_LIMITS.sourceBytes) {
        throw new RestrictedCelError('reasoning level must be a string of at most 16 KiB', 0);
      }
      const result = evaluateRestrictedCel(expression, level);
      assertReasoningPatch(result);
      return result;
    },
  });
}

export function evaluateCustomReasoningMap(source: string, level: string): Record<string, unknown> {
  return compileCustomReasoningMap(source).evaluate(level);
}

function validateTree(root: RestrictedCelExpression): void {
  const pending = [{ node: root, depth: 1 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > CUSTOM_REASONING_MAP_LIMITS.nodes || depth > CUSTOM_REASONING_MAP_LIMITS.depth) {
      throw new RestrictedCelError('expression node/depth limit exceeded', node.offset);
    }
    const children: RestrictedCelExpression[] = [];
    switch (node.type) {
      case 'array': children.push(...node.elements); break;
      case 'object':
        for (const entry of node.entries) { assertSafeKey(entry.key); children.push(entry.value); }
        break;
      case 'unary': children.push(node.operand); break;
      case 'binary': children.push(node.left, node.right); break;
      case 'conditional': children.push(node.condition, node.whenTrue, node.whenFalse); break;
    }
    for (const child of children) pending.push({ node: child, depth: depth + 1 });
  }
}

// Check every possible result branch at compile time, including unselected branches.
function assertObjectResult(node: RestrictedCelExpression): void {
  if (node.type === 'conditional') {
    assertObjectResult(node.whenTrue); assertObjectResult(node.whenFalse); return;
  }
  if (node.type !== 'object') throw new RestrictedCelError('reasoning map must return a JSON object', node.offset);
  for (const entry of node.entries) {
    if (!REASONING_ROOTS.has(entry.key)) throw new RestrictedCelError(`unsupported reasoning root ${JSON.stringify(entry.key)}`, entry.offset);
  }
}

/**
 * Immutable recursive JSON merge patch: object members merge, arrays/scalars
 * replace, null deletes. Only reasoning roots may be changed. An empty patch
 * returns a shallow payload copy and preserves all existing payload values.
 * Untouched payload subtrees retain identity; neither payload nor patch is mutated.
 */
export function applyCustomReasoningPatch(
  payload: Record<string, unknown>, patch: Record<string, unknown>,
): Record<string, unknown> {
  if (!isPlainObject(payload)) throw new RestrictedCelError('payload must be a plain object', 0);
  assertReasoningPatch(patch);
  function merge(target: unknown, update: unknown): unknown {
    if (!isPlainObject(update)) return Array.isArray(update) ? update.map(clone) : update;
    const result: Record<string, unknown> = {};
    if (isPlainObject(target)) {
      for (const key of Object.keys(target)) {
        assertSafeKey(key);
        const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
        if (!('value' in descriptor)) throw new RestrictedCelError('payload accessors are not allowed', 0);
        Object.defineProperty(result, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
      }
    }
    for (const [key, value] of Object.entries(update)) {
      if (value === null) delete result[key];
      else result[key] = merge(Object.hasOwn(result, key) ? result[key] : undefined, value);
    }
    return result;
  }
  // Arrays replace verbatim (null inside arrays is not a deletion).
  function clone(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(clone);
    if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
    return value;
  }
  return merge(payload, patch) as Record<string, unknown>;
}
