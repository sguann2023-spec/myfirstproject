import { useEffect, useState } from 'react';
import { message } from 'antd';
import './AccountSecurity.css';
import { electronStore } from '../../shared/electronStore';
import {
  ensureVectcutApiKeyForCurrentSession,
  getCachedVectcutApiKey,
  getCurrentVectcutUserId,
  getVectcutSessionSignature,
  persistVectcutApiKey,
} from '../../auth/vectcutApiKey';

function maskApiKey(apiKey) {
  if (!apiKey) {
    return '未登录';
  }
  return '••••••••••••••••';
}

const AccountSecurity = () => {
  const [apiKey, setApiKey] = useState(() => getCachedVectcutApiKey());
  const [loading, setLoading] = useState(false);
  const [sessionSignature, setSessionSignature] = useState(() => getVectcutSessionSignature());

  useEffect(() => {
    let disposed = false;

    const syncApiKey = async () => {
      const nextSessionSignature = getVectcutSessionSignature();
      setSessionSignature(nextSessionSignature);

      if (!nextSessionSignature) {
        persistVectcutApiKey('');
        setApiKey('');
        return;
      }

      const cachedApiKey = getCachedVectcutApiKey();
      setApiKey(cachedApiKey);

      if (cachedApiKey) {
        return;
      }

      setLoading(true);
      try {
        const nextApiKey = await ensureVectcutApiKeyForCurrentSession();
        if (!disposed) {
          setApiKey(nextApiKey);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
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

  const handleCopy = async () => {
    const currentSessionSignature = getVectcutSessionSignature();
    const currentUserId = getCurrentVectcutUserId();

    if (!currentSessionSignature || !currentUserId) {
      message.warning('请先登录账号');
      return;
    }

    setLoading(true);
    try {
      const latestApiKey = await ensureVectcutApiKeyForCurrentSession();
      if (!latestApiKey) {
        message.error('获取 API_KEY 失败，请稍后重试');
        return;
      }
      await navigator.clipboard.writeText(latestApiKey);
      setApiKey(latestApiKey);
      message.success('API_KEY 已复制');
    } catch {
      message.error('复制失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const isLoggedIn = Boolean(sessionSignature);

  return (
    <div className="account-security">
      <div className="account-security-section">
        <div className="account-security-row">
          <div className="account-security-desc">
            <div className="account-security-label">我的API KEY</div>
            <div className={`account-security-value ${!apiKey ? 'empty' : ''}`}>
              {loading ? '正在同步...' : maskApiKey(apiKey)}
            </div>
          </div>
          <button
            type="button"
            className="account-security-button"
            onClick={handleCopy}
            disabled={loading || !isLoggedIn}
          >
            {loading ? '复制中...' : '复制'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountSecurity;
