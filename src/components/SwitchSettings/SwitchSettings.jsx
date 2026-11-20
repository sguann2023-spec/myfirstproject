import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, message, Popover, Switch } from 'antd';
import { CircleAlert } from 'lucide-react';
import codexExample from '../../../public/codex_switch_example.gif';
import workbuddyExample from '../../../public/workbuddy_switch_example.gif';
import { SWITCH_ERROR_MESSAGES } from '../../packages/shared/switchSettings';
import { electronStore } from '../../shared/electronStore';
import './SwitchSettings.css';

const TOOLS = [
  { id: 'codex', name: 'Codex(ChatGPT)', example: codexExample, tag: '免登录' },
  { id: 'workbuddy', name: 'WorkBuddy', example: workbuddyExample, tag: '多种模型' },
];
const EMPTY_CATALOG = { models: [], defaultModel: '' };

// Only exact controlled messages (optionally wrapped by Electron) may cross into UI.
// Never return any portion of an unknown bridge error: it may contain credentials.
const SAFE_ERRORS = new Set(Object.values(SWITCH_ERROR_MESSAGES));
const safeErrorMessage = (error, fallback) => {
  const text = typeof error === 'string' ? error : error?.message;
  if (typeof text !== 'string') return fallback;
  const candidate = text.replace(/^Error invoking remote method 'switch-settings:(?:get-state|get-catalog|apply|disable)': (?:Error: )?/, '');
  return SAFE_ERRORS.has(candidate) ? candidate : fallback;
};
const STATE_ERROR = '读取工具配置失败，请重新进入此页或切回窗口后重试。';
const CATALOG_ERROR = '加载后端模型失败，请检查网络后重新进入此页。';
const validState = state => typeof state?.signedIn === 'boolean' && Array.isArray(state.tools);
const validCatalog = catalog => Array.isArray(catalog?.models) && typeof catalog.defaultModel === 'string';
const normalizeUserId = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const hasRefreshToken = value => typeof value === 'string' && Boolean(value.trim());
const chooseCodexModel = (catalog, state, previous = '') => {
  const supported = catalog.models.filter(model => model.codexSupported === true);
  const configured = state.tools.find(tool => tool.id === 'codex')?.modelId;
  return [previous, configured, catalog.defaultModel, supported[0]?.model_id]
    .find(id => supported.some(model => model.model_id === id)) || '';
};

