import React, { useState } from 'react';
import { Button, Typography, Input, message, Dropdown, Menu, Tooltip, Modal, Select } from 'antd';
import { GlobalOutlined, MinusOutlined, FullscreenOutlined, CloseOutlined, PlusOutlined, DeleteOutlined, SettingOutlined } from '@ant-design/icons';

import './LoginPage.css';
import i18n from '../../i18n';
const Store = window.require('electron-store');
const store = new Store(); // 实例化 Store
const { Title, Text } = Typography;

// 假设 Electron 环境已通过 window.require 或 Context Bridge 暴露 ipcRenderer
// 注意：在实际 Electron 应用中，需确保 preload 脚本正确设置了上下文隔离。
const { ipcRenderer } = window.require('electron');

// 模拟用户数据，实际中应从本地存储或父组件获取
const simulatedAccount = {
    name: "CIA.橘子的梦.FBI",
    // 默认头像占位符
    avatar: "https://placehold.co/40x40/3182CE/ffffff?text=U"
};

// 这是新的设置组件
const NetworkSettingsView = ({ t, onBack }) => {
    const [language, setLanguage] = useState(() => {
        return store.get('language') || 'zh';
    });

    // 模拟数据
    const languageOptions = [
        { value: 'zh', label: '中文' },
        { value: 'en', label: 'English' }
    ];

    const handleConfirm = () => {
        ipcRenderer.send('save-settings', { 
            language: language 
        });
        onBack(); // 返回登录页
    };

    // 图中所示的“取消”实际上就是返回登录页
    const handleCancel = () => {
        onBack();
    };

    return (
        // 设置视图容器，确保其可拖动
        <div style={{ padding: '0 20px', height: '100%', textAlign: 'center', WebkitAppRegion: 'no-drag' }}>

            {/* 标题 - 居中显示，设置 no-drag 确保文本可选 */}
            <Typography.Title
                level={5}
                style={{ marginTop: 40, WebkitAppRegion: 'drag' }}
            >
                {'设置'}
            </Typography.Title>

            {/* 语言选择 - 确保 no-drag */}
            <div style={{ textAlign: 'left', marginTop: 20, WebkitAppRegion: 'no-drag' }}>
                <Typography.Text>{'语言'}</Typography.Text>
                <div style={{ marginTop: 6, WebkitAppRegion: 'no-drag' }}>
                    <Select
                        value={language}
                        onChange={setLanguage}
                        options={languageOptions}
                        size="middle"
                        style={{ width: '100%', height: '35px'}}
                    />
                </div>
            </div>

            {/* 底部按钮 - 如图所示，底部对齐，设置 no-drag */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 20,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    justifyContent: 'flex-end',
                    padding: '0 20px',
                    WebkitAppRegion: 'no-drag'
                }}
            >
                <Button
                    key="back"
                    onClick={handleCancel}
                    style={{ borderRadius: 4, marginRight: 10, height: 31, width: 76,borderWidth:'1px', borderColor:'#B0B0B0', backgroundColor: 'transparent' }}
                >
                    {'取消'}
                </Button>
                <Button
                    key="submit"
                    type="primary"
                    onClick={handleConfirm}
                    style={{ borderRadius: 4, height: 31, width: 76, backgroundColor: '#0099FF' }}
                >
                    {'确定'}
                </Button>
            </div>
        </div>
    );
};

/**
 * 登录页面组件
 * - 集成 Ant Design 样式和 Electron 窗口控制。
 * - 接收父级传递的 i18n props (t, language, toggleLanguage)。
 * * @param {object} props - 组件属性
 * @param {function} props.onLogin - 登录成功回调 (apiKey)
 * @param {function} props.t - 翻译函数
 * @param {string} props.language - 当前语言
 * @param {function} props.toggleLanguage - 切换语言函数
 */
