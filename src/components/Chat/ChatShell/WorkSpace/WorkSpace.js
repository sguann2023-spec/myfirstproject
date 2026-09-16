import React from 'react';
import { createPortal } from 'react-dom';
import { message } from 'antd';
import {
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Upload as UploadIcon,
} from 'lucide-react';
import {
  readWorkspaceParentDirForAgent,
  resolveWorkspaceParentDirForAgent,
  writeWorkspaceParentDirForAgent
} from '../../../../shared/workspaceParentDir';
import './WorkSpace.css';

const normalizePath = (value) => String(value || '').replace(/\\/g, '/');
const isAbsoluteEntryPath = (value) => (
  value.startsWith('/') ||
  /^[a-zA-Z]:\//.test(value) ||
  value.startsWith('//')
);
const normalizeComparablePath = (value) => {
  const normalized = normalizePath(value).replace(/\/$/, '');
  return isWindows ? normalized.toLowerCase() : normalized;
};
const resolveListedEntryPath = (rootPath, entryPath) => {
  const normalizedRoot = normalizePath(rootPath).replace(/\/$/, '');
  const normalizedEntry = normalizePath(entryPath).trim();
  if (!normalizedEntry) return '';
  if (isAbsoluteEntryPath(normalizedEntry)) return normalizedEntry;
  return `${normalizedRoot}/${normalizedEntry}`.replace(/\/+/g, '/');
};
const getBaseName = (value) => {
  const normalized = normalizePath(value).replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized;
};
const splitFileName = (value = '') => {
  const normalized = String(value || '').trim();
  const extensionIndex = normalized.lastIndexOf('.');
  if (extensionIndex <= 0) {
    return { name: normalized, extension: '' };
  }
  return {
    name: normalized.slice(0, extensionIndex),
    extension: normalized.slice(extensionIndex),
  };
};
const sanitizeDroppedEntryName = (value = '') => {
  const sanitized = String(value || '').trim().replace(/[\\/:*?"<>|]/g, '_');
  return sanitized || 'untitled';
};
const appendIndexToFileName = (fileName = '', index = 0) => {
  if (index <= 0) return fileName;
  const { name, extension } = splitFileName(fileName);
  const nextName = name || 'untitled';
  return `${nextName}-${index}${extension}`;
};
const getParentPath = (value) => {
  const normalized = normalizePath(value).replace(/\/$/, '');
  if (!normalized) return '';
  const separatorIndex = normalized.lastIndexOf('/');
  if (separatorIndex <= 0) return '';
  return normalized.slice(0, separatorIndex);
};
const dedupePaths = (paths) => Array.from(new Set((Array.isArray(paths) ? paths : []).map((path) => normalizePath(path)).filter(Boolean)));
const movePathToFront = (paths, targetPath) => {
  const normalizedTarget = normalizePath(targetPath);
  return dedupePaths([normalizedTarget, ...dedupePaths(paths).filter((path) => path !== normalizedTarget)]);
};
const getWorkspaceVisitTimestamp = (value) => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};
const normalizeWorkspaceAccessTimes = (accessTimes, knownPaths = []) => {
  const normalizedKnownPaths = dedupePaths(knownPaths);
  const normalizedTimes = {};
  if (accessTimes && typeof accessTimes === 'object') {
    Object.entries(accessTimes).forEach(([workspacePath, value]) => {
      const normalizedPath = normalizePath(workspacePath);
      const timestamp = getWorkspaceVisitTimestamp(value);
      if (normalizedPath && timestamp > 0) {
        normalizedTimes[normalizedPath] = timestamp;
      }
    });
  }

  const migrationBase = Date.now();
  normalizedKnownPaths.forEach((workspacePath, index) => {
    if (!normalizedTimes[workspacePath]) {
      normalizedTimes[workspacePath] = migrationBase - index;
    }
  });

  return normalizedTimes;
};
const getWorkspaceLibrary = (paths) => dedupePaths(paths);
const filterWorkspaceStorePaths = (store, allowedPaths) => {
  const normalizedAllowedPaths = new Set(dedupePaths(allowedPaths));
  const library = getWorkspaceLibrary((store?.library || []).filter((path) => normalizedAllowedPaths.has(normalizePath(path))));
  const recent = dedupePaths((store?.recent || []).filter((path) => normalizedAllowedPaths.has(normalizePath(path))));
  return {
    library,
    recent,
    accessTimes: normalizeWorkspaceAccessTimes(store?.accessTimes, [...library, ...recent])
  };
};
const markWorkspaceVisited = (store, workspacePath, visitedAt = Date.now()) => {
  const normalizedWorkspacePath = normalizePath(workspacePath);
  if (!normalizedWorkspacePath) {
    return {
      library: getWorkspaceLibrary(store?.library),
      recent: dedupePaths(store?.recent),
      accessTimes: normalizeWorkspaceAccessTimes(store?.accessTimes)
    };
  }

  const nextLibrary = getWorkspaceLibrary([...(store?.library || []), normalizedWorkspacePath]);
  const nextRecent = movePathToFront(store?.recent || [], normalizedWorkspacePath);
  const nextAccessTimes = normalizeWorkspaceAccessTimes(store?.accessTimes, [...nextLibrary, ...nextRecent]);
  nextAccessTimes[normalizedWorkspacePath] = getWorkspaceVisitTimestamp(visitedAt) || Date.now();

  return {
    library: nextLibrary,
    recent: nextRecent,
    accessTimes: nextAccessTimes
  };
};
const isSameWorkspaceStore = (left, right) => {
  const normalizedLeft = filterWorkspaceStorePaths(left, [...(left?.library || []), ...(left?.recent || [])]);
  const normalizedRight = filterWorkspaceStorePaths(right, [...(right?.library || []), ...(right?.recent || [])]);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
};
const getRecentWorkspacePaths = (store, library) => {
  const normalizedLibrary = getWorkspaceLibrary(library);
  const configuredRecent = dedupePaths(store?.recent).filter((path) => normalizedLibrary.includes(path));
  const fallbackOrder = [...configuredRecent, ...normalizedLibrary.filter((path) => !configuredRecent.includes(path))];
  const fallbackIndexMap = new Map(fallbackOrder.map((path, index) => [path, index]));
  const accessTimes = normalizeWorkspaceAccessTimes(store?.accessTimes, fallbackOrder);
  return [...normalizedLibrary].sort((left, right) => {
    const accessDiff = (accessTimes[right] || 0) - (accessTimes[left] || 0);
    if (accessDiff !== 0) return accessDiff;
    return (fallbackIndexMap.get(left) ?? Number.MAX_SAFE_INTEGER) - (fallbackIndexMap.get(right) ?? Number.MAX_SAFE_INTEGER);
  });
};
const sortTreeNodes = (nodes) => (
  [...nodes].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }
    return String(left.name || '').localeCompare(String(right.name || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  })
);
const sortTreeRecursively = (nodes) => (
  sortTreeNodes(nodes).map((node) => (
    node.type === 'directory' && Array.isArray(node.children)
      ? { ...node, children: sortTreeRecursively(node.children) }
      : node
  ))
);
const buildTreeFromEntries = (rootPath, entries, directoryFlags) => {
  const normalizedRoot = normalizePath(rootPath).replace(/\/$/, '');
  const nodeMap = new Map();
  const rootNodes = [];

  entries
    .map((entryPath) => normalizePath(entryPath))
    .filter((entryPath) => entryPath && entryPath.startsWith(`${normalizedRoot}/`))
    .sort((left, right) => left.length - right.length)
    .forEach((entryPath) => {
      const relativePath = entryPath.slice(normalizedRoot.length + 1);
      if (!relativePath) return;

      const segments = relativePath.split('/').filter(Boolean);
      if (segments.length === 0) return;

      const nodePath = segments.join('/');
      const parentPath = segments.slice(0, -1).join('/');
      const node = {
        name: segments[segments.length - 1],
        path: nodePath,
        type: directoryFlags.get(entryPath) ? 'directory' : 'file',
      };

      if (node.type === 'directory') {
        node.children = [];
      }

      nodeMap.set(nodePath, node);

      if (parentPath && nodeMap.has(parentPath)) {
        const parentNode = nodeMap.get(parentPath);
        if (!Array.isArray(parentNode.children)) {
          parentNode.children = [];
        }
        parentNode.children.push(node);
      } else {
        rootNodes.push(node);
      }
    });

  return sortTreeRecursively(rootNodes);
};

