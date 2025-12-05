import React, { useState, useEffect } from 'react';
import { Button, Typography, Input, message, Dropdown, Menu, Tooltip, Modal, Select } from 'antd';
import { GlobalOutlined, MinusOutlined, FullscreenOutlined, CloseOutlined, PlusOutlined, DeleteOutlined, SettingOutlined, DownOutlined } from '@ant-design/icons';
import { GuardProvider, useGuard } from '@authing/guard-react';
import * as Authing from '@authing/guard';

import LogoIcon from '../../../public/logo.png'

import './LoginPage.css';
import { electronStore } from '../../shared/electronStore'; // 从共享模块导入
const { Title, Text } = Typography;

const { ipcRenderer } = window.require('electron');
const axios = require('axios');
import { tokenStore } from '../../auth'; // 统一从 index 导入
import { createDraft } from '../../api/capcut';
import { addUser } from '../../api/user';
import logger from '../../shared/logger';

// --- Authing 配置常量 ---
const AUTHING_CONFIG = {
    APP_ID: '6901dd145dafc6f1f3143938',
    DOMAIN: 'https://mlbd8l6vgi13-demo.authing.cn',
    REDIRECT_URI: 'https://localhost/authing-guard-callback', 
    CLIENT_SECRET: '16a94e467e927cc09b3c8dc7ec92d420'
};

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        if (!base64Url) return null;
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
        return JSON.parse(jsonPayload);
    } catch (e) {
        logger.error('parseJwt failed:', e);
        return null;
    }
}

// NetworkSettingsView 组件
const NetworkSettingsView = ({ trans, onBack, toggleLanguage }) => {
    const [language, setLanguage] = useState(() => {
        return electronStore.get('language') || 'zh';
    });

    // 语言选项改为可翻译的标签
    const languageOptions = [
        { value: 'zh', label: trans('lang_zh') },
        { value: 'en', label: trans('lang_en') }
    ];

    const handleConfirm = () => {
        // 先在渲染进程切换语言，立即生效
        if (toggleLanguage) toggleLanguage(language);

        // 再保存到主进程持久化
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
                {trans('settings')}
            </Typography.Title>

            {/* 语言选择 - 确保 no-drag */}
            <div style={{ textAlign: 'left', marginTop: 20, WebkitAppRegion: 'no-drag' }}>
                <Typography.Text>{trans('language')}</Typography.Text>
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
                    {trans('cancel')}
                </Button>
                <Button
                    key="submit"
                    type="primary"
                    onClick={handleConfirm}
                    style={{ borderRadius: 4, height: 31, width: 76, backgroundColor: '#0099FF' }}
                >
                    {trans('confirm')}
                </Button>
            </div>
        </div>
    );
};

// TOKEN交换
const exchangeToken = async (code, trans) => {
    try {
        const tokenUrl = `${AUTHING_CONFIG.DOMAIN}/oidc/token`;
        
        const response = await axios.post(tokenUrl, new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            client_id: AUTHING_CONFIG.APP_ID,
            client_secret: AUTHING_CONFIG.CLIENT_SECRET,
            redirect_uri: AUTHING_CONFIG.REDIRECT_URI
        }).toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        return response.data;
    } catch (error) {
        logger.error('Token 交换失败:', error.response ? error.response.data : error.message);
        message.error(i18n('login_failed') + `: ${error.response?.data?.error_description || 'Token exchange failed'}`);
        throw error;
    }
};

/**
 * 登录页面组件
 * - 集成 Ant Design 样式和 Electron 窗口控制。
 * - 接收父级传递的 i18n props (trans, language, toggleLanguage)。
 * * @param {object} props - 组件属性
 * @param {function} props.onLogin - 登录成功回调 (id_token)
 * @param {function} props.trans - 翻译函数
 * @param {string} props.language - 当前语言
 * @param {function} props.toggleLanguage - 切换语言函数
 */
