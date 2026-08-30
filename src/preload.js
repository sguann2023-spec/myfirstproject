const { contextBridge, ipcRenderer } = require('electron');
const path = require('path'); // 在 Preload 脚本中使用 require 是安全的

const AGENT_CHANNELS = Object.freeze({
    SessionCreate: 'agent:session:create',
    SessionGet: 'agent:session:get',
    SessionList: 'agent:session:list',
    SessionMessageCreate: 'agent:session:message:create',
    SessionMessageList: 'agent:session:message:list',
    SessionAbort: 'agent-session-stream:abort',
    SessionStreamSubscribe: 'agent-session-stream:subscribe',
    SessionStreamUnsubscribe: 'agent-session-stream:unsubscribe',
    SessionStreamChunk: 'agent-session-stream:chunk',
    SessionChanged: 'agent-session:changed',
    ToolPermissionRequest: 'agent-tool-permission:request',
    ToolPermissionResponse: 'agent-tool-permission:response',
    ToolPermissionResult: 'agent-tool-permission:result',
    SkillList: 'skill:list',
    SkillToggle: 'skill:toggle',
    SkillInstallFromDirectory: 'skill:install-from-directory',
    SkillUninstall: 'skill:uninstall',
    SkillRescan: 'skill:list',
    SkillListActive: 'skill:list-active',
    SkillRun: 'agent:skills:run'
});

const CHERRY_CHAT_CHANNELS = Object.freeze({
    SessionCreate: 'cherry-chat-stream:session:create',
    SessionGet: 'cherry-chat-stream:session:get',
    SessionUpdate: 'cherry-chat-stream:session:update',
    SessionList: 'cherry-chat-stream:session:list',
    SessionMessageCreate: 'cherry-chat-stream:message:create',
    SessionMessageList: 'cherry-chat-stream:message:list',
    SessionAbort: 'cherry-chat-stream:abort',
    SessionStreamSubscribe: 'cherry-chat-stream:subscribe',
    SessionStreamUnsubscribe: 'cherry-chat-stream:unsubscribe',
    SessionStreamChunk: 'cherry-chat-stream:chunk',
    ToolPermissionRequest: 'agent-tool-permission:request',
    ToolPermissionResponse: 'agent-tool-permission:response',
    ToolPermissionResult: 'agent-tool-permission:result'
});

const createAgentSessionBridge = (channels, { hasSubscription = true } = {}) => ({
    createSession: (payload) => ipcRenderer.invoke(channels.SessionCreate, payload),
    getSession: (sessionId) => ipcRenderer.invoke(channels.SessionGet, { sessionId }),
    updateSession: (payload) => ipcRenderer.invoke(channels.SessionUpdate, payload),
    listSessions: (payload = {}) => ipcRenderer.invoke(channels.SessionList, payload),
    listMessages: (sessionId) => ipcRenderer.invoke(channels.SessionMessageList, { sessionId }),
    createMessage: ({ sessionId, content, ...extraPayload } = {}) =>
        ipcRenderer.invoke(channels.SessionMessageCreate, {
            sessionId,
            content,
            ...extraPayload,
        }),
    subscribe: (sessionId) => (
        hasSubscription
            ? ipcRenderer.invoke(channels.SessionStreamSubscribe, { sessionId })
            : Promise.resolve({ ok: true })
    ),
    unsubscribe: (sessionId) => (
        hasSubscription
            ? ipcRenderer.invoke(channels.SessionStreamUnsubscribe, { sessionId })
            : Promise.resolve({ ok: true })
    ),
    abort: (sessionId) => ipcRenderer.invoke(channels.SessionAbort, { sessionId }),
    onChunk: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on(channels.SessionStreamChunk, listener);
        return () => ipcRenderer.off(channels.SessionStreamChunk, listener);
    },
    onPermissionRequest: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on(channels.ToolPermissionRequest, listener);
        return () => ipcRenderer.off(channels.ToolPermissionRequest, listener);
    },
    onPermissionResult: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on(channels.ToolPermissionResult, listener);
        return () => ipcRenderer.off(channels.ToolPermissionResult, listener);
    }
});

const createAgentSessionStreamApi = (channels, options) => ({
    ...createAgentSessionBridge(channels, options),
    onSessionChanged: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on(channels.SessionChanged, listener);
        return () => ipcRenderer.off(channels.SessionChanged, listener);
    }
});

const fileBridge = {
    read: (fileId, detectEncoding) => ipcRenderer.invoke('file:read', fileId, detectEncoding),
    readExternal: (filePath, detectEncoding) => ipcRenderer.invoke('file:readExternal', filePath, detectEncoding),
    writeWithId: (id, content) => ipcRenderer.invoke('file:writeWithId', id, content)
};

// 暴露用于核心 IPC 通信的接口 (推荐)
const ipcBridge = {
    send: (channel, data) => ipcRenderer.send(channel, data),
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    on: (channel, func) => { /* ... 完整的 on 实现 ... */ }
};

// 暴露用于高级系统功能的接口 (例如你需要的打开文件夹)
const shellBridge = { // ⚠️ 统一使用一个名字
    openFolder: (path) => ipcRenderer.send('app:open-folder', path) // 在 main.js 中处理
};

