import { electronStore } from './electronStore';

export const DEFAULT_WORKSPACE_AGENT_ID = 'vectcut_claw_default';

const WORKSPACE_PARENT_DIR_STORE_KEY = 'workspaceParentDirByAgent';

const normalizePath = (value) => String(value || '').replace(/\\/g, '/').trim().replace(/\/$/, '');

const getStoredWorkspaceParentDirMap = () => {
  const raw = electronStore?.get(WORKSPACE_PARENT_DIR_STORE_KEY);
  return raw && typeof raw === 'object' ? raw : {};
};

export const readWorkspaceParentDirForAgent = (agentId = DEFAULT_WORKSPACE_AGENT_ID) => {
  const normalizedAgentId = String(agentId || '').trim();
  if (!normalizedAgentId) return '';
  return normalizePath(getStoredWorkspaceParentDirMap()?.[normalizedAgentId] || '');
};

export const writeWorkspaceParentDirForAgent = (agentId = DEFAULT_WORKSPACE_AGENT_ID, parentDir = '') => {
  const normalizedAgentId = String(agentId || '').trim();
  const normalizedParentDir = normalizePath(parentDir);
  if (!normalizedAgentId || !normalizedParentDir) return;
  electronStore?.set(WORKSPACE_PARENT_DIR_STORE_KEY, {
    ...getStoredWorkspaceParentDirMap(),
    [normalizedAgentId]: normalizedParentDir
  });
};

export const buildDefaultWorkspaceParentDir = (appDataPath = '', agentId = DEFAULT_WORKSPACE_AGENT_ID, joinPath) => {
  const normalizedAppDataPath = normalizePath(appDataPath);
  const normalizedAgentId = String(agentId || '').trim();
  if (!normalizedAppDataPath || !normalizedAgentId) return '';
  if (typeof joinPath === 'function') {
    return normalizePath(joinPath(normalizedAppDataPath, 'Data', 'Workspaces', normalizedAgentId));
  }
  return normalizePath(`${normalizedAppDataPath}/Data/Workspaces/${normalizedAgentId}`);
};

export const resolveWorkspaceParentDirForAgent = ({
  agentId = DEFAULT_WORKSPACE_AGENT_ID,
  appDataPath = '',
  joinPath
} = {}) => {
  const storedParentDir = readWorkspaceParentDirForAgent(agentId);
  if (storedParentDir) return storedParentDir;
  return buildDefaultWorkspaceParentDir(appDataPath, agentId, joinPath);
};
