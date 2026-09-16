import React from 'react';
import { Empty, Popover } from 'antd';
import {
  AtSign,
  ChevronRight,
  Folder,
  FolderOpen,
  Link,
  Search,
  SquarePen,
  Trash2,
} from 'lucide-react';
import './SkillMembersSection.css';

const SkillMembersSection = ({
  skillsLoading,
  skillsError,
  skills,
  skillPreviewPaths,
  skillExamplePaths,
  expandedSkillKeys,
  skillTrees,
  skillTreeLoading,
  beginnerGuideOpen,
  beginnerGuideCurrent,
  beginnerGuideChildrensBookRunButtonRef,
  beginnerGuideChildrensBookEditButtonRef,
  onToggleSkillExpanded,
  onOpenSkillStore,
  onOpenSkillWebPreview,
  onRunSkillExample,
  onSelectSkill,
  onModifySkill,
  onDeleteSkill,
  renderSkillTooltip,
  renderTreeNodes,
  getSkillKey,
  getSkillFolderLabel,
  getSkillDisplayName,
  childrensBookSkillLabel,
}) => {
  const [openTooltipSkillKey, setOpenTooltipSkillKey] = React.useState('');

  return (
    <>
      <div className="chat-panel__members-title">
        技能成员
        {!skillsLoading && <span className="chat-panel__members-count">{skills.length}</span>}
      </div>
      {skillsLoading && <div className="chat-panel__members-empty">加载中...</div>}
      {!skillsLoading && skillsError && <div className="chat-panel__members-empty">{skillsError}</div>}
      {!skillsLoading && !skillsError && skills.length === 0 && (
        <div className="chat-panel__members-empty-state">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="未发现技能"
            className="chat-panel__empty-state"
          />
        </div>
      )}
      {!skillsLoading && !skillsError && skills.map((skill) => {
        const skillKey = getSkillKey(skill);
        const folderLabel = getSkillFolderLabel(skill);
        const skillName = getSkillDisplayName(skill);
        const skillPreviewPath = skillPreviewPaths[skillKey] || '';
        const skillExamplePath = skillExamplePaths[skillKey] || '';
        const isExpanded = expandedSkillKeys.has(skillKey);
        const treeNodes = skillTrees[skillKey] || [];
        const isTreeLoading = Boolean(skillTreeLoading[skillKey]);
        const isChildrensBookSkill = skillName === childrensBookSkillLabel || folderLabel === childrensBookSkillLabel;
        const primaryLabel = skillName || folderLabel;
        const hasWebExampleAction = Boolean(skillExamplePath || skillPreviewPath);
        const hasMentionAction = typeof onSelectSkill === 'function';
        const hasModifyPromptAction = typeof onModifySkill === 'function';
        const hasDeleteAction = typeof onDeleteSkill === 'function';
        const hasActionMenu = hasWebExampleAction || hasMentionAction || hasModifyPromptAction || hasDeleteAction;
        const isTooltipOpen = openTooltipSkillKey === skillKey;

        const closeTooltip = () => {
          setOpenTooltipSkillKey((current) => (current === skillKey ? '' : current));
        };

        const tooltipActions = hasActionMenu ? (
          <div className="chat-panel__member-tooltip-actions" onClick={(event) => event.stopPropagation()}>
            {hasMentionAction && (
              <button
                type="button"
                className="chat-panel__member-tooltip-action"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectSkill(skill);
                  closeTooltip();
                }}
                title={`使用 ${primaryLabel}`}
                aria-label={`使用 ${primaryLabel}`}>
                <AtSign size={14} aria-hidden="true" />
                <span className="chat-panel__member-tooltip-action-label">使用</span>
              </button>
            )}
            {hasModifyPromptAction && (
              <button
                type="button"
                ref={isChildrensBookSkill ? beginnerGuideChildrensBookEditButtonRef : null}
                className="chat-panel__member-tooltip-action"
                onClick={(event) => {
                  event.stopPropagation();
                  onModifySkill(skill);
                  closeTooltip();
                }}
                title={`修改 ${primaryLabel}`}
                aria-label={`修改 ${primaryLabel}`}>
                <SquarePen size={14} aria-hidden="true" />
                <span className="chat-panel__member-tooltip-action-label">修改</span>
              </button>
            )}
            {hasWebExampleAction && (
              <button
                type="button"
                ref={isChildrensBookSkill ? beginnerGuideChildrensBookRunButtonRef : null}
                className="chat-panel__member-tooltip-action"
                onClick={(event) => {
                  event.stopPropagation();
                  if (skillExamplePath) {
                    void onRunSkillExample(skill);
                  } else {
                    onOpenSkillWebPreview(skill);
                  }
                  closeTooltip();
                }}
                title={`${primaryLabel} 网页`}
                aria-label={`${primaryLabel} 网页`}>
                <Link size={14} aria-hidden="true" />
                <span className="chat-panel__member-tooltip-action-label">网页</span>
              </button>
            )}
            {hasDeleteAction && (
              <button
                type="button"
                className="chat-panel__member-tooltip-action chat-panel__member-tooltip-action--danger"
                onClick={(event) => {
                  event.stopPropagation();
                  void onDeleteSkill(skill);
                  closeTooltip();
                }}
                title={`删除 ${primaryLabel}`}
                aria-label={`删除 ${primaryLabel}`}>
                <Trash2 size={14} aria-hidden="true" />
                <span className="chat-panel__member-tooltip-action-label">删除</span>
              </button>
            )}
          </div>
        ) : null;

        return (
          <Popover
            key={skillKey}
            content={renderSkillTooltip(skill, tooltipActions)}
            placement="leftTop"
            trigger="hover"
            mouseEnterDelay={0.15}
            mouseLeaveDelay={0.1}
            open={isTooltipOpen}
            onOpenChange={(nextOpen) => {
              setOpenTooltipSkillKey(nextOpen ? skillKey : '');
            }}
            classNames={{ root: 'chat-panel__member-tooltip-overlay' }}>
            <div className="chat-panel__member-group">
              <div className="chat-panel__member-item">
                <button
                  type="button"
                  className={`chat-panel__tree-toggle chat-panel__tree-toggle--root ${isExpanded ? 'is-expanded' : ''}`}
                  onClick={() => void onToggleSkillExpanded(skill)}
                  aria-label={`${isExpanded ? '折叠' : '展开'} ${primaryLabel}`}>
                  <ChevronRight className="chat-panel__tree-chevron" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="chat-panel__member-main"
                  onClick={() => void onToggleSkillExpanded(skill)}
                  title={primaryLabel}>
                  <span className="chat-panel__tree-icon" aria-hidden="true">
                    {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                  </span>
                  <span className="chat-panel__member-text">
                    <span className="chat-panel__member-name">{primaryLabel}</span>
                  </span>
                </button>
              </div>
              {isExpanded && (
                <div className="chat-panel__member-tree">
                  {isTreeLoading && <div className="chat-panel__members-empty">加载目录中...</div>}
                  {!isTreeLoading && treeNodes.length === 0 && (
                    <div className="chat-panel__members-empty">目录为空</div>
                  )}
                  {!isTreeLoading && treeNodes.length > 0 && renderTreeNodes(skillKey, skill?.__skillRoot, treeNodes)}
                </div>
              )}
            </div>
          </Popover>
        );
      })}
      {!skillsLoading && !skillsError && skills.length === 0 && (
        <button
          type="button"
          className="chat-panel__find-skills-button"
          onClick={onOpenSkillStore}
        >
          <Search size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>寻找技能</span>
        </button>
      )}
      <div className="chat-panel__section-divider" aria-hidden="true" />
    </>
  );
};

export default SkillMembersSection;
