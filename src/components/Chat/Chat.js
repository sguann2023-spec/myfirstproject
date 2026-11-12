import React from 'react';
import { Provider } from 'react-redux';
import { loggerService } from '@logger';
import PinnedArtifactPannel from '@renderer/pages/home/Inputbar/components/PinnedArtifactPannel/PinnedArtifactPannel';
import { PinnedTodoPanel } from '@renderer/pages/home/Inputbar/components/PinnedTodoPanel';
import { useActiveTodos } from '@renderer/pages/home/Inputbar/hooks/useActiveTodos';
import { IpcChannel } from '@shared/IpcChannel';
import { queryScript } from '../../api/capcut';
import { DownloadController } from '../../shared/DownloadController.js';
import ChatShell from './ChatShell/ChatShell';
import { ChatTaskContext } from './ChatShell/ChatTaskContext';
import MessagePane from './MessagePane/MessagePane';
import Composer from './Composer/Composer';
import { sendQueue } from './sendQueue';
import { createArtifactChatReference } from './artifactFileTarget';
import { useArtifactAutoPreview } from './useArtifactAutoPreview';
import SendQueuePanel from './SendQueuePanel';
import {
  buildSkillExampleApplyDetail,
  dispatchSkillExampleApply,
  dispatchSkillExampleReset,
  loadSkillExample,
  stashPendingSkillExample
} from './Composer/skillExample';
import appStore from '../../renderer/src/store';
const logger = loggerService.withContext('Chat');

// Inserts text at the chat input cursor (or appends when unfocused) and
// restores focus/selection afterwards.
const insertTextAtInputCursor = ({ input, setInput, inputRef, buildInsertion }) => {
  const currentText = String(input || '');
  const inputElement = inputRef.current;
  const isInputFocused = typeof inputElement?.isFocused === 'function'
    ? inputElement.isFocused()
    : inputElement && document.activeElement === inputElement;
  const selectionRange = typeof inputElement?.getSelectionRange === 'function'
    ? inputElement.getSelectionRange()
    : {
      start: isInputFocused ? (inputElement?.selectionStart ?? currentText.length) : currentText.length,
      end: isInputFocused ? (inputElement?.selectionEnd ?? currentText.length) : currentText.length,
    };
  const selectionStart = selectionRange?.start ?? currentText.length;
  const selectionEnd = selectionRange?.end ?? selectionStart;
  const prefix = currentText.slice(0, selectionStart);
  const suffix = currentText.slice(selectionEnd);
  const { text, cursor } = buildInsertion(prefix, suffix);

  setInput(text);
  window.requestAnimationFrame(() => {
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(cursor, cursor);
  });
};

const getSkillMentionLabel = (skill) => String(skill?.name || skill?.folderName || skill?.filename || skill?.id || '').trim();

// Shared 使用 handler: skills shipping an example.json usage template fill
// the input with the example prompt and attach its example videos instead of
// inserting a bare @mention. Returns true when the example was applied.
const applySkillExampleToInput = async (skill, { input, setInput, inputRef }) => {
  const mentionLabel = getSkillMentionLabel(skill);
  if (!mentionLabel) return false;

  const example = await loadSkillExample(skill);
  if (example) {
    const detail = { ...buildSkillExampleApplyDetail(example, mentionLabel), originalInput: input,
      title: skill.title || example.title, fromHomepage: Boolean(skill.directoryPath),
      quickSource: skill.directoryPath ? { folderName: skill.folderName, version: skill.version } : null };
    stashPendingSkillExample(detail);
    dispatchSkillExampleApply(detail);
    return true;
  }
  return false;
};

const formatMessageTime = (value) => {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
    // 当天的消息只展示 hh:mm，更早的展示 mm/dd hh:mm
    if (isToday) return `${hours}:${minutes}`;
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  } catch (error) {
    return '';
  }
};

