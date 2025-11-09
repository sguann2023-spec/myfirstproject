import React, { useState } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import './i18n';
import './App.css';
import LoginPage from './page/LoginPage/LoginPage.jsx';

function App() {
  const { t, i18n } = useTranslation();

  const [apiKey, setApiKey] = useState('');
  const [language, setLanguage] = useState('zh');
  const [locale, setLocale] = useState(zhCN);

  const toggleLanguage = (lang) => {
    setLanguage(lang);
    setLocale(lang === 'zh' ? zhCN : enUS);
    i18n.changeLanguage(lang);
  };

  const handleLogin = (key) => {
    setApiKey(key);
    setIsLoggedIn(true);
  };

  return (
    <ConfigProvider locale={locale}>
      <div
        className="app-container"
        style={{
          height: '100%'
        }}
      >
        <LoginPage
          initialApiKey={apiKey}
          onLogin={handleLogin}
          t={t}
          language={language}
          toggleLanguage={toggleLanguage}
        />
      </div>
    </ConfigProvider>
  );
}

export default App;