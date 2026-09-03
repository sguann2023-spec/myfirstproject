// HomePage 组件
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './HomePage.css';
import { electronStore } from '../../shared/electronStore';
import LogoIcon from '../../../public/logo-circle.png';
import VipIcon from '../../../public/vip_icon.png';
import { countTodayDrafts } from '../../api/capcut';
import { fetchMessagesSummary, getChatModelList } from '../../api/chat';
import DPane from '../../components/DPane/DPane';
import DraftList from '../../components/DraftList';
import DownloadDualList from '../../components/DownloadDualList/DownloadDualList';
import DraftPreview from '../../components/DraftPreview/DraftPreview';
import { loggerService } from '@logger';
import { DownloadController } from '../../shared/DownloadController.js';
import { mapDownloadErrorMessage } from '../../shared/downloadErrorMessage';
import DownloadList from '../../components/DownloadList/DownloadList';
import DraftDownloadSuccessPreview from '../../components/DraftDownloadSuccessPreview/DraftDownloadSuccessPreview';
import PresetList from '../../components/PresetList/PresetList';
import Preset from '../../components/Preset/Preset';
import ChatHistoryList from '../../components/ChatHistoryList/ChatHistoryList';
import Chat from '../../components/Chat/Chat';
import SkillStorePage from '../../components/SkillStore';
import { getMembershipSummary } from '../../api/membership';
import { checkinRechargeDaily, getRechargeBalance } from '../../api/recharge';
import { tokenStore } from '../../auth';
import { MEMBER_COLOR } from '../../constants/member';
import { normalizeChatError } from '../../shared/chatError';
import { isBeginnerGuideCompleted, isBeginnerGuideReopenPending } from '../../shared/beginnerGuide';
import { limitInlineText, limitInlineToolPayload, sanitizeInlinePayload } from '../../shared/sessionPayloadLimits';
import { resolveWorkspaceParentDirForAgent } from '../../shared/workspaceParentDir';
import appStore from '../../renderer/src/store';
import { updateOneBlock, upsertManyBlocks } from '../../renderer/src/store/messageBlock';
import { newMessagesActions } from '../../renderer/src/store/newMessage';
import { toolPermissionsActions } from '../../renderer/src/store/toolPermissions';
import { setupChannelStream } from '../../renderer/src/store/thunk/messageThunk';
import { MessageBlockStatus } from '../../renderer/src/types/newMessage';
import { createImageBlock, createMainTextBlock, createMessage } from '../../renderer/src/utils/messageUtils/create';
import { IpcChannel } from '../../packages/shared/IpcChannel';
import { isChatSessionCompleted, isChatSessionPending } from '../../shared/chatSessionCompletion';
import { useFullscreen } from '../../renderer/src/hooks/useFullscreen';
const logger = loggerService.withContext('HomePage');

const CHAT_STORAGE_KEY = 'capcut-helper-chat-sessions-v1';
const CHAT_ACTIVE_ID_KEY = 'capcut-helper-chat-active-id-v1';
const CHAT_MODEL_KEY = 'capcut-helper-chat-model-v1';
const DEFAULT_CHAT_TITLE = '新对话';
const CHAT_MODELS = ['gpt-5.3-codex', 'claude-opus-4-7'];
const VECTCUT_ANTHROPIC_API_BASE_URL = 'https://open.vectcut.com/llm/chat';
const CHAT_SNAPSHOT_THROTTLE_MS = 100;
const CHAT_PERSIST_DEBOUNCE_MS = 800;
const DEFAULT_RUNTIME_AGENT_ID = 'vectcut_claw_default';
const WORKSPACE_STORE_KEY = 'chat-workspaces:v1';
const AUTO_WORKSPACE_STATUS_TEXT = '正在新建工作空间...';
const PASTED_MEDIA_DIRECTORY = 'pasted-media';
const CHAT_BROWSER_PREVIEW_WIDTH = 400;
const QUICK_CHILDRENS_PICTURE_BOOK_SKILL_NAME = 'childrensbook';
const QUICK_TRENDY_KOUBO_SKILL_NAME = 'trendykoubo';
const QUICK_LIVE_CLIPPING_SKILL_NAME = 'liveclipping';
const QUICK_TRAVEL_GUIDE_SKILL_NAME = 'travelguide';
const QUICK_SWEATER_SELLING_SKILL_NAME = 'sweaterselling';
const QUICK_CONVENIENCE_STORE_TOUR_SKILL_NAME = 'conveniencestore';
const QUICK_EDUCATION_KNOWLEDGE_SKILL_NAME = 'educationknowledge';
const BLOCK_NEW_CHAT_AFTER_TIMEOUT_MESSAGE = '当前会话已超时，请先在当前会话继续，暂不支持自动新建对话。';

const normalizeLocalPath = (value = '') => String(value || '').replace(/\\/g, '/');
const createLocalFilePreviewUrl = (filePath = '') => {
  const normalizedPath = normalizeLocalPath(filePath).trim();
  if (!normalizedPath) return '';
  const normalizedPathname = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  return encodeURI(`file://${normalizedPathname}`);
};
const buildMarkdownFileLink = (name = '', url = '') => {
  const safeName = String(name || '附件')
    .replace(/\\/g, '\\\\')
    .replace(/\]/g, '\\]');
  return `[${safeName}](${url})`;
};
const getFileExtension = (value = '') => {
  const normalizedValue = String(value || '').trim();
  const matched = normalizedValue.match(/\.([a-zA-Z0-9]+)$/);
  return matched ? matched[1].toLowerCase() : '';
};
const getClipboardFileExtension = (file = {}) => {
  const explicitExtension = getFileExtension(file?.name || '');
  if (explicitExtension) return explicitExtension;

  const mimeType = String(file?.type || '').trim().toLowerCase();
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/bmp') return 'bmp';
  if (mimeType === 'image/svg+xml') return 'svg';
  return 'png';
};
const buildPendingAttachmentFileName = (item = {}, index = 0) => {
  const currentName = String(item?.name || '').trim();
  const extension = getClipboardFileExtension({
    name: currentName,
    type: item?.fileType || item?.file?.type || '',
  });
  const hasPendingGeneratedName = /^pasted_image_[0-9]+_[a-z0-9]+(?:_[0-9]+)?\.[a-z0-9]+$/i.test(currentName);
  if (hasPendingGeneratedName) return currentName;
  return `pasted_image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${index}.${extension}`;
};
const replaceFirstOccurrence = (content = '', target = '', replacement = '') => {
  const normalizedContent = String(content || '');
  const normalizedTarget = String(target || '');
  if (!normalizedTarget) return normalizedContent;
  const targetIndex = normalizedContent.indexOf(normalizedTarget);
  if (targetIndex < 0) return normalizedContent;
  return `${normalizedContent.slice(0, targetIndex)}${replacement}${normalizedContent.slice(targetIndex + normalizedTarget.length)}`;
};
const getSessionWorkspacePath = (session) => {
  const config = session?.configuration && typeof session.configuration === 'object' ? session.configuration : {};
  return normalizeLocalPath(config.selected_workspace_path || session?.accessible_paths?.[0] || '').trim();
};
const joinLocalPath = (...segments) => {
  const joinPath = window?.electronAPI?.path?.join;
  if (typeof joinPath === 'function') {
    return normalizeLocalPath(joinPath(...segments));
  }
  return normalizeLocalPath(segments.filter(Boolean).join('/')).replace(/\/+/g, '/');
};
const resolveDefaultWorkspaceParentDir = (appInfo, agentId = DEFAULT_RUNTIME_AGENT_ID) => {
  const appDataPath = normalizeLocalPath(appInfo?.appDataPath || '');
  if (!appDataPath) return '';
  return resolveWorkspaceParentDirForAgent({
    agentId,
    appDataPath,
    joinPath: window?.electronAPI?.path?.join
  });
};
const dedupeWorkspacePaths = (paths = []) => Array.from(new Set(
  (Array.isArray(paths) ? paths : []).map((item) => normalizeLocalPath(item).trim()).filter(Boolean)
));
const moveWorkspacePathToFront = (paths = [], targetPath = '') => {
  const normalizedTargetPath = normalizeLocalPath(targetPath).trim();
  if (!normalizedTargetPath) return dedupeWorkspacePaths(paths);
  return dedupeWorkspacePaths([normalizedTargetPath, ...paths]);
};
const getWorkspaceVisitTimestamp = (value) => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};
const normalizeWorkspaceAccessTimes = (accessTimes = {}, knownPaths = []) => {
  const normalizedKnownPaths = dedupeWorkspacePaths(knownPaths);
  const normalizedTimes = {};

  if (accessTimes && typeof accessTimes === 'object') {
    Object.entries(accessTimes).forEach(([workspacePath, value]) => {
      const normalizedPath = normalizeLocalPath(workspacePath).trim();
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
const markWorkspaceVisited = (store = {}, workspacePath = '', visitedAt = Date.now()) => {
  const normalizedWorkspacePath = normalizeLocalPath(workspacePath).trim();
  if (!normalizedWorkspacePath) {
    const library = dedupeWorkspacePaths(store?.library);
    const recent = dedupeWorkspacePaths(store?.recent);
    return {
      library,
      recent,
      accessTimes: normalizeWorkspaceAccessTimes(store?.accessTimes, [...library, ...recent])
    };
  }

  const library = dedupeWorkspacePaths([...(store?.library || []), normalizedWorkspacePath]);
  const recent = moveWorkspacePathToFront(store?.recent || [], normalizedWorkspacePath);
  const accessTimes = normalizeWorkspaceAccessTimes(store?.accessTimes, [...library, ...recent]);
  accessTimes[normalizedWorkspacePath] = getWorkspaceVisitTimestamp(visitedAt) || Date.now();

  return {
    library,
    recent,
    accessTimes
  };
};
const readWorkspaceStore = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { library: [], recent: [], accessTimes: {} };
  }
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORE_KEY);
    if (!raw) return { library: [], recent: [], accessTimes: {} };
    const parsed = JSON.parse(raw);
    const library = dedupeWorkspacePaths(parsed?.library);
    const recent = dedupeWorkspacePaths(parsed?.recent);
    return {
      library,
      recent,
      accessTimes: normalizeWorkspaceAccessTimes(parsed?.accessTimes, [...library, ...recent])
    };
  } catch (_error) {
    return { library: [], recent: [], accessTimes: {} };
  }
};
const writeWorkspaceStore = (store = {}) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const library = dedupeWorkspacePaths(store?.library);
    const recent = dedupeWorkspacePaths(store?.recent);
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
const removeWorkspacePathFromStore = (store = {}, workspacePath = '') => {
  const normalizedWorkspacePath = normalizeLocalPath(workspacePath).trim();
  if (!normalizedWorkspacePath) {
    return {
      library: dedupeWorkspacePaths(store?.library),
      recent: dedupeWorkspacePaths(store?.recent),
      accessTimes: normalizeWorkspaceAccessTimes(store?.accessTimes, [
        ...dedupeWorkspacePaths(store?.library),
        ...dedupeWorkspacePaths(store?.recent)
      ])
    };
  }

  const library = dedupeWorkspacePaths(store?.library).filter((path) => path !== normalizedWorkspacePath);
  const recent = dedupeWorkspacePaths(store?.recent).filter((path) => path !== normalizedWorkspacePath);
  return {
    library,
    recent,
    accessTimes: normalizeWorkspaceAccessTimes(store?.accessTimes, [...library, ...recent])
  };
};
const getAutoWorkspaceDatePrefix = (value = Date.now()) => {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}_${day}`;
};

const getWorkspaceNameFromEntry = (entry) => {
  const normalizedEntry = normalizeLocalPath(typeof entry === 'string' ? entry : entry?.name || '').trim();
  if (!normalizedEntry) return '';
  const segments = normalizedEntry.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
};

const buildAutoWorkspaceName = async (parentDir = '') => {
  const prefix = getAutoWorkspaceDatePrefix();
  const normalizedParentDir = normalizeLocalPath(parentDir).trim();
  if (!normalizedParentDir || !window?.api?.file?.listDirectory) {
    return prefix;
  }

  try {
    const entries = await window.api.file.listDirectory(normalizedParentDir, {
      recursive: false,
      includeHidden: false,
      includeFiles: false,
      includeDirectories: true,
      maxEntries: 1000
    });

    const matchedSuffixes = (Array.isArray(entries) ? entries : []).reduce((acc, entry) => {
      const name = getWorkspaceNameFromEntry(entry);
      if (name === prefix) {
        acc.push(0);
        return acc;
      }
      const matched = name.match(new RegExp(`^${prefix}_(\\d+)$`));
      if (matched) {
        acc.push(Number(matched[1]) || 0);
      }
      return acc;
    }, []);

    if (matchedSuffixes.length === 0) {
      return prefix;
    }

    return `${prefix}_${Math.max(...matchedSuffixes) + 1}`;
  } catch (_error) {
    return prefix;
  }
};
const seedWorkspaceSkeleton = async (workspacePath) => {
  const seedResult = await window.electronAPI.agentSkills.seedWorkspace({ workspace: workspacePath });
  if (!seedResult?.ok) {
    throw new Error(seedResult?.error || '初始化工作空间失败');
  }
};
const persistPendingChatLocalAttachments = async ({
  workspacePath = '',
  imageAttachmentPreviews = [],
  pendingLocalAttachments = [],
}) => {
  const normalizedWorkspacePath = normalizeLocalPath(workspacePath).trim();
  if (!normalizedWorkspacePath || pendingLocalAttachments.length === 0) {
    return {
      content: '',
      imageAttachmentPreviews,
    };
  }

  const targetDirectory = joinLocalPath(normalizedWorkspacePath, PASTED_MEDIA_DIRECTORY);
  await window.api.file.mkdir(targetDirectory);

  const persistedEntries = await Promise.all(
    pendingLocalAttachments.map(async (item) => {
      const file = item?.file;
      const originalName = String(item?.name || '').trim();
      const name = buildPendingAttachmentFileName(item);
      const uid = String(item?.uid || '').trim();
      if (!uid || !name || !file || typeof file.arrayBuffer !== 'function') {
        return null;
      }

      const targetPath = joinLocalPath(targetDirectory, name);
      const buffer = new Uint8Array(await file.arrayBuffer());
      await window.api.file.write(targetPath, buffer);
      return {
        uid,
        originalName,
        name,
        sourcePath: targetPath,
        fileUrl: createLocalFilePreviewUrl(targetPath),
      };
    })
  );

  const persistedByUid = new Map(
    persistedEntries
      .filter(Boolean)
      .map((item) => [item.uid, item])
  );

  return {
    imageAttachmentPreviews: imageAttachmentPreviews.map((item) => {
      const persisted = persistedByUid.get(String(item?.uid || '').trim());
      if (!persisted) return item;
      return {
        ...item,
        name: persisted.name,
        sourcePath: persisted.sourcePath,
        sourceType: 'local',
      };
    }),
    replaceContentPlaceholders(content = '') {
      let nextContent = String(content || '');
      persistedEntries.filter(Boolean).forEach((item) => {
        const placeholder = `#${item.originalName || item.name}`;
        const markdownLink = buildMarkdownFileLink(item.name, item.fileUrl);
        nextContent = replaceFirstOccurrence(nextContent, placeholder, markdownLink);
      });
      return nextContent;
    }
  };
};
const resolveQuickSkillDirectory = (appInfo, skillName = '') => {
  const resourcesPath = normalizeLocalPath(appInfo?.resourcesPath || '').trim();
  const normalizedSkillName = String(skillName || '').trim();
  if (!resourcesPath || !normalizedSkillName) return '';
  return joinLocalPath(resourcesPath, 'quick', 'skills', normalizedSkillName);
};
const resolveProviderIdByModel = (modelId = '') => {
  const lower = String(modelId || '').toLowerCase();
  if (lower.startsWith('claude-')) return { id: 'anthropic', type: 'anthropic', name: 'Anthropic' };
  if (lower.startsWith('qwen-') || lower.startsWith('qvq-') || lower.startsWith('qwq-')) return { id: 'bailian', type: 'openai', name: 'Aliyun Bailian' };
  if (lower.startsWith('gemini-')) return { id: 'gemini', type: 'openai', name: 'Google Gemini' };
  return { id: 'openai', type: 'openai', name: 'OpenAI' };
};

const buildProvidersState = (modelIds = [], apiKey = '') => {
  const providersMap = new Map();
  const normalizedApiKey = String(apiKey || '').trim();
  modelIds.forEach((rawModelId) => {
    const modelId = String(rawModelId || '').trim();
    if (!modelId) return;
    const p = resolveProviderIdByModel(modelId);
    if (!providersMap.has(p.id)) {
      providersMap.set(p.id, { id: p.id, name: p.name, type: p.type, enabled: true, apiKey: normalizedApiKey, apiHost: '', models: [] });
    }
    const provider = providersMap.get(p.id);
    provider.models.push({ id: modelId, name: modelId, provider: p.id });
  });
  return { llm: { providers: Array.from(providersMap.values()) } };
};

const toModelOption = (model_id, name, icon = '', readImage = false, pricing = undefined, priceText = '', description = '', badges = []) => ({
  value: model_id,
  label: name,
  icon,
  read_image: Boolean(readImage),
  pricing: pricing && typeof pricing === 'object' ? { ...pricing } : undefined,
  price_text: String(priceText || '').trim(),
  description: String(description || '').trim(),
  badges: Array.isArray(badges) ? badges.map((badge) => String(badge || '').trim()).filter(Boolean) : [],
});

const isModelInOptions = (model, options = []) => {
  const target = String(model || '').trim();
  if (!target) return false;
  return options.some((item) => String(item?.value || '').trim() === target);
};

const canonicalizeChatModelId = (modelId = '') => {
  const normalized = String(modelId || '').trim();
  if (!normalized) return '';
  const segments = normalized.split(':').map((item) => String(item || '').trim()).filter(Boolean);
  return segments.length >= 2 ? segments[segments.length - 1] : normalized;
};

const extractChatModelProvider = (modelId = '') => {
  const normalized = String(modelId || '').trim();
  if (!normalized || !normalized.includes(':')) return '';
  return String(normalized.split(':')[0] || '').trim();
};

const buildChatMessageModelMeta = (modelId, options = []) => {
  const rawModelId = String(modelId || '').trim();
  const normalizedModelId = canonicalizeChatModelId(rawModelId);
  if (!normalizedModelId) return undefined;
  const inferredProvider = extractChatModelProvider(rawModelId);
  const matched = (Array.isArray(options) ? options : []).find((item) => (
    [item?.value, item?.id, item?.name]
      .map((value) => canonicalizeChatModelId(value))
      .includes(normalizedModelId)
  ));
  if (!matched) {
    return {
      id: normalizedModelId,
      name: normalizedModelId,
      provider: inferredProvider || 'vectcut',
    };
  }
  return {
    id: normalizedModelId,
    name: String(matched?.label || matched?.name || normalizedModelId).trim() || normalizedModelId,
    provider: String(matched?.provider_id || matched?.provider_type || inferredProvider || 'vectcut').trim() || 'vectcut',
    pricing: matched?.pricing && typeof matched.pricing === 'object' ? { ...matched.pricing } : undefined,
    description: String(matched?.description || '').trim() || undefined,
  };
};

const normalizeMembershipSummary = (payload = {}) => {
  const membershipLevel = String(payload?.membership_level || '').trim().toLowerCase() || 'none';
  return {
    membershipLevel,
    isActive: Boolean(payload?.is_active) && membershipLevel !== 'none',
  };
};

const resolveMessageModelId = (rawModel, fallbackModelId = '') => {
  if (rawModel && typeof rawModel === 'object' && !Array.isArray(rawModel)) {
    return canonicalizeChatModelId(
      rawModel?.id
      || rawModel?.modelId
      || rawModel?.value
      || rawModel?.name
      || fallbackModelId
      || ''
    );
  }
  return canonicalizeChatModelId(rawModel || fallbackModelId || '');
};

const normalizeMessageModelMeta = (rawModel, fallbackModelId = '', options = []) => {
  const resolvedModelId = resolveMessageModelId(rawModel, fallbackModelId);
  if (!resolvedModelId) return undefined;

  const matchedMeta = buildChatMessageModelMeta(resolvedModelId, options);
  const rawObject = rawModel && typeof rawModel === 'object' && !Array.isArray(rawModel)
    ? rawModel
    : null;
  if (!rawObject) {
    return matchedMeta;
  }

  return {
    id: resolvedModelId,
    name: String(rawObject?.name || matchedMeta?.name || resolvedModelId).trim() || resolvedModelId,
    provider: String(
      rawObject?.provider
      || rawObject?.provider_id
      || rawObject?.provider_type
      || extractChatModelProvider(rawObject?.id || rawObject?.modelId || rawObject?.value || rawObject?.name || '')
      || matchedMeta?.provider
      || 'vectcut'
    ).trim() || 'vectcut',
    pricing: rawObject?.pricing && typeof rawObject.pricing === 'object'
      ? { ...rawObject.pricing }
      : (matchedMeta?.pricing && typeof matchedMeta.pricing === 'object' ? { ...matchedMeta.pricing } : undefined),
    description: String(rawObject?.description || matchedMeta?.description || '').trim() || undefined,
  };
};

const buildComparableModelMeta = (rawModel) => {
  if (!rawModel || typeof rawModel !== 'object' || Array.isArray(rawModel)) {
    return String(rawModel || '').trim();
  }
  return JSON.stringify({
    id: String(rawModel?.id || '').trim(),
    name: String(rawModel?.name || '').trim(),
    provider: String(rawModel?.provider || rawModel?.provider_id || rawModel?.provider_type || '').trim(),
    pricing: rawModel?.pricing && typeof rawModel.pricing === 'object' ? rawModel.pricing : undefined,
    description: String(rawModel?.description || '').trim()
  });
};

const tryParseJson = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readBrowserToolUrl = (value) => {
  if (!value) return '';
  if (typeof value === 'string') {
    const normalized = String(value || '').trim();
    if (/^https?:\/\//i.test(normalized)) return normalized;
    return readBrowserToolUrl(tryParseJson(normalized));
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = readBrowserToolUrl(item);
      if (hit) return hit;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  const directCandidates = [
    value?.url,
    value?.currentUrl,
    value?.href,
    value?.uri,
    value?.link,
    value?.resource?.uri
  ];
  for (const candidate of directCandidates) {
    const normalized = String(candidate || '').trim();
    if (/^https?:\/\//i.test(normalized)) return normalized;
  }

  if (typeof value?.text === 'string') {
    const textHit = readBrowserToolUrl(value.text);
    if (textHit) return textHit;
  }
  if (Array.isArray(value?.content)) {
    const contentHit = readBrowserToolUrl(value.content);
    if (contentHit) return contentHit;
  }

  return '';
};

const readBrowserToolTitle = (value, fallbackUrl = '') => {
  if (!value) return fallbackUrl;
  if (typeof value === 'string') {
    const normalized = String(value || '').trim();
    if (!normalized) return fallbackUrl;
    if (!/^https?:\/\//i.test(normalized)) {
      const parsed = tryParseJson(normalized);
      if (parsed) return readBrowserToolTitle(parsed, fallbackUrl);
      return normalized;
    }
    return fallbackUrl || normalized;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = readBrowserToolTitle(item, fallbackUrl);
      if (hit && hit !== fallbackUrl) return hit;
    }
    return fallbackUrl;
  }
  if (typeof value !== 'object') return fallbackUrl;

  const directCandidates = [value?.title, value?.pageTitle, value?.name];
  for (const candidate of directCandidates) {
    const normalized = String(candidate || '').trim();
    if (normalized) return normalized;
  }
  if (typeof value?.text === 'string') {
    const textHit = readBrowserToolTitle(value.text, fallbackUrl);
    if (textHit && textHit !== fallbackUrl) return textHit;
  }
  if (Array.isArray(value?.content)) {
    const contentHit = readBrowserToolTitle(value.content, fallbackUrl);
    if (contentHit && contentHit !== fallbackUrl) return contentHit;
  }

  return fallbackUrl;
};

const isBrowserOpenToolBlock = (block = {}) => {
  const rawToolResponse = block?.metadata?.rawMcpToolResponse || {};
  const serverName = String(rawToolResponse?.tool?.serverName || '').trim().toLowerCase();
  const toolName = String(rawToolResponse?.tool?.name || block?.toolName || '').trim().toLowerCase();
  return (
    (serverName.includes('browser') && toolName === 'open')
    || toolName === 'browser:open'
    || toolName === 'mcp__browser__open'
    || toolName === 'browser__open'
  );
};

const buildChatBrowserPreviewFromSession = (session) => {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (String(message?.role || '').toLowerCase() !== 'assistant') continue;
    const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (!isBrowserOpenToolBlock(block)) continue;
      const rawToolResponse = block?.metadata?.rawMcpToolResponse || {};
      const url = readBrowserToolUrl(rawToolResponse?.response) || readBrowserToolUrl(rawToolResponse?.arguments);
      if (!url) continue;
      const title =
        readBrowserToolTitle(rawToolResponse?.response, '')
        || readBrowserToolTitle(rawToolResponse?.arguments, '')
        || url;
      const toolCallId = String(rawToolResponse?.id || block?.id || '').trim() || url;
      const previewIdentity = String(rawToolResponse?.id || '').trim() || toolCallId;
      return {
        key: `${String(session?.id || 'chat').trim()}:${previewIdentity}`,
        url,
        title
      };
    }
  }
  return null;
};

