import React, { useState, useEffect } from 'react';
import { Button, Typography, Input, message, Dropdown, Menu, Tooltip, Modal, Select, Spin } from 'antd';
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

const APP_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const REDUX_STORE_READY_CHANNEL = 'redux-store-ready';
let loginPreInitPromise = null;
let loginPreInitCachedError = '';

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

function extractAgentApiKeyFromClaims(claims = {}) {
    const namespaced = claims['https://open.vectcut.com/claims'] || claims['https://vectcut.com/claims'] || {};
    const appMetadata = claims.app_metadata || {};
    const userMetadata = claims.user_metadata || {};
    const candidates = [
        claims.vectcut_api_key,
        claims.vectcutApiKey,
        claims.agent_api_key,
        claims.agentApiKey,
        claims.api_key,
        claims.apiKey,
        namespaced.vectcut_api_key,
        namespaced.agent_api_key,
        namespaced.api_key,
        appMetadata.vectcut_api_key,
        appMetadata.agent_api_key,
        appMetadata.api_key,
        userMetadata.vectcut_api_key,
        userMetadata.agent_api_key,
        userMetadata.api_key
    ];
    const hit = candidates.find((item) => typeof item === 'string' && item.trim());
    return hit ? hit.trim() : '';
}

function normalizeCreationChannel(value) {
    const s = String(value || '').toLowerCase();
    if (!s) return '';
    if (s.includes('wechat') || s.includes('weixin') || s.includes('wx')) return 'wechat';
    if (s.includes('google') || s.includes('gmail')) return 'google';
    if (s.includes('phone') || s.includes('sms') || s.includes('mobile')) return 'phone';
    if (s.includes('email')) return 'email';
    if (s.includes('username')) return 'username';
    return s;
}

