import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd'; // 引入 Ant Design 配置
import App from './App';
import SettingPage from './page/SettingPage/SettingPage.jsx'; // 引入设置页面组件


// 1. 获取 URL 中的查询参数
const urlParams = new URLSearchParams(window.location.search);
const view = urlParams.get('view');

const root = ReactDOM.createRoot(document.getElementById('root'));

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