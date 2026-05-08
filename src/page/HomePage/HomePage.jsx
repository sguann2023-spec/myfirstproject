// HomePage 组件
import React, { useEffect, useRef, useState } from 'react';
import './HomePage.css';
import { electronStore } from '../../shared/electronStore';
import LogoIcon from '../../../public/logo-circle.png';
import { countTodayDrafts } from '../../api/capcut';
import { fetchMessagesSummary, getChatModelList } from '../../api/chat';
import DPane from '../../components/DPane/DPane';
import DraftList from '../../components/DraftList';
import DownloadDualList from '../../components/DownloadDualList/DownloadDualList';
import DraftPreview from '../../components/DraftPreview/DraftPreview';
import logger from '../../shared/logger';
import DownloadList from '../../components/DownloadList/DownloadList';
import DraftDownloadSuccessPreview from '../../components/DraftDownloadSuccessPreview/DraftDownloadSuccessPreview';
import PresetList from '../../components/PresetList/PresetList';
import Preset from '../../components/Preset/Preset';
import ChatHistoryList from '../../components/ChatHistoryList/ChatHistoryList';
import Chat from '../../components/Chat/Chat';
import { tokenStore } from '../../auth';
import { normalizeChatError } from '../../shared/chatError';
import appStore from '../../renderer/src/store';
import { setupChannelStream } from '../../renderer/src/store/thunk/messageThunk';

const CHAT_STORAGE_KEY = 'capcut-helper-chat-sessions-v1';
const CHAT_ACTIVE_ID_KEY = 'capcut-helper-chat-active-id-v1';
const CHAT_MODEL_KEY = 'capcut-helper-chat-model-v1';
const DEFAULT_CHAT_TITLE = '新对话';
const CHAT_MODELS = ['gpt-5.3-codex', 'claude-opus-4-7'];
const VECTCUT_ANTHROPIC_API_BASE_URL = 'https://open.vectcut.com/llm/chat';

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

const toModelOption = (model_id, name, icon = '') => ({
  value: model_id,
  label: name,
  icon,
});

const isModelInOptions = (model, options = []) => {
  const target = String(model || '').trim();
  if (!target) return false;
  return options.some((item) => String(item?.value || '').trim() === target);
};

const createChatId = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createMessageId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const summarizeLogValue = (value) => {
  if (typeof value === 'string') {
    return {
      type: 'string',
      length: value.length,
      preview: value.slice(0, 240)
    };
  }
  if (value === undefined || value === null) {
    return {
      type: String(value),
      length: 0,
      preview: ''
    };
  }
  try {
    const serialized = JSON.stringify(value);
    return {
      type: Array.isArray(value) ? 'array' : typeof value,
      length: serialized.length,
      preview: serialized.slice(0, 240)
    };
  } catch {
    const fallback = String(value);
    return {
      type: typeof value,
      length: fallback.length,
      preview: fallback.slice(0, 240)
    };
  }
};

const summarizeMapKeys = (mapLike, limit = 6) => {
  try {
    if (!mapLike || typeof mapLike.keys !== 'function') return [];
    return [...mapLike.keys()].slice(0, limit);
  } catch {
    return [];
  }
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
    messages: [],
  };
};

