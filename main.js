const { app, BrowserWindow, protocol, ipcMain, dialog, shell, screen } = require('electron');
const { Worker } = require('worker_threads');


// 定义常量
const DEFAULT_HOST = 'https://open.vectcut.com/cut_jianying';
const path = require('path');
const url = require('url');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const PROXY_PREFIX = 'https://gh-proxy.com/';
const axios = require('axios');

const Store = require('electron-store');
const logger = require('./src/shared/logger');
// const store = new Store();
global.__ELECTRON_STORE__ = global.__ELECTRON_STORE__ || new Store({ name: 'vectcut', watch: true });
const electronStore = global.__ELECTRON_STORE__;

try {
  process.env.TS_NODE_PROJECT = process.env.TS_NODE_PROJECT || path.join(__dirname, 'tsconfig.json');
  process.env.TS_NODE_TRANSPILE_ONLY = process.env.TS_NODE_TRANSPILE_ONLY || '1';
  require('ts-node/register/transpile-only');
  require('tsconfig-paths/register');
} catch (error) {
  logger.warn('[Main] TS bridge not available (ts-node/tsconfig-paths)', {
    error: error?.message || String(error),
  });
}

const agentsService = {
  registerSessionStreamIpc: null,
  bootstrapBuiltinAgents: null,
  installBuiltinSkills: null,
  initialized: false,
};

function loadTsModule(modulePath) {
  return Promise.resolve().then(() => require(modulePath));
}

function syncMainWindowToWindowService(win) {
  try {
    const mod = require('./src/main/services/WindowService.ts');
    const windowService = mod?.windowService;
    if (windowService && typeof windowService.attachMainWindow === 'function') {
      windowService.attachMainWindow(win || null);
    }
  } catch (error) {
    logger.warn('[Main] sync windowService mainWindow failed', {
      error: error?.message || String(error)
    });
  }
}

async function initializeAgentServices() {
  if (agentsService.initialized) return;
  logger.info('[Main][trace] initializeAgentServices start');

  try {
    require('./src/main/config.ts');
    logger.info('[Main] config.ts preloaded');
  } catch (error) {
    logger.warn('[Main] config.ts preload failed', {
      error: error?.message || String(error),
    });
  }

  try {
    const { bootstrapBuiltinAgents } = await loadTsModule('./src/main/services/agents/services/builtin/BuiltinAgentBootstrap.ts');
    agentsService.bootstrapBuiltinAgents = bootstrapBuiltinAgents;
  } catch (error) {
    logger.warn('[Main] bootstrapBuiltinAgents not available', {
      error: error?.message || String(error),
    });
  }

  // Fallback path: if built-in agent bootstrap cannot be loaded,
  // still seed built-in skills so Skill list is not empty.
  if (typeof agentsService.bootstrapBuiltinAgents !== 'function') {
    try {
      const { installBuiltinSkills } = await loadTsModule('./src/main/utils/builtinSkills.ts');
      agentsService.installBuiltinSkills = installBuiltinSkills;
    } catch (error) {
      logger.warn('[Main] installBuiltinSkills fallback not available', {
        error: error?.message || String(error),
      });
    }
  }

  if (typeof agentsService.bootstrapBuiltinAgents === 'function') {
    try {
      await agentsService.bootstrapBuiltinAgents();
      logger.info('[Main] agentsService bootstrapped (new API)');
    } catch (error) {
      logger.warn('[Main] agentsService init failed', {
        error: error?.message || String(error),
      });
    }
  }

  if (typeof agentsService.installBuiltinSkills === 'function') {
    try {
      await agentsService.installBuiltinSkills();
      logger.info('[Main] builtin skills seeded via fallback');
    } catch (error) {
      logger.warn('[Main] installBuiltinSkills fallback failed', {
        error: error?.message || String(error),
      });
    }
  }

  try {
    const { registerSessionStreamIpc } = await loadTsModule('./src/main/services/agents/services/channels/sessionStreamIpc.ts');
    agentsService.registerSessionStreamIpc = registerSessionStreamIpc;
    logger.info('[Main][trace] registerSessionStreamIpc module loaded');
  } catch (error) {
    logger.warn('[Main] registerSessionStreamIpc not available', {
      error: error?.message || String(error),
    });
  }

  if (typeof agentsService.registerSessionStreamIpc === 'function') {
    try {
      logger.info('[Main][trace] registerSessionStreamIpc invoke');
      agentsService.registerSessionStreamIpc();
      logger.info('[Main] session stream IPC registered');
    } catch (error) {
      logger.warn('[Main] registerSessionStreamIpc failed', {
        error: error?.message || String(error),
      });
    }
  }

  agentsService.initialized = true;
  logger.info('[Main][trace] initializeAgentServices done', {
    hasBootstrapBuiltinAgents: typeof agentsService.bootstrapBuiltinAgents === 'function',
    hasInstallBuiltinSkillsFallback: typeof agentsService.installBuiltinSkills === 'function',
    hasRegisterSessionStreamIpc: typeof agentsService.registerSessionStreamIpc === 'function'
  });
}

