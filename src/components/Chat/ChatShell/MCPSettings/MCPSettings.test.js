// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { LOCAL_MCP_AGENT_OPTIONS } from './constants';
import MCPSettings from './MCPSettings';

const modelMocks = vi.hoisted(() => ({
  imported: vi.fn(),
  mounted: vi.fn(),
  unmounted: vi.fn(),
  active: vi.fn()
}));

vi.mock('antd', () => ({
  Modal: ({ open, forceRender, centered, onCancel, children }) => {
    // Like AntD's default Modal, retain children after closing. Without
    // forceRender, freeze the closed subtree so missing active=false is caught.
    const [visited, setVisited] = React.useState(open);
    const lastChildren = React.useRef(children);
    React.useEffect(() => {
      if (open) setVisited(true);
    }, [open]);
    if (open || forceRender) lastChildren.current = children;
    if (!open && !forceRender && !visited) return null;
    return React.createElement('div', { role: 'dialog', hidden: !open, 'data-centered': String(Boolean(centered)) },
      React.createElement('button', { type: 'button', 'aria-label': '关闭', onClick: onCancel }, '关闭'),
      lastChildren.current);
  },
  Switch: ({ checked, loading, disabled, onChange }) => React.createElement('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    disabled: disabled || loading,
    onClick: () => onChange(!checked)
  }),
  message: { error: vi.fn(), success: vi.fn() }
}));
vi.mock('react-redux', () => ({ useSelector: () => null }));
vi.mock('../../../SwitchSettings/SwitchSettings', () => {
  modelMocks.imported();
  return {
    default: ({ active, embedded }) => {
      const [count, setCount] = React.useState(0);
      React.useEffect(() => {
        modelMocks.mounted();
        return () => modelMocks.unmounted();
      }, []);
      React.useEffect(() => { modelMocks.active(active); }, [active]);
      return React.createElement('div', {
        'data-testid': 'model-settings',
        'data-active': String(active),
        'data-embedded': String(embedded)
      }, React.createElement('button', {
        type: 'button',
        onClick: () => setCount(value => value + 1)
      }, `模型状态 ${count}`));
    }
  };
});

let container;
let root;
let writeText;
let originalClipboard;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.api = {
    localMcp: {
      detectAgents: vi.fn().mockResolvedValue([]),
      setAgentRegistration: vi.fn().mockResolvedValue({ success: true })
    },
    apiServer: { getStatus: vi.fn().mockResolvedValue({ running: true, actualPort: 18845 }) }
  };
  writeText = vi.fn().mockResolvedValue(undefined);
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete navigator.clipboard;
  delete window.api;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  vi.restoreAllMocks();
});

const renderSettings = async () => {
  await act(async () => root.render(React.createElement(MCPSettings)));
};
const click = async (element) => {
  await act(async () => element.click());
};
const reopenSettings = async () => {
  await click(container.querySelector('.chat-panel__local-mcp-entry'));
};
const openSettings = async () => {
  await renderSettings();
  expect(message.error).not.toHaveBeenCalled();
  await reopenSettings();
};
const getTab = (name) => Array.from(container.querySelectorAll('[role="tab"]'))
  .find(tab => tab.textContent === name);
const getPane = (name) => document.getElementById(getTab(name).getAttribute('aria-controls'));
const getModels = () => container.querySelector('[data-testid="model-settings"]');
const pressKey = async (element, key) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => element.dispatchEvent(event));
  return event;
};
const expectSelectedTab = (name) => {
  for (const label of ['MCP', '模型']) {
    const selected = name === label;
    expect(getTab(label).getAttribute('aria-selected')).toBe(String(selected));
    expect(getTab(label).tabIndex).toBe(selected ? 0 : -1);
    expect(getPane(label).hidden).toBe(!selected);
  }
};

