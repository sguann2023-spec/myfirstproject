import InlinePreviewPane from './InlinePreviewPane';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChatTaskContext } from './ChatTaskContext';
import { readOptionalSkillExampleText } from '../Composer/skillExample';
import { resolveMarkdownFilePath } from '../../../shared/markdownFileLinks';
import PartSplitToolDetail from '../../PartSplitToolDetail';
import { Tooltip, message } from 'antd';
import {
  ChevronRight,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileVideoCamera,
  Folder,
  FolderOpen,
  Trash2,
} from 'lucide-react';
import './ChatShell.css';
import SidebarToggleIcon from '../../Icons/SidebarToggleIcon';
import NewChatIcon from '../../../../public/new_chat.svg';
import SkillMembersSection from './SkillMembers/SkillMembersSection';
import SkillSourcePreview from './SkillSourcePreview';
import { parseSkillDisplayMetadata } from './SkillMembers/skillDisplayMetadata';
import MCPSettings from './MCPSettings/MCPSettings';
import WebPagePreview from './WebPagePreview';
import { useWorkspaceController, WorkspaceDialogs } from './WorkSpace/WorkSpace';
import { DownloadController } from '../../../shared/DownloadController.js';
import { parseDraftDownloaderUrl } from '../../../shared/draftDownloaderUrl';
import { getArtifactFileSource, getArtifactFileName } from '../artifactFileTarget';
import { loggerService } from '@logger';

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
  return `file://${normalizedPathname.split('/').map((part, index) => (index === 1 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part))).join('/')}`;
};
const normalizeWebPreviewUrl = (value = '') => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(normalized)) return normalized;
  return `https://${normalized}`;
};
const isInlineWebPreviewUrl = (value = '') => {
  try {
    const parsed = new URL(normalizeWebPreviewUrl(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:';
  } catch (_error) {
    return false;
  }
};
const getConfigObject = (value) => (value && typeof value === 'object' ? value : {});
const getSelectedWorkspacePath = (session) => {
  const config = getConfigObject(session?.configuration);
  const configuredPath = normalizePath(config?.selected_workspace_path || '');
  if (configuredPath) return configuredPath;
  return normalizePath(session?.accessible_paths?.[0] || '');
};
const WEB_PREVIEW_WIDTH_STORE_KEY = 'chat-web-preview-width:v1';
const TREE_LIST_MAX_ENTRIES = 20000;
const DEFAULT_PREVIEW_PANE_WIDTH = 400;
const WEB_PREVIEW_RESIZER_WIDTH = 8;
const MIN_WEB_PREVIEW_WIDTH = 320;
const MIN_MAIN_PANEL_WIDTH = 260;
const MAX_WEB_PREVIEW_WIDTH = 880;
const isWindows = typeof process !== 'undefined' && process.platform === 'win32';
const clampWebPreviewWidth = (nextWidth, containerWidth) => {
  const safeContainerWidth = Number(containerWidth) || 0;
  const computedMaxWidth = safeContainerWidth > 0
    ? safeContainerWidth - MIN_MAIN_PANEL_WIDTH - WEB_PREVIEW_RESIZER_WIDTH
    : MAX_WEB_PREVIEW_WIDTH;
  const maxWidth = Math.max(MIN_WEB_PREVIEW_WIDTH, Math.min(MAX_WEB_PREVIEW_WIDTH, computedMaxWidth));
  return Math.min(maxWidth, Math.max(MIN_WEB_PREVIEW_WIDTH, Math.round(Number(nextWidth) || DEFAULT_PREVIEW_PANE_WIDTH)));
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
const getSkillFolderLabel = (skill) => String(skill?.folderName || skill?.filename || skill?.id || '').trim();
const getSkillDisplayName = (skill) => String(skill?.name || '').trim();

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
  onOpenSkillStore,
  onModifySkill,
  onSubmitFileComment,
  onAddWorkspaceFile,
  onAddArtifactToChat,
  onAddDraftToChat,
  onSubmitToolTask,
  sessionSending = false,
  sessionMessages = [],
  webPreview = null,
  previewWindowReady = true,
  onCloseWebPreview,
  onOpenWebPreview,
  onInlinePreviewVisibilityChange,
  pinnedDrafts = [],
  pinnedAudios = [],
  pinnedImages = [],
  pinnedVideos = [],
  pinnedDocuments = [],
  pinnedDraftSessionActive = false,
  pinnedDraftSessionFulfilled = false,
  onPinnedDraftPreviewItem,
  onPinnedDraftDownloadItem,
  pinnedDraftPreviewLoadingKey = null,
  pinnedDraftPreviewErrorKey = null,
  pinnedDraftPreviewErrorMessage = '',
  children
}) => {
  const { t } = useTranslation();
  const sessionScopeKey = JSON.stringify([agentId || '', chatSessionId || '']);
  const sessionScopeRef = React.useRef({ key: sessionScopeKey });
  if (sessionScopeRef.current.key !== sessionScopeKey) sessionScopeRef.current = { key: sessionScopeKey };
  const sessionScope = sessionScopeRef.current;
  const [resolvedSessionState, setResolvedSessionState] = React.useState({ owner: sessionScope, id: runtimeSessionId || '' });
  const [runtimeSessionState, setRuntimeSessionState] = React.useState({ owner: sessionScope, session: null });
  const resolvedSessionId = runtimeSessionId || (resolvedSessionState.owner === sessionScope ? resolvedSessionState.id : '');
  const runtimeSession = runtimeSessionState.owner === sessionScope && runtimeSessionState.session?.id === resolvedSessionId
    ? runtimeSessionState.session : null;
  const runtimeRequestRef = React.useRef(0);
  const workspaceBindingRef = React.useRef(null);
  const setResolvedSessionId = React.useCallback((id) => {
    if (sessionScopeRef.current === sessionScope) setResolvedSessionState({ owner: sessionScope, id });
  }, [sessionScope]);
  const setRuntimeSession = React.useCallback((updater) => {
    if (sessionScopeRef.current !== sessionScope) return;
    setRuntimeSessionState((previous) => ({
      owner: sessionScope,
      session: typeof updater === 'function' ? updater(previous.owner === sessionScope ? previous.session : null) : updater
    }));
  }, [sessionScope]);
  const applyRuntimeSessionSnapshot = React.useCallback((snapshot, targetSessionId) => {
    setRuntimeSession((previous) => {
      // A bound workspace cannot be removed within a session. A stale read (or read failure)
      // must not undo a successful binding, even if the read starts after updateSession returns.
      if (previous?.id === targetSessionId && getSelectedWorkspacePath(previous) && !getSelectedWorkspacePath(snapshot)) {
        if (!snapshot) return previous;
        return {
          ...snapshot,
          accessible_paths: previous.accessible_paths,
          configuration: { ...getConfigObject(snapshot.configuration), selected_workspace_path: getSelectedWorkspacePath(previous) }
        };
      }
      return snapshot;
    });
  }, [setRuntimeSession]);
  React.useEffect(() => {
    const renamed = ({ detail: { source, target } }) => {
      const remap = (value) => typeof value === 'string' && (value === source || value.startsWith(`${source}/`))
        ? target + value.slice(source.length) : value;
      setRuntimeSession((previous) => previous ? { ...previous,
        accessible_paths: previous.accessible_paths?.map(remap),
        configuration: { ...previous.configuration, selected_workspace_path: remap(previous.configuration?.selected_workspace_path) }
      } : previous);
      setSkillPreviewPaths({});
    };
    window.addEventListener('workspace-renamed', renamed);
    return () => window.removeEventListener('workspace-renamed', renamed);
  }, [setRuntimeSession]);
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(sessionTitle);
  const [skillsLoading, setSkillsLoading] = React.useState(true);
  const [skillsError, setSkillsError] = React.useState('');
  const [skills, setSkills] = React.useState([]);
  const [skillPreviewPaths, setSkillPreviewPaths] = React.useState({});
  const [skillExamplePaths, setSkillExamplePaths] = React.useState({});
  const [expandedSkillKeys, setExpandedSkillKeys] = React.useState(() => new Set());
  const [skillMembersCollapsed, setSkillMembersCollapsed] = React.useState(false);
  const [expandedNodeKeys, setExpandedNodeKeys] = React.useState(() => new Set());
  const [skillTrees, setSkillTrees] = React.useState({});
  const [skillTreeLoading, setSkillTreeLoading] = React.useState({});
  const [filePreview, setFilePreview] = React.useState(null);
  const [storyboardTarget, setStoryboardTarget] = React.useState(null);
  const [storyboardBusy, setStoryboardBusy] = React.useState(false);
  const [panePreview, setPanePreview] = React.useState(() => (
    webPreview?.key && webPreview?.url
      ? { ...webPreview, previewType: 'web', activate: true }
      : null
  ));
  const [inlinePreviewCollapsed, setInlinePreviewCollapsed] = React.useState(false);
  const inlinePreviewId = React.useId();
  const [webPreviewWidth, setWebPreviewWidth] = React.useState(() => readWebPreviewWidth());
  const [isResizingWebPreview, setIsResizingWebPreview] = React.useState(false);
  const previousChatSessionIdRef = React.useRef(String(chatSessionId || '').trim());
  const titleInputRef = React.useRef(null);
  const pendingFilePreviewKeysRef = React.useRef(new Set());
  const closedFilePreviewKeysRef = React.useRef(new Set());
  const contentRef = React.useRef(null);
  const previewResizeCleanupRef = React.useRef(null);
  const currentWorkspacePath = React.useMemo(() => getSelectedWorkspacePath(runtimeSession), [runtimeSession]);
  React.useEffect(() => { setStoryboardTarget(null); }, [chatSessionId, currentWorkspacePath]);
  const hasLockedWorkspace = Boolean(currentWorkspacePath);
  const previewRequested = Boolean(panePreview) && !inlinePreviewCollapsed;
  const showTrailingWebPreview = previewRequested && previewWindowReady;
  const isResizingAnyPanel = isResizingWebPreview;
  React.useLayoutEffect(() => {
    if (typeof onInlinePreviewVisibilityChange !== 'function') return undefined;
    onInlinePreviewVisibilityChange(previewRequested, webPreviewWidth);
    return () => {
      onInlinePreviewVisibilityChange(false);
    };
  }, [onInlinePreviewVisibilityChange, previewRequested, webPreviewWidth]);

  React.useLayoutEffect(() => {
    setResolvedSessionId(runtimeSessionId || '');
  }, [runtimeSessionId, setResolvedSessionId]);

  React.useEffect(() => {
    writeWebPreviewWidth(webPreviewWidth);
  }, [webPreviewWidth]);

  React.useEffect(() => {
    if (!showTrailingWebPreview) return undefined;
    const syncWebPreviewWidth = () => {
      const containerWidth = contentRef.current?.clientWidth || 0;
      setWebPreviewWidth((prev) => clampWebPreviewWidth(prev, containerWidth));
    };

    syncWebPreviewWidth();
    window.addEventListener('resize', syncWebPreviewWidth);
    return () => window.removeEventListener('resize', syncWebPreviewWidth);
  }, [showTrailingWebPreview]);

  React.useEffect(() => {
    if (!showTrailingWebPreview) {
      previewResizeCleanupRef.current?.();
      setIsResizingWebPreview(false);
    }
  }, [showTrailingWebPreview]);

  React.useEffect(() => () => previewResizeCleanupRef.current?.(), []);

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
    const requestId = ++runtimeRequestRef.current;

    const loadRuntimeSession = async () => {
      if (!resolvedSessionId) {
        setRuntimeSession(null);
        return;
      }
      try {
        const result = await window.electronAPI.cherryChatStream.getSession(resolvedSessionId);
        if (cancelled || requestId !== runtimeRequestRef.current) return;
        applyRuntimeSessionSnapshot(result?.ok ? result.session || null : null, resolvedSessionId);
      } catch (_error) {
        if (!cancelled && requestId === runtimeRequestRef.current) {
          applyRuntimeSessionSnapshot(null, resolvedSessionId);
        }
      }
    };

    void loadRuntimeSession();
    return () => {
      cancelled = true;
    };
  }, [resolvedSessionId, setRuntimeSession, applyRuntimeSessionSnapshot]);

  React.useEffect(() => {
    const api = window?.electronAPI?.agentSessionStream;
    const targetSessionId = String(resolvedSessionId || '').trim();
    if (!targetSessionId || typeof api?.onSessionChanged !== 'function') return undefined;

    let cancelled = false;
    const unsubscribe = api.onSessionChanged((payload) => {
      if (payload?.reason === 'token-stats') return;
      if (String(payload?.sessionId || '').trim() !== targetSessionId) return;
      const requestId = ++runtimeRequestRef.current;
      void (async () => {
        try {
          const result = await window.electronAPI.cherryChatStream.getSession(targetSessionId);
          if (!cancelled && requestId === runtimeRequestRef.current) applyRuntimeSessionSnapshot(result?.ok ? result.session || null : null, targetSessionId);
        } catch (_error) {
          if (!cancelled && requestId === runtimeRequestRef.current) applyRuntimeSessionSnapshot(null, targetSessionId);
        }
      })();
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [resolvedSessionId, setRuntimeSession, applyRuntimeSessionSnapshot]);

  React.useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(sessionTitle);
    }
  }, [sessionTitle, isEditingTitle]);

  React.useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const resolveSkillDisplayMetadata = React.useCallback(async (skill) => {
    const root = String(skill?.__skillRoot || '').trim();
    if (!root) return { webUrl: '', coverSrc: '' };
    try {
      return parseSkillDisplayMetadata(await readOptionalSkillExampleText(root), root);
    } catch { return { webUrl: '', coverSrc: '' }; }
  }, []);

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

        const displayEntries = await Promise.all(
          normalizedSkills.map(async (skill) => ({ skill, metadata: await resolveSkillDisplayMetadata(skill) }))
        );
        if (cancelled) return;

        const webPaths = Object.fromEntries(displayEntries
          .map(({ skill, metadata }) => [getSkillKey(skill), metadata.webUrl])
          .filter(([skillKey]) => Boolean(skillKey)));
        setSkills(displayEntries.map(({ skill, metadata }) => ({ ...skill, __exampleCoverSrc: metadata.coverSrc })));
        setSkillPreviewPaths(webPaths);
        setSkillExamplePaths(webPaths);
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
    const handleSkillStoreUpdated = () => {
      void loadSkills();
    };
    window.addEventListener('skill-store-updated', handleSkillStoreUpdated);
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
      window.removeEventListener('skill-store-updated', handleSkillStoreUpdated);
    };
  }, [agentId, currentWorkspacePath, resolveSkillDisplayMetadata, runtimeSessionId]);

  React.useEffect(() => {
    setExpandedSkillKeys(new Set());
    setExpandedNodeKeys(new Set());
    setSkillTrees({});
    setSkillTreeLoading({});
  }, [skills]);

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
      if (nextPreview.activate !== false) setInlinePreviewCollapsed(false);
    }
  }, [webPreview]);

  // File updates must not replay a previously requested web navigation.
  React.useEffect(() => {
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

  const loadSkillTree = React.useCallback(async (skill, { throwOnError = false } = {}) => {
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
      return Array.isArray(nodes) ? nodes : [];
    } catch (error) {
      setSkillTrees((prev) => ({ ...prev, [skillKey]: [] }));
      if (throwOnError) throw error;
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

  const toggleSkillMembersCollapsed = React.useCallback(() => {
    setSkillMembersCollapsed((prev) => !prev);
  }, []);

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
    if (!normalizedSelected || workspaceBindingRef.current?.owner === sessionScope) return false;
    const request = { owner: sessionScope };
    workspaceBindingRef.current = request;
    const isCurrent = () => workspaceBindingRef.current === request && sessionScopeRef.current === sessionScope;

    try {
      let nextSessionId = String(resolvedSessionId || runtimeSessionId || runtimeSession?.id || '').trim();
      if (!nextSessionId && typeof onEnsureRuntimeSession === 'function') {
        nextSessionId = String(await onEnsureRuntimeSession()).trim();
      }
      if (!isCurrent()) return false;
      if (!nextSessionId) {
        window.toast.warning('请稍后重试');
        return false;
      }
      if (nextSessionId !== resolvedSessionId) {
        setResolvedSessionId(nextSessionId);
      }

      if (seedSkills) {
        const seedResult = await window.electronAPI.agentSkills.seedWorkspace({ workspace: normalizedSelected });
        if (!isCurrent()) return false;
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
      if (!isCurrent()) return false;
      if (!updateResult?.ok || !updateResult?.session) {
        throw new Error(updateResult?.error || '绑定工作空间失败');
      }

      ++runtimeRequestRef.current;
      setRuntimeSession(updateResult.session);
      return true;
    } catch (error) {
      if (isCurrent()) window.toast.error(error?.message || '绑定工作空间失败');
      return false;
    } finally {
      if (workspaceBindingRef.current === request) workspaceBindingRef.current = null;
    }
  }, [
    sessionScope,
    setResolvedSessionId,
    setRuntimeSession,
    agentId,
    hasLockedWorkspace,
    onEnsureRuntimeSession,
    resolvedSessionId,
    runtimeSessionId,
    runtimeSession?.configuration,
    runtimeSession?.id
  ]);

  const workspaceController = useWorkspaceController({
    agentId,
    chatSessionId,
    resolvedSessionId,
    currentWorkspacePath,
    hasLockedWorkspace,
    workspaceStatus,
    onBindWorkspace: bindWorkspaceToSession,
    onAddWorkspaceFile
  });

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

  const saveArtifactAs = React.useCallback(async (item) => {
    const source = getArtifactFileSource(item);
    if (!source) return;
    try {
      const savedPath = await window.api.file.saveAs(source, getArtifactFileName(item));
      if (savedPath) message.success('文件已保存');
    } catch (error) {
      message.error(error?.message || '另存为失败');
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

  const updateWebPreviewWidth = React.useCallback((nextWidth) => {
    const containerWidth = contentRef.current?.clientWidth || 0;
    setWebPreviewWidth(clampWebPreviewWidth(nextWidth, containerWidth));
  }, []);

  const openInlinePreviewPane = React.useCallback((nextPreview) => {
    if (!nextPreview) return;

    setPanePreview(nextPreview);
    if (nextPreview.activate !== false) setInlinePreviewCollapsed(false);
  }, []);

  const openWebUrlInPreview = React.useCallback((url, title = '') => {
    const normalizedUrl = normalizeWebPreviewUrl(url);
    if (!normalizedUrl || !isInlineWebPreviewUrl(normalizedUrl)) return;

    // 草稿下载跳链（https://www.vectcut.com/draft/downloader?draft_id=xxx）：拦截跳转，直接加入下载队列
    if (parseDraftDownloaderUrl(normalizedUrl)) {
      DownloadController.enqueueFromDownloaderUrl(normalizedUrl, title)
        .then((enqueued) => {
          if (enqueued) {
            message.success('已加入下载队列');
          }
        })
        .catch((error) => {
          logger.warn('[ChatShell] failed to enqueue draft downloader link', {
            url: normalizedUrl,
            error: error?.message || String(error)
          });
          message.error('加入下载队列失败，请稍后重试');
        });
      return;
    }

    const previewKeySuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    openInlinePreviewPane({
      key: `chat-link:${normalizedUrl}:${previewKeySuffix}`,
      url: normalizedUrl,
      title: String(title || normalizedUrl).trim() || normalizedUrl,
      previewType: 'web',
      activate: true
    });
  }, [openInlinePreviewPane]);

  const handleWebPreviewResizeStart = React.useCallback((event) => {
    if (!showTrailingWebPreview) return;
    event.preventDefault();
    event.stopPropagation();
    previewResizeCleanupRef.current?.();
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
      previewResizeCleanupRef.current = null;
    };

    previewResizeCleanupRef.current = handleMouseUp;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [showTrailingWebPreview, updateWebPreviewWidth, webPreviewWidth]);

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

  const toggleInlinePreview = () => {
    setIsResizingWebPreview(false);
    if (previewRequested) {
      setInlinePreviewCollapsed(true);
      return;
    }
    if (!panePreview) setPanePreview({ key: 'inline-preview:new-tab', previewType: 'new-tab', activate: true });
    setInlinePreviewCollapsed(false);
  };

  const loadFilePreviewByPath = React.useCallback(async (absolutePath, fileName = '') => {
    if (!absolutePath) return;

    const normalizedFileName = String(fileName || '').trim() || getBaseName(absolutePath) || '文件预览';
    const previewKey = `file-preview:${absolutePath}`;
    const previewTabId = `file-preview-tab:${absolutePath}`;
    const pendingPreview = {
      key: previewKey,
      tabId: previewTabId,
      title: normalizedFileName,
      previewType: 'file',
      activate: true,
      path: absolutePath,
      name: normalizedFileName,
      kind: 'pending',
      language: getFileExtension(normalizedFileName) || 'text',
      status: 'loading',
      content: '',
      error: ''
    };
    closedFilePreviewKeysRef.current.delete(previewKey);
    pendingFilePreviewKeysRef.current.add(previewKey);
    setFilePreview(pendingPreview);
    openInlinePreviewPane(pendingPreview);

    let previewKind = getPreviewKindForFileName(normalizedFileName);
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
      : (getFileExtension(normalizedFileName) || 'text');
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

  const openFilePath = React.useCallback(async (href) => {
    try {
      await loadFilePreviewByPath(resolveMarkdownFilePath(href, currentWorkspacePath));
    } catch (error) {
      message.warning(error?.message || '无法打开本地文件');
    }
  }, [currentWorkspacePath, loadFilePreviewByPath]);

  const openFilePreview = React.useCallback(async (rootPath, node) => {
    if (!rootPath || !node?.path || node.type !== 'file') return;

    const absolutePath = resolveListedEntryPath(rootPath, node.path);
    if (!absolutePath) return;

    await loadFilePreviewByPath(absolutePath, node.name);
  }, [loadFilePreviewByPath]);

  const handleRefreshFilePreview = React.useCallback(async ({ filePath, fileName }) => {
    const absolutePath = String(filePath || '').trim();
    if (!absolutePath) return false;

    await loadFilePreviewByPath(absolutePath, fileName);
    return true;
  }, [loadFilePreviewByPath]);

  const openSkillWebPreview = React.useCallback((skill) => {
    const skillKey = getSkillKey(skill);
    const sourcePath = skillPreviewPaths[skillKey];
    const url = /^https?:\/\//i.test(sourcePath || '') ? sourcePath : '';
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
    const url = /^https?:\/\//i.test(examplePath || '') ? examplePath : '';

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
  }, [onOpenWebPreview, skillExamplePaths]);

  const renderTreeNodes = React.useCallback((scopeKey, rootPath, nodes, depth = 1, options = {}) => {
    if (!Array.isArray(nodes) || nodes.length === 0) return null;

    return nodes.map((node) => {
      const compositeKey = `${scopeKey}:${node.path}`;
      const isDirectory = node.type === 'directory';
      const isExpanded = isDirectory && expandedNodeKeys.has(compositeKey);
      const FileIcon = isDirectory ? null : getFileIcon(node.name);
      const absolutePath = resolveListedEntryPath(rootPath, node.path);
      const showDeleteAction = Boolean(options?.showDeleteAction && typeof options?.onDeleteNode === 'function');

      return (
        <React.Fragment key={compositeKey}>
          <div
            className={`chat-panel__tree-item ${isDirectory ? 'is-directory' : 'is-file'}`}
            style={{ '--tree-depth': depth }}
            onClick={() => {
              if (isDirectory) {
                toggleNodeExpanded(scopeKey, node.path);
              } else {
                void openFilePreview(rootPath, node);
              }
            }}
            onContextMenu={options.onContextMenu ? (event) => options.onContextMenu(event, { rootPath, node, absolutePath, onOpen: () => isDirectory ? toggleNodeExpanded(scopeKey, node.path) : void openFilePreview(rootPath, node) }) : undefined}
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
            {showDeleteAction ? (
              <button
                type="button"
                className="chat-panel__tree-action chat-panel__tree-action--danger"
                onClick={(event) => {
                  event.stopPropagation();
                  void options.onDeleteNode({
                    scopeKey,
                    rootPath,
                    node,
                    absolutePath,
                    isDirectory,
                  });
                }}
                title={`删除${isDirectory ? '文件夹' : '文件'}：${node.name}`}
                aria-label={`删除${isDirectory ? '文件夹' : '文件'}：${node.name}`}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {isDirectory && isExpanded && Array.isArray(node.children) && renderTreeNodes(scopeKey, rootPath, node.children, depth + 1, options)}
        </React.Fragment>
      );
    });
  }, [expandedNodeKeys, openFilePreview, toggleNodeExpanded]);

  const openSkillSource = (skill) => {
    const skillKey = getSkillKey(skill);
    const rootPath = normalizePath(skill?.__skillRoot || skill?.path || '').trim();
    openInlinePreviewPane({
      key: `skill-source:${skillKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      previewType: 'skill-source', skillKey, rootPath,
      title: getSkillDisplayName(skill) || getSkillFolderLabel(skill) || '源码', activate: true
    });
  };
  const loadSkillSource = React.useCallback((preview) => loadSkillTree({
    id: preview.skillKey, __skillRoot: preview.rootPath
  }, { throwOnError: true }), [loadSkillTree]);
  const renderSkillSource = (preview) => <SkillSourcePreview preview={preview} onLoad={loadSkillSource} renderTreeNodes={renderTreeNodes} />;

  const renderSkillMembers = () => (
    <SkillMembersSection
      variant="preview"
      title={t('previewTab.mySkills')}
      skillsLoading={skillsLoading}
      skillsError={skillsError}
      skills={skills}
      skillPreviewPaths={skillPreviewPaths}
      skillExamplePaths={skillExamplePaths}
      expandedSkillKeys={expandedSkillKeys}
      skillTrees={skillTrees}
      skillTreeLoading={skillTreeLoading}
      onToggleSkillExpanded={toggleSkillExpanded}
      skillMembersCollapsed={skillMembersCollapsed}
      onToggleSkillMembersCollapsed={toggleSkillMembersCollapsed}
      onOpenSkillWebPreview={openSkillWebPreview}
      onRunSkillExample={runSkillExample}
      onSelectSkill={onSelectSkill}
      onOpenSkillSource={openSkillSource}
      onOpenSkillStore={onOpenSkillStore}
      onModifySkill={onModifySkill}
      onDeleteSkill={deleteSkill}
      renderSkillTooltip={renderSkillTooltip}
      renderTreeNodes={renderTreeNodes}
      getSkillKey={getSkillKey}
      getSkillFolderLabel={getSkillFolderLabel}
      getSkillDisplayName={getSkillDisplayName}
    />
  );

  return (
    <div
      className={`chat-panel ${isResizingAnyPanel ? 'is-resizing-web-preview' : ''}`.trim()}
      ref={contentRef}
      style={{ '--chat-preview-width': showTrailingWebPreview ? `${webPreviewWidth}px` : '0px' }}>
      {isResizingAnyPanel && <div className="chat-panel__resize-shield" aria-hidden="true" />}
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
        <span className="chat-panel__navbar-spacer" />
        <MCPSettings />
      </div>

      <div className="chat-panel__content">
        <div className="chat-panel__main">
          <ChatTaskContext.Provider value={{
            send: onSubmitToolTask,
            running: sessionSending,
            openSubtitleStoryboard: (filePath) => setStoryboardTarget((previous) => (
              storyboardBusy && previous
                ? { ...previous, open: true }
                : { filePath, chatSessionId, workspacePath: currentWorkspacePath, open: true }
            )),
            openWebUrl: openWebUrlInPreview,
            openFilePath,
            openAttachmentPreview: openInlinePreviewPane,
          }}>
            {children}
            {storyboardTarget && storyboardTarget.chatSessionId === chatSessionId
              && storyboardTarget.workspacePath === currentWorkspacePath ? <PartSplitToolDetail
                key={`${chatSessionId}:${currentWorkspacePath}:${storyboardTarget.filePath}`}
                open={storyboardTarget.open}
                workspacePath={currentWorkspacePath}
                initialFilePath={storyboardTarget.filePath}
                onBusyChange={setStoryboardBusy}
                onClose={() => setStoryboardTarget((previous) => previous ? { ...previous, open: false } : null)}
              /> : null}
          </ChatTaskContext.Provider>
        </div>
        <button
          type="button"
          className={`chat-panel__preview-toggle ${previewRequested ? 'is-open' : ''}`.trim()}
          onClick={toggleInlinePreview}
          aria-label={previewRequested ? '收起预览面板' : '展开预览面板'}
          title={previewRequested ? '收起预览面板' : '展开预览面板'}
          aria-expanded={previewRequested}
          aria-controls={inlinePreviewId}>
          <ChevronRight className="chat-panel__preview-toggle-icon" size={14} aria-hidden="true" />
        </button>
      </div>
      <InlinePreviewPane id={inlinePreviewId} open={showTrailingWebPreview} width={webPreviewWidth}
        resizing={isResizingWebPreview}
        onResizeStart={handleWebPreviewResizeStart} onResetWidth={resetWebPreviewWidth}
        onResizeKeyDown={handleWebPreviewResizeKeyDown}>
        {panePreview ? (
          <WebPagePreview
            preview={panePreview}
            visible={showTrailingWebPreview}
            sessionId={chatSessionId}
            runtimeSessionId={resolvedSessionId}
            sessionMessages={sessionMessages}
            workspaceController={workspaceController}
            renderWorkspaceTreeNodes={renderTreeNodes}
            renderSkillMembers={renderSkillMembers}
            renderSkillSource={renderSkillSource}
            artifactProps={{
              drafts: pinnedDrafts,
              audios: pinnedAudios,
              images: pinnedImages,
              videos: pinnedVideos,
              documents: pinnedDocuments,
              onOpenDocument: (item) => loadFilePreviewByPath(item.filePath, item.name),
              onSaveAs: saveArtifactAs,
              onAddToChat: (item) => onAddArtifactToChat?.(item),
              onAddDraftToChat: (draft) => onAddDraftToChat?.(draft),
              sessionActive: pinnedDraftSessionActive,
              sessionFulfilled: pinnedDraftSessionFulfilled,
              onPreviewItem: onPinnedDraftPreviewItem,
              onDownloadItem: onPinnedDraftDownloadItem,
              previewLoadingKey: pinnedDraftPreviewLoadingKey,
              previewErrorKey: pinnedDraftPreviewErrorKey,
              previewErrorMessage: pinnedDraftPreviewErrorMessage
            }}
            currentModelMeta={currentModelMeta}
            onClose={closeInlinePreviewPane}
            onRefreshFilePreview={handleRefreshFilePreview}
            onSaveFileEdit={handleSaveFilePreview}
            onSubmitFileComment={onSubmitFileComment}
            onTabClose={handlePreviewTabClose}
            submittingComment={sessionSending}
          />
        ) : null}
      </InlinePreviewPane>
      <WorkspaceDialogs controller={workspaceController} />
    </div>
  );
};

export default ChatShell;