const WORKSPACE_MUTATION_TOOL_NAMES = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'DeleteFile',
  'Bash',
  'BashOutput',
  'RunCommand'
]);
const getWorkspaceMutationPaths = (chunk) => {
  const input = chunk?.input && typeof chunk.input === 'object' ? chunk.input : {};
  const candidates = [
    input?.file_path,
    input?.cwd,
    ...(Array.isArray(input?.file_paths) ? input.file_paths : [])
  ];
  return dedupePaths(candidates);
};
const isPathInsideRoot = (candidatePath, rootPath) => {
  const normalizedCandidate = normalizeComparablePath(candidatePath);
  const normalizedRoot = normalizeComparablePath(rootPath);
  if (!normalizedCandidate || !normalizedRoot) return false;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
};
const shouldRefreshWorkspaceForChunk = (payload, workspacePath) => {
  if (payload?.type !== 'chunk') return false;
  const chunk = payload?.chunk;
  if (!chunk || (chunk.type !== 'tool-result' && chunk.type !== 'tool-error')) return false;
  const toolName = String(chunk?.toolName || '').trim();
  if (!WORKSPACE_MUTATION_TOOL_NAMES.has(toolName)) return false;
  const mutationPaths = getWorkspaceMutationPaths(chunk);
  if (mutationPaths.length === 0) {
    return toolName === 'Bash' || toolName === 'BashOutput' || toolName === 'RunCommand';
  }
  return mutationPaths.some((candidatePath) => isPathInsideRoot(candidatePath, workspacePath));
};