let cachedSkillService = null;
let skillServiceLoadingPromise = null;

async function getSkillService() {
  if (cachedSkillService) return cachedSkillService;
  if (skillServiceLoadingPromise) return skillServiceLoadingPromise;

  skillServiceLoadingPromise = (async () => {
    try {
      const mod = require('./src/main/services/agents/skills/SkillService.ts');
      cachedSkillService = mod?.skillService || null;
      return cachedSkillService;
    } catch (error) {
      logger.warn('[Main] skillService load failed', {
        error: error?.message || String(error),
      });
      return null;
    } finally {
      skillServiceLoadingPromise = null;
    }
  })();

  return skillServiceLoadingPromise;
}

// 添加 i18next 相关依赖
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');

process.on('unhandledRejection', (reason) => {
  try {
    logger.error('[Main] unhandledRejection', {
      message: reason?.message || String(reason || ''),
      stack: reason?.stack || '',
    });
  } catch {}
});

process.on('uncaughtException', (error) => {
  try {
    logger.error('[Main] uncaughtException', {
      message: error?.message || String(error || ''),
      stack: error?.stack || '',
    });
  } catch {}
});

// 初始化 i18next
let i18n;
let i18nInitPromise = null;
let updaterInitialized = false;
let codeToolsInitPromise = null;
let extendedIpcRegisterPromise = null;

let authWindow = null;

const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

let pendingProtocolUrl = null;
function forwardProtocolUrl(url) {
  try {
    if (!url || !/^vectcut:\/\//.test(url)) return;
    pendingProtocolUrl = url;
    if (mainWindow && mainWindow.webContents) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('protocol-url', url);
      pendingProtocolUrl = null;
    }
  } catch (e) { logger.warn('forwardProtocolUrl failed', e); }
}

