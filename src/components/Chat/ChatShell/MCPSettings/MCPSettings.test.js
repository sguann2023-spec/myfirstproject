// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import MCPSettings from './MCPSettings';

vi.mock('antd', () => ({
  Modal: ({ open, children }) => open ? children : null,
  Switch: () => null,
  message: { error: vi.fn() }
}));
vi.mock('react-redux', () => ({ useSelector: () => null }));

describe('MCP detection error messages', () => {
  let container;
  let root;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.api = {
      localMcp: { detectAgents: vi.fn() },
      apiServer: { getStatus: vi.fn().mockResolvedValue({ running: true, actualPort: 18845 }) }
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.api;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    vi.restoreAllMocks();
  });

  const openSettings = async () => {
    await act(async () => root.render(React.createElement(MCPSettings)));
    expect(message.error).not.toHaveBeenCalled();
    await act(async () => container.querySelector('button').click());
  };

  it('replaces raw IPC errors with a Chinese explanation and retry instructions', async () => {
    const error = new Error("Error invoking remote method 'local-mcp:detect-agents': Error: ENOENT: no such file or directory, scandir '/Users/bin/Applications'");
    window.api.localMcp.detectAgents.mockRejectedValue(error);
    await openSettings();

    expect(message.error).toHaveBeenCalledWith('暂时无法检测已安装的 AI 软件，请关闭此窗口后重新打开；若仍失败，请重启 VectCut。');
    expect(container.textContent).toContain('检测失败');
    expect(container.textContent).not.toContain('未安装');
    expect(console.error).toHaveBeenCalledWith('[MCPSettings] Failed to detect local agents', error);
  });

  it.each(['EACCES', 'EPERM'])('explains %s as an application folder permission problem', async (code) => {
    window.api.localMcp.detectAgents.mockRejectedValue(new Error(`Error invoking remote method: ${code}: permission denied`));
    await openSettings();
    expect(message.error).toHaveBeenCalledWith('无法读取本机应用列表，请检查应用文件夹的访问权限后重试。');
  });

  it('clears the failed state after a successful retry', async () => {
    window.api.localMcp.detectAgents
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue([]);
    await openSettings();
    expect(message.error).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('检测失败');
    expect(container.textContent).toContain('未安装');
  });
});