const WORKSPACE_STORE_KEY = 'chat-workspaces:v1';
const TREE_LIST_MAX_ENTRIES = 20000;
const isWindows = typeof process !== 'undefined' && process.platform === 'win32';
const readCreateWorkspaceParentForAgent = (agentId) => {
  const normalizedAgentId = String(agentId || '').trim();
  if (!normalizedAgentId) return '';
  return normalizePath(readWorkspaceParentDirForAgent(normalizedAgentId));
};
const writeCreateWorkspaceParentForAgent = (agentId, parentDir) => {
  const normalizedAgentId = String(agentId || '').trim();
  const normalizedParentDir = normalizePath(parentDir);
  if (!normalizedAgentId || !normalizedParentDir) return;
  writeWorkspaceParentDirForAgent(normalizedAgentId, normalizedParentDir);
};
const readWorkspaceStore = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { library: [], recent: [], accessTimes: {} };
  }
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORE_KEY);
    if (!raw) return { library: [], recent: [], accessTimes: {} };
    const parsed = JSON.parse(raw);
    const library = getWorkspaceLibrary(parsed?.library);
    const recent = dedupePaths(parsed?.recent);
    return {
      library,
      recent,
      accessTimes: normalizeWorkspaceAccessTimes(parsed?.accessTimes, [...library, ...recent])
    };
  } catch (_error) {
    return { library: [], recent: [], accessTimes: {} };
  }
};
const writeWorkspaceStore = (store) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const library = getWorkspaceLibrary(store?.library);
    const recent = dedupePaths(store?.recent);
    window.localStorage.setItem(
      WORKSPACE_STORE_KEY,
      JSON.stringify({
        library,
        recent,
        accessTimes: normalizeWorkspaceAccessTimes(store?.accessTimes, [...library, ...recent])
      })
    );
  } catch (_error) {
    // ignore storage failures
  }
};

