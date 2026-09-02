import React from 'react';
import { Tooltip, Tour, message } from 'antd';
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
import WebPagePreview from './WebPagePreview';
import WorkSpace from './WorkSpace/WorkSpace';
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
const getConfigObject = (value) => (value && typeof value === 'object' ? value : {});
const getSelectedWorkspacePath = (session) => {
  const config = getConfigObject(session?.configuration);
  const configuredPath = normalizePath(config?.selected_workspace_path || '');
  if (configuredPath) return configuredPath;
  return normalizePath(session?.accessible_paths?.[0] || '');
};
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
  const currentWorkspacePath = React.useMemo(() => getSelectedWorkspacePath(runtimeSession), [runtimeSession]);
  const hasLockedWorkspace = Boolean(currentWorkspacePath);
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
    resolvedSessionId,
    runtimeSessionId,
    runtimeSession?.configuration,
    runtimeSession?.id
  ]);

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

  const renderTreeNodes = React.useCallback((scopeKey, rootPath, nodes, depth = 1, options = {}) => {
    if (!Array.isArray(nodes) || nodes.length === 0) return null;

    return nodes.map((node) => {
      const compositeKey = `${scopeKey}:${node.path}`;
      const isDirectory = node.type === 'directory';
      const isExpanded = isDirectory && expandedNodeKeys.has(compositeKey);
      const FileIcon = isDirectory ? null : getFileIcon(node.name);
      const absolutePath = resolveListedEntryPath(rootPath, node.path);
      const isPreviewSelected = !isDirectory && absolutePath && filePreview?.path === absolutePath;
      const showDeleteAction = Boolean(options?.showDeleteAction && typeof options?.onDeleteNode === 'function');

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
            <WorkSpace
              agentId={agentId}
              resolvedSessionId={resolvedSessionId}
              currentWorkspacePath={currentWorkspacePath}
              hasLockedWorkspace={hasLockedWorkspace}
              workspaceStatus={workspaceStatus}
              onBindWorkspace={bindWorkspaceToSession}
              renderTreeNodes={renderTreeNodes}
              beginnerGuideCreateWorkspaceButtonRef={beginnerGuideCreateWorkspaceButtonRef}
              beginnerGuideWorkspaceDialogRef={beginnerGuideWorkspaceDialogRef}
              beginnerGuideWorkspaceNameInputRef={beginnerGuideWorkspaceNameInputRef}
            />
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
              onRefreshFilePreview={handleRefreshFilePreview}
              onSaveFileEdit={handleSaveFilePreview}
              onSubmitFileComment={onSubmitFileComment}
              onTabClose={handlePreviewTabClose}
              submittingComment={sessionSending}
            />
          )}
        </div>
      </div>
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
