// SettingPage.jsx
import { Suspense, lazy, useEffect, useState } from 'react';
import { Spin } from 'antd';
import './SettingPage.css';

import AccountSecurityIcon from '../../../public/account_security.svg';
import GeneralSettingIcon from '../../../public/settings_general.png';
import PrivacyIcon from '../../../public/privacy.svg';
import { InfoCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { getCurrentChannelBrandConfig } from '../../../channel-branding/runtime';
const GeneralSettings = lazy(() => import('../../components/GeneralSettings/GeneralSettings'));
const HelpSettings = lazy(() => import('../../components/HelpSettings/HelpSettings'));
const AccountSecurity = lazy(() => import('../../components/AccountSecurity/AccountSecurity'));
const AboutUs = lazy(() => import('../../components/AboutUs/AboutUs'));
const PolicyAgreement = lazy(() => import('../../components/PolicyAgreement/PolicyAgreement'));
const CURRENT_CHANNEL_BRAND_CONFIG = getCurrentChannelBrandConfig();
const ABOUT_TITLE = CURRENT_CHANNEL_BRAND_CONFIG.ui.aboutTitle;

// 菜单项数据
const settingMenuItems = [
  { key: 'account-security', icon: <img src={AccountSecurityIcon} alt="Account Security" className="setting-icon" />, title: '账号与安全', component: AccountSecurity },
  { key: 'general', icon: <img src={GeneralSettingIcon} alt="General Settings" className="setting-icon" />, title: '通用', component: GeneralSettings },
  { key: 'help', icon: <QuestionCircleOutlined />, title: '使用帮助', component: HelpSettings },
  { key: 'about', icon: <InfoCircleOutlined />, title: ABOUT_TITLE, component: AboutUs },
  { key: 'policy', icon: <img src={PrivacyIcon} alt="Policy Agreement" className="setting-icon" />, title: '政策与协议', component: PolicyAgreement }
];

const SettingPage = () => {
  // 默认选中 'account-security'
  const [selectedKey, setSelectedKey] = useState('account-security');
  useEffect(() => {
    document.getElementById('spinner')?.remove();
  }, []);

  const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

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


  // 动态获取当前选中的组件
  const SelectedComponent = settingMenuItems.find(item => item.key === selectedKey)?.component || GeneralSettings;

  return (
    <div className="window-top-container"> 
      <div className="window-top-bar">
          
          {/* 1. 左侧拖动区域：与侧边栏同宽，背景色相同 */}
          <div className="top-left-drag-area">
              {/* 这里可以放置窗口控制按钮（红黄绿） */}
          </div>
          
          {/* 2. 右侧拖动区域：占据剩余空间，背景色相同 */}
          <div className="top-right-drag-area">
            {/* Windows 窗口控制按钮必须放在 drag 区域内部（no-drag 子元素），否则点击会被拖拽区域吞掉 */}
            {isWindows && (
              <div className="win-caption-controls">
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
                <button type="button" className="win-caption-btn win-caption-btn--close" onClick={() => handleWinCtrl('close')} aria-label="关闭" title="关闭">
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" stroke="currentColor" strokeWidth="1" fill="none" />
                  </svg>
                </button>
              </div>
            )}
          </div>
      </div>

        <div className="setting-page-container">
            {/* 1. 左侧导航栏 */}
            <div className="setting-sidebar">
                {settingMenuItems.map(item => (
                <div
                    key={item.key}
                    className={`setting-menu-item ${selectedKey === item.key ? 'selected' : ''}`}
                    onClick={() => setSelectedKey(item.key)}
                >
                    <span className="setting-menu-icon">{item.icon}</span>
                    <span className="setting-menu-title">{item.title}</span>
                </div>
                ))}
            </div>

            {/* 2. 右侧主内容区 */}
            <div className="setting-content-area">
                <div className="setting-content-header">
                {settingMenuItems.find(item => item.key === selectedKey)?.title || '通用'}
                </div>
                <div className="setting-content-body">
                <Suspense fallback={<div className="setting-content-loading"><Spin size="large" /></div>}>
                  <SelectedComponent />
                </Suspense>
                </div>
            </div>
        </div>
    </div>
  );
};

export default SettingPage;
