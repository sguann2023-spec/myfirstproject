import React from 'react';
import { DynamicVirtualList } from '@renderer/components/VirtualList';
import './MessagePane.css';
import MessageGroup from './MessageGroup/MessageGroup';
import WelcomePage from './WelcomePage';

const DEFAULT_GROUP_ESTIMATED_HEIGHT = 180;

const buildGroupKey = (group, index) => `group-${group.role}-${group.messages[0]?.id || index}`;

const buildLastMessageSignature = (messages = []) => {
  if (!Array.isArray(messages) || messages.length === 0) return '';

  const message = messages[messages.length - 1] || {};
  return JSON.stringify({
    id: message.id || '',
    role: message.role || '',
    content: message.content || '',
    createdAt: message.createdAt || '',
    updatedAt: message.updatedAt || '',
    error: message.error?.message || '',
    imageAttachmentCount: Array.isArray(message.imageAttachments) ? message.imageAttachments.length : 0
  });
};

const MeasuredMessageGroup = React.memo(
  ({
    index,
    group,
    onResize,
    onCopyAssistantMessage,
    onRetryAssistantMessage,
    onDeleteAssistantMessage,
    sending,
    formatMessageTime,
    model,
    modelOptions,
    formatModelDisplayName,
    loadingMessageId,
    userName,
    userAvatar,
    messageEndRef,
    isLast
  }) => {
    const groupRef = React.useRef(null);

    React.useLayoutEffect(() => {
      const element = groupRef.current;
      if (!element) return undefined;

      const reportHeight = () => {
        const nextHeight = Math.ceil(element.getBoundingClientRect().height);
        if (nextHeight > 0) {
          onResize(index, nextHeight);
        }
      };

      reportHeight();

      if (typeof ResizeObserver === 'undefined') {
        return undefined;
      }

      const observer = new ResizeObserver(() => {
        reportHeight();
      });

      observer.observe(element);
      return () => observer.disconnect();
    }, [group, index, onResize]);

    React.useEffect(() => {
      if (!messageEndRef || !('current' in messageEndRef) || !isLast) {
        return undefined;
      }

      messageEndRef.current = groupRef.current;
      return () => {
        if (messageEndRef.current === groupRef.current) {
          messageEndRef.current = null;
        }
      };
    }, [isLast, messageEndRef]);

    return (
      <div ref={groupRef}>
        <MessageGroup
          role={group.role}
          messages={group.messages}
          onCopyAssistantMessage={onCopyAssistantMessage}
          onRetryAssistantMessage={onRetryAssistantMessage}
          onDeleteAssistantMessage={onDeleteAssistantMessage}
          actionsDisabled={sending}
          formatMessageTime={formatMessageTime}
          model={model}
          modelOptions={modelOptions}
          formatModelDisplayName={formatModelDisplayName}
          loadingMessageId={loadingMessageId}
          userName={userName}
          userAvatar={userAvatar}
        />
      </div>
    );
  }
);

