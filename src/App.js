import React, { useState, useEffect } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import './i18n';
import './App.css';
import LoginPage from './page/LoginPage/LoginPage.jsx';
import HomePage from './page/HomePage/HomePage.jsx';
import { getArtistEffectDownloadUrl } from './api/capcut'; // 新增：导入解析 API
import logger from './shared/logger.js';

function App() {
  const { t, i18n } = useTranslation();

  const [apiKey, setApiKey] = useState('');
  const [language, setLanguage] = useState('zh');
  const [locale, setLocale] = useState(zhCN);
  const [currentPage, setCurrentPage] = useState('login');

  const toggleLanguage = (lang) => {
    setLanguage(lang);
    setLocale(lang === 'zh' ? zhCN : enUS);
    i18n.changeLanguage(lang);
  };

  const handleLogin = (id_token) => {
    logger.debug('login success');
    logger.debug('id_token:', id_token);
    setCurrentPage('home');

    // 通知主进程调整窗口尺寸以适配 HomePage
    try {
      const { ipcRenderer } = window.require('electron');
      // 新增：通知主进程登录成功
      ipcRenderer.send('login-success');

      // 保留：调整窗口尺寸（如需仅由主进程控制尺寸，可移除此行）
      ipcRenderer.send('resize-main-window', { width: 960, height: 640 });
    } catch (e) {
      logger.warn('ipcRenderer not available:', e);
    }
  };

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
    return () => {
      ipcRenderer.removeListener('resolve-artist-effect-url', handler);
    };
  }, []);

  return (
    <ConfigProvider locale={locale}>
      <div
        className="app-container"
        style={currentPage === 'home'
            ? { width: 960, height: 640, margin: '0 auto' }
            : { width: 320, height: 450, margin: '0 auto' }}
      >
        {currentPage === 'home' ? (
          <HomePage />
        ) : (
          <LoginPage
            initialApiKey={apiKey}
            onLogin={handleLogin}
            trans={t}
            language={language}
            toggleLanguage={toggleLanguage}
          />
        )}
      </div>
    </ConfigProvider>
  );
}

export default App;