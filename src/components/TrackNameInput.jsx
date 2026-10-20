import React from 'react';
import { Dropdown, Input } from 'antd';
import { ChevronDown } from 'lucide-react';

export default function TrackNameInput({ id, label, value, names, disabled, placeholder, onChange, onSelect, onBlur }) {
  const items = React.useMemo(() => [
    ...names.map((name) => ({ key: `existing:${name}`, label: name })),
    { key: '__new__', label: '新建轨道' },
  ], [names]);
  return <Dropdown disabled={disabled} trigger={['click']}
    menu={{ items, onClick: ({ key }) => onSelect(key) }}>
    <Input id={id} aria-label={label} value={value} disabled={disabled} maxLength={100}
      placeholder={placeholder} suffix={<ChevronDown size={14} />}
      style={{ flex: '1 1 0', minWidth: 0, width: 0, background: '#dddddd', border: 0, boxShadow: 'none' }}
      onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
  </Dropdown>;
}