// Keep this first so the lazy module has never been imported by another test.
describe('MCP settings tabs', () => {
  it('defaults to MCP without importing or mounting models, even with forceRender', async () => {
    await renderSettings();
    expect(container.querySelector('[role="dialog"]').hidden).toBe(true);
    expectSelectedTab('MCP');
    expect(modelMocks.imported).not.toHaveBeenCalled();
    expect(modelMocks.mounted).not.toHaveBeenCalled();
    expect(getModels()).toBeNull();
    expect(window.api.apiServer.getStatus).not.toHaveBeenCalled();

    await reopenSettings();
    expect(container.querySelector('[role="dialog"]').hidden).toBe(false);
    expect(container.querySelector('[role="dialog"]').getAttribute('data-centered')).toBe('false');
    expectSelectedTab('MCP');
    expect(modelMocks.imported).not.toHaveBeenCalled();
    expect(modelMocks.mounted).not.toHaveBeenCalled();
    expect(getModels()).toBeNull();
    expect(getPane('MCP').textContent).toContain('VectCut 客户端启动后');
    expect(getPane('MCP').querySelector('a').textContent).toBe('查看操作指南');
    expect(getPane('MCP').querySelectorAll('.chat-panel__local-mcp-detection-item')).toHaveLength(5);
    for (const agent of LOCAL_MCP_AGENT_OPTIONS) {
      expect(getPane('MCP').textContent).toContain(agent.label);
    }
  });

  it('links native tabs and panels and switches by click', async () => {
    await openSettings();
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist.getAttribute('aria-label')).toBe('外部链接设置');
    for (const name of ['MCP', '模型']) {
      expect(getTab(name).tagName).toBe('BUTTON');
      expect(getTab(name).type).toBe('button');
      expect(getTab(name).parentElement).toBe(tablist);
      expect(getPane(name).getAttribute('role')).toBe('tabpanel');
      expect(getPane(name).getAttribute('aria-labelledby')).toBe(getTab(name).id);
    }

    await click(getTab('模型'));
    expectSelectedTab('模型');
    expect(getModels().getAttribute('data-active')).toBe('true');
    expect(getModels().getAttribute('data-embedded')).toBe('true');
    expect(modelMocks.mounted).toHaveBeenCalledTimes(1);
    await click(getTab('MCP'));
    expectSelectedTab('MCP');
    expect(getModels().getAttribute('data-active')).toBe('false');
    expect(modelMocks.unmounted).not.toHaveBeenCalled();
  });

  it('supports wrapping arrow keys, Home and End without intercepting Tab', async () => {
    await openSettings();
    getTab('MCP').focus();
    for (const [key, from, to] of [
      ['ArrowRight', 'MCP', '模型'],
      ['ArrowRight', '模型', 'MCP'],
      ['ArrowLeft', 'MCP', '模型'],
      ['Home', '模型', 'MCP'],
      ['End', 'MCP', '模型'],
      ['ArrowLeft', '模型', 'MCP']
    ]) {
      const event = await pressKey(getTab(from), key);
      expect(event.defaultPrevented).toBe(true);
      expectSelectedTab(to);
      expect(document.activeElement).toBe(getTab(to));
    }
    for (const key of ['Tab', 'ArrowDown']) {
      const event = await pressKey(getTab('MCP'), key);
      expect(event.defaultPrevented).toBe(false);
      expectSelectedTab('MCP');
    }
  });

  it('retains model state across tabs and close/reopen while updating active', async () => {
    await openSettings();
    await click(getTab('模型'));
    const models = getModels();
    await click(models.querySelector('button'));
    expect(models.textContent).toBe('模型状态 1');

    await click(getTab('MCP'));
    expect(getModels()).toBe(models);
    expect(models.getAttribute('data-active')).toBe('false');
    await click(getTab('模型'));
    expect(getModels()).toBe(models);
    expect(models.textContent).toBe('模型状态 1');
    expect(models.getAttribute('data-active')).toBe('true');

    await click(container.querySelector('[aria-label="关闭"]'));
    expect(container.querySelector('[role="dialog"]').hidden).toBe(true);
    expect(getModels()).toBe(models);
    expect(models.getAttribute('data-active')).toBe('false');
    expect(modelMocks.active).toHaveBeenLastCalledWith(false);
    expect(modelMocks.unmounted).not.toHaveBeenCalled();

    await reopenSettings();
    expectSelectedTab('MCP');
    expect(getModels()).toBe(models);
    expect(models.getAttribute('data-active')).toBe('false');
    await click(getTab('模型'));
    expectSelectedTab('模型');
    expect(getModels()).toBe(models);
    expect(models.textContent).toBe('模型状态 1');
    expect(models.getAttribute('data-active')).toBe('true');
    expect(modelMocks.mounted).toHaveBeenCalledTimes(1);
    expect(modelMocks.unmounted).not.toHaveBeenCalled();
  });

  it('uses unique tab and panel IDs for multiple settings instances', async () => {
    await act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement(MCPSettings), React.createElement(MCPSettings))));
    const elements = [...container.querySelectorAll('[role="tab"], [role="tabpanel"]')];
    expect(elements).toHaveLength(8);
    expect(new Set(elements.map(element => element.id)).size).toBe(8);
    for (const tab of container.querySelectorAll('[role="tab"]')) {
      const pane = document.getElementById(tab.getAttribute('aria-controls'));
      expect(pane.getAttribute('aria-labelledby')).toBe(tab.id);
    }
    expect(modelMocks.mounted).not.toHaveBeenCalled();
  });
});

