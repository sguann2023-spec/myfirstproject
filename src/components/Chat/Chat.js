import React from 'react';
import { Provider } from 'react-redux';
import { PinnedTodoPanel } from '@renderer/pages/home/Inputbar/components/PinnedTodoPanel';
import { useActiveTodos } from '@renderer/pages/home/Inputbar/hooks/useActiveTodos';
import ChatShell from './ChatShell/ChatShell';
import MessagePane from './MessagePane/MessagePane';
import Composer from './Composer/Composer';
import appStore from '../../renderer/src/store';

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
const EMPTY_WELCOME_TEXT = '初次见面，你的剪辑伙伴已就位';
const QUICK_PROMPTS = [
  {
    label: '把这条视频的气口去掉',
    prompt: '请处理这个视频(<https://player.install-ai-guider.top/example/koubo_test3.mp4>)，把气口去掉',
  },
  {
    label: '给我添加一下网感字幕',
    prompt: '请基于这个视频(<https://player.install-ai-guider.top/example/koubo_test5.mp4>)添加网感字幕',
  },
  {
    label: '把这几条视频混剪在一起',
    prompt: '将下面的这几条空镜素材混剪在一起(<https://player.install-ai-guider.top/example/broll_real_1.mp4>,<https://player.install-ai-guider.top/example/broll_real_2.mp4>,<https://player.install-ai-guider.top/example/broll_real_3.mp4>,<https://player.install-ai-guider.top/example/broll_real_4.mp4>,<https://player.install-ai-guider.top/example/broll_real_5.mp4>,<https://player.install-ai-guider.top/example/broll_real_6.mp4>,<https://player.install-ai-guider.top/example/broll_real_7.mp4>,<https://player.install-ai-guider.top/example/broll_real_8.mp4>,<https://player.install-ai-guider.top/example/broll_real_9.mp4>,<https://player.install-ai-guider.top/example/broll_real_10.mp4>)',
  }
];
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
const buildHomeChatTopicId = (chatId) => {
  const normalizedChatId = String(chatId || '').trim();
  return normalizedChatId ? `home-chat-${normalizedChatId}` : '';
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

const Chat = ({
  session,
  agentId: agentIdProp,
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
  sessionSending = false,
  model,
  modelOptions = [],
  modelListLoading = false,
  onModelChange,
  historyVisible = true,
  onToggleHistory,
  onCreateSession,
  sessionTitle = '新对话',
  sessionTitleRenaming = false,
  sessionTitleNewlyRenamed = false,
  onRenameSessionTitle,
  userName = '',
  userAvatar = '',
}) => {
  const messageEndRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const agentId = agentIdProp || session?.agentId || session?.agent_id;
  const chatTopicId = React.useMemo(() => buildHomeChatTopicId(session?.id), [session?.id]);

  const messages = normalizeMessages(session);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const insertSkillMention = React.useCallback((skill) => {
    const mentionLabel = String(skill?.name || skill?.id || '').trim();
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
    const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix);
    const mentionText = `${needsLeadingSpace ? ' ' : ''}@${mentionLabel} `;
    const nextText = `${prefix}${mentionText}${suffix}`;
    const nextCursor = prefix.length + mentionText.length;

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

  const handleSend = (nextText) => {
    const text = String(typeof nextText === 'string' ? nextText : input).trim();
    if (!text || sessionSending || modelListLoading) return;
    onSendMessage && onSendMessage(text);
    setInput('');
  };

  return (
    <ChatShell
      agentId={agentId}
      runtimeSessionId={runtimeSessionId}
      historyVisible={historyVisible}
      onToggleHistory={onToggleHistory}
      onCreateSession={onCreateSession}
      sessionTitle={sessionTitle}
      sessionTitleRenaming={sessionTitleRenaming}
      sessionTitleNewlyRenamed={sessionTitleNewlyRenamed}
      onRenameSessionTitle={onRenameSessionTitle}
      onSelectSkill={insertSkillMention}
      onCreateSkill={insertCreateSkillPrompt}>
      <MessagePane
        messages={messages}
        sending={sending}
        onCopyAssistantMessage={onCopyAssistantMessage}
        onRetryAssistantMessage={onRetryAssistantMessage}
        onDeleteAssistantMessage={onDeleteAssistantMessage}
        messageEndRef={messageEndRef}
        onQuickPrompt={(prompt) => {
          setInput(prompt);
          inputRef.current?.focus();
        }}
        quickPrompts={QUICK_PROMPTS}
        emptyWelcomeText={EMPTY_WELCOME_TEXT}
        formatMessageTime={formatMessageTime}
        model={model}
        modelOptions={modelOptions}
        formatModelDisplayName={formatModelDisplayName}
        userName={userName}
        userAvatar={userAvatar}
      />
      <ChatPinnedTodoPanel topicId={chatTopicId} sessionFulfilled={sessionFulfilled} />
      <Composer
        agentId={agentId}
        runtimeSessionId={runtimeSessionId}
        inputRef={inputRef}
        input={input}
        setInput={setInput}
        handleSend={handleSend}
        handleStop={onStopSending}
        sending={sending}
        sessionSending={sessionSending}
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