export default function SwitchSettings({ active = true, embedded = false } = {}) {
  const [state, setState] = useState(null);
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [modelId, setModelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [stateLoading, setStateLoading] = useState(true);
  const [stateError, setStateError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [busy, setBusy] = useState('');
  const [exampleTool, setExampleTool] = useState('');
  useEffect(() => { if (!active) setExampleTool(''); }, [active]);
  const [offline, setOffline] = useState(() => window.navigator.onLine === false);
  const request = useRef({ mounted: false, active, readGeneration: 0, generation: 0, account: 0, writing: false, refreshQueued: false });
  const stateRef = useRef(null);
  const catalogRef = useRef(EMPTY_CATALOG);
  const readErrors = useRef(new Map());
  const notifyReadError = useCallback((source, text) => {
    if (!request.current.mounted || !request.current.active || readErrors.current.get(source) === text) return;
    readErrors.current.set(source, text);
    message.error(text);
  }, []);
  const reportToolErrors = useCallback(next => {
    for (const { id } of TOOLS) {
      const error = next.tools.find(tool => tool.id === id)?.error;
      if (error) notifyReadError(`tool:${id}`, safeErrorMessage(error, SWITCH_ERROR_MESSAGES.unavailable));
      else readErrors.current.delete(`tool:${id}`);
    }
  }, [notifyReadError]);

  const refresh = useCallback(async ({ accountChanged = false } = {}) => {
    const current = request.current;
    if (!current.mounted) return;
    if (accountChanged) {
      current.account += 1;
      current.readGeneration += 1;
      stateRef.current = null;
      catalogRef.current = EMPTY_CATALOG;
      setState(null);
      setCatalog(EMPTY_CATALOG);
      setModelId('');
      setStateError('');
      setCatalogError('');
      setStateLoading(true);
      setLoading(true);
      readErrors.current.clear();
    }
    // Hidden tabs retain subscriptions and the write lock, but never start reads.
    // Reads started before a write must not overwrite its result. Reconcile once it finishes.
    if (!current.active || current.writing) {
      current.refreshQueued = true;
      return;
    }
    current.refreshQueued = false;
    const generation = ++current.readGeneration;
    const isCurrent = () => current.mounted && current.active && current.readGeneration === generation;
    setLoading(true);
    setStateLoading(true);
    setStateError('');
    setCatalogError('');
    const api = window.api?.switchSettings;
    if (typeof api?.getState !== 'function') {
      stateRef.current = null;
      catalogRef.current = EMPTY_CATALOG;
      setState(null);
      setCatalog(EMPTY_CATALOG);
      setModelId('');
      const text = 'switch 服务尚未就绪，请重启应用后重试。';
      setStateError(text);
      notifyReadError('state', text);
      setStateLoading(false);
      setLoading(false);
      return;
    }

    const readState = async () => {
      try {
        const next = await api.getState();
        if (!isCurrent()) return;
        if (!validState(next)) throw new Error('Invalid state');
        stateRef.current = next;
        setState(next);
        setStateError('');
        readErrors.current.delete('state');
        reportToolErrors(next);
      } catch (error) {
        if (!isCurrent()) return;
        stateRef.current = null;
        setState(null);
        const text = safeErrorMessage(error, STATE_ERROR);
        setStateError(text);
        notifyReadError('state', text);
      } finally {
        if (isCurrent()) setStateLoading(false);
      }
    };
    // Local cleanup does not wait for a slow/offline catalog. Once catalog
    // commit finishes, re-read needsUpdate (the first read may predate it).
    let catalogResolved = false;
    await Promise.all([
      readState(),
      (async () => {
        try {
          const next = await api.getCatalog();
          if (!isCurrent()) return;
          if (!validCatalog(next)) throw new Error('Invalid catalog');
          catalogResolved = true;
          catalogRef.current = next;
          setCatalog(next);
          readErrors.current.delete('catalog');
        } catch (error) {
          if (!isCurrent()) return;
          catalogRef.current = EMPTY_CATALOG;
          setCatalog(EMPTY_CATALOG);
          const text = safeErrorMessage(error, CATALOG_ERROR);
          setCatalogError(text);
          notifyReadError('catalog', text);
        }
      })(),
    ]);
    if (!isCurrent()) return;
    if (catalogResolved) await readState();
    if (!isCurrent()) return;
    setModelId(previous => chooseCodexModel(catalogRef.current, stateRef.current || { tools: [] }, previous));
    setLoading(false);
  }, [notifyReadError, reportToolErrors]);

  useEffect(() => {
    const current = request.current;
    current.mounted = true;
    // Profile/key cache writes and refresh-token rotations are not account changes.
    // Retain only user identity and token presence, never the token itself.
    let observedUser = normalizeUserId(electronStore?.get?.('user')?.id);
    let observedSignedIn = hasRefreshToken(electronStore?.get?.('auth.refresh_token'));
    const onAccountChange = (userId, signedIn) => {
      if (userId === observedUser && signedIn === observedSignedIn) return;
      observedUser = userId;
      observedSignedIn = signedIn;
      void refresh({ accountChanged: true });
    };
    const onFocus = () => {
      const userId = normalizeUserId(electronStore?.get?.('user')?.id);
      const signedIn = hasRefreshToken(electronStore?.get?.('auth.refresh_token'));
      if (userId !== observedUser || signedIn !== observedSignedIn) onAccountChange(userId, signedIn);
      else void refresh();
    };
    const onOnline = () => { setOffline(false); void refresh(); };
    const onOffline = () => { setOffline(true); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const disposers = [];
    if (typeof electronStore?.onDidChange === 'function') {
      disposers.push(electronStore.onDidChange('user', user => onAccountChange(normalizeUserId(user?.id), observedSignedIn)));
      disposers.push(electronStore.onDidChange('auth.refresh_token', token => onAccountChange(observedUser, hasRefreshToken(token))));
    }
    return () => {
      current.mounted = false;
      current.readGeneration += 1;
      current.generation += 1;
      current.account += 1;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      disposers.forEach(dispose => { if (typeof dispose === 'function') dispose(); });
    };
  }, [refresh]);

  useEffect(() => {
    const current = request.current;
    current.active = active;
    if (active) {
      setOffline(window.navigator.onLine === false);
      void refresh();
    }
    return () => {
      // Hide invalidates reads only: an in-flight native write must keep its validity and busy lock.
      current.active = false;
      current.readGeneration += 1;
      current.refreshQueued = true;
    };
  }, [active, refresh]);

  const runAction = async action => {
    const current = request.current;
    const applying = action.type === 'apply';
    if (!current.mounted || !current.active || current.writing || stateLoading || (applying && loading) || !stateRef.current) return;
    const tool = stateRef.current.tools.find(item => item.id === action.tool);
    const api = window.api?.switchSettings;
    if (!tool || (applying && (!stateRef.current.signedIn || !tool.installed || window.navigator.onLine === false))) return;
    if (applying && (catalogRef.current.models.length === 0 ||
      (tool.id === 'codex' && !catalogRef.current.models.some(model => model.model_id === action.modelId && model.codexSupported === true)))) return;
    if (!applying && !tool.enabled && !tool.hasManagedConfig) return;
    current.writing = true;
    current.readGeneration += 1;
    if (loading) current.refreshQueued = true;
    setLoading(false);
    const generation = ++current.generation;
    const account = current.account;
    const isCurrent = () => current.mounted && current.generation === generation && current.account === account;
    setBusy(`${action.type}:${tool.id}`);
    try {
      const next = applying
        ? await api.apply(tool.id === 'codex' ? { tool: tool.id, modelId: action.modelId } : { tool: tool.id })
        : await api.disable({ tool: tool.id });
      if (!isCurrent()) return;
      if (!validState(next)) throw new Error('Invalid state');
      stateRef.current = next;
      setState(next);
      readErrors.current.clear();
      if (current.active) {
        reportToolErrors(next);
        const toolName = TOOLS.find(definition => definition.id === tool.id).name;
        message.success(applying
          ? `${toolName} 配置已重置，请完全退出并重启该工具后使用。`
          : `${toolName} 的 VectCut 配置已移除，请完全退出并重启该工具。`);
      }
    } catch (error) {
      if (isCurrent() && current.active) message.error(safeErrorMessage(error, applying
        ? '开启失败，请检查网络、登录状态和配置文件权限后重试。'
        : '关闭并清理失败，请检查配置文件权限后重试。'));
    } finally {
      current.writing = false;
      if (current.mounted) {
        setBusy('');
        // Apply fetches a fresh catalog in main, even on a removed-model failure.
        // Reconcile display/selection read-only; never retry a native write.
        if (applying || !current.active) current.refreshQueued = true;
        if (current.active && current.refreshQueued) void refresh();
      }
    }
  };

  const cleanupBusy = !active || stateLoading || Boolean(busy);
  const controlsBusy = loading || cleanupBusy;
  const signedIn = state?.signedIn === true;
  const canApply = !controlsBusy && signedIn && !offline && !stateError && !catalogError && catalog.models.length > 0;

  return (
    <div className={`switch-settings${embedded ? ' switch-settings--embedded' : ''}`} aria-busy={loading || Boolean(busy)}>
      <div className="switch-settings__header">
        <p>开启后可以在其他Agent中使用流光剪辑的模型。<a className="switch-settings__guide" href="https://my.feishu.cn/wiki/RzxzwkyUeibzfCkot4CcpdBinng" target="_blank" rel="noreferrer">查看操作指南</a></p>
      </div>
      <div className="switch-settings__notices" aria-live="polite">
        {offline && <Alert type="warning" showIcon message="当前离线，无法开启；仍可关闭并清理已有配置。" />}
        {!stateLoading && state?.signedIn === false && <Alert type="warning" showIcon message="请先登录账号再开启；已有配置仍可关闭并清理。" />}
        {!loading && !catalogError && catalog.models.length === 0 && <Alert type="info" showIcon message="暂无后端模型，请稍后重新进入此页。" />}
      </div>
      <div className="switch-settings__list">
        {TOOLS.map(definition => {
          const detected = state?.tools.find(tool => tool.id === definition.id);
          const tool = { ...definition, ...detected };
          const applying = busy === `apply:${tool.id}`;
          const disabling = busy === `disable:${tool.id}`;
          // Keep residual configuration reachable through the switch until cleanup succeeds.
          const checked = Boolean(tool.enabled || tool.hasManagedConfig);
          const applyDisabled = !canApply || !tool.installed || (tool.id === 'codex' && !modelId);
          const cleanupDisabled = cleanupBusy || Boolean(stateError);
          const status = applying || disabling ? '' : !detected ? '状态未知' : !tool.installed ? '未检测到安装'
            : !loading && !catalogError && catalog.models.length > 0 && tool.id === 'codex' && !modelId ? '暂无可用 GPT 模型' : '';
          return (
            <section key={tool.id} className="switch-settings__row" aria-labelledby={`switch-${tool.id}-heading`} data-tool={tool.id}>
              <div className="switch-settings__row-main">
                <div className="switch-settings__name">
                  <h2 id={`switch-${tool.id}-heading`}>{tool.name}</h2>
                  <Popover
                    open={active && exampleTool === tool.id}
                    onOpenChange={open => setExampleTool(open ? tool.id : '')}
                    trigger={['hover', 'focus']}
                    placement="right"
                    autoAdjustOverflow
                    destroyOnHidden
                    overlayClassName="switch-settings__example-popover"
                    content={<img className="switch-settings__example-image" src={definition.example} alt={`${definition.name} 模型配置效果示意`} />}
                  >
                    <button type="button" className="switch-settings__example-trigger" aria-label={`查看 ${definition.name} 配置示意`}>
                      <CircleAlert size={14} aria-hidden="true" />
                    </button>
                  </Popover>
                  <span className="switch-settings__tag">{definition.tag}</span>
                  {status && <span className="switch-settings__status">{status}</span>}
                </div>
                <div className="switch-settings__controls">
                  <Switch
                    className="switch-settings__switch"
                    size={embedded ? undefined : 'small'}
                    aria-labelledby={`switch-${tool.id}-heading`}
                    aria-busy={applying || disabling}
                    checked={checked}
                    loading={applying || disabling}
                    disabled={checked ? cleanupDisabled : applyDisabled}
                    onChange={checked => { void runAction({ type: checked ? 'apply' : 'disable', tool: tool.id, modelId }); }}
                  />
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
