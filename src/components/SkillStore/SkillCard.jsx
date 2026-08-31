import React from 'react';
import { LoaderCircle } from 'lucide-react';
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
  installing = false,
  onMenu,
  onToggle,
  actionMenu = null,
  showToggle = false,
  showCheck = true
}) => {
  const icon = skill?.icon_url || '';

  return (
    <article
      className={`skill-card${installed && !enabled ? ' is-disabled' : ''}${selected ? ' is-selected' : ''}${batchMode ? ' is-batch-mode' : ''}`}
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
          {selected ? <img src={SkillCheckIcon} className="skill-card-checkbox-icon" alt="" aria-hidden="true" /> : null}
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
              <div className="skill-card-more-wrap">
                <button type="button" className="skill-card-more" onClick={() => onMenu?.(skill)} aria-label="更多">
                  <img src={SkillEllipsisIcon} className="skill-card-action-icon" alt="" aria-hidden="true" />
                </button>
                {actionMenu}
              </div>
              {showToggle ? (
                <button
                  type="button"
                  className={`skill-card-toggle${enabled ? ' is-on' : ''}`}
                  onClick={() => onToggle?.(skill, !enabled)}
                  aria-label={enabled ? '关闭技能' : '开启技能'}
                ><span /></button>
              ) : null}
              {showCheck ? <span className="skill-card-installed" aria-label="已安装"><img src={SkillCheckIcon} className="skill-card-check-icon" alt="" aria-hidden="true" /></span> : null}
            </div>
          ) : (
            <button
              type="button"
              className={`skill-card-add${installing ? ' is-loading' : ''}`}
              onClick={(event) => { event.stopPropagation(); onInstall?.(skill); }}
              disabled={installing}
              aria-label={installing ? '正在安装技能' : '添加技能'}
              aria-busy={installing}
            >
              {installing ? <LoaderCircle className="skill-spin" size={12} /> : <img src={SkillPlusIcon} className="skill-card-add-icon" alt="" aria-hidden="true" />}
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

      <div className="skill-card-description-wrap">
        <p className="skill-card-description">{skill?.description || '暂无技能描述'}</p>
        <div className="skill-card-description-tooltip" role="tooltip">
          {skill?.description || '暂无技能描述'}
        </div>
      </div>
    </article>
  );
};

export default React.memo(SkillCard);
