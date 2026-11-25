import React from 'react';
import { Database, Gauge, LoaderCircle } from 'lucide-react';
import { Provider, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { getMcpToolDisplayName, parseMcpToolName } from '@renderer/pages/home/Messages/Tools/shared/mcpToolDisplay';
import appStore from '@renderer/store';
import { buildReportedTokenSummary, buildSessionCostModel, buildTokenStatsModel, mergeStatsMessages, TOKEN_CATEGORY_COLORS, TOKEN_CATEGORY_ORDER } from './tokenStatsModel';
import { isTokenTelemetry, mergeTokenTelemetry } from '@shared/tokenTelemetry';
import './SessionTokenStats.css';

const POINT2_ICON_URL = new URL('../../../../public/point2.svg', import.meta.url).href;
const TOOL_COST_COLORS = ['#00b7a5', '#ff9800', '#3383ff', '#ef3299', '#00a152', '#b743f5', '#d65c28', '#0086a8', '#b09800', '#db4263', '#526d82', '#7b9b32'];

const EMPTY_ENTITIES = {};
const EMPTY_STATS = { segments: [], estimateTotal: 0, requestCount: 0, missingHistory: false, partial: false };
const compact = (value) => {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
};
const percentage = (value, total) => {
  if (!(total > 0)) return '—';
  const percent = value / total * 100;
  return percent > 0 && percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`;
};

const TokenLoading = ({ label }) => <div className="token-dashboard__loading" role="status">
  <LoaderCircle size={22} className="token-dashboard__spinner" aria-hidden="true" />
  <span>{label}</span>
  <div className="token-dashboard__skeleton" aria-hidden="true"><i /><i /><i /></div>
</div>;

const TokenLegend = ({ segments, total, compactLayout = false, activeCategory, onActiveCategory, labelPrefix = 'previewTab.stats.categories', formatValue = compact, formatShare = percentage }) => {
  const { t } = useTranslation();
  return <dl className={`token-dashboard__legend ${compactLayout ? 'is-context' : ''}`}>
    {segments.map(({ key, value, color, label }) => <div
      className={`token-dashboard__legend-item ${activeCategory === key ? 'is-active' : ''}`.trim()}
      key={key}
      data-category={key}
      tabIndex={0}
      onMouseEnter={() => onActiveCategory(key)}
      onMouseLeave={() => onActiveCategory(null)}
      onFocus={() => onActiveCategory(key)}
      onBlur={() => onActiveCategory(null)}>
      <dt><span className="token-dashboard__swatch" style={{ background: color }} />{label || t(`${labelPrefix}.${key}`)}</dt>
      <dd><strong>{formatShare(value, total, key)}</strong><span>{formatValue(value, key)}</span></dd>
    </div>)}
  </dl>;
};

const SessionCostStats = ({ cost, loading }) => {
  const { t, i18n } = useTranslation();
  const [activeCategory, setActiveCategory] = React.useState(null);
  const toolColors = React.useRef(new Map());
  const formatPoints = (value) => new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const total = cost?.totalPoints || 0;
  const unknown = !cost || (cost.messageCount > 0 && !cost.hasKnownCost);

  const baseCost = total + (cost?.savingPoints || 0);
  const savingPercent = baseCost > total && baseCost > 0 ? Math.round(((baseCost - total) / baseCost) * 100) : 0;

  const segments = [
    { key: 'conversation', value: cost?.conversationPoints || 0, color: '#6857ff' },
    ...(cost?.toolDetails || []).map((tool) => {
      // Keep an assigned color when tools reorder or new results arrive.
      if (!toolColors.current.has(tool.label)) {
        const index = toolColors.current.size;
        toolColors.current.set(tool.label, TOOL_COST_COLORS[index] || `hsl(${(index * 137.508) % 360}, 65%, 45%)`);
      }
      return {
        key: `tool:${tool.label}`,
        label: getMcpToolDisplayName({ ...parseMcpToolName(tool.label), t }),
        value: tool.value,
        color: toolColors.current.get(tool.label)
      };
    })
  ];
  if (segments.length === 1 && (cost?.toolPoints || 0) > 0) {
    segments.push({ key: 'tools', value: cost.toolPoints, color: '#00b7a5' });
  }

  let offset = 0;
  const arcs = segments.map((segment) => {
    const size = total > 0 ? segment.value / total * 100 : 0;
    const arc = { ...segment, size, offset };
    offset += size;
    return arc;
  });
  const totalLabel = unknown ? '—' : formatPoints(total);
  const categoryIncomplete = (key) => key === 'conversation' ? cost?.conversationIncomplete : cost?.toolsIncomplete;
  return <article className="token-dashboard__card token-dashboard__cost" aria-labelledby="session-cost-title">
    <header className="token-dashboard__header">
      <h2 id="session-cost-title">
        <img src={POINT2_ICON_URL} alt="" style={{ width: 18, height: 18, display: 'inline-block', verticalAlign: 'text-bottom', marginRight: 8 }} />
        {t('previewTab.stats.costTitle')}
      </h2>
      <span>
        {savingPercent > 0 && ` ${t('previewTab.stats.costSaving', { percent: savingPercent })}`}
      </span>
    </header>
    {loading ? <TokenLoading label={t('previewTab.stats.costLoading')} /> : <>
      <div className="token-dashboard__overview">
        <div className="token-dashboard__donut" role="img" aria-label={`${t('previewTab.stats.costTotal')} ${totalLabel} ${t('previewTab.stats.points')}`}>
          <svg viewBox="0 0 160 160" aria-hidden="true">
            <circle cx="80" cy="80" r="64" fill="none" stroke="var(--token-track)" strokeWidth="16" />
            {arcs.filter((arc) => arc.size > 0).map((arc) => <circle
              key={arc.key} data-category={arc.key} className="token-dashboard__arc"
              cx="80" cy="80" r="64" fill="none" stroke={arc.color}
              strokeWidth={activeCategory === arc.key ? 19 : 16}
              opacity={activeCategory && activeCategory !== arc.key ? 0.25 : 1}
              pathLength="100" strokeDasharray={`${arc.size} ${100 - arc.size}`} strokeDashoffset={-arc.offset}
              transform="rotate(-90 80 80)"
              onMouseEnter={() => setActiveCategory(arc.key)} onMouseLeave={() => setActiveCategory(null)} />)}
          </svg>
          <div className="token-dashboard__donut-label"><strong data-testid="cost-total">{totalLabel}</strong><span>{t('previewTab.stats.costTotal')}</span></div>
        </div>
        <TokenLegend segments={segments} total={total} activeCategory={activeCategory} onActiveCategory={setActiveCategory}
          labelPrefix="previewTab.stats.costCategories"
          formatShare={(value, chartTotal, key) => unknown || (categoryIncomplete(key) && value === 0) ? '—' : percentage(value, chartTotal)}
          formatValue={(value, key) => unknown || (categoryIncomplete(key) && value === 0) ? '—' : formatPoints(value)} />
      </div>
      <p className="token-dashboard__note">{t('previewTab.stats.costNote')}</p>
    </>}
  </article>;
};

export const SessionTokenStatsContent = ({ summary, stats = EMPTY_STATS, cost = null, modelMeta = null, historyComplete = true, loading = false, refreshing = false, error = false, onRetry }) => {
  const { t, i18n } = useTranslation();
  const [activeCategory, setActiveCategory] = React.useState(null);
  const [activeContextCategory, setActiveContextCategory] = React.useState(null);
  const unknown = summary.messageCount > 0 && !summary.hasReportedUsage;
  const format = (value) => new Intl.NumberFormat(i18n.language).format(value);
  const reported = (value) => unknown ? '—' : compact(value);
  const input = Math.max(0, summary.promptTokens || 0);
  const cacheHit = summary.hasReportedUsage && input > 0 ? percentage(Math.min(input, summary.cacheReadTokens || 0), input) : '—';
  const hasBreakdown = stats.segments.length > 0 && stats.estimateTotal > 0;
  // When old history has no classification, use only provider totals as an explicitly different chart.
  const fallbackSegments = summary.hasReportedUsage ? [
    { key: 'input', value: input, color: '#ff9800' },
    { key: 'output', value: summary.completionTokens || 0, color: '#00b7a5' }
  ] : [];
  const segments = hasBreakdown ? stats.segments : fallbackSegments;
  const chartTotal = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  const arcs = segments.map((segment) => {
    const size = chartTotal > 0 ? segment.value / chartTotal * 100 : 0;
    const arc = { ...segment, size, offset };
    offset += size;
    return arc;
  });
  const context = stats.context;
  const matchesModel = !modelMeta?.id || !context?.modelId || modelMeta.id === context.modelId || modelMeta.id.endsWith(`:${context.modelId}`);
  const selectedProvider = modelMeta?.providerId || (modelMeta?.id?.startsWith('custom-') ? modelMeta.id.split(':')[0] : '');
  const matchesProvider = !selectedProvider || !context?.providerId || selectedProvider === context.providerId;
  const validContext = context?.validity === 'valid' && context.input?.status !== 'unknown' && matchesModel && matchesProvider;
  const capacity = Number(context?.contextWindowTokens || modelMeta?.contextWindowTokens) || null;
  const used = validContext ? context.input.total : null;
  const usedPercent = used !== null && capacity > 0 ? used / capacity * 100 : null;
  const contextSegments = validContext ? TOKEN_CATEGORY_ORDER.filter((key) => context.input.categories[key] !== undefined)
    .map((key) => ({ key, value: context.input.categories[key], color: TOKEN_CATEGORY_COLORS[key] })) : [];
  const contextTotal = contextSegments.reduce((sum, segment) => sum + segment.value, 0);

  return <section className="chat-token-stats token-dashboard" aria-label={t('previewTab.stats.title')} aria-busy={loading || refreshing}>
    <article className="token-dashboard__card" aria-labelledby="token-total-title">
      <header className="token-dashboard__header">
        <h1 id="token-total-title"><Database size={18} />{t('previewTab.stats.tokenTitle')}</h1>
        {!loading && <span>{t('previewTab.stats.cacheHit')} <b>{cacheHit}</b></span>}
      </header>
      {refreshing && <div className="token-dashboard__refreshing" role="status"><LoaderCircle size={12} className="token-dashboard__spinner" aria-hidden="true" />{t('previewTab.stats.refreshing')}</div>}
      {error && <div className="token-dashboard__fetch-error" role="alert">{t('previewTab.stats.loadError')}{onRetry && <button type="button" onClick={onRetry}>{t('previewTab.stats.retry')}</button>}</div>}
      {loading ? <TokenLoading label={t('previewTab.stats.loading')} /> : error && summary.messageCount === 0 && !stats.requestCount ? null : <div className="token-dashboard__overview">
        <div className="token-dashboard__donut" role="img" aria-label={`${t('previewTab.stats.total')} ${unknown ? '—' : format(summary.totalTokens)}${summary.incomplete ? ` · ${t('previewTab.stats.incomplete')}` : ''}${hasBreakdown ? ` · ${t('previewTab.stats.estimateNote')}` : ''}${!historyComplete ? ` · ${t('previewTab.stats.partialHistory')}` : ''}`}>
          <svg viewBox="0 0 160 160" aria-hidden="true">
            <circle cx="80" cy="80" r="64" fill="none" stroke="var(--token-track)" strokeWidth="16" />
            {arcs.filter((arc) => arc.size > 0).map((arc) => <circle
              key={arc.key} data-category={arc.key} className="token-dashboard__arc"
              cx="80" cy="80" r="64" fill="none" stroke={arc.color}
              strokeWidth={activeCategory === arc.key ? 19 : 16}
              opacity={activeCategory && activeCategory !== arc.key ? 0.25 : 1}
              pathLength="100" strokeDasharray={`${arc.size} ${100 - arc.size}`} strokeDashoffset={-arc.offset}
              transform="rotate(-90 80 80)"
              onMouseEnter={() => setActiveCategory(arc.key)} onMouseLeave={() => setActiveCategory(null)} />)}
          </svg>
          <div className="token-dashboard__donut-label"><strong data-testid="token-total">{reported(summary.totalTokens)}</strong><span>{t('previewTab.stats.total')}</span></div>
        </div>
        {segments.length > 0 ? <TokenLegend segments={segments} total={chartTotal} activeCategory={activeCategory} onActiveCategory={setActiveCategory} /> : <p className="token-dashboard__note">{t(summary.messageCount === 0 ? 'previewTab.stats.empty' : 'previewTab.stats.unknown')}</p>}
      </div>}
    </article>

    <SessionCostStats cost={cost} loading={loading} />

    <article className="token-dashboard__card" aria-labelledby="token-context-title">
      <header className="token-dashboard__header">
        <h2 id="token-context-title"><Gauge size={18} />{t('previewTab.stats.contextTitle')}</h2>
        <span className="token-dashboard__model" title={modelMeta?.name || context?.modelId}>{modelMeta?.name || context?.modelId || '—'}</span>
      </header>
      {loading ? <TokenLoading label={t('previewTab.stats.contextLoading')} /> : <>
      <div className="token-dashboard__context-values">
        <div><strong data-testid="context-used">{used === null ? '—' : compact(used)}</strong><span> / {capacity ? compact(capacity) : '—'} tokens</span></div>
        <div><strong>{usedPercent === null ? '—' : `${usedPercent.toFixed(1)}%`}</strong><span>{t('previewTab.stats.contextUsed')}</span></div>
      </div>
      <div className="token-dashboard__bar" role="img" aria-label={`${t('previewTab.stats.contextUsed')} · ${t(validContext ? 'previewTab.stats.contextEstimate' : 'previewTab.stats.contextUnknown')}`}>
        {validContext && contextSegments.map((segment) => <span key={segment.key} data-category={segment.key}
          onMouseEnter={() => setActiveContextCategory(segment.key)} onMouseLeave={() => setActiveContextCategory(null)}
          style={{ width: `${Math.min(100, segment.value / (capacity || Math.max(contextTotal, 1)) * 100)}%`, background: segment.color, opacity: activeContextCategory && activeContextCategory !== segment.key ? 0.25 : 1 }} />)}
      </div>
      {validContext && <TokenLegend segments={contextSegments} total={contextTotal} compactLayout activeCategory={activeContextCategory} onActiveCategory={setActiveContextCategory} />}
      </>}
    </article>
  </section>;
};

const LiveSessionTokenStats = ({ messages, runtimeSessionId = '', modelMeta }) => {
  const liveMessages = useSelector((state) => state.messages?.entities || EMPTY_ENTITIES);
  const blocks = useSelector((state) => state.messageBlocks?.entities || EMPTY_ENTITIES);
  const [remote, setRemote] = React.useState(null);
  const [fetchState, setFetchState] = React.useState(null);
  const [retrySequence, setRetrySequence] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    let queued = false;
    let dirty = false;
    let refreshRevision = 0;
    let refreshTimer;
    const api = window.electronAPI?.cherryChatStream;
    const refresh = async () => {
      if (cancelled || !runtimeSessionId) return;
      if (!api?.getTokenStats) {
        setFetchState({ owner: runtimeSessionId, pending: false, error: true });
        return;
      }
      if (queued) { dirty = true; refreshRevision++; return; }
      queued = true;
      setFetchState({ owner: runtimeSessionId, pending: true, error: false });
      const requestRevision = refreshRevision;
      try {
        const result = await api.getTokenStats(runtimeSessionId);
        if (cancelled || requestRevision !== refreshRevision) return;
        if (!result?.ok || (result.sessionId && result.sessionId !== runtimeSessionId)) throw new Error('Token statistics unavailable');
        setFetchState({ owner: runtimeSessionId, pending: false, error: false });
        if (!cancelled && requestRevision === refreshRevision && result?.ok && (!result.sessionId || result.sessionId === runtimeSessionId)) {
          const next = { ...result, owner: runtimeSessionId };
          setRemote((previous) => {
            const owned = previous?.owner === runtimeSessionId ? previous : null;
            const keepNewer = owned && Number(owned.revision) > Number(next.revision ?? -1);
            return {
              ...next,
              ...(keepNewer ? { revision: owned.revision, contextGeneration: owned.contextGeneration, authoritativeContext: owned.authoritativeContext } : { authoritativeContext: result.context || null }),
              tokenTelemetry: mergeTokenTelemetry(owned?.tokenTelemetry, next.tokenTelemetry)
            };
          });
        }
      } catch (_error) {
        if (!cancelled && requestRevision === refreshRevision) {
          setFetchState({ owner: runtimeSessionId, pending: false, error: true });
          setRemote((previous) => previous?.owner === runtimeSessionId ? { ...previous, historyComplete: false } : previous);
        }
      } finally {
        queued = false;
        if (dirty && !cancelled) { dirty = false; void refresh(); }
      }
    };
    setRemote((previous) => previous?.owner === runtimeSessionId ? previous : null);
    void refresh();
    const unsubscribe = window.electronAPI?.agentSessionStream?.onSessionChanged?.((event) => {
      if (cancelled || event?.sessionId !== runtimeSessionId) return;
      const snapshot = event.tokenStats;
      if (event.reason === 'token-stats') {
        if (!snapshot || snapshot.sessionId !== runtimeSessionId || !Number.isFinite(snapshot.revision) || !isTokenTelemetry(snapshot.tokenTelemetry)) return;
        setRemote((previous) => {
          const owned = previous?.owner === runtimeSessionId ? previous : null;
          if (owned && Number(owned.revision ?? -1) >= snapshot.revision) return previous;
          return { ...owned, ...snapshot, owner: runtimeSessionId, authoritativeContext: snapshot.context || null };
        });
        return;
      }
      if (queued) { void refresh(); return; }
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 120);
    });
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.clearTimeout(refreshTimer); unsubscribe?.(); window.removeEventListener('focus', onFocus); };
  }, [runtimeSessionId, retrySequence]);
  const activeRemote = remote?.owner === runtimeSessionId ? remote : null;
  const allMessages = React.useMemo(() => runtimeSessionId ? (activeRemote?.usageMessages || []) : mergeStatsMessages([], messages), [activeRemote, messages, runtimeSessionId]);
  const committedLiveMessages = runtimeSessionId ? EMPTY_ENTITIES : liveMessages;
  const committedBlocks = runtimeSessionId ? EMPTY_ENTITIES : blocks;
  const summary = React.useMemo(() => buildReportedTokenSummary(allMessages, committedLiveMessages, committedBlocks, runtimeSessionId, activeRemote?.tokenTelemetry), [allMessages, committedLiveMessages, committedBlocks, runtimeSessionId, activeRemote]);
  const cost = React.useMemo(() => {
    // Billing needs model prices and tool responses from the actual session, while
    // token charts retain their authoritative, content-free runtime data source.
    const result = buildSessionCostModel(messages, liveMessages, blocks, runtimeSessionId);
    return { ...result, messageCount: Math.max(result.messageCount, summary.messageCount), incomplete: result.incomplete || (Boolean(runtimeSessionId) &&
      (activeRemote?.historyComplete !== true || summary.messageCount > result.messageCount)) };
  }, [messages, liveMessages, blocks, runtimeSessionId, activeRemote, summary.messageCount]);
  const stats = React.useMemo(() => {
    const result = buildTokenStatsModel(allMessages, committedLiveMessages, runtimeSessionId, activeRemote?.tokenTelemetry);
    // Runtime contexts must pass the main-process generation/model barrier. Raw and
    // persisted message contexts are historical observations, not authority after clear.
    return runtimeSessionId ? { ...result, context: activeRemote?.authoritativeContext || undefined } : result;
  }, [allMessages, committedLiveMessages, runtimeSessionId, activeRemote]);
  const activeFetch = fetchState?.owner === runtimeSessionId ? fetchState : null;
  const hasData = Boolean(activeRemote);
  const loading = Boolean(runtimeSessionId && !hasData && (!activeFetch || activeFetch.pending));
  const refreshing = Boolean(runtimeSessionId && hasData && activeFetch?.pending);
  return <SessionTokenStatsContent summary={summary} stats={stats} cost={cost} modelMeta={modelMeta}
    historyComplete={!runtimeSessionId || activeRemote?.historyComplete === true}
    loading={loading} refreshing={refreshing} error={Boolean(runtimeSessionId && activeFetch?.error)}
    onRetry={() => setRetrySequence((value) => value + 1)} />;
};

const SessionTokenStats = ({ messages = [], runtimeSessionId = '', modelMeta = null }) => (
  <Provider store={appStore}><LiveSessionTokenStats messages={messages} runtimeSessionId={runtimeSessionId} modelMeta={modelMeta} /></Provider>
);

export default SessionTokenStats;
