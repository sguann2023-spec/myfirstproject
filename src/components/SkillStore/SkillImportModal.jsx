import React, { useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { CheckCircle2, LoaderCircle, Upload, X } from 'lucide-react';
import { getSkillInstallErrorMessage } from './skillInstallError';

const SkillImportModal = ({ onClose, onInstall }) => {
  const [status, setStatus] = useState('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const closeTimerRef = useRef(null);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  const installSelected = async (type, selected) => {
    try {
      if (!selected) return;
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      setStatus('loading');
      setStatusMessage('正在校验技能结构并安装…');
      await onInstall?.(type, selected);
      setStatus('success');
      setStatusMessage('技能安装成功');
      closeTimerRef.current = window.setTimeout(() => onClose?.(), 2000);
    } catch (error) {
      setStatus('idle');
      setStatusMessage('');
      message.error(getSkillInstallErrorMessage(error, '技能校验或安装失败'));
    }
  };

  const chooseImportSource = async () => {
    const selected = (await window.api?.file?.select?.({
      title: '选择技能文件夹或 ZIP 文件',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: '技能 ZIP 压缩包', extensions: ['zip'] }]
    }))?.[0]?.path;
    if (!selected) return;
    await installSelected(selected.toLowerCase().endsWith('.zip') ? 'zip' : 'folder', selected);
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const dropped = event.dataTransfer.files?.[0];
    const selected = dropped?.path;
    if (!selected) {
      setStatus('idle');
      setStatusMessage('');
      message.error('无法读取拖拽的文件');
      return;
    }
    await installSelected(selected.toLowerCase().endsWith('.zip') ? 'zip' : 'folder', selected);
  };

  return (
    <div className="skill-modal-mask" onMouseDown={onClose}>
      <div className="skill-import-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="skill-modal-title-row">
          <h2>导入技能</h2>
          <button className="skill-import-close" type="button" onClick={onClose} aria-label="关闭"><X size={12} /></button>
        </div>
        <div
          className="skill-import-dropzone"
          role="button"
          tabIndex={0}
          onClick={() => void chooseImportSource()}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') void chooseImportSource(); }}
          onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onDrop={(event) => void handleDrop(event)}
        >
          {status === 'loading' ? <LoaderCircle size={30} className="skill-spin" /> : status === 'success' ? <CheckCircle2 size={30} color="#16b98d" /> : <Upload size={30} />}
          <strong>{status === 'loading' ? '正在校验并安装' : status === 'success' ? '安装完成' : '拖拽文件或点击上传'}</strong>
          {statusMessage ? <span>{statusMessage}</span> : null}
        </div>
        <div className="skill-import-requirements">
          <strong>文件要求</strong>
          <span>• 文件夹或者 .zip 需要包含 SKILL.md 文件</span>
          <span>• .md 文件需包含 YAML 格式的技能名称和描述</span>
        </div>
      </div>
    </div>
  );
};

export default SkillImportModal;
