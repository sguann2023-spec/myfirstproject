import React from 'react';
import { Trash2 } from 'lucide-react';
import MessageCircleMoreIcon from '../../../public/message-circle-more.svg';
import SquarePenIcon from '../../../public/square-pen.svg';

const SkillCardActionMenu = ({ enabled = true, onChat, onEdit, onUninstall }) => (
  <div className="skill-card-action-menu" onClick={(event) => event.stopPropagation()}>
    {enabled ? (
      <>
        <button type="button" onClick={onChat}>
          <img src={MessageCircleMoreIcon} className="skill-card-menu-icon" alt="" aria-hidden="true" />
          去对话
        </button>
        <button type="button" onClick={onEdit}>
          <img src={SquarePenIcon} className="skill-card-menu-icon" alt="" aria-hidden="true" />
          编辑
        </button>
      </>
    ) : null}
    <button type="button" className="is-danger" onClick={onUninstall}>
      <Trash2 size={15} />
      卸载
    </button>
  </div>
);

export default SkillCardActionMenu;
