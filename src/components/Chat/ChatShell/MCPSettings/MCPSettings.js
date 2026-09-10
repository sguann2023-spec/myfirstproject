import React from 'react';
import { Button, Modal, Switch, Tooltip, message } from 'antd';
import { Copy, PlugZap, RotateCcw, Square } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { DEFAULT_LOCAL_MCP_EXPOSURE_CONFIG } from '@renderer/types/apiServer';
import { handleSaveData } from '@renderer/store';
import { setApiServerEnabled, setLocalMcpExposure } from '@renderer/store/settings';
import { LOCAL_MCP_AGENT_OPTIONS } from './constants';
import './MCPSettings.css';

const ensureLocalMcpExposureConfig = (value) => {
  const baseAgents = DEFAULT_LOCAL_MCP_EXPOSURE_CONFIG?.agents || {};
  const sourceAgents = value?.agents && typeof value.agents === 'object' ? value.agents : {};
  const nextAgents = {};

  LOCAL_MCP_AGENT_OPTIONS.forEach(({ id }) => {
    const base = baseAgents[id] || { enabled: false, serverIds: [] };
    const source = sourceAgents[id] || {};
    nextAgents[id] = {
      enabled: Boolean(source.enabled ?? base.enabled),
      serverIds: Array.from(new Set(Array.isArray(source.serverIds) ? source.serverIds.filter(Boolean) : base.serverIds || []))
    };
  });

  return { agents: nextAgents };
};

