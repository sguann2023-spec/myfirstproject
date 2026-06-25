import { useEffect, useState } from 'react';
import { message } from 'antd';
import './AccountSecurity.css';
import { electronStore } from '../../shared/electronStore';
import {
  ensureVectcutApiKeyForCurrentSession,
  getCachedVectcutApiKey,
  getVectcutSessionSignature,
  persistVectcutApiKey,
} from '../../auth/vectcutApiKey';
import { maskApiKey } from '@renderer/utils/api';

const AccountSecurity = () => {
  const [apiKey, setApiKey] = useState(() => getCachedVectcutApiKey());
  const [syncing, setSyncing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sessionSignature, setSessionSignature] = useState(() => getVectcutSessionSignature());

  useEffect(() => {
    let disposed = false;

    const syncApiKey = async () => {
      const nextSessionSignature = getVectcutSessionSignature();
      setSessionSignature(nextSessionSignature);

      if (!nextSessionSignature) {
        persistVectcutApiKey('');
        setApiKey('');
        setSyncing(false);
        return;
      }

      const cachedApiKey = getCachedVectcutApiKey();
      setApiKey(cachedApiKey);

      if (cachedApiKey) {
        setSyncing(false);
        return;
      }

      setSyncing(true);
      try {
        const nextApiKey = await ensureVectcutApiKeyForCurrentSession();
        if (!disposed) {
          setApiKey(nextApiKey);
        }
      } finally {
        if (!disposed) {
          setSyncing(false);
        }
      }
    };

    void syncApiKey();

    const disposers = [];
    if (typeof electronStore.onDidChange === 'function') {
      disposers.push(
        electronStore.onDidChange('auth.refresh_token', () => {
          void syncApiKey();
        })
      );
      disposers.push(
        electronStore.onDidChange('user', () => {
          void syncApiKey();
        })
      );
      disposers.push(
        electronStore.onDidChange('auth.vectcut_api_key', (newValue) => {
          if (!disposed) {
            setApiKey(String(newValue || '').trim());
          }
        })
      );
    }

    return () => {
      disposed = true;
      disposers.forEach((dispose) => {
        if (typeof dispose === 'function') {
          dispose();
        }
      });
    };
  }, []);

  const isLoggedIn = Boolean(sessionSignature);
  const canCopy = Boolean(isLoggedIn && apiKey && !copying);
  const displayValue = apiKey
    ? maskApiKey(apiKey)
    : syncing
      ? '正在同步...'
      : isLoggedIn
        ? '未获取到 API KEY'
        : '未登录';

  const handleCopy = async () => {
    if (!apiKey) {
      message.warning('未获取到 API_KEY');
      return;
    }

    setCopying(true);
    try {
      await navigator.clipboard.writeText(apiKey);
      message.success('API_KEY 已复制');
    } catch {
      message.error('复制失败，请稍后重试');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="account-security">
      <div className="account-security-section">
        <div className="account-security-row">
          <div className="account-security-label">我的API KEY</div>
          <div className={`account-security-value ${!apiKey ? 'empty' : ''}`}>{displayValue}</div>
          <button type="button" className="account-security-button" onClick={handleCopy} disabled={!canCopy}>
            复制
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountSecurity;