function initI18n() {
    syncMainWindowToWindowService(mainWindow);
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

function ensureI18nInitialized() {
  if (!i18nInitPromise) {
    i18nInitPromise = Promise.resolve(initI18n()).catch((error) => {
      i18nInitPromise = null;
      throw error;
    });
  }
  return i18nInitPromise;
}

function ensureUpdaterInitialized() {
  if (updaterInitialized) return;
  setupUpdater();
  updaterInitialized = true;
}

async function ensureCodeToolsInitialized() {
  if (!codeToolsInitPromise) {
    codeToolsInitPromise = (async () => {
      try {
        const mod = await loadTsModule('./src/main/services/CodeToolsService.ts');
        const codeToolsService = mod?.codeToolsService;
        if (codeToolsService && typeof codeToolsService.initialize === 'function') {
          await codeToolsService.initialize();
        }
      } catch (error) {
        logger.warn('[Main] CodeToolsService initialize failed', {
          error: error?.message || String(error),
        });
      }
    })();
  }
  return codeToolsInitPromise;
}

async function ensureExtendedIpcRegistered() {
  if (!extendedIpcRegisterPromise) {
    extendedIpcRegisterPromise = (async () => {
      const { registerIpc } = await loadTsModule('./src/main/ipc.ts');
      if (typeof registerIpc !== 'function') {
        throw new Error('registerIpc export missing');
      }
      if (!mainWindow || mainWindow.isDestroyed()) {
        throw new Error('mainWindow unavailable');
      }
      await registerIpc(mainWindow, app);
      logger.info('[Main] extended registerIpc wired from src/main/ipc.ts');
    })().catch((error) => {
      extendedIpcRegisterPromise = null;
      throw error;
    });
  }

  return extendedIpcRegisterPromise;
}

// 在应用启动时初始化 i18n，并在启动前尝试切换到已缓存的新版本
app.whenReady().then(async () => {
  await ensureI18nInitialized();
  try {
    const staged = electronStore.get('stagedUpdate');
    const curVer = app.getVersion();
    if (staged && staged.appPath && staged.version && staged.version !== curVer) {
      logger.info('[updater] launching staged app', staged.version, staged.appPath);
      try {
        const cp = require('child_process');
        if (process.platform === 'darwin') {
          try { cp.spawn('xattr', ['-dr','com.apple.quarantine', staged.appPath]); } catch {}
          cp.spawn('open', [staged.appPath], { detached: true });
        } else if (process.platform === 'win32') {
          const proc = cp.spawn(staged.appPath, [], { detached: true, stdio: 'ignore' });
          try { proc.unref(); } catch {}
        } else {
          cp.spawn(staged.appPath, [], { detached: true, stdio: 'ignore' });
        }
        electronStore.delete('stagedUpdate');
        app.quit();
        return;
      } catch (e) {
        logger.error('[updater] launch staged failed', e.message);
      }
    }
  } catch (e) {
    logger.error('[updater] staged check failed', e.message);
  }
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
logger.info(`App Version: ${appVersion}, Version Code: ${versionCode}`);

try {
  ipcMain.handle('app:register-extended-ipc', async () => {
    await ensureExtendedIpcRegistered();
    return { success: true };
  });

  ipcMain.handle('app:initialize-login-services', async () => {
    await ensureI18nInitialized();
    ensureUpdaterInitialized();
    await ensureCodeToolsInitialized();
    // Preload ReduxService so `redux-store-ready` handler is registered
    // before renderer pre-init invokes this channel.
    await loadTsModule('./src/main/services/ReduxService.ts');
    return { success: true };
  });

  ipcMain.handle('app:initialize-agent-services', async () => {
    await initializeAgentServices();
    return { success: true };
  });
} catch (error) {
  logger.warn('[Main] skill IPC handlers registration failed', {
    error: error?.message || String(error),
  });
}

// 保持对window对象的全局引用，如果不这么做的话，当JavaScript对象被
// 垃圾回收的时候，window对象将会自动的关闭
let mainWindow;

function setupUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  const electronLog = require('electron-log');
  try { electronLog.transports.file.level = 'debug'; } catch {}
  autoUpdater.logger = electronLog;
  logger.info('[updater] currentVersion', app.getVersion());

  const feedUrl = 'https://player.install-ai-guider.top/client/latest'; 
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl, channel: 'latest' });
    const indexFile = process.platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
    logger.info('[updater] feed URL set', feedUrl, 'index:', `${feedUrl}/${indexFile}`);
    logger.info('[updater] expected assets root', `${feedUrl}/`);
  } catch (e) {
    logger.error('[updater] setFeedURL failed', e.message);
  }

  const stageDir = path.join(app.getPath('userData'), 'updates');
  try { fs.mkdirSync(stageDir, { recursive: true }); } catch {}
  async function extractZip(zipPath, extractPath) {
    if (process.platform === 'darwin') {
      await new Promise((resolve, reject) => {
        const p = require('child_process').spawn('ditto', ['-x','-k', zipPath, extractPath]);
        p.on('error', reject);
        p.on('exit', code => code === 0 ? resolve() : reject(new Error(`ditto exit ${code}`)));
      });
      return;
    }
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractPath, true);
  }
  async function stageUpdate(info) {
    try {
      const ver = info && info.version ? info.version : '';
      const base = /\/$/.test(feedUrl) ? feedUrl : (feedUrl + '/');
      const files = Array.isArray(info?.files) ? info.files : [];
      const preferExt = process.platform === 'win32' ? '.exe' : '.zip';
      const pick = files.find(f => ((f?.url || f?.path || '').toLowerCase()).endsWith(preferExt))
        || files.find(f => ((f?.url || f?.path || '').toLowerCase()).endsWith('.zip'))
        || files[0];
      const candidate = pick || {};
      const candidatePath = candidate.url || candidate.path || '';
      const fileUrl = /^https?:\/\//.test(candidatePath) ? candidatePath : (base + candidatePath);
      const ext = path.extname(candidatePath || '').toLowerCase();
      if (!fileUrl) { logger.warn('[updater] no file url'); return; }
      logger.info('[updater] stage url', fileUrl, 'ext', ext);
      const targetPath = path.join(stageDir, ext === '.exe' ? `installer-${ver}.exe` : `update-${ver}.zip`);
      const resp = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });
      const total = parseInt(resp.headers['content-length'] || '0', 10);
      let received = 0; let lastTs = 0; let lastPct = -1;
      const writer = fs.createWriteStream(targetPath);
      await new Promise((resolve, reject) => {
        resp.data.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            const now = Date.now();
            if (pct !== lastPct && (now - lastTs) > 500) {
              lastPct = pct; lastTs = now;
              logger.info('[updater] stage download', `${pct}%`, `${(received/1048576).toFixed(1)}MB/${(total/1048576).toFixed(1)}MB`);
              sendStatusToWindow(`[updater] stage download ${pct}%`);
            }
          } else {
            const now = Date.now();
            if ((now - lastTs) > 1000) { lastTs = now; logger.info('[updater] stage downloaded', `${(received/1048576).toFixed(1)}MB`); }
          }
        });
        resp.data.on('error', reject);
        writer.on('error', reject);
        writer.on('finish', resolve);
        resp.data.pipe(writer);
      });
      if (process.platform === 'win32' && ext === '.exe') {
        electronStore.set('stagedUpdate', { version: ver, appPath: targetPath });
        logger.info('[updater] staged installer at', targetPath);
        return;
      }
      const extractPath = path.join(stageDir, `app-${ver}`);
      try { fs.rmSync(extractPath, { recursive: true, force: true }); } catch {}
      await extractZip(targetPath, extractPath);
      let appPath;
      try {
        const items = fs.readdirSync(extractPath);
        const appDir = items.find(n => n.endsWith('.app'));
        appPath = appDir ? path.join(extractPath, appDir) : path.join(extractPath, `${app.getName()}.app`);
      } catch (_) {
        appPath = path.join(extractPath, `${app.getName()}.app`);
      }
      if (!fs.existsSync(appPath)) { logger.error('[updater] staged app not found', appPath); return; }
      try { require('child_process').spawn('xattr', ['-dr','com.apple.quarantine', appPath]); } catch {}
      const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
      if (!fs.existsSync(asarPath)) { logger.error('[updater] staged app missing app.asar', asarPath); }
      electronStore.set('stagedUpdate', { version: ver, appPath });
      logger.info('[updater] staged at', appPath);
    } catch (e) {
      logger.error('[updater] stage failed', e.message);
    }
  }

  autoUpdater.on('checking-for-update', () => logger.info('[updater] checking-for-update'));
  autoUpdater.on('update-available', (info) => { logger.info('[updater] update-available', info?.version || ''); stageUpdate(info); });
  autoUpdater.on('update-not-available', (info) => logger.info('[updater] no updates', info ? (info.version || '') : ''));
  autoUpdater.on('error', (err) => logger.error('[updater] error', err?.message || ''));

  autoUpdater.checkForUpdates().catch((e) => logger.error('[updater] check failed', e.message));
}

