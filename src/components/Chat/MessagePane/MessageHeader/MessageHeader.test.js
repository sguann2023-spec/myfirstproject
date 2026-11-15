import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MessageHeader.js', import.meta.url), 'utf8');
const getModelMeta = new Function(`${source.slice(source.indexOf('const getModelMeta ='), source.indexOf('const MessageHeader ='))}; return getModelMeta;`)();
const official = { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro', icon: '/official.png' };
const custom = { value: 'custom-a:deepseek-v4-pro', label: 'My DeepSeek', isCustom: true };

describe('message header model identity', () => {
  it('matches custom provider identity rather than the official bare ID', () => {
    expect(getModelMeta(official.value, [official, custom], { id: official.value, provider: 'custom-a' }))
      .toEqual({ name: custom.label, icon: '' });
    expect(source).toContain('modelOptions, rawMessageModel)');
  });

  it('keeps equal model IDs from different custom providers separate', () => {
    const other = { ...custom, value: 'custom-b:deepseek-v4-pro', label: 'Other model', icon: '/custom.png' };
    expect(getModelMeta(official.value, [official, custom, other], { provider: 'custom-b' }))
      .toEqual({ name: other.label, icon: other.icon });
  });

  it('uses the exact custom option over a polluted historical display name', () => {
    expect(getModelMeta(official.value, [official, custom], { provider: 'custom-a', name: official.label }).name)
      .toBe(custom.label);
  });

  it('never borrows the official avatar or label when a custom option was removed', () => {
    expect(getModelMeta(official.value, [official], { provider: 'custom-a', name: 'Saved name' }))
      .toEqual({ name: 'Saved name', icon: '' });
    expect(getModelMeta(`custom-a:${official.value}`, [official]))
      .toEqual({ name: official.value, icon: '' });
  });

  it('preserves colons inside custom model IDs', () => {
    expect(getModelMeta('custom-a:model:latest', [official]))
      .toEqual({ name: 'model:latest', icon: '' });
    expect(getModelMeta('model:latest', [], { provider: 'custom-a' }).name).toBe('model:latest');
  });

  it('keeps the original official name and avatar', () => {
    expect(getModelMeta(official.value, [official, custom], { provider: 'openai' }))
      .toEqual({ name: official.label, icon: official.icon });
  });
});
