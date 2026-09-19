import React from 'react';
import { Modal } from 'antd';
import { Check, CircleAlert, LoaderCircle, Minus, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tokenStore } from '../../../auth/tokenStore';
import './NetworkCheck.css';

const CHECK_IDS = ['proxy', 'dns', 'tcp', 'tls', 'http'];
const ICONS = { pass: Check, warning: CircleAlert, fail: X, skipped: Minus, checking: LoaderCircle };

export default function NetworkCheck({ onClose, modelId }) {
  const { t, i18n } = useTranslation();
  const [report, setReport] = React.useState(null);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState('');
  const generation = React.useRef(0);
  const busy = React.useRef(false);
  const timeout = React.useRef(null);

  const run = React.useCallback(async () => {
    if (busy.current) return;
    const id = ++generation.current;
    busy.current = true;
    setRunning(true);
    setReport(null);
    setError('');
    let timer;
    try {
      if (!window.electronAPI?.networkCheck) {
        setError('unavailable');
        return;
      }
      const result = await Promise.race([
        (async () => {
          const accessToken = await tokenStore.ensureValidAccessToken();
          if (id !== generation.current) return null;
          return window.electronAPI.networkCheck({ modelId, accessToken: accessToken || undefined });
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 15000);
          timeout.current = timer;
        })
      ]);
      if (id !== generation.current) return;
      if (!result || !Array.isArray(result.checks) || !['pass', 'warning', 'fail'].includes(result.status)) {
        throw new Error('Invalid report');
      }
      setReport(result);
    } catch {
      if (id === generation.current) {
        generation.current += 1;
        busy.current = false;
        setRunning(false);
        setError('failed');
      }
    } finally {
      clearTimeout(timer);
      if (id === generation.current) {
        busy.current = false;
        setRunning(false);
      }
    }
  }, [modelId]);

  React.useEffect(() => {
    void run();
    return () => {
      generation.current += 1;
      busy.current = false;
      clearTimeout(timeout.current);
    };
  }, [run]);

  const badge = (status) => {
    const Icon = ICONS[status] || CircleAlert;
    return (
      <span className={`network-check__badge network-check__badge--${status}`}>
        <Icon size={13} aria-hidden="true" />
        {t(`network_check.status.${status}`)}
      </span>
    );
  };
  const row = (label, description, value, status, key) => (
    <div className="network-check__row" key={key || label}>
      <div className="network-check__row-copy">
        <div className="network-check__label">{label}</div>
        <div className="network-check__description">{description}</div>
      </div>
      <div className="network-check__row-result">
        {value && <span className="network-check__value">{value}</span>}
        {status && badge(status)}
      </div>
    </div>
  );
  const checkedAt = report?.checkedAt
    ? new Date(report.checkedAt).toLocaleString(i18n.language)
    : t('network_check.not_checked');
  let endpointOrigin = '';
  try {
    if (report?.endpoint) endpointOrigin = new URL(report.endpoint).origin;
  } catch {
    // An invalid endpoint must not break the diagnostic dialog.
  }

  return (
    <Modal
      open
      centered
      width={640}
      footer={null}
      onCancel={onClose}
      maskClosable={false}
      closable={{ 'aria-label': t('common.close') }}
      zIndex={1800}
      className="network-check-modal"
      title={
        <div className="network-check__header">
          <div>
            <h2>{t('network_check.title')}</h2>
            <div className="network-check__timestamp">
              {t('network_check.last_check', { time: checkedAt, interpolation: { escapeValue: false } })}
            </div>
          </div>
          <button type="button" className="network-check__rerun" onClick={run} disabled={running}>
            <RefreshCw size={14} className={running ? 'network-check__spin' : ''} aria-hidden="true" />
            {t(running ? 'network_check.running' : 'network_check.rerun')}
          </button>
        </div>
      }>
      <div className="network-check__body" aria-busy={running} aria-live="polite">
        {error ? (
          <div className="network-check__error" role="alert">
            <CircleAlert size={18} />
            {t(`network_check.${error}`)}
          </div>
        ) : (
          <>
            <h3>{t('network_check.overview')}</h3>
            {row(t('network_check.health'), t(`network_check.summary.${running || !report ? 'checking' : report.status}`),
              null, running || !report ? 'checking' : report.status)}
            <h3>{t('network_check.target')}</h3>
            {row(t('network_check.endpoint'), t(`network_check.${report?.source === 'model' ? 'endpoint_hint' : 'gateway_hint'}`),
              endpointOrigin || t('network_check.pending'))}
            {row(t('network_check.host'), t('network_check.host_hint'), report?.host || t('network_check.pending'))}
            {row(t('network_check.proxy_mode'), t('network_check.proxy_hint'),
              report ? report.proxy || t(report.checks.some((item) => item.reason === 'proxy_invalid')
                ? 'network_check.status.fail' : 'network_check.direct') : t('network_check.pending'))}
            <h3>{t('network_check.checks')}</h3>
            {(report?.checks || CHECK_IDS.map((id) => ({ id, status: 'checking', reason: 'checking' }))).map((item) =>
              row(t(`network_check.items.${item.id}`), t(`network_check.reasons.${item.reason}`),
                [item.id === 'dns' ? '' : item.value, Number.isFinite(item.durationMs) ? `${item.durationMs} ms` : ''].filter(Boolean).join('  '),
                item.status, item.id)
            )}
          </>
        )}
        <p className="network-check__note">{t('network_check.note')}</p>
      </div>
    </Modal>
  );
}
