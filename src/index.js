import React from 'react';
import ReactDOM from 'react-dom/client';
import '@ant-design/v5-patch-for-react-19';
import { ConfigProvider, message } from 'antd'; // 引入 Ant Design 配置
import App from './App.jsx';
import SettingPage from './page/SettingPage/SettingPage.jsx'; // 引入设置页面组件
import { loggerService } from '@logger';
const logger = loggerService.withContext('Index');
// 1. 获取 URL 中的查询参数
const urlParams = new URLSearchParams(window.location.search);
const view = urlParams.get('view');
loggerService.initWindowSource(view === 'settings' ? 'settingsWindow' : 'mainWindow');

const DEFAULT_THEME_MODE = 'light';
document.body.setAttribute('theme-mode', DEFAULT_THEME_MODE);
document.documentElement.setAttribute('theme-mode', DEFAULT_THEME_MODE);

message.config({
  top: 36,
  maxCount: 3,
  getContainer: () => document.body,
});

const root = ReactDOM.createRoot(document.getElementById('root'));

window.addEventListener('unhandledrejection', (event) => {
  logger.error('[Renderer] unhandledrejection', {
    message: event?.reason?.message || String(event?.reason || ''),
    stack: event?.reason?.stack || '',
  });
});

window.addEventListener('error', (event) => {
  logger.error('[Renderer] error', {
    message: event?.error?.message || event?.message || '',
    stack: event?.error?.stack || '',
    filename: event?.filename || '',
    lineno: event?.lineno || 0,
    colno: event?.colno || 0,
  });
});

// 2. 根据查询参数决定渲染哪个组件
if (view === 'settings') {
  // 当 Electron 新窗口加载 ?view=settings 时，只渲染 SettingPage
  root.render(
    <React.StrictMode>
      {/* 必须包裹 ConfigProvider 以确保 SettingPage 能够使用 Ant Design 样式和本地化 */}
      <ConfigProvider> 
        <SettingPage />
      </ConfigProvider>
    </React.StrictMode>
  );
} else {
  // 否则，渲染主应用 App
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
