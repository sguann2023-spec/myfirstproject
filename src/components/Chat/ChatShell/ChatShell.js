import React from 'react';
import { Tooltip } from 'antd';
import './ChatShell.css';
import SidebarToggleIcon from '../../Icons/SidebarToggleIcon';

const ChatShell = ({
  agentId,
  runtimeSessionId,
  historyVisible = true,
  onToggleHistory,
  sessionTitle = '新对话',
  sessionTitleRenaming = false,
  sessionTitleNewlyRenamed = false,
  onRenameSessionTitle,
  onSelectSkill,
  children
}) => {
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(sessionTitle);
  const [skillsLoading, setSkillsLoading] = React.useState(true);
  const [skillsError, setSkillsError] = React.useState('');
  const [skills, setSkills] = React.useState([]);
  const titleInputRef = React.useRef(null);

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

  React.useEffect(() => {
    let cancelled = false;
    let removeSkillsChangedListener = null;
    const loadSkills = async () => {
      const api = window?.electronAPI?.agentSkills;
      const cherryChatStream = window?.electronAPI?.cherryChatStream;
      console.info('[ChatShell] loadSkills start', {
        agentId,
        runtimeSessionId,
        hasElectronAPI: Boolean(window?.electronAPI),
        hasAgentSkills: Boolean(api),
        hasListActive: Boolean(api && typeof api.listActive === 'function'),
        hasListLocal: Boolean(api && typeof api.listLocal === 'function'),
        hasCherryChatStream: Boolean(cherryChatStream && typeof cherryChatStream.getSession === 'function')
      });
      if (!runtimeSessionId && !agentId) {
        if (!cancelled) {
          setSkills([]);
          setSkillsError('');
          setSkillsLoading(false);
        }
        return;
      }
      if (!api || typeof api.listActive !== 'function') {
        if (!cancelled) {
          setSkills([]);
          setSkillsError('技能服务不可用');
          setSkillsLoading(false);
        }
        return;
      }

      setSkillsLoading(true);
      setSkillsError('');
      try {
        let result = null;
        if (
          runtimeSessionId &&
          cherryChatStream &&
          typeof cherryChatStream.getSession === 'function' &&
          typeof api.listLocal === 'function'
        ) {
          const sessionResult = await cherryChatStream.getSession(runtimeSessionId);
          const accessiblePaths = sessionResult?.ok ? sessionResult?.session?.accessible_paths : [];
          const workdir = accessiblePaths?.[1] || '';
          if (workdir) {
            result = await api.listLocal({ workdir });
          }
        }
        if (!result) {
          result = await api.listActive({ agentId });
        }
        console.info('[ChatShell] loadSkills result', result);
        if (cancelled) return;
        if (!result?.ok) {
          setSkills([]);
          setSkillsError(result?.error || '加载技能失败');
          return;
        }
        setSkills(Array.isArray(result.skills) ? result.skills : []);
      } catch (error) {
        console.error('[ChatShell] loadSkills error', error);
        if (!cancelled) {
          setSkills([]);
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
  }, [agentId, runtimeSessionId]);

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

  const renderSkillTooltip = (skill) => {
    if (!skill?.description) return null;

    return (
      <div className="chat-panel__member-tooltip">
        <div className="chat-panel__member-tooltip-name">{skill.name || skill.id}</div>
        <div className="chat-panel__member-tooltip-desc">{skill.description}</div>
      </div>
    );
  };

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

      <div className="chat-panel__content">
        <div className="chat-panel__main">
          {children}
        </div>
        <div className="chat-panel__members">
          <div className="chat-panel__members-title">
            技能成员
            {!skillsLoading && <span className="chat-panel__members-count">{skills.length}</span>}
          </div>
          <div className="chat-panel__members-list">
            {skillsLoading && <div className="chat-panel__members-empty">加载中...</div>}
            {!skillsLoading && skillsError && <div className="chat-panel__members-empty">{skillsError}</div>}
            {!skillsLoading && !skillsError && skills.length === 0 && (
              <div className="chat-panel__members-empty">未发现技能</div>
            )}
            {!skillsLoading && !skillsError && skills.map((skill) => (
              <Tooltip
                key={skill.id || skill.name}
                title={renderSkillTooltip(skill)}
                placement="leftTop"
                mouseEnterDelay={0.15}
                classNames={{ root: 'chat-panel__member-tooltip-overlay' }}>
                <div
                  className="chat-panel__member-item"
                  onClick={() => onSelectSkill && onSelectSkill(skill)}>
                  <div className="chat-panel__member-name">{skill.name || skill.id}</div>
                </div>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatShell;
