import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from 'antd';
import { ArrowLeft, Image, Plus, Type } from 'lucide-react';
import { TEMPLATE_PRESETS } from '../../shared/templatePresets';
import './TemplatePickerDialog.css';

const invoke = (channel, ...args) => {
  const ipc = window.electron?.ipcRenderer || window.require?.('electron')?.ipcRenderer;
  return ipc ? ipc.invoke(channel, ...args) : Promise.reject(new Error('请在桌面客户端打开模版选择器'));
};

const builtInPresets = TEMPLATE_PRESETS.map(preset => ({ ...preset, source: 'preset' }));

export default function TemplatePickerDialog({ open, onClose, onSelect }) {
  const [templates, setTemplates] = useState(builtInPresets);
  const [mode, setMode] = useState('history');
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setMode('history');
    invoke('template:editor-list')
      .then((items) => { if (active && Array.isArray(items)) setTemplates(items); })
      .catch(() => { if (active) setTemplates(builtInPresets); });
    return () => { active = false; };
  }, [open]);
  const historyTemplates = useMemo(() => templates.filter((item) => item.source === 'local'), [templates]);
  const visibleTemplates = mode === 'create' ? builtInPresets : historyTemplates;
  return (
    <Modal open={open} title={mode === 'create' ? '新建模版' : '使用模版'} onCancel={onClose} footer={null} width={600}>
      {mode === 'create' ? <button type="button" className="template-picker-back" onClick={() => setMode('history')}>
        <ArrowLeft size={18} />返回历史模版
      </button> : null}
      <div className="template-picker">
        {mode === 'history' ? <button type="button" className="template-picker-card template-picker-card--new"
          onClick={() => setMode('create')}>
          <div className="template-picker-preview template-picker-preview--empty" aria-hidden="true">
            <Plus size={30} strokeWidth={1.4} />
          </div>
          <strong>新建模版</strong>
          <span className="template-picker-description">从空白模版或内置演示创建</span>
        </button> : null}
        {visibleTemplates.map((preset) => {
          const previewId = preset.source === 'local' ? 'empty' : preset.id;
          return (
          <button key={preset.id} type="button" className="template-picker-card"
            onClick={() => onSelect(preset.source === 'local' ? { templatePath: preset.templatePath } : preset.id)}>
            <div className={`template-picker-preview template-picker-preview--${previewId}`} aria-hidden="true">
              {previewId === 'empty' ? <Plus size={30} strokeWidth={1.4} /> : previewId === 'mixed-track' ? (
                <div className="template-picker-mixed">
                  <div className="template-picker-mixed-row">
                    {[Image, Type, Image, Type].map((Icon, index) =>
                      <div key={index} className={`template-picker-mixed-clip ${index % 2 ? 'is-text' : ''}`}>
                        <Icon size={18} />
                      </div>)}
                  </div>
                  <div className="template-picker-mixed-underlay"><Type size={13} /><i /></div>
                </div>
              ) : (
                <div className="template-picker-sequence">
                  {[1, 2, 3].map((number) => <div className="template-picker-pair" key={number}>
                    <div><Image size={22} /><span>{number}</span></div>
                    <div><Type size={13} /><i /></div>
                  </div>)}
                </div>
              )}
            </div>
            <strong>{preset.name}</strong>
            <span className="template-picker-description">{preset.description}</span>
          </button>
        ); })}
      </div>
    </Modal>
  );
}