const sortChatSessions = (sessions) => {
  return [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};

const buildAssistantDisplayContentFromBlocks = (blocks = []) => {
  const pieces = [];
  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    const type = String(block?.type || '').toLowerCase();
    const content = String(block?.content || '').trim();
    if (!content && type !== 'tool') return;
    if (type === 'thinking') {
      pieces.push(`<think>\n${content}\n</think>`);
      return;
    }
    if (type === 'main_text' || type === 'code') {
      pieces.push(content);
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
    content: buildAssistantDisplayContentFromBlocks(blocks)
  };
};

const HomePage = () => {
  const user = electronStore.get('user') || {};
  const avatarSrc = user?.avatar || LogoIcon;
  const userName = user?.name || '';
  const [todayCount, setTodayCount] = useState(null);
  const [selectedPane, setSelectedPane] = useState('chat');
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [downloadDualView, setDownloadDualView] = useState('downloading');
  const [downloadProject, setDownloadProject] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState(null);
  // 用“选中项”驱动右侧展示
  const [selectedCompleted, setSelectedCompleted] = useState(null);
  const [selectedCompletedKey, setSelectedCompletedKey] = useState(null);
  const [chatSessions, setChatSessions] = useState(() => [createEmptyChatSession()]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatSending, setChatSending] = useState(false);
  const [chatModel, setChatModel] = useState(() => CHAT_MODELS[0]);
  const [chatModelOptions, setChatModelOptions] = useState(() => CHAT_MODELS.map((item) => toModelOption(item)));
  const [chatModelListLoading, setChatModelListLoading] = useState(true);
  const [chatHistoryVisible, setChatHistoryVisible] = useState(false);
  const [chatHistoryAnimated, setChatHistoryAnimated] = useState(false);
  const chatHistoryAnimTimerRef = useRef(null);
  const chatSessionsRef = useRef([]);
  const chatTitleGeneratingSessionIdsRef = useRef(new Set());
  const chatAgentSessionIdByChatIdRef = useRef(new Map());
  const chatIdByAgentSessionIdRef = useRef(new Map());
  const chatPendingByAgentSessionIdRef = useRef(new Map());
  const [chatTitleRenamingSessionIds, setChatTitleRenamingSessionIds] = useState([]);
  const [chatTitleNewlyRenamedSessionIds, setChatTitleNewlyRenamedSessionIds] = useState([]);
  const chatTitleRevealTimersRef = useRef(new Map());
  const canUseAgentRuntime = Boolean(
    window?.electronAPI?.cherryChatStream
    && typeof window.electronAPI.cherryChatStream.createSession === 'function'
  );

  // 暴露一个可复用的计数刷新方法
  const refreshTodayCount = () => {
    return countTodayDrafts()
      .then((res) => {
        const c = typeof res?.count === 'number' ? res.count : 0;
        setTodayCount(c); // 更新界面（第 23-24 行对应逻辑）
      })
      .catch(() => setTodayCount(0));
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
    let cancelled = false;
    void (async () => {
      try {
        const payload = await getChatModelList();
        if (cancelled) return;

        const models = Array.isArray(payload?.models) && payload.models.length > 0
          ? payload.models
          : CHAT_MODELS;
        const iconMap = payload?.blackIconMap || {};
        const nextOptions = models.map((name) => toModelOption(name, name, iconMap?.[name] || ''));
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
            messages: Array.isArray(item.messages) ? item.messages : [],
          }));
        if (normalized.length > 0) {
          const sorted = sortChatSessions(normalized);
          setChatSessions(sorted);
          const activeExists = sorted.some((item) => item.id === rawActiveId);
          setActiveChatId(activeExists ? rawActiveId : sorted[0].id);
          return;
        }
      }
    } catch (error) {
      logger.warn('Failed to load chat sessions from localStorage.', error);
    }
    setActiveChatId((prev) => prev || chatSessions[0]?.id || null);
  }, []);

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
    try {
      localStorage.setItem(CHAT_MODEL_KEY, chatModel);
    } catch (error) {
      logger.warn('Failed to persist chat model settings.', error);
    }
  }, [chatModel]);

  const activeChatSession = chatSessions.find((item) => item.id === activeChatId) || null;

  useEffect(() => {
    chatSessionsRef.current = chatSessions;
  }, [chatSessions]);

  const triggerAutoRenameSessionTitle = async (sessionId) => {
    const id = String(sessionId || '').trim();
    if (!id) return;
    if (chatTitleGeneratingSessionIdsRef.current.has(id)) return;

    const session = chatSessionsRef.current.find((item) => item.id === id);
    if (!session) return;

    const currentTitle = String(session.title || '').trim();
    if (currentTitle && currentTitle !== DEFAULT_CHAT_TITLE) return;

    const normalizedMessages = Array.isArray(session.messages) ? session.messages : [];
    const assistantReplies = normalizedMessages.filter((item) => (
      item?.role === 'assistant'
      && String(item?.content || '').trim()
      && !item?.error
    ));
    const hasAssistantReply = assistantReplies.length > 0;
    const hasUserMessage = normalizedMessages.some((item) => item?.role === 'user' && String(item?.content || '').trim());
    if (!hasUserMessage || !hasAssistantReply) return;
    if (assistantReplies.length !== 1) return;

    const latestAssistant = [...normalizedMessages].reverse().find((item) => item?.role === 'assistant');
    const summaryModel = String(latestAssistant?.model || chatModel || '').trim();
    if (!summaryModel) return;

    chatTitleGeneratingSessionIdsRef.current.add(id);
    setChatTitleRenamingSessionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));

    try {
      const { text } = await fetchMessagesSummary({
        messages: normalizedMessages,
        model: summaryModel
      });
      const nextTitle = String(text || '').trim();
      if (!nextTitle) return;

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

      setChatTitleNewlyRenamedSessionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      const oldTimer = chatTitleRevealTimersRef.current.get(id);
      if (oldTimer) clearTimeout(oldTimer);
      const timer = setTimeout(() => {
        setChatTitleRenamingSessionIds((prev) => prev.filter((item) => item !== id));
        setChatTitleNewlyRenamedSessionIds((prev) => prev.filter((item) => item !== id));
        chatTitleRevealTimersRef.current.delete(id);
      }, 1600);
      chatTitleRevealTimersRef.current.set(id, timer);
    } finally {
      chatTitleGeneratingSessionIdsRef.current.delete(id);
      setChatTitleRenamingSessionIds((prev) => prev.filter((item) => item !== id));
    }
  };


  const ensureAgentSessionForChat = async (chatId) => {
    if (!chatId || !canUseAgentRuntime) return '';
    const cached = chatAgentSessionIdByChatIdRef.current.get(chatId);
    if (cached) return cached;

    const vectcutApiKey = await getAgentApiKeyFromLoginState();
    const modelIds = (chatModelOptions || []).map((item) => String(item?.value || '').trim()).filter(Boolean);
    const runtimeState = buildProvidersState(modelIds.length > 0 ? modelIds : CHAT_MODELS, vectcutApiKey);
    window.store = {
      getState: () => runtimeState,
      dispatch: () => undefined
    };

    logger.info('[HomePage] createSession invoke', {
      chatId,
      agentId: 'vectcut_claw_default',
      model: chatModel,
      hasApiKey: Boolean(vectcutApiKey)
    });
    const created = await window.electronAPI.cherryChatStream.createSession({
      agent_id: 'vectcut_claw_default',
      model: chatModel,
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
    logger.info('[HomePage][StreamTrace] subscribe start', {
      chatId,
      sessionId: agentSessionId
    });
    await window.electronAPI.cherryChatStream.subscribe(agentSessionId);
    logger.info('[HomePage][StreamTrace] subscribe done', {
      chatId,
      sessionId: agentSessionId,
      mappedChatSessionCount: chatAgentSessionIdByChatIdRef.current.size,
      mappedAgentSessionCount: chatIdByAgentSessionIdRef.current.size
    });
    return agentSessionId;
  };

  useEffect(() => {
    if (!canUseAgentRuntime) return;
    if (selectedPane !== 'chat') return;
    if (!activeChatId) return;

    let cancelled = false;
    void (async () => {
      try {
        logger.info('[HomePage] prewarm session on page enter', {
          activeChatId,
          selectedPane,
          model: chatModel
        });
        const sessionId = await ensureAgentSessionForChat(activeChatId);
        if (cancelled) return;
        logger.info('[HomePage] prewarm session ready', {
          activeChatId,
          sessionId
        });
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

      logger.info('[HomePage][ToolPermission] request received', {
        requestId,
        toolName: payload?.toolName || '',
        toolCallId: payload?.toolCallId || '',
        autoApprove: Boolean(payload?.autoApprove)
      });

      try {
        const response = payload?.autoApprove
          ? await window.electronAPI.agentTools.respondToPermission({
            requestId,
            behavior: 'allow',
            updatedInput: payload?.input,
            updatedPermissions: Array.isArray(payload?.suggestions) ? payload.suggestions : undefined
          })
          : await window.electronAPI.agentTools.respondToPermission({
            requestId,
            behavior: 'deny',
            message: 'Tool approval UI is unavailable in HomePage runtime.'
          });

        logger.info('[HomePage][ToolPermission] response sent', {
          requestId,
          ok: Boolean(response?.success),
          behavior: payload?.autoApprove ? 'allow' : 'deny'
        });
      } catch (error) {
        logger.error('[HomePage][ToolPermission] failed to send response', {
          requestId,
          error: error?.message || String(error)
        });
      }
    });

    const offPermissionResult = window.electronAPI.cherryChatStream.onPermissionResult((payload) => {
      logger.info('[HomePage][ToolPermission] result received', {
        requestId: payload?.requestId || '',
        behavior: payload?.behavior || '',
        reason: payload?.reason || ''
      });
    });

    const offChunk = window.electronAPI.cherryChatStream.onChunk((payload) => {
      const agentSessionId = payload?.sessionId;
      if (!agentSessionId) {
        logger.warn('[HomePage][StreamTrace] drop payload without sessionId', {
          payloadType: payload?.type || '',
          chunkType: payload?.chunk?.type || '',
          hasChunk: Boolean(payload?.chunk)
        });
        return;
      }
      const pending = chatPendingByAgentSessionIdRef.current.get(agentSessionId);
      if (!pending) {
        const payloadType = String(payload?.type || '');
        const chunkType = String(payload?.chunk?.type || '');
        const isToolRelated =
          chunkType.startsWith('tool-') || payloadType === 'complete' || payloadType === 'error' || payloadType === 'cancelled';
        if (isToolRelated) {
          logger.warn('[HomePage][StreamTrace] drop payload without pending state', {
            sessionId: agentSessionId,
            payloadType,
            chunkType,
            pendingMapSize: chatPendingByAgentSessionIdRef.current.size,
            knownPendingSessionIds: summarizeMapKeys(chatPendingByAgentSessionIdRef.current),
            knownChatSessionIds: summarizeMapKeys(chatAgentSessionIdByChatIdRef.current)
          });
        }
        return;
      }
      const { chatId, assistantMessageId, streamController, storeAssistantMessageId } = pending;
      const applySnapshot = (error = null) => {
        const snapshot = getAssistantSnapshotFromStore(storeAssistantMessageId || '');
        if (!snapshot) return;
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
                    content: snapshot.content || '',
                    blocks: snapshot.blocks || [],
                    error,
                    updatedAt: Date.now()
                  }
                  : message
              ))
            };
          });
          return sortChatSessions(updated);
        });
      };

      if (payload.type === 'chunk') {
        streamController?.pushChunk(payload.chunk || {});
        applySnapshot(null);
        return;
      }

      if (payload.type === 'error') {
        const errorMessage = String(payload?.error?.message || '');
        if (/JWTTokenIsInvalid|invalid or expired jwt/i.test(errorMessage)) {
          chatPendingByAgentSessionIdRef.current.delete(agentSessionId);
          chatIdByAgentSessionIdRef.current.delete(agentSessionId);
          chatAgentSessionIdByChatIdRef.current.delete(chatId);
        }
        const normalizedError = normalizeChatError(payload?.error || new Error(payload?.error?.message || 'agent request failed'));
        streamController?.error(new Error(errorMessage || 'agent request failed'));
        applySnapshot(normalizedError);
        chatPendingByAgentSessionIdRef.current.delete(agentSessionId);
        setChatSending(false);
        return;
      }

      if (payload.type === 'cancelled') {
        streamController?.error(new DOMException('Request was aborted', 'AbortError'));
        chatPendingByAgentSessionIdRef.current.delete(agentSessionId);
        setChatSending(false);
        return;
      }

      if (payload.type === 'complete') {
        streamController?.complete();
        applySnapshot(null);
        chatPendingByAgentSessionIdRef.current.delete(agentSessionId);
        setChatSending(false);
        void triggerAutoRenameSessionTitle(chatId);
      }
    });
    return () => {
      if (typeof offPermissionRequest === 'function') offPermissionRequest();
      if (typeof offPermissionResult === 'function') offPermissionResult();
      if (typeof offChunk === 'function') offChunk();
    };
  }, [canUseAgentRuntime]);

  const handleCreateChatSession = () => {
    const session = createEmptyChatSession();
    setChatSessions((prev) => [session, ...prev]);
    setActiveChatId(session.id);
  };

  const handleDeleteChatSession = (sessionId) => {
    const timer = chatTitleRevealTimersRef.current.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      chatTitleRevealTimersRef.current.delete(sessionId);
    }
    setChatTitleRenamingSessionIds((prev) => prev.filter((id) => id !== sessionId));
    setChatTitleNewlyRenamedSessionIds((prev) => prev.filter((id) => id !== sessionId));
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

  const handleSendChatMessage = async (inputText) => {
    const text = String(inputText || '').trim();
    if (!text || chatSending) return;

    let targetSessionId = activeChatId;
    if (!targetSessionId) {
      const created = createEmptyChatSession();
      targetSessionId = created.id;
      setChatSessions((prev) => [created, ...prev]);
      setActiveChatId(created.id);
    }

    const userMessage = {
      id: createMessageId(),
      role: 'user',
      content: text,
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
      model: chatModel,
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
      setChatSessions((prev) => {
        const updated = prev.map((item) => {
          if (item.id !== targetSessionId) return item;
          return {
            ...item,
            updatedAt: Date.now(),
            messages: item.messages.map((message) => (
              message.id === assistantMessageId
                ? {
                  ...message,
                  error: normalizedError,
                  updatedAt: Date.now()
                }
                : message
            ))
          };
        });
        return sortChatSessions(updated);
      });
      return;
    }

    setChatSending(true);
    try {
      const agentSessionId = await ensureAgentSessionForChat(targetSessionId);
      logger.info('[HomePage][StreamTrace] register pending before createMessage', {
        chatId: targetSessionId,
        sessionId: agentSessionId,
        assistantMessageId
      });
      const streamController = setupChannelStream(
        appStore.dispatch,
        appStore.getState,
        `home-chat-${targetSessionId}`,
        'vectcut_claw_default',
        chatModel
      );
      chatPendingByAgentSessionIdRef.current.set(agentSessionId, {
        chatId: targetSessionId,
        assistantMessageId,
        storeAssistantMessageId: streamController.assistantMessageId,
        streamController
      });
      const result = await window.electronAPI.cherryChatStream.createMessage({
        sessionId: agentSessionId,
        content: text,
        model: chatModel
      });
      logger.info('[HomePage][StreamTrace] createMessage roundtrip done', {
        chatId: targetSessionId,
        sessionId: agentSessionId,
        assistantMessageId,
        pendingMapSize: chatPendingByAgentSessionIdRef.current.size,
        knownPendingSessionIds: summarizeMapKeys(chatPendingByAgentSessionIdRef.current)
      });
      logger.info('[HomePage] cherryChatStream createMessage result', {
        chatId: targetSessionId,
        sessionId: agentSessionId,
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
      const pendingEntries = [...chatPendingByAgentSessionIdRef.current.entries()];
      const pendingEntry = pendingEntries.find(([, item]) => item.chatId === targetSessionId && item.assistantMessageId === assistantMessageId);
      if (pendingEntry?.[0]) {
        chatPendingByAgentSessionIdRef.current.delete(pendingEntry[0]);
      }
      setChatSessions((prev) => {
        const updated = prev.map((item) => {
          if (item.id !== targetSessionId) return item;
          return {
            ...item,
            updatedAt: Date.now(),
            messages: item.messages.map((message) => (
              message.id === assistantMessageId
                ? {
                  ...message,
                  error: normalizedError,
                  updatedAt: Date.now(),
                }
                : message
            )),
          };
        });
        return sortChatSessions(updated);
      });
      setChatSending(false);
    }
  };

  const handleStopChatMessage = () => {
    if (canUseAgentRuntime) {
      const pendingEntries = [...chatPendingByAgentSessionIdRef.current.entries()];
      const active = pendingEntries.find(([, item]) => item.chatId === activeChatId) || pendingEntries[0];
      if (active && active[0]) {
        void window.electronAPI.cherryChatStream.abort(active[0]);
        setChatSending(false);
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

  const handleRetryAssistantMessage = async (message) => {
    if (chatSending || !activeChatId || !canUseAgentRuntime) return;
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
              ? { ...msg, content: '', blocks: [], error: null, updatedAt: Date.now(), model: chatModel }
              : msg
          )),
        };
      });
      return sortChatSessions(updated);
    });

    setChatSending(true);
    try {
      const agentSessionId = await ensureAgentSessionForChat(activeChatId);
      const streamController = setupChannelStream(
        appStore.dispatch,
        appStore.getState,
        `home-chat-${activeChatId}`,
        'vectcut_claw_default',
        chatModel
      );
      chatPendingByAgentSessionIdRef.current.set(agentSessionId, {
        chatId: activeChatId,
        assistantMessageId: messageId,
        storeAssistantMessageId: streamController.assistantMessageId,
        streamController
      });
      const result = await window.electronAPI.cherryChatStream.createMessage({
        sessionId: agentSessionId,
        content: String(prevUser.content || ''),
        model: chatModel
      });
      if (!result?.ok) throw new Error(result?.error || 'agent retry failed');
    } catch (error) {
      const normalizedError = normalizeChatError(error);
      setChatSessions((prev) => {
        const updated = prev.map((item) => {
          if (item.id !== activeChatId) return item;
          return {
            ...item,
            updatedAt: Date.now(),
            messages: item.messages.map((msg) => (
              msg.id === messageId
                ? { ...msg, error: normalizedError, updatedAt: Date.now(), model: chatModel }
                : msg
            )),
          };
        });
        return sortChatSessions(updated);
      });
      setChatSending(false);
    }
  };

  // 订阅当前下载任务的文件列表，映射为 DownloadList 所需的 project
  useEffect(() => {
    const { DownloadController } = require('../../shared/DownloadController');
    const unsubscribe = DownloadController.subscribeFileList(({ draft_id, fileList }) => {
      const active = Array.isArray(fileList) ? fileList.filter(f => f.status !== 'completed') : [];
      const totalDownloaded = active.reduce((sum, f) => sum + (Number(f.downloaded) || 0), 0);
      const totalTotal = active.reduce((sum, f) => sum + (Number(f.total) || 0), 0);
      const overallProgress = totalTotal > 0 ? Math.round((totalDownloaded / totalTotal) * 100) : 0;
      setDownloadProject({
        draftName: draft_id || '',
        overallProgress,
        overallStatusText: `已下载 ${overallProgress}%`,
        downloadFiles: active,
      });
    });
    return () => { typeof unsubscribe === 'function' && unsubscribe(); };
  }, []);

  // 新增：订阅进度，当当前任务结束（current 为空）时清空右侧项目
  useEffect(() => {
    const { DownloadController } = require('../../shared/DownloadController');
    const unsubscribe = DownloadController.subscribeProgress((snapshot) => {
      if (!snapshot?.current) {
        setDownloadProject(null);
      }
    });
    return () => { typeof unsubscribe === 'function' && unsubscribe(); };
  }, []);

  // 构建“已完成”记录为 DownloadList 的 project（仅失败项需要列表）
  const buildProjectFromCompleted = (item) => {
    if (!item) return { draftName: '', overallProgress: 0, overallStatusText: '', downloadFiles: [] };
    const isSuccess = item.status === 'success';
    const list = isSuccess
      ? []
      : (Array.isArray(item.flatList)
          ? item.flatList
          : (Array.isArray(item.fileList) ? item.fileList.filter(f => f.status === 'failed') : []));
    const totalDownloaded = list.reduce((sum, f) => sum + (Number(f.downloaded) || 0), 0);
    const totalTotal = list.reduce((sum, f) => sum + (Number(f.total) || 0), 0);
    const overallProgress = isSuccess ? 100 : (totalTotal > 0 ? Math.round((totalDownloaded / totalTotal) * 100) : 0);
    return {
      draftName: item.draft_name || item.draft_id || '',
      overallProgress,
      overallStatusText: isSuccess ? '下载完成' : '下载失败',
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
              今天你创作了{todayCount != null ? todayCount : '…'}个草稿
            </span>
        </div>
      {/* 主体三栏 */}
      <div className="home-content">
          <div className="left-pane column">
              <DPane selected={selectedPane} onSelect={setSelectedPane} />
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
                selectedId={selectedDraft?.draft_id}
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
                  setSelectedCompletedKey(item?.jobId ?? `${item.draft_id}-${idx}`);
                }}
              />
            )}
            {selectedPane === 'preset' && (
              <PresetList onSelect={setSelectedPreset} />
            )}
            {selectedPane === 'chat' && (
              <ChatHistoryList
                sessions={chatSessions}
                activeSessionId={activeChatId}
                onCreateSession={handleCreateChatSession}
                onSelectSession={setActiveChatId}
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
            {selectedPane === 'draft' && selectedDraft ? (
              <DraftPreview draft={selectedDraft} />
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
                onSendMessage={handleSendChatMessage}
                onStopSending={handleStopChatMessage}
                onCopyAssistantMessage={handleCopyAssistantMessage}
                onRetryAssistantMessage={handleRetryAssistantMessage}
                onDeleteAssistantMessage={handleDeleteAssistantMessage}
                sending={chatSending}
                model={chatModel}
                modelOptions={chatModelOptions}
                modelListLoading={chatModelListLoading}
                onModelChange={setChatModel}
                historyVisible={chatHistoryVisible}
                onToggleHistory={handleToggleChatHistory}
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
