import React from 'react';
import ChatShell from './ChatShell/ChatShell';
import MessagePane from './MessagePane/MessagePane';
import Composer from './Composer/Composer';

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
const formatModelDisplayName = (value) => (
  String(value || '')
    .split('-')
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'gpt') return 'GPT';
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('-')
);

const Chat = ({
  session,
  agentId: agentIdProp,
  runtimeSessionId,
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
  sessionTitle = '新对话',
  sessionTitleRenaming = false,
  sessionTitleNewlyRenamed = false,
  onRenameSessionTitle,
  userName = '',
  userAvatar = '',
}) => {
  const messageEndRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const prevMessageCountRef = React.useRef(0);
  const agentId = agentIdProp || session?.agentId || session?.agent_id;

  const messages = normalizeMessages(session);

  React.useEffect(() => {
    const nextCount = Array.isArray(messages) ? messages.length : 0;
    const prevCount = prevMessageCountRef.current;
    if (nextCount > prevCount) {
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevMessageCountRef.current = nextCount;
  }, [messages]);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const insertSkillMention = React.useCallback((skill) => {
    const mentionLabel = String(skill?.name || skill?.id || '').trim();
    if (!mentionLabel) return;

    const currentText = String(input || '');
    const inputElement = inputRef.current;
    const isInputFocused = inputElement && document.activeElement === inputElement;
    const selectionStart = isInputFocused ? (inputElement.selectionStart ?? currentText.length) : currentText.length;
    const selectionEnd = isInputFocused ? (inputElement.selectionEnd ?? selectionStart) : selectionStart;
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
      sessionTitle={sessionTitle}
      sessionTitleRenaming={sessionTitleRenaming}
      sessionTitleNewlyRenamed={sessionTitleNewlyRenamed}
      onRenameSessionTitle={onRenameSessionTitle}
      onSelectSkill={insertSkillMention}>
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