const buildChatBrowserPreviewFromBlocks = (blocks, scopeKey = 'chat') => {
  const normalizedBlocks = Array.isArray(blocks) ? blocks : [];
  for (let blockIndex = normalizedBlocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
    const block = normalizedBlocks[blockIndex];
    if (!isBrowserOpenToolBlock(block)) continue;
    const rawToolResponse = block?.metadata?.rawMcpToolResponse || {};
    const url = readBrowserToolUrl(rawToolResponse?.response) || readBrowserToolUrl(rawToolResponse?.arguments);
    if (!url) continue;
    const title =
      readBrowserToolTitle(rawToolResponse?.response, '')
      || readBrowserToolTitle(rawToolResponse?.arguments, '')
      || url;
    const toolCallId = String(rawToolResponse?.id || block?.id || '').trim() || url;
    const previewIdentity = String(rawToolResponse?.id || '').trim() || toolCallId;
    return {
      key: `${String(scopeKey || 'chat').trim()}:${previewIdentity}`,
      url,
      title
    };
  }
  return null;
};

const createChatId = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createMessageId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createRequestId = () =>
  (typeof globalThis?.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

const formatCreditsCount = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '--';
  if (numericValue >= 1000000) return `${(numericValue / 1000000).toFixed(2)}m`;
  if (numericValue >= 1000) return `${(numericValue / 1000).toFixed(2)}k`;
  if (Number.isInteger(numericValue)) return String(numericValue);
  return numericValue.toFixed(2).replace(/\.?0+$/, '');
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getPerfTimestamp = () =>
  (typeof globalThis?.performance?.now === 'function' ? globalThis.performance.now() : Date.now());

const syncLegacyUserMessageToRendererStore = ({
  topicId,
  assistantId,
  userMessage,
  images,
}) => {
  const state = appStore.getState();
  if (state?.messages?.entities?.[userMessage.id]) {
    return;
  }

  const textBlock = createMainTextBlock(userMessage.id, String(userMessage.content || ''), {
    status: MessageBlockStatus.SUCCESS,
  });
  const imageBlocks = (Array.isArray(images) ? images : []).map((image) =>
    createImageBlock(
      userMessage.id,
      {
        url: `data:${image.media_type};base64,${image.data}`,
      },
      {
        status: MessageBlockStatus.SUCCESS,
      }
    )
  );
  const blocks = [textBlock, ...imageBlocks];
  const rendererMessage = createMessage('user', topicId, assistantId, {
    id: userMessage.id,
    blocks: blocks.map((block) => block.id),
  });

  appStore.dispatch(newMessagesActions.addMessage({ topicId, message: rendererMessage }));
  appStore.dispatch(upsertManyBlocks(blocks));
};

const summarizeBlocksForPerf = (blocks) => {
  const list = Array.isArray(blocks) ? blocks : [];
  const summary = {
    blockCount: list.length,
    textBlocks: 0,
    reasoningBlocks: 0,
    toolBlocks: 0,
    otherBlocks: 0
  };

  list.forEach((block) => {
    const type = String(block?.type || '');
    if (type.startsWith('tool-')) {
      summary.toolBlocks += 1;
      return;
    }
    if (type === 'reasoning') {
      summary.reasoningBlocks += 1;
      return;
    }
    if (type === 'text') {
      summary.textBlocks += 1;
      return;
    }
    summary.otherBlocks += 1;
  });

  return summary;
};

const summarizeSnapshotForPerf = (snapshot) => {
  const content = String(snapshot?.content || '');
  return {
    contentLength: content.length,
    ...summarizeBlocksForPerf(snapshot?.blocks)
  };
};

const parseJwtPayload = (token) => {
  try {
    const base64Url = String(token || '').split('.')[1];
    if (!base64Url) return {};
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const normalized = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = decodeURIComponent(
      atob(normalized)
        .split('')
        .map((ch) => `%${(`00${ch.charCodeAt(0).toString(16)}`).slice(-2)}`)
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
};

const getAgentApiKeyFromLoginState = async () => {
  try {
    // 与 http/client.js 一致：优先确保拿到当前有效 access token。
    const accessToken = await tokenStore.ensureValidAccessToken();
    if (typeof accessToken === 'string' && accessToken.trim()) {
      return accessToken.trim();
    }
  } catch (error) {
    logger.warn('Failed to resolve access token for agent runtime.', error);
  }
  const user = electronStore.get('user') || {};
  const claims = parseJwtPayload(tokenStore?.idToken || '');
  const namespaced = claims['https://open.vectcut.com/claims'] || claims['https://vectcut.com/claims'] || {};
  const appMetadata = claims.app_metadata || {};
  const userMetadata = claims.user_metadata || {};
  const candidates = [
    electronStore.get('auth.vectcut_api_key'),
    user.agentApiKey,
    user.vectcutApiKey,
    user.apiKey,
    claims.vectcut_api_key,
    claims.vectcutApiKey,
    claims.agent_api_key,
    claims.agentApiKey,
    claims.api_key,
    claims.apiKey,
    namespaced.vectcut_api_key,
    namespaced.agent_api_key,
    namespaced.api_key,
    appMetadata.vectcut_api_key,
    appMetadata.agent_api_key,
    appMetadata.api_key,
    userMetadata.vectcut_api_key,
    userMetadata.agent_api_key,
    userMetadata.api_key
  ];
  const hit = candidates.find((item) => typeof item === 'string' && item.trim());
  return hit ? hit.trim() : '';
};

const createEmptyChatSession = (options = {}) => {
  const now = Date.now();
  const workspacePath = normalizeLocalPath(options?.workspacePath || '').trim();
  const configuration = workspacePath
    ? {
      ...(options?.configuration && typeof options.configuration === 'object' ? options.configuration : {}),
      selected_workspace_path: workspacePath
    }
    : options?.configuration;
  return {
    id: createChatId(),
    title: DEFAULT_CHAT_TITLE,
    titleAutoGenerated: false,
    createdAt: now,
    updatedAt: now,
    runtimeSessionId: '',
    accessible_paths: workspacePath ? [workspacePath] : [],
    configuration,
    historyLoaded: true,
    messages: [],
  };
};

const buildImmediateChatTitleFromUserMessage = (value = '') =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const shouldRestoreBeginnerGuideInFreshChat = () => (
  !isBeginnerGuideCompleted() || isBeginnerGuideReopenPending()
);

const isFreshBeginnerGuideChatSession = (session) => {
  const messageCount = Array.isArray(session?.messages) ? session.messages.length : 0;
  const runtimeSessionId = String(session?.runtimeSessionId || '').trim();
  return messageCount === 0 && !runtimeSessionId;
};

const sortChatSessions = (sessions) => {
  return [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};

const STREAMING_LIKE_BLOCK_STATUSES = ['pending', 'processing', 'streaming', 'running', 'invoking'];
const TERMINAL_TOOL_RUNTIME_STATUSES = ['done', 'error', 'cancelled'];
const INTERRUPTED_BLOCK_STATUSES = ['cancelled', 'aborted', 'interrupted'];

const isStreamingLikeBlockStatus = (value) => (
  STREAMING_LIKE_BLOCK_STATUSES.includes(String(value || '').toLowerCase())
);

const isTerminalToolRuntimeStatus = (value) => (
  TERMINAL_TOOL_RUNTIME_STATUSES.includes(String(value || '').toLowerCase())
);

const isInterruptedBlockStatus = (value) => (
  INTERRUPTED_BLOCK_STATUSES.includes(String(value || '').toLowerCase())
);

const isStructuredBlockObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasStructuredBlocks = (blocks = []) => (
  Array.isArray(blocks) && blocks.some((block) => isStructuredBlockObject(block))
);

const buildAssistantDisplayContentFromBlocks = (blocks = []) => {
  const pieces = [];
  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    const type = String(block?.type || '').toLowerCase();
    const content = String(block?.content || '').trim();
    const compactedContent = String(block?.compactedContent || '').trim();
    if (!content && !compactedContent && type !== 'tool') return;
    if (type === 'thinking') {
      pieces.push(`<think>\n${content}\n</think>`);
      return;
    }
    if (type === 'main_text' || type === 'code') {
      pieces.push(content);
      return;
    }
    if (type === 'compact') {
      const compactSections = [];
      if (content) {
        compactSections.push(`## Conversation Compacted\n\n${content}`);
      }
      if (compactedContent) {
        compactSections.push(`### Compacted Content\n\n${compactedContent}`);
      }
      if (compactSections.length > 0) {
        pieces.push(compactSections.join('\n\n'));
      }
      return;
    }
    if (type === 'tool') {
      const raw = block?.metadata?.rawMcpToolResponse || {};
      const payload = {
        name: String(raw?.tool?.name || block?.toolName || 'tool'),
        args: (() => {
          try { return typeof raw?.arguments === 'string' ? raw.arguments : JSON.stringify(raw?.arguments ?? '', null, 2); } catch { return ''; }
        })(),
        result: (() => {
          try { return typeof raw?.response === 'string' ? raw.response : JSON.stringify(raw?.response ?? '', null, 2); } catch { return ''; }
        })(),
        status: String(raw?.status || block?.status || 'done')
      };
      pieces.push(`\`\`\`tool\n${JSON.stringify(payload, null, 2)}\n\`\`\``);
    }
  });
  return pieces.join('\n\n').trim();
};

const getAssistantSnapshotFromStore = (assistantMessageId) => {
  const state = appStore.getState();
  const message = state?.messages?.entities?.[assistantMessageId];
  if (!message) return null;
  const blockIds = Array.isArray(message?.blocks) ? message.blocks : [];
  const blocks = blockIds
    .map((id) => state?.messageBlocks?.entities?.[id])
    .filter(Boolean)
    .map((block) => ({
      ...block,
      type: String(block?.type || ''),
      status: String(block?.status || '')
    }));
  return {
    blocks,
    content: buildAssistantDisplayContentFromBlocks(blocks),
    usage: message?.usage ? { ...message.usage } : undefined,
    metrics: message?.metrics ? { ...message.metrics } : undefined,
    model: message?.model || undefined
  };
};

const finalizeStructuredBlocks = (blocks = [], { aborted = false } = {}) => {
  const nextBlockStatus = aborted ? 'cancelled' : 'error';
  return (Array.isArray(blocks) ? blocks : []).map((block) => {
    if (!block || typeof block !== 'object') return block;

    const nextBlock = { ...block };
    const status = String(nextBlock?.status || '').toLowerCase();
    const isStreamingLike = ['pending', 'processing', 'streaming', 'running', 'invoking'].includes(status);
    if (isStreamingLike) {
      nextBlock.status = nextBlockStatus;
    }

    const rawToolResponse = nextBlock?.metadata?.rawMcpToolResponse;
    const rawToolStatus = String(rawToolResponse?.status || '').toLowerCase();
    if (
      rawToolResponse
      && rawToolStatus
      && !['done', 'error', 'cancelled'].includes(rawToolStatus)
    ) {
      nextBlock.metadata = {
        ...nextBlock.metadata,
        rawMcpToolResponse: {
          ...rawToolResponse,
          status: aborted ? 'cancelled' : 'error'
        }
      };
    }

    return nextBlock;
  });
};

const sanitizePersistedToolResponse = (rawToolResponse = {}) => {
  if (!rawToolResponse || typeof rawToolResponse !== 'object') return rawToolResponse;
  const toolName = String(rawToolResponse?.tool?.name || 'tool');
  const rawResponse = rawToolResponse.responseRaw ?? rawToolResponse.response;
  const inlineResponse = limitInlineToolPayload(rawResponse, { label: `${toolName} 回包` });
  return {
    ...rawToolResponse,
    arguments: sanitizeInlinePayload(rawToolResponse.arguments, { label: `${toolName} 输入` }),
    partialArguments: undefined,
    response: inlineResponse,
    responseRaw: rawResponse,
    truncated: rawResponse !== undefined && rawResponse !== null && rawResponse !== inlineResponse
  };
};

const normalizeStructuredBlocksForPersistence = (blocks = [], { hasError = false, aborted = false } = {}) => {
  const nextBlockStatus = aborted ? 'cancelled' : (hasError ? 'error' : 'success');
  return (Array.isArray(blocks) ? blocks : []).reduce((acc, block) => {
    if (!block || typeof block !== 'object') return acc;

    const nextBlock = { ...block };
    const type = String(nextBlock?.type || '').toLowerCase();
    const content = String(nextBlock?.content || '').trim();
    const rawToolResponse = nextBlock?.metadata?.rawMcpToolResponse;

    if (
      type === 'unknown'
      && !content
      && !rawToolResponse
      && isStreamingLikeBlockStatus(nextBlock?.status)
    ) {
      return acc;
    }

    if (isStreamingLikeBlockStatus(nextBlock?.status)) {
      nextBlock.status = nextBlockStatus;
    }

    const rawToolStatus = String(rawToolResponse?.status || '').toLowerCase();
    if (rawToolResponse && rawToolStatus && !isTerminalToolRuntimeStatus(rawToolStatus)) {
      nextBlock.metadata = {
        ...nextBlock.metadata,
        rawMcpToolResponse: {
          ...sanitizePersistedToolResponse(rawToolResponse),
            status: aborted ? 'cancelled' : (hasError ? 'error' : 'done')
        }
      };
    } else if (rawToolResponse) {
      nextBlock.metadata = {
        ...nextBlock.metadata,
        rawMcpToolResponse: sanitizePersistedToolResponse(rawToolResponse)
      };
    }

    if (typeof nextBlock.content === 'string') {
      nextBlock.content = limitInlineText(nextBlock.content, { label: '消息块内容' });
    } else if (nextBlock.content) {
      nextBlock.content = sanitizeInlinePayload(nextBlock.content, { label: '消息块内容' });
    }

    acc.push(nextBlock);
    return acc;
  }, []);
};

const hasInterruptedAssistantState = (message = {}) => {
  if (String(message?.role || '').toLowerCase() !== 'assistant') return false;
  if (Boolean(message?.aborted)) return true;
  if (String(message?.error?.category || '').toLowerCase() === 'aborted') return true;
  const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
  return blocks.some((block) => {
    if (!isStructuredBlockObject(block)) return false;
    if (isInterruptedBlockStatus(block?.status)) return true;
    return isInterruptedBlockStatus(block?.metadata?.rawMcpToolResponse?.status);
  });
};

const normalizePersistedChatMessage = (message = {}, modelOptions = []) => {
  if (!message || typeof message !== 'object') return message;

  let nextMessage = message;
  const ensureCloned = () => {
    if (nextMessage === message) {
      nextMessage = { ...message };
    }
    return nextMessage;
  };

  const normalizedDirectContent = limitInlineText(nextMessage.content || '', { label: '会话消息内容' });
  if (normalizedDirectContent !== String(nextMessage.content || '')) {
    ensureCloned().content = normalizedDirectContent;
  }

  if (String(nextMessage?.role || '').toLowerCase() !== 'assistant') {
    return nextMessage;
  }

  if (nextMessage.storeAssistantMessageId !== null) {
    ensureCloned().storeAssistantMessageId = null;
  }
  if (Array.isArray(nextMessage.blocks)) {
    const structuredBlocks = nextMessage.blocks.filter((block) => isStructuredBlockObject(block));
    if (structuredBlocks.length === nextMessage.blocks.length) {
        const aborted = hasInterruptedAssistantState(nextMessage);
      const normalizedBlocks = normalizeStructuredBlocksForPersistence(structuredBlocks, {
          hasError: Boolean(nextMessage.error),
          aborted
      });
      if (JSON.stringify(normalizedBlocks) !== JSON.stringify(nextMessage.blocks)) {
        ensureCloned().blocks = normalizedBlocks;
      }
        if (aborted && nextMessage.aborted !== true) {
          ensureCloned().aborted = true;
        }
    }
  }

  if (!String(nextMessage.content || '').trim() && hasStructuredBlocks(nextMessage.blocks)) {
    const nextContent = buildAssistantDisplayContentFromBlocks(nextMessage.blocks);
    if (nextContent !== nextMessage.content) {
      ensureCloned().content = limitInlineText(nextContent, { label: '会话消息内容' });
    }
  }

  const normalizedModel = normalizeMessageModelMeta(nextMessage.model, nextMessage.modelId, modelOptions);
  const normalizedModelId = String(
    normalizedModel?.id || resolveMessageModelId(nextMessage.model, nextMessage.modelId)
  ).trim();
  if (
    buildComparableModelMeta(nextMessage.model) !== buildComparableModelMeta(normalizedModel)
    || String(nextMessage.modelId || '').trim() !== normalizedModelId
  ) {
    const target = ensureCloned();
    target.model = normalizedModel;
    target.modelId = normalizedModelId || undefined;
  }

  return nextMessage;
};

const shouldHydrateChatSessionFromHistory = (session) => {
  if (!session) return false;
  const runtimeSessionId = String(session?.runtimeSessionId || '').trim();
  if (!runtimeSessionId) return false;
  return session.historyLoaded !== true;
};

const shouldPersistChatSessionMessages = (session) => {
  if (!session || !Array.isArray(session.messages)) return false;
  const runtimeSessionId = String(session?.runtimeSessionId || '').trim();
  return !runtimeSessionId;
};

const serializeChatSessionsForPersistence = (sessions = [], modelOptions = []) => (
  (Array.isArray(sessions) ? sessions : []).map((session) => ({
    ...session,
    runtimeSessionId: String(session?.runtimeSessionId || '').trim(),
    historyLoaded: String(session?.runtimeSessionId || '').trim() ? false : session?.historyLoaded !== false,
    messages: shouldPersistChatSessionMessages(session)
      ? (Array.isArray(session?.messages)
          ? session.messages.map((message) => normalizePersistedChatMessage(message, modelOptions))
          : [])
      : []
  }))
);

const countVisibleAssistantMessages = (messages = []) => (
  (Array.isArray(messages) ? messages : []).reduce((count, message) => {
    if (String(message?.role || '').toLowerCase() !== 'assistant') return count;
    return buildVisibleAssistantContent(message) ? count + 1 : count;
  }, 0)
);

const countMissingVisibleAssistantMessages = (messages = []) => (
  (Array.isArray(messages) ? messages : []).reduce((count, message) => {
    if (String(message?.role || '').toLowerCase() !== 'assistant') return count;
    return buildVisibleAssistantContent(message) ? count : count + 1;
  }, 0)
);

const countStructuredAssistantBlocks = (messages = []) => (
  (Array.isArray(messages) ? messages : []).reduce((count, message) => {
    if (String(message?.role || '').toLowerCase() !== 'assistant') return count;
    const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
    return count + blocks.filter((block) => isStructuredBlockObject(block)).length;
  }, 0)
);

const countAssistantUsageSteps = (messages = []) => (
  (Array.isArray(messages) ? messages : []).reduce((count, message) => {
    if (String(message?.role || '').toLowerCase() !== 'assistant') return count;
    const usageSteps = Array.isArray(message?.usageSteps) ? message.usageSteps : [];
    return count + usageSteps.length;
  }, 0)
);

const countAssistantUsageMessages = (messages = []) => (
  (Array.isArray(messages) ? messages : []).reduce((count, message) => {
    if (String(message?.role || '').toLowerCase() !== 'assistant') return count;
    const hasUsage = Boolean(message?.usage);
    const hasUsageSteps = Array.isArray(message?.usageSteps) && message.usageSteps.length > 0;
    const hasCompletionMetrics = Number(message?.metrics?.completion_tokens || 0) > 0;
    return hasUsage || hasUsageSteps || hasCompletionMetrics ? count + 1 : count;
  }, 0)
);

const countAssistantPricedUsageMessages = (messages = []) => (
  (Array.isArray(messages) ? messages : []).reduce((count, message) => {
    if (String(message?.role || '').toLowerCase() !== 'assistant') return count;
    return message?.usage && message?.model?.pricing ? count + 1 : count;
  }, 0)
);

const HYDRATED_IMAGE_TOOL_NAMES = new Set([
  'generate_or_edit_image',
  'mcp__image__generate_or_edit_image',
  'generate_image',
  'mcp__image__generate_image'
]);

const inferPersistedImageAttachmentFileType = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'image/png';

  const dataUrlMatch = normalized.match(/^data:(image\/[^;,]+)[;,]/i);
  if (dataUrlMatch?.[1]) {
    return dataUrlMatch[1];
  }

  if (normalized.includes('.jpg') || normalized.includes('.jpeg')) return 'image/jpeg';
  if (normalized.includes('.webp')) return 'image/webp';
  if (normalized.includes('.gif')) return 'image/gif';
  if (normalized.includes('.bmp')) return 'image/bmp';
  if (normalized.includes('.svg')) return 'image/svg+xml';
  if (normalized.includes('.avif')) return 'image/avif';
  return 'image/png';
};

const normalizePersistedImageAttachments = (attachments = []) => (
  (Array.isArray(attachments) ? attachments : []).reduce((acc, attachment, index) => {
    if (!attachment || typeof attachment !== 'object') return acc;
    const previewUrl = String(
      attachment?.previewUrl
      || attachment?.thumbnailUrl
      || attachment?.url
      || ''
    ).trim();
    if (!previewUrl) return acc;
    const fileType = String(attachment?.fileType || '').trim() || inferPersistedImageAttachmentFileType(previewUrl);
    acc.push({
      ...attachment,
      uid: String(attachment?.uid || `persisted-image-${index}`),
      name: String(attachment?.name || `图片 ${index + 1}`),
      fileType,
      url: String(attachment?.url || previewUrl).trim(),
      previewUrl,
      thumbnailUrl: String(attachment?.thumbnailUrl || previewUrl).trim(),
    });
    return acc;
  }, [])
);

const buildPersistedUserImageAttachmentsFromBlocks = (blocks = []) => (
  (Array.isArray(blocks) ? blocks : []).reduce((acc, block, index) => {
    if (!isStructuredBlockObject(block)) return acc;
    if (String(block?.type || '').toLowerCase() !== 'image') return acc;
    const previewUrl = String(block?.url || '').trim();
    if (!previewUrl) return acc;
    acc.push({
      uid: String(block?.id || `persisted-image-block-${index}`),
      name: `图片 ${acc.length + 1}`,
      fileType: inferPersistedImageAttachmentFileType(previewUrl),
      url: previewUrl,
      previewUrl,
      thumbnailUrl: previewUrl,
    });
    return acc;
  }, [])
);

const getPersistedUserImagePreviewSources = (message = {}) => (
  (Array.isArray(message?.imageAttachments) ? message.imageAttachments : []).reduce((acc, attachment) => {
    const previewUrl = String(
      attachment?.previewUrl
      || attachment?.thumbnailUrl
      || attachment?.url
      || ''
    ).trim();
    if (!previewUrl) return acc;
    acc.push(previewUrl);
    return acc;
  }, [])
);

const enhancePersistedImageGenerationArguments = (toolName, args, userPreviewSources = []) => {
  if (!HYDRATED_IMAGE_TOOL_NAMES.has(String(toolName || ''))) {
    return args;
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return args;
  }

  const referenceImages = [
    args.referenceImages,
    args.reference_images,
    args.sourceImages,
    args.source_images,
    args.referenceImage,
    args.reference_image,
    args.sourceImage,
    args.source_image,
    args.baseImage,
    args.base_image,
    args.editImage,
    args.edit_image
  ].reduce((acc, candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => {
        if (typeof item === 'string' && item.trim()) {
          acc.push(item.trim());
        }
      });
      return acc;
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      acc.push(candidate.trim());
    }
    return acc;
  }, []);
  if (!referenceImages.length || userPreviewSources.length === 0) {
    return args;
  }

  const existingPrepared = Array.isArray(args.reference_images_prepared) ? args.reference_images_prepared : [];
  const referenceImagesPrepared = referenceImages.reduce((acc, item, index) => {
    const originalInput = typeof item === 'string' ? item : String(item ?? '');
    const existingItem = existingPrepared[index];
    const previewUrl = String(
      existingItem?.previewUrl
      || existingItem?.preview_url
      || userPreviewSources[index]
      || ''
    ).trim();
    if (!previewUrl) {
      return acc;
    }
    acc.push({
      originalInput,
      submittedUrl: String(
        existingItem?.submittedUrl
        || existingItem?.submitted_url
        || originalInput
      ).trim() || originalInput,
      previewUrl,
      sourceKind: previewUrl.startsWith('file://') || previewUrl.startsWith('data:') ? 'local_file' : 'remote_url'
    });
    return acc;
  }, []);

  if (referenceImagesPrepared.length === 0) {
    return args;
  }

  return {
    ...args,
    reference_images_prepared: referenceImagesPrepared
  };
};