const WorkspaceCreateDialog = ({
  open = false,
  parentDir = '',
  workspaceName = '',
  workspaceNameError = '',
  submitting = false,
  dialogRef = null,
  workspaceNameInputRef = null,
  onClose,
  onPickParentDir,
  onWorkspaceNameChange,
  onConfirm
}) => {
  if (!open || typeof document === 'undefined') return null;

  const canConfirm = Boolean(String(parentDir || '').trim() && String(workspaceName || '').trim() && !submitting);

  return createPortal(
    <div className="chat-panel__workspace-create-mask" onClick={() => !submitting && onClose?.()}>
      <div
        ref={dialogRef}
        className="chat-panel__workspace-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-create-dialog-title"
        onClick={(event) => event.stopPropagation()}>
        <div className={`chat-panel__workspace-create-header ${isWindows ? 'is-win' : 'is-mac'}`}>
          {!isWindows && (
            <button
              type="button"
              className="traffic-btn close chat-panel__workspace-create-traffic-close chat-panel__workspace-create-traffic-close--mac"
              aria-label="关闭"
              disabled={submitting}
              onClick={() => onClose?.()}>
            </button>
          )}
          <div className="chat-panel__workspace-create-title-block">
            <h2 id="workspace-create-dialog-title" className="chat-panel__workspace-create-title">
              新建工作空间
            </h2>
            <div className="chat-panel__workspace-create-tip">
              为工作空间命名，本地将自动创建同名文件夹，命名后不可随意更改
            </div>
          </div>
          {isWindows && (
            <button
              type="button"
              className="traffic-btn close chat-panel__workspace-create-traffic-close chat-panel__workspace-create-traffic-close--win"
              aria-label="关闭"
              disabled={submitting}
              onClick={() => onClose?.()}>
            </button>
          )}
        </div>
        <div className="chat-panel__workspace-create-body">
          <div className="chat-panel__workspace-create-row">
            <div className="chat-panel__workspace-create-path-row">
              <div className="chat-panel__workspace-create-input-wrap">
                <div
                  className="chat-panel__workspace-create-input chat-panel__workspace-create-input--with-action"
                  title={parentDir || '请选择工作空间父目录'}>
                  {parentDir || '请选择工作空间父目录'}
                </div>
                <button
                  type="button"
                  className="chat-panel__workspace-create-picker chat-panel__workspace-create-picker--inline"
                  disabled={submitting}
                  onClick={() => onPickParentDir?.()}>
                  <FolderOpen size={14} />
                </button>
              </div>
            </div>
            <div className="chat-panel__workspace-create-name-field">
              <input
                ref={workspaceNameInputRef}
                type="text"
                maxLength={50}
                className={`chat-panel__workspace-create-input chat-panel__workspace-create-input--name ${workspaceNameError ? 'chat-panel__workspace-create-input--error' : ''}`.trim()}
                placeholder="空间名称"
                value={workspaceName}
                disabled={submitting}
                aria-invalid={workspaceNameError ? 'true' : 'false'}
                onChange={(event) => onWorkspaceNameChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canConfirm) {
                    event.preventDefault();
                    onConfirm?.();
                  }
                }}
              />
              {workspaceNameError ? (
                <div className="chat-panel__workspace-create-error">{workspaceNameError}</div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="chat-panel__workspace-create-footer">
          <button
            type="button"
            className="chat-panel__workspace-create-cancel"
            disabled={submitting}
            onClick={() => onClose?.()}>
            取消
          </button>
          <button
            type="button"
            className={`chat-panel__workspace-create-confirm ${canConfirm ? 'chat-panel__workspace-create-confirm--enabled' : ''}`}
            disabled={!canConfirm}
            onClick={() => onConfirm?.()}>
            {submitting ? '创建中...' : '确认'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const WorkSpace = ({
  agentId,
  resolvedSessionId = '',
  currentWorkspacePath = '',
  hasLockedWorkspace = false,
  workspaceStatus = '',
  onBindWorkspace,
  renderTreeNodes,
  beginnerGuideCreateWorkspaceButtonRef = null,
  beginnerGuideWorkspaceDialogRef = null,
  beginnerGuideWorkspaceNameInputRef = null,
}) => {
  const [workspaceStore, setWorkspaceStore] = React.useState(() => readWorkspaceStore());
  const [workspaceTrees, setWorkspaceTrees] = React.useState({});
  const [workspaceTreeLoading, setWorkspaceTreeLoading] = React.useState({});
  const [workspaceExpanded, setWorkspaceExpanded] = React.useState(true);
  const [isWorkspaceDragActive, setIsWorkspaceDragActive] = React.useState(false);
  const [workspaceDropPending, setWorkspaceDropPending] = React.useState(false);
  const [showAllRecentWorkspaces, setShowAllRecentWorkspaces] = React.useState(false);
  const [createWorkspaceDialogOpen, setCreateWorkspaceDialogOpen] = React.useState(false);
  const [createWorkspaceParentDir, setCreateWorkspaceParentDir] = React.useState('');
  const [createWorkspaceName, setCreateWorkspaceName] = React.useState('');
  const [createWorkspaceNameError, setCreateWorkspaceNameError] = React.useState('');
  const [createWorkspaceSubmitting, setCreateWorkspaceSubmitting] = React.useState(false);
  const workspaceRefreshTimeoutRef = React.useRef(null);
  const workspaceDragCounterRef = React.useRef(0);

  const workspaceLibrary = React.useMemo(() => getWorkspaceLibrary(workspaceStore?.library), [workspaceStore]);
  const recentWorkspacePaths = React.useMemo(
    () => getRecentWorkspacePaths(workspaceStore, workspaceLibrary),
    [workspaceStore, workspaceLibrary]
  );
  const visibleRecentWorkspaces = React.useMemo(
    () => (showAllRecentWorkspaces ? recentWorkspacePaths : recentWorkspacePaths.slice(0, 5)),
    [recentWorkspacePaths, showAllRecentWorkspaces]
  );
  const workspaceStorePathSignature = React.useMemo(
    () => dedupePaths([...(workspaceStore?.library || []), ...(workspaceStore?.recent || [])]).join('\n'),
    [workspaceStore?.library, workspaceStore?.recent]
  );

  React.useEffect(() => {
    writeWorkspaceStore(workspaceStore);
  }, [workspaceStore]);

  React.useEffect(() => {
    const api = window?.api?.file;
    if (!workspaceStorePathSignature || typeof api?.isDirectory !== 'function') return undefined;

    let cancelled = false;
    const validateWorkspaceStore = async () => {
      const candidatePaths = workspaceStorePathSignature.split('\n').filter(Boolean);
      if (!candidatePaths.length) return;

      const results = await Promise.all(
        candidatePaths.map(async (workspacePath) => ({
          workspacePath,
          exists: await api.isDirectory(workspacePath)
        }))
      );
      if (cancelled) return;

      const validPaths = results.filter((item) => item.exists).map((item) => item.workspacePath);
      if (validPaths.length === candidatePaths.length) return;

      setWorkspaceStore((prev) => {
        const nextStore = filterWorkspaceStorePaths(prev, validPaths);
        return isSameWorkspaceStore(prev, nextStore) ? prev : nextStore;
      });
    };

    void validateWorkspaceStore();

    const handleWindowFocus = () => {
      void validateWorkspaceStore();
    };
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [workspaceStorePathSignature]);

  const persistVisitedWorkspace = React.useCallback((workspacePath, visitedAt = Date.now()) => {
    const nextStore = markWorkspaceVisited(readWorkspaceStore(), workspacePath, visitedAt);
    writeWorkspaceStore(nextStore);
    setWorkspaceStore(nextStore);
    return nextStore;
  }, []);

  React.useEffect(() => {
    if (!currentWorkspacePath) return;
    persistVisitedWorkspace(currentWorkspacePath);
  }, [currentWorkspacePath, persistVisitedWorkspace]);

  React.useEffect(() => {
    setWorkspaceTrees({});
    setWorkspaceTreeLoading({});
    setWorkspaceExpanded(true);
    setShowAllRecentWorkspaces(false);
  }, [workspaceLibrary]);

  React.useEffect(() => {
    if (createWorkspaceDialogOpen) return;
    setCreateWorkspaceSubmitting(false);
    setCreateWorkspaceName('');
    setCreateWorkspaceNameError('');
  }, [createWorkspaceDialogOpen]);

  const toggleWorkspaceExpanded = React.useCallback(() => {
    setWorkspaceExpanded((prev) => !prev);
  }, []);

  const loadWorkspaceTree = React.useCallback(async (workspacePath) => {
    const workspaceKey = normalizePath(workspacePath);
    if (!workspaceKey) return;
    setWorkspaceTreeLoading((prev) => ({ ...prev, [workspaceKey]: true }));

    try {
      const entries = await window.api.file.listDirectory(workspaceKey, {
        recursive: true,
        maxDepth: 10,
        includeHidden: false,
        includeFiles: true,
        includeDirectories: true,
        maxEntries: TREE_LIST_MAX_ENTRIES,
        searchPattern: '.'
      });

      const rootPath = workspaceKey.replace(/\/$/, '');
      const normalizedEntries = Array.isArray(entries)
        ? Array.from(
            new Set(
              entries
                .map((entryPath) => resolveListedEntryPath(rootPath, entryPath))
                .filter((entryPath) => {
                  if (!entryPath.startsWith(`${rootPath}/`)) return false;
                  const relativePath = entryPath.slice(rootPath.length + 1);
                  return relativePath && !relativePath.split('/').includes('.claude');
                })
            )
          )
        : [];

      const directoryChecks = await Promise.all(
        normalizedEntries.map(async (entryPath) => {
          try {
            const isDirectory = await window.api.file.isDirectory(entryPath);
            return [entryPath, Boolean(isDirectory)];
          } catch (_error) {
            return [entryPath, false];
          }
        })
      );

      setWorkspaceTrees((prev) => ({
        ...prev,
        [workspaceKey]: buildTreeFromEntries(workspaceKey, normalizedEntries, new Map(directoryChecks))
      }));
    } catch (_error) {
      setWorkspaceTrees((prev) => ({ ...prev, [workspaceKey]: [] }));
    } finally {
      setWorkspaceTreeLoading((prev) => ({ ...prev, [workspaceKey]: false }));
    }
  }, []);

  React.useEffect(() => {
    if (!workspaceExpanded || !hasLockedWorkspace || !currentWorkspacePath) return;
    if (Object.prototype.hasOwnProperty.call(workspaceTrees, currentWorkspacePath)) return;
    void loadWorkspaceTree(currentWorkspacePath);
  }, [currentWorkspacePath, hasLockedWorkspace, loadWorkspaceTree, workspaceExpanded, workspaceTrees]);

  const invalidateWorkspaceTree = React.useCallback((workspacePath) => {
    const workspaceKey = normalizePath(workspacePath);
    if (!workspaceKey) return;
    setWorkspaceTrees((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, workspaceKey)) return prev;
      const next = { ...prev };
      delete next[workspaceKey];
      return next;
    });
    setWorkspaceTreeLoading((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, workspaceKey)) return prev;
      const next = { ...prev };
      delete next[workspaceKey];
      return next;
    });
  }, []);

  const scheduleWorkspaceTreeRefresh = React.useCallback((workspacePath) => {
    const workspaceKey = normalizePath(workspacePath);
    if (!workspaceKey) return;
    if (workspaceRefreshTimeoutRef.current) {
      window.clearTimeout(workspaceRefreshTimeoutRef.current);
    }
    workspaceRefreshTimeoutRef.current = window.setTimeout(() => {
      workspaceRefreshTimeoutRef.current = null;
      void loadWorkspaceTree(workspaceKey);
    }, 120);
  }, [loadWorkspaceTree]);

  React.useEffect(() => () => {
    if (workspaceRefreshTimeoutRef.current) {
      window.clearTimeout(workspaceRefreshTimeoutRef.current);
      workspaceRefreshTimeoutRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    const api = window?.electronAPI?.cherryChatStream;
    const targetSessionId = String(resolvedSessionId || '').trim();
    if (!targetSessionId || !currentWorkspacePath || typeof api?.onChunk !== 'function') return undefined;

    return api.onChunk((payload) => {
      if (String(payload?.sessionId || '').trim() !== targetSessionId) return;
      if (!shouldRefreshWorkspaceForChunk(payload, currentWorkspacePath)) return;
      if (workspaceExpanded) {
        scheduleWorkspaceTreeRefresh(currentWorkspacePath);
        return;
      }
      invalidateWorkspaceTree(currentWorkspacePath);
    });
  }, [
    currentWorkspacePath,
    invalidateWorkspaceTree,
    resolvedSessionId,
    scheduleWorkspaceTreeRefresh,
    workspaceExpanded
  ]);

  const bindWorkspace = React.useCallback(async (workspacePath, options = {}) => {
    const normalizedSelected = normalizePath(workspacePath);
    if (!normalizedSelected || typeof onBindWorkspace !== 'function') return false;
    const success = await onBindWorkspace(normalizedSelected, options);
    if (success) {
      persistVisitedWorkspace(normalizedSelected);
    }
    return Boolean(success);
  }, [onBindWorkspace, persistVisitedWorkspace]);

  const handleAddWorkspace = React.useCallback(async (event) => {
    event?.stopPropagation?.();
    try {
      const selected = await window.api.file.selectFolder();
      if (!selected) return;
      await bindWorkspace(selected);
    } catch (_error) {
      window.toast.error('打开文件夹失败');
    }
  }, [bindWorkspace]);

  const handleOpenCreateWorkspaceDialog = React.useCallback((event) => {
    event?.stopPropagation?.();

    const openDialog = async () => {
      const rememberedParentDir = readCreateWorkspaceParentForAgent(agentId);
      if (rememberedParentDir) {
        setCreateWorkspaceParentDir(rememberedParentDir);
        setCreateWorkspaceName('');
        setCreateWorkspaceNameError('');
        setCreateWorkspaceDialogOpen(true);
        return;
      }

      let nextParentDir = '';
      try {
        const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
        const appDataPath = normalizePath(appInfo?.appDataPath || '');
        nextParentDir = normalizePath(resolveWorkspaceParentDirForAgent({
          agentId,
          appDataPath,
          joinPath: window?.electronAPI?.path?.join
        }));
      } catch (_error) {
        nextParentDir = '';
      }

      if (!nextParentDir) {
        nextParentDir = getParentPath(currentWorkspacePath || recentWorkspacePaths[0] || '');
      }

      setCreateWorkspaceParentDir(nextParentDir);
      setCreateWorkspaceName('');
      setCreateWorkspaceNameError('');
      setCreateWorkspaceDialogOpen(true);
    };

    void openDialog();
  }, [agentId, currentWorkspacePath, recentWorkspacePaths]);

  const handlePickWorkspaceParentDir = React.useCallback(async () => {
    try {
      const parentDir = await window.api.file.selectFolder();
      if (!parentDir) return;
      const normalizedParentDir = normalizePath(parentDir);
      setCreateWorkspaceParentDir(normalizedParentDir);
      setCreateWorkspaceNameError('');
      writeCreateWorkspaceParentForAgent(agentId, normalizedParentDir);
    } catch (_error) {
      window.toast.error('选择目录失败');
    }
  }, [agentId]);

  const handleCreateWorkspace = React.useCallback(async () => {
    const parentDir = normalizePath(createWorkspaceParentDir);
    const normalizedName = String(createWorkspaceName || '').trim();
    if (!parentDir || !normalizedName || createWorkspaceSubmitting) return;

    try {
      setCreateWorkspaceSubmitting(true);
      setCreateWorkspaceNameError('');

      const checkResult = await window.api.file.checkFileName(parentDir, normalizedName, false);
      const folderName = String(checkResult?.safeName || normalizedName).trim();
      if (!folderName) {
        window.toast.error('工作空间名称无效');
        return;
      }
      if (checkResult?.requestedExists) {
        setCreateWorkspaceNameError(`名称“${normalizedName}”已被占用`);
        return;
      }

      const joinPath = window?.electronAPI?.path?.join;
      const workspacePath = normalizePath(
        typeof joinPath === 'function' ? joinPath(parentDir, folderName) : `${parentDir}/${folderName}`
      );

      await window.api.file.mkdir(workspacePath);
      writeCreateWorkspaceParentForAgent(agentId, parentDir);
      const success = await bindWorkspace(workspacePath, { seedSkills: true });
      if (success) {
        setCreateWorkspaceDialogOpen(false);
        setCreateWorkspaceName('');
        setCreateWorkspaceNameError('');
      }
    } catch (error) {
      window.toast.error(error?.message || '新建工作空间失败');
    } finally {
      setCreateWorkspaceSubmitting(false);
    }
  }, [
    agentId,
    bindWorkspace,
    createWorkspaceName,
    createWorkspaceParentDir,
    createWorkspaceSubmitting
  ]);

  const openWorkspaceInFinder = React.useCallback((event, workspacePath) => {
    event.stopPropagation();
    if (!workspacePath) return;
    void window.api.file.openPath(workspacePath);
  }, []);

  const refreshWorkspaceTree = React.useCallback((event) => {
    event.stopPropagation();
    if (!currentWorkspacePath) return;
    void loadWorkspaceTree(currentWorkspacePath);
  }, [currentWorkspacePath, loadWorkspaceTree]);

  const hasDraggedFiles = React.useCallback((event) => {
    const dataTransferTypes = Array.from(event?.dataTransfer?.types || []);
    return dataTransferTypes.includes('Files');
  }, []);

  const resetWorkspaceDragState = React.useCallback(() => {
    workspaceDragCounterRef.current = 0;
    setIsWorkspaceDragActive(false);
  }, []);

  const resolveWorkspaceDropPath = React.useCallback(async (workspacePath, entryName) => {
    const normalizedWorkspacePath = normalizePath(workspacePath).trim();
    const normalizedEntryName = sanitizeDroppedEntryName(entryName);
    const joinPath = window?.electronAPI?.path?.join;
    const fileApi = window?.api?.file;
    if (!normalizedWorkspacePath || !fileApi) return '';

    for (let index = 0; index < 200; index += 1) {
      const candidateName = appendIndexToFileName(normalizedEntryName, index);
      const candidatePath = normalizePath(
        typeof joinPath === 'function'
          ? joinPath(normalizedWorkspacePath, candidateName)
          : `${normalizedWorkspacePath}/${candidateName}`
      );
      try {
        const [fileEntry, isDirectory] = await Promise.all([
          typeof fileApi.get === 'function' ? fileApi.get(candidatePath) : Promise.resolve(null),
          typeof fileApi.isDirectory === 'function' ? fileApi.isDirectory(candidatePath) : Promise.resolve(false),
        ]);
        if (!fileEntry && !isDirectory) {
          return candidatePath;
        }
      } catch (_error) {
        return candidatePath;
      }
    }

    return '';
  }, []);

  const copyDroppedFilesToWorkspace = React.useCallback(async (fileList) => {
    const workspacePath = normalizePath(currentWorkspacePath).trim();
    const copyApi = window?.api?.copy;
    const fileApi = window?.api?.file;
    if (!workspacePath || typeof copyApi !== 'function' || !fileApi || typeof fileApi.getPathForFile !== 'function') {
      window.toast.error('工作空间拖拽上传不可用');
      return;
    }

    const droppedEntries = Array.from(fileList || []).filter(Boolean);
    if (droppedEntries.length === 0) return;

    setWorkspaceDropPending(true);
    try {
      let successCount = 0;
      for (const file of droppedEntries) {
        const sourcePath = normalizePath(fileApi.getPathForFile(file) || '').trim();
        if (!sourcePath) {
          continue;
        }
        const targetPath = await resolveWorkspaceDropPath(workspacePath, file.name || getBaseName(sourcePath));
        if (!targetPath) {
          throw new Error('生成目标路径失败');
        }
        const copyResult = await copyApi(sourcePath, targetPath);
        if (!copyResult?.success) {
          throw new Error(copyResult?.error || '复制文件失败');
        }
        successCount += 1;
      }

      if (successCount === 0) {
        window.toast.warning('未识别到可导入的本地文件');
        return;
      }

      setWorkspaceExpanded(true);
      await loadWorkspaceTree(workspacePath);
      message.success(
        successCount > 1
          ? `已添加 ${successCount} 个文件到工作空间`
          : '已添加 1 个文件到工作空间'
      );
    } catch (error) {
      window.toast.error(error?.message || '拖拽导入工作空间失败');
    } finally {
      setWorkspaceDropPending(false);
    }
  }, [currentWorkspacePath, loadWorkspaceTree, resolveWorkspaceDropPath]);

  const handleWorkspaceDragEnter = React.useCallback((event) => {
    if (!hasLockedWorkspace || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    workspaceDragCounterRef.current += 1;
    setIsWorkspaceDragActive(true);
  }, [hasDraggedFiles, hasLockedWorkspace]);

  const handleWorkspaceDragOver = React.useCallback((event) => {
    if (!hasLockedWorkspace || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (!isWorkspaceDragActive) {
      setIsWorkspaceDragActive(true);
    }
  }, [hasDraggedFiles, hasLockedWorkspace, isWorkspaceDragActive]);

  const handleWorkspaceDragLeave = React.useCallback((event) => {
    if (!hasLockedWorkspace || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    workspaceDragCounterRef.current = Math.max(0, workspaceDragCounterRef.current - 1);
    if (workspaceDragCounterRef.current === 0) {
      setIsWorkspaceDragActive(false);
    }
  }, [hasDraggedFiles, hasLockedWorkspace]);

  const handleWorkspaceDrop = React.useCallback((event) => {
    if (!hasLockedWorkspace || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const droppedFiles = Array.from(event.dataTransfer?.files || []).filter(Boolean);
    resetWorkspaceDragState();
    if (droppedFiles.length === 0) return;
    void copyDroppedFilesToWorkspace(droppedFiles);
  }, [copyDroppedFilesToWorkspace, hasDraggedFiles, hasLockedWorkspace, resetWorkspaceDragState]);

  const handleDeleteWorkspaceNode = React.useCallback(async ({ absolutePath, isDirectory, node }) => {
    const normalizedPath = normalizePath(absolutePath).trim();
    const targetName = String(node?.name || getBaseName(normalizedPath) || '').trim();
    if (!normalizedPath || !targetName) return;

    const targetLabel = isDirectory ? '文件夹' : '文件';
    const deleteContent = `删除后不可恢复，确认删除${targetLabel}「${targetName}」吗？`;
    const confirmed = window?.modal?.confirm
      ? await new Promise((resolve) => {
          window.modal.confirm({
            title: `确认删除${targetLabel}`,
            content: deleteContent,
            okText: '删除',
            cancelText: '取消',
            centered: true,
            okType: 'danger',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        })
      : window.confirm(deleteContent);
    if (!confirmed) return;

    try {
      if (isDirectory) {
        await window.api.file.deleteExternalDir(normalizedPath);
      } else {
        await window.api.file.deleteExternalFile(normalizedPath);
      }

      if (currentWorkspacePath) {
        await loadWorkspaceTree(currentWorkspacePath);
      }
      message.success(`已删除${targetLabel}：${targetName}`);
    } catch (error) {
      window.toast.error(error?.message || `删除${targetLabel}失败`);
    }
  }, [currentWorkspacePath, loadWorkspaceTree]);

  return (
    <>
      <div
        className="chat-panel__workspace-header"
        onClick={toggleWorkspaceExpanded}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleWorkspaceExpanded();
          }
        }}>
        <div className="chat-panel__workspace-header-main">
          <div className="chat-panel__members-title chat-panel__members-title--secondary chat-panel__workspace-title">
            {hasLockedWorkspace ? getBaseName(currentWorkspacePath) : '工作空间'}
          </div>
        </div>
        {hasLockedWorkspace && (
          <div className="chat-panel__workspace-header-actions">
            <button
              type="button"
              className="chat-panel__member-action"
              onClick={refreshWorkspaceTree}
              disabled={Boolean(workspaceTreeLoading[currentWorkspacePath])}
              title="刷新工作空间">
              <RefreshCw
                size={12}
                aria-hidden="true"
                className={workspaceTreeLoading[currentWorkspacePath] ? 'chat-panel__action-icon-spinning' : ''}
              />
            </button>
            <button
              type="button"
              className="chat-panel__member-action"
              onClick={(event) => openWorkspaceInFinder(event, currentWorkspacePath)}
              title="打开文件管理器">
              <ExternalLink size={12} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {workspaceExpanded && (
        <div
          className={`chat-panel__workspace-section ${hasLockedWorkspace ? 'is-bound' : ''} ${isWorkspaceDragActive ? 'drag-active' : ''}`.trim()}
          onDragEnter={handleWorkspaceDragEnter}
          onDragOver={handleWorkspaceDragOver}
          onDragLeave={handleWorkspaceDragLeave}
          onDrop={handleWorkspaceDrop}
        >
          {!hasLockedWorkspace && (
            <>
              <div className="chat-panel__workspace-actions">
                <button
                  type="button"
                  className="chat-panel__members-create-btn chat-panel__members-create-btn--stacked"
                  disabled={Boolean(workspaceStatus)}
                  onClick={(event) => void handleAddWorkspace(event)}>
                  <FolderOpen size={14} aria-hidden="true" />
                  <span>打开文件夹</span>
                </button>
                <button
                  type="button"
                  className="chat-panel__members-create-btn chat-panel__members-create-btn--stacked"
                  ref={beginnerGuideCreateWorkspaceButtonRef}
                  disabled={Boolean(workspaceStatus)}
                  onClick={handleOpenCreateWorkspaceDialog}>
                  <FolderPlus size={14} aria-hidden="true" />
                  <span>新建工作空间</span>
                </button>
              </div>
              {workspaceStatus && (
                <div className="chat-panel__members-empty">{workspaceStatus}</div>
              )}
              {visibleRecentWorkspaces.map((workspacePath) => (
                <div key={workspacePath} className="chat-panel__member-group chat-panel__member-group--history">
                  <div className="chat-panel__member-item chat-panel__member-item--history">
                    <button
                      type="button"
                      className="chat-panel__member-main chat-panel__member-main--history"
                      onClick={() => void bindWorkspace(workspacePath)}
                      title={workspacePath}>
                      <span className="chat-panel__tree-icon" aria-hidden="true">
                        <Folder size={14} />
                      </span>
                      <span className="chat-panel__member-text chat-panel__member-text--history">
                        <span className="chat-panel__member-name chat-panel__member-name--history">{getBaseName(workspacePath)}</span>
                      </span>
                    </button>
                  </div>
                </div>
              ))}
              {recentWorkspacePaths.length > 5 && (
                <button
                  type="button"
                  className="chat-panel__workspace-more-btn"
                  onClick={() => setShowAllRecentWorkspaces((prev) => !prev)}>
                  {showAllRecentWorkspaces ? '收起' : '查看更多'}
                </button>
              )}
            </>
          )}
          {hasLockedWorkspace && (
            <>
              {isWorkspaceDragActive ? (
                <div className="chat-panel__workspace-drag-upload-overlay" aria-hidden="true">
                  <div className="chat-panel__workspace-drag-upload-card">
                    <UploadIcon className="chat-panel__workspace-drag-upload-icon" />
                    <div className="chat-panel__workspace-drag-upload-text">
                      {workspaceDropPending ? '正在添加文件到工作空间' : '将文件拖放到此处以添加到工作空间中'}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="chat-panel__workspace-tree">
                {workspaceTreeLoading[currentWorkspacePath] && <div className="chat-panel__members-empty">加载目录中...</div>}
                {!workspaceTreeLoading[currentWorkspacePath] && (workspaceTrees[currentWorkspacePath] || []).length === 0 && (
                  <div className="chat-panel__members-empty">工作空间为空</div>
                )}
                {!workspaceTreeLoading[currentWorkspacePath] && (workspaceTrees[currentWorkspacePath] || []).length > 0 && (
                  renderTreeNodes(`workspace:${currentWorkspacePath}`, currentWorkspacePath, workspaceTrees[currentWorkspacePath], 0, {
                    showDeleteAction: true,
                    onDeleteNode: handleDeleteWorkspaceNode,
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
      <WorkspaceCreateDialog
        open={createWorkspaceDialogOpen}
        parentDir={createWorkspaceParentDir}
        workspaceName={createWorkspaceName}
        workspaceNameError={createWorkspaceNameError}
        submitting={createWorkspaceSubmitting}
        dialogRef={beginnerGuideWorkspaceDialogRef}
        workspaceNameInputRef={beginnerGuideWorkspaceNameInputRef}
        onClose={() => {
          if (createWorkspaceSubmitting) return;
          setCreateWorkspaceDialogOpen(false);
        }}
        onPickParentDir={handlePickWorkspaceParentDir}
        onWorkspaceNameChange={(value) => {
          setCreateWorkspaceName(value);
          if (createWorkspaceNameError) {
            setCreateWorkspaceNameError('');
          }
        }}
        onConfirm={() => void handleCreateWorkspace()}
      />
    </>
  );
};

export default WorkSpace;
