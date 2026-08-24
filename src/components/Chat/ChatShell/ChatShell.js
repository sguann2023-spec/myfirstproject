import React from 'react';
import { createPortal } from 'react-dom';
import { Tooltip, Tour, message } from 'antd';
import {
  Check,
  ChevronRight,
  ExternalLink,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileVideoCamera,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  SquarePen,
  Trash2,
  RefreshCw,
  Upload as UploadIcon,
  X,
} from 'lucide-react';
import './ChatShell.css';
import SidebarToggleIcon from '../../Icons/SidebarToggleIcon';
import NewChatIcon from '../../../../public/new_chat.svg';
import SkillMembersSection from './SkillMembers/SkillMembersSection';
import WebPagePreview from './WebPagePreview';
import { claimNewguiderReward } from '../../../api/newguiderReward';
import { loggerService } from '@logger';
import {
  BEGINNER_GUIDE_COMPLETED_KEY,
  BEGINNER_GUIDE_REOPEN_PENDING_KEY,
  clearBeginnerGuideReopen,
  isBeginnerGuideCompleted,
  isBeginnerGuideReopenPending,
  setBeginnerGuideCompleted
} from '../../../shared/beginnerGuide';

const logger = loggerService.withContext('ChatShell');

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
const areSameFileName = (left, right) => {
  const normalizedLeft = String(left || '').trim();
  const normalizedRight = String(right || '').trim();
  if (isWindows) {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
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
const isPathInsideRoot = (candidatePath, rootPath) => {
  const normalizedCandidate = normalizeComparablePath(candidatePath);
  const normalizedRoot = normalizeComparablePath(rootPath);
  if (!normalizedCandidate || !normalizedRoot) return false;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
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
const CODE_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'jsx', 'mjs',
  'php', 'py', 'rb', 'rs', 'sass', 'scss', 'sh', 'sql', 'swift', 'ts', 'tsx', 'vue',
  'xml', 'yaml', 'yml', 'json'
]);
const TERMINAL_EXTENSIONS = new Set(['bash', 'command', 'fish', 'ps1', 'zsh']);
const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mov', 'mp4', 'mkv', 'webm']);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba']);
const ARCHIVE_EXTENSIONS = new Set(['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'xz', 'zip']);
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'numbers', 'ods', 'tsv', 'xls', 'xlsx']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
const TEXT_PREVIEW_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'conf', 'config', 'env', 'ini', 'toml', 'graphql', 'gql',
  'csv', 'tsv', 'gitignore', 'editorconfig'
]);
const BEGINNER_GUIDE_TITLE = '新手引导，完成获赠100积分';
const CHILDRENS_BOOK_SKILL_LABEL = '儿童绘本';
const getFileExtension = (fileName = '') => {
  const normalized = String(fileName || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.startsWith('.') && !normalized.slice(1).includes('.')) return normalized.slice(1);
  const segments = normalized.split('.');
  return segments.length > 1 ? segments.pop() || '' : '';
};
const getFileIcon = (fileName = '') => {
  const extension = getFileExtension(fileName);
  if (TERMINAL_EXTENSIONS.has(extension)) return FileTerminal;
  if (CODE_EXTENSIONS.has(extension)) return FileCode;
  if (IMAGE_EXTENSIONS.has(extension)) return FileImage;
  if (VIDEO_EXTENSIONS.has(extension)) return FileVideoCamera;
  if (ARCHIVE_EXTENSIONS.has(extension)) return FileArchive;
  if (SPREADSHEET_EXTENSIONS.has(extension)) return FileSpreadsheet;
  return FileText;
};
const getPreviewKindForFileName = (fileName = '') => {
  const extension = getFileExtension(fileName);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (CODE_EXTENSIONS.has(extension) || TERMINAL_EXTENSIONS.has(extension)) return 'code';
  if (TEXT_PREVIEW_EXTENSIONS.has(extension)) return 'text';
  return null;
};
const createFilePreviewUrl = (filePath = '') => {
  const normalizedPath = normalizePath(filePath).trim();
  if (!normalizedPath) return '';
  const normalizedPathname = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  return encodeURI(`file://${normalizedPathname}`);
};
const dedupePaths = (paths) => Array.from(new Set((Array.isArray(paths) ? paths : []).map((path) => normalizePath(path)).filter(Boolean)));
const getConfigObject = (value) => (value && typeof value === 'object' ? value : {});
const getSelectedWorkspacePath = (session) => {
  const config = getConfigObject(session?.configuration);
  const configuredPath = normalizePath(config?.selected_workspace_path || '');
  if (configuredPath) return configuredPath;
  return normalizePath(session?.accessible_paths?.[0] || '');
};
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
const replaceWorkspacePathInStore = (store, previousPath, nextPath) => {
  const normalizedPreviousPath = normalizePath(previousPath);
  const normalizedNextPath = normalizePath(nextPath);
  if (!normalizedPreviousPath || !normalizedNextPath) {
    return {
      library: getWorkspaceLibrary(store?.library),
      recent: dedupePaths(store?.recent),
      accessTimes: normalizeWorkspaceAccessTimes(store?.accessTimes)
    };
  }

  const library = getWorkspaceLibrary(
    (store?.library || []).map((path) => (normalizePath(path) === normalizedPreviousPath ? normalizedNextPath : path))
  );
  const recent = dedupePaths(
    (store?.recent || []).map((path) => (normalizePath(path) === normalizedPreviousPath ? normalizedNextPath : path))
  );
  const accessTimes = normalizeWorkspaceAccessTimes(store?.accessTimes, [...library, ...recent]);
  const previousVisitedAt = accessTimes[normalizedPreviousPath];
  if (previousVisitedAt && !accessTimes[normalizedNextPath]) {
    accessTimes[normalizedNextPath] = previousVisitedAt;
  }
  delete accessTimes[normalizedPreviousPath];

  return {
    library,
    recent,
    accessTimes: normalizeWorkspaceAccessTimes(accessTimes, [...library, ...recent])
  };
};
const removeWorkspacePathFromStore = (store, workspacePath) => {
  const normalizedWorkspacePath = normalizePath(workspacePath);
  const allowedPaths = dedupePaths([...(store?.library || []), ...(store?.recent || [])])
    .filter((path) => normalizePath(path) !== normalizedWorkspacePath);
  return filterWorkspaceStorePaths(store, allowedPaths);
};
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
const isSameWorkspaceStore = (left, right) => {
  const normalizedLeft = filterWorkspaceStorePaths(left, [...(left?.library || []), ...(left?.recent || [])]);
  const normalizedRight = filterWorkspaceStorePaths(right, [...(right?.library || []), ...(right?.recent || [])]);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
};
const getRecentWorkspacePaths = (agent, library) => {
  const normalizedLibrary = getWorkspaceLibrary(library);
  const configuredRecent = dedupePaths(agent?.recent).filter((path) => normalizedLibrary.includes(path));
  const fallbackOrder = [...configuredRecent, ...normalizedLibrary.filter((path) => !configuredRecent.includes(path))];
  const fallbackIndexMap = new Map(fallbackOrder.map((path, index) => [path, index]));
  const accessTimes = normalizeWorkspaceAccessTimes(agent?.accessTimes, fallbackOrder);
  return [...normalizedLibrary].sort((left, right) => {
    const accessDiff = (accessTimes[right] || 0) - (accessTimes[left] || 0);
    if (accessDiff !== 0) return accessDiff;
    return (fallbackIndexMap.get(left) ?? Number.MAX_SAFE_INTEGER) - (fallbackIndexMap.get(right) ?? Number.MAX_SAFE_INTEGER);
  });
};
const WORKSPACE_STORE_KEY = 'chat-workspaces:v1';
const WORKSPACE_CREATE_PARENT_STORE_KEY = 'chat-workspace-create-parent:v1';
const WEB_PREVIEW_WIDTH_STORE_KEY = 'chat-web-preview-width:v1';
const MEMBERS_PANEL_WIDTH_STORE_KEY = 'chat-members-panel-width:v1';
const MEMBERS_PANEL_COLLAPSED_STORE_KEY = 'chat-members-panel-collapsed:v1';
const TREE_LIST_MAX_ENTRIES = 20000;
const DEFAULT_PREVIEW_PANE_WIDTH = 400;
const DEFAULT_MEMBERS_PANEL_WIDTH = 180;
const MIN_MEMBERS_PANEL_WIDTH = 160;
const MAX_MEMBERS_PANEL_WIDTH = 360;
const MEMBERS_PANEL_RESIZER_WIDTH = 8;
const WEB_PREVIEW_RESIZER_WIDTH = 8;
const MIN_WEB_PREVIEW_WIDTH = 320;
const MIN_MAIN_PANEL_WIDTH = 260;
const MAX_WEB_PREVIEW_WIDTH = 880;
const isWindows = typeof process !== 'undefined' && process.platform === 'win32';
const getWorkspaceLibrary = (paths) => dedupePaths(paths);
const clampMembersPanelWidth = (nextWidth, containerWidth, hasLeadingFilePreview = false, trailingWebPreviewWidth = 0) => {
  const safeContainerWidth = Number(containerWidth) || 0;
  const leadingWidth = hasLeadingFilePreview ? DEFAULT_PREVIEW_PANE_WIDTH : 0;
  const trailingWidth = Math.max(0, Number(trailingWebPreviewWidth) || 0);
  const computedMaxWidth = safeContainerWidth > 0
    ? safeContainerWidth - leadingWidth - trailingWidth - MIN_MAIN_PANEL_WIDTH - MEMBERS_PANEL_RESIZER_WIDTH - (trailingWidth > 0 ? WEB_PREVIEW_RESIZER_WIDTH : 0)
    : MAX_MEMBERS_PANEL_WIDTH;
  const maxWidth = Math.max(MIN_MEMBERS_PANEL_WIDTH, Math.min(MAX_MEMBERS_PANEL_WIDTH, computedMaxWidth));
  return Math.min(maxWidth, Math.max(MIN_MEMBERS_PANEL_WIDTH, Math.round(Number(nextWidth) || DEFAULT_MEMBERS_PANEL_WIDTH)));
};
const clampWebPreviewWidth = (
  nextWidth,
  containerWidth,
  hasLeadingFilePreview = false,
  membersPanelWidth = DEFAULT_MEMBERS_PANEL_WIDTH,
  membersPanelVisible = true
) => {
  const safeContainerWidth = Number(containerWidth) || 0;
  const leadingWidth = hasLeadingFilePreview ? DEFAULT_PREVIEW_PANE_WIDTH : 0;
  const occupiedMembersWidth = membersPanelVisible
    ? Math.max(MIN_MEMBERS_PANEL_WIDTH, Number(membersPanelWidth) || DEFAULT_MEMBERS_PANEL_WIDTH)
    : 0;
  const computedMaxWidth = safeContainerWidth > 0
    ? safeContainerWidth - leadingWidth - occupiedMembersWidth - MIN_MAIN_PANEL_WIDTH - (membersPanelVisible ? MEMBERS_PANEL_RESIZER_WIDTH : 0) - WEB_PREVIEW_RESIZER_WIDTH
    : MAX_WEB_PREVIEW_WIDTH;
  const maxWidth = Math.max(MIN_WEB_PREVIEW_WIDTH, Math.min(MAX_WEB_PREVIEW_WIDTH, computedMaxWidth));
  return Math.min(maxWidth, Math.max(MIN_WEB_PREVIEW_WIDTH, Math.round(Number(nextWidth) || DEFAULT_PREVIEW_PANE_WIDTH)));
};
const readMembersPanelWidth = () => {
  if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_MEMBERS_PANEL_WIDTH;
  try {
    return clampMembersPanelWidth(window.localStorage.getItem(MEMBERS_PANEL_WIDTH_STORE_KEY));
  } catch (_error) {
    return DEFAULT_MEMBERS_PANEL_WIDTH;
  }
};
const writeMembersPanelWidth = (width) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(MEMBERS_PANEL_WIDTH_STORE_KEY, String(Math.round(Number(width) || DEFAULT_MEMBERS_PANEL_WIDTH)));
  } catch (_error) {
    // ignore storage failures
  }
};
const readMembersPanelCollapsed = () => {
  if (typeof window === 'undefined' || !window.localStorage) return true;
  try {
    const rawValue = window.localStorage.getItem(MEMBERS_PANEL_COLLAPSED_STORE_KEY);
    if (rawValue == null) return true;
    return rawValue === 'true';
  } catch (_error) {
    return true;
  }
};
const writeMembersPanelCollapsed = (collapsed) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(MEMBERS_PANEL_COLLAPSED_STORE_KEY, collapsed ? 'true' : 'false');
  } catch (_error) {
    // ignore storage failures
  }
};
const readWebPreviewWidth = () => {
  if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_PREVIEW_PANE_WIDTH;
  try {
    return clampWebPreviewWidth(window.localStorage.getItem(WEB_PREVIEW_WIDTH_STORE_KEY));
  } catch (_error) {
    return DEFAULT_PREVIEW_PANE_WIDTH;
  }
};
const writeWebPreviewWidth = (width) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(WEB_PREVIEW_WIDTH_STORE_KEY, String(Math.round(Number(width) || DEFAULT_PREVIEW_PANE_WIDTH)));
  } catch (_error) {
    // ignore storage failures
  }
};
const readCreateWorkspaceParentStore = () => {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(WORKSPACE_CREATE_PARENT_STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_error) {
    return {};
  }
};
const readCreateWorkspaceParentForAgent = (agentId) => {
  const normalizedAgentId = String(agentId || '').trim();
  if (!normalizedAgentId) return '';
  return normalizePath(readCreateWorkspaceParentStore()?.[normalizedAgentId] || '');
};
const writeCreateWorkspaceParentForAgent = (agentId, parentDir) => {
  const normalizedAgentId = String(agentId || '').trim();
  const normalizedParentDir = normalizePath(parentDir);
  if (!normalizedAgentId || !normalizedParentDir || typeof window === 'undefined' || !window.localStorage) return;
  try {
    const prev = readCreateWorkspaceParentStore();
    window.localStorage.setItem(
      WORKSPACE_CREATE_PARENT_STORE_KEY,
      JSON.stringify({
        ...prev,
        [normalizedAgentId]: normalizedParentDir
      })
    );
  } catch (_error) {
    // ignore storage failures
  }
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

const getSkillKey = (skill) => String(skill?.id || skill?.folderName || skill?.filename || skill?.name || '').trim();
const getSkillFolderLabel = (skill) => String(skill?.folderName || skill?.filename || skill?.id || skill?.name || '').trim();
const getSkillDisplayName = (skill) => String(skill?.name || skill?.filename || skill?.id || '').trim();

const MarqueeText = ({ text, className = '' }) => {
  const containerRef = React.useRef(null);
  const contentRef = React.useRef(null);
  const [overflowDistance, setOverflowDistance] = React.useState(0);

  const measureOverflow = React.useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      setOverflowDistance(0);
      return;
    }
    const nextDistance = Math.max(0, content.scrollWidth - container.clientWidth);
    setOverflowDistance(nextDistance);
  }, []);

  React.useEffect(() => {
    measureOverflow();

    if (typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      measureOverflow();
    });

    if (containerRef.current) observer.observe(containerRef.current);
    if (contentRef.current) observer.observe(contentRef.current);

    return () => {
      observer.disconnect();
    };
  }, [measureOverflow, text]);

  const duration = overflowDistance > 0 ? Math.max(3.33, overflowDistance / 21.6) : 0;

  return (
    <span
      ref={containerRef}
      className={`${className} ${overflowDistance > 0 ? 'is-overflowing' : ''}`.trim()}
      style={overflowDistance > 0 ? {
        '--marquee-distance': `${overflowDistance}px`,
        '--marquee-duration': `${duration}s`
      } : undefined}
      title={text}>
      <span ref={contentRef} className="chat-panel__marquee-content">
        {text}
      </span>
    </span>
  );
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
          <h2 id="workspace-create-dialog-title" className="chat-panel__workspace-create-title">
            新建工作空间
          </h2>
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