const enhancePersistedHydratedMessages = (messages = []) => {
  let latestUserImagePreviewSources = [];

  return (Array.isArray(messages) ? messages : []).map((message) => {
    if (!message || typeof message !== 'object') return message;

    if (String(message?.role || '').toLowerCase() === 'user') {
      latestUserImagePreviewSources = getPersistedUserImagePreviewSources(message);
      return message;
    }

    if (!Array.isArray(message?.blocks) || message.blocks.length === 0) {
      return message;
    }

    let changed = false;
    const nextBlocks = message.blocks.map((block) => {
      if (!isStructuredBlockObject(block)) return block;
      const rawToolResponse = block?.metadata?.rawMcpToolResponse;
      const toolName = String(rawToolResponse?.tool?.name || block?.toolName || '').trim();
      if (!HYDRATED_IMAGE_TOOL_NAMES.has(toolName)) {
        return block;
      }

      const nextArguments = enhancePersistedImageGenerationArguments(
        toolName,
        rawToolResponse?.arguments,
        latestUserImagePreviewSources
      );
      if (nextArguments === rawToolResponse?.arguments) {
        return block;
      }

      changed = true;
      return {
        ...block,
        metadata: {
          ...block.metadata,
          rawMcpToolResponse: {
            ...rawToolResponse,
            arguments: nextArguments
          }
        }
      };
    });

    if (!changed) {
      return message;
    }

    return {
      ...message,
      blocks: nextBlocks
    };
  });
};

const hasUnstableAssistantToolBlocks = (messages = []) => {
  const seenToolCallIds = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    if (String(message?.role || '').toLowerCase() !== 'assistant') continue;
    const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
    for (const block of blocks) {
      if (!isStructuredBlockObject(block)) continue;
      const rawToolResponse = block?.metadata?.rawMcpToolResponse;
      const isToolBlock = String(block?.type || '').toLowerCase() === 'tool' || Boolean(rawToolResponse);
      if (!isToolBlock) continue;

      if (isStreamingLikeBlockStatus(block?.status) || isStreamingLikeBlockStatus(rawToolResponse?.status)) {
        return true;
      }

      const toolCallId = String(rawToolResponse?.id || '').trim();
      if (!toolCallId) continue;
      if (seenToolCallIds.has(toolCallId)) {
        return true;
      }
      seenToolCallIds.add(toolCallId);
    }
  }
  return false;
};

const shouldApplyHydratedMessages = ({
  currentMessages = [],
  hydratedMessages = []
}) => {
  const beforeMessageCount = Array.isArray(currentMessages) ? currentMessages.length : 0;
  const beforeVisibleAssistantCount = countVisibleAssistantMessages(currentMessages);
  const beforeMissingAssistantCount = countMissingVisibleAssistantMessages(currentMessages);
  const beforeStructuredAssistantBlockCount = countStructuredAssistantBlocks(currentMessages);
  const beforeAssistantUsageStepCount = countAssistantUsageSteps(currentMessages);
  const beforeAssistantUsageMessageCount = countAssistantUsageMessages(currentMessages);
  const beforePricedUsageMessageCount = countAssistantPricedUsageMessages(currentMessages);
  const beforeHasUnstableToolBlocks = hasUnstableAssistantToolBlocks(currentMessages);
  const beforeHasInterruptedAssistantState = (Array.isArray(currentMessages) ? currentMessages : []).some(hasInterruptedAssistantState);
  const afterVisibleAssistantCount = countVisibleAssistantMessages(hydratedMessages);
  const afterMissingAssistantCount = countMissingVisibleAssistantMessages(hydratedMessages);
  const afterStructuredAssistantBlockCount = countStructuredAssistantBlocks(hydratedMessages);
  const afterAssistantUsageStepCount = countAssistantUsageSteps(hydratedMessages);
  const afterAssistantUsageMessageCount = countAssistantUsageMessages(hydratedMessages);
  const afterPricedUsageMessageCount = countAssistantPricedUsageMessages(hydratedMessages);
  const afterHasInterruptedAssistantState = (Array.isArray(hydratedMessages) ? hydratedMessages : []).some(hasInterruptedAssistantState);

  return (
    beforeMessageCount === 0
    || beforeVisibleAssistantCount === 0
    || afterMissingAssistantCount < beforeMissingAssistantCount
    || afterVisibleAssistantCount > beforeVisibleAssistantCount
    || afterStructuredAssistantBlockCount > beforeStructuredAssistantBlockCount
    || afterAssistantUsageStepCount > beforeAssistantUsageStepCount
    || afterAssistantUsageMessageCount > beforeAssistantUsageMessageCount
    || afterPricedUsageMessageCount > beforePricedUsageMessageCount
    || (beforeHasInterruptedAssistantState && !afterHasInterruptedAssistantState)
    || (beforeHasUnstableToolBlocks && afterVisibleAssistantCount > 0)
  );
};

const summarizeHydrateMessageCollection = (messages = []) => {
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  return normalizedMessages.slice(-6).map((message, index) => {
    const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
    const imageBlocks = blocks.filter((block) => String(block?.type || '').toLowerCase() === 'image');
    return {
      index: normalizedMessages.length - Math.min(normalizedMessages.length, 6) + index,
      id: String(message?.id || ''),
      role: String(message?.role || ''),
      contentChars: String(message?.content || '').length,
      blockCount: blocks.length,
      blockTypes: blocks.map((block) => String(block?.type || 'unknown')),
      usageStepsCount: Array.isArray(message?.usageSteps) ? message.usageSteps.length : 0,
      hasUsage: Boolean(message?.usage),
      hasPricing: Boolean(message?.model?.pricing),
      imageBlockCount: imageBlocks.length,
      dataUrlImageBlockCount: imageBlocks.filter((block) => String(block?.url || '').startsWith('data:image/')).length
    };
  });
};

const buildMessageContentFromBlocks = (blocks = []) => {
  const pieces = [];
  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    if (!isStructuredBlockObject(block)) return;
    const type = String(block?.type || '').toLowerCase();
    const content = String(block?.content || '').trim();
    if (!content) return;
    if (type === 'main_text' || type === 'code' || type === 'thinking') {
      pieces.push(content);
    }
  });
  return pieces.join('\n\n').trim();
};

const buildVisibleAssistantContent = (message = {}) => {
  const directContent = String(message?.content || '').trim();
  if (directContent) return directContent;
  const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
  const structuredBlocks = blocks.filter((block) => isStructuredBlockObject(block));
  if (!structuredBlocks.length) return '';
  return buildAssistantDisplayContentFromBlocks(structuredBlocks).trim();
};

const isTimeoutLikeChatError = (error = {}) => {
  if (!error || typeof error !== 'object') return false;
  const normalized = [
    error?.category,
    error?.title,
    error?.message,
    error?.detail,
    error?.code
  ]
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  if (!normalized) return false;

  return (
    normalized.includes('timeout')
    || normalized.includes('timed out')
    || normalized.includes('请求超时')
    || normalized.includes('超时')
    || normalized.includes('first chunk')
  );
};

const hasTimedOutAssistant = (session = {}) => {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  return [...messages].some((message) => (
    String(message?.role || '').toLowerCase() === 'assistant'
    && isTimeoutLikeChatError(message?.error)
  ));
};

const findLatestTimedOutChatSession = (sessions = []) => (
  (Array.isArray(sessions) ? sessions : []).reduce((latest, session) => {
    if (!hasTimedOutAssistant(session)) return latest;
    if (!latest) return session;
    return Number(session?.updatedAt || 0) >= Number(latest?.updatedAt || 0) ? session : latest;
  }, null)
);