const normalizeMessages = (session) => (Array.isArray(session?.messages) ? session.messages : []);
const EMPTY_WELCOME_TEXT = '今天想要做什么视频？';
const CREATE_SKILL_PROMPT_TEMPLATE = [
  '请用 skill-creator 帮我创建一个技能。',
  '',
  '- 技能名字：xxx',
  '- 这个技能负责：xxx',
  '- 当我需要 xxx，或者执行 xxx 任务的时候，需要调用它',
  '- 它的第一步：xxx',
  '- 它的第二步：xxx',
  '- 它的第三步：xxx',
  '- 它通常接收的输入：xxx',
  '- 它最终应该输出：xxx',
  '- 它更适合的剪辑场景：短视频文案 / 编导策划 / 脚本生成 / 分镜拆解 / 混剪执行 / 字幕包装 / 其他',
  '- 如果需要固定脚本、工具或工作流，也请一起设计',
  '',
].join('\n');
const formatModelDisplayName = (value) => String(value || '').trim();
const buildFileCommentMessage = ({ filePath, fileName, lineNumber, comment }) => {
  const targetPath = String(filePath || fileName || '').trim();
  const targetLine = Number(lineNumber || 0);
  const normalizedComment = String(comment || '').trim();
  return [
    '请根据以下代码评论修改文件：',
    `文件：${targetPath || '未知文件'}`,
    `行号：${targetLine || '未知行号'}`,
    `评论内容：${normalizedComment}`
  ].join('\n');
};
const buildHomeChatTopicId = (chatId) => {
  const normalizedChatId = String(chatId || '').trim();
  return normalizedChatId ? `home-chat-${normalizedChatId}` : '';
};
const PINNED_DRAFTS = [];
const LOCAL_MCP_AGENTS_UPDATED_EVENT = 'vectcut-local-mcp-agents-updated';
const hasRegisteredExternalAgent = (agents = []) => (
  Array.isArray(agents) && agents.some((agent) => agent?.registrationStatus === 'registered')
);

const ARTIFACT_PREVIEW_KEY = 'chat-artifact:pinned-drafts';

// draftId 是服务端可查询的草稿 ID；id 可能是产物索引的内部 UUID，不能用于服务端调用
const buildPinnedDraftKey = (draft, index = 0) => draft?.draftId || draft?.id || `${draft?.title || draft?.name || 'draft'}-${index}`;

const parseQueryScriptOutput = (response) => {
  const output = response?.output || response?.data?.output || response?.result?.output;
  return typeof output === 'string' ? JSON.parse(output) : output;
};

const enqueuePinnedDraftDownload = (draft) => {
  const draftId = String(draft?.draftId || draft?.id || '').trim();
  if (!draftId) return;

  try {
    DownloadController.enqueue({
      draft_id: draftId,
      draft_name: String(draft?.title || draft?.name || draftId).trim(),
      cover: draft?.cover,
      createdAt: draft?.created_at || draft?.createdAt
    });
    logger.info('[Chat] enqueued draft download from artifact preview', { draftId });
  } catch (error) {
    logger.warn('[Chat] failed to enqueue draft download from artifact preview', {
      draftId,
      error: error?.message || String(error || '')
    });
  }
};

// 草稿变化时自动打开产物预览，也支持点击胶囊重新打开。
const ChatPinnedDraftPanel = ({ drafts, audios, images, videos, documents, sessionId, historyLoading }) => {
  const taskContext = React.useContext(ChatTaskContext);
  const previewSequence = React.useRef(0);
  const openPreview = () => taskContext?.openAttachmentPreview?.({
    key: `${ARTIFACT_PREVIEW_KEY}:${sessionId}:${Date.now()}:${++previewSequence.current}`,
    tabId: `${ARTIFACT_PREVIEW_KEY}:${sessionId}`,
    sessionId,
    previewType: 'artifact',
    title: '产出',
    activate: true
  });
  useArtifactAutoPreview({ sessionId, drafts, audios, images, videos, documents, historyLoading, onOpen: openPreview });

  if (!drafts?.length && !audios?.length && !images?.length && !videos?.length && !documents?.length) {
    return null;
  }

  return (
    <div className="pinned-draft-floating-anchor">
      <PinnedArtifactPannel
        drafts={drafts}
        audios={audios}
        images={images} videos={videos} documents={documents}
        onClick={openPreview}
      />
    </div>
  );
};

