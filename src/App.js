import React, { Suspense, useCallback, useState, useEffect } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import '@renderer/i18n';
import '@renderer/assets/styles/tailwind.css';
import '@renderer/assets/styles/index.css';
import '@renderer/assets/styles/CommandListPopover.css';
import '@renderer/assets/styles/selection-toolbar.css';
import './App.css';
import LoginPage from './page/LoginPage/LoginPage.jsx';
import { getArtistEffectDownloadUrl, searchDraft } from './api/capcut'; // 新增：导入解析 API和按ID搜索草稿
import logger from './shared/logger.js';
import { DownloadController } from './shared/DownloadController';

const toLegacyLanguage = (language) => (String(language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
const toModernLanguage = (language) => (String(language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US');
const HomePageShell = React.lazy(() => import('./page/HomePage/HomePageShell.jsx'));
let homeRuntimeInitPromise = null;

function App() {
  const { t, i18n } = useTranslation('legacy');
  const initialLegacyLanguage = toLegacyLanguage(i18n.resolvedLanguage || i18n.language);

  const [apiKey, setApiKey] = useState('');
  const [language, setLanguage] = useState(initialLegacyLanguage);
  const [locale, setLocale] = useState(initialLegacyLanguage === 'zh' ? zhCN : enUS);
  const [currentPage, setCurrentPage] = useState('login');
  const [isHomeRuntimeReady, setIsHomeRuntimeReady] = useState(false);

  const prepareHomeRuntime = useCallback(async () => {
    if (!homeRuntimeInitPromise) {
      homeRuntimeInitPromise = import('./page/HomePage/HomePageShell.jsx');
    }
    await homeRuntimeInitPromise;
    setIsHomeRuntimeReady(true);
  }, []);

  const toggleLanguage = (lang) => {
    const modernLanguage = toModernLanguage(lang);
    setLanguage(toLegacyLanguage(modernLanguage));
    setLocale(modernLanguage.startsWith('zh') ? zhCN : enUS);
    localStorage.setItem('language', modernLanguage);
    i18n.changeLanguage(modernLanguage);
  };

  const handleLogin = useCallback(async (id_token) => {
    logger.debug('login success');
    logger.debug('id_token:', id_token);
    try {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('login-success');
      await prepareHomeRuntime();

      // 仅已完成引导/已配置草稿目录时直接进首页
      const settings = await ipcRenderer.invoke('get-draft-folder');
      if (settings?.draftFolder) {
        setCurrentPage('home');
        ipcRenderer.send('resize-main-window', { width: 960, height: 640 });
      }
    } catch (e) {
      logger.warn('ipcRenderer not available:', e);
    }
  }, [prepareHomeRuntime]);

  useEffect(() => {
    // 在 App 层统一处理主进程的解析请求，避免页面卸载导致监听器丢失
    const { ipcRenderer } = window.require('electron');
    const handler = async (event, { effectId, reqId }) => {
      try {
        const url = await getArtistEffectDownloadUrl({ effectId });
        ipcRenderer.send('resolve-artist-effect-url-response', { reqId, url });
      } catch (err) {
        ipcRenderer.send('resolve-artist-effect-url-response', { reqId, error: err.message || 'request_failed' });
      }
    };
    ipcRenderer.on('resolve-artist-effect-url', handler);

    // 新增：全局监听深链 protocol-url，直接入队下载并切到主页
    const onProtocolUrl = async (event, url) => {
      try {
        const raw = typeof url === 'string' ? url : '';
        const qs = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').split('?')[1] || '';
        const params = new URLSearchParams(qs);

        const draftIds = Array.from(new Set(
          params
            .getAll('draft_id')
            .flatMap(v => String(v || '').split(','))
            .map(v => v.trim())
            .filter(Boolean)
        ));

        if (draftIds.length > 0) {
          for (const draftId of draftIds) {
            try {
              const res = await searchDraft({ draft_id: draftId });
              const draft = res?.draft;
              const name = (draft?.draft_name && draft.draft_name.trim()) ? draft.draft_name : draftId;
              const cover = draft?.cover || null;
              const createdAt = draft?.created_at;
              DownloadController.enqueue({ draft_id: draftId, draft_name: name, cover, createdAt });
            } catch (e) {
              try { DownloadController.enqueue({ draft_id: draftId, draft_name: draftId }); } catch (_) {}
            }
          }
          setCurrentPage('home');
        }
      } catch (_) {}
    };
    ipcRenderer.on('protocol-url', onProtocolUrl);

    const onGuiderFinished = () => {
      setCurrentPage('home');
      try {
        ipcRenderer.send('resize-main-window', { width: 960, height: 640 });
      } catch (_) {}
    };
    ipcRenderer.on('guider-finished', onGuiderFinished);

    return () => {
      ipcRenderer.removeListener('resolve-artist-effect-url', handler);
      ipcRenderer.removeListener('protocol-url', onProtocolUrl);
      ipcRenderer.removeListener('guider-finished', onGuiderFinished);
    };
  }, []);

  const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

  const handleWinCtrl = (action) => {
      try {
          const { ipcRenderer } = window.require('electron');
          ipcRenderer.send('window-controls', action);
      } catch (e) {
          // ignore
      }
  };

  return (
    <ConfigProvider locale={locale}>
      <div
        className="app-container"
        style={currentPage === 'home'
            ? { width: '100%', height: '100%', margin: 0 }
            : { width: 320, height: 450, margin: '0 auto' }}
      >
        {currentPage === 'home' ? (
          <Suspense fallback={<div style={{ padding: 12, color: '#666', fontSize: 12 }}>Loading home runtime...</div>}>
            {isHomeRuntimeReady ? (
              <HomePageShell />
            ) : (
              <div style={{ padding: 12, color: '#666', fontSize: 12 }}>Preparing home runtime...</div>
            )}
          </Suspense>
        ) : (
          <LoginPage
            initialApiKey={apiKey}
            onLogin={handleLogin}
            onPrepareHomeRuntime={prepareHomeRuntime}
            trans={t}
            language={language}
            toggleLanguage={toggleLanguage}
          />
        )}
        {/* 新增：仅在 Windows 渲染自定义窗口控制按钮 */}
        {isWindows && (
            <div className="titlebar-overlay">
                <button
                    className="traffic-btn minimize"
                    onClick={() => handleWinCtrl('minimize')}
                    title="最小化"
                />
                <button
                    className="traffic-btn maximize"
                    onClick={() => handleWinCtrl('maximize')}
                    title="最大化/还原"
                />
                <button
                    className="traffic-btn close"
                    onClick={() => handleWinCtrl('close')}
                    title="关闭"
                />
            </div>
        )}
      </div>
    </ConfigProvider>
  );
}

export default App;