const LoginPage = ({ onLogin, trans, language, toggleLanguage }) => {
    const i18n = trans || ((key) => key.replace(/_/g, ' '));

    const [viewState, setViewState] = useState('login');
    // 展示用的用户名（初始从持久化里读一次）
    const [displayName, setDisplayName] = useState(() => electronStore.get('user')?.name || '');
    // 展示的用户头像
    const [avatarUrl, setAvatarUrl] = useState(() => electronStore.get('user')?.avatar || '');

    // **新增：处理设置按钮点击**
    const handleOpenSettings = () => {
        setViewState('settings');
    };

    // **新增：处理返回登录页**
    const handleBackToLogin = () => {
        setViewState('login');
    };
    
    // --- Authing 登录逻辑 ---
    // 打开 Authing Guard 的封装
    const openGuard = () => {
        const guardUrl = `${AUTHING_CONFIG.DOMAIN}/?` + new URLSearchParams({
            app_id: AUTHING_CONFIG.APP_ID,
            redirect_uri: AUTHING_CONFIG.REDIRECT_URI,
            response_type: 'code',
            scope: 'openid profile email',
            module: 'login_and_register'
        }).toString();
        ipcRenderer.send('open-auth-guard-window', guardUrl);
    };

    // 登录：优先尝试用 refresh_token 静默获取有效令牌，失败再打开 Guard
    const handleLogin = async () => {
        try {
            // 如果已经有 refresh_token，优先静默刷新/校验
            const accessToken = await tokenStore.ensureValidAccessToken();
            if (accessToken) {
                const idToken = tokenStore.idToken;
                if (idToken) {
                    const claims = parseJwt(idToken) || {};
                    const name = claims.name || claims.preferred_username || claims.nickname || claims.email || '';
                    electronStore.set('user', {
                        id: claims.sub,
                        name,
                        email: claims.email,
                        avatar: claims.picture || claims.avatar || claims.photo || null
                    });
                    setAvatarUrl(claims.picture || claims.avatar || claims.photo || null);
                    setDisplayName(name);

                    // 新增：登录成功后写库（静默登录）
                    addUser({ id: claims.sub, name, avatar: claims.picture || claims.avatar || claims.photo || null });

                    if (onLogin) onLogin(idToken);
                    return; // 已静默登录成功，无需弹 Guard
                }
            }
        } catch (err) {
            logger.warn('Silent login failed, will open Guard:', err);
        }

        // 没有 refresh_token 或刷新失败，走 Guard 登录
        openGuard();
    };

    const testRequest = async() =>{
        // 登录成功或已有 token 后，直接发起测试请求
        try {
            const result = await createDraft({ width: 1080, height: 1920 });
            logger.debug('create_draft result:', result);
        } catch (err) {
            logger.error('create_draft failed:', err);
        }
    }

    // --- 监听来自主进程的授权码回调 ---
    useEffect(() => { 
        const handleAuthCode = async (event, code) => {
            logger.debug('Received Auth Code:', code);
            try {
                // 3. 交换 Token
                const tokenData = await exchangeToken(code, trans);
                logger.debug('tokenData', tokenData);
                const { id_token, access_token, refresh_token, expires_in } = tokenData;
                tokenStore.setTokens({
                    idToken: id_token,
                    accessToken: access_token,
                    refreshToken:refresh_token,
                    accessTokenExpiresIn: typeof expires_in === 'number' ? expires_in : undefined,
                });
                // 4. 解析 id_token，提取并保存用户信息
                const claims = parseJwt(id_token) || {};
                const name = claims.name || claims.preferred_username || claims.nickname || claims.email || '';
                electronStore.set('user', {
                    id: claims.sub,
                    name: name,
                    email: claims.email,
                    avatar: claims.picture || claims.avatar || claims.photo || null
                });
                // 更新到本地状态以驱动 UI
                setAvatarUrl(claims.picture || claims.avatar || claims.photo || null);
                setDisplayName(name);

                // 新增：登录成功后写库（静默登录）
                addUser({ id: claims.sub, name, avatar: claims.picture || claims.avatar || claims.photo || null });

                if (onLogin) {
                    onLogin(id_token);
                }
            } catch (error) {
                // 错误已在 exchangeToken 中处理
            }
        };

        const handleError = (event, error) => {
            message.error(i18n('login_failed') + `: ${error || 'Authentication failed'}`);
        };

        ipcRenderer.on('guard-auth-code', handleAuthCode);
        ipcRenderer.on('guard-auth-error', handleError);

        return () => {
            ipcRenderer.removeListener('guard-auth-code', handleAuthCode);
            ipcRenderer.removeListener('guard-auth-error', handleError);
        };
    }, [trans, onLogin]);

    // 强制打开 Authing 登录页（忽略现有会话）
    const forceOpenGuardLogin = () => {
        electronStore.delete('user');
        setDisplayName('');
        setAvatarUrl('');
        const guardUrl = `${AUTHING_CONFIG.DOMAIN}/?` + new URLSearchParams({
            app_id: AUTHING_CONFIG.APP_ID,
            redirect_uri: AUTHING_CONFIG.REDIRECT_URI,
            response_type: 'code',
            scope: 'openid profile email',
            module: 'login_and_register',
            prompt: 'login',
        }).toString();

        ipcRenderer.send('open-auth-guard-window', guardUrl);
    };

    // 渲染视图的逻辑
    const renderView = () => {
        if (viewState === 'settings') {
            return (
                <NetworkSettingsView
                    trans={i18n}
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
                    {i18n('logo_title')}
                </Typography.Title>

                <div className="avatar-section">
                    <div className="logo-avatar">
                        <img 
                            src={displayName ? avatarUrl : LogoIcon} 
                            alt="Logo Icon" 
                            className="logo-avatar-img"
                        />
                    </div>
                    {/* 用户名绝对定位到头像下方，不影响后续元素的上下间距 */}
                    <Text className="user-name-text">
                        {displayName}
                    </Text>
                </div>

                {/* 登录按钮：点击后触发 Guard 窗口 */}
                <Button
                    id="login-button"
                    className="login-button"
                    onClick={handleLogin} // <-- 绑定 Guard 登录流程
                >
                    {i18n('login_button')}
                </Button>

                <Text 
                    className="switch-account" 
                    onClick={forceOpenGuardLogin}>
                        {i18n('switch_account')}
                </Text>
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

