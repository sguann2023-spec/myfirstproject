import React from 'react';
import { Tooltip } from 'antd';
import './ChatShell.css';
import SidebarToggleIcon from '../../Icons/SidebarToggleIcon';

const ChatShell = ({
  agentId,
  historyVisible = true,
  onToggleHistory,
  sessionTitle = '新对话',
  sessionTitleRenaming = false,
  sessionTitleNewlyRenamed = false,
  onRenameSessionTitle,
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
    const loadSkills = async () => {
      const api = window?.electronAPI?.agentSkills;
      console.info('[ChatShell] loadSkills start', {
        agentId,
        hasElectronAPI: Boolean(window?.electronAPI),
        hasAgentSkills: Boolean(api),
        hasListActive: Boolean(api && typeof api.listActive === 'function')
      });
      if (!agentId) {
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
        const result = await api.listActive({ agentId });
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
    return () => {
      cancelled = true;
    };
  }, [agentId]);

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
            {!skillsLoading && <span className="chat-panel__members-count">({skills.length})</span>}
          </div>
          <div className="chat-panel__members-list">
            {skillsLoading && <div className="chat-panel__members-empty">加载中...</div>}
            {!skillsLoading && skillsError && <div className="chat-panel__members-empty">{skillsError}</div>}
            {!skillsLoading && !skillsError && skills.length === 0 && (
              <div className="chat-panel__members-empty">未发现技能</div>
            )}
            {!skillsLoading && !skillsError && skills.map((skill) => (
              <div className="chat-panel__member-item" key={skill.id || skill.name}>
                <div className="chat-panel__member-name">{skill.name || skill.id}</div>
                {skill.description ? (
                  <div className="chat-panel__member-desc" title={skill.description}>
                    {skill.description}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatShell;
