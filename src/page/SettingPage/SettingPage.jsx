// SettingPage.jsx
import React, { useState } from 'react';
import './SettingPage.css';

import GeneralSettingIcon from '../../../public/settings_general.png';
import { MailOutlined, SettingOutlined, KeyOutlined, ApiOutlined, InfoCircleOutlined } from '@ant-design/icons';
import GeneralSettings from '../../components/GeneralSettings/GeneralSettings';
import AboutUs from '../../components/AboutUs/AboutUs';
import logger from '../../shared/logger';

// 菜单项数据
const settingMenuItems = [
  { key: 'general', icon: <img src={GeneralSettingIcon} alt="General Settings" className="setting-icon" />, title: '通用', component: GeneralSettings },
  { key: 'about', icon: <InfoCircleOutlined />, title: '关于流光剪辑', component: AboutUs },
];

const SettingPage = () => {
  // 默认选中 'general'
  const [selectedKey, setSelectedKey] = useState('general');
  logger.debug('settingPage');

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
                <SelectedComponent />
                </div>
            </div>
        </div>
    </div>
  );
};

export default SettingPage;