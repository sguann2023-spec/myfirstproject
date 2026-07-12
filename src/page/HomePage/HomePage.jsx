// HomePage 组件
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './HomePage.css';
import { electronStore } from '../../shared/electronStore';
import LogoIcon from '../../../public/logo-circle.png';
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
import { checkinRechargeDaily, getRechargeBalance } from '../../api/recharge';
import { tokenStore } from '../../auth';
import { normalizeChatError } from '../../shared/chatError';
import { isBeginnerGuideCompleted, isBeginnerGuideReopenPending } from '../../shared/beginnerGuide';
import appStore from '../../renderer/src/store';
import { updateOneBlock } from '../../renderer/src/store/messageBlock';
import { toolPermissionsActions } from '../../renderer/src/store/toolPermissions';
import { setupChannelStream } from '../../renderer/src/store/thunk/messageThunk';
import { IpcChannel } from '../../packages/shared/IpcChannel';
import { useFullscreen } from '../../renderer/src/hooks/useFullscreen';
const logger = loggerService.withContext('HomePage');

const CHAT_STORAGE_KEY = 'capcut-helper-chat-sessions-v1';
const CHAT_ACTIVE_ID_KEY = 'capcut-helper-chat-active-id-v1';
const CHAT_MODEL_KEY = 'capcut-helper-chat-model-v1';
const DEFAULT_CHAT_TITLE = '新对话';
const CHAT_MODELS = ['gpt-5.3-codex', 'claude-opus-4-7'];
const VECTCUT_ANTHROPIC_API_BASE_URL = 'https://open.vectcut.com/llm/chat';
const CHAT_SNAPSHOT_THROTTLE_MS = 100;
const DEFAULT_RUNTIME_AGENT_ID = 'vectcut_claw_default';
const WORKSPACE_STORE_KEY = 'chat-workspaces:v1';
const AUTO_WORKSPACE_STATUS_TEXT = '正在新建工作空间...';
const CHAT_BROWSER_PREVIEW_WIDTH = 400;
const QUICK_CHILDRENS_PICTURE_BOOK_SKILL_NAME = '儿童绘本';
const QUICK_TRAVEL_MONTAGE_SKILL_NAME = '旅游混剪';