const ChatShell = ({
  agentId,
  chatSessionId = '',
  runtimeSessionId,
  historyVisible = true,
  onToggleHistory,
  sessionTitle = '新对话',
  sessionTitleRenaming = false,
  sessionTitleNewlyRenamed = false,
  onRenameSessionTitle,
  onCreateSession,
  onEnsureRuntimeSession,
  workspaceStatus = '',
  currentModelMeta = null,
  onSelectSkill,
  onModifySkill,
  onSubmitFileComment,
  sessionSending = false,
  webPreview = null,
  onCloseWebPreview,
  onOpenWebPreview,
  onInlinePreviewVisibilityChange,
  childrensBookQuickPromptRef = null,
  beginnerGuideQuickSkillsViewportRef = null,
  beginnerGuideAiToolAreaRef = null,
  beginnerGuideModelPickerRef = null,
  beginnerGuideInputAreaRef = null,
  beginnerGuideDownloadPaneRef = null,
  beginnerGuideSettingsPaneRef = null,
  beginnerGuideEligible = false,
  onRefreshCredits,
  children
}) => {
  const [resolvedSessionId, setResolvedSessionId] = React.useState(runtimeSessionId || '');
  const [runtimeSession, setRuntimeSession] = React.useState(null);
  const [workspaceStore, setWorkspaceStore] = React.useState(() => readWorkspaceStore());
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(sessionTitle);
  const [skillsLoading, setSkillsLoading] = React.useState(true);
  const [skillsError, setSkillsError] = React.useState('');
  const [skills, setSkills] = React.useState([]);
  const [skillPreviewPaths, setSkillPreviewPaths] = React.useState({});
  const [skillExamplePaths, setSkillExamplePaths] = React.useState({});
  const [expandedSkillKeys, setExpandedSkillKeys] = React.useState(() => new Set());
  const [expandedNodeKeys, setExpandedNodeKeys] = React.useState(() => new Set());
  const [skillTrees, setSkillTrees] = React.useState({});
  const [skillTreeLoading, setSkillTreeLoading] = React.useState({});
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
  const [renamingWorkspacePath, setRenamingWorkspacePath] = React.useState('');
  const [renameWorkspaceDraft, setRenameWorkspaceDraft] = React.useState('');
  const [renameWorkspaceError, setRenameWorkspaceError] = React.useState('');
  const [renameWorkspaceSubmitting, setRenameWorkspaceSubmitting] = React.useState(false);
  const [filePreview, setFilePreview] = React.useState(null);
  const [panePreview, setPanePreview] = React.useState(() => (
    webPreview?.key && webPreview?.url
      ? { ...webPreview, previewType: 'web', activate: true }
      : null
  ));
  const [membersPanelWidth, setMembersPanelWidth] = React.useState(() => readMembersPanelWidth());
  const [membersPanelCollapsed, setMembersPanelCollapsed] = React.useState(() => readMembersPanelCollapsed());
  const [webPreviewWidth, setWebPreviewWidth] = React.useState(() => readWebPreviewWidth());
  const [isResizingMembersPanel, setIsResizingMembersPanel] = React.useState(false);
  const [isResizingWebPreview, setIsResizingWebPreview] = React.useState(false);
  const [beginnerGuideOpen, setBeginnerGuideOpen] = React.useState(false);
  const [beginnerGuideCurrent, setBeginnerGuideCurrent] = React.useState(0);
  const [beginnerGuideDone, setBeginnerGuideDone] = React.useState(() => isBeginnerGuideCompleted());
  const [beginnerGuideReopenPending, setBeginnerGuideReopenPending] = React.useState(() => isBeginnerGuideReopenPending());
  const previousChatSessionIdRef = React.useRef(String(chatSessionId || '').trim());
  const titleInputRef = React.useRef(null);
  const renameWorkspaceInputRef = React.useRef(null);
  const pendingFilePreviewKeysRef = React.useRef(new Set());
  const closedFilePreviewKeysRef = React.useRef(new Set());
  const contentRef = React.useRef(null);
  const beginnerGuideCreateWorkspaceButtonRef = React.useRef(null);
  const beginnerGuideWorkspaceDialogRef = React.useRef(null);
  const beginnerGuideWorkspaceNameInputRef = React.useRef(null);
  const beginnerGuideWebPreviewPaneRef = React.useRef(null);
  const beginnerGuideChildrensBookRunButtonRef = React.useRef(null);
  const beginnerGuideChildrensBookEditButtonRef = React.useRef(null);
  const beginnerGuideRewardClaimingRef = React.useRef(false);
  const workspaceRefreshTimeoutRef = React.useRef(null);
  const workspaceDragCounterRef = React.useRef(0);
  const workspaceLibrary = React.useMemo(() => getWorkspaceLibrary(workspaceStore?.library), [workspaceStore]);
  const recentWorkspacePaths = React.useMemo(
    () => getRecentWorkspacePaths(workspaceStore, workspaceLibrary),
    [workspaceStore, workspaceLibrary]
  );
  const currentWorkspacePath = React.useMemo(() => getSelectedWorkspacePath(runtimeSession), [runtimeSession]);
  const hasLockedWorkspace = Boolean(currentWorkspacePath);
  const visibleRecentWorkspaces = React.useMemo(
    () => (showAllRecentWorkspaces ? recentWorkspacePaths : recentWorkspacePaths.slice(0, 5)),
    [recentWorkspacePaths, showAllRecentWorkspaces]
  );
  const workspaceStorePathSignature = React.useMemo(
    () => dedupePaths([...(workspaceStore?.library || []), ...(workspaceStore?.recent || [])]).join('\n'),
    [workspaceStore?.library, workspaceStore?.recent]
  );
  const showLeadingFilePreview = false;
  const showTrailingWebPreview = Boolean(panePreview);
  const showMembersPanel = !membersPanelCollapsed;
  const isResizingAnyPanel = isResizingMembersPanel || isResizingWebPreview;
  const shouldAutoStartBeginnerGuide = Boolean(
    beginnerGuideEligible &&
    !beginnerGuideDone &&
    !hasLockedWorkspace
  );
  const shouldForceReopenBeginnerGuide = Boolean(beginnerGuideReopenPending);
  const shouldStartBeginnerGuide = shouldAutoStartBeginnerGuide || shouldForceReopenBeginnerGuide;
  React.useEffect(() => {
    if (!renamingWorkspacePath) return;
    const input = renameWorkspaceInputRef.current;
    if (!input) return;

    const timer = window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [renamingWorkspacePath]);

  React.useEffect(() => {
    if (typeof onInlinePreviewVisibilityChange !== 'function') return undefined;
    onInlinePreviewVisibilityChange(showTrailingWebPreview);
    return () => {
      onInlinePreviewVisibilityChange(false);
    };
  }, [onInlinePreviewVisibilityChange, showTrailingWebPreview]);

  const dismissBeginnerGuide = React.useCallback(() => {
    setBeginnerGuideOpen(false);
    setBeginnerGuideCurrent(0);
    setBeginnerGuideDone(true);
    setBeginnerGuideReopenPending(false);
    setBeginnerGuideCompleted(true);
    clearBeginnerGuideReopen();
  }, []);
  const completeBeginnerGuide = React.useCallback(async () => {
    logger.info('beginner guide finish triggered', {
      beginnerGuideDone,
      beginnerGuideReopenPending,
    });
    dismissBeginnerGuide();

    if (beginnerGuideRewardClaimingRef.current) {
      logger.info('skip beginner guide reward claim', {
        reason: 'already_claiming',
        isClaiming: beginnerGuideRewardClaimingRef.current,
      });
      return;
    }

    beginnerGuideRewardClaimingRef.current = true;
    try {
      logger.info('start beginner guide reward claim');
      const payload = await claimNewguiderReward();
      logger.info('beginner guide reward claim result', payload || {});
      const claimResult = String(payload?.claim_result || '').trim().toLowerCase();

      if (claimResult === 'claimed_now' || payload?.claimed_now) {
        await Promise.resolve(onRefreshCredits?.()).catch((error) => {
          logger.warn('Failed to refresh credits after beginner guide reward claim.', error);
        });
        logger.info('beginner guide reward claimed now');
        message.success('新手引导已完成，100 积分已到账');
        return;
      }

      if (claimResult === 'processing' || payload?.in_progress) {
        logger.info('beginner guide reward still in progress');
        message.info('新手引导已完成，奖励领取中，请稍后查看积分');
        return;
      }

      if (claimResult === 'already_rewarded') {
        await Promise.resolve(onRefreshCredits?.()).catch((error) => {
          logger.warn('Failed to refresh credits after beginner guide reward sync.', error);
        });
        logger.info('beginner guide reward already rewarded', {
          already_rewarded: Boolean(payload?.already_rewarded),
        });
        message.info('该奖励已领取过');
        return;
      }

      if (payload?.rewarded) {
        await Promise.resolve(onRefreshCredits?.()).catch((error) => {
          logger.warn('Failed to refresh credits after beginner guide reward sync.', error);
        });
        logger.info('beginner guide reward fallback rewarded branch');
        message.info(payload?.already_rewarded ? '该奖励已领取过' : '新手引导奖励已领取');
        return;
      }

      logger.warn('beginner guide reward claim returned unexpected payload', payload || {});
    } catch (error) {
      logger.warn('Failed to claim beginner guide reward.', error);
      message.warning('新手引导已完成，奖励可能稍后到账，请稍后查看积分');
    } finally {
      beginnerGuideRewardClaimingRef.current = false;
    }
  }, [beginnerGuideDone, beginnerGuideReopenPending, dismissBeginnerGuide, onRefreshCredits]);
  const beginnerGuideSteps = React.useMemo(() => ([
    {
      title: BEGINNER_GUIDE_TITLE,
      description: '通过对话制作视频，试试说：创建一个新的剪辑草稿，并添加文字：你好',
      target: () => beginnerGuideInputAreaRef?.current || null,
    },
    {
      title: BEGINNER_GUIDE_TITLE,
      description: '在这里切换AI模型。',
      target: () => beginnerGuideModelPickerRef?.current || null,
    },
    {
      title: BEGINNER_GUIDE_TITLE,
      description: '在这里使用AI生成工具。',
      target: () => beginnerGuideAiToolAreaRef?.current || null,
    },
    {
      title: BEGINNER_GUIDE_TITLE,
      description: '这里是一个剪辑技能，你可以使用他快速制作一条视频。',
      target: () => beginnerGuideQuickSkillsViewportRef?.current || childrensBookQuickPromptRef?.current || null,
    },
    {
      title: BEGINNER_GUIDE_TITLE,
      description: '你可以随时在设置里再次查看新手引导。',
      target: () => beginnerGuideSettingsPaneRef?.current || null,
      nextButtonProps: {
        onClick: () => {
          void completeBeginnerGuide();
        }
      }
    }
  ].map((step) => ({
    ...step,
    prevButtonProps: { style: { display: 'none' } }
  }))), [beginnerGuideAiToolAreaRef, beginnerGuideDownloadPaneRef, beginnerGuideInputAreaRef, beginnerGuideModelPickerRef, beginnerGuideQuickSkillsViewportRef, beginnerGuideSettingsPaneRef, childrensBookQuickPromptRef, completeBeginnerGuide]);

  React.useEffect(() => {
    setResolvedSessionId(runtimeSessionId || '');
  }, [runtimeSessionId]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (typeof globalThis?.__ELECTRON_STORE__?.onDidChange !== 'function') return undefined;

    const disposeReopen = globalThis.__ELECTRON_STORE__.onDidChange(BEGINNER_GUIDE_REOPEN_PENDING_KEY, (newValue) => {
      setBeginnerGuideReopenPending(Boolean(newValue));
    });
    const disposeCompleted = globalThis.__ELECTRON_STORE__.onDidChange(BEGINNER_GUIDE_COMPLETED_KEY, (newValue) => {
      setBeginnerGuideDone(Boolean(newValue));
    });

    return () => {
      disposeReopen?.();
      disposeCompleted?.();
    };
  }, []);

  React.useEffect(() => {
    if (!shouldStartBeginnerGuide || beginnerGuideOpen) return undefined;
    let frameId = 0;
    const tryOpenGuide = () => {
      if (beginnerGuideInputAreaRef?.current) {
        setBeginnerGuideCurrent(0);
        setBeginnerGuideOpen(true);
        return;
      }
      frameId = window.requestAnimationFrame(tryOpenGuide);
    };
    frameId = window.requestAnimationFrame(tryOpenGuide);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [beginnerGuideInputAreaRef, beginnerGuideOpen, shouldStartBeginnerGuide]);

  React.useEffect(() => {
    const handleChildrensBookSkillCreated = () => {
      if (beginnerGuideOpen && (beginnerGuideCurrent === 0 || beginnerGuideCurrent === 1)) {
        setBeginnerGuideCurrent(2);
      }
    };

    window.addEventListener('childrens-book-skill-created', handleChildrensBookSkillCreated);
    return () => {
      window.removeEventListener('childrens-book-skill-created', handleChildrensBookSkillCreated);
    };
  }, [beginnerGuideCurrent, beginnerGuideOpen]);

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
    writeMembersPanelWidth(membersPanelWidth);
  }, [membersPanelWidth]);

  React.useEffect(() => {
    writeMembersPanelCollapsed(membersPanelCollapsed);
  }, [membersPanelCollapsed]);

  React.useEffect(() => {
    writeWebPreviewWidth(webPreviewWidth);
  }, [webPreviewWidth]);

  React.useEffect(() => {
    const syncMembersPanelWidth = () => {
      const containerWidth = contentRef.current?.clientWidth || 0;
      const trailingWidth = showTrailingWebPreview ? webPreviewWidth : 0;
      setMembersPanelWidth((prev) => clampMembersPanelWidth(prev, containerWidth, showLeadingFilePreview, trailingWidth));
    };

    syncMembersPanelWidth();
    window.addEventListener('resize', syncMembersPanelWidth);
    return () => window.removeEventListener('resize', syncMembersPanelWidth);
  }, [showLeadingFilePreview, showTrailingWebPreview, webPreviewWidth]);

  React.useEffect(() => {
    const syncWebPreviewWidth = () => {
      const containerWidth = contentRef.current?.clientWidth || 0;
      setWebPreviewWidth((prev) => clampWebPreviewWidth(prev, containerWidth, showLeadingFilePreview, membersPanelWidth, showMembersPanel));
    };

    syncWebPreviewWidth();
    window.addEventListener('resize', syncWebPreviewWidth);
    return () => window.removeEventListener('resize', syncWebPreviewWidth);
  }, [showLeadingFilePreview, membersPanelWidth, showMembersPanel]);

  React.useEffect(() => {
    if (!membersPanelCollapsed) return;
    setIsResizingMembersPanel(false);
  }, [membersPanelCollapsed]);

  React.useEffect(() => {
    if (!isResizingAnyPanel) return undefined;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizingAnyPanel]);

  React.useEffect(() => {
    let cancelled = false;

    const loadRuntimeSession = async () => {
      if (!resolvedSessionId) {
        setRuntimeSession(null);
        return;
      }
      try {
        const result = await window.electronAPI.cherryChatStream.getSession(resolvedSessionId);
        if (cancelled) return;
        setRuntimeSession(result?.ok ? result.session || null : null);
      } catch (_error) {
        if (!cancelled) {
          setRuntimeSession(null);
        }
      }
    };

    void loadRuntimeSession();
    return () => {
      cancelled = true;
    };
  }, [resolvedSessionId]);

  React.useEffect(() => {
    const api = window?.electronAPI?.agentSessionStream;
    const targetSessionId = String(resolvedSessionId || '').trim();
    if (!targetSessionId || typeof api?.onSessionChanged !== 'function') return undefined;

    return api.onSessionChanged((payload) => {
      if (String(payload?.sessionId || '').trim() !== targetSessionId) return;
      void (async () => {
        try {
          const result = await window.electronAPI.cherryChatStream.getSession(targetSessionId);
          setWorkspaceStore(readWorkspaceStore());
          setRuntimeSession(result?.ok ? result.session || null : null);
        } catch (_error) {
          setRuntimeSession(null);
        }
      })();
    });
  }, [resolvedSessionId]);

  React.useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(sessionTitle);
    }
  }, [sessionTitle, isEditingTitle]);

  React.useEffect(() => {
    if (!currentWorkspacePath) return;
    persistVisitedWorkspace(currentWorkspacePath);
  }, [currentWorkspacePath, persistVisitedWorkspace]);

  React.useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const resolveSkillEntryPath = React.useCallback(async (skill, { searchPattern, targetSuffix }) => {
    const rootPath = normalizePath(skill?.__skillRoot || '').trim();
    if (!rootPath || !window?.api?.file?.listDirectory) return '';

    try {
      const entries = await window.api.file.listDirectory(rootPath, {
        recursive: true,
        maxDepth: 3,
        includeHidden: false,
        includeFiles: true,
        includeDirectories: false,
        maxEntries: 50,
        searchPattern
      });

      const targetPath = (Array.isArray(entries) ? entries : [])
        .map((entryPath) => resolveListedEntryPath(rootPath, entryPath))
        .find((entryPath) => normalizePath(entryPath).endsWith(targetSuffix));

      return normalizePath(targetPath || '');
    } catch (_error) {
      return '';
    }
  }, []);

  const resolveSkillPreviewPath = React.useCallback(
    async (skill) => resolveSkillEntryPath(skill, { searchPattern: 'index.html', targetSuffix: '/website/index.html' }),
    [resolveSkillEntryPath]
  );

  const resolveSkillExamplePath = React.useCallback(
    async (skill) => resolveSkillEntryPath(skill, { searchPattern: 'index.html', targetSuffix: '/website/index.html' }),
    [resolveSkillEntryPath]
  );

  React.useEffect(() => {
    let cancelled = false;
    let removeSkillsChangedListener = null;
    const loadSkills = async () => {
      const api = window?.electronAPI?.agentSkills;
      if (!runtimeSessionId && !agentId) {
        if (!cancelled) {
          setSkills([]);
          setSkillPreviewPaths({});
            setSkillExamplePaths({});
          setSkillsError('');
          setSkillsLoading(false);
        }
        return;
      }
      if (!api || typeof api.listLocal !== 'function') {
        if (!cancelled) {
          setSkills([]);
          setSkillPreviewPaths({});
            setSkillExamplePaths({});
          setSkillsError('技能服务不可用');
          setSkillsLoading(false);
        }
        return;
      }

      setSkillsLoading(true);
      setSkillsError('');
      try {
        const result = await api.listLocal({ workdir: '__global_skills__' });
        if (cancelled) return;
        if (!result?.ok) {
          setSkills([]);
          setSkillPreviewPaths({});
          setSkillExamplePaths({});
          setSkillsError(result?.error || '加载技能失败');
          return;
        }
        const nextSkills = Array.isArray(result.skills) ? result.skills : [];
        const normalizedSkills = nextSkills.map((skill) => {
          const localSkillRoot = String(skill?.path || '').trim();

          return localSkillRoot ? { ...skill, __skillRoot: localSkillRoot } : skill;
        });

        const previewEntries = await Promise.all(
          normalizedSkills.map(async (skill) => [getSkillKey(skill), await resolveSkillPreviewPath(skill)])
        );
        const exampleEntries = await Promise.all(
          normalizedSkills.map(async (skill) => [getSkillKey(skill), await resolveSkillExamplePath(skill)])
        );
        if (cancelled) return;

        setSkills(normalizedSkills);
        setSkillPreviewPaths(Object.fromEntries(previewEntries.filter(([skillKey]) => Boolean(skillKey))));
        setSkillExamplePaths(Object.fromEntries(exampleEntries.filter(([skillKey]) => Boolean(skillKey))));
      } catch (error) {
        if (!cancelled) {
          setSkills([]);
          setSkillPreviewPaths({});
          setSkillExamplePaths({});
          setSkillsError(error?.message || '加载技能失败');
        }
      } finally {
        if (!cancelled) {
          setSkillsLoading(false);
        }
      }
    };
    loadSkills();
    const api = window?.electronAPI?.agentSkills;
    if (agentId && api && typeof api.onChanged === 'function') {
      void api.subscribeChanges({ agentId }).catch((error) => {
        console.warn('[ChatShell] subscribe skill changes failed', error);
      });
      removeSkillsChangedListener = api.onChanged((payload) => {
        if (payload?.agentId && payload.agentId !== agentId) return;
        void loadSkills();
      });
    }
    return () => {
      cancelled = true;
      if (typeof removeSkillsChangedListener === 'function') {
        removeSkillsChangedListener();
      }
      if (agentId && api && typeof api.unsubscribeChanges === 'function') {
        void api.unsubscribeChanges({ agentId }).catch(() => {});
      }
    };
  }, [agentId, currentWorkspacePath, resolveSkillExamplePath, resolveSkillPreviewPath, runtimeSessionId]);

  React.useEffect(() => {
    setExpandedSkillKeys(new Set());
    setExpandedNodeKeys(new Set());
    setSkillTrees({});
    setSkillTreeLoading({});
  }, [skills]);

  React.useEffect(() => {
    setExpandedNodeKeys(new Set());
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

  React.useEffect(() => {
    const normalizedChatSessionId = String(chatSessionId || '').trim();
    const previousChatSessionId = previousChatSessionIdRef.current;

    if (previousChatSessionId && normalizedChatSessionId && previousChatSessionId !== normalizedChatSessionId) {
      pendingFilePreviewKeysRef.current.clear();
      closedFilePreviewKeysRef.current.clear();
      setFilePreview(null);
      setPanePreview((prev) => (prev?.previewType === 'file' ? null : prev));
    }

    previousChatSessionIdRef.current = normalizedChatSessionId;
  }, [chatSessionId]);

  React.useEffect(() => {
    const previewKey = String(webPreview?.key || '').trim();
    const previewUrl = String(webPreview?.url || '').trim();
    if (previewKey && previewUrl) {
      const nextPreview = {
        ...webPreview,
        previewType: 'web',
        activate: webPreview?.activate !== false
      };
      setPanePreview(nextPreview);
      return;
    }

    if (!webPreview) {
      setPanePreview((prev) => {
        if (prev?.previewType !== 'web') return prev;
        if (!filePreview) return null;
        return {
          ...filePreview,
          previewType: 'file',
          activate: false
        };
      });
    }
  }, [filePreview, webPreview]);

  const commitTitleEdit = () => {
    const nextTitle = String(titleDraft || '').trim() || '新对话';
    setIsEditingTitle(false);
    setTitleDraft(nextTitle);
    if (typeof onRenameSessionTitle === 'function' && nextTitle !== sessionTitle) {
      onRenameSessionTitle(nextTitle);
    }
  };

  const titleAnimationClass = isEditingTitle
    ? ''
    : (sessionTitleRenaming
    ? 'animation-shimmer'
    : (sessionTitleNewlyRenamed ? 'animation-reveal' : ''));

  const renderSkillTooltip = (skill, actions = null) => {
    const folderLabel = getSkillFolderLabel(skill);
    const displayName = getSkillDisplayName(skill);
    if (!skill?.description && !folderLabel && !displayName) return null;

    return (
      <div className="chat-panel__member-tooltip">
        <div className="chat-panel__member-tooltip-name">{displayName || folderLabel}</div>
        {folderLabel && displayName && folderLabel !== displayName && (
          <div className="chat-panel__member-tooltip-folder">{folderLabel}</div>
        )}
        {skill?.description && <div className="chat-panel__member-tooltip-desc">{skill.description}</div>}
        {actions}
      </div>
    );
  };

  const loadSkillTree = React.useCallback(async (skill) => {
    const skillKey = getSkillKey(skill);
    if (!skillKey) return;

    setSkillTreeLoading((prev) => ({ ...prev, [skillKey]: true }));

    try {
      let nodes = [];

      if (skill?.__skillRoot && window?.api?.file?.listDirectory && window?.api?.file?.isDirectory) {
        const rootPath = normalizePath(skill.__skillRoot);
        const entries = await window.api.file.listDirectory(rootPath, {
          recursive: true,
          maxDepth: 10,
          includeHidden: false,
          includeFiles: true,
          includeDirectories: true,
          maxEntries: TREE_LIST_MAX_ENTRIES,
          searchPattern: '.'
        });

        const normalizedEntries = Array.isArray(entries)
          ? Array.from(new Set(entries.map((entryPath) => resolveListedEntryPath(rootPath, entryPath)).filter(Boolean)))
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

        nodes = buildTreeFromEntries(rootPath, normalizedEntries, new Map(directoryChecks));
      } else if (window?.api?.skill?.listFiles && skill?.id) {
        const result = await window.api.skill.listFiles(skill.id);
        nodes = result?.success && Array.isArray(result.data) ? result.data : [];
      }

      setSkillTrees((prev) => ({ ...prev, [skillKey]: Array.isArray(nodes) ? nodes : [] }));
    } catch (_error) {
      setSkillTrees((prev) => ({ ...prev, [skillKey]: [] }));
    } finally {
      setSkillTreeLoading((prev) => ({ ...prev, [skillKey]: false }));
    }
  }, []);

  const toggleSkillExpanded = React.useCallback(async (skill) => {
    const skillKey = getSkillKey(skill);
    if (!skillKey) return;

    let shouldLoadTree = false;
    setExpandedSkillKeys((prev) => {
      const next = new Set(prev);
      if (next.has(skillKey)) {
        next.delete(skillKey);
      } else {
        next.add(skillKey);
        if (!Object.prototype.hasOwnProperty.call(skillTrees, skillKey)) {
          shouldLoadTree = true;
        }
      }
      return next;
    });

    if (shouldLoadTree) {
      await loadSkillTree(skill);
    }
  }, [loadSkillTree, skillTrees]);

  const toggleNodeExpanded = React.useCallback((skill, nodePath) => {
    if (!skill || !nodePath) return;

    const compositeKey = `${skill}:${nodePath}`;
    setExpandedNodeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(compositeKey)) {
        next.delete(compositeKey);
      } else {
        next.add(compositeKey);
      }
      return next;
    });
  }, []);

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

  const bindWorkspaceToSession = React.useCallback(async (workspacePath, options = {}) => {
    const { seedSkills = false } = options;
    if (!agentId) {
      window.toast.warning('请先进入对话');
      return false;
    }
    if (hasLockedWorkspace) {
      window.toast.warning('当前对话已绑定工作空间，请新建对话后再选择');
      return false;
    }

    const normalizedSelected = normalizePath(workspacePath);
    if (!normalizedSelected) return false;

    try {
      let nextSessionId = String(resolvedSessionId || runtimeSessionId || runtimeSession?.id || '').trim();
      if (!nextSessionId && typeof onEnsureRuntimeSession === 'function') {
        nextSessionId = String(await onEnsureRuntimeSession()).trim();
      }
      if (!nextSessionId) {
        window.toast.warning('请稍后重试');
        return false;
      }
      if (nextSessionId !== resolvedSessionId) {
        setResolvedSessionId(nextSessionId);
      }

      if (seedSkills) {
        const seedResult = await window.electronAPI.agentSkills.seedWorkspace({ workspace: normalizedSelected });
        if (!seedResult?.ok) {
          throw new Error(seedResult?.error || '同步技能缓存失败');
        }
      }

      const updateResult = await window.electronAPI.cherryChatStream.updateSession({
        sessionId: nextSessionId,
        agent_id: agentId,
        accessible_paths: [normalizedSelected],
        configuration: {
          ...getConfigObject(runtimeSession?.configuration),
          selected_workspace_path: normalizedSelected
        }
      });
      if (!updateResult?.ok || !updateResult?.session) {
        throw new Error(updateResult?.error || '绑定工作空间失败');
      }

      persistVisitedWorkspace(normalizedSelected);
      setRuntimeSession(updateResult.session);
      return true;
    } catch (error) {
      window.toast.error(error?.message || '绑定工作空间失败');
      return false;
    }
  }, [
    agentId,
    hasLockedWorkspace,
    onEnsureRuntimeSession,
    persistVisitedWorkspace,
    resolvedSessionId,
    runtimeSessionId,
    runtimeSession?.configuration,
    runtimeSession?.id,
    workspaceLibrary
  ]);

  const handleAddWorkspace = React.useCallback(async (event) => {
    event?.stopPropagation?.();
    try {
      const selected = await window.api.file.selectFolder();
      if (!selected) return;
      await bindWorkspaceToSession(selected);
    } catch (_error) {
      window.toast.error('打开文件夹失败');
    }
  }, [bindWorkspaceToSession]);

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
        const joinPath = window?.electronAPI?.path?.join;
        if (appDataPath && agentId) {
          nextParentDir = normalizePath(
            typeof joinPath === 'function'
              ? joinPath(appDataPath, 'Data', 'Workspaces', agentId)
              : `${appDataPath}/Data/Workspaces/${agentId}`
          );
        }
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
      const success = await bindWorkspaceToSession(workspacePath, { seedSkills: true });
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
    bindWorkspaceToSession,
    createWorkspaceName,
    createWorkspaceParentDir,
    createWorkspaceSubmitting
  ]);

  const handleStartRenameWorkspace = React.useCallback((event, workspacePath) => {
    event?.stopPropagation?.();
    if (!workspacePath || renameWorkspaceSubmitting) return;
    setRenamingWorkspacePath(workspacePath);
    setRenameWorkspaceDraft(getBaseName(workspacePath));
    setRenameWorkspaceError('');
  }, [renameWorkspaceSubmitting]);

  const handleCancelRenameWorkspace = React.useCallback((event) => {
    event?.stopPropagation?.();
    if (renameWorkspaceSubmitting) return;
    setRenamingWorkspacePath('');
    setRenameWorkspaceDraft('');
    setRenameWorkspaceError('');
  }, [renameWorkspaceSubmitting]);

  const handleConfirmRenameWorkspace = React.useCallback(async (event) => {
    event?.stopPropagation?.();
    if (!renamingWorkspacePath || renameWorkspaceSubmitting) return;

    const parentDir = getParentPath(renamingWorkspacePath);
    const currentName = getBaseName(renamingWorkspacePath);
    const requestedName = String(renameWorkspaceDraft || '').trim();

    if (!parentDir) {
      window.toast.error('重命名工作空间失败');
      return;
    }
    if (!requestedName) {
      setRenameWorkspaceError('名称不能为空');
      return;
    }
    if (areSameFileName(requestedName, currentName)) {
      setRenamingWorkspacePath('');
      setRenameWorkspaceDraft('');
      setRenameWorkspaceError('');
      return;
    }

    try {
      setRenameWorkspaceSubmitting(true);
      setRenameWorkspaceError('');

      const { safeName, requestedExists } = await window.api.file.checkFileName(parentDir, requestedName, false);
      const nextName = String(safeName || requestedName).trim();
      if (!nextName) {
        setRenameWorkspaceError('工作空间名称无效');
        return;
      }
      if (requestedExists) {
        setRenameWorkspaceError(`名称“${requestedName}”已被占用`);
        return;
      }

      await window.api.file.renameDir(renamingWorkspacePath, nextName);
      const joinPath = window?.electronAPI?.path?.join;
      const nextWorkspacePath = normalizePath(
        typeof joinPath === 'function' ? joinPath(parentDir, nextName) : `${parentDir}/${nextName}`
      );

      setWorkspaceStore((prev) => replaceWorkspacePathInStore(prev, renamingWorkspacePath, nextWorkspacePath));
      setRenamingWorkspacePath('');
      setRenameWorkspaceDraft('');
      setRenameWorkspaceError('');
      message.success('工作空间已重命名');
    } catch (error) {
      window.toast.error(error?.message || '重命名工作空间失败');
    } finally {
      setRenameWorkspaceSubmitting(false);
    }
  }, [renameWorkspaceDraft, renameWorkspaceSubmitting, renamingWorkspacePath]);

  const handleDeleteWorkspace = React.useCallback(async (event, workspacePath) => {
    event?.stopPropagation?.();
    const normalizedWorkspacePath = normalizePath(workspacePath).trim();
    if (!normalizedWorkspacePath) return;

    if (normalizedWorkspacePath === normalizePath(currentWorkspacePath)) {
      window.toast.warning('当前对话正在使用该工作空间，无法删除');
      return;
    }

    const workspaceName = getBaseName(normalizedWorkspacePath);
    const deleteContent = `删除后不可恢复，确认删除「${workspaceName}」吗？`;
    const confirmed = window?.modal?.confirm
      ? await new Promise((resolve) => {
          window.modal.confirm({
            title: '确认删除工作空间',
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
      await window.api.file.deleteExternalDir(normalizedWorkspacePath);
      invalidateWorkspaceTree(normalizedWorkspacePath);
      setWorkspaceStore((prev) => removeWorkspacePathFromStore(prev, normalizedWorkspacePath));
      if (normalizePath(renamingWorkspacePath) === normalizedWorkspacePath) {
        setRenamingWorkspacePath('');
        setRenameWorkspaceDraft('');
        setRenameWorkspaceError('');
      }
      message.success('工作空间已删除');
    } catch (error) {
      window.toast.error(error?.message || '删除工作空间失败');
    }
  }, [currentWorkspacePath, invalidateWorkspaceTree, renamingWorkspacePath]);

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

  const handlePreviewTabClose = React.useCallback((tab) => {
    if (String(tab?.type || '').trim() !== 'file') return;

    const previewKey = String(tab?.previewKey || '').trim();
    if (!previewKey) return;

    closedFilePreviewKeysRef.current.add(previewKey);
    pendingFilePreviewKeysRef.current.delete(previewKey);
    setFilePreview((prev) => (prev?.key === previewKey ? null : prev));
  }, []);

  const handleSaveFilePreview = React.useCallback(async ({ filePath, content }) => {
    const targetPath = String(filePath || '').trim();
    if (!targetPath) return false;

    const nextContent = String(content ?? '');
    const comparableTargetPath = normalizeComparablePath(targetPath);
    const applySavedPreview = (prev) => {
      if (!prev || normalizeComparablePath(prev.path) !== comparableTargetPath) {
        return prev;
      }
      return {
        ...prev,
        activate: false,
        status: 'ready',
        content: nextContent,
        error: ''
      };
    };

    try {
      await window.api.file.write(targetPath, nextContent);
      setFilePreview((prev) => applySavedPreview(prev));
      setPanePreview((prev) => (
        prev?.previewType === 'file'
          ? applySavedPreview(prev)
          : prev
      ));
      message.success('文件已保存');
      return true;
    } catch (error) {
      message.error(error?.message || '保存文件失败');
      return false;
    }
  }, []);

  const closeInlinePreviewPane = React.useCallback(() => {
    pendingFilePreviewKeysRef.current.forEach((previewKey) => {
      closedFilePreviewKeysRef.current.add(previewKey);
    });
    pendingFilePreviewKeysRef.current.clear();
    setFilePreview(null);
    setPanePreview(null);
    onCloseWebPreview?.();
  }, [onCloseWebPreview]);

  const membersPanelVisibleWidth = showMembersPanel ? membersPanelWidth : 0;
  const membersPanelStyle = { width: `${membersPanelVisibleWidth}px`, flexBasis: `${membersPanelVisibleWidth}px` };
  const membersSidebarStyle = { width: `${membersPanelVisibleWidth}px`, flexBasis: `${membersPanelVisibleWidth}px` };
  const trailingWebPreviewStyle = showTrailingWebPreview
    ? { width: `${webPreviewWidth}px`, flexBasis: `${webPreviewWidth}px` }
    : undefined;

  const updateMembersPanelWidth = React.useCallback((nextWidth) => {
    const containerWidth = contentRef.current?.clientWidth || 0;
    const trailingWidth = showTrailingWebPreview ? webPreviewWidth : 0;
    setMembersPanelWidth(clampMembersPanelWidth(nextWidth, containerWidth, showLeadingFilePreview, trailingWidth));
  }, [showLeadingFilePreview, showTrailingWebPreview, webPreviewWidth]);

  const updateWebPreviewWidth = React.useCallback((nextWidth) => {
    const containerWidth = contentRef.current?.clientWidth || 0;
    setWebPreviewWidth(clampWebPreviewWidth(nextWidth, containerWidth, showLeadingFilePreview, membersPanelWidth, showMembersPanel));
  }, [membersPanelWidth, showLeadingFilePreview, showMembersPanel]);

  const openInlinePreviewPane = React.useCallback((nextPreview) => {
    if (!nextPreview) return;

    const containerWidth = contentRef.current?.clientWidth || 0;
    setWebPreviewWidth((prev) => clampWebPreviewWidth(
      prev || DEFAULT_PREVIEW_PANE_WIDTH,
      containerWidth,
      showLeadingFilePreview,
      membersPanelWidth,
      showMembersPanel
    ));
    setPanePreview(nextPreview);
  }, [membersPanelWidth, showLeadingFilePreview, showMembersPanel]);

  const handleMembersPanelResizeStart = React.useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = membersPanelWidth;
    setIsResizingMembersPanel(true);

    const handleMouseMove = (moveEvent) => {
      const deltaX = startX - moveEvent.clientX;
      updateMembersPanelWidth(startWidth + deltaX);
    };

    const handleMouseUp = () => {
      setIsResizingMembersPanel(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [membersPanelWidth, updateMembersPanelWidth]);

  const handleWebPreviewResizeStart = React.useCallback((event) => {
    if (!showTrailingWebPreview) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = webPreviewWidth;
    setIsResizingWebPreview(true);

    const handleMouseMove = (moveEvent) => {
      const deltaX = startX - moveEvent.clientX;
      updateWebPreviewWidth(startWidth + deltaX);
    };

    const handleMouseUp = () => {
      setIsResizingWebPreview(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [showTrailingWebPreview, updateWebPreviewWidth, webPreviewWidth]);

  const handleMembersPanelResizeKeyDown = React.useCallback((event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      updateMembersPanelWidth(membersPanelWidth + 20);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      updateMembersPanelWidth(membersPanelWidth - 20);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      updateMembersPanelWidth(MIN_MEMBERS_PANEL_WIDTH);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      updateMembersPanelWidth(MAX_MEMBERS_PANEL_WIDTH);
    }
  }, [membersPanelWidth, updateMembersPanelWidth]);

  const handleWebPreviewResizeKeyDown = React.useCallback((event) => {
    if (!showTrailingWebPreview) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      updateWebPreviewWidth(webPreviewWidth + 20);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      updateWebPreviewWidth(webPreviewWidth - 20);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      updateWebPreviewWidth(MIN_WEB_PREVIEW_WIDTH);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      updateWebPreviewWidth(MAX_WEB_PREVIEW_WIDTH);
    }
  }, [showTrailingWebPreview, updateWebPreviewWidth, webPreviewWidth]);

  const resetWebPreviewWidth = React.useCallback(() => {
    updateWebPreviewWidth(DEFAULT_PREVIEW_PANE_WIDTH);
  }, [updateWebPreviewWidth]);

  const resetMembersPanelWidth = React.useCallback(() => {
    updateMembersPanelWidth(DEFAULT_MEMBERS_PANEL_WIDTH);
  }, [updateMembersPanelWidth]);

  const toggleMembersPanelCollapsed = React.useCallback(() => {
    setMembersPanelCollapsed((prev) => !prev);
  }, []);

  const openFilePreview = React.useCallback(async (rootPath, node) => {
    if (!rootPath || !node?.path || node.type !== 'file') return;

    const absolutePath = resolveListedEntryPath(rootPath, node.path);
    if (!absolutePath) return;

    const previewKey = `file-preview:${absolutePath}`;
    const previewTabId = `file-preview-tab:${absolutePath}`;
    const pendingPreview = {
      key: previewKey,
      tabId: previewTabId,
      title: node.name || getBaseName(absolutePath) || '文件预览',
      previewType: 'file',
      activate: true,
      path: absolutePath,
      name: node.name,
      kind: 'pending',
      language: getFileExtension(node.name) || 'text',
      status: 'loading',
      content: '',
      error: ''
    };
    closedFilePreviewKeysRef.current.delete(previewKey);
    pendingFilePreviewKeysRef.current.add(previewKey);
    setFilePreview(pendingPreview);
    openInlinePreviewPane(pendingPreview);

    let previewKind = getPreviewKindForFileName(node.name);
    if (!previewKind) {
      try {
        const isTextFile = await window.api.file.isTextFile(absolutePath);
        previewKind = isTextFile ? 'text' : 'unsupported';
      } catch (_error) {
        previewKind = 'unsupported';
      }
    }

    const previewLanguage = previewKind === 'markdown'
      ? 'markdown'
      : (getFileExtension(node.name) || 'text');
    const previewSrc = createFilePreviewUrl(absolutePath);

    if (previewKind === 'unsupported') {
      pendingFilePreviewKeysRef.current.delete(previewKey);
      if (closedFilePreviewKeysRef.current.has(previewKey)) return;
      const unsupportedPreview = {
        ...pendingPreview,
        activate: true,
        kind: 'unsupported',
        language: previewLanguage,
        status: 'unsupported',
        content: '',
        error: '暂不支持预览该类型文件'
      };
      setFilePreview(unsupportedPreview);
      openInlinePreviewPane(unsupportedPreview);
      return;
    }

    if (previewKind === 'image' || previewKind === 'video' || previewKind === 'audio') {
      pendingFilePreviewKeysRef.current.delete(previewKey);
      if (closedFilePreviewKeysRef.current.has(previewKey)) return;
      const mediaPreview = {
        ...pendingPreview,
        activate: true,
        kind: previewKind,
        language: previewLanguage,
        status: previewSrc ? 'ready' : 'error',
        src: previewSrc,
        content: '',
        error: previewSrc ? '' : '生成预览地址失败'
      };
      setFilePreview(mediaPreview);
      openInlinePreviewPane(mediaPreview);
      return;
    }

    try {
      const content = await window.api.file.readExternal(absolutePath, true);
      pendingFilePreviewKeysRef.current.delete(previewKey);
      if (closedFilePreviewKeysRef.current.has(previewKey)) return;
      const readyPreview = {
        ...pendingPreview,
        activate: false,
        kind: previewKind,
        language: previewLanguage,
        status: 'ready',
        content: String(content || ''),
        error: ''
      };
      setFilePreview(readyPreview);
      openInlinePreviewPane(readyPreview);
    } catch (error) {
      pendingFilePreviewKeysRef.current.delete(previewKey);
      if (closedFilePreviewKeysRef.current.has(previewKey)) return;
      const failedPreview = {
        ...pendingPreview,
        activate: false,
        kind: previewKind,
        language: previewLanguage,
        status: 'error',
        content: '',
        error: error?.message || '读取文件失败'
      };
      setFilePreview(failedPreview);
      openInlinePreviewPane(failedPreview);
    }
  }, [openInlinePreviewPane]);

  const openSkillWebPreview = React.useCallback((skill) => {
    const skillKey = getSkillKey(skill);
    const sourcePath = skillPreviewPaths[skillKey];
    const url = createFilePreviewUrl(sourcePath);
    if (typeof onOpenWebPreview !== 'function' || !skillKey || !sourcePath || !url) return;

    const previewKeySuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    onOpenWebPreview({
      key: `skill-html:${sourcePath}:${previewKeySuffix}`,
      url,
      title: getSkillDisplayName(skill) || getSkillFolderLabel(skill) || getBaseName(sourcePath) || '网页预览',
      sourcePath
    });
  }, [onOpenWebPreview, skillPreviewPaths]);

  const deleteSkill = React.useCallback(async (skill) => {
    const api = window?.electronAPI?.agentSkills;
    const skillId = getSkillKey(skill);
    const skillKey = getSkillKey(skill);
    const skillLabel = getSkillDisplayName(skill) || getSkillFolderLabel(skill) || skillId;
    if (!api || typeof api.uninstall !== 'function' || !skillId || !skillKey) return;

    const deleteContent = `删除后不可恢复，确认删除「${skillLabel}」吗？`;
    const confirmed = window?.modal?.confirm
      ? await new Promise((resolve) => {
          window.modal.confirm({
            title: '确认删除技能',
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
      const result = await api.uninstall({ skillId });
      if (!result?.success) {
        throw new Error(result?.error?.message || result?.error || '删除技能失败');
      }

      setSkills((prev) => prev.filter((item) => getSkillKey(item) !== skillKey));
      setSkillPreviewPaths((prev) => {
        const next = { ...prev };
        delete next[skillKey];
        return next;
      });
      setSkillExamplePaths((prev) => {
        const next = { ...prev };
        delete next[skillKey];
        return next;
      });
      setSkillTrees((prev) => {
        const next = { ...prev };
        delete next[skillKey];
        return next;
      });
      setSkillTreeLoading((prev) => {
        const next = { ...prev };
        delete next[skillKey];
        return next;
      });
      setExpandedSkillKeys((prev) => {
        const next = new Set(prev);
        next.delete(skillKey);
        return next;
      });
      message.success(`已删除技能：${skillLabel}`);
    } catch (error) {
      message.error(error?.message || '删除技能失败');
    }
  }, [getSkillDisplayName, getSkillFolderLabel, getSkillKey]);

  const runSkillExample = React.useCallback(async (skill) => {
    const skillKey = getSkillKey(skill);
    const examplePath = skillExamplePaths[skillKey];
    const url = createFilePreviewUrl(examplePath);

    if (typeof onOpenWebPreview !== 'function' || !skillKey || !examplePath || !url) {
      return;
    }

    const previewKeySuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    onOpenWebPreview({
      key: `skill-example:${examplePath}:${previewKeySuffix}`,
      url,
      title: getSkillDisplayName(skill) || getSkillFolderLabel(skill) || getBaseName(examplePath) || '示例页面',
      sourcePath: examplePath
    });

    if (beginnerGuideOpen && beginnerGuideCurrent === 3) {
      setBeginnerGuideCurrent(4);
    }
  }, [beginnerGuideCurrent, beginnerGuideOpen, onOpenWebPreview, skillExamplePaths]);

  const renderTreeNodes = React.useCallback((scopeKey, rootPath, nodes, depth = 1) => {
    if (!Array.isArray(nodes) || nodes.length === 0) return null;

    return nodes.map((node) => {
      const compositeKey = `${scopeKey}:${node.path}`;
      const isDirectory = node.type === 'directory';
      const isExpanded = isDirectory && expandedNodeKeys.has(compositeKey);
      const FileIcon = isDirectory ? null : getFileIcon(node.name);
      const absolutePath = isDirectory ? '' : resolveListedEntryPath(rootPath, node.path);
      const isPreviewSelected = !isDirectory && absolutePath && filePreview?.path === absolutePath;

      return (
        <React.Fragment key={compositeKey}>
          <div
            className={`chat-panel__tree-item ${isDirectory ? 'is-directory' : 'is-file'} ${isPreviewSelected ? 'is-selected' : ''}`.trim()}
            style={{ '--tree-depth': depth }}
            onClick={() => {
              if (isDirectory) {
                toggleNodeExpanded(scopeKey, node.path);
              } else {
                void openFilePreview(rootPath, node);
              }
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (isDirectory) {
                  toggleNodeExpanded(scopeKey, node.path);
                } else {
                  void openFilePreview(rootPath, node);
                }
              }
            }}>
            <button
              type="button"
              className={`chat-panel__tree-toggle ${isExpanded ? 'is-expanded' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                if (isDirectory) {
                  toggleNodeExpanded(scopeKey, node.path);
                }
              }}
              aria-label={isDirectory ? `${isExpanded ? '折叠' : '展开'} ${node.name}` : undefined}
              disabled={!isDirectory}>
              {isDirectory ? <ChevronRight className="chat-panel__tree-chevron" aria-hidden="true" /> : null}
            </button>
            <span className="chat-panel__tree-icon" aria-hidden="true">
              {isDirectory ? (isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />) : <FileIcon size={14} />}
            </span>
            <MarqueeText className="chat-panel__tree-label" text={node.name} />
          </div>
          {isDirectory && isExpanded && Array.isArray(node.children) && renderTreeNodes(scopeKey, rootPath, node.children, depth + 1)}
        </React.Fragment>
      );
    });
  }, [expandedNodeKeys, filePreview?.path, openFilePreview, toggleNodeExpanded]);

  return (
    <div className="chat-panel">
      <div className="chat-panel__navbar">
        <Tooltip
          title={historyVisible ? '隐藏会话列表' : '展示会话列表'}
          placement="bottom"
          mouseEnterDelay={0.5}
          styles={{ body: { fontSize: 12 } }}>
          <span
            className="chat-panel__navbar-icon-wrap"
            onClick={() => onToggleHistory && onToggleHistory()}>
            <SidebarToggleIcon direction={historyVisible ? 'left' : 'right'} />
          </span>
        </Tooltip>
        <Tooltip
          title="新建对话"
          placement="bottom"
          mouseEnterDelay={0.5}
          styles={{ body: { fontSize: 12 } }}>
          <span
            className="chat-panel__navbar-icon-wrap"
            style={{ marginLeft: 6 }}
            onClick={(event) => onCreateSession && onCreateSession({
              source: 'chat-shell-navbar-click',
              isTrusted: Boolean(event?.isTrusted),
              detail: Number(event?.detail || 0),
              clientX: Number(event?.clientX || 0),
              clientY: Number(event?.clientY || 0)
            })}>
            <img className="chat-panel__navbar-icon-image" src={NewChatIcon} alt="新建对话" />
          </span>
        </Tooltip>
        <span className="chat-panel__navbar-divider" aria-hidden="true" />
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className="chat-panel__navbar-title-input"
            value={titleDraft}
            maxLength={30}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitleEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitTitleEdit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setTitleDraft(sessionTitle);
                setIsEditingTitle(false);
              }
            }}
          />
        ) : (
          <span
            className={`chat-panel__navbar-title ${titleAnimationClass}`.trim()}
            title="双击编辑标题"
            onDoubleClick={() => setIsEditingTitle(true)}>
            {sessionTitle}
          </span>
        )}
      </div>

      <div className={`chat-panel__content ${isResizingAnyPanel ? 'is-resizing-web-preview' : ''}`.trim()} ref={contentRef}>
        {isResizingAnyPanel && <div className="chat-panel__resize-shield" aria-hidden="true" />}
        <div className="chat-panel__main">
          {children}
        </div>
        {showMembersPanel && (
          <div
            className={`chat-panel__panel-resizer ${isResizingMembersPanel ? 'is-active' : ''}`.trim()}
            role="separator"
            tabIndex={0}
            aria-label="调整工作空间宽度"
            aria-orientation="vertical"
            onMouseDown={handleMembersPanelResizeStart}
            onDoubleClick={resetMembersPanelWidth}
            onKeyDown={handleMembersPanelResizeKeyDown}
          />
        )}
        <div className={`chat-panel__members ${membersPanelCollapsed ? 'is-collapsed' : ''}`.trim()} style={membersPanelStyle}>
          <button
            type="button"
            className={`chat-panel__members-toggle ${membersPanelCollapsed ? 'is-collapsed' : ''}`.trim()}
            onClick={toggleMembersPanelCollapsed}
            aria-label={membersPanelCollapsed ? '展开技能成员和工作空间' : '折叠技能成员和工作空间'}
            title={membersPanelCollapsed ? '展开技能成员和工作空间' : '折叠技能成员和工作空间'}>
            <ChevronRight className="chat-panel__members-toggle-icon" size={14} aria-hidden="true" />
          </button>
          <div className={`chat-panel__members-sidebar ${membersPanelCollapsed ? 'is-hidden' : ''}`.trim()} style={membersSidebarStyle}>
            <div className="chat-panel__members-list">
            <SkillMembersSection
              skillsLoading={skillsLoading}
              skillsError={skillsError}
              skills={skills}
              skillPreviewPaths={skillPreviewPaths}
              skillExamplePaths={skillExamplePaths}
              expandedSkillKeys={expandedSkillKeys}
              skillTrees={skillTrees}
              skillTreeLoading={skillTreeLoading}
              beginnerGuideOpen={beginnerGuideOpen}
              beginnerGuideCurrent={beginnerGuideCurrent}
              beginnerGuideChildrensBookRunButtonRef={beginnerGuideChildrensBookRunButtonRef}
              beginnerGuideChildrensBookEditButtonRef={beginnerGuideChildrensBookEditButtonRef}
              onToggleSkillExpanded={toggleSkillExpanded}
              onOpenSkillWebPreview={openSkillWebPreview}
              onRunSkillExample={runSkillExample}
              onSelectSkill={onSelectSkill}
              onModifySkill={onModifySkill}
              onDeleteSkill={deleteSkill}
              renderSkillTooltip={renderSkillTooltip}
              renderTreeNodes={renderTreeNodes}
              getSkillKey={getSkillKey}
              getSkillFolderLabel={getSkillFolderLabel}
              getSkillDisplayName={getSkillDisplayName}
              childrensBookSkillLabel={CHILDRENS_BOOK_SKILL_LABEL}
            />
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
                    {visibleRecentWorkspaces.map((workspacePath) => {
                      const isRenamingWorkspace = renamingWorkspacePath === workspacePath;

                      return (
                        <div key={workspacePath} className="chat-panel__member-group chat-panel__member-group--history">
                          <div className={`chat-panel__member-item chat-panel__member-item--history ${isRenamingWorkspace ? 'is-renaming' : ''}`.trim()}>
                            {isRenamingWorkspace ? (
                              <div
                                className="chat-panel__workspace-rename-inline"
                                onClick={(event) => event.stopPropagation()}>
                                <span className="chat-panel__tree-icon" aria-hidden="true">
                                  <Folder size={14} />
                                </span>
                                <input
                                  ref={renameWorkspaceInputRef}
                                  type="text"
                                  className={`chat-panel__workspace-rename-input ${renameWorkspaceError ? 'is-error' : ''}`.trim()}
                                  value={renameWorkspaceDraft}
                                  title={renameWorkspaceError || workspacePath}
                                  aria-label="工作空间新名称"
                                  disabled={renameWorkspaceSubmitting}
                                  onChange={(event) => {
                                    setRenameWorkspaceDraft(event.target.value);
                                    if (renameWorkspaceError) {
                                      setRenameWorkspaceError('');
                                    }
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      void handleConfirmRenameWorkspace(event);
                                      return;
                                    }
                                    if (event.key === 'Escape') {
                                      handleCancelRenameWorkspace(event);
                                    }
                                  }}
                                />
                                <div className="chat-panel__workspace-rename-actions">
                                  <button
                                    type="button"
                                    className="chat-panel__member-action"
                                    onClick={(event) => void handleConfirmRenameWorkspace(event)}
                                    title="确认重命名"
                                    aria-label="确认重命名"
                                    disabled={renameWorkspaceSubmitting}>
                                    {renameWorkspaceSubmitting ? (
                                      <LoaderCircle size={12} aria-hidden="true" className="chat-panel__action-icon-spinning" />
                                    ) : (
                                      <Check size={12} aria-hidden="true" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="chat-panel__member-action"
                                    onClick={handleCancelRenameWorkspace}
                                    title="取消重命名"
                                    aria-label="取消重命名"
                                    disabled={renameWorkspaceSubmitting}>
                                    <X size={12} aria-hidden="true" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="chat-panel__member-main chat-panel__member-main--history"
                                  onClick={() => void bindWorkspaceToSession(workspacePath)}
                                  title={workspacePath}>
                                  <span className="chat-panel__tree-icon" aria-hidden="true">
                                    <Folder size={14} />
                                  </span>
                                  <span className="chat-panel__member-text chat-panel__member-text--history">
                                    <span className="chat-panel__member-name chat-panel__member-name--history">{getBaseName(workspacePath)}</span>
                                  </span>
                                </button>
                                <div className="chat-panel__member-actions-overlay">
                                  <button
                                    type="button"
                                    className="chat-panel__member-action"
                                    onClick={(event) => handleStartRenameWorkspace(event, workspacePath)}
                                    title="重命名工作空间"
                                    aria-label={`重命名 ${getBaseName(workspacePath)}`}>
                                    <SquarePen size={12} aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    className="chat-panel__member-action chat-panel__member-action--danger"
                                    onClick={(event) => void handleDeleteWorkspace(event, workspacePath)}
                                    title="删除工作空间"
                                    aria-label={`删除 ${getBaseName(workspacePath)}`}>
                                    <Trash2 size={12} aria-hidden="true" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
                        renderTreeNodes(`workspace:${currentWorkspacePath}`, currentWorkspacePath, workspaceTrees[currentWorkspacePath], 0)
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            </div>
          </div>
        </div>
        {showTrailingWebPreview && (
          <div
            className={`chat-panel__panel-resizer ${isResizingWebPreview ? 'is-active' : ''}`.trim()}
            role="separator"
            tabIndex={0}
            aria-label="调整内嵌浏览器宽度"
            aria-orientation="vertical"
            onMouseDown={handleWebPreviewResizeStart}
            onDoubleClick={resetWebPreviewWidth}
            onKeyDown={handleWebPreviewResizeKeyDown}
          />
        )}
        <div
          ref={beginnerGuideWebPreviewPaneRef}
          className={`chat-panel__preview-pane chat-panel__preview-pane--trailing ${showTrailingWebPreview ? 'is-open' : ''}`.trim()}
          style={trailingWebPreviewStyle}>
          {panePreview && (
            <WebPagePreview
              preview={panePreview}
              currentModelMeta={currentModelMeta}
              onClose={closeInlinePreviewPane}
              onSaveFileEdit={handleSaveFilePreview}
              onSubmitFileComment={onSubmitFileComment}
              onTabClose={handlePreviewTabClose}
              submittingComment={sessionSending}
            />
          )}
        </div>
      </div>
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
      <Tour
        open={beginnerGuideOpen}
        current={beginnerGuideCurrent}
        onChange={setBeginnerGuideCurrent}
        onClose={dismissBeginnerGuide}
        steps={beginnerGuideSteps}
        placement="bottom"
        locale={{ Finish: '结束引导', finish: '结束引导' }}
        zIndex={1600}
        mask={{ color: 'rgba(0, 0, 0, 0.52)' }}
      />
    </div>
  );
};

export default ChatShell;
