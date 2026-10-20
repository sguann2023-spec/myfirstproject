export function createRendererRootErrorHandlers(logger) {
  const report = (kind) => (error, info) => {
    try {
      logger.error(`[RendererRoot] ${kind}`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error?.stack || '',
        componentStack: info?.componentStack || '',
      });
    } catch (loggingError) {
      console.error('[RendererRoot] Error reporting failed', loggingError, error);
    }
  };
  // React 19 reports render failures through root callbacks, including caught errors.
  return {
    onUncaughtError: report('uncaught'),
    onCaughtError: report('caught'),
    onRecoverableError: report('recoverable'),
  };
}