// 暴露一个安全的 API 给渲染进程
const electronBridge = {
    // 用于打开下载目录
    openDownloadDirectory: (directoryPath) => ipcRenderer.send('open-download-directory', directoryPath),
    // 用于启动文件监控
    startFileMonitor: (monitorData) => ipcRenderer.send('start-file-monitor', monitorData),
    // 监听文件找到事件
    onFileFound: (callback) => ipcRenderer.on('file-found', (event, value) => callback(value)),
    // 移除监听器（可选，但推荐）
    removeFileFoundListener: (callback) => ipcRenderer.removeListener('file-found', callback),
    // 用于检查文件是否存在
    checkFileExistence: (fileInfo) => ipcRenderer.invoke('check-file-existence', fileInfo),

    // 【新增】安全地暴露 path.join，以避免渲染进程中 require('path') 报错。
    path: {
        join: (...args) => {
             // 在 preload 进程中安全地执行 Node.js path.join
             return path.join(...args);
        }
    },
    // 默认入口统一走现有 agents IPC。
    agentSessionStream: createAgentSessionStreamApi(AGENT_CHANNELS, { hasSubscription: true }),
    // Cherry Studio chat bridge for HomePage (still powered by main-process session service)
    cherryChatStream: createAgentSessionBridge(CHERRY_CHAT_CHANNELS, { hasSubscription: true }),
    // 兼容旧调用名，避免 chat.js 无感切换失败。
    agentSessionStreamV1: createAgentSessionStreamApi(AGENT_CHANNELS, { hasSubscription: true }),
    agentSessionStreamV2: createAgentSessionStreamApi(AGENT_CHANNELS, { hasSubscription: true }),
    agentTools: {
        respondToPermission: (payload) => ipcRenderer.invoke(AGENT_CHANNELS.ToolPermissionResponse, payload)
    },
    agentSkills: {
        list: async ({ agentId = 'vectcut_claw_default' } = {}) => {
            const result = await ipcRenderer.invoke(AGENT_CHANNELS.SkillList, agentId);
            const skills = Array.isArray(result?.data) ? result.data : [];
            return { ok: Boolean(result?.success), skills };
        },
        listActive: async ({ agentId = 'vectcut_claw_default' } = {}) => {
            const result = await ipcRenderer.invoke(AGENT_CHANNELS.SkillListActive, agentId);
            const skills = Array.isArray(result?.data) ? result.data : [];
            return { ok: Boolean(result?.success), skills };
        },
        toggle: ({ agentId = 'vectcut_claw_default', skillId, isEnabled } = {}) =>
            ipcRenderer.invoke(AGENT_CHANNELS.SkillToggle, { agentId, skillId, isEnabled }),
        installFromDirectory: ({ agentId = 'vectcut_claw_default', directoryPath, isEnabled = true } = {}) =>
            ipcRenderer.invoke(AGENT_CHANNELS.SkillInstallFromDirectory, { agentId, directoryPath, isEnabled }),
        copyDirectoryToWorkspace: ({ agentId = 'vectcut_claw_default', directoryPath, workspace, sourceSubdir, targetRelativePath, excludeSubdirs } = {}) =>
            ipcRenderer.invoke('skill:copy-directory-to-workspace', { agentId, directoryPath, workspace, sourceSubdir, targetRelativePath, excludeSubdirs }),
        uninstall: ({ skillId } = {}) => ipcRenderer.invoke(AGENT_CHANNELS.SkillUninstall, skillId),
        seedWorkspace: async ({ workspace } = {}) => {
            const result = await ipcRenderer.invoke('skill:seed-workspace', workspace);
            return { ok: Boolean(result?.success), error: result?.error };
        },
        runExample: async ({ skillPath } = {}) => {
            const result = await ipcRenderer.invoke('skill:run-example', { skillPath });
            return {
                ok: Boolean(result?.success),
                error: result?.error,
                stdout: result?.data?.stdout,
                stderr: result?.data?.stderr
            };
        },
        rescan: async ({ agentId = 'vectcut_claw_default' } = {}) => {
            const result = await ipcRenderer.invoke(AGENT_CHANNELS.SkillRescan, agentId);
            const skills = Array.isArray(result?.data) ? result.data : [];
            return { ok: Boolean(result?.success), skills };
        },
        run: ({ skillName, args = [], envVars = {} }) =>
            ipcRenderer.invoke(AGENT_CHANNELS.SkillRun, { skillName, args, envVars })
    }
};

const apiBridge = {
    setTheme: (theme) => ipcRenderer.invoke('app:set-theme', theme),
    file: fileBridge,
    agentSessionStream: createAgentSessionStreamApi(AGENT_CHANNELS, { hasSubscription: true }),
    agentTools: electronBridge.agentTools
};

// 兼容 electron-toolkit 风格: window.electron.ipcRenderer
// 注意: on/once 返回清理函数，匹配渲染层既有调用约定
const ipcRendererBridge = {
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, listener) => {
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    },
    once: (channel, listener) => {
        ipcRenderer.once(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    },
    off: (channel, listener) => ipcRenderer.off(channel, listener),
    removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
};

const electronCompatBridge = {
    ipcRenderer: ipcRendererBridge
};

const exposeBridge = () => {
    try {
        if (process.contextIsolated) {
            contextBridge.exposeInMainWorld('ipc', ipcBridge);
            contextBridge.exposeInMainWorld('shellAPI', shellBridge);
            contextBridge.exposeInMainWorld('electronAPI', electronBridge);
            contextBridge.exposeInMainWorld('electron', electronCompatBridge);
            contextBridge.exposeInMainWorld('api', apiBridge);
            console.info('[preload] bridge exposed by contextBridge (contextIsolated=true)');
        } else {
            // 兼容当前项目 contextIsolation=false 的窗口配置
            window.ipc = ipcBridge;
            window.shellAPI = shellBridge;
            window.electronAPI = electronBridge;
            window.electron = electronCompatBridge;
            window.api = apiBridge;
            console.info('[preload] bridge attached to window (contextIsolated=false)');
        }
    } catch (error) {
        console.error('[preload] expose bridge failed:', error);
    }
};

exposeBridge();
