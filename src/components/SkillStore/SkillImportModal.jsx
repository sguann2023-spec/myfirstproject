import React, { useState } from 'react';
import { CheckCircle2, FolderOpen, LoaderCircle, Upload, X } from 'lucide-react';

const SkillImportModal = ({ onClose, onInstall }) => {
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const installPath = async (type) => {
    try {
      const selected = type === 'folder'
        ? await window.api?.file?.selectFolder?.({ title: '选择技能文件夹' })
        : (await window.api?.file?.select?.({
          title: '选择技能 ZIP 文件',
          filters: [{ name: '技能压缩包', extensions: ['zip'] }]
        }))?.[0]?.path;
      if (!selected) return;
      setStatus('loading');
      setMessage('正在校验技能结构并安装…');
      await onInstall?.(type, selected);
      setStatus('success');
      setMessage('技能安装成功');
    } catch (error) {
      setStatus('error');
      setMessage(error?.message || '技能校验或安装失败');
    }
  };

  return (
    <div className="skill-modal-mask" onMouseDown={onClose}>
      <div className="skill-import-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="skill-modal-title-row">
          <h2>导入技能</h2>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="skill-import-dropzone">
          {status === 'loading' ? <LoaderCircle size={30} className="skill-spin" /> : status === 'success' ? <CheckCircle2 size={30} color="#16b98d" /> : <Upload size={30} />}
          <strong>{status === 'loading' ? '正在校验并安装' : status === 'success' ? '安装完成' : '导入技能文件'}</strong>
          <span>{message || '支持上传技能文件夹或 ZIP 压缩包'}</span>
          <div className="skill-import-buttons">
            <button type="button" onClick={() => void installPath('folder')} disabled={status === 'loading'}><FolderOpen size={16} />选择文件夹</button>
            <button type="button" onClick={() => void installPath('zip')} disabled={status === 'loading'}><Upload size={16} />选择 ZIP</button>
          </div>
        </div>
        <div className="skill-import-requirements">
          <strong>文件要求</strong>
          <span>• 技能文件夹或 ZIP 需要包含 SKILL.md</span>
          <span>• SKILL.md 需要包含有效的技能名称和描述</span>
        </div>
      </div>
    </div>
  );
};

export default SkillImportModal;

