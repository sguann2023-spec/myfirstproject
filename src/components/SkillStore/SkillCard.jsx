import React from 'react';
import { Check } from 'lucide-react';
import SkillCheckIcon from '../../../public/skill-check.svg';
import SkillEllipsisIcon from '../../../public/skill-ellipsis.svg';
import SkillPlusIcon from '../../../public/skill-plus.svg';

const SkillCard = ({
  skill,
  installed = false,
  enabled = true,
  batchMode = false,
  selected = false,
  onSelect,
  onOpen,
  onInstall,
  onMenu,
  onToggle,
  showToggle = false
}) => {
  const icon = skill?.icon_url || '';

  return (
    <article
      className={`skill-card${installed && !enabled ? ' is-disabled' : ''}${selected ? ' is-selected' : ''}`}
      onClick={() => batchMode ? onSelect?.(skill) : onOpen?.(skill)}
    >
      {batchMode ? (
        <button
          type="button"
          className={`skill-card-checkbox${selected ? ' is-checked' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(skill);
          }}
          aria-label={selected ? '取消选择' : '选择技能'}
        >
          {selected ? <Check size={14} /> : null}
        </button>
      ) : null}

      <div className="skill-card-topline">
        <div className="skill-card-identity">
          {icon ? (
            <img className="skill-card-icon" src={icon} alt="" />
          ) : (
            <div className="skill-card-icon skill-card-icon-fallback">{String(skill?.name || '?').slice(0, 1)}</div>
          )}
          <span className="skill-card-name">{skill?.name || '未命名技能'}</span>
        </div>
        {!batchMode ? (
          installed ? (
            <div className="skill-card-actions" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="skill-card-more" onClick={() => onMenu?.(skill)} aria-label="更多">
                <img src={SkillEllipsisIcon} className="skill-card-action-icon" alt="" aria-hidden="true" />
              </button>
              {showToggle ? (
                <button
                  type="button"
                  className={`skill-card-toggle${enabled ? ' is-on' : ''}`}
                  onClick={() => onToggle?.(skill, !enabled)}
                  aria-label={enabled ? '关闭技能' : '开启技能'}
                ><span /></button>
              ) : null}
              <span className="skill-card-installed" aria-label="已安装"><img src={SkillCheckIcon} className="skill-card-check-icon" alt="" aria-hidden="true" /></span>
            </div>
          ) : (
            <button type="button" className="skill-card-add" onClick={(event) => { event.stopPropagation(); onInstall?.(skill); }} aria-label="添加技能">
              <img src={SkillPlusIcon} className="skill-card-add-icon" alt="" aria-hidden="true" />
            </button>
          )
        ) : (
          <button
            type="button"
            className={`skill-card-toggle${enabled ? ' is-on' : ''}`}
            onClick={(event) => { event.stopPropagation(); onToggle?.(skill, !enabled); }}
            aria-label={enabled ? '关闭技能' : '开启技能'}
          >
            <span />
          </button>
        )}
      </div>

      <p className="skill-card-description">{skill?.description || '暂无技能描述'}</p>
    </article>
  );
};

export default React.memo(SkillCard);
