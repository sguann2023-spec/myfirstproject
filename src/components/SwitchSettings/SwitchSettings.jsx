import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Spin } from 'antd';
import { ArrowLeftRight, RefreshCw } from 'lucide-react';
import { electronStore } from '../../shared/electronStore';
import './SwitchSettings.css';

const TOOLS = [
  { id: 'codex', name: 'Codex' },
  { id: 'workbuddy', name: 'WorkBuddy' },
];
const EMPTY_CATALOG = { models: [], defaultModel: '' };

// Never echo bridge errors: upstream failures may contain configuration credentials.
const validState = state => typeof state?.signedIn === 'boolean' && Array.isArray(state.tools);
const validCatalog = catalog => Array.isArray(catalog?.models) && typeof catalog.defaultModel === 'string';
const normalizeUserId = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const hasRefreshToken = value => typeof value === 'string' && Boolean(value.trim());
const formatContext = tokens => {
  if (!Number.isSafeInteger(tokens) || tokens <= 0) return '';
  if (tokens >= 1000000) return `${Number((tokens / 1000000).toFixed(1))}M`;
  if (tokens >= 1000) return `${Number((tokens / 1000).toFixed(1))}K`;
  return String(tokens);
};

const chooseCodexModel = (catalog, state, previous = '') => {
  const supported = catalog.models.filter(model => model.codexSupported === true);
  const configured = state.tools.find(tool => tool.id === 'codex')?.modelId;
  return [previous, configured, catalog.defaultModel, supported[0]?.model_id]
    .find(id => supported.some(model => model.model_id === id)) || '';
};

