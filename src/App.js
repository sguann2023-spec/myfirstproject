import React, { useState } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import './i18n';
import './App.css';
import LoginPage from './page/LoginPage/LoginPage.jsx';
import HomePage from './page/HomePage/HomePage.jsx';

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
    console.log('login success');
    console.log('id_token:', id_token);
    setCurrentPage('home');

    // 通知主进程调整窗口尺寸以适配 HomePage
    try {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('resize-main-window', { width: 960, height: 640 });
    } catch (e) {
      console.warn('ipcRenderer not available:', e);
    }
  };

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