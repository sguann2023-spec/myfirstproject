import React from 'react';
import { Modal, Switch, message } from 'antd';
import { Cable, ChevronRight, Copy } from 'lucide-react';
import { useSelector } from 'react-redux';
import { LOCAL_MCP_AGENT_OPTIONS } from './constants';
import './MCPSettings.css';

const LOCAL_MCP_AGENTS_UPDATED_EVENT = 'vectcut-local-mcp-agents-updated';
const SwitchSettings = React.lazy(() => import('../../../SwitchSettings/SwitchSettings'));
const SETTINGS_TABS = [
  { id: 'mcp', label: 'MCP' },
  { id: 'models', label: '模型' }
];

const buildCustomMcpServerConfig = ({ apiServer, port }) => {
  const host = String(apiServer?.host || '127.0.0.1').trim() || '127.0.0.1';
  const resolvedPort = Number(port || apiServer?.port || 18845) || 18845;
  return JSON.stringify({
    vectcut: {
      url: `http://${host}:${resolvedPort}/api/v1/mcp`
    }
  }, null, 2);
};

const MCPSettings = () => {
  const isWindows = typeof navigator !== 'undefined'
    && /Windows/i.test(`${navigator.userAgent || ''}`);
  const apiServerConfig = useSelector((state) => state?.settings?.apiServer || null);
  const [localMcpModalOpen, setLocalMcpModalOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState('mcp');
  const [modelsVisited, setModelsVisited] = React.useState(false);
  const tabId = React.useId();
  const tabRefs = React.useRef({});
  const selectTab = (tab) => {
    setActiveTab(tab);
    if (tab === 'models') setModelsVisited(true);
  };
  const handleTabKeyDown = (event, tab) => {
    const index = SETTINGS_TABS.findIndex((item) => item.id === tab);
    let nextIndex;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + 1) % SETTINGS_TABS.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index + SETTINGS_TABS.length - 1) % SETTINGS_TABS.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = SETTINGS_TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextTab = SETTINGS_TABS[nextIndex].id;
    selectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [localMcpStatus, setLocalMcpStatus] = React.useState({
    running: false,
    port: null,
    loading: true,
    syncing: false
  });
  const [localMcpDetectedAgents, setLocalMcpDetectedAgents] = React.useState([]);
  const [localMcpDetectionFailed, setLocalMcpDetectionFailed] = React.useState(false);
  const [localMcpRegistrationSyncingAgentId, setLocalMcpRegistrationSyncingAgentId] = React.useState('');

  const localMcpDetectedAgentMap = React.useMemo(() => (
    Array.isArray(localMcpDetectedAgents)
      ? localMcpDetectedAgents.reduce((acc, agent) => {
          if (agent?.id) {
            acc[agent.id] = agent;
          }
          return acc;
        }, {})
      : {}
  ), [localMcpDetectedAgents]);
  const hasConfiguredExternalAgent = React.useMemo(() => (
    Array.isArray(localMcpDetectedAgents) && localMcpDetectedAgents.some((agent) => (
      agent?.registrationStatus === 'registered'
    ))
  ), [localMcpDetectedAgents]);
  const customMcpServerConfig = React.useMemo(() => (
    buildCustomMcpServerConfig({
      apiServer: apiServerConfig,
      port: localMcpStatus.port
    })
  ), [apiServerConfig, localMcpStatus.port]);

  const refreshLocalMcpDetectedAgents = React.useCallback(async ({ silent = false } = {}) => {
    try {
      const detectedAgents = await window.api.localMcp.detectAgents();
      const normalizedDetectedAgents = Array.isArray(detectedAgents) ? detectedAgents : [];
      setLocalMcpDetectionFailed(false);
      setLocalMcpDetectedAgents(normalizedDetectedAgents);
      window.dispatchEvent(new window.CustomEvent(LOCAL_MCP_AGENTS_UPDATED_EVENT, {
        detail: {
          detectedAgents: normalizedDetectedAgents
        }
      }));
    } catch (error) {
      console.error('[MCPSettings] Failed to detect local agents', error);
      setLocalMcpDetectionFailed(true);
      setLocalMcpDetectedAgents([]);
      window.dispatchEvent(new window.CustomEvent(LOCAL_MCP_AGENTS_UPDATED_EVENT, {
        detail: {
          detectedAgents: []
        }
      }));
      if (!silent) {
        const permissionDenied = /\b(EACCES|EPERM)\b/.test(String(error?.message || error));
        message.error(permissionDenied
          ? '无法读取本机应用列表，请检查应用文件夹的访问权限后重试。'
          : '暂时无法检测已安装的 AI 软件，请关闭此窗口后重新打开；若仍失败，请重启 VectCut。');
      }
    }
  }, []);

  const refreshLocalMcpStatus = React.useCallback(async () => {
    setLocalMcpStatus((prev) => ({ ...prev, loading: true }));
    try {
      const status = await window.api.apiServer.getStatus();
      setLocalMcpStatus((prev) => ({
        ...prev,
        running: Boolean(status?.running),
        port: Number(status?.actualPort) || null,
        loading: false
      }));
    } catch (error) {
      setLocalMcpStatus((prev) => ({ ...prev, running: false, port: null, loading: false }));
      message.error(`获取本地 MCP 服务状态失败：${error?.message || error}`);
    }
  }, []);

  const handleToggleLocalMcpAgentRegistration = React.useCallback(async (agentId, enabled) => {
    setLocalMcpRegistrationSyncingAgentId(agentId);
    try {
      const result = await window.api.localMcp.setAgentRegistration(agentId, enabled);
      if (!result?.success) {
        throw new Error(result?.error || '更新失败');
      }
      await refreshLocalMcpDetectedAgents();
    } catch (error) {
      message.error(`本地 MCP 集成更新失败：${error?.message || error}`);
    } finally {
      setLocalMcpRegistrationSyncingAgentId('');
    }
  }, [refreshLocalMcpDetectedAgents]);
  const handleCopyCustomMcpServerConfig = React.useCallback(async () => {
    await navigator.clipboard.writeText(customMcpServerConfig);
    message.success('MCP Server 配置已复制到剪贴板');
  }, [customMcpServerConfig]);

  React.useEffect(() => {
    void refreshLocalMcpDetectedAgents({ silent: true });
  }, [refreshLocalMcpDetectedAgents]);

  React.useEffect(() => {
    if (!localMcpModalOpen) return undefined;
    void refreshLocalMcpStatus();
    void refreshLocalMcpDetectedAgents({ silent: false });
    return undefined;
  }, [localMcpModalOpen, refreshLocalMcpDetectedAgents, refreshLocalMcpStatus]);

  return (
    <>
      <button
        type="button"
        className={`chat-panel__local-mcp-entry ${hasConfiguredExternalAgent ? 'is-connected' : ''}`.trim()}
        onClick={() => {
          setActiveTab('mcp');
          setLocalMcpModalOpen(true);
        }}>
        <Cable size={18} aria-hidden="true" />
        <span>{hasConfiguredExternalAgent ? '已连接' : '配置外部链接'}</span>
      </button>

      <Modal
        title={null}
        open={localMcpModalOpen}
        forceRender
        onCancel={() => setLocalMcpModalOpen(false)}
        footer={null}
        width={500}
        className={`chat-panel__local-mcp-dialog ${isWindows ? 'chat-panel__local-mcp-dialog--win' : 'chat-panel__local-mcp-dialog--mac'}`}
        closeIcon={<span className="traffic-btn close chat-panel__local-mcp-traffic-close" aria-hidden="true" />}
        styles={{ body: { padding: 0 } }}>
        <div className="chat-panel__local-mcp-panel">
          <div className="chat-panel__local-mcp-panel-title-row">
            <h2 className="chat-panel__local-mcp-panel-title">配置外部链接</h2>
          </div>

          <div className="chat-panel__local-mcp-tabs" role="tablist" aria-label="外部链接设置">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                ref={(node) => { tabRefs.current[tab.id] = node; }}
                type="button"
                role="tab"
                id={`${tabId}-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`${tabId}-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className="chat-panel__local-mcp-tab"
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="chat-panel__local-mcp-content">
            <div
              className="chat-panel__local-mcp-modal chat-panel__local-mcp-tab-pane"
              role="tabpanel"
              id={`${tabId}-panel-mcp`}
              aria-labelledby={`${tabId}-tab-mcp`}
              hidden={activeTab !== 'mcp'}>
              <div className="chat-panel__local-mcp-panel-description">
                VectCut 客户端启动后，本地 MCP 将自动绑定所选 AI Agent
                <a
                  className="chat-panel__local-mcp-panel-link"
                  href="https://my.feishu.cn/wiki/Rsx8waZwjid5yHkIKSfcQPxInsh?from=from_copylink"
                  target="_blank"
                  rel="noreferrer"
                >
                  查看操作指南
                </a>
              </div>

              <div className="chat-panel__local-mcp-section">
                <div className="chat-panel__local-mcp-detection-list">
                  {LOCAL_MCP_AGENT_OPTIONS.map((agent) => {
                    const detectedAgent = localMcpDetectedAgentMap?.[agent.id] || null;
                    const installed = Boolean(detectedAgent?.installed);
                    const registrationSupported = Boolean(detectedAgent?.registrationSupported);
                    const registered = detectedAgent?.registrationStatus === 'registered';
                    const isSyncing = localMcpRegistrationSyncingAgentId === agent.id;

                    return (
                      <div
                        key={`detect:${agent.id}`}
                        className={`chat-panel__local-mcp-detection-item ${installed ? 'is-installed' : 'is-missing'}`.trim()}>
                        <div className="chat-panel__local-mcp-detection-main">
                          <div className="chat-panel__local-mcp-detection-name">{detectedAgent?.label || agent.label}</div>
                        </div>
                        {localMcpDetectionFailed ? (
                          <span className="chat-panel__local-mcp-detection-status is-missing">检测失败</span>
                        ) : !installed ? (
                          <span className="chat-panel__local-mcp-detection-status is-missing">未安装</span>
                        ) : !registrationSupported ? (
                          <span className="chat-panel__local-mcp-detection-status is-unsupported">暂不支持</span>
                        ) : (
                          <span className="chat-panel__local-mcp-detection-switch">
                            <Switch
                              checked={registered}
                              loading={isSyncing}
                              disabled={!localMcpStatus?.running}
                              onChange={(checked) => void handleToggleLocalMcpAgentRegistration(agent.id, checked)}
                            />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                className={`chat-panel__local-mcp-advanced-entry ${advancedOpen ? 'is-open' : ''}`.trim()}
                onClick={() => setAdvancedOpen((value) => !value)}>
                <span>高级设置</span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>

              {advancedOpen ? (
                <div className="chat-panel__local-mcp-advanced-panel">
                  <div className="chat-panel__local-mcp-advanced-header">
                    <div>
                      <div className="chat-panel__local-mcp-advanced-title">自定义 MCP Server 配置</div>
                      <div className="chat-panel__local-mcp-advanced-desc">
                        如需在其他 AI Agent 中使用 VectCut MCP，请复制以下 JSON 配置，并粘贴到对应 Agent 的 MCP 配置文件中。
                      </div>
                    </div>
                  </div>

                  <div className="chat-panel__local-mcp-advanced-code-wrap">
                    <button
                      type="button"
                      className="chat-panel__local-mcp-advanced-copy-icon"
                      onClick={() => void handleCopyCustomMcpServerConfig()}
                      aria-label="复制 MCP Server 配置">
                      <Copy size={16} aria-hidden="true" />
                    </button>
                    <pre className="chat-panel__local-mcp-advanced-code">{customMcpServerConfig}</pre>
                  </div>

                </div>
              ) : null}
            </div>
            <div
              className="chat-panel__local-mcp-tab-pane"
              role="tabpanel"
              id={`${tabId}-panel-models`}
              aria-labelledby={`${tabId}-tab-models`}
              hidden={activeTab !== 'models'}>
              {modelsVisited ? (
                <React.Suspense fallback={null}>
                  <SwitchSettings active={localMcpModalOpen && activeTab === 'models'} embedded />
                </React.Suspense>
              ) : null}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default React.memo(MCPSettings);