const ChatPinnedTodoPanelContent = ({ topicId, sessionFulfilled = false }) => {
  const activeTodoInfo = useActiveTodos(topicId);

  if (!activeTodoInfo) return null;

  return (
    <div style={{ padding: '1px 24px 8px 16px' }}>
      <PinnedTodoPanel topicId={topicId} sessionFulfilled={sessionFulfilled} />
    </div>
  );
};

const ChatPinnedTodoPanel = ({ topicId, sessionFulfilled = false }) => {
  if (!topicId) return null;

  return (
    <Provider store={appStore}>
      <ChatPinnedTodoPanelContent topicId={topicId} sessionFulfilled={sessionFulfilled} />
    </Provider>
  );
};

const getSessionWorkspacePath = (session) => {
  const config = session?.configuration && typeof session.configuration === 'object' ? session.configuration : {};
  return String(config.selected_workspace_path || session?.accessible_paths?.[0] || '').trim();
};

const Chat = ({
  session,
  agentId: agentIdProp,
  chatSessionId,
  runtimeSessionId,
  sessionFulfilled = false,
  input,
  setInput,
  onSendMessage,
  onStopSending,
  onCopyAssistantMessage,
  onRetryAssistantMessage,
  sending = false,
  historyLoading = false,
  sessionSending = false,
  model,
  modelOptions = [],
  modelThinkingLevels = {},
  onModelThinkingLevelChange,
  modelListLoading = false,
  onModelChange,
  onOpenModelSettings,
  historyVisible = true,
  onToggleHistory,
  onCreateSession,
  onEnsureRuntimeSession,
  workspaceStatus = '',
  sessionTitle = '新对话',
  sessionTitleRenaming = false,
  sessionTitleNewlyRenamed = false,
  onRenameSessionTitle,
  userName = '',
  userAvatar = '',
  webPreview = null,
  previewWindowReady = true,
  onCloseWebPreview,
  onOpenWebPreview,
  onInlinePreviewVisibilityChange,
  onQuickPromptAction,
  beginnerGuideDownloadPaneRef = null,
  beginnerGuideSettingsPaneRef = null,
  onRefreshCredits,
  onOpenSkillStore,
}) => {
  const messageEndRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const restoreQueuedDraftRef = React.useRef(null);
  const childrensBookQuickPromptRef = React.useRef(null);
  const beginnerGuideQuickSkillsViewportRef = React.useRef(null);
  const beginnerGuideAiToolAreaRef = React.useRef(null);
  const beginnerGuideModelPickerRef = React.useRef(null);
  const beginnerGuideInputAreaRef = React.useRef(null);
  const [hasConnectedExternalAgent, setHasConnectedExternalAgent] = React.useState(false);
  const ownerId = session?.id;
  const pinnedAudios = session?.pinnedAudios || [];
  const pinnedImages = session?.pinnedImages || [];
  const pinnedDocuments = session?.pinnedDocuments || [];
  const pinnedVideos = session?.pinnedVideos || [];
  const sourceDrafts = session?.pinnedDrafts || PINNED_DRAFTS;
  const [previewState, setPreviewState] = React.useState({});
  const { loading: pinnedDraftPreviewLoadingKey = null, error: pinnedDraftPreviewErrorKey = null,
    message: pinnedDraftPreviewErrorMessage = '' } = previewState[ownerId] || {};
  const setPreviewField = (field, value) => setPreviewState((state) => ({ ...state,
    [ownerId]: { ...state[ownerId], [field]: typeof value === 'function' ? value(state[ownerId]?.[field]) : value } }));
  const setPinnedDraftPreviewLoadingKey = (value) => setPreviewField('loading', value);
  const setPinnedDraftPreviewErrorKey = (value) => setPreviewField('error', value);
  const setPinnedDraftPreviewErrorMessage = (value) => setPreviewField('message', value);
  const [previewCache, setPreviewCache] = React.useState({});
  const pinnedDrafts = sourceDrafts.map((draft) => ({ ...draft,
    trackPreview: previewCache[JSON.stringify([ownerId, String(draft.draftId || draft.id || '').trim()])] }));
  const pinnedDraftPendingPreviewRef = React.useRef(new Set());

  const handlePinnedDraftPreviewItem = React.useCallback(async (draft) => {
    const draftId = String(draft?.draftId || draft?.id || '').trim();
    const targetKey = buildPinnedDraftKey(draft);
    const cacheKey = JSON.stringify([ownerId, draftId]);
    if (!draftId) {
      logger.warn('[Chat] skip pinned draft preview because draftId is empty');
      return;
    }

    setPinnedDraftPreviewErrorKey(null);
    setPinnedDraftPreviewErrorMessage('');

    if (pinnedDraftPendingPreviewRef.current.has(cacheKey)) {
      logger.info('[Chat] skip duplicate pinned draft preview request', { draftId, targetKey });
      return;
    }

    pinnedDraftPendingPreviewRef.current.add(cacheKey);
    setPinnedDraftPreviewLoadingKey(targetKey);

    try {
      const response = await queryScript({ draft_id: draftId, force_update: false });
      const ok = response && (response.success === true || response.code === 200);
      if (!ok) {
        throw new Error(response?.error || '查询草稿轨道失败');
      }

      const preview = parseQueryScriptOutput(response);
      setPreviewCache((cache) => ({ ...cache, [cacheKey]: preview }));
    } catch (error) {
      logger.warn('[Chat] failed to load pinned draft track preview', {
        draftId,
        error: error?.message || String(error || '')
      });
      setPinnedDraftPreviewErrorKey(targetKey);
      setPinnedDraftPreviewErrorMessage(error?.message || '轨道预览加载失败');
    } finally {
      pinnedDraftPendingPreviewRef.current.delete(cacheKey);
      setPinnedDraftPreviewLoadingKey((currentKey) => (currentKey === targetKey ? null : currentKey));
    }
  }, [ownerId]);

  const handlePinnedDraftDownloadItem = React.useCallback((draft) => {
    enqueuePinnedDraftDownload(draft);
  }, []);

  const hasInProgressPinnedDraft = pinnedDrafts.some((draft) => draft?.status === 'in_progress');
  const agentId = agentIdProp || session?.agentId || session?.agent_id;
  const chatTopicId = React.useMemo(() => buildHomeChatTopicId(session?.id), [session?.id]);
  const currentWorkspacePath = React.useMemo(() => getSessionWorkspacePath(session), [session]);
  const currentModelMeta = React.useMemo(() => {
    const selectedModel = String(model || '').trim();
    const matchedOption = (Array.isArray(modelOptions) ? modelOptions : []).find((item) => {
      if (!item || typeof item !== 'object') return false;
      const candidateValue = String(item?.value || item?.id || item?.name || '').trim();
      return candidateValue && candidateValue === selectedModel;
    }) || null;

    return {
      name: String(matchedOption?.label || matchedOption?.displayText || selectedModel || '').trim(),
      icon: String(matchedOption?.icon || matchedOption?.iconUrl || matchedOption?.black_icon || '').trim()
    };
  }, [model, modelOptions]);

  const messages = normalizeMessages(session);

  const refreshLocalMcpConnectionState = React.useCallback(async () => {
    try {
      const detectedAgents = await window.api?.localMcp?.detectAgents?.();
      setHasConnectedExternalAgent(hasRegisteredExternalAgent(detectedAgents));
    } catch (error) {
      setHasConnectedExternalAgent(false);
    }
  }, []);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  React.useEffect(() => {
    void refreshLocalMcpConnectionState();

    const handleWindowFocus = () => {
      void refreshLocalMcpConnectionState();
    };
    const handleLocalMcpAgentsUpdated = (event) => {
      const detectedAgents = Array.isArray(event?.detail?.detectedAgents)
        ? event.detail.detectedAgents
        : null;
      if (detectedAgents) {
        setHasConnectedExternalAgent(hasRegisteredExternalAgent(detectedAgents));
        return;
      }
      void refreshLocalMcpConnectionState();
    };

    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener(LOCAL_MCP_AGENTS_UPDATED_EVENT, handleLocalMcpAgentsUpdated);
    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener(LOCAL_MCP_AGENTS_UPDATED_EVENT, handleLocalMcpAgentsUpdated);
    };
  }, [refreshLocalMcpConnectionState]);

  const insertSkillMention = React.useCallback((skill) => {
    const mentionLabel = getSkillMentionLabel(skill);
    if (!mentionLabel) return;

    return (async () => {
      if (await applySkillExampleToInput(skill, { input, setInput, inputRef })) return;

      insertTextAtInputCursor({
        input,
        setInput,
        inputRef,
        buildInsertion: (prefix, suffix) => {
          const mentionText = `@${mentionLabel}`;
          const needsLeadingBreak = prefix.length > 0 && !/\s$/.test(prefix);
          const needsTrailingSpace = suffix.length > 0 && !/^\s/.test(suffix);
          return {
            text: `${prefix}${needsLeadingBreak ? '\n' : ''}${mentionText}${needsTrailingSpace ? ' ' : ''}${suffix}`,
            cursor: prefix.length + (needsLeadingBreak ? 1 : 0) + mentionText.length
          };
        }
      });
    })();
  }, [input, setInput]);

  const insertSkillModifyPrompt = React.useCallback((skill) => {
    const mentionLabel = String(skill?.name || skill?.folderName || skill?.filename || skill?.id || '').trim();
    if (!mentionLabel) return;

    dispatchSkillExampleReset();
    const nextText = `修改@${mentionLabel}技能，我想要`;
    setInput(nextText);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextText.length, nextText.length);
    });
  }, [setInput]);

  const insertQuickSkillMention = React.useCallback((skill) => {
    const mentionLabel = getSkillMentionLabel(skill);
    if (!mentionLabel) return;

    return (async () => {
      if (await applySkillExampleToInput(skill, { input, setInput, inputRef })) return;

      insertTextAtInputCursor({
        input,
        setInput,
        inputRef,
        buildInsertion: (prefix, suffix) => {
          const mentionText = `@${mentionLabel}`;
          const needsLeadingBreak = prefix.length > 0 && !/\s$/.test(prefix);
          const needsTrailingSpace = suffix.length > 0 && !/^\s/.test(suffix);
          return {
            text: `${prefix}${needsLeadingBreak ? '\n' : ''}${mentionText}${needsTrailingSpace ? ' ' : ''}${suffix}`,
            cursor: prefix.length + (needsLeadingBreak ? 1 : 0) + mentionText.length
          };
        }
      });
    })();
  }, [input, setInput]);

  const insertCreateSkillPrompt = React.useCallback(() => {
    const nextText = CREATE_SKILL_PROMPT_TEMPLATE;
    const firstPlaceholderIndex = nextText.indexOf('xxx');
    const cursorStart = firstPlaceholderIndex >= 0 ? firstPlaceholderIndex : nextText.length;
    const cursorEnd = firstPlaceholderIndex >= 0 ? firstPlaceholderIndex + 3 : nextText.length;

    setInput(nextText);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (typeof inputRef.current?.setSelectionRange === 'function') {
        inputRef.current.setSelectionRange(cursorStart, cursorEnd);
      }
    });
  }, [input, setInput]);

  const [, refreshQueue] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    sendQueue.listeners.add(refreshQueue);
    return () => sendQueue.listeners.delete(refreshQueue);
  }, []);
  React.useEffect(() => {
    if (!modelListLoading) {
      let dispatchSessionId = ownerId;
      sendQueue.pump(ownerId, (text, options) => onSendMessage(text, {
        ...options,
        queueSessionId: dispatchSessionId,
        onQueueSession: (id) => {
          sendQueue.relocate(dispatchSessionId, id);
          dispatchSessionId = id;
        }
      }), sessionSending);
    }
  });
  const stopQueuedSession = () => {
    sendQueue.pause(ownerId);
    onStopSending?.();
  };
  const handleSend = (nextText, options = {}) => {
    const rawText = typeof nextText === 'string'
      ? nextText
      : (nextText && typeof nextText === 'object' ? nextText.text : input);
    const text = String(rawText || '').trim();
    if (!text || modelListLoading || !onSendMessage) return false;
    sendQueue.submit(ownerId, text, { ...options, queueModel: options.queueModel ?? options.model ?? model });
    setInput('');
    return true;
  };

  const handleSubmitFileComment = React.useCallback((payload = {}) => {
    const nextMessage = buildFileCommentMessage(payload);
    return handleSend(nextMessage);
  }, [handleSend]);

  React.useEffect(() => {
    const offSendText = window.ipc?.on(IpcChannel.App_SendTextToMain, (nextText) => {
      const normalizedText = String(nextText || '').trim();
      logger.info('Received App_SendTextToMain in chat renderer', {
        textLength: normalizedText.length,
        sessionSending: Boolean(sessionSending),
        modelListLoading: Boolean(modelListLoading)
      });
      const sent = handleSend(nextText);
      if (!sent) {
        logger.info('Fell back to filling chat input from App_SendTextToMain', {
          textLength: normalizedText.length
        });
        setInput(normalizedText);
        window.requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      } else {
        logger.info('Sent message immediately from App_SendTextToMain', {
          textLength: normalizedText.length
        });
      }
    });

    return () => {
      offSendText?.();
    };
  }, [handleSend]);

  return (
    <ChatShell
      agentId={agentId}
      chatSessionId={chatSessionId || session?.id || ''}
      runtimeSessionId={runtimeSessionId}
      historyVisible={historyVisible}
      onToggleHistory={onToggleHistory}
      onCreateSession={onCreateSession}
      onEnsureRuntimeSession={onEnsureRuntimeSession}
      workspaceStatus={workspaceStatus}
      sessionTitle={sessionTitle}
      sessionTitleRenaming={sessionTitleRenaming}
      sessionTitleNewlyRenamed={sessionTitleNewlyRenamed}
      currentModelMeta={currentModelMeta}
      onRenameSessionTitle={onRenameSessionTitle}
      onSelectSkill={insertSkillMention}
      onOpenSkillStore={onOpenSkillStore}
      onModifySkill={insertSkillModifyPrompt}
      onCreateSkill={insertCreateSkillPrompt}
      onAddWorkspaceFile={(file) => inputRef.current?.insertLocalFileReference(file)}
      onAddArtifactToChat={(item) => {
        const entry = createArtifactChatReference(item);
        if (entry) inputRef.current?.insertLocalFileReference(entry);
      }}
      onAddDraftToChat={(draft) => inputRef.current?.insertDraftReference(draft)}
      onSubmitFileComment={handleSubmitFileComment}
      onSubmitToolTask={handleSend}
      sessionSending={sessionSending}
      webPreview={webPreview}
      previewWindowReady={previewWindowReady}
      onCloseWebPreview={onCloseWebPreview}
      onOpenWebPreview={onOpenWebPreview}
      onInlinePreviewVisibilityChange={onInlinePreviewVisibilityChange}
      childrensBookQuickPromptRef={childrensBookQuickPromptRef}
      beginnerGuideQuickSkillsViewportRef={beginnerGuideQuickSkillsViewportRef}
      beginnerGuideAiToolAreaRef={beginnerGuideAiToolAreaRef}
      beginnerGuideModelPickerRef={beginnerGuideModelPickerRef}
      beginnerGuideInputAreaRef={beginnerGuideInputAreaRef}
      beginnerGuideDownloadPaneRef={beginnerGuideDownloadPaneRef}
      beginnerGuideSettingsPaneRef={beginnerGuideSettingsPaneRef}
      onRefreshCredits={onRefreshCredits}
      pinnedAudios={pinnedAudios}
      pinnedImages={pinnedImages}
      pinnedVideos={pinnedVideos}
      pinnedDocuments={pinnedDocuments}
      pinnedDrafts={pinnedDrafts}
      pinnedDraftSessionActive={hasInProgressPinnedDraft}
      pinnedDraftSessionFulfilled={!hasInProgressPinnedDraft && pinnedDrafts.length > 0}
      onPinnedDraftPreviewItem={handlePinnedDraftPreviewItem}
      onPinnedDraftDownloadItem={handlePinnedDraftDownloadItem}
      pinnedDraftPreviewLoadingKey={pinnedDraftPreviewLoadingKey}
      pinnedDraftPreviewErrorKey={pinnedDraftPreviewErrorKey}
      pinnedDraftPreviewErrorMessage={pinnedDraftPreviewErrorMessage}
      beginnerGuideEligible={messages.length === 0 && !sending && !historyLoading}>
      <MessagePane
        messages={messages}
        chatSessionId={chatSessionId || session?.id}
        sending={sending}
        historyLoading={historyLoading}
        hasConnectedExternalAgent={hasConnectedExternalAgent}
        onCopyAssistantMessage={onCopyAssistantMessage}
        onRetryAssistantMessage={onRetryAssistantMessage}
        messageEndRef={messageEndRef}
        onQuickPrompt={(prompt) => {
          if (prompt && typeof prompt === 'object' && prompt.action) {
            return onQuickPromptAction ? onQuickPromptAction(prompt.action) : Promise.resolve();
          }
          setInput(typeof prompt === 'string' ? prompt : '');
          inputRef.current?.focus();
          return Promise.resolve();
        }}
        emptyWelcomeText={EMPTY_WELCOME_TEXT}
        formatMessageTime={formatMessageTime}
        model={model}
        modelOptions={modelOptions}
        formatModelDisplayName={formatModelDisplayName}
        userName={userName}
        userAvatar={userAvatar}
        currentWorkspacePath={currentWorkspacePath}
        runtimeSessionId={runtimeSessionId}
        onOpenWebPreview={onOpenWebPreview}
        onSelectSkill={insertQuickSkillMention}
        onOpenSkillStore={onOpenSkillStore}
        childrensBookQuickPromptRef={childrensBookQuickPromptRef}
        beginnerGuideQuickSkillsViewportRef={beginnerGuideQuickSkillsViewportRef}
      />
      <ChatPinnedDraftPanel drafts={pinnedDrafts} audios={pinnedAudios} images={pinnedImages} videos={pinnedVideos} documents={pinnedDocuments} sessionId={ownerId} historyLoading={historyLoading} />
      <ChatPinnedTodoPanel topicId={chatTopicId} sessionFulfilled={sessionFulfilled} />
      <div className="chat-panel__composer-anchor">
        <div className="chat-panel__queue-overlay">
          <SendQueuePanel sessionId={ownerId} stop={onStopSending} busy={sessionSending} onEdit={item => restoreQueuedDraftRef.current?.(item)} />
        </div>
      <Composer
        agentId={agentId}
        runtimeSessionId={runtimeSessionId}
        session={session}
        inputRef={inputRef}
        restoreQueuedDraftRef={restoreQueuedDraftRef}
        input={input}
        setInput={setInput}
        handleSend={handleSend}
        handleStop={stopQueuedSession}
        sending={sending}
        sessionSending={sessionSending}
        beginnerGuideAiToolAreaRef={beginnerGuideAiToolAreaRef}
        beginnerGuideModelPickerRef={beginnerGuideModelPickerRef}
        beginnerGuideInputAreaRef={beginnerGuideInputAreaRef}
        model={model}
        modelOptions={modelOptions}
        modelThinkingLevels={modelThinkingLevels}
        onModelThinkingLevelChange={onModelThinkingLevelChange}
        modelListLoading={modelListLoading}
        onModelChange={onModelChange}
        onOpenModelSettings={onOpenModelSettings}
        formatModelDisplayName={formatModelDisplayName}
      />
      </div>
    </ChatShell>
  );
};

export default Chat;