const toPersistedHistoryMessage = (persistedEntry, index, modelOptions = []) => {
  const sourceMessage = persistedEntry?.message || {};
  const role = String(sourceMessage?.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user';
  const sourceBlocks = Array.isArray(persistedEntry?.blocks) ? persistedEntry.blocks.filter((block) => isStructuredBlockObject(block)) : [];
  const normalizedBlocks = normalizeStructuredBlocksForPersistence(sourceBlocks, {
    hasError: Boolean(sourceMessage?.error),
    aborted: hasInterruptedAssistantState({
      ...sourceMessage,
      role,
      blocks: sourceBlocks
    })
  });
  const contentFromBlocks = role === 'assistant'
    ? buildAssistantDisplayContentFromBlocks(normalizedBlocks)
    : buildMessageContentFromBlocks(normalizedBlocks);
  const content = String(sourceMessage?.content || '').trim() || contentFromBlocks;
  const createdAt = sourceMessage?.createdAt || Date.now();
  const updatedAt = sourceMessage?.updatedAt || createdAt;
  const modelMeta = role === 'assistant'
    ? normalizeMessageModelMeta(sourceMessage?.model, sourceMessage?.modelId, modelOptions)
    : undefined;
  const modelId = String(
    modelMeta?.id || resolveMessageModelId(sourceMessage?.model, sourceMessage?.modelId)
  ).trim();
  const imageAttachments = role === 'user'
    ? (() => {
        const normalizedAttachments = normalizePersistedImageAttachments(sourceMessage?.imageAttachments);
        if (normalizedAttachments.length > 0) {
          return normalizedAttachments;
        }
        return buildPersistedUserImageAttachmentsFromBlocks(normalizedBlocks);
      })()
    : undefined;

  return {
    id: String(sourceMessage?.id || `persisted-${index}`),
    role,
    content: limitInlineText(content, { label: '历史消息内容' }),
    blocks: normalizedBlocks,
    ...(role === 'user' && imageAttachments.length > 0 ? { imageAttachments } : {}),
    createdAt,
    updatedAt,
    model: modelMeta,
    modelId: modelId || undefined,
    usage: sourceMessage?.usage ? { ...sourceMessage.usage } : undefined,
    usageSteps: Array.isArray(sourceMessage?.usageSteps)
      ? sourceMessage.usageSteps.map((usageStep) => ({ ...usageStep }))
      : undefined,
    metrics: sourceMessage?.metrics ? { ...sourceMessage.metrics } : undefined,
    error: sourceMessage?.error || null,
      aborted: hasInterruptedAssistantState({
        ...sourceMessage,
        role,
        blocks: normalizedBlocks
      }),
    storeAssistantMessageId: null
  };
};

const finalizeLatestTodoWriteInStore = (assistantMessageId) => {
  const state = appStore.getState();
  const message = state?.messages?.entities?.[assistantMessageId];
  const blockIds = Array.isArray(message?.blocks) ? message.blocks : [];
  if (!blockIds.length) return false;

  for (let index = blockIds.length - 1; index >= 0; index -= 1) {
    const block = state?.messageBlocks?.entities?.[blockIds[index]];
    const rawToolResponse = block?.metadata?.rawMcpToolResponse;
    const toolName = String(rawToolResponse?.tool?.name || block?.toolName || '');
    const todos = Array.isArray(rawToolResponse?.arguments?.todos) ? rawToolResponse.arguments.todos : null;
    if (toolName !== 'TodoWrite' || !todos?.length) continue;

    const incompleteTodos = todos.filter((todo) => todo?.status === 'pending' || todo?.status === 'in_progress');
    const updatedTodos = todos.map((todo) => {
      if (todo?.status === 'in_progress') {
        return { ...todo, status: 'completed' };
      }
      return todo;
    });

    let changed = updatedTodos.some((todo, todoIndex) => todo?.status !== todos[todoIndex]?.status);
    if (!changed && incompleteTodos.length === 1) {
      const targetIndex = todos.findIndex((todo) => todo?.status === 'pending' || todo?.status === 'in_progress');
      if (targetIndex >= 0) {
        updatedTodos[targetIndex] = { ...updatedTodos[targetIndex], status: 'completed' };
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    appStore.dispatch(updateOneBlock({
      id: block.id,
      changes: {
        status: 'success',
        metadata: {
          ...block.metadata,
          rawMcpToolResponse: {
            ...rawToolResponse,
            status: 'done',
            arguments: {
              ...(rawToolResponse?.arguments || {}),
              todos: updatedTodos
            }
          }
        }
      }
    }));

    logger.info('[HomePage][TodoWrite] finalized latest todo block on stream complete', {
      assistantMessageId,
      blockId: block.id,
      totalTodos: todos.length,
      remainingBeforeFinalize: incompleteTodos.length
    });
    return true;
  }

  return false;
};

const HomePage = () => {
  const isFullscreen = useFullscreen();
  const [headerUser, setHeaderUser] = useState(() => electronStore.get('user') || {});
  const avatarSrc = headerUser?.avatar || LogoIcon;
  const userName = headerUser?.name || '';
  const [headerMembership, setHeaderMembership] = useState(() => normalizeMembershipSummary());
  const [todayCount, setTodayCount] = useState(null);
  const [creditsBalance, setCreditsBalance] = useState(null);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [selectedPane, setSelectedPane] = useState('chat');
  const isChatPane = selectedPane === 'chat';
  const isSkillPane = selectedPane === 'skill';
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [selectedDrafts, setSelectedDrafts] = useState([]);
  const [draftListRefreshToken, setDraftListRefreshToken] = useState(0);
  const [downloadDualView, setDownloadDualView] = useState('downloading');
  const [downloadProject, setDownloadProject] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState(null);
  // 用“选中项”驱动右侧展示
  const [selectedCompleted, setSelectedCompleted] = useState(null);
  const [selectedCompletedKey, setSelectedCompletedKey] = useState(null);
  const [chatSessions, setChatSessions] = useState(() => [createEmptyChatSession()]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatSending, setChatSending] = useState(false);
  const [chatSessionSendingMap, setChatSessionSendingMap] = useState({});
  const [chatSessionInFlightMap, setChatSessionInFlightMap] = useState({});
  const [chatSessionFulfilledMap, setChatSessionFulfilledMap] = useState({});
  const [chatHistoryLoadingMap, setChatHistoryLoadingMap] = useState({});
  const [chatWorkspaceStatusMap, setChatWorkspaceStatusMap] = useState({});
  const [chatModel, setChatModel] = useState(() => CHAT_MODELS[0]);
  const [chatModelOptions, setChatModelOptions] = useState(() => CHAT_MODELS.map((item) => toModelOption(item)));
  const [chatModelListLoading, setChatModelListLoading] = useState(true);
  const [chatHistoryVisible, setChatHistoryVisible] = useState(false);
  const beginnerGuideDownloadPaneRef = useRef(null);
  const beginnerGuideSettingsPaneRef = useRef(null);
  const [chatHistoryAnimated, setChatHistoryAnimated] = useState(false);
  const [chatDraftInput, setChatDraftInput] = useState('');

  const handleSkillGoChat = useCallback((skill) => {
    const name = String(skill?.name || skill?.folderName || '').trim();
    setSelectedPane('chat');
    setChatDraftInput(name ? `@${name} ` : '');
  }, []);

  const handleOpenSkillStore = useCallback(() => {
    setSelectedPane('skill');
  }, []);

  const handleSkillEdit = useCallback((skill) => {
    const name = String(skill?.name || skill?.folderName || '').trim();
    setSelectedPane('chat');
    setChatDraftInput(name ? `请帮我编辑 @${name} 这个 skill，我想要...` : '请帮我编辑这个 skill，我想要...');
  }, []);

  const handleCreateSkillFromStore = useCallback(() => {
    setSelectedPane('chat');
    setChatDraftInput('请帮我创建一个可以实现「xxx」的 skill');
  }, []);
  const chatHistoryAnimTimerRef = useRef(null);
  const chatSessionsRef = useRef([]);
  const chatTitleGeneratingSessionIdsRef = useRef(new Set());
  const chatAgentSessionIdByChatIdRef = useRef(new Map());
  const chatIdByAgentSessionIdRef = useRef(new Map());
  const chatPendingByRequestIdRef = useRef(new Map());
  const chatPerfByRequestIdRef = useRef(new Map());
  const chatSnapshotThrottleByRequestIdRef = useRef(new Map());
  const chatEnsuringAgentSessionByChatIdRef = useRef(new Map());
  const chatHistoryHydratingRef = useRef(new Set());
  const chatHistoryHydrateSettledRef = useRef(new Set());
  const chatWorkspaceMetaHydratingRef = useRef(new Set());
  const chatWorkspaceHydrationSuppressedRef = useRef(new Set());
  const chatDeferredSessionChangeHydrateRef = useRef(new Map());
  const chatPersistTimerRef = useRef(null);
  const creditsBalanceMountedRef = useRef(true);
  const [chatTitleRenamingSessionIds, setChatTitleRenamingSessionIds] = useState([]);
  const [chatTitleNewlyRenamedSessionIds, setChatTitleNewlyRenamedSessionIds] = useState([]);
  const [chatWebPreview, setChatWebPreview] = useState(null);
  const [manualChatWebPreview, setManualChatWebPreview] = useState(null);
  const [chatWebPreviewDismissedKey, setChatWebPreviewDismissedKey] = useState('');
  const [chatInlinePreviewVisible, setChatInlinePreviewVisible] = useState(false);
  const activeChatWebPreviewKeyRef = useRef('');
  const chatExpandedWindowBaseWidthRef = useRef(null);
  const refreshHeaderMembership = useCallback(async () => {
    try {
      const payload = await getMembershipSummary();
      const normalized = normalizeMembershipSummary(payload);
      setHeaderMembership(normalized);
      return normalized;
    } catch (error) {
      logger.warn('Failed to load membership summary for header.', error);
      const fallback = normalizeMembershipSummary();
      setHeaderMembership(fallback);
      return fallback;
    }
  }, []);

  useEffect(() => {
    if (typeof electronStore.onDidChange !== 'function') {
      return undefined;
    }

    const dispose = electronStore.onDidChange('user', () => {
      setHeaderUser(electronStore.get('user') || {});
      void refreshHeaderMembership();
    });

    return () => {
      if (typeof dispose === 'function') {
        dispose();
      }
    };
  }, [refreshHeaderMembership]);
  const chatTitleRevealTimersRef = useRef(new Map());
  const creditsBalanceRef = useRef(null);
  const chatModelOptionsRef = useRef(chatModelOptions);
  const chatModelMetaRef = useRef(undefined);
  const canUseAgentRuntime = Boolean(
    window?.electronAPI?.cherryChatStream
    && typeof window.electronAPI.cherryChatStream.createSession === 'function'
  );

  const hydratePersistedChatSessionFromHistory = useCallback(async ({
    chatId,
    sessionId,
    reason = 'session-changed'
  }) => {
    const normalizedChatId = String(chatId || '').trim();
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedChatId || !normalizedSessionId) return;
    if (!window?.ipc?.invoke && !window?.electron?.ipcRenderer?.invoke) {
      logger.warn('[HomePage][HistoryHydrate] bridge unavailable for persisted sync', {
        chatId: normalizedChatId,
        sessionId: normalizedSessionId,
        reason
      });
      return;
    }

    const hydrateKey = `${normalizedChatId}:${normalizedSessionId}`;
    if (chatHistoryHydratingRef.current.has(hydrateKey)) return;

    chatHistoryHydrateSettledRef.current.delete(hydrateKey);
    chatHistoryHydratingRef.current.add(hydrateKey);
    setChatHistoryLoadingMap((prev) => (
      prev[normalizedChatId] ? prev : { ...prev, [normalizedChatId]: true }
    ));
    try {
      const currentSessionAtHydrateStart = chatSessionsRef.current.find((item) => item.id === normalizedChatId);
      const beforeMessageIds = new Set(
        (Array.isArray(currentSessionAtHydrateStart?.messages) ? currentSessionAtHydrateStart.messages : [])
          .map((message) => String(message?.id || '').trim())
          .filter(Boolean)
      );
      const invoke = window?.ipc?.invoke
        ? (channel, payload) => window.ipc.invoke(channel, payload)
        : (channel, payload) => window.electron.ipcRenderer.invoke(channel, payload);
      const historicalMessages = await invoke(IpcChannel.AgentMessage_GetHistory, {
        sessionId: normalizedSessionId
      });
      if (!Array.isArray(historicalMessages) || historicalMessages.length === 0) {
        setChatSessions((prev) => prev.map((item) => (
          item.id === normalizedChatId ? { ...item, historyLoaded: true } : item
        )));
        chatHistoryHydrateSettledRef.current.add(hydrateKey);
        logger.warn('[HomePage][HistoryHydrate] skipped empty persisted sync', {
          chatId: normalizedChatId,
          sessionId: normalizedSessionId,
          reason
        });
        return;
      }

      const hydratedMessages = enhancePersistedHydratedMessages(historicalMessages
        .map((entry, index) => toPersistedHistoryMessage(entry, index, chatModelOptionsRef.current))
        .filter((message) => message?.id));
      const hasAssistantContentOrUsage = hydratedMessages.some((message) => (
        message.role === 'assistant'
        && (
          String(message.content || '').trim()
          || message?.usage
          || (Array.isArray(message?.usageSteps) && message.usageSteps.length > 0)
          || Number(message?.metrics?.completion_tokens || 0) > 0
        )
      ));
      if (!hasAssistantContentOrUsage) {
        logger.warn('[HomePage][HistoryHydrate] skipped persisted sync without assistant content', {
          chatId: normalizedChatId,
          sessionId: normalizedSessionId,
          reason,
          messageCount: hydratedMessages.length
        });
        return;
      }

      const currentSession = chatSessionsRef.current.find((item) => item.id === normalizedChatId);
      const currentMessages = Array.isArray(currentSession?.messages) ? currentSession.messages : [];
      if (!shouldApplyHydratedMessages({ currentMessages, hydratedMessages })) {
        logger.warn('[HomePage][HistoryHydrate] skipped persisted sync without improvement', {
          chatId: normalizedChatId,
          sessionId: normalizedSessionId,
          reason,
          currentMessageCount: currentMessages.length,
          hydratedMessageCount: hydratedMessages.length,
          currentStructuredAssistantBlockCount: countStructuredAssistantBlocks(currentMessages),
          hydratedStructuredAssistantBlockCount: countStructuredAssistantBlocks(hydratedMessages),
          currentAssistantUsageStepCount: countAssistantUsageSteps(currentMessages),
          hydratedAssistantUsageStepCount: countAssistantUsageSteps(hydratedMessages),
          currentPricedUsageMessageCount: countAssistantPricedUsageMessages(currentMessages),
          hydratedPricedUsageMessageCount: countAssistantPricedUsageMessages(hydratedMessages)
        });
        logger.warn('[CTXLOSS][HistoryHydrate] persisted-sync-skip', {
          chatId: normalizedChatId,
          sessionId: normalizedSessionId,
          reason,
          currentSummary: summarizeHydrateMessageCollection(currentMessages),
          hydratedSummary: summarizeHydrateMessageCollection(hydratedMessages)
        });
        chatHistoryHydrateSettledRef.current.add(hydrateKey);
        return;
      }

      setChatSessions((prev) => {
        const updated = prev.map((item) => {
          if (item.id !== normalizedChatId) return item;
          const currentMessages = Array.isArray(item.messages) ? item.messages : [];
          const hydratedMessageIds = new Set(
            hydratedMessages.map((message) => String(message?.id || '').trim()).filter(Boolean)
          );
          // Preserve optimistic messages created after persisted hydrate started so
          // late session syncs do not wipe a freshly resent user turn.
          const locallyAddedMessages = currentMessages.filter((message) => {
            const messageId = String(message?.id || '').trim();
            if (!messageId) return false;
            if (hydratedMessageIds.has(messageId)) return false;
            return !beforeMessageIds.has(messageId);
          });
          return {
            ...item,
            updatedAt: Date.now(),
            historyLoaded: true,
            messages: [...hydratedMessages, ...locallyAddedMessages]
          };
        });
        return sortChatSessions(updated);
      });
      chatHistoryHydrateSettledRef.current.add(hydrateKey);
      logger.info('[CTXLOSS][HistoryHydrate] persisted-sync-applied', {
        chatId: normalizedChatId,
        sessionId: normalizedSessionId,
        reason,
        beforeMessageIds: Array.from(beforeMessageIds).slice(-8),
        hydratedSummary: summarizeHydrateMessageCollection(hydratedMessages)
      });
    } catch (error) {
      logger.warn('[HomePage][HistoryHydrate] failed persisted sync', {
        chatId: normalizedChatId,
        sessionId: normalizedSessionId,
        reason,
        error: error?.message || String(error)
      });
    } finally {
      chatHistoryHydratingRef.current.delete(hydrateKey);
      setChatHistoryLoadingMap((prev) => {
        if (!(normalizedChatId in prev)) return prev;
        const next = { ...prev };
        delete next[normalizedChatId];
        return next;
      });
    }
  }, []);

  // 暴露一个可复用的计数刷新方法
  const refreshTodayCount = () => {
    return countTodayDrafts()
      .then((res) => {
        const c = typeof res?.count === 'number' ? res.count : 0;
        setTodayCount(c); // 更新界面（第 23-24 行对应逻辑）
      })
      .catch(() => setTodayCount(0));
  };

  const refreshRechargeBalance = useCallback(async ({ withCheckin = false } = {}) => {
    if (creditsBalanceMountedRef.current) {
      setCreditsLoading(true);
    }

    if (withCheckin) {
      try {
        await checkinRechargeDaily();
      } catch (error) {
        logger.warn('Failed to complete daily recharge check-in on init.', error);
      }
    }

    try {
      const res = await getRechargeBalance();
      const nextBalance = res?.availableCredits ?? null;
      if (creditsBalanceMountedRef.current) {
        setCreditsBalance(nextBalance);
      }
      return nextBalance;
    } catch (error) {
      if (creditsBalanceMountedRef.current) {
        logger.warn('Failed to load recharge balance.', error);
        setCreditsBalance(null);
      }
      return null;
    } finally {
      if (creditsBalanceMountedRef.current) {
        setCreditsLoading(false);
      }
    }
  }, []);

  const refreshRechargeBalanceAfterPayment = useCallback(async () => {
    const previousBalance = creditsBalanceRef.current;
    let latestBalance = previousBalance;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      latestBalance = await refreshRechargeBalance();
      if (
        latestBalance != null
        && previousBalance != null
        && Number(latestBalance) !== Number(previousBalance)
      ) {
        return latestBalance;
      }
      if (latestBalance != null && previousBalance == null) {
        return latestBalance;
      }
      if (attempt < 4) {
        await wait(1200);
      }
    }

    return latestBalance;
  }, [refreshRechargeBalance]);

  const handleCreditsButtonClick = useCallback(async () => {
    await refreshRechargeBalance({ withCheckin: true });
  }, [refreshRechargeBalance]);

  const handleDraftDeleted = async (deletedDraftOrDrafts) => {
    const deletedDrafts = Array.isArray(deletedDraftOrDrafts)
      ? deletedDraftOrDrafts.filter(Boolean)
      : [deletedDraftOrDrafts].filter(Boolean);
    const deletedIds = new Set(deletedDrafts.map((item) => item?.draft_id).filter(Boolean));
    let remainingDrafts = [];
    setSelectedDrafts((prev) => {
      remainingDrafts = prev.filter((item) => !deletedIds.has(item?.draft_id));
      return remainingDrafts;
    });
    setSelectedDraft((prev) => {
      if (prev?.draft_id && deletedIds.has(prev.draft_id)) {
        return remainingDrafts[remainingDrafts.length - 1] || null;
      }
      return prev;
    });
    setDraftListRefreshToken((prev) => prev + 1);
    await refreshTodayCount();
  };

  useEffect(() => {
    let mounted = true;
    countTodayDrafts()
      .then((res) => {
        const c = typeof res?.count === 'number' ? res.count : 0;
        if (mounted) setTodayCount(c);
      })
      .catch(() => {
        if (mounted) setTodayCount(0);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    creditsBalanceRef.current = creditsBalance;
  }, [creditsBalance]);

  useEffect(() => {
    creditsBalanceMountedRef.current = true;
    void refreshRechargeBalance({ withCheckin: true });
    return () => { creditsBalanceMountedRef.current = false; };
  }, [refreshRechargeBalance]);

  useEffect(() => {
    void refreshHeaderMembership();
  }, [refreshHeaderMembership]);

  useEffect(() => {
    try {
      const { ipcRenderer } = window.require('electron');
      const handlePaymentSuccess = async () => {
        const nextBalance = await refreshRechargeBalanceAfterPayment();
        await refreshHeaderMembership();
        const nextBalanceText = formatCreditsCount(nextBalance);
        window.toast?.success?.(`支付成功，当前积分 ${nextBalanceText}`);
      };

      ipcRenderer.on(IpcChannel.Payment_Success, handlePaymentSuccess);
      return () => {
        ipcRenderer.removeListener(IpcChannel.Payment_Success, handlePaymentSuccess);
      };
    } catch (error) {
      logger.warn('Failed to subscribe payment success events.', error);
      return undefined;
    }
  }, [refreshHeaderMembership, refreshRechargeBalanceAfterPayment]);

  useEffect(() => {
    activeChatWebPreviewKeyRef.current = String(
      manualChatWebPreview?.key || chatWebPreview?.key || ''
    ).trim();
  }, [chatWebPreview?.key, manualChatWebPreview?.key]);

  useEffect(() => {
    try {
      const { ipcRenderer } = window.require('electron');

      const handleEnsureBrowserPreview = (_event, payload = {}) => {
        const normalizedUrl = String(payload?.url || '').trim();
        if (!normalizedUrl) return;

        const normalizedTabId = String(payload?.tabId || '').trim();
        const normalizedKey = String(
          payload?.key || `browser-preview:${normalizedTabId || normalizedUrl}`
        ).trim();
        const normalizedTitle = String(payload?.title || normalizedUrl).trim() || normalizedUrl;

        setSelectedPane('chat');
        setManualChatWebPreview({
          key: normalizedKey,
          url: normalizedUrl,
          title: normalizedTitle,
          tabId: normalizedTabId || undefined
        });
      };

      const handleHideBrowserPreview = () => {
      };

      ipcRenderer.on(IpcChannel.BrowserPreview_EnsureVisible, handleEnsureBrowserPreview);
      ipcRenderer.on(IpcChannel.BrowserPreview_Hide, handleHideBrowserPreview);

      return () => {
        ipcRenderer.removeListener(IpcChannel.BrowserPreview_EnsureVisible, handleEnsureBrowserPreview);
        ipcRenderer.removeListener(IpcChannel.BrowserPreview_Hide, handleHideBrowserPreview);
      };
    } catch (error) {
      logger.warn('Failed to subscribe browser preview events.', error);
      return undefined;
    }
  }, []);

  useEffect(() => {
    try {
      const { ipcRenderer } = window.require('electron');
      const handleRestartBeginnerGuide = () => {
        const previewKey = activeChatWebPreviewKeyRef.current;
        if (previewKey) {
          setChatWebPreviewDismissedKey(previewKey);
        }
        setManualChatWebPreview(null);
        setChatWebPreview(null);
        setSelectedPane('chat');
        setChatHistoryVisible(false);
        logger.info('[HomePage] restart-beginner-guide received');
        handleCreateChatSession({ source: 'restart-beginner-guide' });
      };

      ipcRenderer.on('restart-beginner-guide', handleRestartBeginnerGuide);
      return () => {
        ipcRenderer.removeListener('restart-beginner-guide', handleRestartBeginnerGuide);
      };
    } catch (error) {
      logger.warn('Failed to subscribe restart beginner guide event.', error);
      return undefined;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await getChatModelList();
        if (cancelled) return;

        const iconMap = payload?.blackIconMap || {};
        const modelItems = Array.isArray(payload?.modelItems) ? payload.modelItems : [];
        const nextOptions = modelItems.length > 0
          ? modelItems
            .map((item) => {
              const modelId = String(item?.model_id || item?.value || '').trim();
              if (!modelId) return null;
              const modelName = String(item?.name || item?.label || modelId).trim() || modelId;
              return toModelOption(
                modelId,
                modelName,
                iconMap?.[modelId] || '',
                item?.read_image,
                item?.pricing,
                item?.price_text,
                item?.description,
                item?.badges
              );
            })
            .filter(Boolean)
          : (
            (Array.isArray(payload?.models) && payload.models.length > 0 ? payload.models : CHAT_MODELS)
              .map((name) => toModelOption(name, name, iconMap?.[name] || '', false))
          );
        setChatModelOptions(nextOptions);

        setChatModel((prev) => {
          if (isModelInOptions(prev, nextOptions)) return prev;
          let storedModel = '';
          try {
            storedModel = String(localStorage.getItem(CHAT_MODEL_KEY) || '').trim();
          } catch {
            storedModel = '';
          }
          if (isModelInOptions(storedModel, nextOptions)) return storedModel;
          const defaultModel = String(payload?.defaultModel || '').trim();
          if (isModelInOptions(defaultModel, nextOptions)) return defaultModel;
          return String(nextOptions[0]?.value || CHAT_MODELS[0]);
        });
      } catch (error) {
        logger.warn('Failed to load chat model list, fallback to built-in models.', error);
      } finally {
        if (!cancelled) setChatModelListLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const storedModel = localStorage.getItem(CHAT_MODEL_KEY);
      if (storedModel && isModelInOptions(storedModel, chatModelOptions)) {
        setChatModel(storedModel);
      }
    } catch (error) {
      logger.warn('Failed to load chat model settings.', error);
    }
  }, [chatModelOptions]);

  useEffect(() => {
    const modelIds = (chatModelOptions || []).map((item) => String(item?.value || '').trim()).filter(Boolean);
    const initialApiKey = String(electronStore.get('auth.vectcut_api_key') || '').trim();
    const state = buildProvidersState(modelIds.length > 0 ? modelIds : CHAT_MODELS, initialApiKey);
    window.store = {
      getState: () => state,
      dispatch: () => undefined
    };

  }, [chatModelOptions]);

  useEffect(() => {
    try {
      const storedSessions = electronStore.get(CHAT_STORAGE_KEY);
      const storedActiveId = electronStore.get(CHAT_ACTIVE_ID_KEY);
      const legacyRawSessions = localStorage.getItem(CHAT_STORAGE_KEY);
      const legacyRawActiveId = localStorage.getItem(CHAT_ACTIVE_ID_KEY);
      const parsed = Array.isArray(storedSessions)
        ? storedSessions
        : (storedSessions ? JSON.parse(storedSessions) : (legacyRawSessions ? JSON.parse(legacyRawSessions) : []));
      const resolvedActiveId = String(storedActiveId || legacyRawActiveId || '').trim();
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed
          .filter((item) => item && typeof item === 'object' && item.id)
          .map((item) => {
            const runtimeSessionId = String(item.runtimeSessionId || '').trim();
            const accessiblePaths = Array.isArray(item.accessible_paths)
              ? item.accessible_paths.map((path) => normalizeLocalPath(path).trim()).filter(Boolean)
              : [];
            const configuration = item.configuration && typeof item.configuration === 'object' && !Array.isArray(item.configuration)
              ? { ...item.configuration }
              : undefined;
            const selectedWorkspacePath = normalizeLocalPath(
              configuration?.selected_workspace_path || ''
            ).trim();
            if (configuration) {
              if (selectedWorkspacePath) {
                configuration.selected_workspace_path = selectedWorkspacePath;
              } else {
                delete configuration.selected_workspace_path;
              }
            }
            const restoredMessages = runtimeSessionId
              ? []
              : (Array.isArray(item.messages)
                  ? item.messages.map((message) => normalizePersistedChatMessage(message))
                  : []);
            return {
              id: item.id,
              title: item.title || DEFAULT_CHAT_TITLE,
              titleAutoGenerated: item.titleAutoGenerated === true,
              createdAt: Number(item.createdAt) || Date.now(),
              updatedAt: Number(item.updatedAt) || Date.now(),
              runtimeSessionId,
              accessible_paths: accessiblePaths,
              configuration,
              historyLoaded: runtimeSessionId ? false : true,
              messages: restoredMessages,
            };
          });
        if (normalized.length > 0) {
          if (legacyRawSessions || legacyRawActiveId) {
            electronStore.set(CHAT_STORAGE_KEY, serializeChatSessionsForPersistence(normalized));
            electronStore.set(CHAT_ACTIVE_ID_KEY, resolvedActiveId || normalized[0].id);
            localStorage.removeItem(CHAT_STORAGE_KEY);
            localStorage.removeItem(CHAT_ACTIVE_ID_KEY);
          }
          let nextSessions = sortChatSessions(normalized);
          let nextActiveChatId = nextSessions.some((item) => item.id === resolvedActiveId)
            ? resolvedActiveId
            : nextSessions[0].id;

          if (shouldRestoreBeginnerGuideInFreshChat()) {
            const freshGuideSession = nextSessions.find((item) => isFreshBeginnerGuideChatSession(item));
            if (freshGuideSession) {
              nextActiveChatId = freshGuideSession.id;
            } else {
              const timedOutSession = findLatestTimedOutChatSession(nextSessions);
              if (timedOutSession?.id) {
                nextActiveChatId = timedOutSession.id;
              } else {
                const nextFreshSession = createEmptyChatSession();
                nextSessions = [nextFreshSession, ...nextSessions];
                nextActiveChatId = nextFreshSession.id;
              }
            }
            setSelectedPane('chat');
            setChatHistoryVisible(false);
          }

          setChatSessions(nextSessions);
          setActiveChatId(nextActiveChatId);
          return;
        }
      }
    } catch (error) {
      logger.warn('Failed to load chat sessions from persistence.', error);
    }
    setActiveChatId((prev) => prev || chatSessions[0]?.id || null);
  }, []);

  useEffect(() => {
    if (!Array.isArray(chatModelOptions) || chatModelOptions.length === 0) return;
    setChatSessions((prev) => {
      let changed = false;
      const next = prev.map((session) => {
        const currentMessages = Array.isArray(session?.messages) ? session.messages : [];
        let sessionChanged = false;
        const nextMessages = currentMessages.map((message) => {
          const normalizedMessage = normalizePersistedChatMessage(message, chatModelOptions);
          if (normalizedMessage !== message) {
            changed = true;
            sessionChanged = true;
          }
          return normalizedMessage;
        });
        return sessionChanged ? { ...session, messages: nextMessages } : session;
      });
      return changed ? next : prev;
    });
  }, [chatModelOptions]);

  useEffect(() => {
    if (chatPersistTimerRef.current) {
      clearTimeout(chatPersistTimerRef.current);
    }

    chatPersistTimerRef.current = setTimeout(() => {
      try {
        const persistedSessions = serializeChatSessionsForPersistence(chatSessions, chatModelOptions);
        electronStore.set(CHAT_STORAGE_KEY, persistedSessions);
        if (activeChatId) {
          electronStore.set(CHAT_ACTIVE_ID_KEY, activeChatId);
        }
        localStorage.removeItem(CHAT_STORAGE_KEY);
        localStorage.removeItem(CHAT_ACTIVE_ID_KEY);
      } catch (error) {
        logger.warn('Failed to persist chat sessions to electronStore.', error);
      } finally {
        chatPersistTimerRef.current = null;
      }
    }, CHAT_PERSIST_DEBOUNCE_MS);

    return () => {
      if (chatPersistTimerRef.current) {
        clearTimeout(chatPersistTimerRef.current);
        chatPersistTimerRef.current = null;
      }
    };
  }, [chatSessions, activeChatId, chatModelOptions]);

  useEffect(() => {
    const nextChatToAgent = new Map();
    const nextAgentToChat = new Map();
    for (const session of chatSessions) {
      const chatId = String(session?.id || '').trim();
      const runtimeSessionId = String(session?.runtimeSessionId || '').trim();
      if (!chatId || !runtimeSessionId) continue;
      nextChatToAgent.set(chatId, runtimeSessionId);
      nextAgentToChat.set(runtimeSessionId, chatId);
    }
    chatAgentSessionIdByChatIdRef.current = nextChatToAgent;
    chatIdByAgentSessionIdRef.current = nextAgentToChat;
  }, [chatSessions]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_MODEL_KEY, chatModel);
    } catch (error) {
      logger.warn('Failed to persist chat model settings.', error);
    }
  }, [chatModel]);

  const activeChatSession = chatSessions.find((item) => item.id === activeChatId) || null;
  const activeStreamingAssistantMessageId = useMemo(() => {
    const messages = Array.isArray(activeChatSession?.messages) ? activeChatSession.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (String(message?.role || '').toLowerCase() !== 'assistant') continue;
      const storeAssistantMessageId = String(message?.storeAssistantMessageId || '').trim();
      if (storeAssistantMessageId) return storeAssistantMessageId;
    }
    return '';
  }, [activeChatSession]);
  const [latestStreamingChatBrowserPreview, setLatestStreamingChatBrowserPreview] = useState(null);
  useEffect(() => {
    if (!activeStreamingAssistantMessageId) {
      setLatestStreamingChatBrowserPreview(null);
      return undefined;
    }

    const syncStreamingPreview = () => {
      const snapshot = getAssistantSnapshotFromStore(activeStreamingAssistantMessageId);
      const nextPreview = buildChatBrowserPreviewFromBlocks(snapshot?.blocks, activeChatSession?.id || 'chat');
      setLatestStreamingChatBrowserPreview((prev) => {
        const prevKey = String(prev?.key || '').trim();
        const nextKey = String(nextPreview?.key || '').trim();
        if (!prev && !nextPreview) return prev;
        if (prevKey && prevKey === nextKey) return prev;
        return nextPreview;
      });
    };

    syncStreamingPreview();
    const unsubscribe = appStore.subscribe(syncStreamingPreview);
    return () => {
      unsubscribe?.();
    };
  }, [activeStreamingAssistantMessageId, activeChatSession?.id]);
  const latestChatBrowserPreview = useMemo(
    () => latestStreamingChatBrowserPreview || buildChatBrowserPreviewFromSession(activeChatSession),
    [activeChatSession, latestStreamingChatBrowserPreview]
  );
  const activeChatRuntimeSessionId = String(activeChatSession?.runtimeSessionId || '').trim();
  const chatModelMeta = useMemo(
    () => buildChatMessageModelMeta(chatModel, chatModelOptions),
    [chatModel, chatModelOptions]
  );
  useEffect(() => {
    chatModelOptionsRef.current = chatModelOptions;
  }, [chatModelOptions]);
  useEffect(() => {
    chatModelMetaRef.current = chatModelMeta;
  }, [chatModelMeta]);
  const activeChatSessionInFlight = Boolean(
    activeChatId && chatSessionInFlightMap[String(activeChatId || '').trim()]
  );
  const activeChatSessionPending = isChatSessionPending({
    isPending: activeChatSessionInFlight
  });
  const activeChatSessionCompleted = isChatSessionCompleted({
    isPending: activeChatSessionPending,
    isFulfilled: Boolean(activeChatId && chatSessionFulfilledMap[String(activeChatId || '').trim()])
  });
  const activeChatMessagePaneSending = Boolean(
    activeChatSessionInFlight
  );
  const activeChatHistoryLoading = Boolean(
    activeChatId && chatHistoryLoadingMap[String(activeChatId || '').trim()]
  );
  const activeChatNeedsHistoryHydrate = Boolean(
    activeChatSession && shouldHydrateChatSessionFromHistory(activeChatSession)
  );
  const recoverTimedOutChatBeforeAutoCreate = useCallback(({ source = 'auto-create-chat', notify = true } = {}) => {
    const timedOutSession = findLatestTimedOutChatSession(chatSessionsRef.current);
    const chatId = String(timedOutSession?.id || '').trim();
    if (!chatId) {
      return null;
    }

    const runtimeSessionId = String(timedOutSession?.runtimeSessionId || '').trim();
    logger.warn('[HomePage][SessionSending] blocked automatic chat creation after timeout', {
      source,
      chatId,
      runtimeSessionId
    });

    if (runtimeSessionId) {
      chatHistoryHydrateSettledRef.current.delete(`${chatId}:${runtimeSessionId}`);
      void hydratePersistedChatSessionFromHistory({
        chatId,
        sessionId: runtimeSessionId,
        reason: `blocked-auto-chat-create-after-timeout:${source}`
      });
    }

    if (notify) {
      window.toast?.warning?.(BLOCK_NEW_CHAT_AFTER_TIMEOUT_MESSAGE);
    }

    setSelectedPane('chat');
    setActiveChatId(chatId);
    return timedOutSession;
  }, [hydratePersistedChatSessionFromHistory]);

  useEffect(() => {
    if (!latestChatBrowserPreview) {
      setChatWebPreview(null);
      return;
    }
    if (latestChatBrowserPreview.key === chatWebPreviewDismissedKey) {
      setChatWebPreview(null);
      return;
    }
    setChatWebPreview((prev) => (
      prev?.key === latestChatBrowserPreview.key ? prev : latestChatBrowserPreview
    ));
  }, [latestChatBrowserPreview, chatWebPreviewDismissedKey]);
  const activeChatWebPreview = manualChatWebPreview || chatWebPreview;

  useEffect(() => {
    let cancelled = false;
    const previewVisible = selectedPane === 'chat' && (Boolean(activeChatWebPreview?.url) || chatInlinePreviewVisible);

    const syncWindowWidth = async () => {
      if (!window?.api?.window?.getSize || !window?.api?.window?.setSize) return;

      if (previewVisible) {
        if (isFullscreen || chatExpandedWindowBaseWidthRef.current != null) return;
        try {
          const [width, height] = await window.api.window.getSize();
          if (cancelled) return;
          chatExpandedWindowBaseWidthRef.current = width;
          await window.api.window.setSize(width + CHAT_BROWSER_PREVIEW_WIDTH, height, true);
        } catch (error) {
          chatExpandedWindowBaseWidthRef.current = null;
          logger.warn('Failed to expand window for browser preview.', error);
        }
        return;
      }

      if (isFullscreen || chatExpandedWindowBaseWidthRef.current == null) return;
      try {
        const [, height] = await window.api.window.getSize();
        const targetWidth = chatExpandedWindowBaseWidthRef.current;
        chatExpandedWindowBaseWidthRef.current = null;
        if (cancelled) return;
        await window.api.window.setSize(targetWidth, height, true);
      } catch (error) {
        chatExpandedWindowBaseWidthRef.current = null;
        logger.warn('Failed to restore window width after browser preview.', error);
      }
    };

    void syncWindowWidth();
    return () => {
      cancelled = true;
    };
  }, [activeChatWebPreview?.url, chatInlinePreviewVisible, isFullscreen, selectedPane]);

  useEffect(() => {
    const api = window?.electronAPI?.agentSessionStream;
    if (!canUseAgentRuntime || typeof api?.onSessionChanged !== 'function') return undefined;

    return api.onSessionChanged((payload) => {
      const runtimeSessionId = String(payload?.sessionId || '').trim();
      if (!runtimeSessionId) return;
      const chatId = chatIdByAgentSessionIdRef.current.get(runtimeSessionId);
      if (!chatId) return;

      const hasPendingForSession = Array.from(chatPendingByRequestIdRef.current.values()).some(
        (entry) => String(entry?.agentSessionId || '').trim() === runtimeSessionId
      );
      if (hasPendingForSession) {
        chatDeferredSessionChangeHydrateRef.current.set(chatId, {
          chatId,
          sessionId: runtimeSessionId,
          reason: payload?.headless ? 'session-changed.headless.deferred' : 'session-changed.deferred'
        });
        chatHistoryHydrateSettledRef.current.delete(`${chatId}:${runtimeSessionId}`);
        return;
      }

      void hydratePersistedChatSessionFromHistory({
        chatId,
        sessionId: runtimeSessionId,
        reason: payload?.headless ? 'session-changed.headless' : 'session-changed'
      });
    });
  }, [canUseAgentRuntime, hydratePersistedChatSessionFromHistory]);

  useEffect(() => {
    if (!canUseAgentRuntime) return;
    if (selectedPane !== 'chat') return;
    if (!activeChatSession || !activeChatNeedsHistoryHydrate) return;
    if (activeChatSessionPending) return;
    if (!window?.ipc?.invoke && !window?.electron?.ipcRenderer?.invoke) {
      logger.warn('[HomePage][HistoryHydrate] bridge unavailable', {
        chatId: activeChatSession?.id || '',
        sessionId: activeChatRuntimeSessionId
      });
      return;
    }

    const runtimeSessionId = activeChatRuntimeSessionId;
    if (!runtimeSessionId) return;

    const hydrateKey = `${activeChatSession.id}:${runtimeSessionId}`;
    if (chatHistoryHydratingRef.current.has(hydrateKey)) return;
    if (chatHistoryHydrateSettledRef.current.has(hydrateKey)) return;

    let cancelled = false;
    chatHistoryHydratingRef.current.add(hydrateKey);
    setChatHistoryLoadingMap((prev) => (
      prev[activeChatSession.id] ? prev : { ...prev, [activeChatSession.id]: true }
    ));
    void (async () => {
      try {
        const beforeMessageCount = Array.isArray(activeChatSession.messages)
          ? activeChatSession.messages.length
          : 0;
        const beforeMessageIds = new Set(
          (Array.isArray(activeChatSession.messages) ? activeChatSession.messages : [])
            .map((message) => String(message?.id || '').trim())
            .filter(Boolean)
        );
        const beforeVisibleAssistantCount = countVisibleAssistantMessages(activeChatSession.messages);
        const beforeMissingAssistantCount = countMissingVisibleAssistantMessages(activeChatSession.messages);
        const invoke = window?.ipc?.invoke
          ? (channel, payload) => window.ipc.invoke(channel, payload)
          : (channel, payload) => window.electron.ipcRenderer.invoke(channel, payload);
        const historicalMessages = await invoke(IpcChannel.AgentMessage_GetHistory, {
          sessionId: runtimeSessionId
        });
        if (cancelled) return;
        if (!Array.isArray(historicalMessages) || historicalMessages.length === 0) {
          setChatSessions((prev) => prev.map((item) => (
            item.id === activeChatSession.id ? { ...item, historyLoaded: true } : item
          )));
          chatHistoryHydrateSettledRef.current.add(hydrateKey);
          logger.warn('[HomePage][HistoryHydrate] skipped empty history', {
            chatId: activeChatSession.id,
            sessionId: runtimeSessionId,
            beforeMissingAssistantCount
          });
          return;
        }

        const hydratedMessages = enhancePersistedHydratedMessages(historicalMessages
          .map((entry, index) => toPersistedHistoryMessage(entry, index, chatModelOptions))
          .filter((message) => message?.id));
        const hasAssistantContentOrUsage = hydratedMessages.some((message) => (
          message.role === 'assistant'
          && (
            String(message.content || '').trim()
            || message?.usage
            || (Array.isArray(message?.usageSteps) && message.usageSteps.length > 0)
            || Number(message?.metrics?.completion_tokens || 0) > 0
          )
        ));
        if (!hasAssistantContentOrUsage) {
          chatHistoryHydrateSettledRef.current.add(hydrateKey);
          logger.warn('[HomePage][HistoryHydrate] skipped missing assistant content', {
            chatId: activeChatSession.id,
            sessionId: runtimeSessionId,
            beforeMessageCount,
            beforeVisibleAssistantCount,
            beforeMissingAssistantCount,
            afterVisibleAssistantCount: countVisibleAssistantMessages(hydratedMessages),
            afterMissingAssistantCount: countMissingVisibleAssistantMessages(hydratedMessages)
          });
          return;
        }
        const shouldApplyHydration = shouldApplyHydratedMessages({
          currentMessages: activeChatSession.messages,
          hydratedMessages
        });
        if (!shouldApplyHydration) {
          chatHistoryHydrateSettledRef.current.add(hydrateKey);
          logger.warn('[HomePage][HistoryHydrate] skipped no improvement', {
            chatId: activeChatSession.id,
            sessionId: runtimeSessionId,
            beforeMessageCount,
            beforeVisibleAssistantCount,
            beforeMissingAssistantCount,
            afterVisibleAssistantCount: countVisibleAssistantMessages(hydratedMessages),
            afterMissingAssistantCount: countMissingVisibleAssistantMessages(hydratedMessages),
            beforeStructuredAssistantBlockCount: countStructuredAssistantBlocks(activeChatSession.messages),
            afterStructuredAssistantBlockCount: countStructuredAssistantBlocks(hydratedMessages),
            beforeAssistantUsageStepCount: countAssistantUsageSteps(activeChatSession.messages),
            afterAssistantUsageStepCount: countAssistantUsageSteps(hydratedMessages),
            beforePricedUsageMessageCount: countAssistantPricedUsageMessages(activeChatSession.messages),
            afterPricedUsageMessageCount: countAssistantPricedUsageMessages(hydratedMessages),
            messageCount: hydratedMessages.length
          });
          logger.warn('[CTXLOSS][HistoryHydrate] active-sync-skip', {
            chatId: activeChatSession.id,
            sessionId: runtimeSessionId,
            currentSummary: summarizeHydrateMessageCollection(activeChatSession.messages),
            hydratedSummary: summarizeHydrateMessageCollection(hydratedMessages)
          });
          return;
        }

        setChatSessions((prev) => {
          const updated = prev.map((item) => {
            if (item.id !== activeChatSession.id) return item;
            if (!shouldHydrateChatSessionFromHistory(item)) return item;
            const currentMessages = Array.isArray(item.messages) ? item.messages : [];
            const hydratedMessageIds = new Set(
              hydratedMessages.map((message) => String(message?.id || '').trim()).filter(Boolean)
            );
            // Preserve optimistic messages added after hydrate started so a restart +
            // quick resend does not get overwritten by late-arriving history data.
            const locallyAddedMessages = currentMessages.filter((message) => {
              const messageId = String(message?.id || '').trim();
              if (!messageId) return false;
              if (hydratedMessageIds.has(messageId)) return false;
              return !beforeMessageIds.has(messageId);
            });
            return {
              ...item,
              updatedAt: Date.now(),
              historyLoaded: true,
              messages: [...hydratedMessages, ...locallyAddedMessages]
            };
          });
          return sortChatSessions(updated);
        });
        chatHistoryHydrateSettledRef.current.add(hydrateKey);
        logger.info('[CTXLOSS][HistoryHydrate] active-sync-applied', {
          chatId: activeChatSession.id,
          sessionId: runtimeSessionId,
          beforeSummary: summarizeHydrateMessageCollection(activeChatSession.messages),
          hydratedSummary: summarizeHydrateMessageCollection(hydratedMessages)
        });
      } catch (error) {
        if (cancelled) return;
        logger.warn('[HomePage][HistoryHydrate] failed', {
          chatId: activeChatSession.id,
          sessionId: runtimeSessionId,
          error: error?.message || String(error)
        });
      } finally {
        chatHistoryHydratingRef.current.delete(hydrateKey);
        setChatHistoryLoadingMap((prev) => {
          if (!(activeChatSession.id in prev)) return prev;
          const next = { ...prev };
          delete next[activeChatSession.id];
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    canUseAgentRuntime,
    selectedPane,
    activeChatId,
    activeChatRuntimeSessionId,
    activeChatNeedsHistoryHydrate,
    activeChatSessionPending
  ]);
  const setChatSessionSending = (chatId, sending) => {
    const id = String(chatId || '').trim();
    if (!id) return;
    setChatSessionSendingMap((prev) => {
      const nextValue = Boolean(sending);
      if (prev[id] === nextValue) return prev;
      return { ...prev, [id]: nextValue };
    });
  };
  const removeChatSessionSending = (chatId) => {
    const id = String(chatId || '').trim();
    if (!id) return;
    setChatSessionSendingMap((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const setChatSessionInFlight = (chatId, inFlight) => {
    const id = String(chatId || '').trim();
    if (!id) return;
    setChatSessionInFlightMap((prev) => {
      const nextValue = Boolean(inFlight);
      if (prev[id] === nextValue) return prev;
      return { ...prev, [id]: nextValue };
    });
  };
  const removeChatSessionInFlight = (chatId) => {
    const id = String(chatId || '').trim();
    if (!id) return;
    setChatSessionInFlightMap((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const setChatSessionFulfilled = (chatId, fulfilled) => {
    const id = String(chatId || '').trim();
    if (!id) return;
    setChatSessionFulfilledMap((prev) => {
      const nextValue = Boolean(fulfilled);
      if (prev[id] === nextValue) return prev;
      return { ...prev, [id]: nextValue };
    });
  };
  const removeChatSessionFulfilled = (chatId) => {
    const id = String(chatId || '').trim();
    if (!id) return;
    setChatSessionFulfilledMap((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const removeChatHistoryLoading = (chatId) => {
    const id = String(chatId || '').trim();
    if (!id) return;
    setChatHistoryLoadingMap((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const setChatWorkspaceStatus = useCallback((chatId, statusText = '') => {
    const id = String(chatId || '').trim();
    if (!id) return;
    const nextStatusText = String(statusText || '').trim();
    setChatWorkspaceStatusMap((prev) => {
      const prevStatusText = String(prev[id] || '').trim();
      if (prevStatusText === nextStatusText) return prev;
      if (!nextStatusText) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return {
        ...prev,
        [id]: nextStatusText
      };
    });
  }, []);
  const updateChatMessage = useCallback((chatId, messageId, updates) => {
    if (!chatId || !messageId || !updates) return;
    setChatSessions((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== chatId) return item;
        return {
          ...item,
          updatedAt: Date.now(),
          messages: item.messages.map((message) => (
            message.id === messageId
              ? {
                ...message,
                ...(typeof updates === 'function' ? updates(message) : updates),
                updatedAt: Date.now()
              }
              : message
          ))
        };
      });
      return sortChatSessions(updated);
    });
  }, []);
  const updateChatAssistantMessage = useCallback((chatId, assistantMessageId, updates) => {
    updateChatMessage(chatId, assistantMessageId, updates);
  }, [updateChatMessage]);
  const finalizeChatAssistantMessageLocally = useCallback(({
    chatId,
    assistantMessageId,
    storeAssistantMessageId
  }, {
    error = null,
    aborted = false
  } = {}) => {
    if (!chatId || !assistantMessageId) return;
    const snapshot = getAssistantSnapshotFromStore(storeAssistantMessageId || '');
    updateChatAssistantMessage(chatId, assistantMessageId, (message) => {
      const sourceBlocks = snapshot?.blocks || message?.blocks || [];
      const nextBlocks = finalizeStructuredBlocks(sourceBlocks, { aborted });
      const nextContent =
        snapshot?.content
        || buildAssistantDisplayContentFromBlocks(nextBlocks)
        || message?.content
        || '';
      const nextModel = normalizeMessageModelMeta(
        snapshot?.model || message?.model,
        snapshot?.model?.id || message?.modelId || chatModel,
        chatModelOptionsRef.current
      ) || message?.model || chatModelMetaRef.current || chatModelMeta;
      const nextModelId = String(
        nextModel?.id
        || resolveMessageModelId(snapshot?.model, message?.modelId || chatModel)
        || message?.modelId
        || chatModel
        || ''
      ).trim() || chatModel;
      return {
        ...message,
        storeAssistantMessageId: null,
        retryStatusText: '',
        content: nextContent,
        blocks: nextBlocks,
        usage: snapshot?.usage ? { ...snapshot.usage } : message?.usage,
        usageSteps: Array.isArray(snapshot?.usageSteps)
          ? snapshot.usageSteps.map((usageStep) => ({ ...usageStep }))
          : message?.usageSteps,
        metrics: snapshot?.metrics ? { ...snapshot.metrics } : message?.metrics,
        model: nextModel,
        modelId: nextModelId,
        error,
        aborted: Boolean(aborted),
        updatedAt: Date.now()
      };
    });
  }, [chatModel, chatModelMeta, updateChatAssistantMessage]);
  const activeChatSending = Boolean(activeChatId) && isChatSessionPending({
    isPending: chatSessionInFlightMap[activeChatId]
  });
  const activeChatWorkspaceStatus = String(
    (activeChatId && chatWorkspaceStatusMap[String(activeChatId || '').trim()]) || ''
  ).trim();
  const isChatSessionSending = (chatId) => Boolean(chatId) && Boolean(chatSessionSendingMap[chatId]);
  const chatSessionsWithStatus = useMemo(
    () =>
      chatSessions.map((session) => ({
        ...session,
        isPending: Boolean(chatSessionInFlightMap[session.id]),
        isFulfilled: Boolean(chatSessionFulfilledMap[session.id]),
        isCompleted: isChatSessionCompleted({
          isPending: Boolean(chatSessionInFlightMap[session.id]),
          isFulfilled: Boolean(chatSessionFulfilledMap[session.id])
        }),
      })),
    [chatSessions, chatSessionInFlightMap, chatSessionFulfilledMap]
  );

  useEffect(() => {
    chatSessionsRef.current = chatSessions;
  }, [chatSessions]);

  useEffect(() => {
    const pendingSessions = chatSessions.filter((session) => {
      const chatId = String(session?.id || '').trim();
      const runtimeSessionId = String(session?.runtimeSessionId || '').trim();
      const workspacePath = getSessionWorkspacePath(session);
      if (!chatId || !runtimeSessionId || workspacePath) return false;
      if (chatWorkspaceMetaHydratingRef.current.has(chatId)) return false;
      if (chatWorkspaceHydrationSuppressedRef.current.has(chatId)) return false;
      return true;
    });

    if (pendingSessions.length === 0) return undefined;

    let cancelled = false;

    pendingSessions.forEach((session) => {
      const chatId = String(session?.id || '').trim();
      const runtimeSessionId = String(session?.runtimeSessionId || '').trim();
      if (!chatId || !runtimeSessionId) return;

      chatWorkspaceMetaHydratingRef.current.add(chatId);
      void window.electronAPI.cherryChatStream.getSession(runtimeSessionId)
        .then((result) => {
          if (cancelled) return;
          const runtimeSession = result?.session || null;
          const accessiblePaths = Array.isArray(runtimeSession?.accessible_paths)
            ? runtimeSession.accessible_paths.map((path) => normalizeLocalPath(path).trim()).filter(Boolean)
            : [];
          const configuration = runtimeSession?.configuration && typeof runtimeSession.configuration === 'object'
            ? runtimeSession.configuration
            : undefined;
          const selectedWorkspacePath = normalizeLocalPath(
            configuration?.selected_workspace_path || accessiblePaths[0] || ''
          ).trim();
          if (chatWorkspaceHydrationSuppressedRef.current.has(chatId)) return;
          if (!selectedWorkspacePath && accessiblePaths.length === 0) return;

            logger.info('[HomePage][WorkspaceMeta] hydrated session workspace', {
              chatId,
              runtimeSessionId,
              selectedWorkspacePath,
              accessiblePathsCount: accessiblePaths.length,
              firstAccessiblePath: accessiblePaths[0] || ''
            });

          setChatSessions((prev) => prev.map((item) => {
            if (item.id !== chatId) return item;
            return {
              ...item,
              accessible_paths: accessiblePaths.length > 0 ? accessiblePaths : item.accessible_paths,
              configuration: configuration
                ? {
                  ...configuration,
                  ...(selectedWorkspacePath ? { selected_workspace_path: selectedWorkspacePath } : {})
                }
                : item.configuration,
              updatedAt: item.updatedAt
            };
          }));
        })
        .catch((error) => {
          logger.debug('[HomePage] skipped workspace metadata hydration for chat session', {
            chatId,
            runtimeSessionId,
            error: error instanceof Error ? error.message : String(error)
          });
        })
        .finally(() => {
          chatWorkspaceMetaHydratingRef.current.delete(chatId);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [chatSessions]);

  useEffect(() => {
    return () => {
      chatSnapshotThrottleByRequestIdRef.current.forEach((entry) => {
        if (entry?.timer) clearTimeout(entry.timer);
      });
      chatSnapshotThrottleByRequestIdRef.current.clear();
      if (chatPersistTimerRef.current) {
        clearTimeout(chatPersistTimerRef.current);
        chatPersistTimerRef.current = null;
      }
    };
  }, []);

  const triggerAutoRenameSessionTitle = async (sessionId, {
    messagesOverride = null,
    modelOverride = '',
    requireFirstUserMessageOnly = false
  } = {}) => {
    const id = String(sessionId || '').trim();
    if (!id) return;
    if (chatTitleGeneratingSessionIdsRef.current.has(id)) return;

    const session = chatSessionsRef.current.find((item) => item.id === id);
    if (!session && !Array.isArray(messagesOverride)) return;

    const currentTitle = String(session?.title || '').trim();
    if (currentTitle && currentTitle !== DEFAULT_CHAT_TITLE && !session?.titleAutoGenerated) return;

    const normalizedMessages = Array.isArray(messagesOverride)
      ? messagesOverride
      : (Array.isArray(session?.messages) ? session.messages : []);
    const userMessages = normalizedMessages.filter((item) => (
      item?.role === 'user'
      && String(item?.content || '').trim()
    ));
    if (userMessages.length === 0) {
      logger.info('[HomePage][TitleRename] skipped', {
        sessionId: id,
        reason: 'no-user-message',
        messageCount: normalizedMessages.length
      });
      return;
    }
    if (requireFirstUserMessageOnly && userMessages.length !== 1) {
      logger.info('[HomePage][TitleRename] skipped', {
        sessionId: id,
        reason: 'user-message-count-not-one',
        messageCount: normalizedMessages.length,
        userMessageCount: userMessages.length
      });
      return;
    }

    const latestAssistant = [...normalizedMessages].reverse().find((item) => item?.role === 'assistant');
    const summaryModel = resolveMessageModelId(
      modelOverride || latestAssistant?.model,
      modelOverride || latestAssistant?.modelId || chatModel
    );
    if (!summaryModel) {
      logger.info('[HomePage][TitleRename] skipped', {
        sessionId: id,
        reason: 'missing-summary-model',
        messageCount: normalizedMessages.length
      });
      return;
    }

    chatTitleGeneratingSessionIdsRef.current.add(id);
    setChatTitleRenamingSessionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));

    try {
      logger.info('[HomePage][TitleRename] model-candidates', {
        sessionId: id,
        modelOverride,
        latestAssistantModelType: typeof latestAssistant?.model,
        latestAssistantModelValue: latestAssistant?.model,
        latestAssistantModelId: latestAssistant?.modelId,
        chatModel,
        resolvedSummaryModel: summaryModel
      });
      logger.info('[HomePage][TitleRename] start', {
        sessionId: id,
        messageCount: normalizedMessages.length,
        summaryModel
      });
      const { text, error } = await fetchMessagesSummary({
        messages: normalizedMessages,
        model: summaryModel
      });
      const nextTitle = String(text || '').trim();
      if (!nextTitle) {
        logger.info('[HomePage][TitleRename] skipped', {
          sessionId: id,
          reason: 'empty-generated-title',
          summaryError: error || '',
          resolvedSummaryModel: summaryModel
        });
        return;
      }

      let updated = false;
      setChatSessions((prev) => {
        const next = prev.map((item) => {
          if (item.id !== id) return item;
          const titleNow = String(item.title || '').trim();
          if (titleNow && titleNow !== DEFAULT_CHAT_TITLE && !item.titleAutoGenerated) return item;
          if (titleNow === nextTitle && item.titleAutoGenerated) return item;
          updated = true;
          return {
            ...item,
            title: nextTitle,
            titleAutoGenerated: true,
            updatedAt: Date.now()
          };
        });
        return updated ? sortChatSessions(next) : prev;
      });
      if (!updated) return;
      logger.info('[HomePage][TitleRename] updated', {
        sessionId: id,
        nextTitle
      });

      setChatTitleNewlyRenamedSessionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      const oldTimer = chatTitleRevealTimersRef.current.get(id);
      if (oldTimer) clearTimeout(oldTimer);
      const timer = setTimeout(() => {
        setChatTitleRenamingSessionIds((prev) => prev.filter((item) => item !== id));
        setChatTitleNewlyRenamedSessionIds((prev) => prev.filter((item) => item !== id));
        chatTitleRevealTimersRef.current.delete(id);
      }, 1600);
      chatTitleRevealTimersRef.current.set(id, timer);
    } catch (error) {
      logger.warn('[HomePage][TitleRename] failed', {
        sessionId: id,
        error: error?.message || String(error)
      });
    } finally {
      chatTitleGeneratingSessionIdsRef.current.delete(id);
      setChatTitleRenamingSessionIds((prev) => prev.filter((item) => item !== id));
    }
  };


  const ensureAgentSessionForChat = async (chatId) => {
    if (!chatId || !canUseAgentRuntime) return '';

    const existingEnsure = chatEnsuringAgentSessionByChatIdRef.current.get(chatId);
    if (existingEnsure) return existingEnsure;

    const ensurePromise = (async () => {
      const subscribeToSession = async (agentSessionId) => {
        await window.electronAPI.cherryChatStream.subscribe(agentSessionId);
        return agentSessionId;
      };

      const targetChatSession = chatSessions.find((item) => item.id === chatId) || null;
      const preferredWorkspacePath = getSessionWorkspacePath(targetChatSession);
      const persistedRuntimeSessionId = String(
        targetChatSession?.runtimeSessionId || ''
      ).trim();
      const cached = chatAgentSessionIdByChatIdRef.current.get(chatId) || persistedRuntimeSessionId;
      if (cached) {
        chatAgentSessionIdByChatIdRef.current.set(chatId, cached);
        chatIdByAgentSessionIdRef.current.set(cached, chatId);
        return subscribeToSession(cached, 'reuse');
      }

      const vectcutApiKey = await getAgentApiKeyFromLoginState();
      const modelIds = (chatModelOptions || []).map((item) => String(item?.value || '').trim()).filter(Boolean);
      const runtimeState = buildProvidersState(modelIds.length > 0 ? modelIds : CHAT_MODELS, vectcutApiKey);
      window.store = {
        getState: () => runtimeState,
        dispatch: () => undefined
      };

      logger.info('[HomePage] createSession invoke', {
        chatId,
        agentId: DEFAULT_RUNTIME_AGENT_ID,
        model: chatModel,
        workspacePath: preferredWorkspacePath,
        hasApiKey: Boolean(vectcutApiKey)
      });
      const created = await window.electronAPI.cherryChatStream.createSession({
        agent_id: DEFAULT_RUNTIME_AGENT_ID,
        model: chatModel,
        accessible_paths: preferredWorkspacePath ? [preferredWorkspacePath] : [],
        configuration: {
          permission_mode: 'bypassPermissions',
          ...(preferredWorkspacePath ? { selected_workspace_path: preferredWorkspacePath } : {}),
          env_vars: {
            VECTCUT_API_KEY: vectcutApiKey,
            VECTCUT_ANTHROPIC_API_BASE_URL
          }
        }
      });
      logger.info('[HomePage] createSession result', {
        chatId,
        ok: Boolean(created?.ok),
        sessionId: created?.session?.id || '',
        error: created?.error || ''
      });
      if (!created?.ok || !created?.session?.id) {
        throw new Error(created?.error || 'agent session create failed');
      }

      const agentSessionId = created.session.id;
      chatAgentSessionIdByChatIdRef.current.set(chatId, agentSessionId);
      chatIdByAgentSessionIdRef.current.set(agentSessionId, chatId);
      setChatSessions((prev) =>
        prev.map((item) => (item.id === chatId ? { ...item, runtimeSessionId: agentSessionId } : item))
      );

      return subscribeToSession(agentSessionId, 'create');
    })();

    chatEnsuringAgentSessionByChatIdRef.current.set(chatId, ensurePromise);
    try {
      return await ensurePromise;
    } finally {
      chatEnsuringAgentSessionByChatIdRef.current.delete(chatId);
    }
  };

  useEffect(() => {
    if (!canUseAgentRuntime) return;
    if (selectedPane !== 'chat') return;
    if (!activeChatId) return;

    let cancelled = false;
    void (async () => {
      try {
        await ensureAgentSessionForChat(activeChatId);
        if (cancelled) return;
      } catch (error) {
        if (cancelled) return;
        logger.warn('[HomePage] prewarm session failed', {
          activeChatId,
          error: error?.message || String(error)
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canUseAgentRuntime, selectedPane, activeChatId, chatModel]);

  useEffect(() => {
    if (!canUseAgentRuntime || !window?.electronAPI?.cherryChatStream) return undefined;

    const offPermissionRequest = window.electronAPI.cherryChatStream.onPermissionRequest(async (payload) => {
      const requestId = String(payload?.requestId || '').trim();
      if (!requestId) return;
      const toolName = String(payload?.toolName || '').trim();
      const isAskUserQuestion = toolName === 'AskUserQuestion';

      logger.info('[HomePage][ToolPermission] request received', {
        requestId,
        toolName,
        toolCallId: payload?.toolCallId || '',
        autoApprove: Boolean(payload?.autoApprove)
      });

      try {
        if (payload?.autoApprove) {
          const response = await window.electronAPI.agentTools.respondToPermission({
            requestId,
            behavior: 'allow',
            updatedInput: payload?.input,
            updatedPermissions: Array.isArray(payload?.suggestions) ? payload.suggestions : undefined
          });

          logger.info('[HomePage][ToolPermission] response sent', {
            requestId,
            ok: Boolean(response?.success),
            behavior: 'allow'
          });
          return;
        }

        if (isAskUserQuestion) {
          appStore.dispatch(toolPermissionsActions.requestReceived(payload));
          logger.info('[HomePage][ToolPermission] queued interactive request', {
            requestId,
            toolName,
            toolCallId: payload?.toolCallId || ''
          });
          return;
        }

        const response = await window.electronAPI.agentTools.respondToPermission({
          requestId,
          behavior: 'deny',
          message: 'Tool approval UI is unavailable in HomePage runtime.'
        });

        logger.info('[HomePage][ToolPermission] response sent', {
          requestId,
          ok: Boolean(response?.success),
          behavior: 'deny'
        });
      } catch (error) {
        logger.error('[HomePage][ToolPermission] failed to send response', {
          requestId,
          error: error?.message || String(error)
        });
      }
    });

    const offPermissionResult = window.electronAPI.cherryChatStream.onPermissionResult((payload) => {
      appStore.dispatch(toolPermissionsActions.requestResolved(payload));
      logger.info('[HomePage][ToolPermission] result received', {
        requestId: payload?.requestId || '',
        behavior: payload?.behavior || '',
        reason: payload?.reason || ''
      });
    });

    const offChunk = window.electronAPI.cherryChatStream.onChunk((payload) => {
      const agentSessionId = payload?.sessionId;
      const requestId = String(payload?.requestId || '').trim();
      if (!agentSessionId) {
        logger.warn('[HomePage][StreamTrace] drop payload without sessionId', {
          requestId,
          payloadType: payload?.type || '',
          chunkType: payload?.chunk?.type || '',
          hasChunk: Boolean(payload?.chunk)
        });
        return;
      }
      const pending = requestId ? chatPendingByRequestIdRef.current.get(requestId) : undefined;
      if (!pending) {
        const payloadType = String(payload?.type || '');
        const chunkType = String(payload?.chunk?.type || '');
        const mappedChatId = chatIdByAgentSessionIdRef.current.get(agentSessionId);
        const hasNewerPendingForSameChat = Boolean(
          mappedChatId
          && [...chatPendingByRequestIdRef.current.entries()].some(([pendingRequestId, item]) => (
            pendingRequestId !== requestId
            && item?.chatId === mappedChatId
          ))
        );
        if (mappedChatId && hasNewerPendingForSameChat) {
          return;
        }
        if (payloadType === 'started') {
          if (mappedChatId) {
            setChatSessionSending(mappedChatId, true, 'chunk.started.without-pending');
            setChatSessionInFlight(mappedChatId, true, 'chunk.started.without-pending');
            if (mappedChatId === activeChatId) setChatSending(true);
          }
        }
        if (mappedChatId && payloadType === 'stream-finished') {
          setChatSessionInFlight(mappedChatId, false, 'chunk.stream-finished.without-pending');
        }
        if (mappedChatId && payloadType === 'complete') {
          setChatSessionSending(mappedChatId, false, 'chunk.complete.without-pending');
          setChatSessionInFlight(mappedChatId, false, 'chunk.complete.without-pending');
          setChatSessionFulfilled(mappedChatId, true, 'chunk.complete.without-pending');
          if (mappedChatId === activeChatId) setChatSending(false);
        }
        if (mappedChatId && (payloadType === 'error' || payloadType === 'cancelled')) {
          setChatSessionSending(mappedChatId, false, `chunk.${payloadType}.without-pending`);
          setChatSessionInFlight(mappedChatId, false, `chunk.${payloadType}.without-pending`);
          setChatSessionFulfilled(mappedChatId, false, `chunk.${payloadType}.without-pending`);
          if (mappedChatId === activeChatId) setChatSending(false);
        }
        const isToolRelated =
          chunkType.startsWith('tool-')
          || payloadType === 'started'
          || payloadType === 'stream-finished'
          || payloadType === 'complete'
          || payloadType === 'error'
          || payloadType === 'cancelled';
        if (isToolRelated) {
          if (mappedChatId && agentSessionId) {
            chatHistoryHydrateSettledRef.current.delete(`${mappedChatId}:${agentSessionId}`);
            void hydratePersistedChatSessionFromHistory({
              chatId: mappedChatId,
              sessionId: agentSessionId,
              reason: `drop-payload-without-pending:${payloadType || chunkType || 'unknown'}`
            });
          }
        }
        return;
      }
      const { chatId, assistantMessageId, streamController, storeAssistantMessageId } = pending;
      const perfEntry = requestId ? chatPerfByRequestIdRef.current.get(requestId) : null;
      const throttleKey = requestId || `${chatId}:${assistantMessageId}`;
      const useRendererStoreStreaming = Boolean(storeAssistantMessageId);
      if (payload.type === 'started') {
        if (perfEntry && !perfEntry.startedAt) {
          perfEntry.startedAt = Date.now();
          perfEntry.startedPerfAt = getPerfTimestamp();
        }
        setChatSessionSending(chatId, true, 'chunk.started');
        setChatSessionInFlight(chatId, true, 'chunk.started');
        setChatSending(true);
        return;
      }
      const applySnapshot = (error = null) => {
        const snapshot = getAssistantSnapshotFromStore(storeAssistantMessageId || '');
        if (!snapshot) return;
        const snapshotSummary = summarizeSnapshotForPerf(snapshot);
        let computeDurationMs = 0;
        setChatSessions((prev) => {
          const computeStart = getPerfTimestamp();
          const updated = prev.map((item) => {
            if (item.id !== chatId) return item;
            return {
              ...item,
              updatedAt: Date.now(),
              messages: item.messages.map((message) => (
                message.id === assistantMessageId
                  ? (() => {
                    const nextModel = normalizeMessageModelMeta(
                      snapshot?.model || message.model,
                      snapshot?.model?.id || message.modelId || chatModel,
                      chatModelOptionsRef.current
                    ) || message.model || chatModelMetaRef.current || chatModelMeta;
                    const nextModelId = String(
                      nextModel?.id
                      || resolveMessageModelId(snapshot?.model, message.modelId || chatModel)
                      || message.modelId
                      || chatModel
                      || ''
                    ).trim() || chatModel;
                    return {
                      ...message,
                      content: snapshot.content || '',
                      blocks: snapshot.blocks || [],
                      usage: snapshot?.usage ? { ...snapshot.usage } : message.usage,
                      usageSteps: Array.isArray(snapshot?.usageSteps)
                        ? snapshot.usageSteps.map((usageStep) => ({ ...usageStep }))
                        : message.usageSteps,
                      metrics: snapshot?.metrics ? { ...snapshot.metrics } : message.metrics,
                      model: nextModel,
                      modelId: nextModelId,
                      error,
                      updatedAt: Date.now()
                    };
                  })()
                  : message
              ))
            };
          });
          const sorted = sortChatSessions(updated);
          computeDurationMs = Math.round((getPerfTimestamp() - computeStart) * 100) / 100;
          return sorted;
        });
        if (perfEntry) {
          perfEntry.snapshotCount += 1;
          perfEntry.maxContentLength = Math.max(perfEntry.maxContentLength, snapshotSummary.contentLength);
          perfEntry.maxBlockCount = Math.max(perfEntry.maxBlockCount, snapshotSummary.blockCount);
          perfEntry.maxSnapshotComputeMs = Math.max(perfEntry.maxSnapshotComputeMs, computeDurationMs);
        }
      };
      const clearScheduledSnapshot = () => {
        const scheduled = chatSnapshotThrottleByRequestIdRef.current.get(throttleKey);
        if (scheduled?.timer) clearTimeout(scheduled.timer);
        chatSnapshotThrottleByRequestIdRef.current.delete(throttleKey);
      };
      const scheduleSnapshot = (error = null) => {
        if (!requestId) {
          applySnapshot(error);
          return;
        }
        const current = chatSnapshotThrottleByRequestIdRef.current.get(throttleKey) || {
          timer: null,
          lastAppliedAt: 0
        };
        const now = Date.now();
        const elapsedMs = now - current.lastAppliedAt;
        if (elapsedMs >= CHAT_SNAPSHOT_THROTTLE_MS && !current.timer) {
          chatSnapshotThrottleByRequestIdRef.current.set(throttleKey, {
            timer: null,
            lastAppliedAt: now
          });
          applySnapshot(error);
          return;
        }
        if (current.timer) return;
        const waitMs = Math.max(0, CHAT_SNAPSHOT_THROTTLE_MS - elapsedMs);
        const timer = setTimeout(() => {
          chatSnapshotThrottleByRequestIdRef.current.set(throttleKey, {
            timer: null,
            lastAppliedAt: Date.now()
          });
          applySnapshot(error);
        }, waitMs);
        chatSnapshotThrottleByRequestIdRef.current.set(throttleKey, {
          timer,
          lastAppliedAt: current.lastAppliedAt
        });
      };

        const finalizeAssistantMessage = ({ error = null, aborted = false } = {}) => {
          finalizeChatAssistantMessageLocally({
            chatId,
            assistantMessageId,
            storeAssistantMessageId
          }, {
            error,
            aborted
          });
        };

      if (payload.type === 'chunk') {
        const chunkType = String(payload?.chunk?.type || '');
        if (chunkType === 'retry-status') {
          updateChatAssistantMessage(chatId, assistantMessageId, {
            retryStatusText: String(payload?.chunk?.text || '').trim()
          });
          return;
        }

        const chunkStart = getPerfTimestamp();
        streamController?.pushChunk(payload.chunk || {});
        const pushChunkDurationMs = Math.round((getPerfTimestamp() - chunkStart) * 100) / 100;
        const isVisibleAssistantTextChunk = chunkType === 'text-start' || chunkType === 'text-delta';
        if (isVisibleAssistantTextChunk) {
          updateChatAssistantMessage(chatId, assistantMessageId, {
            retryStatusText: ''
          });
        }
        if (perfEntry) {
          perfEntry.chunkCount += 1;
          perfEntry.totalPushChunkMs += pushChunkDurationMs;
          perfEntry.maxPushChunkMs = Math.max(perfEntry.maxPushChunkMs, pushChunkDurationMs);
          perfEntry.lastChunkType = chunkType;
          if (!perfEntry.firstChunkAt) {
            perfEntry.firstChunkAt = Date.now();
            perfEntry.firstChunkPerfAt = getPerfTimestamp();
          }
        }
        if (isVisibleAssistantTextChunk && !perfEntry?.firstVisibleTextAt) {
          if (perfEntry) {
            perfEntry.firstVisibleTextAt = Date.now();
            perfEntry.firstVisibleTextPerfAt = getPerfTimestamp();
          }
          setChatSessionSending(chatId, false, `chunk.${chunkType}`);
          setChatSending(false);
        }
        if (!useRendererStoreStreaming) {
          scheduleSnapshot(null);
        }
        return;
      }

      if (payload.type === 'stream-finished') {
        clearScheduledSnapshot();
        if (!useRendererStoreStreaming) {
          applySnapshot(null);
        }
        updateChatAssistantMessage(chatId, assistantMessageId, { retryStatusText: '' });
        setChatSessionInFlight(chatId, false, 'chunk.stream-finished');
        return;
      }

      if (payload.type === 'error') {
        const errorMessage = String(payload?.error?.message || '');
        const errorCode = String(payload?.error?.code || '').trim().toUpperCase();
        if (errorCode === 'ABORTED') {
          clearScheduledSnapshot();
          streamController?.error(new DOMException('Request was aborted', 'AbortError'));
          finalizeAssistantMessage({ error: null, aborted: true });
          if (requestId) {
            chatPendingByRequestIdRef.current.delete(requestId);
          }
          updateChatAssistantMessage(chatId, assistantMessageId, { retryStatusText: '' });
          setChatSessionSending(chatId, false, 'chunk.error.aborted');
          setChatSessionInFlight(chatId, false, 'chunk.error.aborted');
          setChatSessionFulfilled(chatId, false, 'chunk.error.aborted');
          setChatSending(false);
          if (requestId) {
            const completedPerf = chatPerfByRequestIdRef.current.get(requestId);
            if (completedPerf) {
              chatPerfByRequestIdRef.current.delete(requestId);
            }
          }
          if (agentSessionId) {
            chatHistoryHydrateSettledRef.current.delete(`${chatId}:${agentSessionId}`);
            void hydratePersistedChatSessionFromHistory({
              chatId,
              sessionId: agentSessionId,
              reason: 'chunk.error.aborted'
            });
          }
          return;
        }
        if (/JWTTokenIsInvalid|invalid or expired jwt/i.test(errorMessage)) {
          if (requestId) {
            chatPendingByRequestIdRef.current.delete(requestId);
          }
          chatIdByAgentSessionIdRef.current.delete(agentSessionId);
          chatAgentSessionIdByChatIdRef.current.delete(chatId);
        }
        const normalizedError = normalizeChatError(payload?.error || new Error(payload?.error?.message || 'agent request failed'));
        clearScheduledSnapshot();
        streamController?.error(new Error(errorMessage || 'agent request failed'));
        finalizeAssistantMessage({ error: normalizedError, aborted: false });
        if (requestId) {
          chatPendingByRequestIdRef.current.delete(requestId);
        }
        updateChatAssistantMessage(chatId, assistantMessageId, { retryStatusText: '' });
        setChatSessionSending(chatId, false, 'chunk.error');
        setChatSessionInFlight(chatId, false, 'chunk.error');
        setChatSessionFulfilled(chatId, false, 'chunk.error');
        setChatSending(false);
        if (requestId) {
          const completedPerf = chatPerfByRequestIdRef.current.get(requestId);
          if (completedPerf) {
            chatPerfByRequestIdRef.current.delete(requestId);
          }
        }
        if (agentSessionId) {
          chatHistoryHydrateSettledRef.current.delete(`${chatId}:${agentSessionId}`);
          void hydratePersistedChatSessionFromHistory({
            chatId,
            sessionId: agentSessionId,
            reason: 'chunk.error'
          });
        }
        return;
      }

      if (payload.type === 'cancelled') {
        clearScheduledSnapshot();
        streamController?.error(new DOMException('Request was aborted', 'AbortError'));
        finalizeAssistantMessage({ error: null, aborted: true });
        if (requestId) {
          chatPendingByRequestIdRef.current.delete(requestId);
        }
        updateChatAssistantMessage(chatId, assistantMessageId, { retryStatusText: '' });
        setChatSessionSending(chatId, false, 'chunk.cancelled');
        setChatSessionInFlight(chatId, false, 'chunk.cancelled');
        setChatSessionFulfilled(chatId, false, 'chunk.cancelled');
        setChatSending(false);
        if (requestId) {
          const completedPerf = chatPerfByRequestIdRef.current.get(requestId);
          if (completedPerf) {
            chatPerfByRequestIdRef.current.delete(requestId);
          }
        }
        if (agentSessionId) {
          chatHistoryHydrateSettledRef.current.delete(`${chatId}:${agentSessionId}`);
          void hydratePersistedChatSessionFromHistory({
            chatId,
            sessionId: agentSessionId,
            reason: 'chunk.cancelled'
          });
        }
        return;
      }

      if (payload.type === 'complete') {
        // Cancel any delayed snapshot first so a stale processing snapshot cannot
        // overwrite the finalized assistant message after completion.
        clearScheduledSnapshot();
        const finalSnapshot = getAssistantSnapshotFromStore(storeAssistantMessageId || '');
        const finalizedBlocks = normalizeStructuredBlocksForPersistence(
          finalSnapshot?.blocks || [],
          { hasError: false }
        );
        const finalizedContent =
          finalSnapshot?.content
          || buildAssistantDisplayContentFromBlocks(finalizedBlocks)
          || '';
        setChatSessions((prev) => {
          const updated = prev.map((item) => {
            if (item.id !== chatId) return item;
            return {
              ...item,
              updatedAt: Date.now(),
              messages: item.messages.map((message) => (
                message.id === assistantMessageId
                  ? (() => {
                      const normalizedMessageBlocks = normalizeStructuredBlocksForPersistence(
                        message.blocks || [],
                        { hasError: false }
                      );
                      const nextModel = normalizeMessageModelMeta(
                        finalSnapshot?.model || message.model,
                        finalSnapshot?.model?.id || message.modelId || chatModel,
                        chatModelOptionsRef.current
                      ) || message.model || chatModelMetaRef.current || chatModelMeta;
                      const nextModelId = String(
                        nextModel?.id
                        || resolveMessageModelId(finalSnapshot?.model, message.modelId || chatModel)
                        || message.modelId
                        || chatModel
                        || ''
                      ).trim() || chatModel;
                      return {
                        ...message,
                        storeAssistantMessageId: null,
                        content: finalizedContent || message.content || '',
                        blocks: finalizedBlocks.length > 0 ? finalizedBlocks : normalizedMessageBlocks,
                        usage: finalSnapshot?.usage ? { ...finalSnapshot.usage } : message.usage,
                        usageSteps: Array.isArray(finalSnapshot?.usageSteps)
                          ? finalSnapshot.usageSteps.map((usageStep) => ({ ...usageStep }))
                          : message.usageSteps,
                        metrics: finalSnapshot?.metrics ? { ...finalSnapshot.metrics } : message.metrics,
                        model: nextModel,
                        modelId: nextModelId,
                        error: null,
                        updatedAt: Date.now()
                      };
                    })()
                  : message
              ))
            };
          });
          return sortChatSessions(updated);
        });
        finalizeLatestTodoWriteInStore(storeAssistantMessageId || '');
        streamController?.complete();
        if (requestId) {
          chatPendingByRequestIdRef.current.delete(requestId);
        }
        const deferredHydrate = chatDeferredSessionChangeHydrateRef.current.get(chatId);
        if (deferredHydrate && String(deferredHydrate?.sessionId || '').trim() === String(agentSessionId || '').trim()) {
          chatDeferredSessionChangeHydrateRef.current.delete(chatId);
          void hydratePersistedChatSessionFromHistory({
            chatId,
            sessionId: agentSessionId,
            reason: deferredHydrate.reason || 'session-changed.deferred'
          });
        }
        setChatSessionSending(chatId, false, 'chunk.complete');
        setChatSessionInFlight(chatId, false, 'chunk.complete');
        setChatSessionFulfilled(chatId, true, 'chunk.complete');
        setChatSending(false);
        if (requestId) {
          const completedPerf = chatPerfByRequestIdRef.current.get(requestId);
          if (completedPerf) {
            chatPerfByRequestIdRef.current.delete(requestId);
          }
        }
      }
    });
    return () => {
      chatSnapshotThrottleByRequestIdRef.current.forEach((entry) => {
        if (entry?.timer) clearTimeout(entry.timer);
      });
      chatSnapshotThrottleByRequestIdRef.current.clear();
      if (typeof offPermissionRequest === 'function') offPermissionRequest();
      if (typeof offPermissionResult === 'function') offPermissionResult();
      if (typeof offChunk === 'function') offChunk();
    };
  }, [canUseAgentRuntime]);

  const handleCreateChatSession = (metadata = {}) => {
    const normalizedWorkspacePath = normalizeLocalPath(metadata?.workspacePath || '').trim();
    const session = createEmptyChatSession({
      workspacePath: normalizedWorkspacePath
    });
    logger.info('[HomePage][SessionSending] create session', {
      sessionId: session.id,
      fromActiveChatId: activeChatId,
      source: String(metadata?.source || 'unknown'),
      workspacePath: normalizedWorkspacePath,
      isTrusted: metadata?.isTrusted,
      detail: metadata?.detail,
      pointerType: metadata?.pointerType || '',
      clientX: metadata?.clientX,
      clientY: metadata?.clientY,
      startupElapsedMs: metadata?.startupElapsedMs
    });
    setChatSessions((prev) => [session, ...prev]);
    setActiveChatId(session.id);
    setChatSessionSending(session.id, false, 'create-session');
    setChatSessionInFlight(session.id, false, 'create-session');
    setChatSessionFulfilled(session.id, false, 'create-session');
  };

  const prepareQuickSkillTargetSession = useCallback(async (workspaceStatusText) => {
    let inheritedWorkspacePath = getSessionWorkspacePath(activeChatSession);
    if (!inheritedWorkspacePath) {
      const runtimeSessionId = String(activeChatSession?.runtimeSessionId || '').trim();
      if (runtimeSessionId) {
        const ensuredSession = await window.electronAPI.cherryChatStream.getSession(runtimeSessionId);
        const runtimeSession = ensuredSession?.session || null;
        inheritedWorkspacePath = getSessionWorkspacePath(runtimeSession);
        if (inheritedWorkspacePath && activeChatSession?.id) {
          setChatSessions((prev) => prev.map((item) => (
            item.id === activeChatSession.id
              ? {
                ...item,
                runtimeSessionId,
                accessible_paths: Array.isArray(runtimeSession?.accessible_paths) ? runtimeSession.accessible_paths : item.accessible_paths,
                configuration: runtimeSession?.configuration && typeof runtimeSession.configuration === 'object'
                  ? runtimeSession.configuration
                  : item.configuration,
                updatedAt: Date.now()
              }
              : item
          )));
        }
      }
    }

    if (activeChatSession?.id && inheritedWorkspacePath) {
      const sessionId = activeChatSession.id;
      setChatSessionSending(sessionId, false, 'quick-bootstrap');
      setChatSessionInFlight(sessionId, false, 'quick-bootstrap');
      setChatSessionFulfilled(sessionId, false, 'quick-bootstrap');
      setChatWorkspaceStatus(sessionId, workspaceStatusText);
      return {
        session: activeChatSession,
        workspacePath: inheritedWorkspacePath,
        reusedCurrentSession: true
      };
    }

    const session = createEmptyChatSession();
    setChatSessions((prev) => [session, ...prev]);
    setActiveChatId(session.id);
    setChatSessionSending(session.id, false, 'quick-bootstrap');
    setChatSessionInFlight(session.id, false, 'quick-bootstrap');
    setChatSessionFulfilled(session.id, false, 'quick-bootstrap');
    setChatWorkspaceStatus(session.id, AUTO_WORKSPACE_STATUS_TEXT);
    return {
      session,
      workspacePath: '',
      reusedCurrentSession: false
    };
  }, [
    activeChatSession,
    setChatSessionFulfilled,
    setChatSessionInFlight,
    setChatSessionSending,
    setChatSessions,
    setChatWorkspaceStatus
  ]);

  const handleBootstrapChildrensPictureBook = useCallback(async () => {
    const target = await prepareQuickSkillTargetSession('正在准备儿童绘本技能...');
    const session = target.session;

    try {
      const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
      const quickSkillDir = resolveQuickSkillDirectory(appInfo, QUICK_CHILDRENS_PICTURE_BOOK_SKILL_NAME);
      if (!quickSkillDir) {
        throw new Error('定位儿童绘本技能目录失败');
      }

      const agentSessionId = await ensureAgentSessionForChat(session.id);
      let workspacePath = target.workspacePath;
      if (!workspacePath) {
        const workspaceParentDir = resolveDefaultWorkspaceParentDir(appInfo, DEFAULT_RUNTIME_AGENT_ID);
        if (!workspaceParentDir) {
          throw new Error('创建新工作空间失败');
        }
        workspacePath = joinLocalPath(workspaceParentDir, await buildAutoWorkspaceName(workspaceParentDir));
        await window.api.file.mkdir(workspacePath);
        await seedWorkspaceSkeleton(workspacePath);
      }

      const ensuredSession = await window.electronAPI.cherryChatStream.getSession(agentSessionId);
      const configuration = ensuredSession?.session?.configuration && typeof ensuredSession.session.configuration === 'object'
        ? ensuredSession.session.configuration
        : {};
      const updateResult = await window.electronAPI.cherryChatStream.updateSession({
        sessionId: agentSessionId,
        agent_id: DEFAULT_RUNTIME_AGENT_ID,
        accessible_paths: [workspacePath],
        configuration: {
          ...configuration,
          selected_workspace_path: workspacePath
        }
      });
      if (!updateResult?.ok || !updateResult?.session) {
        throw new Error(updateResult?.error || '绑定新工作空间失败');
      }

      const copySkillResult = await window.electronAPI.agentSkills.copyDirectoryToWorkspace({
        directoryPath: quickSkillDir,
        workspace: workspacePath
      });
      if (!copySkillResult?.success) {
        throw new Error(copySkillResult?.error || '复制技能到工作空间失败');
      }

      const workspaceStore = readWorkspaceStore();
      writeWorkspaceStore(markWorkspaceVisited(workspaceStore, workspacePath));
      setChatSessions((prev) =>
        prev.map((item) => (
          item.id === session.id
            ? {
              ...item,
              runtimeSessionId: agentSessionId,
              accessible_paths: [workspacePath],
              configuration: {
                ...(item?.configuration && typeof item.configuration === 'object' ? item.configuration : {}),
                selected_workspace_path: workspacePath
              },
              updatedAt: Date.now()
            }
            : item
        ))
      );
      window.dispatchEvent(new window.CustomEvent('childrens-book-skill-created', {
        detail: {
          workspacePath,
          sessionId: session.id
        }
      }));
      window.toast?.success?.(
        target.reusedCurrentSession
          ? '已将儿童绘本技能添加到当前工作空间'
          : '已新建对话和工作空间，并创建儿童绘本技能'
      );
    } catch (error) {
      window.toast?.error?.(error?.message || '快捷短语执行失败');
    } finally {
      setChatWorkspaceStatus(session.id, '');
    }
  }, [ensureAgentSessionForChat, prepareQuickSkillTargetSession, setChatWorkspaceStatus]);

  const handleBootstrapLiveClipping = useCallback(async () => {
    const target = await prepareQuickSkillTargetSession('正在准备直播切片技能...');
    const session = target.session;

    try {
      const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
      const quickSkillDir = resolveQuickSkillDirectory(appInfo, QUICK_LIVE_CLIPPING_SKILL_NAME);
      if (!quickSkillDir) {
        throw new Error('定位直播切片技能目录失败');
      }

      const agentSessionId = await ensureAgentSessionForChat(session.id);
      let workspacePath = target.workspacePath;
      if (!workspacePath) {
        const workspaceParentDir = resolveDefaultWorkspaceParentDir(appInfo, DEFAULT_RUNTIME_AGENT_ID);
        if (!workspaceParentDir) {
          throw new Error('创建新工作空间失败');
        }
        workspacePath = joinLocalPath(workspaceParentDir, await buildAutoWorkspaceName(workspaceParentDir));
        await window.api.file.mkdir(workspacePath);
        await seedWorkspaceSkeleton(workspacePath);
      }

      const ensuredSession = await window.electronAPI.cherryChatStream.getSession(agentSessionId);
      const configuration = ensuredSession?.session?.configuration && typeof ensuredSession.session.configuration === 'object'
        ? ensuredSession.session.configuration
        : {};
      const updateResult = await window.electronAPI.cherryChatStream.updateSession({
        sessionId: agentSessionId,
        agent_id: DEFAULT_RUNTIME_AGENT_ID,
        accessible_paths: [workspacePath],
        configuration: {
          ...configuration,
          selected_workspace_path: workspacePath
        }
      });
      if (!updateResult?.ok || !updateResult?.session) {
        throw new Error(updateResult?.error || '绑定新工作空间失败');
      }

      const copySkillResult = await window.electronAPI.agentSkills.copyDirectoryToWorkspace({
        directoryPath: quickSkillDir,
        workspace: workspacePath
      });
      if (!copySkillResult?.success) {
        throw new Error(copySkillResult?.error || '复制技能到工作空间失败');
      }

      const workspaceStore = readWorkspaceStore();
      writeWorkspaceStore(markWorkspaceVisited(workspaceStore, workspacePath));
      setChatSessions((prev) =>
        prev.map((item) => (
          item.id === session.id
            ? {
              ...item,
              runtimeSessionId: agentSessionId,
              accessible_paths: [workspacePath],
              configuration: {
                ...(item?.configuration && typeof item.configuration === 'object' ? item.configuration : {}),
                selected_workspace_path: workspacePath
              },
              updatedAt: Date.now()
            }
            : item
        ))
      );
      window.toast?.success?.(
        target.reusedCurrentSession
          ? '已将直播切片技能添加到当前工作空间'
          : '已新建对话和工作空间，并创建直播切片技能'
      );
    } catch (error) {
      window.toast?.error?.(error?.message || '快捷短语执行失败');
    } finally {
      setChatWorkspaceStatus(session.id, '');
    }
  }, [ensureAgentSessionForChat, prepareQuickSkillTargetSession, setChatWorkspaceStatus]);

  const handleBootstrapTravelGuide = useCallback(async () => {
    const target = await prepareQuickSkillTargetSession('正在准备旅游攻略技能...');
    const session = target.session;

    try {
      const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
      const quickSkillDir = resolveQuickSkillDirectory(appInfo, QUICK_TRAVEL_GUIDE_SKILL_NAME);
      if (!quickSkillDir) {
        throw new Error('定位旅游攻略技能目录失败');
      }

      const agentSessionId = await ensureAgentSessionForChat(session.id);
      let workspacePath = target.workspacePath;
      if (!workspacePath) {
        const workspaceParentDir = resolveDefaultWorkspaceParentDir(appInfo, DEFAULT_RUNTIME_AGENT_ID);
        if (!workspaceParentDir) {
          throw new Error('创建新工作空间失败');
        }
        workspacePath = joinLocalPath(workspaceParentDir, await buildAutoWorkspaceName(workspaceParentDir));
        await window.api.file.mkdir(workspacePath);
        await seedWorkspaceSkeleton(workspacePath);
      }

      const ensuredSession = await window.electronAPI.cherryChatStream.getSession(agentSessionId);
      const configuration = ensuredSession?.session?.configuration && typeof ensuredSession.session.configuration === 'object'
        ? ensuredSession.session.configuration
        : {};
      const updateResult = await window.electronAPI.cherryChatStream.updateSession({
        sessionId: agentSessionId,
        agent_id: DEFAULT_RUNTIME_AGENT_ID,
        accessible_paths: [workspacePath],
        configuration: {
          ...configuration,
          selected_workspace_path: workspacePath
        }
      });
      if (!updateResult?.ok || !updateResult?.session) {
        throw new Error(updateResult?.error || '绑定新工作空间失败');
      }

      const copySkillResult = await window.electronAPI.agentSkills.copyDirectoryToWorkspace({
        directoryPath: quickSkillDir,
        workspace: workspacePath
      });
      if (!copySkillResult?.success) {
        throw new Error(copySkillResult?.error || '复制技能到工作空间失败');
      }

      const workspaceStore = readWorkspaceStore();
      writeWorkspaceStore(markWorkspaceVisited(workspaceStore, workspacePath));
      setChatSessions((prev) =>
        prev.map((item) => (
          item.id === session.id
            ? {
              ...item,
              runtimeSessionId: agentSessionId,
              accessible_paths: [workspacePath],
              configuration: {
                ...(item?.configuration && typeof item.configuration === 'object' ? item.configuration : {}),
                selected_workspace_path: workspacePath
              },
              updatedAt: Date.now()
            }
            : item
        ))
      );
      window.toast?.success?.(
        target.reusedCurrentSession
          ? '已将旅游攻略技能添加到当前工作空间'
          : '已新建对话和工作空间，并创建旅游攻略技能'
      );
    } catch (error) {
      window.toast?.error?.(error?.message || '快捷短语执行失败');
    } finally {
      setChatWorkspaceStatus(session.id, '');
    }
  }, [ensureAgentSessionForChat, prepareQuickSkillTargetSession, setChatWorkspaceStatus]);

  const handleBootstrapTrendyKoubo = useCallback(async () => {
    const target = await prepareQuickSkillTargetSession('正在准备网感口播技能...');
    const session = target.session;

    try {
      const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
      const quickSkillDir = resolveQuickSkillDirectory(appInfo, QUICK_TRENDY_KOUBO_SKILL_NAME);
      if (!quickSkillDir) {
        throw new Error('定位网感口播技能目录失败');
      }

      const agentSessionId = await ensureAgentSessionForChat(session.id);
      let workspacePath = target.workspacePath;
      if (!workspacePath) {
        const workspaceParentDir = resolveDefaultWorkspaceParentDir(appInfo, DEFAULT_RUNTIME_AGENT_ID);
        if (!workspaceParentDir) {
          throw new Error('创建新工作空间失败');
        }
        workspacePath = joinLocalPath(workspaceParentDir, await buildAutoWorkspaceName(workspaceParentDir));
        await window.api.file.mkdir(workspacePath);
        await seedWorkspaceSkeleton(workspacePath);
      }

      const ensuredSession = await window.electronAPI.cherryChatStream.getSession(agentSessionId);
      const configuration = ensuredSession?.session?.configuration && typeof ensuredSession.session.configuration === 'object'
        ? ensuredSession.session.configuration
        : {};
      const updateResult = await window.electronAPI.cherryChatStream.updateSession({
        sessionId: agentSessionId,
        agent_id: DEFAULT_RUNTIME_AGENT_ID,
        accessible_paths: [workspacePath],
        configuration: {
          ...configuration,
          selected_workspace_path: workspacePath
        }
      });
      if (!updateResult?.ok || !updateResult?.session) {
        throw new Error(updateResult?.error || '绑定新工作空间失败');
      }

      const copySkillResult = await window.electronAPI.agentSkills.copyDirectoryToWorkspace({
        directoryPath: quickSkillDir,
        workspace: workspacePath
      });
      if (!copySkillResult?.success) {
        throw new Error(copySkillResult?.error || '复制技能到工作空间失败');
      }

      const workspaceStore = readWorkspaceStore();
      writeWorkspaceStore(markWorkspaceVisited(workspaceStore, workspacePath));
      setChatSessions((prev) =>
        prev.map((item) => (
          item.id === session.id
            ? {
              ...item,
              runtimeSessionId: agentSessionId,
              accessible_paths: [workspacePath],
              configuration: {
                ...(item?.configuration && typeof item.configuration === 'object' ? item.configuration : {}),
                selected_workspace_path: workspacePath
              },
              updatedAt: Date.now()
            }
            : item
        ))
      );
      window.toast?.success?.(
        target.reusedCurrentSession
          ? '已将网感口播技能添加到当前工作空间'
          : '已新建对话和工作空间，并创建网感口播技能'
      );
    } catch (error) {
      window.toast?.error?.(error?.message || '快捷短语执行失败');
    } finally {
      setChatWorkspaceStatus(session.id, '');
    }
  }, [ensureAgentSessionForChat, prepareQuickSkillTargetSession, setChatWorkspaceStatus]);

  const handleBootstrapSweaterSelling = useCallback(async () => {
    const target = await prepareQuickSkillTargetSession('正在准备毛衣带货口播技能...');
    const session = target.session;

    try {
      const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
      const quickSkillDir = resolveQuickSkillDirectory(appInfo, QUICK_SWEATER_SELLING_SKILL_NAME);
      if (!quickSkillDir) {
        throw new Error('定位毛衣带货口播技能目录失败');
      }

      const agentSessionId = await ensureAgentSessionForChat(session.id);
      let workspacePath = target.workspacePath;
      if (!workspacePath) {
        const workspaceParentDir = resolveDefaultWorkspaceParentDir(appInfo, DEFAULT_RUNTIME_AGENT_ID);
        if (!workspaceParentDir) {
          throw new Error('创建新工作空间失败');
        }
        workspacePath = joinLocalPath(workspaceParentDir, await buildAutoWorkspaceName(workspaceParentDir));
        await window.api.file.mkdir(workspacePath);
        await seedWorkspaceSkeleton(workspacePath);
      }

      const ensuredSession = await window.electronAPI.cherryChatStream.getSession(agentSessionId);
      const configuration = ensuredSession?.session?.configuration && typeof ensuredSession.session.configuration === 'object'
        ? ensuredSession.session.configuration
        : {};
      const updateResult = await window.electronAPI.cherryChatStream.updateSession({
        sessionId: agentSessionId,
        agent_id: DEFAULT_RUNTIME_AGENT_ID,
        accessible_paths: [workspacePath],
        configuration: {
          ...configuration,
          selected_workspace_path: workspacePath
        }
      });
      if (!updateResult?.ok || !updateResult?.session) {
        throw new Error(updateResult?.error || '绑定新工作空间失败');
      }

      const copySkillResult = await window.electronAPI.agentSkills.copyDirectoryToWorkspace({
        directoryPath: quickSkillDir,
        workspace: workspacePath
      });
      if (!copySkillResult?.success) {
        throw new Error(copySkillResult?.error || '复制技能到工作空间失败');
      }

      const workspaceStore = readWorkspaceStore();
      writeWorkspaceStore(markWorkspaceVisited(workspaceStore, workspacePath));
      setChatSessions((prev) =>
        prev.map((item) => (
          item.id === session.id
            ? {
              ...item,
              runtimeSessionId: agentSessionId,
              accessible_paths: [workspacePath],
              configuration: {
                ...(item?.configuration && typeof item.configuration === 'object' ? item.configuration : {}),
                selected_workspace_path: workspacePath
              },
              updatedAt: Date.now()
            }
            : item
        ))
      );
      window.toast?.success?.(
        target.reusedCurrentSession
          ? '已将毛衣带货口播技能添加到当前工作空间'
          : '已新建对话和工作空间，并创建毛衣带货口播技能'
      );
    } catch (error) {
      window.toast?.error?.(error?.message || '快捷短语执行失败');
    } finally {
      setChatWorkspaceStatus(session.id, '');
    }
  }, [ensureAgentSessionForChat, prepareQuickSkillTargetSession, setChatWorkspaceStatus]);

  const handleBootstrapConvenienceStoreTour = useCallback(async () => {
    const target = await prepareQuickSkillTargetSession('正在准备便利店探店技能...');
    const session = target.session;

    try {
      const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
      const quickSkillDir = resolveQuickSkillDirectory(appInfo, QUICK_CONVENIENCE_STORE_TOUR_SKILL_NAME);
      if (!quickSkillDir) {
        throw new Error('定位便利店探店技能目录失败');
      }

      const agentSessionId = await ensureAgentSessionForChat(session.id);
      let workspacePath = target.workspacePath;
      if (!workspacePath) {
        const workspaceParentDir = resolveDefaultWorkspaceParentDir(appInfo, DEFAULT_RUNTIME_AGENT_ID);
        if (!workspaceParentDir) {
          throw new Error('创建新工作空间失败');
        }
        workspacePath = joinLocalPath(workspaceParentDir, await buildAutoWorkspaceName(workspaceParentDir));
        await window.api.file.mkdir(workspacePath);
        await seedWorkspaceSkeleton(workspacePath);
      }

      const ensuredSession = await window.electronAPI.cherryChatStream.getSession(agentSessionId);
      const configuration = ensuredSession?.session?.configuration && typeof ensuredSession.session.configuration === 'object'
        ? ensuredSession.session.configuration
        : {};
      const updateResult = await window.electronAPI.cherryChatStream.updateSession({
        sessionId: agentSessionId,
        agent_id: DEFAULT_RUNTIME_AGENT_ID,
        accessible_paths: [workspacePath],
        configuration: {
          ...configuration,
          selected_workspace_path: workspacePath
        }
      });
      if (!updateResult?.ok || !updateResult?.session) {
        throw new Error(updateResult?.error || '绑定新工作空间失败');
      }

      const copySkillResult = await window.electronAPI.agentSkills.copyDirectoryToWorkspace({
        directoryPath: quickSkillDir,
        workspace: workspacePath
      });
      if (!copySkillResult?.success) {
        throw new Error(copySkillResult?.error || '复制技能到工作空间失败');
      }

      const workspaceStore = readWorkspaceStore();
      writeWorkspaceStore(markWorkspaceVisited(workspaceStore, workspacePath));
      setChatSessions((prev) =>
        prev.map((item) => (
          item.id === session.id
            ? {
              ...item,
              runtimeSessionId: agentSessionId,
              accessible_paths: [workspacePath],
              configuration: {
                ...(item?.configuration && typeof item.configuration === 'object' ? item.configuration : {}),
                selected_workspace_path: workspacePath
              },
              updatedAt: Date.now()
            }
            : item
        ))
      );
      window.toast?.success?.(
        target.reusedCurrentSession
          ? '已将便利店探店技能添加到当前工作空间'
          : '已新建对话和工作空间，并创建便利店探店技能'
      );
    } catch (error) {
      window.toast?.error?.(error?.message || '快捷短语执行失败');
    } finally {
      setChatWorkspaceStatus(session.id, '');
    }
  }, [ensureAgentSessionForChat, prepareQuickSkillTargetSession, setChatWorkspaceStatus]);

  const handleBootstrapEducationKnowledge = useCallback(async () => {
    const target = await prepareQuickSkillTargetSession('正在准备教育知识讲解技能...');
    const session = target.session;

    try {
      const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
      const quickSkillDir = resolveQuickSkillDirectory(appInfo, QUICK_EDUCATION_KNOWLEDGE_SKILL_NAME);
      if (!quickSkillDir) {
        throw new Error('定位教育知识讲解技能目录失败');
      }

      const agentSessionId = await ensureAgentSessionForChat(session.id);
      let workspacePath = target.workspacePath;
      if (!workspacePath) {
        const workspaceParentDir = resolveDefaultWorkspaceParentDir(appInfo, DEFAULT_RUNTIME_AGENT_ID);
        if (!workspaceParentDir) {
          throw new Error('创建新工作空间失败');
        }
        workspacePath = joinLocalPath(workspaceParentDir, await buildAutoWorkspaceName(workspaceParentDir));
        await window.api.file.mkdir(workspacePath);
        await seedWorkspaceSkeleton(workspacePath);
      }

      const ensuredSession = await window.electronAPI.cherryChatStream.getSession(agentSessionId);
      const configuration = ensuredSession?.session?.configuration && typeof ensuredSession.session.configuration === 'object'
        ? ensuredSession.session.configuration
        : {};
      const updateResult = await window.electronAPI.cherryChatStream.updateSession({
        sessionId: agentSessionId,
        agent_id: DEFAULT_RUNTIME_AGENT_ID,
        accessible_paths: [workspacePath],
        configuration: {
          ...configuration,
          selected_workspace_path: workspacePath
        }
      });
      if (!updateResult?.ok || !updateResult?.session) {
        throw new Error(updateResult?.error || '绑定新工作空间失败');
      }

      const copySkillResult = await window.electronAPI.agentSkills.copyDirectoryToWorkspace({
        directoryPath: quickSkillDir,
        workspace: workspacePath
      });
      if (!copySkillResult?.success) {
        throw new Error(copySkillResult?.error || '复制技能到工作空间失败');
      }

      const workspaceStore = readWorkspaceStore();
      writeWorkspaceStore(markWorkspaceVisited(workspaceStore, workspacePath));
      setChatSessions((prev) =>
        prev.map((item) => (
          item.id === session.id
            ? {
              ...item,
              runtimeSessionId: agentSessionId,
              accessible_paths: [workspacePath],
              configuration: {
                ...(item?.configuration && typeof item.configuration === 'object' ? item.configuration : {}),
                selected_workspace_path: workspacePath
              },
              updatedAt: Date.now()
            }
            : item
        ))
      );
      window.toast?.success?.(
        target.reusedCurrentSession
          ? '已将教育知识讲解技能添加到当前工作空间'
          : '已新建对话和工作空间，并创建教育知识讲解技能'
      );
    } catch (error) {
      window.toast?.error?.(error?.message || '快捷短语执行失败');
    } finally {
      setChatWorkspaceStatus(session.id, '');
    }
  }, [ensureAgentSessionForChat, prepareQuickSkillTargetSession, setChatWorkspaceStatus]);

  const handleSelectChatSession = (sessionId) => {
    setActiveChatId(sessionId);
    setChatSessionFulfilled(sessionId, false, 'select-session');
  };

  const deleteChatSessionsByIds = (sessionIds = []) => {
    const normalizedSessionIds = Array.from(new Set(
      (Array.isArray(sessionIds) ? sessionIds : []).map((sessionId) => String(sessionId || '').trim()).filter(Boolean)
    ));
    if (normalizedSessionIds.length === 0) return;

    const sessionIdSet = new Set(normalizedSessionIds);
    const runtimeSessionIds = normalizedSessionIds.map((sessionId) => String(
      chatSessionsRef.current.find((item) => item.id === sessionId)?.runtimeSessionId || ''
    ).trim()).filter(Boolean);

    normalizedSessionIds.forEach((sessionId) => {
      const timer = chatTitleRevealTimersRef.current.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        chatTitleRevealTimersRef.current.delete(sessionId);
      }
      removeChatHistoryLoading(sessionId);
      removeChatSessionSending(sessionId);
      removeChatSessionInFlight(sessionId);
      removeChatSessionFulfilled(sessionId);
      chatAgentSessionIdByChatIdRef.current.delete(sessionId);
      chatEnsuringAgentSessionByChatIdRef.current.delete(sessionId);
      chatHistoryHydratingRef.current.delete(sessionId);
      chatHistoryHydrateSettledRef.current.delete(sessionId);
      chatWorkspaceMetaHydratingRef.current.delete(sessionId);
      chatWorkspaceHydrationSuppressedRef.current.delete(sessionId);
      chatDeferredSessionChangeHydrateRef.current.delete(sessionId);
    });

    setChatTitleRenamingSessionIds((prev) => prev.filter((id) => !sessionIdSet.has(id)));
    setChatTitleNewlyRenamedSessionIds((prev) => prev.filter((id) => !sessionIdSet.has(id)));
    setChatWorkspaceStatusMap((prev) => {
      const next = { ...prev };
      let changed = false;
      normalizedSessionIds.forEach((sessionId) => {
        if (sessionId in next) {
          delete next[sessionId];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    runtimeSessionIds.forEach((runtimeSessionId) => {
      chatIdByAgentSessionIdRef.current.delete(runtimeSessionId);
      if (canUseAgentRuntime) {
        void window.electronAPI.cherryChatStream.unsubscribe(runtimeSessionId);
      }
    });

    setChatSessions((prev) => {
      const remaining = prev.filter((item) => !sessionIdSet.has(String(item?.id || '').trim()));
      if (remaining.length === 0) {
        const next = createEmptyChatSession();
        setActiveChatId(next.id);
        return [next];
      }
      if (sessionIdSet.has(String(activeChatId || '').trim())) {
        setActiveChatId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleDeleteChatSession = (sessionId) => {
    deleteChatSessionsByIds([sessionId]);
  };

  const handleDeleteWorkspace = async (workspacePath) => {
    const normalizedWorkspacePath = normalizeLocalPath(workspacePath).trim();
    if (!normalizedWorkspacePath) return;

    const activeWorkspacePath = getSessionWorkspacePath(activeChatSession);
    if (normalizeLocalPath(activeWorkspacePath).trim() === normalizedWorkspacePath) {
      window.toast?.warning?.('当前对话正在使用该工作空间，无法删除');
      return;
    }

    const workspaceName = normalizedWorkspacePath.split('/').filter(Boolean).pop() || normalizedWorkspacePath;
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
      const workspaceStore = readWorkspaceStore();
      writeWorkspaceStore(removeWorkspacePathFromStore(workspaceStore, normalizedWorkspacePath));
      const affectedChatIds = chatSessionsRef.current
        .filter((session) => normalizeLocalPath(getSessionWorkspacePath(session)).trim() === normalizedWorkspacePath)
        .map((session) => String(session?.id || '').trim())
        .filter(Boolean);
      deleteChatSessionsByIds(affectedChatIds);
      window.toast?.success?.('工作空间已删除');
    } catch (error) {
      window.toast?.error?.(error?.message || '删除工作空间失败');
    }
  };

  const handleRenameActiveChatTitle = (nextTitle) => {
    const normalized = String(nextTitle || '').trim() || DEFAULT_CHAT_TITLE;
    if (!activeChatId) return;
    const timer = chatTitleRevealTimersRef.current.get(activeChatId);
    if (timer) {
      clearTimeout(timer);
      chatTitleRevealTimersRef.current.delete(activeChatId);
    }
    setChatTitleRenamingSessionIds((prev) => prev.filter((id) => id !== activeChatId));
    setChatTitleNewlyRenamedSessionIds((prev) => prev.filter((id) => id !== activeChatId));
    setChatSessions((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== activeChatId) return item;
        if ((item.title || '').trim() === normalized) return item;
        return {
          ...item,
          title: normalized,
          titleAutoGenerated: false,
          updatedAt: Date.now(),
        };
      });
      return sortChatSessions(updated);
    });
  };

  const applyImmediateChatTitleFromFirstUserMessage = useCallback((chatId, userMessageText = '') => {
    const id = String(chatId || '').trim();
    const nextTitle = buildImmediateChatTitleFromUserMessage(userMessageText);
    if (!id || !nextTitle) return;

    setChatSessions((prev) => {
      let updated = false;
      const next = prev.map((item) => {
        if (item.id !== id) return item;

        const currentTitle = String(item.title || '').trim();
        const userMessageCount = (Array.isArray(item.messages) ? item.messages : []).filter((message) => (
          message?.role === 'user' && String(message?.content || '').trim()
        )).length;
        const canReplaceCurrentTitle =
          !currentTitle
          || currentTitle === DEFAULT_CHAT_TITLE
          || item.titleAutoGenerated === true;

        if (userMessageCount > 0 || !canReplaceCurrentTitle || currentTitle === nextTitle) {
          return item;
        }

        updated = true;
        return {
          ...item,
          title: nextTitle,
          titleAutoGenerated: true,
          updatedAt: Date.now(),
        };
      });
      return updated ? sortChatSessions(next) : prev;
    });
  }, []);

  const handleSendChatMessage = async (inputText, options = {}) => {
    let text = String(inputText || '').trim();
    const images = Array.isArray(options?.images)
      ? options.images.filter((item) => (
        item
        && typeof item === 'object'
        && typeof item.data === 'string'
        && typeof item.media_type === 'string'
      ))
      : [];
    let imageAttachmentPreviews = Array.isArray(options?.imageAttachmentPreviews)
      ? options.imageAttachmentPreviews.filter((item) => (
        item
        && typeof item === 'object'
        && typeof item.name === 'string'
        && typeof item.fileType === 'string'
        && (
          typeof item.url === 'string'
          || typeof item.previewUrl === 'string'
          || typeof item.thumbnailUrl === 'string'
        )
      ))
      : [];
    const pendingLocalAttachments = Array.isArray(options?.pendingLocalAttachments)
      ? options.pendingLocalAttachments.filter((item) => (
        item
        && typeof item === 'object'
        && typeof item.uid === 'string'
        && typeof item.name === 'string'
        && item.file
        && typeof item.file.arrayBuffer === 'function'
      ))
      : [];
    if (!text) return;

    let targetSessionId = activeChatId;
    if (!targetSessionId) {
      const recoveredSession = recoverTimedOutChatBeforeAutoCreate({ source: 'send-without-active-chat' });
      if (recoveredSession?.id) {
        targetSessionId = recoveredSession.id;
      } else {
        const created = createEmptyChatSession();
        targetSessionId = created.id;
        setChatSessions((prev) => [created, ...prev]);
        setActiveChatId(created.id);
      }
    }
    if (isChatSessionSending(targetSessionId)) {
      logger.warn('[HomePage][SessionSending] blocked send by session sending', {
        targetSessionId,
        activeChatId,
        sessionSendingMap: chatSessionSendingMap
      });
      return;
    }

    const existingSession = chatSessionsRef.current.find((item) => item.id === targetSessionId);
    const existingUserMessageCount = (Array.isArray(existingSession?.messages) ? existingSession.messages : []).filter((message) => (
      message?.role === 'user' && String(message?.content || '').trim()
    )).length;
    const shouldRequestTitleFromFirstUserMessage = existingUserMessageCount === 0;

    applyImmediateChatTitleFromFirstUserMessage(targetSessionId, text);

    if (!canUseAgentRuntime) {
      const normalizedError = normalizeChatError(new Error('agent runtime unavailable'));
      const assistantMessageId = createMessageId();
      const userMessage = {
        id: createMessageId(),
        role: 'user',
        content: text,
        imageAttachments: imageAttachmentPreviews,
        createdAt: Date.now(),
      };
      const assistantMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        blocks: [],
        createdAt: Date.now(),
        model: chatModelMeta,
        modelId: chatModel,
        storeAssistantMessageId: null,
        retryStatusText: '',
        error: normalizedError,
      };
      setChatSessions((prev) => {
        const updated = prev.map((item) => {
          if (item.id !== targetSessionId) return item;
          return {
            ...item,
            updatedAt: Date.now(),
            messages: [...item.messages, userMessage, assistantMessage],
          };
        });
        return sortChatSessions(updated);
      });
      if (shouldRequestTitleFromFirstUserMessage) {
        void triggerAutoRenameSessionTitle(targetSessionId, {
          messagesOverride: [userMessage],
          modelOverride: chatModel,
          requireFirstUserMessageOnly: true
        });
      }
      return;
    }

    const requestId = createRequestId();
    const assistantMessageId = createMessageId();
    let userMessage = null;
    try {
      setChatSessionSending(targetSessionId, true, 'send-start');
      setChatSessionInFlight(targetSessionId, true, 'send-start');
      setChatSessionFulfilled(targetSessionId, false, 'send-start');
      setChatSending(true);
      userMessage = {
        id: createMessageId(),
        role: 'user',
        content: text,
        imageAttachments: imageAttachmentPreviews,
        createdAt: Date.now(),
      };
      const assistantMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        blocks: [],
        createdAt: Date.now(),
        model: chatModelMeta,
        modelId: chatModel,
        storeAssistantMessageId: null,
        retryStatusText: '',
      };
      setChatSessions((prev) => {
        const updated = prev.map((item) => {
          if (item.id !== targetSessionId) return item;
          return {
            ...item,
            updatedAt: Date.now(),
            messages: [...item.messages, userMessage, assistantMessage],
          };
        });
        return sortChatSessions(updated);
      });
      if (shouldRequestTitleFromFirstUserMessage) {
        void triggerAutoRenameSessionTitle(targetSessionId, {
          messagesOverride: [userMessage],
          modelOverride: chatModel,
          requireFirstUserMessageOnly: true
        });
      }

      const agentSessionId = await ensureAgentSessionForChat(targetSessionId);
      const ensuredSession = await window.electronAPI.cherryChatStream.getSession(agentSessionId);
      let runtimeSession = ensuredSession?.session || null;
      if (!getSessionWorkspacePath(runtimeSession)) {
        setChatWorkspaceStatus(targetSessionId, AUTO_WORKSPACE_STATUS_TEXT);
        updateChatAssistantMessage(targetSessionId, assistantMessageId, {
          content: AUTO_WORKSPACE_STATUS_TEXT
        });
        try {
          const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
          const workspaceParentDir = resolveDefaultWorkspaceParentDir(appInfo, DEFAULT_RUNTIME_AGENT_ID);
          if (!workspaceParentDir) {
            throw new Error('创建默认工作空间失败');
          }
          const workspacePath = joinLocalPath(workspaceParentDir, await buildAutoWorkspaceName(workspaceParentDir));
          await window.api.file.mkdir(workspacePath);
          await seedWorkspaceSkeleton(workspacePath);

          const configuration = runtimeSession?.configuration && typeof runtimeSession.configuration === 'object'
            ? runtimeSession.configuration
            : {};
          const updateResult = await window.electronAPI.cherryChatStream.updateSession({
            sessionId: agentSessionId,
            agent_id: DEFAULT_RUNTIME_AGENT_ID,
            accessible_paths: [workspacePath],
            configuration: {
              ...configuration,
              selected_workspace_path: workspacePath
            }
          });
          if (!updateResult?.ok || !updateResult?.session) {
            throw new Error(updateResult?.error || '创建默认工作空间失败');
          }

          const workspaceStore = readWorkspaceStore();
          writeWorkspaceStore(markWorkspaceVisited(workspaceStore, workspacePath));
          runtimeSession = updateResult.session;
        } finally {
          setChatWorkspaceStatus(targetSessionId, '');
        }
      }

      if (pendingLocalAttachments.length > 0) {
        const persistedPendingAttachments = await persistPendingChatLocalAttachments({
          workspacePath: getSessionWorkspacePath(runtimeSession),
          imageAttachmentPreviews,
          pendingLocalAttachments,
        });
        imageAttachmentPreviews = persistedPendingAttachments.imageAttachmentPreviews;
        text = persistedPendingAttachments.replaceContentPlaceholders(text);
        updateChatMessage(targetSessionId, userMessage.id, {
          content: text,
          imageAttachments: imageAttachmentPreviews,
        });
      }

      syncLegacyUserMessageToRendererStore({
        topicId: `home-chat-${targetSessionId}`,
        assistantId: DEFAULT_RUNTIME_AGENT_ID,
        userMessage,
        images,
      });

      const streamController = setupChannelStream(
        appStore.dispatch,
        appStore.getState,
        `home-chat-${targetSessionId}`,
        DEFAULT_RUNTIME_AGENT_ID,
        chatModel,
        userMessage.id
      );
      updateChatAssistantMessage(targetSessionId, assistantMessageId, {
        storeAssistantMessageId: streamController.assistantMessageId
      });
      chatPendingByRequestIdRef.current.set(requestId, {
        chatId: targetSessionId,
        agentSessionId,
        assistantMessageId,
        storeAssistantMessageId: streamController.assistantMessageId,
        streamController
      });
      chatPerfByRequestIdRef.current.set(requestId, {
        requestId,
        chatId: targetSessionId,
        agentSessionId,
        assistantMessageId,
        createdAt: Date.now(),
        createdPerfAt: getPerfTimestamp(),
        startedAt: null,
        startedPerfAt: null,
        firstChunkAt: null,
        firstChunkPerfAt: null,
        firstVisibleTextAt: null,
        firstVisibleTextPerfAt: null,
        chunkCount: 0,
        snapshotCount: 0,
        totalPushChunkMs: 0,
        maxPushChunkMs: 0,
        maxSnapshotComputeMs: 0,
        maxContentLength: 0,
        maxBlockCount: 0,
        lastChunkType: ''
      });
      const result = await window.electronAPI.cherryChatStream.createMessage({
        sessionId: agentSessionId,
        content: text,
        createdAt: userMessage.createdAt,
        requestId,
        model: chatModel,
        images
      });
      logger.info('[HomePage] cherryChatStream createMessage result', {
        chatId: targetSessionId,
        sessionId: agentSessionId,
        requestId,
        ok: Boolean(result?.ok),
        error: result?.error || '',
        model: chatModel
      });
      if (!result?.ok) {
        throw new Error(result?.error || 'agent createMessage failed');
      }
    } catch (error) {
      const normalizedError = normalizeChatError(error);
      logger.error('Chat send failed', normalizedError?.detail || error?.message || String(error));
      chatPendingByRequestIdRef.current.delete(requestId);
      const failedPerf = chatPerfByRequestIdRef.current.get(requestId);
      if (failedPerf) {
        const totalDurationMs = failedPerf.createdPerfAt
          ? Math.round((getPerfTimestamp() - failedPerf.createdPerfAt) * 100) / 100
          : null;
        logger.warn('[HomePage][Perf] request failed before completion', {
          requestId,
          chatId: targetSessionId,
          sessionId: failedPerf.agentSessionId || '',
          totalDurationMs,
          chunkCount: failedPerf.chunkCount,
          snapshotCount: failedPerf.snapshotCount,
          maxContentLength: failedPerf.maxContentLength,
          maxBlockCount: failedPerf.maxBlockCount,
          maxPushChunkMs: failedPerf.maxPushChunkMs,
          maxSnapshotComputeMs: failedPerf.maxSnapshotComputeMs,
          lastChunkType: failedPerf.lastChunkType
        });
        chatPerfByRequestIdRef.current.delete(requestId);
      }
      setChatWorkspaceStatus(targetSessionId, '');
      setChatSessionSending(targetSessionId, false, 'send-catch');
      setChatSessionInFlight(targetSessionId, false, 'send-catch');
      if (!userMessage) {
        const failedUserMessage = {
          id: createMessageId(),
          role: 'user',
          content: text,
          imageAttachments: imageAttachmentPreviews,
          createdAt: Date.now(),
        };
        const failedAssistantMessage = {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          blocks: [],
          createdAt: Date.now(),
          model: chatModelMeta,
          modelId: chatModel,
          storeAssistantMessageId: null,
          retryStatusText: '',
          error: normalizedError,
        };
        setChatSessions((prev) => {
          const updated = prev.map((item) => {
            if (item.id !== targetSessionId) return item;
            return {
              ...item,
              updatedAt: Date.now(),
              messages: [...item.messages, failedUserMessage, failedAssistantMessage],
            };
          });
          return sortChatSessions(updated);
        });
      } else {
        updateChatAssistantMessage(targetSessionId, assistantMessageId, { error: normalizedError });
      }
      setChatSending(false);
    }
  };

  const handleStopChatMessage = () => {
    if (canUseAgentRuntime) {
      const pendingEntries = [...chatPendingByRequestIdRef.current.entries()];
      const active = pendingEntries.find(([, item]) => item.chatId === activeChatId) || pendingEntries[0];
      if (active && active[1]?.agentSessionId) {
          finalizeChatAssistantMessageLocally({
            chatId: active[1].chatId,
            assistantMessageId: active[1].assistantMessageId,
            storeAssistantMessageId: active[1].storeAssistantMessageId
          }, {
            error: null,
            aborted: true
          });
        void window.electronAPI.cherryChatStream.abort(active[1].agentSessionId);
        return;
      }
    }
  };

  const handleCopyAssistantMessage = async (message) => {
    const text = String(message?.content || '').trim();
    if (!text) {
      throw new Error('empty message');
    }
    await navigator.clipboard.writeText(text);
  };

  const handleDeleteAssistantMessage = (message) => {
    const messageId = message?.id;
    if (!messageId || !activeChatId) return;
    setChatSessions((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== activeChatId) return item;
        return {
          ...item,
          updatedAt: Date.now(),
          messages: item.messages.filter((msg) => msg.id !== messageId),
        };
      });
      return sortChatSessions(updated);
    });
  };

  const handleOpenChatWebPreview = useCallback((preview) => {
    const normalizedKey = String(preview?.key || '').trim();
    const normalizedUrl = String(preview?.url || '').trim();
    if (!normalizedKey || !normalizedUrl) return;

    if (chatWebPreview?.key) {
      setChatWebPreviewDismissedKey(String(chatWebPreview.key));
    }
    setManualChatWebPreview(preview);
  }, [chatWebPreview]);

  const handleCloseChatWebPreview = useCallback(() => {
    if (manualChatWebPreview) {
      setManualChatWebPreview(null);
      return;
    }

    const previewKey = String(chatWebPreview?.key || '').trim();
    if (previewKey) {
      setChatWebPreviewDismissedKey(previewKey);
    }
    setChatWebPreview(null);
  }, [chatWebPreview?.key, manualChatWebPreview]);

  const handleRetryAssistantMessage = async (message) => {
    if (!activeChatId || !canUseAgentRuntime || isChatSessionSending(activeChatId)) return;
    const messageId = message?.id;
    if (!messageId) return;
    const session = chatSessions.find((item) => item.id === activeChatId);
    if (!session || !Array.isArray(session.messages)) return;
    const targetIndex = session.messages.findIndex((item) => item.id === messageId && item.role === 'assistant');
    if (targetIndex < 0) return;
    const prevUser = [...session.messages.slice(0, targetIndex)].reverse().find((item) => item.role === 'user');
    if (!prevUser?.content) return;

    setChatSessions((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== activeChatId) return item;
        return {
          ...item,
          updatedAt: Date.now(),
          messages: item.messages.map((msg) => (
            msg.id === messageId
              ? {
                ...msg,
                content: '',
                blocks: [],
                error: null,
                updatedAt: Date.now(),
                model: chatModelMeta,
                modelId: chatModel
              }
              : msg
          )),
        };
      });
      return sortChatSessions(updated);
    });

    setChatSessionSending(activeChatId, true, 'retry-start');
    setChatSessionInFlight(activeChatId, true, 'retry-start');
    setChatSessionFulfilled(activeChatId, false, 'retry-start');
    setChatSending(true);
    const requestId = createRequestId();
    try {
      const agentSessionId = await ensureAgentSessionForChat(activeChatId);
      syncLegacyUserMessageToRendererStore({
        topicId: `home-chat-${activeChatId}`,
        assistantId: DEFAULT_RUNTIME_AGENT_ID,
        userMessage: prevUser,
        images: Array.isArray(prevUser.imageAttachments)
          ? prevUser.imageAttachments
              .filter((item) => typeof item?.data === 'string' && typeof item?.media_type === 'string')
              .map((item) => ({ data: item.data, media_type: item.media_type }))
          : [],
      });
      const streamController = setupChannelStream(
        appStore.dispatch,
        appStore.getState,
        `home-chat-${activeChatId}`,
        DEFAULT_RUNTIME_AGENT_ID,
        chatModel,
        prevUser.id
      );
      setChatSessions((prev) => {
        const updated = prev.map((item) => {
          if (item.id !== activeChatId) return item;
          return {
            ...item,
            updatedAt: Date.now(),
            messages: item.messages.map((msg) => (
              msg.id === messageId
                ? {
                  ...msg,
                  storeAssistantMessageId: streamController.assistantMessageId,
                  model: msg.model || chatModelMeta,
                  modelId: msg.modelId || chatModel,
                  updatedAt: Date.now()
                }
                : msg
            ))
          };
        });
        return sortChatSessions(updated);
      });
      chatPendingByRequestIdRef.current.set(requestId, {
        chatId: activeChatId,
        agentSessionId,
        assistantMessageId: messageId,
        storeAssistantMessageId: streamController.assistantMessageId,
        streamController
      });
      const result = await window.electronAPI.cherryChatStream.createMessage({
        sessionId: agentSessionId,
        content: String(prevUser.content || ''),
        createdAt: Number(prevUser.createdAt) || undefined,
        requestId,
        model: chatModel
      });
      if (!result?.ok) throw new Error(result?.error || 'agent retry failed');
    } catch (error) {
      chatPendingByRequestIdRef.current.delete(requestId);
      const normalizedError = normalizeChatError(error);
      setChatSessions((prev) => {
        const updated = prev.map((item) => {
          if (item.id !== activeChatId) return item;
          return {
            ...item,
            updatedAt: Date.now(),
            messages: item.messages.map((msg) => (
              msg.id === messageId
                ? {
                  ...msg,
                  error: normalizedError,
                  updatedAt: Date.now(),
                  model: msg.model || chatModelMeta,
                  modelId: msg.modelId || chatModel
                }
                : msg
            )),
          };
        });
        return sortChatSessions(updated);
      });
      setChatSessionSending(activeChatId, false, 'retry-catch');
      setChatSessionInFlight(activeChatId, false, 'retry-catch');
      setChatSending(false);
    }
  };

  // 订阅当前下载任务的文件列表，映射为 DownloadList 所需的 project
  useEffect(() => {
    const unsubscribe = DownloadController.subscribeFileList(({ draft_id, draft_name, jobId, status, progress, message, fileList }) => {
      const active = Array.isArray(fileList) ? fileList.filter(f => f.status !== 'completed') : [];
      const totalDownloaded = active.reduce((sum, f) => sum + (Number(f.downloaded) || 0), 0);
      const totalTotal = active.reduce((sum, f) => sum + (Number(f.total) || 0), 0);
      const overallProgress = totalTotal > 0 ? Math.round((totalDownloaded / totalTotal) * 100) : Math.round(progress || 0);
      const normalizedStatus = status || 'downloading';
      const overallStatusText = message || (normalizedStatus === 'paused' ? '已暂停' : `已下载 ${overallProgress}%`);
      setDownloadProject({
        draftId: draft_id || '',
        draftName: draft_name || draft_id || '',
        jobId: jobId || null,
        status: normalizedStatus,
        overallProgress,
        overallStatusText,
        downloadFiles: active,
      });
    });
    return () => { typeof unsubscribe === 'function' && unsubscribe(); };
  }, []);

  // 新增：订阅进度，当当前任务结束（current 为空）时清空右侧项目
  useEffect(() => {
    const unsubscribe = DownloadController.subscribeProgress((snapshot) => {
      if (!snapshot?.current) {
        setDownloadProject(null);
      }
    });
    return () => { typeof unsubscribe === 'function' && unsubscribe(); };
  }, []);

  const getCompletedItemKey = (item, idx) => item?.jobId ?? item?.createdAt ?? item?.completedAt ?? `${item?.draft_id}-${idx}`;

  useEffect(() => {
    if (!selectedCompletedKey) return;

    const unsubscribe = DownloadController.subscribeProgress((snapshot) => {
      const nextCompleted = Array.isArray(snapshot?.completed) ? snapshot.completed : [];
      const matched = nextCompleted.find((item, idx) => getCompletedItemKey(item, idx) === selectedCompletedKey);
      setSelectedCompleted(matched || null);
      if (!matched) {
        setSelectedCompletedKey(null);
      }
    });

    return () => { typeof unsubscribe === 'function' && unsubscribe(); };
  }, [selectedCompletedKey]);

  // 构建“已完成”记录为 DownloadList 的 project（仅失败项需要列表）
  const buildProjectFromCompleted = (item) => {
    if (!item) return { draftName: '', overallProgress: 0, overallStatusText: '', downloadFiles: [], errorMessage: '' };
    const isSuccess = item.status === 'success';
    const list = isSuccess
      ? []
      : (Array.isArray(item.flatList)
          ? item.flatList
          : (Array.isArray(item.fileList) ? item.fileList.filter(f => f.status === 'failed') : []));
    const totalDownloaded = list.reduce((sum, f) => sum + (Number(f.downloaded) || 0), 0);
    const totalTotal = list.reduce((sum, f) => sum + (Number(f.total) || 0), 0);
    const overallProgress = isSuccess ? 100 : (totalTotal > 0 ? Math.round((totalDownloaded / totalTotal) * 100) : 0);
    const errorMessage = isSuccess ? '' : (mapDownloadErrorMessage(item.message) || '下载失败');
    return {
      draftId: item.draft_id || '',
      draftName: item.draft_name || item.draft_id || '',
      jobId: item.jobId || null,
      status: item.status || (isSuccess ? 'success' : 'failed'),
      overallProgress,
      overallStatusText: isSuccess ? '下载完成' : '下载失败',
      errorMessage,
      downloadFiles: list,
    };
  };

  let rightPanel = null;
  if (selectedPane === 'download') {
      if (downloadDualView === 'completed') {
          if (selectedCompleted) {
              if (selectedCompleted.status === 'success') {
                  rightPanel = <DraftDownloadSuccessPreview draft={selectedCompleted} />;
              } else {
                  rightPanel = <DownloadList project={buildProjectFromCompleted(selectedCompleted)} />;
              }
          }
      }
  }

  const handleToggleChatHistory = () => {
    if (chatHistoryAnimTimerRef.current) {
      clearTimeout(chatHistoryAnimTimerRef.current);
    }
    setChatHistoryAnimated(true);
    setChatHistoryVisible((v) => !v);
    chatHistoryAnimTimerRef.current = setTimeout(() => {
      setChatHistoryAnimated(false);
      chatHistoryAnimTimerRef.current = null;
    }, 320);
  };

  useEffect(() => {
    return () => {
      if (chatHistoryAnimTimerRef.current) {
        clearTimeout(chatHistoryAnimTimerRef.current);
      }
      if (canUseAgentRuntime) {
        for (const agentSessionId of chatAgentSessionIdByChatIdRef.current.values()) {
          void window.electronAPI.cherryChatStream.unsubscribe(agentSessionId);
        }
      }
      chatTitleRevealTimersRef.current.forEach((timer) => {
        clearTimeout(timer);
      });
      chatTitleRevealTimersRef.current.clear();
    };
  }, [canUseAgentRuntime]);

  return (
    <div className="home-container" style={{ WebkitAppRegion: 'no-drag' }}>
        <div className="home-header">
            <div className="header-avatar-wrapper">
              <img
                src={avatarSrc}
                alt="avatar"
                className="header-avatar"
                style={headerMembership.isActive ? { borderColor: MEMBER_COLOR } : undefined}
              />
              {headerMembership.isActive && (
                <img src={VipIcon} alt="vip" className="header-vip-badge" />
              )}
            </div>
            <span
              className="header-username"
              style={headerMembership.isActive ? { color: MEMBER_COLOR } : undefined}>
              {userName}
            </span>
            <span className="header-welcome">
              今天你创作了{todayCount != null ? todayCount : '…'}条视频
            </span>
        </div>
      {/* 主体三栏 */}
      <div className="home-content">
          <div className="left-pane column">
              <DPane
                selected={selectedPane}
                onSelect={setSelectedPane}
                downloadItemRef={beginnerGuideDownloadPaneRef}
                settingsItemRef={beginnerGuideSettingsPaneRef}
                credits={formatCreditsCount(creditsBalance)}
                creditsLoading={creditsLoading}
                onRefreshCredits={handleCreditsButtonClick}
              />
          </div>
          <div
            className={`center-pane column ${
            isChatPane ? 'center-pane--chat' : ''
          } ${
            isSkillPane ? 'center-pane--skill-hidden' : ''
          } ${
            isChatPane && chatHistoryAnimated ? 'center-pane--animate' : ''
          } ${
            isChatPane && !chatHistoryVisible ? 'center-pane--collapsed' : ''
            }`}
          >
            {selectedPane === 'draft' && (
              <DraftList
                onRefreshTodayCount={refreshTodayCount}
                onSelectDraft={setSelectedDraft}
                onSelectionChange={setSelectedDrafts}
                selectedId={selectedDraft?.draft_id}
                refreshToken={draftListRefreshToken}
              />
            )}
            {selectedPane === 'download' && (
              <DownloadDualList
                onViewChange={(v) => {
                    const prev = downloadDualView;
                    setDownloadDualView(v);
                    if (v === 'completed' && prev !== 'completed') {
                      setSelectedCompleted(null);
                      setSelectedCompletedKey(null);
                    }
                }}
                selectedCompletedKey={selectedCompletedKey}
                onSelectCompletedItem={(item, idx) => {
                  setSelectedCompleted(item);
                  setSelectedCompletedKey(getCompletedItemKey(item, idx));
                }}
              />
            )}
            {selectedPane === 'preset' && (
              <PresetList onSelect={setSelectedPreset} />
            )}
            {isChatPane && (
              <ChatHistoryList
                sessions={chatSessionsWithStatus}
                activeSessionId={activeChatId}
                onCreateSession={handleCreateChatSession}
                onSelectSession={handleSelectChatSession}
                onDeleteSession={handleDeleteChatSession}
                onDeleteWorkspace={handleDeleteWorkspace}
                visible={chatHistoryVisible}
              />
            )}
          </div>
          <div
            className={`right-pane column ${
            isChatPane ? 'right-pane--chat' : ''
          } ${
            isSkillPane ? 'right-pane--skill' : ''
          } ${
            isChatPane && !chatHistoryVisible ? 'right-pane--chat-collapsed' : ''
            }`}
          >
            {selectedPane === 'draft' && (selectedDraft || selectedDrafts.length > 0) ? (
              <DraftPreview draft={selectedDraft} drafts={selectedDrafts} onDeleteDraft={handleDraftDeleted} />
            ) : null}
            {selectedPane === 'preset' ? (
              <Preset preset={selectedPreset} />
            ) : null}
            {/* 下载中视图：显示当前下载详情 */}
            {selectedPane === 'download' && downloadDualView === 'downloading' ? (
              <DownloadList project={downloadProject || { draftName: '', overallProgress: 0, overallStatusText: '', downloadFiles: [] }} />
            ) : null}
            {isSkillPane ? (
              <SkillStorePage
                onGoChat={handleSkillGoChat}
                onEditSkill={handleSkillEdit}
                onCreateSkill={handleCreateSkillFromStore}
              />
            ) : null}
            {isChatPane ? (
              <Chat
                session={activeChatSession}
                agentId={DEFAULT_RUNTIME_AGENT_ID}
                runtimeSessionId={activeChatSession?.runtimeSessionId || ''}
                sessionFulfilled={activeChatSessionCompleted}
                input={chatDraftInput}
                setInput={setChatDraftInput}
                onSendMessage={handleSendChatMessage}
                onStopSending={handleStopChatMessage}
                onCopyAssistantMessage={handleCopyAssistantMessage}
                onRetryAssistantMessage={handleRetryAssistantMessage}
                onDeleteAssistantMessage={handleDeleteAssistantMessage}
                sending={activeChatMessagePaneSending || (!activeChatId && chatSending)}
                historyLoading={activeChatHistoryLoading}
                sessionSending={activeChatSending}
                model={chatModel}
                modelOptions={chatModelOptions}
                modelListLoading={chatModelListLoading}
                onModelChange={setChatModel}
                historyVisible={chatHistoryVisible}
                onToggleHistory={handleToggleChatHistory}
                onCreateSession={handleCreateChatSession}
                onEnsureRuntimeSession={() => activeChatId ? ensureAgentSessionForChat(activeChatId) : Promise.resolve('')}
                workspaceStatus={activeChatWorkspaceStatus}
                sessionTitle={activeChatSession?.title || DEFAULT_CHAT_TITLE}
                sessionTitleRenaming={
                  Boolean(activeChatId) && chatTitleRenamingSessionIds.includes(activeChatId)
                }
                sessionTitleNewlyRenamed={
                  Boolean(activeChatId) && chatTitleNewlyRenamedSessionIds.includes(activeChatId)
                }
                onRenameSessionTitle={handleRenameActiveChatTitle}
                userName={userName}
                userAvatar={avatarSrc}
                webPreview={activeChatWebPreview}
                onCloseWebPreview={handleCloseChatWebPreview}
                onOpenWebPreview={handleOpenChatWebPreview}
                onInlinePreviewVisibilityChange={setChatInlinePreviewVisible}
                onQuickPromptAction={(action) => {
                  if (action === 'bootstrap-childrens-picture-book') {
                    return handleBootstrapChildrensPictureBook();
                  }
                  if (action === 'bootstrap-trendy-koubo') {
                    return handleBootstrapTrendyKoubo();
                  }
                  if (action === 'bootstrap-live-clipping') {
                    return handleBootstrapLiveClipping();
                  }
                  if (action === 'bootstrap-travel-guide') {
                    return handleBootstrapTravelGuide();
                  }
                  if (action === 'bootstrap-sweater-selling') {
                    return handleBootstrapSweaterSelling();
                  }
                  if (action === 'bootstrap-convenience-store-tour') {
                    return handleBootstrapConvenienceStoreTour();
                  }
                  if (action === 'bootstrap-education-knowledge') {
                    return handleBootstrapEducationKnowledge();
                  }
                  return Promise.resolve();
                }}
                onRefreshCredits={refreshRechargeBalance}
                onOpenSkillStore={handleOpenSkillStore}
                beginnerGuideDownloadPaneRef={beginnerGuideDownloadPaneRef}
                beginnerGuideSettingsPaneRef={beginnerGuideSettingsPaneRef}
              />
            ) : null}
            {/* 已完成视图：仅在选中具体项后展示右侧内容 */}
            {rightPanel}
          </div>
      </div>
    </div>
  );
};

export default HomePage;
