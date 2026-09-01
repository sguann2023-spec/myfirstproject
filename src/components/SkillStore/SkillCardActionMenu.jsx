import React from 'react';
import { MessageCircle, Pencil, Trash2 } from 'lucide-react';

const SkillCardActionMenu = ({ onChat, onEdit, onUninstall }) => (
  <div className="skill-card-action-menu" onClick={(event) => event.stopPropagation()}>
    <button type="button" onClick={onChat}>
      <MessageCircle size={15} />
      去对话
    </button>
    <button type="button" onClick={onEdit}>
      <Pencil size={15} />
      编辑
    </button>
    <button type="button" className="is-danger" onClick={onUninstall}>
      <Trash2 size={15} />
      卸载
    </button>
  </div>
);

export default SkillCardActionMenu;