describe('MCP panel regressions', () => {
  it('keeps advanced settings and copying in the MCP pane across model visits', async () => {
    window.api.apiServer.getStatus.mockResolvedValue({ running: true, actualPort: 19999 });
    await openSettings();
    expect(container.querySelector('.chat-panel__local-mcp-advanced-panel')).toBeNull();
    await click(container.querySelector('.chat-panel__local-mcp-advanced-entry'));
    const advanced = container.querySelector('.chat-panel__local-mcp-advanced-panel');
    expect(advanced.closest('[role="tabpanel"]')).toBe(getPane('MCP'));
    expect(advanced.textContent).toContain('自定义 MCP Server 配置');
    const config = { vectcut: { url: 'http://127.0.0.1:19999/api/v1/mcp' } };
    expect(JSON.parse(advanced.querySelector('pre').textContent)).toEqual(config);
    await click(advanced.querySelector('[aria-label="复制 MCP Server 配置"]'));
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(config);
    expect(message.success).toHaveBeenCalledWith('MCP Server 配置已复制到剪贴板');

    await click(getTab('模型'));
    expect(advanced.closest('[hidden]')).toBe(getPane('MCP'));
    expect(getPane('模型').textContent).not.toContain('高级设置');
    expect(getPane('模型').textContent).not.toContain('查看操作指南');
    await click(getTab('MCP'));
    expect(container.querySelector('.chat-panel__local-mcp-advanced-panel')).toBe(advanced);
    expect(advanced.closest('[hidden]')).toBeNull();
    await click(container.querySelector('.chat-panel__local-mcp-advanced-entry'));
    expect(container.querySelector('.chat-panel__local-mcp-advanced-panel')).toBeNull();
  });

  it('keeps MCP registration switches and refresh behavior working', async () => {
    const registeredAgent = {
      id: 'workbuddy', label: 'WorkBuddy', installed: true,
      registrationSupported: true, registrationStatus: 'registered'
    };
    window.api.localMcp.detectAgents.mockResolvedValue([registeredAgent]);
    await openSettings();
    expect(container.querySelector('.chat-panel__local-mcp-entry').textContent).toBe('已连接');
    const registrationSwitch = getPane('MCP').querySelector('[role="switch"]');
    expect(registrationSwitch.disabled).toBe(false);
    expect(registrationSwitch.getAttribute('aria-checked')).toBe('true');
    window.api.localMcp.detectAgents.mockResolvedValue([{ ...registeredAgent, registrationStatus: 'unregistered' }]);
    await click(registrationSwitch);
    expect(window.api.localMcp.setAgentRegistration).toHaveBeenCalledWith('workbuddy', false);
    expect(registrationSwitch.getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('.chat-panel__local-mcp-entry').textContent).toBe('配置外部链接');
    expect(message.error).not.toHaveBeenCalled();
  });
});

describe('MCP detection error messages', () => {
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
