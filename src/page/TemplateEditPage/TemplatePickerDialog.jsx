import React from 'react';
import { Modal } from 'antd';
import { Image, Plus, Type } from 'lucide-react';
import { TEMPLATE_PRESETS } from '../../shared/templatePresets';
import './TemplatePickerDialog.css';

export default function TemplatePickerDialog({ open, onClose, onSelect }) {
  return (
    <Modal open={open} title="新模版" onCancel={onClose} footer={null} width={600}>
      <div className="template-picker">
        {TEMPLATE_PRESETS.map((preset) => (
          <button key={preset.id} type="button" className="template-picker-card"
            onClick={() => onSelect(preset.id)}>
            <div className={`template-picker-preview template-picker-preview--${preset.id}`} aria-hidden="true">
              {preset.id === 'empty' ? <Plus size={30} strokeWidth={1.4} /> : preset.id === 'mixed-track' ? (
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
        ))}
      </div>
    </Modal>
  );
}
