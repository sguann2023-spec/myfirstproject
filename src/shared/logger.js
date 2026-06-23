const log = require('electron-log');

let isDev = false;
let electronApp = null;
try {
    const { app } = require('electron');
    electronApp = app || null;
    // Electron 主进程最可靠的判断：是否打包
    isDev = app ? !app.isPackaged : false;
} catch (e) {
    // 渲染/Worker或取不到 app 时的兜底判断
    isDev = process.env.NODE_ENV === 'development' || process.defaultApp === true;
}

// 关键：区分主进程与渲染进程
const isBrowser = process && process.type === 'browser';

// 环境下的输出策略（增加存在性判断）
if (isDev) {
    if (log.transports && log.transports.console) {
        log.transports.console.level = 'info';
    }
    // dev 渲染端不写文件；主进程可关闭文件或保留
    if (isBrowser && log.transports && log.transports.file) {
        log.transports.file.level = false;
    }
} else {
    if (log.transports && log.transports.console) {
        log.transports.console.level = false;
    }
    // 仅主进程配置文件输出，渲染进程跳过
    if (isBrowser && log.transports && log.transports.file) {
        log.transports.file.level = 'info';
        log.transports.file.fileName = 'vectcut.log';
        log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
    }
}

// 启动时打印运行环境关键信息，便于排查实际读写目录
try {
    const runtimeInfo = {
        isDev,
        processType: process && process.type ? process.type : 'unknown',
        cwd: process && process.cwd ? process.cwd() : null,
        userData: electronApp && electronApp.getPath ? electronApp.getPath('userData') : null,
        appPath: electronApp && electronApp.getAppPath ? electronApp.getAppPath() : null,
    };
    log.info('[logger-bootstrap]', runtimeInfo);
    console.info('[logger-bootstrap]', runtimeInfo);
} catch (e) {
    // ignore bootstrap logging errors
}

// 尽量避免直接打印大对象，统一做轻量字符串化
function normalizeError(err) {
    if (!err) return null;
    if (typeof err === 'string') return { message: err };
    if (err instanceof Error) {
        return {
            name: err.name,
            message: err.message,
            stack: err.stack,
        };
    }
    return err;
}

function formatOne(a) {
    if (typeof a === 'string') return a;
    if (a instanceof Error) {
        return JSON.stringify(normalizeError(a));
    }
    try { return JSON.stringify(a); } catch { return String(a); }
}

function formatArgs(args) {
    return args.map(formatOne);
}

function createScopedLogger(scope, target) {
    const scopeText = String(scope || '').trim();
    const prefix = scopeText ? `[${scopeText}]` : '';
    const wrap = (method) => (...args) => {
        if (prefix) return method(prefix, ...args);
        return method(...args);
    };
    return {
        isDev: target.isDev,
        log: wrap(target.log),
        info: wrap(target.info),
        warn: wrap(target.warn),
        error: wrap(target.error),
        debug: wrap(target.debug),
        silly: wrap(target.silly || target.debug),
    };
}

// 新增：获取日志文件路径（用于上传或展示给用户）
function getLogFilePath() {
    try {
        if (!log.transports || !log.transports.file || !log.transports.file.getFile) return null;
        const file = log.transports.file.getFile();
        return file && file.path ? file.path : null;
    } catch {
        return null;
    }
}

function getFileBaseName(filePath) {
    const normalizedPath = String(filePath || '');
    if (!normalizedPath) return '';
    const segments = normalizedPath.split(/[\\/]/);
    return segments[segments.length - 1] || normalizedPath;
}

// 新增：上传日志到后台（读取文件末尾 limitBytes，POST JSON）
async function uploadLogs(url, meta = {}, limitBytes = 512 * 1024) {
    const fs = require('fs');
    const logFilePath = getLogFilePath();
    if (!logFilePath) throw new Error('No log file path available.');
    const stat = fs.statSync(logFilePath);

    let content;
    if (stat.size > limitBytes) {
        const fd = fs.openSync(logFilePath, 'r');
        try {
            const buf = Buffer.alloc(limitBytes);
            fs.readSync(fd, buf, 0, limitBytes, stat.size - limitBytes);
            content = buf.toString('utf8');
        } finally {
            fs.closeSync(fd);
        }
    } else {
        content = fs.readFileSync(logFilePath, 'utf8');
    }

    const payload = {
        meta,
        fileName: getFileBaseName(logFilePath),
        size: stat.size,
        content,
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    return { ok: res.ok, status: res.status };
}

module.exports = isBrowser
  ? {
      isDev,
      log: (...args) => log.info(...formatArgs(args)),
      info: (...args) => log.info(...formatArgs(args)),
      warn: (...args) => log.warn(...formatArgs(args)),
      error: (...args) => log.error(...formatArgs(args)),
      debug: (...args) => log.debug(...formatArgs(args)),
      silly: (...args) => log.debug(...formatArgs(args)),
      normalizeError,
      withScope: (scope) => createScopedLogger(scope, module.exports),
      getLogFilePath,
      uploadLogs,
    }
  : (() => {
      let ipcRenderer;
      try { ipcRenderer = window.require('electron').ipcRenderer; } catch (e) { ipcRenderer = null; }
      const send = (level, args) => {
        const messages = formatArgs(args);
        if (ipcRenderer) ipcRenderer.send('log-message', { level, messages });
        // 渲染端也打印到控制台
        if (level === 'error') console.error(...messages);
        else if (level === 'warn') console.warn(...messages);
        else if (level === 'debug') console.debug(...messages);
        else console.log(...messages);
      };
      return {
        isDev,
        log: (...args) => send('info', args),
        info: (...args) => send('info', args),
        warn: (...args) => send('warn', args),
        error: (...args) => send('error', args),
        debug: (...args) => send('debug', args),
        silly: (...args) => send('debug', args),
        normalizeError,
        withScope: (scope) => createScopedLogger(scope, module.exports),
        getLogFilePath,
        uploadLogs,
      };
    })();

// Compatibility shim for TS modules importing:
//   import { loggerService } from '@logger'
// and expecting loggerService.withContext(...)
const exportedLogger = module.exports;
if (typeof exportedLogger.withContext !== 'function' && typeof exportedLogger.withScope === 'function') {
  exportedLogger.withContext = exportedLogger.withScope;
}
if (!exportedLogger.loggerService) {
  exportedLogger.loggerService = exportedLogger;
}
if (!('default' in exportedLogger)) {
  exportedLogger.default = exportedLogger;
}
