const { app, BrowserWindow, protocol, ipcMain, dialog, shell } = require('electron');
const { Worker } = require('worker_threads');


// 定义常量
const DEFAULT_HOST = 'https://open.capcutapi.top/cut_jianying';
const path = require('path');
const url = require('url');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const axios = require('axios');
const crypto = require('crypto'); // 添加crypto模块

// 添加 i18next 相关依赖
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');

// 初始化 i18next
let i18n;

function initI18n() {
    const isDev = process.env.NODE_ENV === 'development';
    const localesPath = isDev 
      ? path.join(__dirname, 'locales') 
      : path.join(process.resourcesPath, 'locales');
    
    i18n = i18next.use(Backend).init({
    backend: {
      loadPath: path.join(localesPath, '{{lng}}/{{ns}}.json')
    },
      fallbackLng: 'en',
      debug: isDev,
      interpolation: {
        escapeValue: false
      }
    });

    return i18n;
}

// 在应用启动时初始化 i18n
app.whenReady().then(() => {
  initI18n();
  createWindow();
});

const isDev = process.env.NODE_ENV === 'development';
// 添加electron-reload以支持热重载（仅在开发环境中）
if (process.env.NODE_ENV === 'development') {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
    hardResetMethod: 'exit'
  });
}

// 读取package.json获取版本号
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const appVersion = packageJson.version;

// 生成version_code (每段版本号占3位)
function generateVersionCode(version) {
  const parts = version.split('.');
  let versionCode = 0;
  
  for (let i = 0; i < parts.length; i++) {
    versionCode = versionCode * 1000 + parseInt(parts[i]);
  }
  
  return versionCode;
}

const versionCode = generateVersionCode(appVersion);
console.log(`App Version: ${appVersion}, Version Code: ${versionCode}`);

// 保持对window对象的全局引用，如果不这么做的话，当JavaScript对象被
// 垃圾回收的时候，window对象将会自动的关闭
let mainWindow;

// 配置自动更新
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

// 配置正确的更新包文件名格式
autoUpdater.configOnLoad = true;
autoUpdater.setFeedURL({
  provider: 'generic',
  url: 'https://gh-proxy.com/https://api.github.com/repos/sun-guannan/CapCutMaker/releases',
  updaterCacheDirName: 'capcutmaker-updater'
});

// 为Mac指定使用zip格式
if (process.platform === 'darwin') {
  autoUpdater.forceDevUpdateConfig = true;
}

// 自动更新事件监听
autoUpdater.on('checking-for-update', () => {
  sendStatusToWindow('正在检查更新...');
});

autoUpdater.on('update-available', (info) => {
  sendStatusToWindow('发现新版本，正在下载...');
});

autoUpdater.on('update-not-available', (info) => {
  sendStatusToWindow('当前已是最新版本');
});

autoUpdater.on('error', (err) => {
  sendStatusToWindow('更新出错: ' + err.toString());
});