const normalizeLocalPath = (value = '') => String(value || '').replace(/\\/g, '/');
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
const buildAutoWorkspaceName = () => (
  `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
);
const createLocalFileUrl = (filePath = '') => {
  const normalizedPath = normalizeLocalPath(filePath).trim();
  if (!normalizedPath) return '';
  const pathname = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  return encodeURI(`file://${pathname}`);
};
const seedWorkspaceSkeleton = async (workspacePath) => {
  const seedResult = await window.electronAPI.agentSkills.seedWorkspace({ workspace: workspacePath });
  if (!seedResult?.ok) {
    throw new Error(seedResult?.error || '初始化工作空间失败');
  }
};
const resolveQuickSkillDirectory = (appInfo, skillName = '') => {
  const resourcesPath = normalizeLocalPath(appInfo?.resourcesPath || '').trim();
  const normalizedSkillName = String(skillName || '').trim();
  if (!resourcesPath || !normalizedSkillName) return '';
  return joinLocalPath(resourcesPath, 'quick', 'skills', normalizedSkillName);
};
const resolveWorkspacePreviewFile = (workspacePath = '') => {
  const normalizedWorkspacePath = normalizeLocalPath(workspacePath).trim();
  if (!normalizedWorkspacePath) return '';
  return joinLocalPath(normalizedWorkspacePath, 'index.html');
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
      return {
        key: `${String(session?.id || 'chat').trim()}:${toolCallId}:${url}`,
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
    return {
      key: `${String(scopeKey || 'chat').trim()}:${toolCallId}:${url}`,
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

const summarizeMapKeys = (mapLike, limit = 6) => {
  try {
    if (!mapLike || typeof mapLike.keys !== 'function') return [];
    return [...mapLike.keys()].slice(0, limit);
  } catch {
    return [];
  }
};


const getPerfTimestamp = () =>
  (typeof globalThis?.performance?.now === 'function' ? globalThis.performance.now() : Date.now());

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

const createEmptyChatSession = () => {
  const now = Date.now();
  return {
    id: createChatId(),
    title: DEFAULT_CHAT_TITLE,
    titleAutoGenerated: false,
    createdAt: now,
    updatedAt: now,
    runtimeSessionId: '',
    messages: [],
  };
};

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

const isStreamingLikeBlockStatus = (value) => (
  STREAMING_LIKE_BLOCK_STATUSES.includes(String(value || '').toLowerCase())
);

const isTerminalToolRuntimeStatus = (value) => (
  TERMINAL_TOOL_RUNTIME_STATUSES.includes(String(value || '').toLowerCase())
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
  const nextBlockStatus = aborted ? 'success' : 'error';
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

const normalizeStructuredBlocksForPersistence = (blocks = [], { hasError = false } = {}) => {
  const nextBlockStatus = hasError ? 'error' : 'success';
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
          ...rawToolResponse,
          status: hasError ? 'error' : 'done'
        }
      };
    }

    acc.push(nextBlock);
    return acc;
  }, []);
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

  if (String(nextMessage?.role || '').toLowerCase() !== 'assistant') {
    return nextMessage;
  }

  if (nextMessage.storeAssistantMessageId !== null) {
    ensureCloned().storeAssistantMessageId = null;
  }
  if (Array.isArray(nextMessage.blocks)) {
    const structuredBlocks = nextMessage.blocks.filter((block) => isStructuredBlockObject(block));
    if (structuredBlocks.length === nextMessage.blocks.length) {
      const normalizedBlocks = normalizeStructuredBlocksForPersistence(structuredBlocks, {
        hasError: Boolean(nextMessage.error)
      });
      if (JSON.stringify(normalizedBlocks) !== JSON.stringify(nextMessage.blocks)) {
        ensureCloned().blocks = normalizedBlocks;
      }
    }
  }

  if (!String(nextMessage.content || '').trim() && hasStructuredBlocks(nextMessage.blocks)) {
    const nextContent = buildAssistantDisplayContentFromBlocks(nextMessage.blocks);
    if (nextContent !== nextMessage.content) {
      ensureCloned().content = nextContent;
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
  if (!session || !Array.isArray(session.messages)) return false;
  const runtimeSessionId = String(session?.runtimeSessionId || '').trim();
  if (!runtimeSessionId) return false;

  if (session.messages.length === 0) return true;

  const hasAssistantMessage = session.messages.some(
    (message) => String(message?.role || '').toLowerCase() === 'assistant'
  );
  if (!hasAssistantMessage) return true;

  return session.messages.some((message) => {
    if (String(message?.role || '').toLowerCase() !== 'assistant') return false;
    return !buildVisibleAssistantContent(message);
  });
};

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

const shouldApplyHydratedMessages = ({
  currentMessages = [],
  hydratedMessages = []
}) => {
  const beforeMessageCount = Array.isArray(currentMessages) ? currentMessages.length : 0;
  const beforeVisibleAssistantCount = countVisibleAssistantMessages(currentMessages);
  const beforeMissingAssistantCount = countMissingVisibleAssistantMessages(currentMessages);
  const beforeStructuredAssistantBlockCount = countStructuredAssistantBlocks(currentMessages);
  const afterVisibleAssistantCount = countVisibleAssistantMessages(hydratedMessages);
  const afterMissingAssistantCount = countMissingVisibleAssistantMessages(hydratedMessages);
  const afterStructuredAssistantBlockCount = countStructuredAssistantBlocks(hydratedMessages);

  return (
    beforeMessageCount === 0
    || beforeVisibleAssistantCount === 0
    || afterMissingAssistantCount < beforeMissingAssistantCount
    || afterVisibleAssistantCount > beforeVisibleAssistantCount
    || afterStructuredAssistantBlockCount > beforeStructuredAssistantBlockCount
  );
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

const toPersistedHistoryMessage = (persistedEntry, index, modelOptions = []) => {
  const sourceMessage = persistedEntry?.message || {};
  const role = String(sourceMessage?.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user';
  const sourceBlocks = Array.isArray(persistedEntry?.blocks) ? persistedEntry.blocks.filter((block) => isStructuredBlockObject(block)) : [];
  const normalizedBlocks = normalizeStructuredBlocksForPersistence(sourceBlocks, {
    hasError: Boolean(sourceMessage?.error)
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

  return {
    id: String(sourceMessage?.id || `persisted-${index}`),
    role,
    content,
    blocks: role === 'assistant' ? normalizedBlocks : [],
    createdAt,
    updatedAt,
    model: modelMeta,
    modelId: modelId || undefined,
    usage: sourceMessage?.usage ? { ...sourceMessage.usage } : undefined,
    metrics: sourceMessage?.metrics ? { ...sourceMessage.metrics } : undefined,
    error: sourceMessage?.error || null,
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
  const [todayCount, setTodayCount] = useState(null);
  const [creditsBalance, setCreditsBalance] = useState(null);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [selectedPane, setSelectedPane] = useState('chat');
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
  const [chatWorkspaceStatusMap, setChatWorkspaceStatusMap] = useState({});
  const [chatModel, setChatModel] = useState(() => CHAT_MODELS[0]);
  const [chatModelOptions, setChatModelOptions] = useState(() => CHAT_MODELS.map((item) => toModelOption(item)));
  const [chatModelListLoading, setChatModelListLoading] = useState(true);
  const [chatHistoryVisible, setChatHistoryVisible] = useState(false);
  const beginnerGuideDownloadPaneRef = useRef(null);
  const beginnerGuideSettingsPaneRef = useRef(null);
  const [chatHistoryAnimated, setChatHistoryAnimated] = useState(false);
  const [chatDraftInput, setChatDraftInput] = useState('');
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
  const chatDeferredSessionChangeHydrateRef = useRef(new Map());
  const creditsBalanceMountedRef = useRef(true);
  const [chatTitleRenamingSessionIds, setChatTitleRenamingSessionIds] = useState([]);
  const [chatTitleNewlyRenamedSessionIds, setChatTitleNewlyRenamedSessionIds] = useState([]);
  const [chatWebPreview, setChatWebPreview] = useState(null);
  const [manualChatWebPreview, setManualChatWebPreview] = useState(null);
  const [chatWebPreviewDismissedKey, setChatWebPreviewDismissedKey] = useState('');
  const activeChatWebPreviewKeyRef = useRef('');
  const chatExpandedWindowBaseWidthRef = useRef(null);

  useEffect(() => {
    if (typeof electronStore.onDidChange !== 'function') {
      return undefined;
    }

    const dispose = electronStore.onDidChange('user', () => {
      setHeaderUser(electronStore.get('user') || {});
    });

    return () => {
      if (typeof dispose === 'function') {
        dispose();
      }
    };
  }, []);
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
    try {
      const invoke = window?.ipc?.invoke
        ? (channel, payload) => window.ipc.invoke(channel, payload)
        : (channel, payload) => window.electron.ipcRenderer.invoke(channel, payload);
      const historicalMessages = await invoke(IpcChannel.AgentMessage_GetHistory, {
        sessionId: normalizedSessionId
      });
      if (!Array.isArray(historicalMessages) || historicalMessages.length === 0) {
        logger.warn('[HomePage][HistoryHydrate] skipped empty persisted sync', {
          chatId: normalizedChatId,
          sessionId: normalizedSessionId,
          reason
        });
        return;
      }

      const hydratedMessages = historicalMessages
        .map((entry, index) => toPersistedHistoryMessage(entry, index, chatModelOptionsRef.current))
        .filter((message) => message?.id);
      const hasAssistantContent = hydratedMessages.some((message) => (
        message.role === 'assistant' && String(message.content || '').trim()
      ));
      if (!hasAssistantContent) {
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
          hydratedStructuredAssistantBlockCount: countStructuredAssistantBlocks(hydratedMessages)
        });
        chatHistoryHydrateSettledRef.current.add(hydrateKey);
        return;
      }

      setChatSessions((prev) => {
        const updated = prev.map((item) => (
          item.id === normalizedChatId
            ? {
              ...item,
              updatedAt: Date.now(),
              messages: hydratedMessages
            }
            : item
        ));
        return sortChatSessions(updated);
      });
      chatHistoryHydrateSettledRef.current.add(hydrateKey);
    } catch (error) {
      logger.warn('[HomePage][HistoryHydrate] failed persisted sync', {
        chatId: normalizedChatId,
        sessionId: normalizedSessionId,
        reason,
        error: error?.message || String(error)
      });
    } finally {
      chatHistoryHydratingRef.current.delete(hydrateKey);
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
    try {
      const { ipcRenderer } = window.require('electron');
      const handlePaymentSuccess = async () => {
        const nextBalance = await refreshRechargeBalanceAfterPayment();
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
  }, [refreshRechargeBalanceAfterPayment]);

  useEffect(() => {
    activeChatWebPreviewKeyRef.current = String(
      manualChatWebPreview?.key || chatWebPreview?.key || ''
    ).trim();
  }, [chatWebPreview?.key, manualChatWebPreview?.key]);

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
        handleCreateChatSession();
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
      const rawSessions = localStorage.getItem(CHAT_STORAGE_KEY);
      const rawActiveId = localStorage.getItem(CHAT_ACTIVE_ID_KEY);
      const parsed = rawSessions ? JSON.parse(rawSessions) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed
          .filter((item) => item && typeof item === 'object' && item.id)
          .map((item) => ({
            id: item.id,
            title: item.title || DEFAULT_CHAT_TITLE,
            titleAutoGenerated: item.titleAutoGenerated === true,
            createdAt: Number(item.createdAt) || Date.now(),
            updatedAt: Number(item.updatedAt) || Date.now(),
            runtimeSessionId: String(item.runtimeSessionId || '').trim(),
            messages: Array.isArray(item.messages)
              ? item.messages.map((message) => normalizePersistedChatMessage(message))
              : [],
          }));
        if (normalized.length > 0) {
          let nextSessions = sortChatSessions(normalized);
          let nextActiveChatId = nextSessions.some((item) => item.id === rawActiveId)
            ? rawActiveId
            : nextSessions[0].id;

          if (shouldRestoreBeginnerGuideInFreshChat()) {
            const freshGuideSession = nextSessions.find((item) => isFreshBeginnerGuideChatSession(item));
            if (freshGuideSession) {
              nextActiveChatId = freshGuideSession.id;
            } else {
              const nextFreshSession = createEmptyChatSession();
              nextSessions = [nextFreshSession, ...nextSessions];
              nextActiveChatId = nextFreshSession.id;
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
      logger.warn('Failed to load chat sessions from localStorage.', error);
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
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatSessions));
      if (activeChatId) {
        localStorage.setItem(CHAT_ACTIVE_ID_KEY, activeChatId);
      }
    } catch (error) {
      logger.warn('Failed to persist chat sessions to localStorage.', error);
    }
  }, [chatSessions, activeChatId]);

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
  const activeChatSessionSending = Boolean(
    activeChatId && chatSessionSendingMap[String(activeChatId || '').trim()]
  );
  const activeChatSessionInFlight = Boolean(
    activeChatId && chatSessionInFlightMap[String(activeChatId || '').trim()]
  );
  const activeChatMessagePaneSending = Boolean(
    activeChatSessionInFlight
  );
  const activeChatNeedsHistoryHydrate = Boolean(
    activeChatSession && shouldHydrateChatSessionFromHistory(activeChatSession)
  );

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
    const previewVisible = selectedPane === 'chat' && Boolean(activeChatWebPreview?.url);

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
  }, [activeChatWebPreview?.url, isFullscreen, selectedPane]);

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
    if (activeChatSessionSending) return;
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
          chatHistoryHydrateSettledRef.current.add(hydrateKey);
          logger.warn('[HomePage][HistoryHydrate] skipped empty history', {
            chatId: activeChatSession.id,
            sessionId: runtimeSessionId,
            beforeMissingAssistantCount
          });
          return;
        }

        const hydratedMessages = historicalMessages
          .map((entry, index) => toPersistedHistoryMessage(entry, index, chatModelOptions))
          .filter((message) => message?.id);
        const hasAssistantContent = hydratedMessages.some((message) => (
          message.role === 'assistant' && String(message.content || '').trim()
        ));
        if (!hasAssistantContent) {
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
            messageCount: hydratedMessages.length
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
              messages: [...hydratedMessages, ...locallyAddedMessages]
            };
          });
          return sortChatSessions(updated);
        });
        chatHistoryHydrateSettledRef.current.add(hydrateKey);
      } catch (error) {
        if (cancelled) return;
        logger.warn('[HomePage][HistoryHydrate] failed', {
          chatId: activeChatSession.id,
          sessionId: runtimeSessionId,
          error: error?.message || String(error)
        });
      } finally {
        chatHistoryHydratingRef.current.delete(hydrateKey);
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
    activeChatSessionSending
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
  const updateChatAssistantMessage = useCallback((chatId, assistantMessageId, updates) => {
    if (!chatId || !assistantMessageId || !updates) return;
    setChatSessions((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== chatId) return item;
        return {
          ...item,
          updatedAt: Date.now(),
          messages: item.messages.map((message) => (
            message.id === assistantMessageId
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
  const activeChatSending = Boolean(activeChatId) && Boolean(chatSessionSendingMap[activeChatId]);
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
      })),
    [chatSessions, chatSessionInFlightMap, chatSessionFulfilledMap]
  );

  useEffect(() => {
    chatSessionsRef.current = chatSessions;
  }, [chatSessions]);

  useEffect(() => {
    return () => {
      chatSnapshotThrottleByRequestIdRef.current.forEach((entry) => {
        if (entry?.timer) clearTimeout(entry.timer);
      });
      chatSnapshotThrottleByRequestIdRef.current.clear();
    };
  }, []);

  const triggerAutoRenameSessionTitle = async (sessionId, messagesOverride = null) => {
    const id = String(sessionId || '').trim();
    if (!id) return;
    if (chatTitleGeneratingSessionIdsRef.current.has(id)) return;

    const session = chatSessionsRef.current.find((item) => item.id === id);
    if (!session) return;

    const currentTitle = String(session.title || '').trim();
    if (currentTitle && currentTitle !== DEFAULT_CHAT_TITLE) return;

    const normalizedMessages = Array.isArray(messagesOverride)
      ? messagesOverride
      : (Array.isArray(session.messages) ? session.messages : []);
    const assistantReplies = normalizedMessages.filter((item) => (
      item?.role === 'assistant'
      && String(item?.content || '').trim()
      && !item?.error
    ));
    const hasAssistantReply = assistantReplies.length > 0;
    const hasUserMessage = normalizedMessages.some((item) => item?.role === 'user' && String(item?.content || '').trim());
    if (!hasUserMessage || !hasAssistantReply) {
      logger.info('[HomePage][TitleRename] skipped', {
        sessionId: id,
        reason: !hasUserMessage ? 'no-user-message' : 'no-assistant-reply',
        messageCount: normalizedMessages.length,
        assistantReplyCount: assistantReplies.length
      });
      return;
    }
    if (assistantReplies.length !== 1) {
      logger.info('[HomePage][TitleRename] skipped', {
        sessionId: id,
        reason: 'assistant-reply-count-not-one',
        messageCount: normalizedMessages.length,
        assistantReplyCount: assistantReplies.length
      });
      return;
    }

    const latestAssistant = [...normalizedMessages].reverse().find((item) => item?.role === 'assistant');
    const summaryModel = String(latestAssistant?.model || chatModel || '').trim();
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
      logger.info('[HomePage][TitleRename] start', {
        sessionId: id,
        messageCount: normalizedMessages.length,
        summaryModel
      });
      const { text } = await fetchMessagesSummary({
        messages: normalizedMessages,
        model: summaryModel
      });
      const nextTitle = String(text || '').trim();
      if (!nextTitle) {
        logger.info('[HomePage][TitleRename] skipped', {
          sessionId: id,
          reason: 'empty-generated-title'
        });
        return;
      }

      let updated = false;
      setChatSessions((prev) => {
        const next = prev.map((item) => {
          if (item.id !== id) return item;
          const titleNow = String(item.title || '').trim();
          if (titleNow && titleNow !== DEFAULT_CHAT_TITLE) return item;
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

      const persistedRuntimeSessionId = String(
        chatSessions.find((item) => item.id === chatId)?.runtimeSessionId || ''
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
        hasApiKey: Boolean(vectcutApiKey)
      });
      const created = await window.electronAPI.cherryChatStream.createSession({
        agent_id: DEFAULT_RUNTIME_AGENT_ID,
        model: chatModel,
        accessible_paths: [],
        configuration: {
          permission_mode: 'bypassPermissions',
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
          logger.warn('[HomePage][StreamTrace] drop payload without pending state', {
            requestId,
            sessionId: agentSessionId,
            payloadType,
            chunkType,
            pendingMapSize: chatPendingByRequestIdRef.current.size,
            knownPendingRequestIds: summarizeMapKeys(chatPendingByRequestIdRef.current),
            knownChatSessionIds: summarizeMapKeys(chatAgentSessionIdByChatIdRef.current)
          });
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
          logger.info('[HomePage][Perf] request started', {
            requestId,
            chatId,
            sessionId: agentSessionId,
            assistantMessageId,
            knownPendingRequestIds: summarizeMapKeys(chatPendingByRequestIdRef.current)
          });
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
        const snapshot = getAssistantSnapshotFromStore(storeAssistantMessageId || '');
        const snapshotSummary = summarizeSnapshotForPerf(snapshot);
        let computeDurationMs = 0;
        setChatSessions((prev) => {
          const computeStart = getPerfTimestamp();
          const updated = prev.map((item) => {
            if (item.id !== chatId) return item;
            return {
              ...item,
              updatedAt: Date.now(),
              messages: item.messages.map((message) => {
                if (message.id !== assistantMessageId) return message;
                const sourceBlocks = snapshot?.blocks || message.blocks || [];
                const nextBlocks = finalizeStructuredBlocks(sourceBlocks, { aborted });
                const nextContent =
                  snapshot?.content
                  || buildAssistantDisplayContentFromBlocks(nextBlocks)
                  || message.content
                  || '';
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
                  storeAssistantMessageId: null,
                  content: nextContent,
                  blocks: nextBlocks,
                  usage: snapshot?.usage ? { ...snapshot.usage } : message.usage,
                  metrics: snapshot?.metrics ? { ...snapshot.metrics } : message.metrics,
                  model: nextModel,
                  modelId: nextModelId,
                  error,
                  updatedAt: Date.now()
                };
              })
            };
          });
          const sorted = sortChatSessions(updated);
          computeDurationMs = Math.round((getPerfTimestamp() - computeStart) * 100) / 100;
          return sorted;
        });
        logger.info('[HomePage][Perf] finalize assistant message', {
          requestId,
          chatId,
          sessionId: agentSessionId,
          aborted,
          hasError: Boolean(error),
          computeDurationMs,
          ...snapshotSummary
        });
      };

      if (payload.type === 'chunk') {
        const chunkStart = getPerfTimestamp();
        streamController?.pushChunk(payload.chunk || {});
        const pushChunkDurationMs = Math.round((getPerfTimestamp() - chunkStart) * 100) / 100;
        const chunkType = String(payload?.chunk?.type || '');
        const isVisibleAssistantTextChunk = chunkType === 'text-start' || chunkType === 'text-delta';
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
          logger.info('[HomePage][Perf] first visible assistant text chunk', {
            requestId,
            chatId,
            sessionId: agentSessionId,
            assistantMessageId,
            chunkType
          });
          setChatSessionSending(chatId, false, `chunk.${chunkType}`);
          setChatSending(false);
        }
        if (pushChunkDurationMs >= 16) {
          logger.warn('[HomePage][Perf] slow pushChunk', {
            requestId,
            chatId,
            sessionId: agentSessionId,
            assistantMessageId,
            chunkType,
            pushChunkDurationMs
          });
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
          setChatSessionSending(chatId, false, 'chunk.error.aborted');
          setChatSessionInFlight(chatId, false, 'chunk.error.aborted');
          setChatSessionFulfilled(chatId, false, 'chunk.error.aborted');
          setChatSending(false);
          if (requestId) {
            const completedPerf = chatPerfByRequestIdRef.current.get(requestId);
            if (completedPerf) {
              const totalDurationMs = completedPerf.startedPerfAt
                ? Math.round((getPerfTimestamp() - completedPerf.startedPerfAt) * 100) / 100
                : null;
              logger.info('[HomePage][Perf] request finished', {
                requestId,
                chatId,
                sessionId: agentSessionId,
                outcome: 'aborted',
                totalDurationMs,
                chunkCount: completedPerf.chunkCount,
                snapshotCount: completedPerf.snapshotCount,
                maxContentLength: completedPerf.maxContentLength,
                maxBlockCount: completedPerf.maxBlockCount,
                maxPushChunkMs: completedPerf.maxPushChunkMs,
                maxSnapshotComputeMs: completedPerf.maxSnapshotComputeMs,
                lastChunkType: completedPerf.lastChunkType
              });
              chatPerfByRequestIdRef.current.delete(requestId);
            }
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
        setChatSessionSending(chatId, false, 'chunk.error');
        setChatSessionInFlight(chatId, false, 'chunk.error');
        setChatSessionFulfilled(chatId, false, 'chunk.error');
        setChatSending(false);
        if (requestId) {
          const completedPerf = chatPerfByRequestIdRef.current.get(requestId);
          if (completedPerf) {
            const totalDurationMs = completedPerf.startedPerfAt
              ? Math.round((getPerfTimestamp() - completedPerf.startedPerfAt) * 100) / 100
              : null;
            logger.info('[HomePage][Perf] request finished', {
              requestId,
              chatId,
              sessionId: agentSessionId,
              outcome: 'error',
              totalDurationMs,
              chunkCount: completedPerf.chunkCount,
              snapshotCount: completedPerf.snapshotCount,
              maxContentLength: completedPerf.maxContentLength,
              maxBlockCount: completedPerf.maxBlockCount,
              maxPushChunkMs: completedPerf.maxPushChunkMs,
              maxSnapshotComputeMs: completedPerf.maxSnapshotComputeMs,
              lastChunkType: completedPerf.lastChunkType
            });
            chatPerfByRequestIdRef.current.delete(requestId);
          }
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
        setChatSessionSending(chatId, false, 'chunk.cancelled');
        setChatSessionInFlight(chatId, false, 'chunk.cancelled');
        setChatSessionFulfilled(chatId, false, 'chunk.cancelled');
        setChatSending(false);
        if (requestId) {
          const completedPerf = chatPerfByRequestIdRef.current.get(requestId);
          if (completedPerf) {
            const totalDurationMs = completedPerf.startedPerfAt
              ? Math.round((getPerfTimestamp() - completedPerf.startedPerfAt) * 100) / 100
              : null;
            logger.info('[HomePage][Perf] request finished', {
              requestId,
              chatId,
              sessionId: agentSessionId,
              outcome: 'cancelled',
              totalDurationMs,
              chunkCount: completedPerf.chunkCount,
              snapshotCount: completedPerf.snapshotCount,
              maxContentLength: completedPerf.maxContentLength,
              maxBlockCount: completedPerf.maxBlockCount,
              maxPushChunkMs: completedPerf.maxPushChunkMs,
              maxSnapshotComputeMs: completedPerf.maxSnapshotComputeMs,
              lastChunkType: completedPerf.lastChunkType
            });
            chatPerfByRequestIdRef.current.delete(requestId);
          }
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
        const sessionBeforeRename = chatSessionsRef.current.find((item) => item.id === chatId);
        const messagesForRename = sessionBeforeRename
          ? sessionBeforeRename.messages.map((message) => (
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
                      metrics: finalSnapshot?.metrics ? { ...finalSnapshot.metrics } : message.metrics,
                      model: nextModel,
                      modelId: nextModelId,
                      error: null,
                      updatedAt: Date.now()
                    };
                  })()
                : message
            ))
          : null;
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
            const totalDurationMs = completedPerf.startedPerfAt
              ? Math.round((getPerfTimestamp() - completedPerf.startedPerfAt) * 100) / 100
              : null;
            logger.info('[HomePage][Perf] request finished', {
              requestId,
              chatId,
              sessionId: agentSessionId,
              outcome: 'complete',
              totalDurationMs,
              chunkCount: completedPerf.chunkCount,
              snapshotCount: completedPerf.snapshotCount,
              maxContentLength: completedPerf.maxContentLength,
              maxBlockCount: completedPerf.maxBlockCount,
              maxPushChunkMs: completedPerf.maxPushChunkMs,
              maxSnapshotComputeMs: completedPerf.maxSnapshotComputeMs,
              lastChunkType: completedPerf.lastChunkType
            });
            chatPerfByRequestIdRef.current.delete(requestId);
          }
        }
        void triggerAutoRenameSessionTitle(chatId, messagesForRename);
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

  const handleCreateChatSession = () => {
    const session = createEmptyChatSession();
    logger.info('[HomePage][SessionSending] create session', {
      sessionId: session.id,
      fromActiveChatId: activeChatId
    });
    setChatSessions((prev) => [session, ...prev]);
    setActiveChatId(session.id);
    setChatSessionSending(session.id, false, 'create-session');
    setChatSessionInFlight(session.id, false, 'create-session');
    setChatSessionFulfilled(session.id, false, 'create-session');
  };

  const handleBootstrapChildrensPictureBook = useCallback(async () => {
    const inheritedWorkspacePath = getSessionWorkspacePath(activeChatSession);
    const session = createEmptyChatSession();
    setChatSessions((prev) => [session, ...prev]);
    setActiveChatId(session.id);
    setChatSessionSending(session.id, false, 'quick-bootstrap');
    setChatSessionInFlight(session.id, false, 'quick-bootstrap');
    setChatSessionFulfilled(session.id, false, 'quick-bootstrap');
    setChatWorkspaceStatus(session.id, inheritedWorkspacePath ? '正在准备儿童绘本技能...' : AUTO_WORKSPACE_STATUS_TEXT);

    try {
      const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
      const quickSkillDir = resolveQuickSkillDirectory(appInfo, QUICK_CHILDRENS_PICTURE_BOOK_SKILL_NAME);
      if (!quickSkillDir) {
        throw new Error('定位儿童绘本技能目录失败');
      }

      const agentSessionId = await ensureAgentSessionForChat(session.id);
      let workspacePath = inheritedWorkspacePath;
      if (!workspacePath) {
        const appDataPath = normalizeLocalPath(appInfo?.appDataPath || '');
        if (!appDataPath) {
          throw new Error('创建新工作空间失败');
        }

        const workspaceParentDir = joinLocalPath(
          appDataPath,
          'Data',
          'Workspaces',
          DEFAULT_RUNTIME_AGENT_ID
        );
        workspacePath = joinLocalPath(workspaceParentDir, buildAutoWorkspaceName());
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
        workspace: workspacePath,
        excludeSubdirs: ['website']
      });
      if (!copySkillResult?.success) {
        throw new Error(copySkillResult?.error || '复制技能到工作空间失败');
      }

      const copyResult = await window.electronAPI.agentSkills.copyDirectoryToWorkspace({
        directoryPath: quickSkillDir,
        workspace: workspacePath,
        sourceSubdir: 'website'
      });
      if (!copyResult?.success) {
        throw new Error(copyResult?.error || '复制网页模板到工作空间失败');
      }

      const workspaceStore = readWorkspaceStore();
      writeWorkspaceStore(markWorkspaceVisited(workspaceStore, workspacePath));
      const previewFilePath = resolveWorkspacePreviewFile(workspacePath);
      setChatSessions((prev) =>
        prev.map((item) => (
          item.id === session.id
            ? { ...item, runtimeSessionId: agentSessionId, updatedAt: Date.now() }
            : item
        ))
      );
      setManualChatWebPreview({
        key: `quick-skill-preview:${session.id}:${previewFilePath}`,
        title: '儿童绘本',
        url: createLocalFileUrl(previewFilePath)
      });
      setChatWebPreviewDismissedKey('');
      window.toast?.success?.(
        inheritedWorkspacePath
          ? '已新建对话，复用当前工作空间并打开儿童绘本预览'
          : '已新建对话和工作空间，并打开儿童绘本预览'
      );
    } catch (error) {
      window.toast?.error?.(error?.message || '快捷短语执行失败');
    } finally {
      setChatWorkspaceStatus(session.id, '');
    }
  }, [activeChatSession, ensureAgentSessionForChat, setChatSessionFulfilled, setChatSessionInFlight, setChatSessionSending, setChatWorkspaceStatus]);

  const handleBootstrapTravelMontage = useCallback(async () => {
    const inheritedWorkspacePath = getSessionWorkspacePath(activeChatSession);
    const session = createEmptyChatSession();
    setChatSessions((prev) => [session, ...prev]);
    setActiveChatId(session.id);
    setChatSessionSending(session.id, false, 'quick-bootstrap');
    setChatSessionInFlight(session.id, false, 'quick-bootstrap');
    setChatSessionFulfilled(session.id, false, 'quick-bootstrap');
    setChatWorkspaceStatus(session.id, inheritedWorkspacePath ? '正在准备旅游混剪技能...' : AUTO_WORKSPACE_STATUS_TEXT);

    try {
      const appInfo = typeof window?.api?.getAppInfo === 'function' ? await window.api.getAppInfo() : null;
      const quickSkillDir = resolveQuickSkillDirectory(appInfo, QUICK_TRAVEL_MONTAGE_SKILL_NAME);
      if (!quickSkillDir) {
        throw new Error('定位旅游混剪技能目录失败');
      }

      const agentSessionId = await ensureAgentSessionForChat(session.id);
      let workspacePath = inheritedWorkspacePath;
      if (!workspacePath) {
        const appDataPath = normalizeLocalPath(appInfo?.appDataPath || '');
        if (!appDataPath) {
          throw new Error('创建新工作空间失败');
        }

        const workspaceParentDir = joinLocalPath(
          appDataPath,
          'Data',
          'Workspaces',
          DEFAULT_RUNTIME_AGENT_ID
        );
        workspacePath = joinLocalPath(workspaceParentDir, buildAutoWorkspaceName());
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
        workspace: workspacePath,
        excludeSubdirs: ['website']
      });
      if (!copySkillResult?.success) {
        throw new Error(copySkillResult?.error || '复制技能到工作空间失败');
      }

      const copyResult = await window.electronAPI.agentSkills.copyDirectoryToWorkspace({
        directoryPath: quickSkillDir,
        workspace: workspacePath,
        sourceSubdir: 'website'
      });
      if (!copyResult?.success) {
        throw new Error(copyResult?.error || '复制网页模板到工作空间失败');
      }

      const workspaceStore = readWorkspaceStore();
      writeWorkspaceStore(markWorkspaceVisited(workspaceStore, workspacePath));
      const previewFilePath = resolveWorkspacePreviewFile(workspacePath);
      setChatSessions((prev) =>
        prev.map((item) => (
          item.id === session.id
            ? { ...item, runtimeSessionId: agentSessionId, updatedAt: Date.now() }
            : item
        ))
      );
      setManualChatWebPreview({
        key: `quick-skill-preview:${session.id}:${previewFilePath}`,
        title: '旅游混剪',
        url: createLocalFileUrl(previewFilePath)
      });
      setChatWebPreviewDismissedKey('');
      window.toast?.success?.(
        inheritedWorkspacePath
          ? '已新建对话，复用当前工作空间并打开旅游混剪预览'
          : '已新建对话和工作空间，并打开旅游混剪预览'
      );
    } catch (error) {
      window.toast?.error?.(error?.message || '快捷短语执行失败');
    } finally {
      setChatWorkspaceStatus(session.id, '');
    }
  }, [activeChatSession, ensureAgentSessionForChat, setChatSessionFulfilled, setChatSessionInFlight, setChatSessionSending, setChatWorkspaceStatus]);

  const handleSelectChatSession = (sessionId) => {
    setActiveChatId(sessionId);
    setChatSessionFulfilled(sessionId, false, 'select-session');
  };

  const handleDeleteChatSession = (sessionId) => {
    const runtimeSessionId = String(
      chatSessions.find((item) => item.id === sessionId)?.runtimeSessionId || ''
    ).trim();
    const timer = chatTitleRevealTimersRef.current.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      chatTitleRevealTimersRef.current.delete(sessionId);
    }
    setChatTitleRenamingSessionIds((prev) => prev.filter((id) => id !== sessionId));
    setChatTitleNewlyRenamedSessionIds((prev) => prev.filter((id) => id !== sessionId));
    removeChatSessionSending(sessionId);
    removeChatSessionInFlight(sessionId);
    removeChatSessionFulfilled(sessionId);
    chatAgentSessionIdByChatIdRef.current.delete(sessionId);
    if (runtimeSessionId) {
      chatIdByAgentSessionIdRef.current.delete(runtimeSessionId);
      if (canUseAgentRuntime) {
        void window.electronAPI.cherryChatStream.unsubscribe(runtimeSessionId);
      }
    }
    setChatSessions((prev) => {
      const remaining = prev.filter((item) => item.id !== sessionId);
      if (remaining.length === 0) {
        const next = createEmptyChatSession();
        setActiveChatId(next.id);
        return [next];
      }
      if (activeChatId === sessionId) {
        setActiveChatId(remaining[0].id);
      }
      return remaining;
    });
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

  const handleSendChatMessage = async (inputText, options = {}) => {
    const text = String(inputText || '').trim();
    const images = Array.isArray(options?.images)
      ? options.images.filter((item) => (
        item
        && typeof item === 'object'
        && typeof item.data === 'string'
        && typeof item.media_type === 'string'
      ))
      : [];
    const imageAttachmentPreviews = Array.isArray(options?.imageAttachmentPreviews)
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
    if (!text) return;

    let targetSessionId = activeChatId;
    if (!targetSessionId) {
      const created = createEmptyChatSession();
      targetSessionId = created.id;
      setChatSessions((prev) => [created, ...prev]);
      setActiveChatId(created.id);
    }
    if (isChatSessionSending(targetSessionId)) {
      logger.warn('[HomePage][SessionSending] blocked send by session sending', {
        targetSessionId,
        activeChatId,
        sessionSendingMap: chatSessionSendingMap
      });
      return;
    }

    const userMessage = {
      id: createMessageId(),
      role: 'user',
      content: text,
      imageAttachments: imageAttachmentPreviews,
      createdAt: Date.now(),
    };

    const now = Date.now();

    setChatSessions((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== targetSessionId) return item;
        return {
          ...item,
          updatedAt: now,
          messages: [...item.messages, userMessage],
        };
      });
      return sortChatSessions(updated);
    });

    const assistantMessageId = createMessageId();
    const assistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      blocks: [],
      createdAt: Date.now(),
      model: chatModelMeta,
      modelId: chatModel,
      storeAssistantMessageId: null,
    };
    setChatSessions((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== targetSessionId) return item;
        return {
          ...item,
          updatedAt: Date.now(),
          messages: [...item.messages, assistantMessage],
        };
      });
      return sortChatSessions(updated);
    });

    if (!canUseAgentRuntime) {
      const normalizedError = normalizeChatError(new Error('agent runtime unavailable'));
      updateChatAssistantMessage(targetSessionId, assistantMessageId, { error: normalizedError });
      return;
    }

    setChatSessionSending(targetSessionId, true, 'send-start');
    setChatSessionInFlight(targetSessionId, true, 'send-start');
    setChatSessionFulfilled(targetSessionId, false, 'send-start');
    setChatSending(true);
    const requestId = createRequestId();
    try {
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
          const appDataPath = normalizeLocalPath(appInfo?.appDataPath || '');
          if (!appDataPath) {
            throw new Error('创建默认工作空间失败');
          }

          const workspaceParentDir = joinLocalPath(
            appDataPath,
            'Data',
            'Workspaces',
            DEFAULT_RUNTIME_AGENT_ID
          );
          const workspacePath = joinLocalPath(workspaceParentDir, buildAutoWorkspaceName());
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

      const streamController = setupChannelStream(
        appStore.dispatch,
        appStore.getState,
        `home-chat-${targetSessionId}`,
        DEFAULT_RUNTIME_AGENT_ID,
        chatModel
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
      updateChatAssistantMessage(targetSessionId, assistantMessageId, { error: normalizedError });
      setChatSending(false);
    }
  };

  const handleStopChatMessage = () => {
    if (canUseAgentRuntime) {
      const pendingEntries = [...chatPendingByRequestIdRef.current.entries()];
      const active = pendingEntries.find(([, item]) => item.chatId === activeChatId) || pendingEntries[0];
      if (active && active[1]?.agentSessionId) {
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
      const streamController = setupChannelStream(
        appStore.dispatch,
        appStore.getState,
        `home-chat-${activeChatId}`,
        DEFAULT_RUNTIME_AGENT_ID,
        chatModel
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
            <img src={avatarSrc} alt="avatar" className="header-avatar" />
            <span className="header-username">{userName}</span>
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
              selectedPane === 'chat' ? 'center-pane--chat' : ''
            } ${
              selectedPane === 'chat' && chatHistoryAnimated ? 'center-pane--animate' : ''
            } ${
              selectedPane === 'chat' && !chatHistoryVisible ? 'center-pane--collapsed' : ''
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
            {selectedPane === 'chat' && (
              <ChatHistoryList
                sessions={chatSessionsWithStatus}
                activeSessionId={activeChatId}
                onCreateSession={handleCreateChatSession}
                onSelectSession={handleSelectChatSession}
                onDeleteSession={handleDeleteChatSession}
                visible={chatHistoryVisible}
              />
            )}
          </div>
          <div
            className={`right-pane column ${
              selectedPane === 'chat' ? 'right-pane--chat' : ''
            } ${
              selectedPane === 'chat' && !chatHistoryVisible ? 'right-pane--chat-collapsed' : ''
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
            {selectedPane === 'chat' ? (
              <Chat
                session={activeChatSession}
                agentId={DEFAULT_RUNTIME_AGENT_ID}
                runtimeSessionId={activeChatSession?.runtimeSessionId || ''}
                sessionFulfilled={Boolean(activeChatId && chatSessionFulfilledMap[activeChatId])}
                input={chatDraftInput}
                setInput={setChatDraftInput}
                onSendMessage={handleSendChatMessage}
                onStopSending={handleStopChatMessage}
                onCopyAssistantMessage={handleCopyAssistantMessage}
                onRetryAssistantMessage={handleRetryAssistantMessage}
                onDeleteAssistantMessage={handleDeleteAssistantMessage}
                sending={activeChatMessagePaneSending || (!activeChatId && chatSending)}
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
                onQuickPromptAction={(action) => {
                  if (action === 'bootstrap-childrens-picture-book') {
                    void handleBootstrapChildrensPictureBook();
                  }
                  if (action === 'bootstrap-travel-montage') {
                    void handleBootstrapTravelMontage();
                  }
                }}
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
