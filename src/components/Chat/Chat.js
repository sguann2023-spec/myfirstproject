import React from 'react';
import { Provider } from 'react-redux';
import { loggerService } from '@logger';
import PinnedDraftPannel from '@renderer/pages/home/Inputbar/components/PinnedDraftPannel/PinnedDraftPannel';
import { PinnedTodoPanel } from '@renderer/pages/home/Inputbar/components/PinnedTodoPanel';
import { useActiveTodos } from '@renderer/pages/home/Inputbar/hooks/useActiveTodos';
import { IpcChannel } from '@shared/IpcChannel';
import { queryScript } from '../../api/capcut';
import { DownloadController } from '../../shared/DownloadController.js';
import ChatShell from './ChatShell/ChatShell';
import MessagePane from './MessagePane/MessagePane';
import Composer from './Composer/Composer';
import appStore from '../../renderer/src/store';
const logger = loggerService.withContext('Chat');

const formatMessageTime = (value) => {
  if (!value) return '';
  try {
    const date = new Date(value);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  } catch (error) {
    return '';
  }
};

const normalizeMessages = (session) => (Array.isArray(session?.messages) ? session.messages : []);
const EMPTY_WELCOME_TEXT = '从剪辑技能开始';
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

const buildPinnedDraftKey = (draft, index = 0) => draft?.id || draft?.draftId || `${draft?.title || draft?.name || 'draft'}-${index}`;

const normalizePinnedDraftFromEvent = (payload = {}) => {
  const draftId = String(payload?.draftId || payload?.draft_id || '').trim();
  if (!draftId) return null;

  const action = payload?.action === 'modify' ? 'modify' : 'create';
  const draftName = String(payload?.name || payload?.title || '').trim();
  const draftStatus = payload?.status === 'in_progress' ? 'in_progress' : 'completed';
  const clientRequestId = String(payload?.clientRequestId || '').trim();
  const nextDraft = {
    id: draftId,
    draftId,
    clientRequestId,
    createdAt: typeof payload?.createdAt === 'number' ? payload.createdAt : Date.now(),
    status: draftStatus
  };

  if (draftName) {
    nextDraft.title = draftName;
    nextDraft.name = draftName;
    nextDraft.activeTitle = draftName;
  } else if (action === 'create') {
    nextDraft.title = draftId;
    nextDraft.name = draftId;
    nextDraft.activeTitle = draftId;
  }

  const cover = String(payload?.cover || '').trim();
  if (cover) {
    nextDraft.cover = cover;
  }

  return nextDraft;
};

const parseQueryScriptOutput = (response) => {
  const output = response?.output || response?.data?.output || response?.result?.output;
  return typeof output === 'string' ? JSON.parse(output) : output;
};

const enqueuePinnedDraftDownload = (draft) => {
  const draftId = String(draft?.id || draft?.draftId || '').trim();
  if (!draftId) return;

  try {
    DownloadController.enqueue({
      draft_id: draftId,
      draft_name: String(draft?.title || draft?.name || draftId).trim(),
      cover: draft?.cover,
      createdAt: draft?.created_at || draft?.createdAt
    });
    logger.info('[Chat] enqueued draft download from pinned draft panel', { draftId });
  } catch (error) {
    logger.warn('[Chat] failed to enqueue draft download from pinned draft panel', {
      draftId,
      error: error?.message || String(error || '')
    });
  }
};

const handleMockDraftDownloadAll = (drafts = []) => {
  drafts.forEach((draft) => enqueuePinnedDraftDownload(draft));
};

const handleMockDraftDownloadItem = (draft) => {
  enqueuePinnedDraftDownload(draft);
};