// 发送更新消息到渲染进程
function sendStatusToWindow(text) {
  logger.info(text);
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

const savedLanguage = electronStore.get('language') || 'zh';

function normalizeLanguageForMain(language) {
  const raw = String(language || '').trim();
  const lower = raw.toLowerCase();
  const map = {
    en: 'en-US',
    'en-us': 'en-US',
    zh: 'zh-CN',
    'zh-cn': 'zh-CN',
    'zh-hans': 'zh-CN',
    'zh-tw': 'zh-TW',
    'zh-hk': 'zh-TW',
    'zh-hant': 'zh-TW',
    de: 'de-DE',
    'de-de': 'de-DE',
    el: 'el-GR',
    'el-gr': 'el-GR',
    es: 'es-ES',
    'es-es': 'es-ES',
    fr: 'fr-FR',
    'fr-fr': 'fr-FR',
    ja: 'ja-JP',
    'ja-jp': 'ja-JP',
    pt: 'pt-PT',
    'pt-pt': 'pt-PT',
    ro: 'ro-RO',
    'ro-ro': 'ro-RO',
    ru: 'ru-RU',
    'ru-ru': 'ru-RU',
    vi: 'vi-VN',
    'vi-vn': 'vi-VN'
  };

  if (map[lower]) return map[lower];
  const languageCode = lower.split('-')[0];
  return map[languageCode] || 'en-US';
}

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 320,
    height: 450,
    icon: path.join(__dirname, 'src/logo.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'src/preload.js'), // 引入 preload 脚本路径
      webSecurity: false, // 允许加载本地资源
      allowRunningInsecureContent: true, // 允许运行不安全内容
      additionalArguments: [`--app-version=${appVersion}`, `--version-code=${versionCode}`]
    },
    autoHideMenuBar: true,
    frame: false, // 移除系统边框
    // 登录窗口统一关闭透明，避免首屏渲染前出现黑屏/空白体感
    transparent: false,
    titleBarStyle: 'hidden',
    // 修改：Windows 关闭系统覆盖层，改用自定义控件
    titleBarOverlay: isWindows ? false : true,
    trafficLightPosition: { x: 12, y: 10 },
    // 新增：显式开启窗口能力（frameless/transparent 下在 Windows 有时会失效）
    minimizable: true,
    maximizable: true,
    resizable: true
  });
  syncMainWindowToWindowService(mainWindow);
  const isDev = process.env.NODE_ENV === 'development';


  if (isDev) {
    mainWindow.loadFile('dist/index.html');
  } else {
    mainWindow.loadFile('dist/index.html');
  }

  // // 打开开发者工具
  // if (isDev) {
    // mainWindow.webContents.openDevTools();
  // }

  // 当window被关闭，这个事件会被触发
  mainWindow.on('closed', function () {
    syncMainWindowToWindowService(null);
    mainWindow = null;
  });
  
  // 处理冷启动时的协议URL
  const args = process.argv;
  const protocolUrl = args.find(arg => arg.startsWith('vectcut://'));
  if (protocolUrl) {
    logger.info('Cold start protocol URL:', protocolUrl);
    forwardProtocolUrl(protocolUrl);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.once('did-finish-load', () => {
        if (pendingProtocolUrl) {
          mainWindow.webContents.send('protocol-url', pendingProtocolUrl);
          pendingProtocolUrl = null;
        }
      });
    }
  } else if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (pendingProtocolUrl) {
        mainWindow.webContents.send('protocol-url', pendingProtocolUrl);
        pendingProtocolUrl = null;
      }
    });
  }
}

