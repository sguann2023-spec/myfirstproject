// src/page/SettingPage/SettingPage.entry.jsx

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
// 确保导入您需要的本地化文件
import zhCN from 'antd/locale/zh_CN'; 
// 🚀 导入您完整的 SettingPage 组件
import SettingPage from './SettingPage.jsx'; 
// 假设您的 i18n 逻辑也需要被加载
import '../../i18n'; // 确保国际化加载

// 1. 获取 DOM 根节点
const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Root element not found in settings.html');
}

const root = ReactDOM.createRoot(rootElement);

// 2. 独立地渲染 SettingPage
root.render(
  <React.StrictMode>
    {/* 🚀 关键：包裹 ConfigProvider 和本地化 */}
    <ConfigProvider locale={zhCN}> 
      <SettingPage />
    </ConfigProvider>
  </React.StrictMode>
);

// 注意：如果您的 SettingPage 依赖于 i18n 的 hook 或上下文，
// 确保 i18n 的初始化逻辑在渲染前运行。