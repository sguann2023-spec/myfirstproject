const log = require('electron-log');

let isDev = false;
try {
    const { app } = require('electron');
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
        log.transports.file.fileName = 'capcut-helper.log';
        log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
    }
}

// 尽量避免直接打印大对象，统一做轻量字符串化
function formatArgs(args) {
    return args.map((a) => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
    });
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

// 新增：上传日志到后台（读取文件末尾 limitBytes，POST JSON）
async function uploadLogs(url, meta = {}, limitBytes = 512 * 1024) {
    const fs = require('fs');
    const path = getLogFilePath();
    if (!path) throw new Error('No log file path available.');
    const stat = fs.statSync(path);

    let content;
    if (stat.size > limitBytes) {
        const fd = fs.openSync(path, 'r');
        try {
            const buf = Buffer.alloc(limitBytes);
            fs.readSync(fd, buf, 0, limitBytes, stat.size - limitBytes);
            content = buf.toString('utf8');
        } finally {
            fs.closeSync(fd);
        }
    } else {
        content = fs.readFileSync(path, 'utf8');
    }

    const payload = {
        meta,
        fileName: require('path').basename(path),
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
        getLogFilePath,
        uploadLogs,
      };
    })();