// 注册自定义协议
app.whenReady().then(() => {
  protocol.registerFileProtocol('vectcut', (request, callback) => {
    const url = request.url.substr('vectcut://'.length);
    try {
      return callback(decodeURIComponent(url));
    } catch (error) {
      logger.error('Failed to register protocol', error);
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
      
      const url = commandLine.pop();
      if (url && url.startsWith('vectcut://')) {
        logger.info('Protocol URL:', url);
        forwardProtocolUrl(url);
      }
    }
  });

  // Electron 完成初始化并准备创建浏览器窗口时调用此方法
  // app.whenReady().then(createWindow);

  // 协议处理 - macOS
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url && url.startsWith('vectcut://')) {
      logger.info('Protocol URL (macOS):', url);
      forwardProtocolUrl(url);
    }
  });

  // 当全部窗口关闭时退出
  app.on('window-all-closed', function () {
    // 在 macOS 上，除非用户用 Cmd + Q 确定地退出，
    // 否则绝大部分应用及其菜单栏会保持激活
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', function () {
    // 在 macOS 上，点击 Dock 图标时如果没有可用窗口则重建主窗口
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 在macOS上，需要在app.setAsDefaultProtocolClient之前调用这个
app.setAsDefaultProtocolClient('vectcut');

// 添加IPC监听器来处理从渲染进程发送的参数

// electronStore.clear()

// 添加 IPC 监听器来处理登录成功
ipcMain.on('login-success', () => {
    logger.info('Login successful. Loading main application...');
    // 若未设置草稿目录，自动打开设置页
    const draftFolder = electronStore.get('draftFolder', '');
    logger.info('draftFolder:', draftFolder);
    if (!draftFolder) {
      // 新用户先进入引导页
      openGuiderWindow();
    }
});

ipcMain.on('guider-finished', () => {
  try {
    if (guiderWindow && !guiderWindow.isDestroyed()) {
      guiderWindow.close();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('guider-finished');
      mainWindow.setSize(960, 640, true);
      mainWindow.center();
    }
  } catch (e) {
    logger.warn('[Main] guider-finished failed:', e);
  }
});

ipcMain.on('close-window', () => mainWindow.close());
ipcMain.on('minimize-window', () => mainWindow.minimize());
ipcMain.on('maximize-window', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

// 添加保存设置的IPC监听器
ipcMain.on('save-settings', (event, settings) => {
  logger.info('保存设置:', settings);
  const updated = {};
  if (settings.draftFolder) {
    electronStore.set('draftFolder', settings.draftFolder);
    updated.draftFolder = settings.draftFolder;
  }
  if (settings.isCapcut !== undefined) {
    electronStore.set('isCapcut', settings.isCapcut);
    updated.isCapcut = settings.isCapcut;
  }
  if (settings.apiHost !== undefined) {
    electronStore.set('apiHost', settings.apiHost);
    updated.apiHost = settings.apiHost;
  }
  if (settings.language !== undefined) {
    electronStore.set('language', settings.language);
    updated.language = settings.language;
    try {
      const { configManager } = require('./src/main/services/ConfigManager.ts');
      const normalizedLanguage = normalizeLanguageForMain(settings.language);
      configManager.setLanguage(normalizedLanguage);
      logger.info('[Main] synced language to configManager', {
        rawLanguage: settings.language,
        normalizedLanguage
      });
    } catch (error) {
      logger.warn('[Main] failed to sync language to configManager', {
        error: error?.message || String(error)
      });
    }
  }
  // 广播设置更新，确保其他窗口（主窗口/下载页）实时联动
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('settings-updated', updated);
  });
});

// 修改获取设置的IPC处理函数
ipcMain.handle('get-draft-folder', () => {
  const draftFolder = electronStore.get('draftFolder', ''); // 默认为空字符串
  const isCapcut = electronStore.get('isCapcut', true); // 默认为true
  const apiHost = electronStore.get('apiHost', DEFAULT_HOST); // 默认API Host
  
  return {
    draftFolder: draftFolder,
    isCapcut: isCapcut,
    apiHost: apiHost
  };
});

ipcMain.on('process-parameters', async (event, params) => {
  const { draft_id, draft_folder, is_capcut, script, draft_name } = params;
  
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
      electronStore.set('draftFolder', draft_folder);
    }
    
    // 从 store 中获取保存的路径，如果没有则使用默认路径
    const draftFolder = electronStore.get('draftFolder') || path.join(__dirname, 'drafts');
    const apiHost = electronStore.get('apiHost', DEFAULT_HOST);
    
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
    let lastFileList = null;
    const progressCallback = (progress, message, fileList) => {
      // 缓存最新的文件列表（仅当传入时）
      if (Array.isArray(fileList)) {
        lastFileList = fileList;
      }
      event.reply('download-progress', {
        progress: progress,
        text: message,
        fileList: fileList,
      });
    };
    
    logger.info('send workders')
    // 创建工作线程来处理下载任务
    const worker = new Worker(path.join(__dirname, 'util/downloadWorker.js'), {
      workerData: {
        draft_id,
        draft_name,
        draftFolder,
        taskId,
        is_capcut,
        apiHost,
        script
      }
    });
    
    // 监听工作线程的消息
    worker.on('message', async (message) => {
      if (message.type === 'artist-effect-url-request') {
        const { effectId, reqId } = message;

        const responseHandler = (e, payload) => {
          if (!payload || payload.reqId !== reqId) return;
          ipcMain.removeListener('resolve-artist-effect-url-response', responseHandler);

          if (payload.error) {
            worker.postMessage({ type: 'artist-effect-url-response', reqId, error: payload.error });
          } else {
            worker.postMessage({ type: 'artist-effect-url-response', reqId, url: payload.url });
          }
        };

        ipcMain.on('resolve-artist-effect-url-response', responseHandler);
        mainWindow.webContents.send('resolve-artist-effect-url', { effectId, reqId });
        return;
      }
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
        logger.info('worker message error:', message.error);

        // 下载失败：发送 download-error
        // 错误时携带最后的文件列表（包含失败项）
        event.reply('download-error', {
          error: message.error || i18next.t('download_failed'),
          fileList: lastFileList || [],
        });
      }
    });
    
    // 监听工作线程错误
    worker.on('error', (error) => {
      logger.error('工作线程错误:', error);
      // 只发送 download-error
      event.reply('download-error', error.message || i18next.t('worker_error'));
    });
    
    // 监听工作线程退出
    worker.on('exit', (code) => {
      if (code !== 0) {
        logger.error(`工作线程以退出码 ${code} 退出`);
      }
    });
    
  } catch (error) {
    logger.error('处理草稿时出错:', error);
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

const registerIpcHandle = (channel, handler) => {
  try {
    ipcMain.removeHandler(channel);
  } catch (error) {
    logger.warn(`[Main] removeHandler failed for ${channel}`, error);
  }
  ipcMain.handle(channel, handler);
};

const getLegacyFileStorageDir = () => path.join(app.getPath('userData'), 'files');

// 1. 处理打开文件夹的请求 (保持不变)
ipcMain.on('open-download-directory', (event, directoryPath) => {
    logger.info(`[Main Process] Received request to open folder: ${directoryPath}`);
    // 1. 验证路径是否有效
    if (!directoryPath || typeof directoryPath !== 'string') {
        logger.error('[Main Process] Invalid folder path received.');
        return;
    }
    
    // 2. 尝试创建目录，如果已存在则不会报错 (recursive: true)
    try {
        fs.mkdirSync(directoryPath, { recursive: true });
        logger.info(`[Main Process] Directory ensured: ${directoryPath}`);
    } catch (err) {
        logger.error(`[Main Process] Failed to create or access directory: ${directoryPath}`, err);
        // 如果创建失败，停止执行
        return;
    }
    // 使用 Electron 的 shell 模块打开系统文件管理器
    shell.openPath(directoryPath)
        .catch(err => {
            logger.error('无法打开目录:', err);
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
    logger.info(`[Main] Checking file existence for ID: ${id} at path: ${expectedPath}`);
    
    // 核心修复：使用同步的 fs.existsSync() 代替回调/Promise 混用的 fs.access()
    // 用户的代码使用的是 require('fs')，所以 fs.existsSync 是最安全和直接的检查方法
    const fileExists = fs.existsSync(expectedPath);
        
    if (fileExists) {
        // 如果文件存在
        logger.info(`[Main] File found for ID: ${id}. Sending 'file-found'.`);
        
        // 通知渲染进程文件已找到
        event.sender.send('file-found', { id });
    } else {
        // 如果文件不存在
        logger.warn(`[Main] File not found at ${expectedPath}.`);
        // 只有文件找到时才发送消息，失败时忽略即可
    }
});


function safeCloseAuthWindow() {
  const win = authWindow;
  if (!win) return;
  try {
    if (!win.isDestroyed()) win.close();
  } catch (e) {
    logger.warn('[Main] safeCloseAuthWindow close error:', e);
  } finally {
    authWindow = null;
  }
}

/**
 * 监听渲染进程请求打开一个独立的子窗口并加载 URL。
 * 此窗口用于加载 Authing Guard 登录页面。
 */
ipcMain.on('open-auth-guard-window', (event, authUrl) => {
    // 1. 关闭任何旧的登录窗口
    if (authWindow) {
      safeCloseAuthWindow()
    }

    // 2. 创建子窗口
    authWindow = new BrowserWindow({
        width: 420,
        height: 550,
        show: false,
        parent: mainWindow, // 设为主窗口的子窗口
        modal: false,
        resizable: false,
        frame: true, // 用户可以自己关闭
        titleBarStyle: 'hidden', // 显式设置为 'default' 或 'hiddenInset' (更美观)
        titleBarOverlay: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            javascript: true,         // 显式允许 JS
            nativeWindowOpen: true,   // 允许 Google 弹窗/重定向
        }
    });

    // 关键：设定现代 Chrome UA，避免被判为嵌入式/不支持
    const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    authWindow.webContents.setUserAgent(chromeUA);

    // 放行 window.open
    authWindow.webContents.setWindowOpenHandler(() => ({ action: 'allow' }));

    authWindow.on('closed', () => {
        const refreshToken = electronStore.get('auth.refresh_token');
        logger.info('[Main] AuthWindow closed. storage refresh_token:', refreshToken);
        safeCloseAuthWindow()
    });

    // 3. 监听导航事件，捕获 Guard 登录成功后的回调 URI
    // Guard 登录成功后会重定向到您配置的回调 URL。
    authWindow.webContents.on('will-redirect', (event, url) => {
        const AUTHING_REDIRECT_URI = 'https://localhost/authing-guard-callback'; // 必须与 Guard 配置一致
        logger.info('[Main] will-redirect:', url);

        const urlObj = new URL(url);
        const EXPECTED_HOSTNAME = 'localhost';
        const EXPECTED_PATHNAME = '/authing-guard-callback';

        logger.info(urlObj.hostname, urlObj.pathname)

        if (urlObj.hostname === EXPECTED_HOSTNAME && urlObj.pathname === EXPECTED_PATHNAME) {
            logger.info('[Main] Auth Guard callback URL:', url);
            event.preventDefault();
            
            // 捕获授权码 Code (或 token/error)
            const urlObj = new URL(url);
            const code = urlObj.searchParams.get('code');
            
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (code) {
                    logger.info('[Main] Auth Code:', code);
                    mainWindow.webContents.send('guard-auth-code', code);
                } else if (urlObj.searchParams.has('error')) {
                    mainWindow.webContents.send('guard-auth-error', urlObj.searchParams.get('error'));
                }
            }

            if (authWindow && !authWindow.isDestroyed()) {
                safeCloseAuthWindow()
            }

            // if (code) {
            //     // 将 code 发送回主窗口的渲染进程
            //     mainWindow.webContents.send('guard-auth-code', code);
            // } else if (urlObj.searchParams.has('error')) {
            //     mainWindow.webContents.send('guard-auth-error', urlObj.searchParams.get('error'));
            // }

            // // 关闭登录窗口
            // authWindow.close();
            // authWindow = null;
        }
    });

    // 4. 加载 Authing 授权 URL
    // 使用 UA 发起加载
    authWindow.loadURL(authUrl, { userAgent: chromeUA });
    authWindow.show();
});


ipcMain.on('resize-main-window', (event, { width, height }) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const w = Number(width);
      const h = Number(height);
      mainWindow.setSize(w, h);
      mainWindow.center();
    }
  } catch (e) {
    logger.warn('[Main] resize-main-window failed:', e);
  }
});

