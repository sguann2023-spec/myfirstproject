import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from '../../../renderer/src/i18n/locales/zh-cn.json';
import SessionTokenStats, { SessionTokenStatsContent } from './SessionTokenStats';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vitest disables CSS transforms here; inspect the shipped rules rather than jsdom's default styles.
const dashboardCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'SessionTokenStats.css'), 'utf8');

const store = vi.hoisted(() => ({ state: { messages: { entities: {} }, messageBlocks: { entities: {} } }, listeners: new Set() }));
vi.mock('@renderer/store', () => ({ default: {
  getState: () => store.state,
  subscribe: (listener) => { store.listeners.add(listener); return () => store.listeners.delete(listener); },
  dispatch: () => {}
} }));
i18next.use(initReactI18next).init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN } } });
let root;
let container;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  store.state = { messages: { entities: {} }, messageBlocks: { entities: {} } };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.electronAPI;
  vi.useRealTimers();
});
const summary = { totalTokens: 1000, promptTokens: 800, completionTokens: 200, cacheReadTokens: 400, cacheWriteTokens: 100, messageCount: 1, hasReportedUsage: true, incomplete: false };
const total = () => container.querySelector('[data-testid="token-total"]')?.textContent ?? null;
const used = () => container.querySelector('[data-testid="context-used"]')?.textContent ?? null;
const context = { id: 'context', revision: 1, runtimeSessionId: 'A', modelId: 'model', providerId: 'provider', observedAt: 1000, basis: 'post-compaction', validity: 'valid', input: { categories: { system: 20, toolDefinitions: 60, user: 20 }, total: 100, status: 'estimated', method: 'char4-v1' }, contextWindowTokens: 1000 };
const stats = { segments: [{ key: 'system', value: 40, color: '#6857ff' }, { key: 'toolDefinitions', value: 60, color: '#ff9800' }], estimateTotal: 100, context, requestCount: 2, partial: false, missingHistory: false };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const request = (overrides = {}) => ({
  id: 'request-1', revision: 1, runtimeSessionId: 'A', invocationId: 'invocation-1', sequence: 1,
  modelId: 'model', providerId: 'provider', operation: 'chat', status: 'completed', startedAt: 1000, completedAt: 1100, attempts: 1,
  input: { categories: { system: 40, user: 40 }, total: 80, status: 'estimated', method: 'char4-v1' },
  output: { categories: { reply: 20 }, total: 20, status: 'estimated', method: 'char4-v1' },
  reported: { inputTokens: 80, outputTokens: 20, totalTokens: 100, cacheReadTokens: 40, cacheWriteTokens: 0, reasoningTokens: 0 },
  ...overrides
});
const snapshot = (revision = 1, overrides = {}) => ({
  sessionId: 'A', revision, contextGeneration: 1,
  tokenTelemetry: { version: 1, requests: [request()], context }, context,
  ...overrides
});
const bootstrap = (value = snapshot(), usageMessages = []) => ({ ok: true, ...value, usageMessages, historyComplete: true });
const acceptedEvent = (value = snapshot()) => ({ sessionId: value.sessionId, reason: 'token-stats', tokenStats: value });
const installRuntime = (getTokenStats = vi.fn(() => new Promise(() => {}))) => {
  let onSessionChanged;
  let onChunk;
  const unsubscribe = vi.fn();
  const subscribeRaw = vi.fn((callback) => { onChunk = callback; return () => {}; });
  window.electronAPI = {
    cherryChatStream: { getTokenStats, onChunk: subscribeRaw },
    agentSessionStream: { onSessionChanged: (callback) => { onSessionChanged = callback; return unsubscribe; } }
  };
  return { getTokenStats, subscribeRaw, unsubscribe, emit: (event) => onSessionChanged(event), raw: (event) => onChunk?.(event) };
};
const publishRedux = (entities, blocks = {}) => {
  store.state = { messages: { entities }, messageBlocks: { entities: blocks } };
  store.listeners.forEach((listener) => listener());
};

