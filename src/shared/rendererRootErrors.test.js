// @vitest-environment jsdom
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createRendererRootErrorHandlers } from './rendererRootErrors';

it('records the component stack when a render failure unmounts the application', async () => {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  const logger = { error: vi.fn() };
  const host = document.createElement('div');
  const root = createRoot(host, createRendererRootErrorHandlers(logger));
  function BrokenPanel() {
    throw new Error('render failure');
  }
  try {
    // act() rethrows errors instead of invoking React's uncaught root callback.
    flushSync(() => root.render(React.createElement(React.StrictMode, null, React.createElement(BrokenPanel))));
    expect(logger.error).toHaveBeenCalledWith('[RendererRoot] uncaught', expect.objectContaining({
      message: 'render failure',
      stack: expect.stringContaining('render failure'),
      componentStack: expect.stringContaining('BrokenPanel'),
    }));
  } finally {
    flushSync(() => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

it('records caught and recoverable errors and does not propagate logging failures', () => {
  const logger = { error: vi.fn() };
  const handlers = createRendererRootErrorHandlers(logger);
  handlers.onCaughtError(new Error('caught'), { componentStack: 'Panel' });
  handlers.onRecoverableError('recoverable');
  expect(logger.error.mock.calls.map(([kind]) => kind)).toEqual([
    '[RendererRoot] caught', '[RendererRoot] recoverable',
  ]);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    logger.error.mockImplementation(() => { throw new Error('logger unavailable'); });
    expect(() => handlers.onUncaughtError(new Error('original'))).not.toThrow();
  } finally {
    consoleError.mockRestore();
  }
});
