const toArray = (args) => (Array.isArray(args) ? args : [args]);

const sendToMain = (level, args) => {
  try {
    const ipcRenderer = window?.require?.('electron')?.ipcRenderer;
    if (ipcRenderer) {
      ipcRenderer.send('log-message', {
        level,
        messages: toArray(args).map((item) => {
          if (item instanceof Error) {
            return JSON.stringify({
              name: item.name,
              message: item.message,
              stack: item.stack,
            });
          }
          if (typeof item === 'string') return item;
          try {
            return JSON.stringify(item);
          } catch {
            return String(item);
          }
        }),
      });
    }
  } catch {
    // ignore ipc failures in renderer
  }
};

const createLogger = (scope = '') => {
  const prefix = scope ? `[${scope}]` : '';
  const wrap = (method, level) => (...args) => {
    const finalArgs = prefix ? [prefix, ...args] : args;
    sendToMain(level, finalArgs);
    method(...finalArgs);
  };
  return {
    isDev: true,
    log: wrap(console.log, 'info'),
    info: wrap(console.info, 'info'),
    warn: wrap(console.warn, 'warn'),
    error: wrap(console.error, 'error'),
    debug: wrap(console.debug, 'debug'),
    silly: wrap(console.debug, 'debug'),
    withScope: (nextScope) => createLogger(nextScope),
    withContext: (nextScope) => createLogger(nextScope),
    normalizeError: (err) => err,
    getLogFilePath: () => null,
    uploadLogs: async () => ({ ok: false, status: 0 }),
  };
};

const logger = createLogger();
export default logger;
export const loggerService = logger;