describe('session token dashboard', () => {
  it('shows loading placeholders rather than zero or empty data until the first request completes', async () => {
    const pending = deferred();
    installRuntime(vi.fn(() => pending.promise));
    await act(async () => root.render(<SessionTokenStats messages={[]} runtimeSessionId="A" />));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('.token-dashboard__loading')).toHaveLength(3);
    expect(total()).toBeNull();
    expect(container.textContent).not.toContain('暂无 token 用量');
    await act(async () => pending.resolve(bootstrap(snapshot(1, { tokenTelemetry: { version: 1, requests: [] }, context: null }))));
    expect(container.querySelectorAll('.token-dashboard__loading')).toHaveLength(0);
    expect(total()).toBe('0');
    expect(container.textContent).toContain('暂无 token 用量');
  });

  it('keeps existing charts while refreshing and clears the refresh indicator when finished', async () => {
    const pending = deferred();
    const getTokenStats = vi.fn().mockResolvedValueOnce(bootstrap()).mockReturnValueOnce(pending.promise);
    installRuntime(getTokenStats);
    await act(async () => root.render(<SessionTokenStats messages={[]} runtimeSessionId="A" />));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(total()).toBe('100');
    expect(used()).toBe('100');
    expect(container.querySelector('.token-dashboard__refreshing')).not.toBeNull();
    expect(container.querySelector('.token-dashboard__loading')).toBeNull();
    await act(async () => pending.resolve(bootstrap(snapshot(2))));
    expect(container.querySelector('.token-dashboard__refreshing')).toBeNull();
  });

  it.each([false, true])('distinguishes a failed fetch from empty data and supports retry (throws: %s)', async (throws) => {
    const getTokenStats = vi.fn();
    if (throws) getTokenStats.mockRejectedValueOnce(new Error('Network error'));
    else getTokenStats.mockResolvedValueOnce({ ok: false, error: 'Unavailable' });
    getTokenStats.mockResolvedValueOnce(bootstrap());
    installRuntime(getTokenStats);
    await act(async () => root.render(<SessionTokenStats messages={[]} runtimeSessionId="A" />));
    expect(container.querySelector('[role="alert"]').textContent).toContain('加载失败');
    expect(container.textContent).not.toContain('暂无 token 用量');
    expect(total()).toBeNull();
    await act(async () => container.querySelector('[role="alert"] button').click());
    expect(getTokenStats).toHaveBeenCalledTimes(2);
    expect(total()).toBe('100');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders consumption below tokens, cache rate and a non-duplicated input/output fallback', async () => {
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} />));
    expect(container.querySelectorAll('.token-dashboard__card')).toHaveLength(3);
    expect([...container.querySelectorAll('.token-dashboard__header h1, .token-dashboard__header h2')].map((node) => node.textContent)).toEqual(['Token 统计', '消耗统计', '当前上下文']);
    const tokenCard = container.querySelector('.token-dashboard__card');
    expect(total()).toBe('1.0k');
    expect(container.textContent).toContain('缓存命中 50.0%');
    expect([...tokenCard.querySelectorAll('.token-dashboard__legend dt')].map((node) => node.textContent)).toEqual(['输入 tokens', '输出 tokens']);
    expect([...tokenCard.querySelectorAll('.token-dashboard__legend dd > span')].map((node) => node.textContent)).toEqual(['800', '200']);
    expect(container.querySelector('.token-dashboard__reported')).toBeNull();
    expect(container.querySelector('footer, small')).toBeNull();
    expect(tokenCard.querySelector('.token-dashboard__note')).toBeNull();
    expect(container.textContent).not.toMatch(/供应商上报|历史分类未采集|分类估算合计/);
    expect(used()).toBe('—');
  });

  it('shows point totals and conversation/tool shares with keyboard-linked arcs', async () => {
    const cost = { conversationPoints: 25, toolPoints: 75, totalPoints: 100, messageCount: 1, hasKnownCost: true, incomplete: false };
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} cost={cost} />));
    const card = container.querySelector('.token-dashboard__cost');
    expect(card.querySelector('[data-testid="cost-total"]').textContent).toBe('100.00');
    expect([...card.querySelectorAll('dt')].map(node => node.textContent)).toEqual(['对话消耗', '工具消耗']);
    expect([...card.querySelectorAll('dd strong')].map(node => node.textContent)).toEqual(['25.0%', '75.0%']);
    expect([...card.querySelectorAll('dd > span')].map(node => node.textContent)).toEqual(['25.00', '75.00']);
    const legend = card.querySelector('.token-dashboard__legend [data-category="tools"]');
    await act(async () => legend.focus());
    expect(card.querySelector('circle[data-category="tools"]').getAttribute('stroke-width')).toBe('19');
    expect(card.querySelector('circle[data-category="conversation"]').getAttribute('opacity')).toBe('0.25');
  });

  it('uses distinct tool colors shared by arcs and swatches, retaining them across updates', async () => {
    const toolDetails = Array.from({ length: 14 }, (_, index) => ({ label: `tool-${index}`, value: 5 }));
    const cost = { conversationPoints: 30, toolPoints: 70, totalPoints: 100, messageCount: 1, hasKnownCost: true, toolDetails };
    const colors = () => Object.fromEntries([...container.querySelectorAll('.token-dashboard__cost circle[data-category]')]
      .map(node => [node.dataset.category, node.getAttribute('stroke')]));
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} cost={cost} />));
    const initialColors = colors();
    expect(new Set(Object.values(initialColors)).size).toBe(15);
    for (const [key, color] of Object.entries(initialColors)) {
      const swatch = container.querySelector(`.token-dashboard__cost .token-dashboard__legend [data-category="${key}"] .token-dashboard__swatch`);
      const expected = document.createElement('span');
      expected.style.background = color;
      expect(swatch.style.background).toBe(expected.style.background);
    }
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} cost={{ ...cost, toolDetails: [...toolDetails].reverse() }} />));
    expect(colors()).toEqual(initialColors);
  });

  it('distinguishes unknown billing from zero and keeps only the requested estimate note', async () => {
    const cost = { conversationPoints: 0, toolPoints: 0, totalPoints: 0, messageCount: 1, hasKnownCost: false, incomplete: true };
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} cost={cost} />));
    expect(container.querySelector('[data-testid="cost-total"]').textContent).toBe('—');
    expect(container.querySelectorAll('.token-dashboard__cost .token-dashboard__note')).toHaveLength(1);
    expect(container.querySelector('.token-dashboard__cost [role="status"]')).toBeNull();
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} cost={{ ...cost, toolPoints: 12, totalPoints: 12, hasKnownCost: true }} />));
    expect(container.querySelector('[data-testid="cost-total"]').textContent).toBe('12.00');
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} cost={{ ...cost, toolPoints: 12, totalPoints: 12, hasKnownCost: true, conversationIncomplete: true }} />));
    const conversation = container.querySelector('.token-dashboard__cost .token-dashboard__legend [data-category="conversation"]');
    expect(conversation.querySelector('dd > span').textContent).toBe('—');
    expect(conversation.querySelector('dd strong').textContent).toBe('—');
  });

  it('keeps runtime token authority while resolving live cost blocks for this session only', async () => {
    installRuntime(vi.fn().mockResolvedValue(bootstrap()));
    const message = { id: 'a', role: 'assistant', topicId: 'agent-session:A', storeAssistantMessageId: 'live-a', blocks: ['tool'],
      model: { id: 'model', pricing: { precise_uncached_input_resource_points_per_unit: 1000000 } }, usage: { prompt_tokens: 10, completion_tokens: 0 } };
    await act(async () => root.render(<SessionTokenStats messages={[message]} runtimeSessionId="A" />));
    await act(async () => publishRedux({ 'live-a': { ...message, id: 'live-a', usage: { prompt_tokens: 20, completion_tokens: 0 } },
      unrelated: { ...message, id: 'unrelated', usage: { prompt_tokens: 999, completion_tokens: 0 } } },
    { tool: { id: 'tool', type: 'tool', toolName: 'generate', metadata: { rawMcpToolResponse: { response: { billing: { total_consumed_points: 30 } } } } } }));
    expect(total()).toBe('100');
    expect(container.querySelector('[data-testid="cost-total"]').textContent).toBe('50.00');
  });

  it('keeps category estimates separate from totals and shows plain current-context values', async () => {
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} stats={stats} modelMeta={{ id: 'model', name: 'Provider · Model' }} />));
    expect(total()).toBe('1.0k');
    expect(used()).toBe('100');
    expect(container.textContent).not.toMatch(/[≥≈]|分类估算合计|供应商上报/);
    expect(container.textContent).toContain('10.0%');
    expect(container.querySelector('.token-dashboard__model').textContent).toBe('Provider · Model');
    const widths = [...container.querySelectorAll('.token-dashboard__bar > span')].map((node) => parseFloat(node.style.width));
    expect(widths).toEqual([2, 6, 2]);
  });

  it('keeps donut-center numbers and labels readable at 12px in the shipped CSS', async () => {
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} />));
    for (const tag of ['strong', 'span']) {
      const rule = dashboardCss.match(new RegExp(`\\.token-dashboard__donut-label ${tag}\\s*\\{([^}]+)\\}`));
      expect(rule, `center ${tag} CSS rule`).not.toBeNull();
      const declaration = document.createElement('div').style;
      declaration.cssText = rule[1];
      expect(declaration.fontSize).toBe('12px');
      expect(container.querySelector(`.token-dashboard__donut-label ${tag}`).textContent).not.toBe('');
      if (tag === 'strong') {
        expect(declaration.overflowWrap).toBe('anywhere');
        expect(Number(declaration.lineHeight)).toBeGreaterThanOrEqual(1.2);
      }
    }
  });

  it.each(['hover', 'focus'])('links legend %s to matching arc opacity/stroke width without affecting the context bar', async (interaction) => {
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} stats={stats} />));
    const legend = container.querySelector('.token-dashboard__legend:not(.is-context) [data-category="system"]');
    const arcs = [...container.querySelectorAll('.token-dashboard__arc')];
    const bars = [...container.querySelectorAll('.token-dashboard__bar > span')];
    const initialBars = bars.map((node) => node.getAttribute('style'));
    const expectArcs = (active) => {
      for (const arc of arcs) {
        expect(arc.getAttribute('opacity')).toBe(active && arc.dataset.category !== active ? '0.25' : '1');
        expect(arc.getAttribute('stroke-width')).toBe(arc.dataset.category === active ? '19' : '16');
      }
    };
    expect(legend.tabIndex).toBe(0);
    expectArcs(null);
    await act(async () => {
      if (interaction === 'focus') legend.focus();
      else legend.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(legend.classList.contains('is-active')).toBe(true);
    expectArcs('system');
    expect(bars.map((node) => node.getAttribute('style'))).toEqual(initialBars);
    await act(async () => {
      if (interaction === 'focus') legend.blur();
      else legend.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expectArcs(null);
    expect(legend.classList.contains('is-active')).toBe(false);
    const contextLegend = container.querySelector('.is-context [data-category="toolDefinitions"]');
    await act(async () => contextLegend.focus());
    expect(bars.map((node) => node.style.opacity)).toEqual(['0.25', '1', '0.25']);
    expectArcs(null);
    await act(async () => contextLegend.blur());
    expect(bars.map((node) => node.getAttribute('style'))).toEqual(initialBars);
  });

  it.each(['stale', 'unknown'])('never shows stale context consumption (%s)', async (validity) => {
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} stats={{ ...stats, context: { ...context, validity } }} />));
    expect(used()).toBe('—');
    expect(container.querySelectorAll('.token-dashboard__bar > span')).toHaveLength(0);
  });

  it.each([
    { id: 'other-model', providerId: 'provider' },
    { id: 'model', providerId: 'other-provider' }
  ])('invalidates context for a different model/provider: %j', async (modelMeta) => {
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} stats={stats} modelMeta={modelMeta} />));
    expect(used()).toBe('—');
    expect(container.querySelectorAll('.token-dashboard__bar > span')).toHaveLength(0);
  });

  it('does not guess missing context capacity', async () => {
    await act(async () => root.render(<SessionTokenStatsContent summary={summary} stats={{ ...stats, context: { ...context, contextWindowTokens: null } }} />));
    expect(used()).toBe('100');
    expect(container.textContent).toContain('/ — tokens');
    expect(container.querySelector('.token-dashboard__context-values').textContent).not.toContain('10.0%');
  });

  it('distinguishes unknown, known zero, and incomplete totals without numeric prefixes', async () => {
    await act(async () => root.render(<SessionTokenStatsContent summary={{ ...summary, hasReportedUsage: false, incomplete: true }} />));
    expect(total()).toBe('—');
    expect(container.textContent).toContain('尚未上报');
    await act(async () => root.render(<SessionTokenStatsContent summary={{ ...summary, incomplete: true }} />));
    expect(total()).toBe('1.0k');
    expect(container.textContent).not.toMatch(/[≥≈]/);
    await act(async () => root.render(<SessionTokenStats messages={[]} />));
    expect(total()).toBe('0');
    expect(container.textContent).toContain('暂无 token 用量');
  });

  it('still updates referenced Redux usage without a runtime and excludes unrelated conversations', async () => {
    const messages = [{ id: 'snapshot-A', role: 'assistant', storeAssistantMessageId: 'live-A', usage: { prompt_tokens: 10, completion_tokens: 5 } }];
    await act(async () => root.render(<SessionTokenStats messages={messages} />));
    expect(total()).toBe('15');
    await act(async () => publishRedux({
      'live-A': { id: 'live-A', role: 'assistant', usageSteps: [{ prompt_tokens: 20, completion_tokens: 10 }] },
      'live-B': { id: 'live-B', role: 'assistant', usage: { total_tokens: 9999 } }
    }));
    expect(total()).toBe('30');
  });

  it('with a runtime consumes accepted snapshots, not raw telemetry, message props or direct Redux advances', async () => {
    const runtime = installRuntime();
    const messages = [{ id: 'history', role: 'assistant', storeAssistantMessageId: 'live', usage: { total_tokens: 9999 }, tokenTelemetry: { version: 1, requests: [request()], context } }];
    await act(async () => root.render(<SessionTokenStats messages={messages} runtimeSessionId="A" />));
    expect(total()).toBeNull();
    expect(used()).toBeNull();
    expect(runtime.subscribeRaw).not.toHaveBeenCalled();
    await act(async () => {
      runtime.raw({ sessionId: 'A', chunk: { type: 'raw', rawValue: { type: 'token-telemetry', data: snapshot().tokenTelemetry } } });
      publishRedux({ live: { ...messages[0], id: 'live', usage: { total_tokens: 8888 } } });
    });
    expect(total()).toBeNull();
    expect(used()).toBeNull();
    await act(async () => runtime.emit(acceptedEvent()));
    expect(total()).toBe('100');
    expect(used()).toBe('100');
    await act(async () => publishRedux({ live: { ...messages[0], id: 'live', usage: { total_tokens: 7777 } } }));
    expect(total()).toBe('100');
    expect(used()).toBe('100');
  });

  it.each([
    ['another outer session', { ...acceptedEvent(), sessionId: 'B' }],
    ['another snapshot session', acceptedEvent(snapshot(10, { sessionId: 'B' }))],
    ['missing snapshot', { sessionId: 'A', reason: 'token-stats' }],
    ['non-numeric revision', acceptedEvent(snapshot('10'))],
    ['invalid telemetry', acceptedEvent(snapshot(10, { tokenTelemetry: { version: 1, requests: [{}] } }))]
  ])('ignores token-stats events with %s', async (_label, event) => {
    const runtime = installRuntime();
    await act(async () => root.render(<SessionTokenStats messages={[]} runtimeSessionId="A" />));
    await act(async () => runtime.emit(event));
    expect(total()).toBeNull();
    expect(used()).toBeNull();
    expect(runtime.getTokenStats).toHaveBeenCalledTimes(1);
  });

  it('commits a single accepted event ledger total and authoritative context in the same frame', async () => {
    const runtime = installRuntime();
    const frames = [];
    await act(async () => root.render(<React.Profiler id="stats" onRender={() => frames.push([total(), used()])}>
      <SessionTokenStats messages={[]} runtimeSessionId="A" />
    </React.Profiler>));
    frames.length = 0;
    await act(async () => runtime.emit(acceptedEvent(snapshot(2))));
    expect(frames).toEqual([['100', '100']]);
    expect(runtime.getTokenStats).toHaveBeenCalledTimes(1);
    const nextContext = { ...context, revision: 2, input: { ...context.input, total: 200, categories: { system: 200 } } };
    frames.length = 0;
    await act(async () => runtime.emit(acceptedEvent(snapshot(3, {
      context: nextContext,
      tokenTelemetry: { version: 1, requests: [request({ revision: 2, reported: { ...request().reported, totalTokens: 250 } })], context: nextContext }
    }))));
    expect(frames).toEqual([['250', '200']]);
  });

  it('bootstraps the same revision protocol and ignores equal/older accepted events', async () => {
    const runtime = installRuntime(vi.fn().mockResolvedValue(bootstrap(snapshot(5))));
    await act(async () => root.render(<SessionTokenStats messages={[]} runtimeSessionId="A" />));
    expect(runtime.getTokenStats).toHaveBeenCalledWith('A');
    expect([total(), used()]).toEqual(['100', '100']);
    const conflicting = snapshot(5, { context: { ...context, observedAt: 9000, input: { ...context.input, total: 900 } }, tokenTelemetry: { version: 1, requests: [request({ revision: 9, reported: { ...request().reported, totalTokens: 900 } })] } });
    await act(async () => runtime.emit(acceptedEvent(conflicting)));
    expect([total(), used()]).toEqual(['100', '100']);
    await act(async () => runtime.emit(acceptedEvent({ ...conflicting, revision: 4 })));
    expect([total(), used()]).toEqual(['100', '100']);
  });

  it('keeps a newer event over an older bootstrap API while filling historical usageMessages exactly once', async () => {
    const pending = deferred();
    const runtime = installRuntime(vi.fn(() => pending.promise));
    await act(async () => root.render(<SessionTokenStats messages={[]} runtimeSessionId="A" />));
    const newer = { ...context, revision: 2, observedAt: 2000, input: { ...context.input, total: 200, categories: { system: 200 } } };
    const newerRequest = request({ revision: 2, reported: { ...request().reported, totalTokens: 150 } });
    await act(async () => runtime.emit(acceptedEvent(snapshot(5, { context: newer, tokenTelemetry: { version: 1, requests: [newerRequest], context: newer } }))));
    expect([total(), used()]).toEqual(['150', '200']);
    const history = [
      { id: 'covered', role: 'assistant', runtimeSessionId: 'A', invocationId: 'invocation-1', usage: { total_tokens: 9999 }, tokenTelemetry: snapshot().tokenTelemetry },
      { id: 'legacy', role: 'assistant', runtimeSessionId: 'A', usage: { prompt_tokens: 20, completion_tokens: 5 } }
    ];
    await act(async () => pending.resolve(bootstrap(snapshot(1), history)));
    expect([total(), used()]).toEqual(['175', '200']);
    await act(async () => runtime.emit(acceptedEvent(snapshot(4))));
    expect([total(), used()]).toEqual(['175', '200']);
    await act(async () => runtime.emit(acceptedEvent(snapshot(6, { context: newer, tokenTelemetry: { version: 1, requests: [newerRequest], context: newer } }))));
    expect([total(), used()]).toEqual(['175', '200']);
  });

  it('clears context on an accepted null snapshot even when ledger/history telemetry still contains the old observation', async () => {
    const runtime = installRuntime(vi.fn().mockResolvedValue(bootstrap(snapshot(1), [
      { id: 'covered', role: 'assistant', invocationId: 'invocation-1', tokenTelemetry: snapshot().tokenTelemetry }
    ])));
    await act(async () => root.render(<SessionTokenStats messages={[]} runtimeSessionId="A" />));
    expect([total(), used()]).toEqual(['100', '100']);
    await act(async () => runtime.emit(acceptedEvent(snapshot(2, { contextGeneration: 2, context: null }))));
    expect([total(), used()]).toEqual(['100', '—']);
    expect(container.querySelectorAll('.token-dashboard__bar > span')).toHaveLength(0);
    expect(container.querySelector('.token-dashboard__legend.is-context')).toBeNull();
    await act(async () => runtime.emit(acceptedEvent(snapshot(1))));
    expect(used()).toBe('—');
  });

  it('queues a trailing metadata refresh during a pending read and discards the dirty result', async () => {
    const first = deferred();
    const second = deferred();
    const getTokenStats = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const runtime = installRuntime(getTokenStats);
    await act(async () => root.render(<SessionTokenStats messages={[]} runtimeSessionId="A" />));
    await act(async () => {
      runtime.emit({ sessionId: 'A', reason: 'metadata' });
      runtime.emit({ sessionId: 'A', reason: 'metadata' });
    });
    expect(getTokenStats).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(bootstrap(snapshot(1))));
    expect(getTokenStats).toHaveBeenCalledTimes(2);
    expect([total(), used()]).toEqual([null, null]);
    await act(async () => second.resolve(bootstrap(snapshot(2, { contextGeneration: 2, context: null }))));
    expect([total(), used()]).toEqual(['100', '—']);
    expect(getTokenStats).toHaveBeenCalledTimes(2);
  });

  it('debounces ordinary metadata invalidation without consuming an attached snapshot', async () => {
    vi.useFakeTimers();
    const getTokenStats = vi.fn().mockResolvedValue(bootstrap(snapshot(1)));
    const runtime = installRuntime(getTokenStats);
    await act(async () => root.render(<SessionTokenStats messages={[]} runtimeSessionId="A" />));
    await act(async () => runtime.emit({ ...acceptedEvent(snapshot(50, { context: null })), reason: 'metadata' }));
    expect([total(), used()]).toEqual(['100', '100']);
    await act(async () => vi.advanceTimersByTime(100));
    await act(async () => runtime.emit({ sessionId: 'A', reason: 'metadata' }));
    await act(async () => vi.advanceTimersByTime(119));
    expect(getTokenStats).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(getTokenStats).toHaveBeenCalledTimes(2);
  });

  it('loads full history and ignores old API responses/events after switching runtime sessions', async () => {
    const pendingA = deferred();
    const pendingB = deferred();
    const runtime = installRuntime(vi.fn((id) => id === 'A' ? pendingA.promise : pendingB.promise));
    await act(async () => root.render(<SessionTokenStats messages={[]} runtimeSessionId="A" />));
    await act(async () => runtime.emit(acceptedEvent()));
    expect([total(), used()]).toEqual(['100', '100']);
    await act(async () => root.render(<SessionTokenStats messages={[]} runtimeSessionId="B" />));
    expect(runtime.unsubscribe).toHaveBeenCalledTimes(1);
    await act(async () => {
      pendingA.resolve(bootstrap(snapshot(), [{ id: 'A1', role: 'assistant', usage: { total_tokens: 2000 } }]));
      runtime.emit(acceptedEvent(snapshot(99)));
    });
    expect([total(), used()]).toEqual([null, null]);
    await act(async () => pendingB.resolve(bootstrap(snapshot(1, { sessionId: 'B', context: null, tokenTelemetry: { version: 1, requests: [] } }), [
      { id: 'B1', role: 'assistant', usage: { prompt_tokens: 20, completion_tokens: 5 } }
    ])));
    expect([total(), used()]).toEqual(['25', '—']);
  });
});
