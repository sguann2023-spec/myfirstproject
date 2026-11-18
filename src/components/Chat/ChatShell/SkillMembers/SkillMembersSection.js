import React from 'react';
import { Dropdown, Empty, Popover } from 'antd';
import {
  AtSign,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Link,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Search,
  SquarePen,
  Trash2,
} from 'lucide-react';
import '../ArtifactPreview.css';
import './SkillMembersSection.css';

const SkillPreviewCover = ({ src }) => {
  const [failed, setFailed] = React.useState(false);

  return (
    <div className="artifact-preview__cover">
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className="skill-members-section__cover-placeholder" role="img" aria-label="暂无封面">
          <ImageIcon size={24} aria-hidden="true" />
        </span>
      )}
    </div>
  );
};

const SkillMembersSection = ({
  title = '技能成员',
  variant = 'sidebar',
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
  skillMembersCollapsed,
  onToggleSkillMembersCollapsed,
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
  const showToggleAll = !skillsLoading && !skillsError && skills.length > 0;
  const isPreview = variant === 'preview';
  const Section = isPreview ? 'div' : React.Fragment;
  const Title = isPreview ? 'h1' : 'span';
  const toggleLabel = `${skillMembersCollapsed ? '展开' : '折叠'}${title}`;

  return (
    <Section {...(isPreview ? { className: 'skill-members-section skill-members-section--preview' } : {})}>
      <div className="chat-panel__members-title chat-panel__members-title--skills">
        <Title className={`chat-panel__members-title-text${isPreview ? ' skill-members-section__preview-title' : ''}`}>
          {title}
          {!skillsLoading && <span className="chat-panel__members-count">{skills.length}</span>}
        </Title>
        {isPreview ? (
          <button
            type="button"
            className="skill-members-section__view-all"
            onClick={onOpenSkillStore}>
            查看所有技能 <ChevronRight size={14} aria-hidden="true" />
          </button>
        ) : showToggleAll && (
          <button
            type="button"
            className="chat-panel__members-toggle-all"
            onClick={onToggleSkillMembersCollapsed}
            aria-label={toggleLabel}
            title={toggleLabel}>
            {skillMembersCollapsed
              ? <ListChevronsUpDown size={14} strokeWidth={1.9} aria-hidden="true" />
              : <ListChevronsDownUp size={14} strokeWidth={1.9} aria-hidden="true" />}
          </button>
        )}
      </div>
      {(isPreview || !skillMembersCollapsed) && (<>
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

        const viewSkill = (event) => {
          event?.stopPropagation?.();
          if (!hasWebExampleAction) return;
          if (skillExamplePath) {
            void onRunSkillExample(skill);
          } else {
            onOpenSkillWebPreview(skill);
          }
          closeTooltip();
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
                onClick={viewSkill}
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

        if (isPreview) return (
          <div
            key={skillKey}
            className={`artifact-preview__item skill-members-section__card ${hasWebExampleAction ? 'is-clickable' : ''}`.trim()}
            role={hasWebExampleAction ? 'button' : undefined}
            tabIndex={hasWebExampleAction ? 0 : undefined}
            aria-label={hasWebExampleAction ? `查看 ${primaryLabel}` : undefined}
            onClick={viewSkill}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || !hasWebExampleAction || !['Enter', ' '].includes(event.key)) return;
              event.preventDefault();
              viewSkill(event);
            }}>
            <SkillPreviewCover key={skill.__exampleCoverSrc || ''} src={skill.__exampleCoverSrc} />
            <div className="artifact-preview__item-main">
              <span className="artifact-preview__item-title">{primaryLabel}</span>
              <div className="skill-members-section__description">{skill.description || ''}</div>
            </div>
            <div className="skill-members-section__card-actions">
              <button
                type="button"
                className="artifact-preview__export"
                disabled={!hasMentionAction}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectSkill(skill);
                }}
                aria-label={`使用 ${primaryLabel}`}>
                使用
              </button>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    ...(hasWebExampleAction ? [{ key: 'view', label: '查看' }] : []),
                    ...(hasModifyPromptAction ? [{ key: 'modify', label: '修改' }] : []),
                    ...(hasDeleteAction ? [{ key: 'delete', label: '删除', danger: true }] : [])
                  ],
                  onClick: ({ key, domEvent }) => {
                    domEvent.stopPropagation();
                    if (key === 'view') viewSkill(domEvent);
                    if (key === 'modify') onModifySkill(skill);
                    if (key === 'delete') void onDeleteSkill(skill);
                  }
                }}>
                <button
                  type="button"
                  className="artifact-preview__export"
                  disabled={!hasWebExampleAction && !hasModifyPromptAction && !hasDeleteAction}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`更多 ${primaryLabel}`}>
                  <Ellipsis size={16} aria-hidden="true" />
                </button>
              </Dropdown>
            </div>
          </div>
        );

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
      </>)}
      {!isPreview && <div className="chat-panel__section-divider" aria-hidden="true" />}
    </Section>
  );
};

export default SkillMembersSection;
