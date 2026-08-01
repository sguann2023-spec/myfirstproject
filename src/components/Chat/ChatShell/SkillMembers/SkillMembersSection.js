import { Empty, Tooltip } from 'antd';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Link,
  Play,
  SquarePen,
} from 'lucide-react';
import './SkillMembersSection.css';

const SkillMembersSection = ({
  hasLockedWorkspace,
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
  onOpenSkillWebPreview,
  onRunSkillExample,
  onSelectSkill,
  renderSkillTooltip,
  renderTreeNodes,
  getSkillKey,
  getSkillFolderLabel,
  getSkillDisplayName,
  childrensBookSkillLabel,
}) => {
  if (!hasLockedWorkspace) return null;

  return (
    <>
      <div className="chat-panel__members-title">
        技能成员
        {!skillsLoading && <span className="chat-panel__members-count">{skills.length}</span>}
      </div>
      {skillsLoading && <div className="chat-panel__members-empty">加载中...</div>}
      {!skillsLoading && skillsError && <div className="chat-panel__members-empty">{skillsError}</div>}
      {!skillsLoading && !skillsError && skills.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="未发现技能"
          className="chat-panel__empty-state"
        />
      )}
      {!skillsLoading && !skillsError && skills.map((skill) => {
        const skillKey = getSkillKey(skill);
        const folderLabel = getSkillFolderLabel(skill);
        const displayName = getSkillDisplayName(skill);
        const skillPreviewPath = skillPreviewPaths[skillKey] || '';
        const skillExamplePath = skillExamplePaths[skillKey] || '';
        const isExpanded = expandedSkillKeys.has(skillKey);
        const treeNodes = skillTrees[skillKey] || [];
        const isTreeLoading = Boolean(skillTreeLoading[skillKey]);
        const isChildrensBookSkill = folderLabel === childrensBookSkillLabel || displayName === childrensBookSkillLabel;
        const shouldForceShowActions = isChildrensBookSkill && beginnerGuideOpen && (
          beginnerGuideCurrent === 3 || beginnerGuideCurrent === 4
        );

        return (
          <Tooltip
            key={skillKey}
            title={renderSkillTooltip(skill)}
            placement="leftTop"
            mouseEnterDelay={0.15}
            classNames={{ root: 'chat-panel__member-tooltip-overlay' }}>
            <div className="chat-panel__member-group">
              <div className="chat-panel__member-item">
                <button
                  type="button"
                  className={`chat-panel__tree-toggle chat-panel__tree-toggle--root ${isExpanded ? 'is-expanded' : ''}`}
                  onClick={() => void onToggleSkillExpanded(skill)}
                  aria-label={`${isExpanded ? '折叠' : '展开'} ${folderLabel || displayName}`}>
                  <ChevronRight className="chat-panel__tree-chevron" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="chat-panel__member-main"
                  onClick={() => void onToggleSkillExpanded(skill)}
                  title={folderLabel || displayName}>
                  <span className="chat-panel__tree-icon" aria-hidden="true">
                    {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                  </span>
                  <span className="chat-panel__member-text">
                    <span className="chat-panel__member-name">{folderLabel || displayName}</span>
                  </span>
                </button>
                {(skillPreviewPath || skillExamplePath || typeof onSelectSkill === 'function') && (
                  <div className={`chat-panel__member-actions-overlay ${shouldForceShowActions ? 'chat-panel__member-actions-overlay--visible' : ''}`.trim()}>
                    {skillPreviewPath && skillPreviewPath !== skillExamplePath && (
                      <button
                        type="button"
                        className="chat-panel__member-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenSkillWebPreview(skill);
                        }}
                        title="在内嵌浏览器中打开技能页面"
                        aria-label={`在内嵌浏览器中打开 ${folderLabel || displayName}`}>
                        <Link size={12} aria-hidden="true" />
                      </button>
                    )}
                    {skillExamplePath && (
                      <button
                        type="button"
                        ref={isChildrensBookSkill ? beginnerGuideChildrensBookRunButtonRef : null}
                        className={`chat-panel__member-action ${isChildrensBookSkill && beginnerGuideOpen && beginnerGuideCurrent === 4 ? 'chat-panel__member-action--tour-visible' : ''}`.trim()}
                        onClick={(event) => {
                          event.stopPropagation();
                          void onRunSkillExample(skill);
                        }}
                        title="打开这个技能示例"
                        aria-label={`打开 ${folderLabel || displayName} 示例`}>
                        <Play size={12} aria-hidden="true" />
                      </button>
                    )}
                    {typeof onSelectSkill === 'function' && (
                      <button
                        type="button"
                        ref={isChildrensBookSkill ? beginnerGuideChildrensBookEditButtonRef : null}
                        className={`chat-panel__member-action ${isChildrensBookSkill && beginnerGuideOpen && beginnerGuideCurrent === 3 ? 'chat-panel__member-action--tour-visible' : ''}`.trim()}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectSkill(skill);
                        }}
                        title="编辑这个技能"
                        aria-label={`编辑 ${folderLabel || displayName} 的技能网页`}>
                        <SquarePen size={12} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
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
          </Tooltip>
        );
      })}
      <div className="chat-panel__section-divider" aria-hidden="true" />
    </>
  );
};

export default SkillMembersSection;