const LoginPage = ({ onLogin, t, language, toggleLanguage }) => {
    // 假设父组件已传入 t 函数，若未传入，此处使用一个简单占位符
    const finalT = t || ((key) => key.replace(/_/g, ' '));

    const [apiKey, setApiKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [currentAccount, setCurrentAccount] = useState(simulatedAccount);
    const [viewState, setViewState] = useState('login');

    // **新增：处理设置按钮点击**
    const handleOpenSettings = () => {
        setViewState('settings');
    };

    // **新增：处理返回登录页**
    const handleBackToLogin = () => {
        setViewState('login');
    };

    // --- Electron 窗口控制函数 ---
    const handleWindowControl = (action) => {
        if (ipcRenderer) {
            ipcRenderer.send(`${action}-window`);
        } else {
            console.error(`IPC Renderer not available. Cannot perform ${action}.`);
            message.warning(`IPC Renderer not available. Cannot perform ${action}.`);
        }
    };

    // 登录逻辑
    const handleLogin = () => {
        if (apiKey.trim() === '') {
            message.error(finalT('login_api_key_required') || 'API Key is required');
            return;
        }

        setLoading(true);
        // 模拟 API Key 验证
        setTimeout(() => {
            setLoading(false);
            message.success(finalT('login_success') || 'Login successful!');

            // 1. 调用父组件回调，设置登录状态和 API Key
            if (onLogin) {
                onLogin(apiKey);
            }

            // 2. 通知主进程登录成功，模仿用户原生JS代码中的逻辑
            if (ipcRenderer) {
                ipcRenderer.send('login-success');
            }

        }, 1000);
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleLogin();
        }
    };

    // 其他账号操作模拟
    const handleAddAccount = () => {
        console.log("添加账号功能待实现 (弹出 Authing 登录页面)");
        message.info(finalT('add_account_prompt') || 'Add account feature coming soon.');
    };

    const handleRemoveAccount = () => {
        console.log("移除账号功能待实现");
        // 模拟移除
        setCurrentAccount(null);
        setApiKey('');
        message.success(finalT('remove_account_success') || 'Account removed.');
    };

    // 渲染视图的逻辑
    const renderView = () => {
        if (viewState === 'settings') {
            return (
                <NetworkSettingsView
                    t={finalT}
                    onBack={handleBackToLogin}
                    language={language} 
                    toggleLanguage={toggleLanguage}
                />
            );
        }

        // 默认渲染登录视图
        return (
            <>
                {/* Logo - 匹配 .qq-logo / 自定义 Title */}
                <Typography.Title
                    level={2}
                    className="qq-logo"
                    style={{ WebkitAppRegion: 'drag' }}
                >
                    CAPCUT API
                </Typography.Title>

                {/* 头像 wrapper - 匹配 .profile-image-wrapper */}
                {/* ... (此处放置您原有的登录页 JSX) ... */}

                {/* API Key 输入区域 */}
                <div style={{ marginTop: 10, width: '80%', WebkitAppRegion: 'no-drag' }}>
                    <Input.Password
                        placeholder={finalT('api_key_placeholder') || '请输入您的API Key'}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                    // ... (其他属性)
                    />
                </div>

                {/* 登录按钮 */}
                <Button
                    id="login-button"
                    className="login-button"
                // ... (其他属性)
                >
                    {finalT('login_button') || '登录'}
                </Button>

                {/* 底部链接/操作 */}
                <div className="bottom-links">
                    {/* ... (添加账号 / 移除账号按钮) ... */}
                </div>
            </>
        );
    };

    return (
        <div 
            style={{ 
                height: '100%', 
            }}
        >

            <div 
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '30px', // 给定一个明确的拖动高度
                    WebkitAppRegion: 'drag', // 👈 确保此条可拖动
                    zIndex: 10,
                }}
            >
                {/* ⚠️ 这个 div 是空的，其目的就是为了拖动 */}
            </div>

            <div
                className="top-right-controls"
                style={{
                    position: 'absolute',
                    top: 0,
                    right: 5, // 调整右侧间距，与左侧的 15px 对应
                    zIndex: 20,
                    WebkitAppRegion: 'no-drag' // 确保按钮可点击
                }}
            >
                <Button
                    icon={<SettingOutlined style={{ fontSize: '14px' }} />} // 使用 Ant Design 的设置图标，可以调整大小
                    type="text"
                    className="control-button" // 👈 添加自定义类名
                    // 添加一个处理点击事件的函数（例如，打开设置模态框）
                    onClick={() => viewState === 'settings' ? handleBackToLogin() : handleOpenSettings()}
                    style={{
                        color: 'rgba(0, 0, 0)' // 默认颜色
                    }}
                />
            </div>


            {renderView()}
        </div>
    );
};

// 导出组件
export default LoginPage;
