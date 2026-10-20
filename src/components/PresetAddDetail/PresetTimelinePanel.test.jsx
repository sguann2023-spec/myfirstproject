import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import PresetTimelinePanel from './PresetTimelinePanel';

vi.mock('antd', () => ({
  Slider: ({ value, onChange }) => <div>{value.map((time, i) => <input key={i}
    aria-label={i ? '原视频结束' : '原视频开始'} value={time}
    onChange={(event) => onChange(value.map((v, index) => index === i ? Number(event.target.value) : v))} />)}</div>,
  AutoComplete: ({ options, onSelect, onChange, value, disabled }) => <div>
    <input aria-label="新轨道名称" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value, {})} />
    <select aria-label="视频轨道选项" disabled={disabled} value="" onChange={(e) => onSelect(e.target.value)}>
      <option value="" />{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </div>,
  InputNumber: ({ value, onChange, disabled, 'aria-label': label }) => <input type="number" aria-label={label}
    value={value ?? ''} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />,
}));
vi.mock('../TrackNameInput', () => ({ default: ({ names, value, onSelect, onChange, disabled }) => <div>
  <input aria-label="新轨道名称" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  <select value="" disabled={disabled} onChange={(event) => onSelect(event.target.value)}>
    <option value="" />{names.map((name) => <option key={name} value={`existing:${name}`}>{name}</option>)}
    <option value="__new__">新建轨道</option>
  </select>
</div> }));
vi.mock('../../renderer/src/components/PreviewTimeline/ReactTimelineEditor', () => ({
  Timeline: ({ editorData, getActionRender }) => <div>{editorData.map((row) => <div key={row.id}>
    {row.actions.map((action) => <React.Fragment key={action.id}>{getActionRender(action, row)}</React.Fragment>)}
  </div>)}</div>,
}));

let root;
let host;
beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
});
const script = { tracks: [
  { id: 'video', name: '主视频', type: 'video', relative_index: 4, segments: [] },
  { id: 'text', name: '标题', type: 'text', relative_index: 9, segments: [] },
] };
const edit = async (label, value) => act(async () => {
  const element = host.querySelector(`[aria-label="${label}"]`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, String(value));
  element.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('预设时间线表单', () => {
  it('两行时间框等时长联动，视频轨道可新建并置顶置低，没有层级输入框', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    let latest;
    function Harness() {
      const [value, setValue] = React.useState({ sourceStart: 0, sourceEnd: 10, targetStart: 0 });
      latest = value;
      return <PresetTimelinePanel script={script} settings={value} duration={10} preset={{ name: '测试预设' }}
        onChange={setValue} />;
    }
    await act(async () => root.render(<Harness />));
    expect([...host.querySelectorAll('option')].map((node) => node.textContent)).toEqual(['', '主视频', '新建轨道']);
    expect(host.querySelector('[aria-label="开始时间"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="层级"]')).toBeNull();
    expect(host.querySelector('[aria-label="只读视频轨道预览"]')).not.toBeNull();
    await edit('原视频开始', 2);
    await edit('开始时间', 5);
    expect(latest.targetStart).toBe(5);
    await edit('原视频结束', 5);
    expect(host.querySelector('[aria-label="原视频结束"]').value).toBe('5');
    expect(latest.sourceEnd - latest.sourceStart).toBe(3);
    await act(async () => {
      const select = host.querySelector('select');
      select.value = '__new__';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(latest.trackMode).toBe('new');
    await act(async () => host.querySelector('[aria-label="置底"]').click());
    expect(latest.relativeIndex).toBe(3);
    await act(async () => host.querySelector('[aria-label="置顶"]').click());
    expect(latest.relativeIndex).toBe(5);
    await edit('新轨道名称', '标题');
    expect(latest.trackName).toBe('标题_2');
  });
});