const ChatPinnedDraftPanel = () => {
  const [drafts, setDrafts] = React.useState(PINNED_DRAFTS);
  const [visible, setVisible] = React.useState(true);
  const [previewLoadingKey, setPreviewLoadingKey] = React.useState(null);
  const [previewErrorKey, setPreviewErrorKey] = React.useState(null);
  const [previewErrorMessage, setPreviewErrorMessage] = React.useState('');
  const previewCacheRef = React.useRef(new Map());
  const pendingPreviewRequestRef = React.useRef(new Set());

  React.useEffect(() => {
    const offDraftCreated = window.ipc?.on(IpcChannel.App_DraftCreated, (payload) => {
      const nextDraft = normalizePinnedDraftFromEvent(payload);
      if (!nextDraft) {
        return;
      }

      setVisible(true);
      setDrafts((currentDrafts) => {
        const pendingIndex = nextDraft.clientRequestId
          ? currentDrafts.findIndex((item) => String(item?.clientRequestId || '').trim() === nextDraft.clientRequestId)
          : -1;
        const existingIndex = currentDrafts.findIndex((item) => String(item?.draftId || item?.id || '').trim() === nextDraft.draftId);
        const targetIndex = pendingIndex >= 0 ? pendingIndex : existingIndex;
        if (targetIndex >= 0) {
          return currentDrafts.map((item, index) => (index === targetIndex ? { ...item, ...nextDraft } : item));
        }
        return [nextDraft, ...currentDrafts];
      });
    });

    return () => {
      offDraftCreated?.();
    };
  }, []);

  const handlePreviewItem = React.useCallback(async (draft) => {
    const draftId = String(draft?.id || draft?.draftId || '').trim();
    logger.info('[ChatPinnedDraftPanel] handle preview item', {
      draftId,
      draftKey: buildPinnedDraftKey(draft),
      title: String(draft?.title || draft?.name || '').trim(),
      hasTrackPreview: Boolean(draft?.trackPreview)
    });
    if (!draftId) {
      logger.warn('[ChatPinnedDraftPanel] skip preview because draftId is empty');
      return;
    }

    const targetKey = buildPinnedDraftKey(draft);
    setPreviewErrorKey(null);
    setPreviewErrorMessage('');

    const cachedPreview = previewCacheRef.current.get(draftId);
    if (cachedPreview) {
      logger.info('[ChatPinnedDraftPanel] apply cached preview before refresh', { draftId, targetKey });
      setDrafts((currentDrafts) => currentDrafts.map((item, index) => (
        buildPinnedDraftKey(item, index) === targetKey
          ? { ...item, trackPreview: cachedPreview }
          : item
      )));
    }

    if (pendingPreviewRequestRef.current.has(targetKey)) {
      logger.info('[ChatPinnedDraftPanel] skip duplicate preview request', { draftId, targetKey });
      return;
    }

    logger.info('[ChatPinnedDraftPanel] start queryScript for preview', { draftId, targetKey });
    pendingPreviewRequestRef.current.add(targetKey);
    setPreviewLoadingKey(targetKey);

    try {
      const response = await queryScript({ draft_id: draftId, force_update: false });
      const ok = response && (response.success === true || response.code === 200);
      logger.info('[ChatPinnedDraftPanel] queryScript finished', {
        draftId,
        targetKey,
        ok,
        code: response?.code,
        success: response?.success
      });
      if (!ok) {
        throw new Error(response?.error || '查询草稿轨道失败');
      }

      const script = parseQueryScriptOutput(response);
      const preview = script;
      previewCacheRef.current.set(draftId, preview);
      logger.info('[ChatPinnedDraftPanel] preview loaded successfully', {
        draftId,
        targetKey,
        trackCount: Array.isArray(preview?.tracks)
          ? preview.tracks.length
          : (preview?.tracks && typeof preview.tracks === 'object' ? Object.keys(preview.tracks).length : 0)
      });
      setDrafts((currentDrafts) => currentDrafts.map((item) => (
        String(item?.id || item?.draftId || '').trim() === draftId
          ? { ...item, trackPreview: preview }
          : item
      )));
    } catch (error) {
      logger.warn('[Chat] failed to load draft track preview', {
        draftId,
        error: error?.message || String(error || '')
      });
      setPreviewErrorKey(targetKey);
      setPreviewErrorMessage(error?.message || '轨道预览加载失败');
    } finally {
      pendingPreviewRequestRef.current.delete(targetKey);
      logger.info('[ChatPinnedDraftPanel] finish preview request', { draftId, targetKey });
      setPreviewLoadingKey((currentKey) => (currentKey === targetKey ? null : currentKey));
    }
  }, []);

  if (!visible) {
    return null;
  }

  const hasInProgressDraft = drafts.some((draft) => draft?.status === 'in_progress');

  return (
    <div style={{ padding: '1px 24px 8px 16px' }}>
      <PinnedDraftPannel
        drafts={drafts}
        sessionActive={hasInProgressDraft}
        sessionFulfilled={!hasInProgressDraft && drafts.length > 0}
        title={hasInProgressDraft ? '草稿处理中' : '草稿处理完成'}
        defaultCollapsed={false}
        onDownloadAll={handleMockDraftDownloadAll}
        onDownloadItem={handleMockDraftDownloadItem}
        onPreviewItem={handlePreviewItem}
        onClose={() => setVisible(false)}
        previewLoadingKey={previewLoadingKey}
        previewErrorKey={previewErrorKey}
        previewErrorMessage={previewErrorMessage}
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
  onDeleteAssistantMessage,
  sending = false,
  historyLoading = false,
  sessionSending = false,
  model,
  modelOptions = [],
  modelListLoading = false,
  onModelChange,
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
  const childrensBookQuickPromptRef = React.useRef(null);
  const beginnerGuideQuickSkillsViewportRef = React.useRef(null);
  const beginnerGuideAiToolAreaRef = React.useRef(null);
  const beginnerGuideModelPickerRef = React.useRef(null);
  const beginnerGuideInputAreaRef = React.useRef(null);
  const [hasConnectedExternalAgent, setHasConnectedExternalAgent] = React.useState(false);
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
    const mentionLabel = String(skill?.name || skill?.folderName || skill?.filename || skill?.id || '').trim();
    if (!mentionLabel) return;

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
    const mentionText = `@${mentionLabel}`;
    const needsLeadingBreak = prefix.length > 0 && !/\s$/.test(prefix);
    const needsTrailingSpace = suffix.length > 0 && !/^\s/.test(suffix);
    const nextText = `${prefix}${needsLeadingBreak ? '\n' : ''}${mentionText}${needsTrailingSpace ? ' ' : ''}${suffix}`;
    const nextCursor = prefix.length + (needsLeadingBreak ? 1 : 0) + mentionText.length;

    setInput(nextText);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }, [input, setInput]);

  const insertSkillModifyPrompt = React.useCallback((skill) => {
    const mentionLabel = String(skill?.name || skill?.folderName || skill?.filename || skill?.id || '').trim();
    if (!mentionLabel) return;

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
    const promptText = `修改@${mentionLabel}`;
    const needsLeadingBreak = prefix.length > 0 && !/\s$/.test(prefix);
    const needsTrailingSpace = suffix.length > 0 && !/^\s/.test(suffix);
    const nextText = `${prefix}${needsLeadingBreak ? '\n' : ''}${promptText}${needsTrailingSpace ? ' ' : ''}${suffix}`;
    const nextCursor = prefix.length + (needsLeadingBreak ? 1 : 0) + promptText.length;

    setInput(nextText);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }, [input, setInput]);

  const insertQuickSkillMention = React.useCallback((skill) => {
    const mentionLabel = String(skill?.name || skill?.folderName || skill?.filename || skill?.id || '').trim();
    if (!mentionLabel) return;

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
    const mentionText = `@${mentionLabel}`;
    const needsLeadingBreak = prefix.length > 0 && !/\s$/.test(prefix);
    const needsTrailingSpace = suffix.length > 0 && !/^\s/.test(suffix);
    const nextText = `${prefix}${needsLeadingBreak ? '\n' : ''}${mentionText}${needsTrailingSpace ? ' ' : ''}${suffix}`;
    const nextCursor = prefix.length + (needsLeadingBreak ? 1 : 0) + mentionText.length;

    setInput(nextText);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
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

  const handleSend = (nextText, options = {}) => {
    const rawText = typeof nextText === 'string'
      ? nextText
      : (nextText && typeof nextText === 'object' ? nextText.text : input);
    const text = String(rawText || '').trim();
    if (!text || sessionSending || modelListLoading) return false;
    onSendMessage && onSendMessage(text, options);
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
      onSubmitFileComment={handleSubmitFileComment}
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
      beginnerGuideEligible={messages.length === 0}>
      <MessagePane
        messages={messages}
        sending={sending}
        historyLoading={historyLoading}
        hasConnectedExternalAgent={hasConnectedExternalAgent}
        onCopyAssistantMessage={onCopyAssistantMessage}
        onRetryAssistantMessage={onRetryAssistantMessage}
        onDeleteAssistantMessage={onDeleteAssistantMessage}
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
        onSelectSkill={insertQuickSkillMention}
        onOpenSkillStore={onOpenSkillStore}
        childrensBookQuickPromptRef={childrensBookQuickPromptRef}
        beginnerGuideQuickSkillsViewportRef={beginnerGuideQuickSkillsViewportRef}
      />
      <ChatPinnedDraftPanel />
      <ChatPinnedTodoPanel topicId={chatTopicId} sessionFulfilled={sessionFulfilled} />
      <Composer
        agentId={agentId}
        runtimeSessionId={runtimeSessionId}
        session={session}
        inputRef={inputRef}
        input={input}
        setInput={setInput}
        handleSend={handleSend}
        handleStop={onStopSending}
        sending={sending}
        sessionSending={sessionSending}
        beginnerGuideAiToolAreaRef={beginnerGuideAiToolAreaRef}
        beginnerGuideModelPickerRef={beginnerGuideModelPickerRef}
        beginnerGuideInputAreaRef={beginnerGuideInputAreaRef}
        model={model}
        modelOptions={modelOptions}
        modelListLoading={modelListLoading}
        onModelChange={onModelChange}
        formatModelDisplayName={formatModelDisplayName}
      />
    </ChatShell>
  );
};

export default Chat;
