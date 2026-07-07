import React from 'react';
import { createPortal } from 'react-dom';
import { Empty, Tooltip } from 'antd';
import {
  AtSign,
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
  Play,
  RefreshCw,
  UserPlus
} from 'lucide-react';
import './ChatShell.css';
import SidebarToggleIcon from '../../Icons/SidebarToggleIcon';
import NewChatIcon from '../../../../public/new_chat.svg';
import TextFilePreview from './TextFilePreview';
import WebPagePreview from './WebPagePreview';

const normalizePath = (value) => String(value || '').replace(/\\/g, '/');
const normalizeComparablePath = (value) => {
  const normalized = normalizePath(value).replace(/\/$/, '');
  return isWindows ? normalized.toLowerCase() : normalized;
};
const resolveListedEntryPath = (rootPath, entryPath) => {
  const normalizedRoot = normalizePath(rootPath).replace(/\/$/, '');
  const normalizedEntry = normalizePath(entryPath).trim();
  if (!normalizedEntry) return '';
  if (normalizedEntry.startsWith('/')) return normalizedEntry;
  return `${normalizedRoot}/${normalizedEntry}`.replace(/\/+/g, '/');
};
const getBaseName = (value) => {
  const normalized = normalizePath(value).replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized;
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
const ARCHIVE_EXTENSIONS = new Set(['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'xz', 'zip']);
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'numbers', 'ods', 'tsv', 'xls', 'xlsx']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
const HTML_PREVIEW_EXTENSIONS = new Set(['html', 'htm']);
const TEXT_PREVIEW_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'conf', 'config', 'env', 'ini', 'toml', 'graphql', 'gql',
  'csv', 'tsv', 'gitignore', 'editorconfig'
]);
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
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (CODE_EXTENSIONS.has(extension) || TERMINAL_EXTENSIONS.has(extension)) return 'code';
  if (TEXT_PREVIEW_EXTENSIONS.has(extension)) return 'text';
  return null;
};
const isHtmlPreviewFileName = (fileName = '') => HTML_PREVIEW_EXTENSIONS.has(getFileExtension(fileName));
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
const clampWebPreviewWidth = (nextWidth, containerWidth, hasLeadingFilePreview = false, membersPanelWidth = DEFAULT_MEMBERS_PANEL_WIDTH) => {
  const safeContainerWidth = Number(containerWidth) || 0;
  const leadingWidth = hasLeadingFilePreview ? DEFAULT_PREVIEW_PANE_WIDTH : 0;
  const computedMaxWidth = safeContainerWidth > 0
    ? safeContainerWidth - leadingWidth - Math.max(MIN_MEMBERS_PANEL_WIDTH, Number(membersPanelWidth) || DEFAULT_MEMBERS_PANEL_WIDTH) - MIN_MAIN_PANEL_WIDTH - MEMBERS_PANEL_RESIZER_WIDTH - WEB_PREVIEW_RESIZER_WIDTH
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
const getSkillDisplayName = (skill) => String(skill?.name || skill?.id || skill?.filename || '').trim();

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
  submitting = false,
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
            <input
              type="text"
              maxLength={50}
              className="chat-panel__workspace-create-input chat-panel__workspace-create-input--name"
              placeholder="空间名称"
              value={workspaceName}
              disabled={submitting}
              onChange={(event) => onWorkspaceNameChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canConfirm) {
                  event.preventDefault();
                  onConfirm?.();
                }
              }}
            />
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
  onCreateSkill,
  onSubmitFileComment,
  sessionSending = false,
  webPreview = null,
  onCloseWebPreview,
  onOpenWebPreview,
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
  const [expandedSkillKeys, setExpandedSkillKeys] = React.useState(() => new Set());
  const [expandedNodeKeys, setExpandedNodeKeys] = React.useState(() => new Set());
  const [skillTrees, setSkillTrees] = React.useState({});
  const [skillTreeLoading, setSkillTreeLoading] = React.useState({});
  const [workspaceTrees, setWorkspaceTrees] = React.useState({});
  const [workspaceTreeLoading, setWorkspaceTreeLoading] = React.useState({});
  const [workspaceExpanded, setWorkspaceExpanded] = React.useState(true);
  const [showAllRecentWorkspaces, setShowAllRecentWorkspaces] = React.useState(false);
  const [createWorkspaceDialogOpen, setCreateWorkspaceDialogOpen] = React.useState(false);
  const [createWorkspaceParentDir, setCreateWorkspaceParentDir] = React.useState('');
  const [createWorkspaceName, setCreateWorkspaceName] = React.useState('');
  const [createWorkspaceSubmitting, setCreateWorkspaceSubmitting] = React.useState(false);
  const [filePreview, setFilePreview] = React.useState(null);
  const [membersPanelWidth, setMembersPanelWidth] = React.useState(() => readMembersPanelWidth());
  const [webPreviewWidth, setWebPreviewWidth] = React.useState(() => readWebPreviewWidth());
  const [isResizingMembersPanel, setIsResizingMembersPanel] = React.useState(false);
  const [isResizingWebPreview, setIsResizingWebPreview] = React.useState(false);
  const titleInputRef = React.useRef(null);
  const filePreviewRequestIdRef = React.useRef(0);
  const contentRef = React.useRef(null);
  const workspaceRefreshTimeoutRef = React.useRef(null);
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
  const hasFilePreview = Boolean(filePreview);
  const hasWebPreview = Boolean(webPreview);
  const showLeadingFilePreview = hasFilePreview;
  const showTrailingWebPreview = hasWebPreview;
  const isResizingAnyPanel = isResizingMembersPanel || isResizingWebPreview;

  React.useEffect(() => {
    setResolvedSessionId(runtimeSessionId || '');
  }, [runtimeSessionId]);

  React.useEffect(() => {
    writeWorkspaceStore(workspaceStore);
  }, [workspaceStore]);

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
    writeWebPreviewWidth(webPreviewWidth);
  }, [webPreviewWidth]);

  React.useEffect(() => {
    const syncMembersPanelWidth = () => {
      const containerWidth = contentRef.current?.clientWidth || 0;
      const trailingWidth = showTrailingWebPreview ? webPreviewWidth : 0;
      setMembersPanelWidth((prev) => clampMembersPanelWidth(prev, containerWidth, hasFilePreview, trailingWidth));
    };

    syncMembersPanelWidth();
    window.addEventListener('resize', syncMembersPanelWidth);
    return () => window.removeEventListener('resize', syncMembersPanelWidth);
  }, [hasFilePreview, showTrailingWebPreview, webPreviewWidth]);

  React.useEffect(() => {
    const syncWebPreviewWidth = () => {
      const containerWidth = contentRef.current?.clientWidth || 0;
      setWebPreviewWidth((prev) => clampWebPreviewWidth(prev, containerWidth, hasFilePreview, membersPanelWidth));
    };

    syncWebPreviewWidth();
    window.addEventListener('resize', syncWebPreviewWidth);
    return () => window.removeEventListener('resize', syncWebPreviewWidth);
  }, [hasFilePreview, membersPanelWidth]);

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

  React.useEffect(() => {
    let cancelled = false;
    let removeSkillsChangedListener = null;
    const loadSkills = async () => {
      const api = window?.electronAPI?.agentSkills;
      if (!runtimeSessionId && !agentId) {
        if (!cancelled) {
          setSkills([]);
          setSkillsError('');
          setSkillsLoading(false);
        }
        return;
      }
      if (!currentWorkspacePath) {
        if (!cancelled) {
          setSkills([]);
          setSkillsError('');
          setSkillsLoading(false);
        }
        return;
      }
      if (!api || typeof api.listLocal !== 'function') {
        if (!cancelled) {
          setSkills([]);
          setSkillsError('技能服务不可用');
          setSkillsLoading(false);
        }
        return;
      }

      setSkillsLoading(true);
      setSkillsError('');
      try {
        const result = await api.listLocal({ workdir: currentWorkspacePath });
        if (cancelled) return;
        if (!result?.ok) {
          setSkills([]);
          setSkillsError(result?.error || '加载技能失败');
          return;
        }
        const nextSkills = Array.isArray(result.skills) ? result.skills : [];
        const normalizedSkills = nextSkills.map((skill) => {
          const folderName = String(skill?.folderName || skill?.filename || skill?.id || skill?.name || '').trim();
          const joinPath = window?.electronAPI?.path?.join;
          const localSkillRoot =
            currentWorkspacePath && folderName
              ? normalizePath(
                  typeof joinPath === 'function'
                    ? joinPath(currentWorkspacePath, '.claude', 'skills', folderName)
                    : `${currentWorkspacePath}/.claude/skills/${folderName}`
                )
              : '';

          return localSkillRoot ? { ...skill, __skillRoot: localSkillRoot } : skill;
        });

        setSkills(normalizedSkills);
      } catch (error) {
        if (!cancelled) {
          setSkills([]);
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
  }, [agentId, currentWorkspacePath, runtimeSessionId]);

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
  }, [createWorkspaceDialogOpen]);

  React.useEffect(() => {
    setFilePreview(null);
    filePreviewRequestIdRef.current += 1;
  }, [agentId, currentWorkspacePath, resolvedSessionId]);

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

  const renderSkillTooltip = (skill) => {
    const folderLabel = getSkillFolderLabel(skill);
    const displayName = getSkillDisplayName(skill);
    if (!skill?.description && !folderLabel && !displayName) return null;

    return (
      <div className="chat-panel__member-tooltip">
        <div className="chat-panel__member-tooltip-name">{folderLabel || displayName}</div>
        {displayName && displayName !== folderLabel && (
          <div className="chat-panel__member-tooltip-folder">{displayName}</div>
        )}
        {skill?.description && <div className="chat-panel__member-tooltip-desc">{skill.description}</div>}
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

      const checkResult = await window.api.file.checkFileName(parentDir, normalizedName, false);
      const folderName = String(checkResult?.safeName || normalizedName).trim();
      if (!folderName) {
        window.toast.error('工作空间名称无效');
        setCreateWorkspaceSubmitting(false);
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
      }
    } catch (_error) {
      window.toast.error('新建工作空间失败');
    } finally {
      setCreateWorkspaceSubmitting(false);
    }
  }, [bindWorkspaceToSession, createWorkspaceName, createWorkspaceParentDir, createWorkspaceSubmitting]);

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

  const closeFilePreview = React.useCallback(() => {
    filePreviewRequestIdRef.current += 1;
    setFilePreview(null);
  }, []);

  const membersPanelStyle = { width: `${membersPanelWidth}px`, flexBasis: `${membersPanelWidth}px` };
  const membersSidebarStyle = { width: `${membersPanelWidth}px`, flexBasis: `${membersPanelWidth}px` };
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
    setWebPreviewWidth(clampWebPreviewWidth(nextWidth, containerWidth, showLeadingFilePreview, membersPanelWidth));
  }, [membersPanelWidth, showLeadingFilePreview]);

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

  const openFilePreview = React.useCallback(async (rootPath, node) => {
    if (!rootPath || !node?.path || node.type !== 'file') return;

    const absolutePath = resolveListedEntryPath(rootPath, node.path);
    if (!absolutePath) return;

    const requestId = filePreviewRequestIdRef.current + 1;
    filePreviewRequestIdRef.current = requestId;

    setFilePreview({
      path: absolutePath,
      name: node.name,
      kind: 'pending',
      language: getFileExtension(node.name) || 'text',
      status: 'loading',
      content: '',
      error: ''
    });

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

    if (previewKind === 'unsupported') {
      if (filePreviewRequestIdRef.current !== requestId) return;
      setFilePreview({
        path: absolutePath,
        name: node.name,
        kind: 'unsupported',
        language: previewLanguage,
        status: 'unsupported',
        content: '',
        error: '暂不支持预览该类型文件'
      });
      return;
    }

    try {
      const content = await window.api.file.readExternal(absolutePath, true);
      if (filePreviewRequestIdRef.current !== requestId) return;
      setFilePreview({
        path: absolutePath,
        name: node.name,
        kind: previewKind,
        language: previewLanguage,
        status: 'ready',
        content: String(content || ''),
        error: ''
      });
    } catch (error) {
      if (filePreviewRequestIdRef.current !== requestId) return;
      setFilePreview({
        path: absolutePath,
        name: node.name,
        kind: previewKind,
        language: previewLanguage,
        status: 'error',
        content: '',
        error: error?.message || '读取文件失败'
      });
    }
  }, []);

  const openHtmlWebPreview = React.useCallback((rootPath, node) => {
    if (typeof onOpenWebPreview !== 'function' || !rootPath || !node?.path || node.type !== 'file') return;
    if (!isHtmlPreviewFileName(node.name)) return;

    const absolutePath = resolveListedEntryPath(rootPath, node.path);
    const url = createFilePreviewUrl(absolutePath);
    if (!absolutePath || !url) return;

    onOpenWebPreview({
      key: `workspace-html:${absolutePath}`,
      url,
      title: node.name || getBaseName(absolutePath) || '网页预览',
      sourcePath: absolutePath
    });
  }, [onOpenWebPreview]);

  const renderTreeNodes = React.useCallback((scopeKey, rootPath, nodes, depth = 1) => {
    if (!Array.isArray(nodes) || nodes.length === 0) return null;

    return nodes.map((node) => {
      const compositeKey = `${scopeKey}:${node.path}`;
      const isDirectory = node.type === 'directory';
      const isExpanded = isDirectory && expandedNodeKeys.has(compositeKey);
      const FileIcon = isDirectory ? null : getFileIcon(node.name);
      const absolutePath = isDirectory ? '' : resolveListedEntryPath(rootPath, node.path);
      const isHtmlFile = !isDirectory && isHtmlPreviewFileName(node.name);
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
            {isHtmlFile && (
              <button
                type="button"
                className="chat-panel__tree-hover-action"
                onClick={(event) => {
                  event.stopPropagation();
                  openHtmlWebPreview(rootPath, node);
                }}
                title="在内嵌浏览器中打开"
                aria-label={`在内嵌浏览器中打开 ${node.name}`}>
                <Play size={32} strokeWidth={2.2} aria-hidden="true" />
              </button>
            )}
          </div>
          {isDirectory && isExpanded && Array.isArray(node.children) && renderTreeNodes(scopeKey, rootPath, node.children, depth + 1)}
        </React.Fragment>
      );
    });
  }, [expandedNodeKeys, filePreview?.path, openFilePreview, openHtmlWebPreview, toggleNodeExpanded]);

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
            onClick={() => onCreateSession && onCreateSession()}>
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
        <div className={`chat-panel__preview-pane chat-panel__preview-pane--leading ${showLeadingFilePreview ? 'is-open' : ''}`.trim()}>
          {showLeadingFilePreview && (
            <TextFilePreview
              preview={filePreview}
              currentModelMeta={currentModelMeta}
              onClose={closeFilePreview}
              onSubmitComment={onSubmitFileComment}
              submittingComment={sessionSending}
            />
          )}
        </div>
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
        <div className="chat-panel__members" style={membersPanelStyle}>
          <div className="chat-panel__members-sidebar" style={membersSidebarStyle}>
            <div className="chat-panel__members-list">
            {hasLockedWorkspace && (
              <>
                <div className="chat-panel__members-title">
                  技能成员
                  {!skillsLoading && <span className="chat-panel__members-count">{skills.length}</span>}
                </div>
                {skillsLoading && <div className="chat-panel__members-empty">加载中...</div>}
                {!skillsLoading && skillsError && <div className="chat-panel__members-empty">{skillsError}</div>}
                {!skillsLoading && !skillsError && skills.length === 0 && (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="未发现技能"
                    className="chat-panel__empty-state"
                  />
                )}
                {!skillsLoading && !skillsError && skills.map((skill) => {
                  const skillKey = getSkillKey(skill);
                  const folderLabel = getSkillFolderLabel(skill);
                  const displayName = getSkillDisplayName(skill);
                  const isExpanded = expandedSkillKeys.has(skillKey);
                  const treeNodes = skillTrees[skillKey] || [];
                  const isTreeLoading = Boolean(skillTreeLoading[skillKey]);

                  return (
                    <Tooltip
                      key={skillKey}
                      title={renderSkillTooltip(skill)}
                      placement="leftTop"
                      mouseEnterDelay={0.15}
                      classNames={{ root: 'chat-panel__member-tooltip-overlay' }}>
                      <div className="chat-panel__member-group">
                        <div className="chat-panel__member-item">
                          <button
                            type="button"
                            className={`chat-panel__tree-toggle chat-panel__tree-toggle--root ${isExpanded ? 'is-expanded' : ''}`}
                            onClick={() => void toggleSkillExpanded(skill)}
                            aria-label={`${isExpanded ? '折叠' : '展开'} ${folderLabel || displayName}`}>
                            <ChevronRight className="chat-panel__tree-chevron" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="chat-panel__member-main"
                            onClick={() => void toggleSkillExpanded(skill)}
                            title={folderLabel || displayName}>
                            <span className="chat-panel__tree-icon" aria-hidden="true">
                              {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                            </span>
                            <span className="chat-panel__member-text">
                              <span className="chat-panel__member-name">{folderLabel || displayName}</span>
                              {displayName && displayName !== folderLabel && (
                                <span className="chat-panel__member-alias">{displayName}</span>
                              )}
                            </span>
                          </button>
                          {typeof onSelectSkill === 'function' && (
                            <button
                              type="button"
                              className="chat-panel__member-action"
                              onClick={(event) => {
                                event.stopPropagation();
                                onSelectSkill(skill);
                              }}
                              title="插入到输入框">
                              <AtSign size={12} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                        {isExpanded && (
                          <div className="chat-panel__member-tree">
                            {isTreeLoading && <div className="chat-panel__members-empty">加载目录中...</div>}
                            {!isTreeLoading && treeNodes.length === 0 && (
                              <div className="chat-panel__members-empty">目录为空</div>
                            )}
                            {!isTreeLoading && treeNodes.length > 0 && renderTreeNodes(skillKey, skill?.__skillRoot, treeNodes)}
                          </div>
                        )}
                      </div>
                    </Tooltip>
                  );
                })}
                <button
                  type="button"
                  className="chat-panel__members-create-btn"
                  onClick={() => onCreateSkill && onCreateSkill()}>
                  <UserPlus className="chat-panel__members-create-icon" aria-hidden="true" />
                  <span>新建成员</span>
                </button>
                <div className="chat-panel__section-divider" aria-hidden="true" />
              </>
            )}
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
              <div className={`chat-panel__workspace-section ${hasLockedWorkspace ? 'is-bound' : ''}`.trim()}>
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
                            onClick={() => void bindWorkspaceToSession(workspacePath)}
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
        <div className={`chat-panel__preview-pane chat-panel__preview-pane--trailing ${showTrailingWebPreview ? 'is-open' : ''}`.trim()} style={trailingWebPreviewStyle}>
          {webPreview && (
            <WebPagePreview preview={webPreview} onClose={onCloseWebPreview} />
          )}
        </div>
      </div>
      <WorkspaceCreateDialog
        open={createWorkspaceDialogOpen}
        parentDir={createWorkspaceParentDir}
        workspaceName={createWorkspaceName}
        submitting={createWorkspaceSubmitting}
        onClose={() => {
          if (createWorkspaceSubmitting) return;
          setCreateWorkspaceDialogOpen(false);
        }}
        onPickParentDir={handlePickWorkspaceParentDir}
        onWorkspaceNameChange={setCreateWorkspaceName}
        onConfirm={() => void handleCreateWorkspace()}
      />
    </div>
  );
};

export default ChatShell;
