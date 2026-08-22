import React, { useEffect, useState } from 'react';
import { ArrowLeft, FolderOpen, LoaderCircle, Trash2 } from 'lucide-react';
import { skillCatalogService } from '../../renderer/src/services/SkillCatalogService';
import SkillEllipsisIcon from '../../../public/skill-ellipsis.svg';
import SkillMediaPreview from './SkillMediaPreview';

const SkillDetailPage = ({
  skill,
  installed,
  installedSkill,
  enabled,
  onBack,
  onInstall,
  onToggle,
  onUninstall,
  onGoChat,
  onEdit
}) => {
  const [detail, setDetail] = useState(skill);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    skillCatalogService.getSkillDetail(skill?.id || skill?.slug).then((value) => {
      if (!disposed) setDetail(value || skill);
    }).catch(async () => {
      let localDetail = skill;
      const localSkillId = installedSkill?.id || installedSkill?.folderName || skill?.id;
      try {
        const result = await window.api?.skill?.readSkillFile?.(localSkillId, 'SKILL.md');
        if (result?.success && result.data) {
          localDetail = { ...skill, skill_md: { content: result.data } };
        }
      } catch {
        // Keep the catalog card as a fallback when local content cannot be read.
      }
      if (!disposed) setDetail(localDetail);
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; };
  }, [installedSkill, skill]);

  const openFolder = () => {
    const folderPath = installed?.path || installed?.folderPath;
    if (folderPath && window.api?.file?.openPath) {
      void window.api.file.openPath(folderPath);
      return;
    }
    window.toast?.info?.('技能文件夹路径暂不可用');
  };

  return (
    <div className="skill-detail-page">
      <div className="skill-detail-header">
        <button type="button" className="skill-back-button" onClick={onBack}>
          <ArrowLeft size={18} />
          {detail?.name || skill?.name || '技能详情'}
        </button>
        <div className="skill-detail-header-actions">
          {installed ? (
            <>
              <button type="button" className="skill-detail-use" onClick={() => onGoChat?.(detail)}>
                去使用
              </button>
              <button type="button" className={`skill-detail-switch${enabled ? ' is-on' : ''}`} onClick={() => onToggle?.(detail, !enabled)}>
                <span />
              </button>
              <div className="skill-detail-more-wrap">
                <button type="button" className="skill-detail-more" onClick={() => setMenuOpen((value) => !value)}>
                  <img src={SkillEllipsisIcon} className="skill-detail-more-icon" alt="" aria-hidden="true" />
                </button>
                {menuOpen ? (
                  <div className="skill-detail-menu">
                    <button type="button" onClick={openFolder}><FolderOpen size={15} />打开文件夹</button>
                    <button type="button" className="is-danger" onClick={() => onUninstall?.(detail)}><Trash2 size={15} />卸载</button>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <button type="button" className="skill-detail-add" onClick={() => onInstall?.(detail)}>
              添加技能
            </button>
          )}
        </div>
      </div>

      <div className="skill-detail-body">
        {loading ? (
          <div className="skill-detail-loading"><LoaderCircle size={18} className="skill-spin" />正在加载技能详情</div>
        ) : (
          <>
            <SkillMediaPreview media={detail?.media} />
            <section className="skill-detail-section">
              <h2>技能描述</h2>
              <p>{detail?.description || '暂无技能描述'}</p>
            </section>
            <section className="skill-detail-section">
              <h2>技能内容</h2>
              <pre className="skill-markdown-content">{detail?.skill_md?.content || '暂无 SKILL.md 内容'}</pre>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default SkillDetailPage;