let settingsWindow = null;
let guiderWindow = null;

// 抽取为函数，便于在登录成功时复用
function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus(); // 如果窗口已存在，则聚焦
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 840,
    height: 730,
    autoHideMenuBar: true,
    frame: false, // 移除系统边框
    transparent: isWindows ? false : true, // Windows 关闭透明，避免最大化失效
    titleBarStyle: 'hidden', 
    
    // 可选：自定义 macOS 交通灯按钮的位置 (相对于窗口左上角)
    trafficLightPosition: { x: 12, y: 10 }, 
    // Windows 关闭系统覆盖按钮，改用自定义控件
    titleBarOverlay: isWindows ? false : true,
    webPreferences: {
      // Guider/Settings 窗口不需要 preload，用最简单配置防止 contextBridge 报错
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      additionalArguments: [`--app-version=${appVersion}`, `--version-code=${versionCode}`]
    }
  });

  // 加载设置页面的 URL
  settingsWindow.loadFile('dist/settings.html', { search: '?view=settings' });
  // settingsWindow.webContents.openDevTools();

  // 当窗口关闭时，清空引用并根据是否已设置草稿目录决定是否回到登录页
  settingsWindow.on('closed', () => {
    settingsWindow = null;

    const draftFolder = electronStore.get('draftFolder', '');
    if (!draftFolder && mainWindow && !mainWindow.isDestroyed()) {
      // 回到登录页（缩回小窗口）
      mainWindow.loadFile('dist/index.html');
      mainWindow.setSize(320, 450, true);
      mainWindow.center();
    }
  });
}