export default function SwitchSettings() {
  const [state, setState] = useState(null);
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [modelId, setModelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [stateLoading, setStateLoading] = useState(true);
  const [stateError, setStateError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [offline, setOffline] = useState(() => window.navigator.onLine === false);
  const request = useRef({ mounted: false, generation: 0, account: 0, writing: false, refreshQueued: false });
  const stateRef = useRef(null);
  const catalogRef = useRef(EMPTY_CATALOG);
  const confirmationRef = useRef(null);

  const dismissConfirmation = useCallback(() => {
    confirmationRef.current = null;
    setConfirmation(null);
  }, []);

  const refresh = useCallback(async ({ accountChanged = false } = {}) => {
    const current = request.current;
    if (!current.mounted) return;
    if (accountChanged) {
      current.account += 1;
      dismissConfirmation();
      stateRef.current = null;
      catalogRef.current = EMPTY_CATALOG;
      setState(null);
      setCatalog(EMPTY_CATALOG);
      setModelId('');
      setFeedback(null);
    }
    // Reads started before a write must not overwrite its result. Reconcile once it finishes.
    if (current.writing) {
      current.refreshQueued = true;
      return;
    }
    const generation = ++current.generation;
    const isCurrent = () => current.mounted && current.generation === generation;
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
      setStateError('switch 服务尚未就绪，请重启应用后重试。');
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
      } catch {
        if (!isCurrent()) return;
        stateRef.current = null;
        setState(null);
        setStateError('读取工具配置失败，请刷新重试。');
      } finally {
        if (isCurrent()) setStateLoading(false);
      }
    };
    // Local restoration does not wait for a slow/offline catalog. Once catalog
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
        } catch {
          if (!isCurrent()) return;
          catalogRef.current = EMPTY_CATALOG;
          setCatalog(EMPTY_CATALOG);
          setCatalogError('加载后端模型失败，请检查网络后刷新重试。');
        }
      })(),
    ]);
    if (!isCurrent()) return;
    if (catalogResolved) await readState();
    if (!isCurrent()) return;
    setModelId(previous => chooseCodexModel(catalogRef.current, stateRef.current || { tools: [] }, previous));
    if (stateRef.current?.signedIn === false && confirmationRef.current?.type === 'apply') dismissConfirmation();
    setLoading(false);
  }, [dismissConfirmation]);

  useEffect(() => {
    const current = request.current;
    current.mounted = true;
    void refresh();
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
    const onOffline = () => { setOffline(true); dismissConfirmation(); };
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
      current.generation += 1;
      current.account += 1;
      confirmationRef.current = null;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      disposers.forEach(dispose => { if (typeof dispose === 'function') dispose(); });
    };
  }, [dismissConfirmation, refresh]);

  const runAction = async action => {
    const current = request.current;
    const applying = action.type === 'apply';
    if (!current.mounted || current.writing || stateLoading || (applying && loading) || !stateRef.current) return;
    const tool = stateRef.current.tools.find(item => item.id === action.tool);
    const api = window.api?.switchSettings;
    if (!tool || (applying && (!stateRef.current.signedIn || !tool.installed || window.navigator.onLine === false))) return;
    if (applying && (catalogRef.current.models.length === 0 ||
      (tool.id === 'codex' && !catalogRef.current.models.some(model => model.model_id === action.modelId && model.codexSupported === true)))) return;
    if (!applying && !tool.enabled && !tool.hasBackup) return;
    dismissConfirmation();
    current.writing = true;
    if (loading) current.refreshQueued = true;
    setLoading(false);
    const generation = ++current.generation;
    const account = current.account;
    const isCurrent = () => current.mounted && current.generation === generation && current.account === account;
    setBusy(`${action.type}:${tool.id}`);
    setFeedback(null);
    try {
      const next = applying
        ? await api.apply(tool.id === 'codex' ? { tool: tool.id, modelId: action.modelId } : { tool: tool.id })
        : await api.disable({ tool: tool.id });
      if (!isCurrent()) return;
      if (!validState(next)) throw new Error('Invalid state');
      stateRef.current = next;
      setState(next);
      setFeedback({ type: 'success', message: applying
        ? `${tool.name || tool.id} 配置已写入，请完全退出并重启该工具后使用。`
        : `${tool.name || tool.id} 已停用并恢复原配置，请完全退出并重启该工具。` });
    } catch {
      if (isCurrent()) setFeedback({ type: 'error', message: applying
        ? '启用或更新失败，请检查网络、登录状态和配置文件权限后重试。'
        : '停用并恢复失败，请检查配置文件权限和备份状态后重试。' });
    } finally {
      current.writing = false;
      if (current.mounted) {
        setBusy('');
        // Apply fetches a fresh catalog in main, even on a removed-model failure.
        // Reconcile display/selection read-only; never retry a native write.
        if (applying) current.refreshQueued = true;
        if (current.refreshQueued) {
          current.refreshQueued = false;
          void refresh();
        }
      }
    }
  };

  const askConfirmation = (tool, type) => {
    if (stateLoading || (type === 'apply' && loading) || request.current.writing || confirmationRef.current) return;
    const next = { tool: tool.id, name: tool.name, type, modelId, account: request.current.account };
    confirmationRef.current = next;
    setConfirmation(next);
  };
  const confirmAction = () => {
    const action = confirmationRef.current;
    if (!action || action.account !== request.current.account) return;
    void runAction(action);
  };

  const restoreBusy = stateLoading || Boolean(busy) || Boolean(confirmation);
  const controlsBusy = loading || restoreBusy;
  const signedIn = state?.signedIn === true;
  const canApply = !controlsBusy && signedIn && !offline && !stateError && !catalogError && catalog.models.length > 0;
  const codexModels = catalog.models.filter(model => model.codexSupported === true);

  return (
    <div className="switch-settings" aria-busy={loading || Boolean(busy)}>
      <div className="switch-settings__header">
        <p>将当前账号的后端模型用于本机 Codex 和 WorkBuddy。</p>
        <Button className="switch-settings__refresh" icon={<RefreshCw size={14} />} aria-label="刷新 switch 状态" disabled={controlsBusy} onClick={() => { void refresh(); }}>刷新</Button>
      </div>
      <div className="switch-settings__notices" aria-live="polite">
        {loading && <div className="switch-settings__loading" role="status"><Spin size="small" /><span>正在刷新工具和模型状态…</span></div>}
        {offline && <Alert type="warning" showIcon message="当前离线，无法启用或更新；仍可停用并恢复已有配置。" />}
        {stateError && <Alert type="error" showIcon message={stateError} />}
        {!stateLoading && state?.signedIn === false && <Alert type="warning" showIcon message="请先登录账号，再启用或更新工具配置；已有配置仍可停用并恢复。" />}
        {catalogError && <Alert type="error" showIcon message={catalogError} />}
        {!loading && !catalogError && catalog.models.length === 0 && <Alert type="info" showIcon message="暂无后端模型，请稍后刷新。" />}
        {feedback && <Alert type={feedback.type} showIcon message={feedback.message} />}
      </div>
      <div className="switch-settings__cards">
        {TOOLS.map(definition => {
          const detected = state?.tools.find(tool => tool.id === definition.id);
          const tool = { ...definition, ...detected };
          const applying = busy === `apply:${tool.id}`;
          const disabling = busy === `disable:${tool.id}`;
          const status = !detected ? '状态未知' : tool.enabled ? (tool.needsUpdate ? '需要更新' : '已启用') : tool.hasBackup ? '待恢复' : '未启用';
          const applyDisabled = !canApply || !tool.installed || (tool.id === 'codex' && !modelId);
          return (
            <section key={tool.id} className="switch-settings__card" aria-labelledby={`switch-${tool.id}-heading`} data-tool={tool.id}>
              <div className="switch-settings__card-header">
                <h2 id={`switch-${tool.id}-heading`}><ArrowLeftRight size={18} aria-hidden="true" />{tool.name}</h2>
                <span className={`switch-settings__status${tool.enabled ? ' switch-settings__status--enabled' : ''}${tool.needsUpdate ? ' switch-settings__status--warning' : ''}`}>{status}</span>
              </div>
              <dl className="switch-settings__details">
                <div><dt>安装状态</dt><dd>{!detected ? '等待检测' : tool.installed ? '已安装' : '未检测到安装'}</dd></div>
                <div><dt>配置路径</dt><dd className="switch-settings__path">{tool.path || '暂不可用'}</dd></div>
                {tool.id === 'codex' && tool.enabled && tool.modelId && <div><dt>当前模型</dt><dd className="switch-settings__path">{tool.modelId}</dd></div>}
              </dl>
              {detected && !tool.installed && <p>安装 {tool.name} 后，点击刷新重新检测。</p>}
              {tool.error && <Alert type="error" showIcon message="工具配置或备份存在异常，可能被外部修改。请检查路径、文件权限和备份；恢复时不会覆盖冲突内容。" />}
              {tool.needsUpdate && <p className="switch-settings__update-note">当前账号或配置已变化。请主动更新以使用当前账号，不会自动改写工具配置。</p>}
              {tool.id === 'codex' ? (
                <div className="switch-settings__model-field">
                  <label htmlFor="switch-codex-model">默认模型</label>
                  <select id="switch-codex-model" aria-label="Codex 默认模型" value={modelId} disabled={controlsBusy || !signedIn || offline || codexModels.length === 0} onChange={event => {
                    const id = event.target.value;
                    if (catalog.models.some(model => model.model_id === id && model.codexSupported === true)) setModelId(id);
                  }}>
                    {!modelId && <option value="" disabled>暂无 Codex 可用模型</option>}
                    {codexModels.map(model => <option key={model.model_id} value={model.model_id}>{model.name || model.model_id}</option>)}
                  </select>
                  <p>仅配置 PC 列表中的 GPT 原生 Responses 模型；其他模型请在 WorkBuddy 使用。选择后点击启用或更新生效。只写默认模型，不覆盖 Codex 原生模型目录；工具内部可选模型由 Codex 自身管理。</p>
                </div>
              ) : (
                <div className="switch-settings__models">
                  <h3 id="switch-workbuddy-models">后端模型列表</h3>
                  <p>全部后端模型将同步到 WorkBuddy；请在 WorkBuddy 内部选择使用的模型，此处不设置默认模型。</p>
                  <ul className="switch-settings__model-list" aria-labelledby="switch-workbuddy-models">
                    {catalog.models.map(model => {
                      const context = formatContext(model.context_window_tokens);
                      return <li key={model.model_id}>
                        <div className="switch-settings__model-copy"><span title={model.model_id}>{model.name || model.model_id}</span>{model.description && <p>{model.description}</p>}</div>
                        <div className="switch-settings__badges">{context && <span title={`上下文窗口：${model.context_window_tokens} tokens`}>{context}</span>}{model.read_image === true && <span>视觉</span>}</div>
                      </li>;
                    })}
                  </ul>
                  {catalog.models.length === 0 && <p className="switch-settings__empty">暂无模型</p>}
                </div>
              )}
              <div className="switch-settings__actions">
                <Button disabled={applyDisabled} loading={applying} onClick={() => tool.enabled ? void runAction({ type: 'apply', tool: tool.id, modelId }) : askConfirmation(tool, 'apply')} aria-label={`${tool.enabled ? '更新' : '启用'} ${tool.name}`}>{tool.enabled ? '更新配置' : '启用'}</Button>
                <Button disabled={restoreBusy || (!tool.enabled && !tool.hasBackup) || Boolean(stateError)} loading={disabling} onClick={() => askConfirmation(tool, 'disable')} aria-label={`停用并恢复 ${tool.name}`}>停用并恢复</Button>
              </div>
            </section>
          );
        })}
      </div>
      <p className="switch-settings__security-note">退出登录不会撤销已导出到工具的 API Key，也不会自动恢复本地配置。长效密钥不会因退出登录失效，无需继续使用时，请先停用并恢复。配置变更后请完全退出并重启对应工具。</p>
      <Modal open={Boolean(confirmation)} title={confirmation?.type === 'disable' ? `停用并恢复 ${confirmation.name}？` : `启用 ${confirmation?.name || ''}？`} okText={confirmation?.type === 'disable' ? '停用并恢复' : '确认启用'} cancelText="取消" onOk={confirmAction} onCancel={dismissConfirmation} okButtonProps={{ disabled: stateLoading || (confirmation?.type === 'apply' && loading) || Boolean(busy) }} wrapClassName="switch-settings__confirm-modal" destroyOnHidden>
        {confirmation?.type === 'disable' ? (
          <div className="switch-settings__confirm-copy"><p>将恢复启用前加密备份的原配置；本次 switch 写入的配置将被移除。</p><p>此操作不会撤销已导出的 API Key。完成后请完全退出并重启 {confirmation.name}。</p></div>
        ) : (
          <div className="switch-settings__confirm-copy"><p>当前账号的 API Key 将以明文写入 {confirmation?.name} 的本地配置文件，供该工具连接后端模型。请仅在可信设备上启用。</p><p>修改前会加密备份原配置，之后可通过“停用并恢复”还原。</p><p>启用后请完全退出并重启 {confirmation?.name}。退出本应用账号不会撤销已导出的密钥。</p></div>
        )}
      </Modal>
    </div>
  );
}