const MessagePane = ({
  messages,
  sending,
  historyLoading = false,
  onCopyAssistantMessage,
  onRetryAssistantMessage,
  onDeleteAssistantMessage,
  messageEndRef,
  onQuickPrompt,
  quickPrompts,
  emptyWelcomeText,
  formatMessageTime,
  model,
  modelOptions,
  formatModelDisplayName,
  userName,
  userAvatar,
  currentWorkspacePath,
  runtimeSessionId,
  onSelectSkill,
  onOpenSkillStore,
  childrensBookQuickPromptRef,
  beginnerGuideQuickSkillsViewportRef,
}) => {
  const virtualListRef = React.useRef(null);
  const groupSizeMapRef = React.useRef(new Map());
  const autoScrollEnabledRef = React.useRef(true);
  const autoScrollFrameRef = React.useRef(null);
  const previousScrollStateRef = React.useRef({
    count: 0,
    signature: ''
  });
  const visibleMessages = messages;

  const getScrollElement = React.useCallback(() => virtualListRef.current?.scrollElement?.() || null, []);

  const isNearBottom = React.useCallback((element) => {
    if (!element) return true;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceToBottom <= 48;
  }, []);

  const scrollToBottom = React.useCallback((behavior = 'auto') => {
    const element = getScrollElement();
    if (!element) return;

    if (autoScrollFrameRef.current) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      const totalSize = virtualListRef.current?.getTotalSize?.() ?? element.scrollHeight;
      const top = Math.max(totalSize - element.clientHeight, 0);
      element.scrollTo({
        top,
        behavior
      });
    });
  }, [getScrollElement]);

  const loadingMessageId = React.useMemo(() => {
    if (!sending || visibleMessages.length === 0) return null;

    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      const message = visibleMessages[i];
      const role = message?.role;
      if (role === 'assistant') {
        return message.id;
      }
      if (role === 'user') {
        break;
      }
    }

    return null;
  }, [sending, visibleMessages]);

  const groupedMessages = React.useMemo(() => {
    const groups = [];
    visibleMessages.forEach((message) => {
      const role = message.role === 'user' ? 'user' : 'assistant';
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.role === role) {
        lastGroup.messages.push(message);
      } else {
        groups.push({ role, messages: [message] });
      }
    });

    return groups.map((group, index) => ({
      ...group,
      key: buildGroupKey(group, index)
    }));
  }, [visibleMessages]);

  React.useEffect(() => {
    const element = getScrollElement();
    if (!element) return undefined;

    const handleScroll = (event) => {
      autoScrollEnabledRef.current = isNearBottom(event.currentTarget);
    };

    const handleWheelCapture = (event) => {
      if (event.deltaY < 0) {
        autoScrollEnabledRef.current = false;
      }
    };

    element.addEventListener('scroll', handleScroll, { passive: true });
    element.addEventListener('wheel', handleWheelCapture, { capture: true, passive: true });
    autoScrollEnabledRef.current = isNearBottom(element);

    return () => {
      element.removeEventListener('scroll', handleScroll);
      element.removeEventListener('wheel', handleWheelCapture, true);
    };
  }, [getScrollElement, groupedMessages.length, isNearBottom]);

  React.useEffect(() => {
    const nextCount = Array.isArray(visibleMessages) ? visibleMessages.length : 0;
    const nextSignature = buildLastMessageSignature(visibleMessages);
    const previousState = previousScrollStateRef.current;
    const hasNewMessage = nextCount > previousState.count;
    const hasLastMessageChanged = nextSignature !== previousState.signature;

    if (autoScrollEnabledRef.current) {
      if (hasNewMessage) {
        scrollToBottom('smooth');
      } else if (hasLastMessageChanged) {
        scrollToBottom('auto');
      }
    }

    previousScrollStateRef.current = {
      count: nextCount,
      signature: nextSignature
    };
  }, [scrollToBottom, visibleMessages]);

  React.useEffect(() => () => {
    if (autoScrollFrameRef.current) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
    }
  }, []);

  React.useEffect(() => {
    virtualListRef.current?.measure?.();
  }, [groupedMessages.length]);

  const handleGroupResize = React.useCallback((index, size) => {
    const previousSize = groupSizeMapRef.current.get(index);
    if (previousSize === size) return;

    groupSizeMapRef.current.set(index, size);
    virtualListRef.current?.resizeItem?.(index, size);

    if (autoScrollEnabledRef.current) {
      scrollToBottom('auto');
    }
  }, [scrollToBottom]);

  const estimateGroupSize = React.useCallback(
    (index) => groupSizeMapRef.current.get(index) || DEFAULT_GROUP_ESTIMATED_HEIGHT,
    []
  );

  return (
    <div className="chat-panel__message-pane">
      {historyLoading && visibleMessages.length === 0 ? (
        <div className="chat-panel__messages">
          <div className="chat-panel__history-loading" role="status" aria-live="polite">
            <div className="chat-panel__history-loading-spinner" />
            <div className="chat-panel__history-loading-title">正在加载对话记录</div>
            <div className="chat-panel__history-loading-subtitle">请稍候...</div>
          </div>
        </div>
      ) : visibleMessages.length === 0 ? (
        <div className="chat-panel__messages">
          {messages.length === 0 ? (
            <WelcomePage
              emptyWelcomeText={emptyWelcomeText}
              quickPrompts={quickPrompts}
              onQuickPrompt={onQuickPrompt}
              currentWorkspacePath={currentWorkspacePath}
              runtimeSessionId={runtimeSessionId}
              onSelectSkill={onSelectSkill}
              onOpenSkillStore={onOpenSkillStore}
              childrensBookQuickPromptRef={childrensBookQuickPromptRef}
              beginnerGuideQuickSkillsViewportRef={beginnerGuideQuickSkillsViewportRef}
            />
          ) : (
            <div className="chat-panel__empty">没有匹配的消息</div>
          )}
        </div>
      ) : (
        <DynamicVirtualList
          ref={virtualListRef}
          className="chat-panel__messages"
          list={groupedMessages}
          estimateSize={estimateGroupSize}
          overscan={4}
          scrollerStyle={{
            padding: '12px 14px'
          }}>
          {(group, index) => (
            <MeasuredMessageGroup
              key={group.key}
              index={index}
              group={group}
              onResize={handleGroupResize}
              onCopyAssistantMessage={onCopyAssistantMessage}
              onRetryAssistantMessage={onRetryAssistantMessage}
              onDeleteAssistantMessage={onDeleteAssistantMessage}
              sending={sending}
              formatMessageTime={formatMessageTime}
              model={model}
              modelOptions={modelOptions}
              formatModelDisplayName={formatModelDisplayName}
              loadingMessageId={loadingMessageId}
              userName={userName}
              userAvatar={userAvatar}
              messageEndRef={messageEndRef}
              isLast={index === groupedMessages.length - 1}
            />
          )}
        </DynamicVirtualList>
      )}
    </div>
  );
};

