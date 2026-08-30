import React, { Suspense, useCallback, useState, useEffect } from 'react';
import { ConfigProvider, Modal } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import '@renderer/i18n';
import './App.css';
import LoginPage from './page/LoginPage/LoginPage.jsx';
import GuiderPage from './page/GuiderPage/GuiderPage.jsx';
import { getArtistEffectDownloadUrl, searchDraft } from './api/capcut'; // 新增：导入解析 API和按ID搜索草稿
import { loggerService } from '@logger';
import { DownloadController } from './shared/DownloadController.js';
const logger = loggerService.withContext('App');

const toLegacyLanguage = (language) => (String(language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
const toModernLanguage = (language) => (String(language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US');
const HomePageShell = React.lazy(() => import('./page/HomePage/HomePageShell.jsx'));
let homeRuntimeInitPromise = null;

function App() {
  const { t, i18n } = useTranslation('legacy');
  const initialLegacyLanguage = toLegacyLanguage(i18n.resolvedLanguage || i18n.language);
  const [modal, modalContextHolder] = Modal.useModal();

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
      await prepareHomeRuntime();

      // 仅已完成引导/已配置草稿目录时直接进首页
      const settings = await ipcRenderer.invoke('get-draft-folder');
      if (settings?.draftFolder) {
        setCurrentPage('home');
        ipcRenderer.send('resize-main-window', { width: 960, height: 640 });
      } else {
        setCurrentPage('guider');
        ipcRenderer.send('resize-main-window', { width: 960, height: 640 });
      }
    } catch (e) {
      logger.warn('ipcRenderer not available:', e);
    }
  }, [prepareHomeRuntime]);

  useEffect(() => {
    window.modal = modal;
  }, [modal]);

  useEffect(() => {
    // 在 App 层统一处理主进程的解析请求，避免页面卸载导致监听器丢失
    const { ipcRenderer } = window.require('electron');
    const handler = async (_event, { effectId, reqId }) => {
      try {
        const url = await getArtistEffectDownloadUrl({ effectId });
        ipcRenderer.send('resolve-artist-effect-url-response', { reqId, url });
      } catch (err) {
        ipcRenderer.send('resolve-artist-effect-url-response', { reqId, error: err.message || 'request_failed' });
      }
    };
    ipcRenderer.on('resolve-artist-effect-url', handler);

    // 全局监听深链 protocol-data，直接入队下载并切到主页
    const onProtocolData = async (_event, payload) => {
      try {
        const raw = typeof payload?.url === 'string' ? payload.url : '';
        const route = String(
          payload?.route
          || raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').split('?')[0]
          || ''
        ).trim().toLowerCase();
        if (route !== 'download') {
          return;
        }

        const payloadDraftId = payload?.params?.draft_id;
        const draftIdsFromPayload = Array.isArray(payloadDraftId)
          ? payloadDraftId
          : (payloadDraftId ? [payloadDraftId] : []);
        const qs = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').split('?')[1] || '';
        const params = new URLSearchParams(qs);

        const draftIds = Array.from(new Set(
          [
            ...draftIdsFromPayload,
            ...params.getAll('draft_id')
          ]
            .flatMap(v => String(v || '').split(','))
            .map(v => v.trim())
            .filter(Boolean)
        ));

        if (draftIds.length > 0) {
          await prepareHomeRuntime();

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
          ipcRenderer.send('resize-main-window', { width: 960, height: 640 });
        }
      } catch (_) {}
    };
    ipcRenderer.on('protocol-data', onProtocolData);
    ipcRenderer.send('protocol-renderer-ready');

    const onGuiderFinished = () => {
      setCurrentPage('home');
      try {
        ipcRenderer.send('resize-main-window', { width: 960, height: 640 });
      } catch (_) {}
    };
    ipcRenderer.on('guider-finished', onGuiderFinished);

    return () => {
      ipcRenderer.removeListener('resolve-artist-effect-url', handler);
      ipcRenderer.removeListener('protocol-data', onProtocolData);
      ipcRenderer.removeListener('guider-finished', onGuiderFinished);
    };
  }, [prepareHomeRuntime]);

  const isWindows = typeof process !== 'undefined' && process.platform === 'win32';
  // 登录页不展示最小化/最大化按钮，只保留关闭
  const showFullCaption = currentPage === 'home' || currentPage === 'guider';

  const handleWinCtrl = (action) => {
    try {
      if (window.ipc?.send) {
        window.ipc.send('window-controls', action);
        return;
      }
    } catch (e) {
      // ignore, fallback below
    }
    try {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('window-controls', action);
    } catch (e) {
      // ignore
    }
  };

  return (
    <ConfigProvider locale={locale}>
      {modalContextHolder}
      <div
        className="app-container"
        style={currentPage === 'home' || currentPage === 'guider'
            ? { width: '100%', height: '100%', margin: 0 }
            : { width: 320, height: 450, margin: '0 auto' }}
      >
        {currentPage === 'home' ? (
          <Suspense >
            {isHomeRuntimeReady ? (
              <HomePageShell />
            ) : null}
          </Suspense>
        ) : currentPage === 'guider' ? (
          <GuiderPage />
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
        {isWindows && (
          <div className="win-caption-controls">
            {showFullCaption && (
              <>
                <button type="button" className="win-caption-btn" onClick={() => handleWinCtrl('minimize')} aria-label="最小化" title="最小化">
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
                  </svg>
                </button>
                <button type="button" className="win-caption-btn" onClick={() => handleWinCtrl('maximize')} aria-label="最大化/还原" title="最大化/还原">
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
                  </svg>
                </button>
              </>
            )}
            <button type="button" className="win-caption-btn win-caption-btn--close" onClick={() => handleWinCtrl('close')} aria-label="关闭" title="关闭">
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" stroke="currentColor" strokeWidth="1" fill="none" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </ConfigProvider>
  );
}

export default App;
