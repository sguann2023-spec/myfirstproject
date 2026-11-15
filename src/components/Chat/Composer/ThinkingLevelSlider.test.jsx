import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ThinkingLevelSlider from './ThinkingLevelSlider';
import { normalizeThinkingLevels, resolveThinkingLevel, thinkingSendOptions } from './thinkingLevels';
import { toModelOption } from '../../../page/HomePage/chatProviders';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); });
const option = { value: 'hovered', label: '测试模型', thinking_levels: ['off', 'low', 'high', 'max'], thinking_default: 'high' };
const render = (props) => { if (!host) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); } act(() => root.render(<ThinkingLevelSlider {...props} />)); };
afterEach(() => { host = null; root = null; });
describe('thinking intensity', () => {
  it('normalizes ordered backend levels and resolves only valid defaults/preferences', () => {
    expect(normalizeThinkingLevels([' OFF ', null, 'high', 'high'])).toEqual(['off', 'high']);
    expect(resolveThinkingLevel(option, 'low')).toBe('low');
    expect(resolveThinkingLevel(option, 'invalid')).toBe('high');
    expect(resolveThinkingLevel({ ...option, thinking_default: 'invalid' })).toBe('off');
    expect(resolveThinkingLevel({})).toBeUndefined();
  });
  it('preserves metadata through option conversion', () => {
    const result = toModelOption('id', 'name', '', true, {}, '', '', [], option);
    expect(result.thinking_levels).toEqual(option.thinking_levels);
    expect(result.thinking_default).toBe('high');
    expect(result.thinking_levels).not.toBe(option.thinking_levels);
  });
  it('snapshots raw thinking and never backfills a restored queue entry', () => {
    expect(thinkingSendOptions(option, 'low')).toEqual({ thinkingLevel: 'low' });
    expect(thinkingSendOptions(option, 'invalid')).toEqual({ thinkingLevel: 'high' });
    expect(thinkingSendOptions(option, 'max', {})).toEqual({});
    expect(thinkingSendOptions(option, 'max', { thinkingLevel: 'off' })).toEqual({});
  });
  it('renders a controlled accessible range and edits hovered model raw value', () => {
    const onChange = vi.fn();
    render({ option, value: 'low', onChange });
    let input = host.querySelector('input');
    expect(input.value).toBe('1');
    expect(input.getAttribute('aria-valuetext')).toBe('低');
    expect(input.getAttribute('aria-label')).toContain('测试模型');
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '3'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith('hovered', 'max');
    render({ option, value: 'max', onChange });
    input = host.querySelector('input');
    expect(input.value).toBe('3');
    expect(input.getAttribute('aria-valuetext')).toBe('最高');
    const outer = vi.fn(); document.body.addEventListener('keydown', outer);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(outer).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(outer).toHaveBeenCalled();
  });
  it('selects the model even when committing its existing intensity', () => {
    const onChange = vi.fn();
    render({ option, value: 'high', onChange });
    act(() => host.querySelector('input').dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith('hovered', 'high');
  });
  it('wires intensity selection to both preference and current model without closing the picker', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/Chat/Composer/Composer.js'), 'utf8');
    const handler = source.match(/onChange=\{\(modelId, level\) => \{([\s\S]*?)\}\}/)[1];
    const onModelThinkingLevelChange = vi.fn();
    const onModelChange = vi.fn();
    const apply = new Function('modelId', 'level', 'model', 'onModelThinkingLevelChange', 'onModelChange', handler);
    apply('hovered', 'low', 'current', onModelThinkingLevelChange, onModelChange);
    expect(onModelThinkingLevelChange).toHaveBeenCalledWith('hovered', 'low');
    expect(onModelChange).toHaveBeenCalledWith('hovered');
    onModelChange.mockClear();
    apply('current', 'high', 'current', onModelThinkingLevelChange, onModelChange);
    expect(onModelChange).not.toHaveBeenCalled();
  });
  it('ports the reference geometry, gradient crossfade and flowing animation CSS unchanged', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/Chat/Composer/Composer.css'), 'utf8');
    expect(css).toContain('270deg in oklch shorter hue');
    expect(css).toContain('90deg in oklab');
    expect(css).toContain('transition: opacity 200ms ease-out');
    expect(css).toContain('animation: chat-panel__thinking-bubble-flow linear infinite');
    expect(css).toContain('transform: translateX(104%)');
    expect(css).toContain('transform: translateX(-4%)');
    expect(css).toContain('scale: 1.75');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    // 气泡流是品牌装饰特效，不跟随系统 reduced-motion（Windows 关「动画效果」时也要与 Mac 一致）；
    // 较大过渡仍须在 reduce 下关闭。
    const reducedMotionBlock = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] || '';
    expect(reducedMotionBlock).toContain('transition: none');
    expect(reducedMotionBlock).not.toContain('thinking-bubble');
    expect(css).toContain('height: 24px');
    expect(css).toContain('width: 28px; height: 28px');
    expect(css).not.toContain('--thinking-progress');
  });
  it('uses the last available stop for maximum effects, not a literal max value', () => {
    render({ option: { ...option, thinking_levels: ['off', 'low', 'high'] }, value: 'high' });
    const fill = host.querySelector('.chat-panel__thinking-slider-fill');
    expect(fill.dataset.max).toBe('true');
    const expectedWidth = document.createElement('div');
    expectedWidth.style.width = 'calc(14px + (100% - 28px) * 1)';
    expect(fill.style.width).toBe(expectedWidth.style.width);
    const bubbles = host.querySelectorAll('.chat-panel__thinking-bubble');
    expect(bubbles).toHaveLength(12);
    expect(bubbles[0].style.animationDuration).toBe('2.6s');
    expect(bubbles[0].style.animationDelay).toBe('-0.4s');
    expect(host.querySelectorAll('[data-filled="true"]')).toHaveLength(3);
    render({ option, value: 'low' });
    expect(host.querySelector('.chat-panel__thinking-slider-fill').dataset.max).toBe('false');
    expect(host.querySelector('.chat-panel__thinking-bubbles')).toBeNull();
  });
  it.each(['off', 'none', 'disabled', 'false', 'no', 'nothink', 'no-think', 'no_think'])('keeps %s entirely unfilled', (off) => {
    render({ option: { ...option, thinking_levels: ['low', off] }, value: off });
    expect(host.querySelector('.chat-panel__thinking-slider-fill').style.width).toBe('0px');
    expect(host.querySelector('.chat-panel__thinking-slider-fill').dataset.max).toBe('false');
    expect(host.querySelectorAll('[data-filled="true"]')).toHaveLength(0);
    expect(host.querySelector('.chat-panel__thinking-bubbles')).toBeNull();
  });
  it('uses 32 faster bubbles only for GLM Highspeed/FlashX display names', () => {
    render({ option: { ...option, displayText: 'GLM FlashX' }, value: 'max' });
    expect(host.querySelector('.chat-panel__thinking-slider-fill').dataset.highspeed).toBe('true');
    expect(host.querySelectorAll('.chat-panel__thinking-bubble')).toHaveLength(32);
    expect(host.querySelector('.chat-panel__thinking-bubble').style.animationDuration).toBe('0.8s');
    render({ option: { ...option, value: 'glm-highspeed', displayText: 'Other model' }, value: 'max' });
    expect(host.querySelector('.chat-panel__thinking-slider-fill').dataset.highspeed).toBe('false');
    expect(host.querySelectorAll('.chat-panel__thinking-bubble')).toHaveLength(12);
  });
  it('highlights nearby stops without intercepting the input or touch gestures', () => {
    render({ option, value: 'low' });
    const input = host.querySelector('input');
    input.getBoundingClientRect = () => ({ left: 0, width: 328 });
    const move = (pointerType, clientX) => act(() => {
      const event = new Event('pointermove', { bubbles: true });
      Object.defineProperties(event, { pointerType: { value: pointerType }, clientX: { value: clientX } });
      input.dispatchEvent(event);
    });
    move('mouse', 114);
    expect(host.querySelectorAll('[data-hovered="true"]')).toHaveLength(1);
    move('mouse', 160);
    expect(host.querySelectorAll('[data-hovered="true"]')).toHaveLength(0);
    move('touch', 114);
    expect(host.querySelectorAll('[data-hovered="true"]')).toHaveLength(0);
  });
  it('resets only visual layers on model changes and retains native input focus', () => {
    render({ option, value: 'high' });
    const input = host.querySelector('input');
    const visual = host.querySelector('.chat-panel__thinking-visual');
    input.focus();
    render({ option: { ...option, value: 'another-model' }, value: 'low' });
    expect(host.querySelector('input')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('.chat-panel__thinking-visual')).not.toBe(visual);
  });
  it('hides unsupported models and shows only heading/value for single-level models', () => {
    render({ option: {} }); expect(host.querySelector('input')).toBeNull();
    render({ option: { ...option, thinking_levels: ['on'] } });
    expect(host.querySelector('input')).toBeNull();
    expect(host.textContent).toContain('开启');
  });
});