const areMessagesEqual = (prevMessages = [], nextMessages = []) => {
  if (prevMessages === nextMessages) return true;
  if (!Array.isArray(prevMessages) || !Array.isArray(nextMessages)) return false;
  if (prevMessages.length !== nextMessages.length) return false;
  for (let i = 0; i < prevMessages.length; i += 1) {
    const prev = prevMessages[i] || {};
    const next = nextMessages[i] || {};
    if (
      prev.id !== next.id
      || prev.role !== next.role
      || prev.content !== next.content
      || prev.createdAt !== next.createdAt
      || prev.updatedAt !== next.updatedAt
    ) {
      return false;
    }
  }
  return true;
};

const areModelOptionsEqual = (prevOptions = [], nextOptions = []) => {
  if (prevOptions === nextOptions) return true;
  if (!Array.isArray(prevOptions) || !Array.isArray(nextOptions)) return false;
  if (prevOptions.length !== nextOptions.length) return false;
  for (let i = 0; i < prevOptions.length; i += 1) {
    const prev = prevOptions[i];
    const next = nextOptions[i];
    if (typeof prev !== typeof next) return false;
    if (typeof prev === 'string') {
      if (prev !== next) return false;
      continue;
    }
    const prevValue = prev?.value || prev?.name || prev?.id || '';
    const nextValue = next?.value || next?.name || next?.id || '';
    const prevLabel = prev?.label || prev?.name || prev?.value || prev?.id || '';
    const nextLabel = next?.label || next?.name || next?.value || next?.id || '';
    const prevIcon = prev?.icon || prev?.iconUrl || prev?.black_icon || '';
    const nextIcon = next?.icon || next?.iconUrl || next?.black_icon || '';
    if (prevValue !== nextValue || prevLabel !== nextLabel || prevIcon !== nextIcon) {
      return false;
    }
  }
  return true;
};

export default React.memo(MessagePane, (prevProps, nextProps) => (
  areMessagesEqual(prevProps.messages, nextProps.messages)
  && prevProps.sending === nextProps.sending
  && prevProps.historyLoading === nextProps.historyLoading
  && prevProps.onCopyAssistantMessage === nextProps.onCopyAssistantMessage
  && prevProps.onRetryAssistantMessage === nextProps.onRetryAssistantMessage
  && prevProps.onDeleteAssistantMessage === nextProps.onDeleteAssistantMessage
  && prevProps.messageEndRef === nextProps.messageEndRef
  && prevProps.onQuickPrompt === nextProps.onQuickPrompt
  && prevProps.quickPrompts === nextProps.quickPrompts
  && prevProps.emptyWelcomeText === nextProps.emptyWelcomeText
  && prevProps.formatMessageTime === nextProps.formatMessageTime
  && prevProps.model === nextProps.model
  && areModelOptionsEqual(prevProps.modelOptions, nextProps.modelOptions)
  && prevProps.formatModelDisplayName === nextProps.formatModelDisplayName
  && prevProps.userName === nextProps.userName
  && prevProps.userAvatar === nextProps.userAvatar
  && prevProps.currentWorkspacePath === nextProps.currentWorkspacePath
  && prevProps.runtimeSessionId === nextProps.runtimeSessionId
  && prevProps.onSelectSkill === nextProps.onSelectSkill
));
