const { isMainThread, parentPort } = require('worker_threads');

function normalizeArg(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }
  return value;
}

function toMessage(value) {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(normalizeArg(value));
  } catch (_) {
    return String(value);
  }
}

function emit(level, scope, args) {
  const [first, ...rest] = args;
  const message = toMessage(first);
  const meta = rest.map(normalizeArg);

  if (!isMainThread && parentPort) {
    try {
      parentPort.postMessage({
        type: 'log',
        level,
        module: scope,
        message,
        meta
      });
    } catch (_) {
      // ignore worker log forwarding failures
    }
  }

  const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleMethod(...(args.length > 0 ? args : ['']));
}

function createLogger(scope) {
  const scoped = scope || 'LegacyUtil';
  return {
    isDev: process.env.NODE_ENV === 'development',
    log: (...args) => emit('info', scoped, args),
    info: (...args) => emit('info', scoped, args),
    warn: (...args) => emit('warn', scoped, args),
    error: (...args) => emit('error', scoped, args),
    debug: (...args) => emit('debug', scoped, args),
    silly: (...args) => emit('debug', scoped, args),
    withScope: (nextScope) => createLogger(nextScope),
    withContext: (nextScope) => createLogger(nextScope)
  };
}

const logger = createLogger('LegacyUtil');
logger.loggerService = logger;
logger.default = logger;

module.exports = logger;