function inferCreationChannelFromClaims(claims = {}, accessToken = '') {
    const candidates = [];
    const identities = Array.isArray(claims.identities) ? claims.identities : [];
    identities.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        candidates.push(item.provider, item.connection, item.type, item.identityType, item.name);
    });

    candidates.push(
        claims.provider,
        claims.connection,
        claims.registerSource,
        claims.source,
        claims.loginSource
    );

    const amr = Array.isArray(claims.amr) ? claims.amr : [];
    candidates.push(...amr);

    const accessClaims = parseJwt(accessToken) || {};
    if (Array.isArray(accessClaims.amr)) {
        candidates.push(...accessClaims.amr);
    }
    candidates.push(
        accessClaims.provider,
        accessClaims.connection,
        accessClaims.registerSource,
        accessClaims.source,
        accessClaims.loginSource
    );

    for (const raw of candidates) {
        const normalized = normalizeCreationChannel(raw);
        if (['wechat', 'google', 'phone', 'email', 'username'].includes(normalized)) {
            return normalized;
        }
    }

    if (claims.phone_number || claims.phone || accessClaims.phone_number) return 'phone';
    if (claims.email || accessClaims.email) return 'email';

    return 'unknown';
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
const LoginPage = ({ onLogin, onPrepareHomeRuntime, trans, language, toggleLanguage }) => {
    const i18n = trans || ((key) => key.replace(/_/g, ' '));

    const [viewState, setViewState] = useState('login');
    const [isLoginPreInitLoading, setIsLoginPreInitLoading] = useState(true);
    const [loginPreInitError, setLoginPreInitError] = useState('');
    // 展示用的用户名（初始从持久化里读一次）
    const [displayName, setDisplayName] = useState(() => electronStore.get('user')?.name || '');
    // 展示的用户头像
    const [avatarUrl, setAvatarUrl] = useState(() => electronStore.get('user')?.avatar || '');

    // 根据平台决定按钮位置
    const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

    // **新增：处理设置按钮点击**
    const handleOpenSettings = () => {
        setViewState('settings');
    };

    // **新增：处理返回登录页**
    const handleBackToLogin = () => {
        setViewState('login');
    };

    useEffect(() => {
        let isMounted = true;

        const runLoginPreInit = async () => {
            setIsLoginPreInitLoading(true);
            setLoginPreInitError(loginPreInitCachedError);
            // await new Promise((resolve) => setTimeout(resolve, 10000));

            if (!loginPreInitPromise) {
                loginPreInitPromise = (async () => {
                    const ensureReduxStoreReady = async () => {
                        try {
                            if (!window.store || typeof window.store.getState !== 'function' || typeof window.store.dispatch !== 'function') {
                                window.store = {
                                    getState: () => ({ llm: { providers: [] } }),
                                    dispatch: () => undefined
                                };
                                logger.info('[LoginPage] Injected fallback window.store before redux-store-ready notify');
                            }
                            logger.info('[LoginPage] Notifying redux-store-ready from login pre-init...');
                            const result = await ipcRenderer.invoke(REDUX_STORE_READY_CHANNEL);
                            logger.info('[LoginPage] redux-store-ready notify acknowledged', { result });
                        } catch (error) {
                            logger.warn('[LoginPage] Failed to notify redux store ready from login pre-init', error);
                        }
                    };

                    const initializeAgentServicesWithRetry = async () => {
                        const maxAttempts = 3;
                        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                            try {
                                await ipcRenderer.invoke('app:initialize-agent-services');
                                return;
                            } catch (error) {
                                const messageText = String(error?.message || '');
                                const isStoreNotReady = messageText.includes('Timeout waiting for Redux store to be ready');
                                if (!isStoreNotReady || attempt === maxAttempts) {
                                    throw error;
                                }
                                const delayMs = attempt * 1500;
                                logger.warn(`[LoginPage] Agent services init retry ${attempt}/${maxAttempts} after ${delayMs}ms`, error);
                                await new Promise((resolve) => setTimeout(resolve, delayMs));
                            }
                        }
                    };

                    try {
                        await ipcRenderer.invoke('app:initialize-login-services');
                        await ipcRenderer.invoke('app:register-extended-ipc');
                        await ensureReduxStoreReady();
                        if (typeof onPrepareHomeRuntime === 'function') {
                            await onPrepareHomeRuntime();
                        }
                        await initializeAgentServicesWithRetry();
                        await ipcRenderer.invoke('app:bootstrap-builtin-skills');
                        loginPreInitCachedError = '';
                    } catch (error) {
                        logger.error('login pre-init failed:', error);
                        loginPreInitCachedError = error?.message || 'login pre-init failed';
                    }
                })();
            }

            await loginPreInitPromise;

            if (!isMounted) return;

            if (loginPreInitCachedError) {
                setLoginPreInitError(loginPreInitCachedError);
                message.warning('Login pre-initialization failed, login is still available.');
            } else {
                setLoginPreInitError('');
            }
            setIsLoginPreInitLoading(false);
        };

        runLoginPreInit();

        return () => {
            isMounted = false;
        };
    }, [onPrepareHomeRuntime]);
    
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
        if (isLoginPreInitLoading) {
            message.info('App is still initializing, please wait...');
            return;
        }
        try {
            // 如果已经有 refresh_token，优先静默刷新/校验
            const accessToken = await tokenStore.ensureValidAccessToken();
            if (accessToken) {
                const idToken = tokenStore.idToken;
                if (idToken) {
                    const claims = parseJwt(idToken) || {};
                    const name = claims.name || claims.preferred_username || claims.nickname || claims.email || '';
                    const agentApiKey = extractAgentApiKeyFromClaims(claims);
                    const creationChannel = inferCreationChannelFromClaims(claims, accessToken);
                    electronStore.set('user', {
                        id: claims.sub,
                        name,
                        email: claims.email,
                        avatar: claims.picture || claims.avatar || claims.photo || null,
                        agentApiKey: agentApiKey || null
                    });
                    if (agentApiKey) {
                        electronStore.set('auth.vectcut_api_key', agentApiKey);
                    } else {
                        electronStore.delete('auth.vectcut_api_key');
                    }
                    setAvatarUrl(claims.picture || claims.avatar || claims.photo || null);
                    setDisplayName(name);

                    // 新增：登录成功后写库（静默登录）
                    addUser({
                        id: claims.sub,
                        name,
                        avatar: claims.picture || claims.avatar || claims.photo || null,
                        creation_channel: creationChannel
                    });

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
                const agentApiKey = extractAgentApiKeyFromClaims(claims);
                const creationChannel = inferCreationChannelFromClaims(claims, access_token);
                electronStore.set('user', {
                    id: claims.sub,
                    name: name,
                    email: claims.email,
                    avatar: claims.picture || claims.avatar || claims.photo || null,
                    agentApiKey: agentApiKey || null
                });
                if (agentApiKey) {
                    electronStore.set('auth.vectcut_api_key', agentApiKey);
                } else {
                    electronStore.delete('auth.vectcut_api_key');
                }
                // 更新到本地状态以驱动 UI
                setAvatarUrl(claims.picture || claims.avatar || claims.photo || null);
                setDisplayName(name);

                // 新增：登录成功后写库（静默登录）
                addUser({
                    id: claims.sub,
                    name,
                    avatar: claims.picture || claims.avatar || claims.photo || null,
                    creation_channel: creationChannel
                });

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
        if (isLoginPreInitLoading) {
            message.info('App is still initializing, please wait...');
            return;
        }
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

                {isLoginPreInitLoading ? (
                    <div style={{ marginTop: 90, textAlign: 'center' }}>
                        <Spin size="medium" />
                    </div>
                ) : (
                    <>
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
                )}

                {loginPreInitError ? (
                    <Text style={{ display: 'block', marginTop: 8, color: '#FF4D4F' }}>
                        {loginPreInitError}
                    </Text>
                ) : null}
            </>
        );
    };

    return (
        <div 
            style={{ 
                height: '100%', 
                fontFamily: APP_FONT_FAMILY,
            }}
        >
        {/* 顶部可拖拽区域 */}
        <div 
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '30px',
                WebkitAppRegion: 'drag',
                zIndex: 10,
            }}
        />
        {/* 顶部设置按钮：Windows 左上角，非 Windows 右上角 */}
        <div
            className="top-right-controls"
            style={{
                position: 'absolute',
                top: 0,
                left: isWindows ? 5 : undefined,
                right: isWindows ? undefined : 5,
                zIndex: 20,
                WebkitAppRegion: 'no-drag'
            }}
        >
            <Button
                icon={<SettingOutlined style={{ fontSize: '14px' }} />}
                type="text"
                className="control-button"
                onClick={() => viewState === 'settings' ? handleBackToLogin() : handleOpenSettings()}
                style={{
                    color: 'rgba(0, 0, 0)'
                }}
            />
        </div>

        {renderView()}
    </div>
    );
};

// 导出组件
export default LoginPage;