function openGuiderWindow() {
  if (guiderWindow) {
    guiderWindow.focus();
    return;
  }
  const guiderWindowHeight = 600;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }

  guiderWindow = new BrowserWindow({
    width: 960,
    height: guiderWindowHeight,
    autoHideMenuBar: true,
    frame: false,
    transparent: isWindows ? false : true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    titleBarOverlay: isWindows ? false : true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      additionalArguments: [`--app-version=${appVersion}`, `--version-code=${versionCode}`]
    }
  });

  guiderWindow.loadFile('dist/settings.html', { search: '?view=guider' });
  guiderWindow.on('closed', () => {
    guiderWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      const draftFolder = electronStore.get('draftFolder', '');
      if (!draftFolder) {
        mainWindow.setSize(320, 450, true);
        mainWindow.center();
      }
    }
  });
}

ipcMain.on('open-settings-window', () => {
  openSettingsWindow();
});


// 新增：选择草稿保存目录
ipcMain.handle('select-draft-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  });
  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('upload-logs', async (event, { url, meta }) => {
    try {
        const result = await logger.uploadLogs(url, meta);
        return { ok: true, result };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});
// 在现有 ipcMain 监听附近添加
ipcMain.on('log-message', (event, { level, messages }) => {
  try {
    if (level === 'error') logger.error(...messages);
    else if (level === 'warn') logger.warn(...messages);
    else if (level === 'debug') logger.debug(...messages);
    else logger.info(...messages);
  } catch (e) {
    // 兜底：不影响业务
  }
});

// 新增：窗口控制 IPC（全部窗口通用）
ipcMain.on('window-controls', (event, action) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  // 新增：Windows 下兜底确保能力开启
  if (isWindows) {
    try {
      win.setMinimizable(true);
      win.setMaximizable(true);
      win.setResizable(true);
    } catch (e) { /* ignore */ }
  }
  if (action === 'minimize') {
    win.minimize();
  } else if (action === 'maximize') {
    win.isMaximized() ? win.unmaximize() : win.maximize();
  } else if (action === 'close') {
    win.close();
  }
});