autoUpdater.on('download-progress', (progressObj) => {
  let logMessage = `下载速度: ${progressObj.bytesPerSecond} - 已下载 ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
  sendStatusToWindow(logMessage);
});

autoUpdater.on('update-downloaded', (info) => {
  sendStatusToWindow('更新已下载，将在退出时安装');
  // 询问用户是否立即重启应用
  dialog.showMessageBox({
    type: 'info',
    title: '应用更新',
    message: '发现新版本，已下载完成',
    detail: '是否现在重启应用并安装更新？',
    buttons: ['是', '否']
  }).then((returnValue) => {
    if (returnValue.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

// 发送更新消息到渲染进程
function sendStatusToWindow(text) {
  console.log(text);
  if (mainWindow) {
    mainWindow.webContents.send('update-message', text);
  }
}

// 添加检查更新的IPC监听器
ipcMain.on('check-for-updates', () => {
  autoUpdater.checkForUpdates();
});

// 添加重启并安装更新的IPC监听器
ipcMain.on('restart-and-update', () => {
  autoUpdater.quitAndInstall();
});

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, 'src/logo.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js'), // 引入 preload 脚本路径
      webSecurity: false, // 允许加载本地资源
      allowRunningInsecureContent: true, // 允许运行不安全内容
      additionalArguments: [`--app-version=${appVersion}`, `--version-code=${versionCode}`]
    },
    autoHideMenuBar: true
  });
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    // 在开发模式下，webpack --watch 会将文件输出到 dist 目录
    mainWindow.loadFile('dist/index.html');
  } else {
    // 生产环境，加载dist目录下的index.html
    mainWindow.loadFile('dist/index.html');
  }

  // // 打开开发者工具
  // if (isDev) {
  //   mainWindow.webContents.openDevTools();
  // }

  // 当window被关闭，这个事件会被触发
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
  
  // 检查更新
  autoUpdater.checkForUpdatesAndNotify();
  
  // 处理冷启动时的协议URL
  const args = process.argv;
  const protocolUrl = args.find(arg => arg.startsWith('capcutmaker://'));
  if (protocolUrl && mainWindow.webContents) {
    console.log('Cold start protocol URL:', protocolUrl);
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('protocol-url', protocolUrl);
    });
  }
}

// 注册自定义协议
app.whenReady().then(() => {
  protocol.registerFileProtocol('capcutmaker', (request, callback) => {
    const url = request.url.substr('capcutmaker://'.length);
    try {
      return callback(decodeURIComponent(url));
    } catch (error) {
      console.error('Failed to register protocol', error);
    }
  });
});

// 处理协议启动
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 当运行第二个实例时，将会聚焦到mainWindow这个窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      
      // 处理协议URL
      const url = commandLine.pop();
      if (url.startsWith('capcutmaker://')) {
        // 在这里处理URL参数
        console.log('Protocol URL:', url);
        // 可以将URL参数发送到渲染进程
        if (mainWindow.webContents) {
          mainWindow.webContents.send('protocol-url', url);
        }
      }
    }
  });

  // Electron 完成初始化并准备创建浏览器窗口时调用此方法
  // app.whenReady().then(createWindow);

  // 协议处理 - macOS
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url.startsWith('capcutmaker://')) {
      console.log('Protocol URL (macOS):', url);
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('protocol-url', url);
      }
    }
  });

  // 当全部窗口关闭时退出
  app.on('window-all-closed', function () {
    // 在 macOS 上，除非用户用 Cmd + Q 确定地退出，
    // 否则绝大部分应用及其菜单栏会保持激活
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', function () {
    // 在macOS上，当单击dock图标并且没有其他窗口打开时，
    // 通常在应用程序中重新创建一个窗口
    if (!mainWindow) {
        // createWindow();
    } else {
        mainWindow.focus();
    }
});
}

// 在macOS上，需要在app.setAsDefaultProtocolClient之前调用这个
app.setAsDefaultProtocolClient('capcutmaker');

// 添加IPC监听器来处理从渲染进程发送的参数
// 在文件顶部添加 electron-store 引入
const Store = require('electron-store');
const store = new Store();

// store.clear()

// 添加保存设置的IPC监听器
ipcMain.on('save-settings', (event, settings) => {
  console.log('保存设置:', settings);
  if (settings.draftFolder) {
    store.set('draftFolder', settings.draftFolder);
  }
  if (settings.isCapcut !== undefined) {
    store.set('isCapcut', settings.isCapcut);
  }
  if (settings.apiKey !== undefined) {
    store.set('apiKey', settings.apiKey);
  }
  if (settings.apiHost !== undefined) {
    store.set('apiHost', settings.apiHost);
  }
});

// 修改获取设置的IPC处理函数
ipcMain.handle('get-draft-folder', () => {
  const draftFolder = store.get('draftFolder', ''); // 默认为空字符串
  const isCapcut = store.get('isCapcut', true); // 默认为true
  const apiKey = store.get('apiKey', ''); // 默认为空字符串
  const apiHost = store.get('apiHost', DEFAULT_HOST); // 默认API Host
  
  return {
    draftFolder: draftFolder,
    isCapcut: isCapcut,
    apiKey: apiKey,
    apiHost: apiHost
  };
});

ipcMain.on('process-parameters', async (event, params) => {
  console.log('从渲染进程接收到参数:', params);
  // 获取draft_id、draft_folder和is_capcut参数
  const { draft_id, draft_folder, is_capcut, api_key_hash } = params;
  console.log('api_key_hash:', api_key_hash);
  
  if (!draft_id) {
    // 启动前检查错误：发送 download-error
    event.reply('download-error', i18next.t('missing_draft_id'));
    return;
  }
  
  try {
    // 设置环境变量（如果需要）
    global.IS_CAPCUT_ENV = is_capcut === '1';
    
    // 生成任务ID
    const taskId = `task_${Date.now()}`;
    
    // 设置草稿文件夹路径，如果提供了新路径则保存到 store 中
    if (draft_folder) {
      store.set('draftFolder', draft_folder);
    }
    
    // 从 store 中获取保存的路径，如果没有则使用默认路径
    const draftFolder = store.get('draftFolder') || path.join(__dirname, 'drafts');
    const apiKey = store.get('apiKey', '');
    const apiHost = store.get('apiHost', DEFAULT_HOST);
    
    // 确保草稿文件夹存在
    if (!fs.existsSync(draftFolder)) {
      fs.mkdirSync(draftFolder, { recursive: true });
    }
    
    // 通知下载进程任务已开始
    event.reply('process-result', { 
      success: true, 
      message: i18next.t('start_processing', { draft_id, task_id: taskId })
    });
    
    // 创建进度回调函数
    const progressCallback = (progress, message, fileList) => {
      // 只需要发送 progress 和 message
      event.reply('download-progress', {
        progress: progress,
        text: message,
        fileList: fileList,
      });
    };
    
    // 计算当前API密钥的哈希值
    const currentApiKeyHash = hashApiKey(apiKey);

    console.log('currentApiKeyHash:', currentApiKeyHash);
    
    // 创建工作线程来处理下载任务
    const worker = new Worker(path.join(__dirname, 'util/downloadWorker.js'), {
      workerData: {
        draft_id,
        draftFolder,
        taskId,
        is_capcut,
        apiKey,
        apiHost
      }
    });
    
    // 监听工作线程的消息
    worker.on('message', (message) => {
      if (message.type === 'progress') {
        // 更新进度 (使用修正后的 progressCallback，它会发送 download-progress)
        progressCallback(message.progress, message.message, message.fileList);
      } else if (message.type === 'complete') {
        // 下载完成：发送 download-complete
        event.reply('download-complete', {
          draft_id: draft_id, // 确保发送 draft_id
          message: message.message || i18next.t('download_complete')
        });
      } else if (message.type === 'error') {
        console.log('worker message error'); // 保持日志，观察是否执行
        // 下载失败：发送 download-error
        event.reply('download-error', message.error || i18next.t('download_failed'));
      }
    });
    
    // 监听工作线程错误
    worker.on('error', (error) => {
      console.error('工作线程错误:', error);
      // 只发送 download-error
      event.reply('download-error', error.message || i18next.t('worker_error'));
    });
    
    // 监听工作线程退出
    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`工作线程以退出码 ${code} 退出`);
      }
    });
    
  } catch (error) {
    console.error('处理草稿时出错:', error);
    // 发送详细错误信息
    event.reply('download-error', error.message || 'Unknown error');
  }
});

// 确保翻译文件在打包后可用
if (app.isPackaged) {
  process.env.LOCALES_PATH = path.join(process.resourcesPath, 'locales');
} else {
  process.env.LOCALES_PATH = path.join(__dirname, 'locales');
}

// 添加 IPC 处理程序来获取翻译
ipcMain.handle('get-translation', (event, key) => {
  return i18next.t(key);
});

// 1. 处理打开文件夹的请求 (保持不变)
ipcMain.on('open-download-directory', (event, directoryPath) => {
    console.log(`[Main Process] Received request to open folder: ${directoryPath}`);
    // 1. 验证路径是否有效
    if (!directoryPath || typeof directoryPath !== 'string') {
        console.error('[Main Process] Invalid folder path received.');
        return;
    }
    
    // 2. 尝试创建目录，如果已存在则不会报错 (recursive: true)
    try {
        fs.mkdirSync(directoryPath, { recursive: true });
        console.log(`[Main Process] Directory ensured: ${directoryPath}`);
    } catch (err) {
        console.error(`[Main Process] Failed to create or access directory: ${directoryPath}`, err);
        // 如果创建失败，停止执行
        return;
    }
    // 使用 Electron 的 shell 模块打开系统文件管理器
    shell.openPath(directoryPath)
        .catch(err => {
            console.error('无法打开目录:', err);
            // 使用您现有的 dialog 模块来显示错误
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: '打开目录失败',
                message: `无法打开目录: ${directoryPath}`,
                detail: err.toString()
            });
        });
});

/**
 * 监听 'check-file-existence'，检查文件是否存在
 * - 接收: { id: number, expectedPath: string }
 * - 成功时发送: 'file-found' (id)
 */
ipcMain.on('check-file-existence', (event, { id, expectedPath }) => { // 移除 async 关键字，因为我们不再 await
    console.log(`[Main] Checking file existence for ID: ${id} at path: ${expectedPath}`);
    
    // 核心修复：使用同步的 fs.existsSync() 代替回调/Promise 混用的 fs.access()
    // 用户的代码使用的是 require('fs')，所以 fs.existsSync 是最安全和直接的检查方法
    const fileExists = fs.existsSync(expectedPath);
        
    if (fileExists) {
        // 如果文件存在
        console.log(`[Main] File found for ID: ${id}. Sending 'file-found'.`);
        
        // 通知渲染进程文件已找到
        event.sender.send('file-found', { id });
    } else {
        // 如果文件不存在
        console.warn(`[Main] File not found at ${expectedPath}.`);
        // 只有文件找到时才发送消息，失败时忽略即可
    }
});

// 计算API密钥的SHA-256哈希值
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}