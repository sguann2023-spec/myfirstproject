import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ImageTimelineBoundary from './ImageTimelineBoundary';

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('../../renderer/src/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: logError }) }
}));

it('预览错误不会卸载聊天界面，记录堆栈并支持恢复', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  let failed = true;
  function Preview() {
    if (failed) throw new Error('timeline test error');
    return <div>preview restored</div>;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<div>
      <span>chat retained</span>
      <ImageTimelineBoundary settings={{ end: 5 }}><Preview /></ImageTimelineBoundary>
    </div>));
    expect(host.textContent).toContain('chat retained');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(logError).toHaveBeenCalledWith('图片时间线渲染失败', expect.objectContaining({
      message: 'timeline test error', settings: { end: 5 }, componentStack: expect.any(String)
    }));
    failed = false;
    await act(async () => host.querySelector('button').click());
    expect(host.textContent).toContain('preview restored');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    consoleError.mockRestore();
  }
});