const sanitizeMcpAliasSegment = (value) => String(value || '')
  .trim()
  .replace(/[^a-zA-Z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '');

const buildLocalMcpJsonConfig = ({ agentId, serverIds, servers, apiServer }) => {
  const host = String(apiServer?.host || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(apiServer?.port || 18845) || 18845;
  const apiKey = String(apiServer?.apiKey || '').trim();
  const selectedServers = serverIds
    .map((serverId) => servers.find((server) => server?.id === serverId))
    .filter(Boolean);
  const config = {};

  selectedServers.forEach((server) => {
    const alias = `capcuthelper_${sanitizeMcpAliasSegment(agentId)}_${sanitizeMcpAliasSegment(server.id || server.name)}`;
    config[alias] = {
      url: `http://${host}:${port}/v1/mcps/exposed/${encodeURIComponent(agentId)}/${encodeURIComponent(server.id)}/mcp`,
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    };
  });

  return JSON.stringify(config, null, 2);
};

const MCPSettings = () => {
  const dispatch = useDispatch();
  const mcpServers = useSelector((state) => state?.mcp?.servers || []);
  const apiServerConfig = useSelector((state) => state?.settings?.apiServer || null);
  const storedLocalMcpExposure = useSelector((state) => state?.settings?.localMcpExposure || null);
  const [localMcpModalOpen, setLocalMcpModalOpen] = React.useState(false);
  const [localMcpStatus, setLocalMcpStatus] = React.useState({
    running: false,
    port: null,
    loading: true,
    syncing: false
  });
  const [localMcpDetectedAgents, setLocalMcpDetectedAgents] = React.useState([]);
  const [localMcpRegistrationSyncingAgentId, setLocalMcpRegistrationSyncingAgentId] = React.useState('');

  const normalizedLocalMcpExposure = React.useMemo(
    () => ensureLocalMcpExposureConfig(storedLocalMcpExposure),
    [storedLocalMcpExposure]
  );
  const activeMcpServers = React.useMemo(
    () => (Array.isArray(mcpServers) ? mcpServers.filter((server) => Boolean(server?.isActive)) : []),
    [mcpServers]
  );
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

  const refreshLocalMcpDetectedAgents = React.useCallback(async () => {
    try {
      const detectedAgents = await window.api.localMcp.detectAgents();
      setLocalMcpDetectedAgents(Array.isArray(detectedAgents) ? detectedAgents : []);
    } catch (error) {
      setLocalMcpDetectedAgents([]);
      message.error(`检测本地 Agent 失败：${error?.message || error}`);
    }
  }, []);

  const handleToggleLocalMcpAgentRegistration = React.useCallback(async (agentId, enabled) => {
    setLocalMcpRegistrationSyncingAgentId(agentId);
    try {
      const result = await window.api.localMcp.setAgentRegistration(agentId, enabled);
      if (!result?.success) {
        throw new Error(result?.error || '更新失败');
      }
      message.success(enabled ? '已开启本地 MCP 集成' : '已关闭本地 MCP 集成');
      await refreshLocalMcpDetectedAgents();
    } catch (error) {
      message.error(`本地 MCP 集成更新失败：${error?.message || error}`);
    } finally {
      setLocalMcpRegistrationSyncingAgentId('');
    }
  }, [refreshLocalMcpDetectedAgents]);

  const updateLocalMcpExposureConfig = React.useCallback((updater) => {
    const nextConfig = ensureLocalMcpExposureConfig(
      typeof updater === 'function' ? updater(normalizedLocalMcpExposure) : updater
    );
    dispatch(setLocalMcpExposure(nextConfig));
  }, [dispatch, normalizedLocalMcpExposure]);

  const handleToggleLocalMcpService = React.useCallback(async (nextEnabled) => {
    setLocalMcpStatus((prev) => ({ ...prev, syncing: true }));
    try {
      if (nextEnabled) {
        const result = await window.api.apiServer.start();
        if (!result?.success) {
          throw new Error(result?.error || '启动失败');
        }
        dispatch(setApiServerEnabled(true));
        await handleSaveData();
        message.success('本地 MCP 服务已启动');
      } else {
        const result = await window.api.apiServer.stop();
        if (!result?.success) {
          throw new Error(result?.error || '停止失败');
        }
        dispatch(setApiServerEnabled(false));
        await handleSaveData();
        message.success('本地 MCP 服务已停止');
      }
      await refreshLocalMcpStatus();
    } catch (error) {
      message.error(`本地 MCP 服务操作失败：${error?.message || error}`);
    } finally {
      setLocalMcpStatus((prev) => ({ ...prev, syncing: false }));
    }
  }, [dispatch, refreshLocalMcpStatus]);

  const handleRestartLocalMcpService = React.useCallback(async () => {
    setLocalMcpStatus((prev) => ({ ...prev, syncing: true }));
    try {
      const result = await window.api.apiServer.restart();
      if (!result?.success) {
        throw new Error(result?.error || '重启失败');
      }
      dispatch(setApiServerEnabled(true));
      await handleSaveData();
      message.success('本地 MCP 服务已重启');
      await refreshLocalMcpStatus();
    } catch (error) {
      message.error(`本地 MCP 服务重启失败：${error?.message || error}`);
    } finally {
      setLocalMcpStatus((prev) => ({ ...prev, syncing: false }));
    }
  }, [dispatch, refreshLocalMcpStatus]);

  const handleToggleExposedAgent = React.useCallback((agentId, enabled) => {
    updateLocalMcpExposureConfig((currentConfig) => {
      const nextConfig = ensureLocalMcpExposureConfig(currentConfig);
      nextConfig.agents[agentId] = {
        ...nextConfig.agents[agentId],
        enabled
      };
      return nextConfig;
    });
  }, [updateLocalMcpExposureConfig]);

  const handleToggleExposedServer = React.useCallback((agentId, serverId, checked) => {
    updateLocalMcpExposureConfig((currentConfig) => {
      const nextConfig = ensureLocalMcpExposureConfig(currentConfig);
      const currentServerIds = Array.isArray(nextConfig.agents[agentId]?.serverIds) ? nextConfig.agents[agentId].serverIds : [];
      nextConfig.agents[agentId] = {
        ...nextConfig.agents[agentId],
        serverIds: checked
          ? Array.from(new Set([...currentServerIds, serverId]))
          : currentServerIds.filter((id) => id !== serverId)
      };
      return nextConfig;
    });
  }, [updateLocalMcpExposureConfig]);

  const handleCopyLocalMcpConfig = React.useCallback(async (agentId) => {
    const agentConfig = normalizedLocalMcpExposure.agents?.[agentId];
    const selectedServerIds = Array.isArray(agentConfig?.serverIds) ? agentConfig.serverIds : [];
    if (!apiServerConfig?.apiKey) {
      message.error('当前缺少 API Key，无法复制配置');
      return;
    }
    if (!agentConfig?.enabled) {
      message.warning('请先开启该 Agent 的本地 MCP 暴露');
      return;
    }
    if (selectedServerIds.length === 0) {
      message.warning('请先至少勾选一个要暴露的 MCP Server');
      return;
    }

    const json = buildLocalMcpJsonConfig({
      agentId,
      serverIds: selectedServerIds,
      servers: activeMcpServers,
      apiServer: {
        ...apiServerConfig,
        port: localMcpStatus.port || apiServerConfig?.port
      }
    });

    await navigator.clipboard.writeText(json);
    message.success('MCP 配置已复制到剪贴板');
  }, [activeMcpServers, apiServerConfig, localMcpStatus.port, normalizedLocalMcpExposure]);

  React.useEffect(() => {
    if (!localMcpModalOpen) return undefined;
    void refreshLocalMcpStatus();
    void refreshLocalMcpDetectedAgents();
    return undefined;
  }, [localMcpModalOpen, refreshLocalMcpDetectedAgents, refreshLocalMcpStatus]);

  return (
    <>
      <Tooltip
        title="本地 MCP 集成"
        placement="bottom"
        mouseEnterDelay={0.5}
        styles={{ body: { fontSize: 12 } }}>
        <button
          type="button"
          className="chat-panel__local-mcp-entry"
          onClick={() => setLocalMcpModalOpen(true)}>
          <PlugZap size={14} aria-hidden="true" />
          <span>本地 MCP</span>
        </button>
      </Tooltip>

      <Modal
        title="本地 MCP 集成"
        open={localMcpModalOpen}
        onCancel={() => setLocalMcpModalOpen(false)}
        footer={null}
        width={720}
        centered>
        <div className="chat-panel__local-mcp-modal">
          <div className="chat-panel__local-mcp-summary">
            <div>
              <div className="chat-panel__local-mcp-summary-title">同机外部 Agent 接入</div>
              <div className="chat-panel__local-mcp-summary-desc">
                仅暴露给当前机器上的外部 Agent，通过受控别名路由访问已勾选的 MCP Server。
              </div>
              <div className="chat-panel__local-mcp-summary-meta">
                {localMcpStatus?.loading
                  ? '正在获取服务状态...'
                  : `${localMcpStatus?.running ? '服务运行中' : '服务未启动'} · http://${apiServerConfig?.host || '127.0.0.1'}:${localMcpStatus?.port || apiServerConfig?.port || 18845}`}
              </div>
            </div>
            <div className="chat-panel__local-mcp-summary-actions">
              <Switch
                checked={Boolean(apiServerConfig?.enabled) && Boolean(localMcpStatus?.running)}
                loading={Boolean(localMcpStatus?.syncing)}
                checkedChildren="已开启"
                unCheckedChildren="未开启"
                onChange={handleToggleLocalMcpService}
              />
              <Button
                size="small"
                icon={<RotateCcw size={14} />}
                onClick={handleRestartLocalMcpService}
                disabled={!localMcpStatus?.running || localMcpStatus?.syncing}>
                重启
              </Button>
              <Button
                size="small"
                icon={<Square size={14} />}
                onClick={() => handleToggleLocalMcpService(false)}
                disabled={!localMcpStatus?.running || localMcpStatus?.syncing}>
                停止
              </Button>
            </div>
          </div>

          <div className="chat-panel__local-mcp-tip">
            勾选某个 Agent 下的 Server 后，复制出的 JSON 会指向
            <code>/v1/mcps/exposed/&lt;agent&gt;/&lt;server&gt;/mcp</code>，未勾选的组合不会暴露。
          </div>

          <div className="chat-panel__local-mcp-detection">
            <div className="chat-panel__local-mcp-section-title">本地 Agent 检测</div>
            <div className="chat-panel__local-mcp-detection-list">
              {LOCAL_MCP_AGENT_OPTIONS.map((agent) => {
                const detectedAgent = localMcpDetectedAgentMap?.[agent.id] || null;
                const installed = Boolean(detectedAgent?.installed);
                const registrationSupported = Boolean(detectedAgent?.registrationSupported);
                const registered = detectedAgent?.registrationStatus === 'registered';
                const isSyncing = localMcpRegistrationSyncingAgentId === agent.id;
                const actionLabel = !installed
                  ? '未安装'
                  : !registrationSupported
                    ? '暂不支持'
                    : registered
                      ? '关闭'
                      : '开启';

                return (
                  <div
                    key={`detect:${agent.id}`}
                    className={`chat-panel__local-mcp-detection-item ${installed ? 'is-installed' : 'is-missing'}`.trim()}>
                    <div className="chat-panel__local-mcp-detection-main">
                      <div className="chat-panel__local-mcp-detection-name">{detectedAgent?.label || agent.label}</div>
                      <div className="chat-panel__local-mcp-detection-hint">
                        {detectedAgent?.registrationSupported
                          ? `${detectedAgent?.detectionHint || agent.description}，${detectedAgent?.registrationHint || ''}`.replace(/，$/, '')
                          : (detectedAgent?.detectionHint || agent.description)}
                      </div>
                    </div>
                    <Button
                      size="small"
                      type={registered ? 'default' : 'primary'}
                      className={`chat-panel__local-mcp-detection-action ${registered ? 'is-enabled' : ''}`.trim()}
                      loading={isSyncing}
                      disabled={!installed || !registrationSupported || !localMcpStatus?.running}
                      onClick={() => void handleToggleLocalMcpAgentRegistration(agent.id, !registered)}>
                      {actionLabel}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          {activeMcpServers.length === 0 ? (
            <div className="chat-panel__local-mcp-empty">当前没有已启用的 MCP Server，请先在 MCP 设置中启用至少一个 Server。</div>
          ) : (
            <div className="chat-panel__local-mcp-agent-list">
              {LOCAL_MCP_AGENT_OPTIONS.map((agent) => {
                const agentExposure = normalizedLocalMcpExposure?.agents?.[agent.id] || { enabled: false, serverIds: [] };
                const selectedCount = Array.isArray(agentExposure.serverIds) ? agentExposure.serverIds.length : 0;
                const detectedAgent = localMcpDetectedAgentMap?.[agent.id] || null;
                const isAgentAvailable = Boolean(detectedAgent?.installed);
                const agentDescription = detectedAgent?.registrationSupported
                  ? `${detectedAgent?.detectionHint || agent.description}，${detectedAgent?.registrationHint || ''}`.replace(/，$/, '')
                  : (detectedAgent?.detectionHint || agent.description);

                return (
                  <div
                    key={agent.id}
                    className={`chat-panel__local-mcp-agent-card ${agentExposure.enabled ? 'is-enabled' : ''} ${isAgentAvailable ? '' : 'is-disabled'}`.trim()}>
                    <div className="chat-panel__local-mcp-agent-header">
                      <div>
                        <div className="chat-panel__local-mcp-agent-title">{agent.label}</div>
                        <div className="chat-panel__local-mcp-agent-desc">
                          {agentDescription}
                        </div>
                      </div>
                      <div className="chat-panel__local-mcp-agent-actions">
                        <Switch
                          checked={Boolean(agentExposure.enabled)}
                          disabled={!isAgentAvailable}
                          onChange={(checked) => handleToggleExposedAgent(agent.id, checked)}
                        />
                        <Button
                          size="small"
                          icon={<Copy size={14} />}
                          disabled={!isAgentAvailable || !agentExposure.enabled || selectedCount === 0}
                          onClick={() => void handleCopyLocalMcpConfig(agent.id)}>
                          复制 JSON
                        </Button>
                      </div>
                    </div>
                    <div className="chat-panel__local-mcp-agent-server-list">
                      {activeMcpServers.map((server) => {
                        const checked = Array.isArray(agentExposure.serverIds) && agentExposure.serverIds.includes(server.id);

                        return (
                          <label key={`${agent.id}:${server.id}`} className={`chat-panel__local-mcp-server-item ${checked ? 'is-checked' : ''}`.trim()}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!isAgentAvailable}
                              onChange={(event) => handleToggleExposedServer(agent.id, server.id, event.target.checked)}
                            />
                            <span className="chat-panel__local-mcp-server-name">{server.name || server.id}</span>
                            <span className="chat-panel__local-mcp-server-id">{server.id}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};

export default React.memo(MCPSettings);
