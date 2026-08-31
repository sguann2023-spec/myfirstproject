import { useState } from 'react';
import { Folder, SquareArrowOutUpRight, Trash2, X } from 'lucide-react';
import { isChatSessionCompleted } from '../../shared/chatSessionCompletion';
import NewChatIcon from '../../../public/new_chat.svg';
import './ChatHistoryList.css';

const normalizePath = (value = '') => String(value || '').replace(/\\/g, '/').trim().replace(/\/+$/, '');

const getSessionWorkspacePath = (session) => {
  const config = session?.configuration && typeof session.configuration === 'object' ? session.configuration : {};
  return normalizePath(config.selected_workspace_path || session?.accessible_paths?.[0] || '');
};

const getPathBasename = (value = '') => {
  const normalizedPath = normalizePath(value);
  if (!normalizedPath) return '';
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;
};

const ChatHistoryList = ({
  sessions = [],
  activeSessionId,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onDeleteWorkspace,
  visible = true,
}) => {
  const getLastUserMessageTime = (session) => {
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.role === 'user') {
        return Number(message?.createdAt) || new Date(message?.createdAt).getTime() || 0;
      }
    }
    return Number(session?.updatedAt) || new Date(session?.updatedAt).getTime() || 0;
  };

  const sortedSessions = [...sessions].sort((a, b) => {
    const timeA = getLastUserMessageTime(a);
    const timeB = getLastUserMessageTime(b);
    return timeB - timeA;
  });
  const activeWorkspacePath = getSessionWorkspacePath(
    sortedSessions.find((session) => session.id === activeSessionId)
  );
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const listEntries = sortedSessions.reduce((entries, session) => {
    const workspacePath = getSessionWorkspacePath(session);
    if (!workspacePath) {
      entries.push({
        type: 'session',
        key: session.id,
        session,
      });
      return entries;
    }

    const groupKey = workspacePath;
    const existingGroup = entries.find((item) => item.type === 'group' && item.key === groupKey);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      return entries;
    }

    entries.push({
      type: 'group',
      key: groupKey,
      label: getPathBasename(workspacePath) || workspacePath,
      title: workspacePath,
      sessions: [session],
    });
    return entries;
  }, []);

  const renderSessionItem = (session) => {
    const isActive = session.id === activeSessionId;
    const isCompleted = typeof session.isCompleted === 'boolean'
      ? session.isCompleted
      : isChatSessionCompleted({
        isPending: session.isPending,
        isFulfilled: session.isFulfilled
      });

    return (
      <div
        key={session.id}
        className={`chat-history-list__item ${isActive ? 'active' : ''}`}
        onClick={() => onSelectSession && onSelectSession(session.id)}
      >
        <div className="chat-history-list__item-top">
          <span className="chat-history-list__status-slot">
            {session.isPending && (
              <span
                className={`chat-history-list__status-dot is-pending ${isActive ? 'is-active-session' : ''}`}
                aria-label="对话中"
              />
            )}
            {isCompleted && !isActive && (
              <span className="chat-history-list__status-dot is-fulfilled" aria-label="已完成" />
            )}
          </span>
          <div className="chat-history-list__item-title">
            {session.title || '新对话'}
          </div>

          <button
            type="button"
            className="chat-history-list__delete-btn"
            aria-label="删除会话"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteSession && onDeleteSession(session.id);
            }}
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    );
  };

  const toggleGroup = (groupKey) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  };

  const handleOpenWorkspace = (event, workspacePath) => {
    event.stopPropagation();
    if (!workspacePath) return;
    try {
      void window.api.file.openPath(workspacePath);
    } catch (_error) {
      window.toast?.error?.('打开文件夹失败');
    }
  };

  return (
    <div className={`chat-history-list ${visible ? 'is-visible' : 'is-hidden'}`}>
      <div className="chat-history-list__header">
        <div className="chat-history-list__title">会话历史</div>
      </div>

      <div className="chat-history-list__body">
        {sortedSessions.length === 0 ? (
          <div className="chat-history-list__empty">暂无会话记录</div>
        ) : (
          listEntries.map((entry) => {
            if (entry.type === 'session') {
              return renderSessionItem(entry.session);
            }

            const isActiveWorkspace = normalizePath(activeWorkspacePath) === normalizePath(entry.key);

            return (
              <div key={entry.key} className="chat-history-list__group">
                <div
                  className={`chat-history-list__item chat-history-list__group-toggle ${collapsedGroups[entry.key] ? 'is-collapsed' : 'is-expanded'}`}
                  onClick={() => toggleGroup(entry.key)}
                >
                  <div className="chat-history-list__item-top">
                    <span className="chat-history-list__status-slot chat-history-list__group-icon-slot">
                        <Folder size={14} strokeWidth={2} className="chat-history-list__group-icon" />
                    </span>
                    <div className="chat-history-list__item-title chat-history-list__group-title">
                      {entry.label}
                    </div>
                    <div className="chat-history-list__group-actions">
                      <button
                        type="button"
                        className="chat-history-list__group-action"
                        aria-label="打开工作空间文件夹"
                        title="打开工作空间文件夹"
                        onClick={(event) => handleOpenWorkspace(event, entry.key)}
                      >
                        <SquareArrowOutUpRight size={14} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`chat-history-list__group-action chat-history-list__group-action--danger ${isActiveWorkspace ? 'is-disabled' : ''}`.trim()}
                        aria-label="删除工作空间"
                        title={isActiveWorkspace ? '当前对话正在使用该工作空间，无法删除' : '删除工作空间'}
                        disabled={isActiveWorkspace}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteWorkspace && onDeleteWorkspace(entry.key);
                        }}
                      >
                        <Trash2 size={14} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="chat-history-list__group-action"
                        aria-label="在当前工作空间新建对话"
                        title="在当前工作空间新建对话"
                        onClick={(event) => {
                          event.stopPropagation();
                          onCreateSession && onCreateSession({
                            source: 'chat-history-group-new',
                            workspacePath: entry.key
                          });
                        }}
                      >
                        <img className="chat-history-list__group-action-icon" src={NewChatIcon} alt="" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
                {!collapsedGroups[entry.key] && entry.sessions.map((session) => renderSessionItem(session))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ChatHistoryList;
