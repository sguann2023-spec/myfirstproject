import React from 'react';
import { message } from 'antd';
import {
  readWorkspaceParentDirForAgent,
  resolveWorkspaceParentDirForAgent,
  writeWorkspaceParentDirForAgent
} from '../../../../shared/workspaceParentDir';

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

export function useWorkspaceController({
  agentId,
  chatSessionId = '',
  resolvedSessionId = '',
  currentWorkspacePath: workspacePath = '',
  hasLockedWorkspace = false,
  workspaceStatus = '',
  onBindWorkspace,
  onAddWorkspaceFile,
} = {}) {
  const currentWorkspacePath = normalizePath(workspacePath);
  const [fileContextMenu, setFileContextMenu] = React.useState(null);
  const closeFileContextMenu = React.useCallback(() => setFileContextMenu(null), []);
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
  const [operationPending, setOperationPending] = React.useState(false);
  const mountedRef = React.useRef(true);
  const operationRef = React.useRef(null);
  const pendingCreateRef = React.useRef(null);
  const dropRequestRef = React.useRef(null);
  const treeRequestsRef = React.useRef(new Map());
  const treeRequestIdRef = React.useRef(0);
  // A runtime id appearing on the first message is not a new conversation.
  const sessionKey = JSON.stringify([String(agentId || ''), String(chatSessionId || '')]);
  const sessionRef = React.useRef({ key: sessionKey, generation: 0 });
  if (sessionRef.current.key !== sessionKey) {
    sessionRef.current = { key: sessionKey, generation: sessionRef.current.generation + 1 };
  }
  const generation = sessionRef.current.generation;
  const inputsRef = React.useRef(null);
  inputsRef.current = { currentWorkspacePath, hasLockedWorkspace, workspaceStatus, onBindWorkspace };
  const isCurrentSession = React.useCallback((targetGeneration) => (
    mountedRef.current && sessionRef.current.generation === targetGeneration
  ), []);
  const isCurrentOperation = React.useCallback((operation) => (
    Boolean(operation) && operationRef.current === operation && isCurrentSession(operation.generation)
  ), [isCurrentSession]);
  const finishOperation = React.useCallback((operation, success = false) => {
    if (pendingCreateRef.current?.operation === operation) {
      pendingCreateRef.current.resolve(Boolean(success));
      pendingCreateRef.current = null;
    }
    if (operationRef.current !== operation) return;
    operationRef.current = null;
    if (mountedRef.current) setOperationPending(false);
  }, []);
  const beginOperation = React.useCallback((type) => {
    if (!mountedRef.current || operationRef.current || inputsRef.current.workspaceStatus) return null;
    const operation = { type, generation: sessionRef.current.generation, submitting: false, picking: false };
    operationRef.current = operation;
    setOperationPending(true);
    return operation;
  }, []);

  React.useLayoutEffect(() => {
    const operation = operationRef.current;
    if (operation && operation.generation !== generation) finishOperation(operation);
    treeRequestsRef.current.clear();
    setWorkspaceTrees({});
    setWorkspaceTreeLoading({});
    setCreateWorkspaceDialogOpen(false);
    setCreateWorkspaceSubmitting(false);
    setCreateWorkspaceName('');
    setCreateWorkspaceNameError('');
    setFileContextMenu(null);
    dropRequestRef.current = null;
    setWorkspaceDropPending(false);
    setIsWorkspaceDragActive(false);
    workspaceDragCounterRef.current = 0;
    if (workspaceRefreshTimeoutRef.current) {
      window.clearTimeout(workspaceRefreshTimeoutRef.current);
      workspaceRefreshTimeoutRef.current = null;
    }
  }, [generation, finishOperation]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (operationRef.current) finishOperation(operationRef.current);
      treeRequestsRef.current.clear();
    };
  }, [finishOperation]);

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
        candidatePaths.map(async (workspacePath) => {
          try {
            return { workspacePath, exists: await api.isDirectory(workspacePath) };
          } catch (_error) {
            // An IPC failure is not evidence that a recent workspace was deleted.
            return { workspacePath, exists: true };
          }
        })
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

  React.useEffect(() => {
    const invalidate = () => {
      setWorkspaceStore(readWorkspaceStore());
      treeRequestsRef.current.clear();
      setWorkspaceTrees({});
      setWorkspaceTreeLoading({});
    };
    window.addEventListener('workspace-renamed', invalidate);
    return () => window.removeEventListener('workspace-renamed', invalidate);
  }, []);

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
    setWorkspaceExpanded(true);
    setShowAllRecentWorkspaces(false);
  }, [workspaceStorePathSignature]);

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
    if (!workspaceKey || !mountedRef.current) return false;
    const request = { id: ++treeRequestIdRef.current, generation: sessionRef.current.generation };
    treeRequestsRef.current.set(workspaceKey, request);
    const isCurrentRequest = () => (
      isCurrentSession(request.generation) && treeRequestsRef.current.get(workspaceKey) === request
    );
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
      if (!isCurrentRequest()) return false;

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

      if (!isCurrentRequest()) return false;
      setWorkspaceTrees((prev) => ({
        ...prev,
        [workspaceKey]: buildTreeFromEntries(workspaceKey, normalizedEntries, new Map(directoryChecks))
      }));
      return true;
    } catch (_error) {
      if (isCurrentRequest()) setWorkspaceTrees((prev) => ({ ...prev, [workspaceKey]: [] }));
      return false;
    } finally {
      if (isCurrentRequest()) {
        treeRequestsRef.current.delete(workspaceKey);
        setWorkspaceTreeLoading((prev) => ({ ...prev, [workspaceKey]: false }));
      }
    }
  }, [isCurrentSession]);

  const ensureTree = React.useCallback(() => {
    if (!hasLockedWorkspace || !currentWorkspacePath) return Promise.resolve(false);
    if (Object.prototype.hasOwnProperty.call(workspaceTrees, currentWorkspacePath)) return Promise.resolve(true);
    if (treeRequestsRef.current.has(currentWorkspacePath)) return Promise.resolve(false);
    return loadWorkspaceTree(currentWorkspacePath);
  }, [currentWorkspacePath, hasLockedWorkspace, loadWorkspaceTree, workspaceTrees]);

  React.useEffect(() => {
    void ensureTree();
  }, [ensureTree, generation]);

  const scheduleWorkspaceTreeRefresh = React.useCallback((workspacePath) => {
    const workspaceKey = normalizePath(workspacePath);
    if (!workspaceKey) return;
    if (workspaceRefreshTimeoutRef.current) {
      window.clearTimeout(workspaceRefreshTimeoutRef.current);
    }
    const targetGeneration = sessionRef.current.generation;
    workspaceRefreshTimeoutRef.current = window.setTimeout(() => {
      workspaceRefreshTimeoutRef.current = null;
      if (!isCurrentSession(targetGeneration) || inputsRef.current.currentWorkspacePath !== workspaceKey) return;
      void loadWorkspaceTree(workspaceKey);
    }, 120);
  }, [isCurrentSession, loadWorkspaceTree]);

  React.useEffect(() => () => {
    if (workspaceRefreshTimeoutRef.current) {
      window.clearTimeout(workspaceRefreshTimeoutRef.current);
      workspaceRefreshTimeoutRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    const api = window?.electronAPI?.cherryChatStream;
    const targetSessionId = String(resolvedSessionId || '').trim();
    if (!targetSessionId || !hasLockedWorkspace || !currentWorkspacePath || typeof api?.onChunk !== 'function') return undefined;

    return api.onChunk((payload) => {
      if (!isCurrentSession(generation)) return;
      if (String(payload?.sessionId || '').trim() !== targetSessionId) return;
      if (!shouldRefreshWorkspaceForChunk(payload, currentWorkspacePath)) return;
      scheduleWorkspaceTreeRefresh(currentWorkspacePath);
    });
  }, [
    currentWorkspacePath,
    generation,
    hasLockedWorkspace,
    isCurrentSession,
    resolvedSessionId,
    scheduleWorkspaceTreeRefresh,
  ]);

  const bindWorkspaceForOperation = React.useCallback(async (selectedPath, options, operation) => {
    const normalizedSelected = normalizePath(selectedPath);
    if (!normalizedSelected || !isCurrentOperation(operation)) return false;
    const bind = inputsRef.current.onBindWorkspace;
    if (typeof bind !== 'function') return false;
    const success = await bind(normalizedSelected, options);
    if (!isCurrentOperation(operation)) return false;
    if (success) persistVisitedWorkspace(normalizedSelected);
    return Boolean(success);
  }, [isCurrentOperation, persistVisitedWorkspace]);

  const bindWorkspace = React.useCallback(async (selectedPath, options = {}) => {
    const operation = beginOperation('bind');
    if (!operation) return false;
    try {
      return await bindWorkspaceForOperation(selectedPath, options, operation);
    } catch (_error) {
      if (isCurrentOperation(operation)) window.toast.error('打开文件夹失败');
      return false;
    } finally {
      finishOperation(operation);
    }
  }, [beginOperation, bindWorkspaceForOperation, finishOperation, isCurrentOperation]);

  const openWorkspace = React.useCallback(async (event) => {
    event?.stopPropagation?.();
    const operation = beginOperation('open');
    if (!operation) return false;
    try {
      const selected = await window.api.file.selectFolder();
      if (!isCurrentOperation(operation) || !selected) return false;
      return await bindWorkspaceForOperation(selected, {}, operation);
    } catch (_error) {
      if (isCurrentOperation(operation)) window.toast.error('打开文件夹失败');
      return false;
    } finally {
      finishOperation(operation);
    }
  }, [beginOperation, bindWorkspaceForOperation, finishOperation, isCurrentOperation]);

  const closeCreateWorkspaceDialog = React.useCallback(() => {
    const operation = operationRef.current;
    if (operation?.type !== 'create') return;
    // Also used by the host when the preview closes, even while IPC is pending.
    // Native operations cannot be aborted, but their completions must be ignored.
    finishOperation(operation);
    setCreateWorkspaceDialogOpen(false);
    setCreateWorkspaceSubmitting(false);
    setCreateWorkspaceName('');
    setCreateWorkspaceNameError('');
  }, [finishOperation]);

  const createWorkspace = React.useCallback((event) => {
    event?.stopPropagation?.();
    const operation = beginOperation('create');
    if (!operation) return Promise.resolve(false);
    const result = new Promise((resolve) => {
      pendingCreateRef.current = { operation, resolve };
    });

    const openDialog = async () => {
      let nextParentDir = readCreateWorkspaceParentForAgent(agentId);
      if (!nextParentDir) {
        try {
          const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
          if (!isCurrentOperation(operation)) return;
          nextParentDir = normalizePath(resolveWorkspaceParentDirForAgent({
            agentId,
            appDataPath: normalizePath(appInfo?.appDataPath || ''),
            joinPath: window?.electronAPI?.path?.join
          }));
        } catch (_error) {
          if (!isCurrentOperation(operation)) return;
        }
      }
      if (!isCurrentOperation(operation)) return;
      if (!nextParentDir) {
        nextParentDir = getParentPath(currentWorkspacePath || recentWorkspacePaths[0] || '');
      }
      setCreateWorkspaceParentDir(nextParentDir);
      setCreateWorkspaceName('');
      setCreateWorkspaceNameError('');
      setCreateWorkspaceDialogOpen(true);
    };
    void openDialog().catch((error) => {
      if (isCurrentOperation(operation)) window.toast.error(error?.message || '新建工作空间失败');
      finishOperation(operation);
    });
    return result;
  }, [agentId, beginOperation, currentWorkspacePath, finishOperation, isCurrentOperation, recentWorkspacePaths]);

  const handlePickWorkspaceParentDir = React.useCallback(async () => {
    const operation = operationRef.current;
    if (operation?.type !== 'create' || operation.submitting || operation.picking || !isCurrentOperation(operation)) return;
    operation.picking = true;
    try {
      const parentDir = await window.api.file.selectFolder();
      if (!isCurrentOperation(operation) || !parentDir) return;
      const normalizedParentDir = normalizePath(parentDir);
      setCreateWorkspaceParentDir(normalizedParentDir);
      setCreateWorkspaceNameError('');
      writeCreateWorkspaceParentForAgent(agentId, normalizedParentDir);
    } catch (_error) {
      if (isCurrentOperation(operation)) window.toast.error('选择目录失败');
    } finally {
      operation.picking = false;
    }
  }, [agentId, isCurrentOperation]);

  const handleCreateWorkspace = React.useCallback(async () => {
    const operation = operationRef.current;
    const parentDir = normalizePath(createWorkspaceParentDir);
    const normalizedName = String(createWorkspaceName || '').trim();
    if (operation?.type !== 'create' || operation.submitting || operation.picking || !isCurrentOperation(operation)) return false;
    if (!parentDir || !normalizedName) return false;

    operation.submitting = true;
    setCreateWorkspaceSubmitting(true);
    setCreateWorkspaceNameError('');
    try {
      const checkResult = await window.api.file.checkFileName(parentDir, normalizedName, false);
      if (!isCurrentOperation(operation)) return false;
      const folderName = String(checkResult?.safeName || normalizedName).trim();
      if (!folderName) {
        window.toast.error('工作空间名称无效');
        return false;
      }
      if (checkResult?.requestedExists) {
        setCreateWorkspaceNameError(`名称“${normalizedName}”已被占用`);
        return false;
      }
      const joinPath = window?.electronAPI?.path?.join;
      const nextWorkspacePath = normalizePath(
        typeof joinPath === 'function' ? joinPath(parentDir, folderName) : `${parentDir}/${folderName}`
      );
      await window.api.file.mkdir(nextWorkspacePath);
      if (!isCurrentOperation(operation)) return false;
      writeCreateWorkspaceParentForAgent(agentId, parentDir);
      const success = await bindWorkspaceForOperation(nextWorkspacePath, { seedSkills: true }, operation);
      if (!isCurrentOperation(operation)) return false;
      if (success) {
        setCreateWorkspaceDialogOpen(false);
        setCreateWorkspaceName('');
        setCreateWorkspaceNameError('');
        setCreateWorkspaceSubmitting(false);
        finishOperation(operation, true);
      }
      return success;
    } catch (error) {
      if (isCurrentOperation(operation)) window.toast.error(error?.message || '新建工作空间失败');
      return false;
    } finally {
      operation.submitting = false;
      if (isCurrentOperation(operation)) setCreateWorkspaceSubmitting(false);
    }
  }, [agentId, bindWorkspaceForOperation, createWorkspaceName, createWorkspaceParentDir, finishOperation, isCurrentOperation]);

  const changeCreateWorkspaceName = React.useCallback((value) => {
    setCreateWorkspaceName(value);
    setCreateWorkspaceNameError('');
  }, []);

  const openWorkspaceInFinder = React.useCallback((event, targetPath) => {
    event?.stopPropagation?.();
    const path = targetPath || inputsRef.current.currentWorkspacePath;
    if (!path) return;
    return window.api.file.openPath(path);
  }, []);

  const refreshWorkspaceTree = React.useCallback((event) => {
    event?.stopPropagation?.();
    const path = inputsRef.current.currentWorkspacePath;
    if (!path) return Promise.resolve(false);
    return loadWorkspaceTree(path);
  }, [loadWorkspaceTree]);

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
    if (droppedEntries.length === 0 || dropRequestRef.current) return;
    const request = { generation: sessionRef.current.generation };
    dropRequestRef.current = request;
    const isCurrentDrop = () => (
      isCurrentSession(request.generation) && dropRequestRef.current === request &&
      inputsRef.current.currentWorkspacePath === workspacePath
    );
    setWorkspaceDropPending(true);
    try {
      let successCount = 0;
      for (const file of droppedEntries) {
        const sourcePath = normalizePath(fileApi.getPathForFile(file) || '').trim();
        if (!sourcePath) {
          continue;
        }
        const targetPath = await resolveWorkspaceDropPath(workspacePath, file.name || getBaseName(sourcePath));
        if (!isCurrentDrop()) return;
        if (!targetPath) {
          throw new Error('生成目标路径失败');
        }
        const copyResult = await copyApi(sourcePath, targetPath);
        if (!isCurrentDrop()) return;
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
      if (!isCurrentDrop()) return;
      message.success(
        successCount > 1
          ? `已添加 ${successCount} 个文件到工作空间`
          : '已添加 1 个文件到工作空间'
      );
    } catch (error) {
      if (isCurrentDrop()) window.toast.error(error?.message || '拖拽导入工作空间失败');
    } finally {
      if (dropRequestRef.current === request) {
        dropRequestRef.current = null;
        if (isCurrentSession(request.generation)) setWorkspaceDropPending(false);
      }
    }
  }, [currentWorkspacePath, isCurrentSession, loadWorkspaceTree, resolveWorkspaceDropPath]);

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

    const targetGeneration = sessionRef.current.generation;
    const isCurrentDelete = () => isCurrentSession(targetGeneration) && inputsRef.current.currentWorkspacePath === currentWorkspacePath;
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
    if (!confirmed || !isCurrentDelete()) return;

    try {
      if (isDirectory) {
        await window.api.file.deleteExternalDir(normalizedPath);
      } else {
        await window.api.file.deleteExternalFile(normalizedPath);
      }

      if (!isCurrentDelete()) return;
      if (currentWorkspacePath) {
        await loadWorkspaceTree(currentWorkspacePath);
      }
      if (isCurrentDelete()) message.success(`已删除${targetLabel}：${targetName}`);
    } catch (error) {
      if (isCurrentDelete()) window.toast.error(error?.message || `删除${targetLabel}失败`);
    }
  }, [currentWorkspacePath, isCurrentSession, loadWorkspaceTree]);

  const openFileContextMenu = React.useCallback((event, entry) => {
    event.preventDefault();
    event.stopPropagation();
    setFileContextMenu({ ...entry, x: event.clientX, y: event.clientY });
  }, []);

  return {
    currentWorkspacePath, hasLockedWorkspace, workspaceStatus,
    busy: Boolean(workspaceStatus || operationPending || workspaceDropPending),
    openWorkspace, createWorkspace, bindWorkspace,
    refreshWorkspaceTree, openWorkspaceInFinder, ensureTree,
    workspaceExpanded, toggleWorkspaceExpanded,
    workspaceTrees, workspaceTreeLoading,
    recentWorkspacePaths, visibleRecentWorkspaces,
    showAllRecentWorkspaces, setShowAllRecentWorkspaces,
    isWorkspaceDragActive, workspaceDropPending,
    handleWorkspaceDragEnter, handleWorkspaceDragOver, handleWorkspaceDragLeave, handleWorkspaceDrop,
    handleDeleteWorkspaceNode, openFileContextMenu, fileContextMenu, closeFileContextMenu,
    onAddWorkspaceFile,
    createWorkspaceDialogOpen, createWorkspaceParentDir, createWorkspaceName,
    createWorkspaceNameError, createWorkspaceSubmitting,
    closeCreateWorkspaceDialog, handlePickWorkspaceParentDir,
    changeCreateWorkspaceName, handleCreateWorkspace,
  };
}

