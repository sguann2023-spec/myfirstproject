const { contextBridge, ipcRenderer } = require('electron');
const path = require('path'); // 在 Preload 脚本中使用 require 是安全的

// 暴露用于核心 IPC 通信的接口 (推荐)
contextBridge.exposeInMainWorld('ipc', {
    send: (channel, data) => ipcRenderer.send(channel, data),
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    on: (channel, func) => { /* ... 完整的 on 实现 ... */ }
});

// 暴露用于高级系统功能的接口 (例如你需要的打开文件夹)
contextBridge.exposeInMainWorld('shellAPI', { // ⚠️ 统一使用一个名字
    openFolder: (path) => ipcRenderer.send('app:open-folder', path) // 在 main.js 中处理
});

// 暴露一个安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
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
    }
});