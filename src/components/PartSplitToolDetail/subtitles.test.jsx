import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StoryboardEditor from './StoryboardEditor';
import { createParts, labelParts, mergeParts, splitPart, validateParts } from './model';
import { buildTimeline } from './timeline';
import { captionCues, editCaption, subtitleRows, subtitleTokens } from './subtitles';

vi.mock('./Filmstrip', () => ({ default: () => null }));
vi.mock('antd', () => ({ Tooltip: ({ children }) => children }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const segments = [
  { start: 0, end: 1700, text: '外卖满30减15，', sourceIndex: 0 },
  { start: 2000, end: 3900, text: '你以为赚了15块？', sourceIndex: 1 },
  { start: 4000, end: 6000, text: '醒醒，', sourceIndex: 2 },
];
let root;
let container;
let onEdit;
let onDelete;
let latest;
let externalUpdate;
let select;

const render = async (props = {}) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onEdit = vi.fn();
  onDelete = vi.fn();
  const Harness = () => {
    const [parts, setParts] = React.useState(labelParts(createParts(segments)));
    const [selectedId, setSelectedId] = React.useState(parts[0].id);
    latest = parts;
    externalUpdate = setParts;
    select = setSelectedId;
    return <StoryboardEditor parts={parts} selectedId={selectedId} segments={segments}
      source="https://example.com/source.mp4" onSelect={setSelectedId} onDelete={onDelete}
      onInsert={() => {}} onSplit={() => {}} onMerge={() => {}}
      onEditCaption={(id, edit) => {
        onEdit(id, edit);
        setParts((previous) => previous.map((part) => part.id === id ? editCaption(part, segments, edit) : part));
      }} {...props} />;
  };
  await act(async () => root.render(<Harness />));
};
const query = (selector) => container.querySelector(selector);
const click = async (selector) => act(async () => query(selector).click());
const edit = async (selector = '[aria-label="字幕 外"]') => act(async () => {
  query(selector).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
});
const type = async (value) => act(async () => {
  const input = query('[aria-label="编辑字幕"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const key = async (key, options = {}) => act(async () => {
  query('[aria-label="编辑字幕"]').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, ...options }));
});

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(20);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container?.remove();
  vi.restoreAllMocks();
});

describe('字幕字块数据', () => {
  it('中文拆字、英文和数字成块，标点附着且保留替换位置', () => {
    const text = '外卖 30.5元，AI helper!';
    const tokens = subtitleTokens(text);
    expect(tokens.map((token) => token.text)).toEqual(['外', '卖', '30.5', '元，', 'AI', 'helper!']);
    for (const token of tokens) expect(text.slice(token.start, token.end)).toBe(token.text);
  });
  it('使用句级时间联动，停顿只来自保留的真实源时间范围', () => {
    const parts = createParts(segments);
    const rows = subtitleRows(buildTimeline(parts), segments);
    expect(rows[0].items.at(-1)).toMatchObject({ kind: 'pause', start: 1700, end: 2000 });
    const merged = mergeParts([parts[0], parts[2]], ['subtitle-0', 'subtitle-2']);
    const row = subtitleRows(buildTimeline(merged), segments)[0];
    expect(row.items.filter((item) => item.kind === 'caption').map((item) => item.time)).toEqual([0, 2000]);
    expect(row.items.filter((item) => item.kind === 'pause')).toHaveLength(1);
  });
  it('改字不改变时间和源字幕，合并和拆分后保留字幕修改', () => {
    const parts = createParts(segments);
    const edited = editCaption(parts[0], segments, {
      cueIndex: 0, originalText: parts[0].text, start: 0, end: 1, value: '快',
    });
    expect(edited.text).toBe('快卖满30减15，');
    expect(segments[0].text).toBe('外卖满30减15，');
    const merged = mergeParts([edited, parts[1]], ['subtitle-0', 'subtitle-1']);
    expect(merged[0].captions[0]).toEqual({ start: 0, end: 1700, text: '快卖满30减15，' });
    const split = splitPart(merged, 'subtitle-0', 2000, 'right');
    expect(split[0].text).toBe(edited.text);
    expect(split[1].text).toBe(parts[1].text);
    expect(validateParts(split)).toBe(split);
  });
  it('外部改文案会更新旧 captions，过期输入不会覆盖新文案', () => {
    const part = createParts(segments)[0];
    const changed = { ...part, text: '新的外部文案' };
    expect(captionCues(changed, segments)[0].text).toBe(changed.text);
    expect(editCaption(changed, segments, {
      cueIndex: 0, originalText: part.text, start: 0, end: 1, value: '过期',
    })).toBe(changed);
    expect(() => validateParts([{ ...part, captions: [{ start: 0, end: 9000, text: '越界' }] }])).toThrow();
  });
});

describe('字幕和轨道联动', () => {
  it('右侧按分镜编号显示字块，顶部只放 AI 辅助入口', async () => {
    const onAiAssist = vi.fn();
    await render({ onAiAssist });
    expect(query('.storyboard-workspace').children).toHaveLength(2);
    expect(container.querySelectorAll('.storyboard-subtitles__row')).toHaveLength(3);
    expect(query('.storyboard-subtitles__toolbar').querySelectorAll('button')).toHaveLength(1);
    expect(query('.storyboard-subtitles__toolbar').textContent).toBe('AI辅助');
    expect(query('[aria-label="停顿 0.30 秒"]')).not.toBeNull();
    await click('.storyboard-subtitles__ai');
    expect(onAiAssist).toHaveBeenCalledOnce();
  });
  it('点击字块选中对应轨道并定位句子，点击轨道同步字幕行', async () => {
    await render();
    await click('[aria-label="字幕 你"]');
    expect(query('.storyboard-clip.is-selected').getAttribute('aria-label')).toBe('选择 part2_1');
    expect(query('.storyboard-subtitles__row.is-selected').dataset.partId).toBe('subtitle-1');
    expect(query('.storyboard-subtitles__word.is-selected').textContent).toBe('你');
    expect(query('.storyboard-preview__media').currentTime).toBe(2);
    expect(query('.storyboard-preview__subtitle').textContent).toBe(segments[1].text);
    await click('[aria-label="选择 part3_1"]');
    expect(query('.storyboard-subtitles__row.is-selected').dataset.partId).toBe('subtitle-2');
  });
  it('悬浮字幕不触发轨道联动或视频预览', async () => {
    await render();
    await act(async () => query('[aria-label="字幕 你"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(query('.storyboard-preview__hover')).toBeNull();
    expect(query('.storyboard-preview__media').currentTime).toBe(0);
    expect(query('.storyboard-clip.is-hovered')).toBeNull();
    await act(async () => query('.storyboard-subtitles').dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    ));
    expect(query('.storyboard-hoverline')).toBeNull();
    expect(query('.storyboard-preview__media').currentTime).toBe(0);
  });
  it('双击行内编辑，Enter 保存更新预览，删除键不误删分镜', async () => {
    await render();
    await edit();
    expect(document.activeElement).toBe(query('[aria-label="编辑字幕"]'));
    await type('快');
    await key('Backspace');
    expect(onDelete).not.toHaveBeenCalled();
    await key('Enter');
    expect(onEdit).toHaveBeenCalledOnce();
    expect(query('[aria-label="编辑字幕"]')).toBeNull();
    expect(latest[0].text).toBe('快卖满30减15，');
    expect(query('.storyboard-preview__subtitle').textContent).toBe(latest[0].text);
  });
  it('删掉最后一个字后不出现添加文字，保留分镜时间和停顿', async () => {
    await render();
    await act(async () => externalUpdate((parts) => [{ ...parts[0], text: '外',
      captions: [{ start: 0, end: 1700, text: '外' }] }]));
    await edit();
    await type('');
    await key('Enter');
    expect(latest[0].text).toBe('');
    expect(latest[0].start).toBe(0);
    expect(latest[0].end).toBe(2000);
    expect(container.querySelectorAll('.storyboard-clip')).toHaveLength(1);
    expect(query('.storyboard-subtitles__word')).toBeNull();
    expect(query('.storyboard-subtitles').textContent).not.toContain('添加文字');
    expect(query('[aria-label="停顿 0.30 秒"]')).not.toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });
  it('载入空字幕或纯空白字幕时不生成添加文字占位', async () => {
    await render();
    await act(async () => externalUpdate((parts) => parts.map((part, index) => ({
      ...part, text: index ? '   ' : '', captions: [{ start: part.start, end: part.end, text: index ? '   ' : '' }],
    }))));
    expect(query('.storyboard-subtitles__word')).toBeNull();
    expect(query('.storyboard-subtitles').textContent).not.toContain('添加文字');
    expect(container.querySelectorAll('.storyboard-clip')).toHaveLength(3);
  });
  it('输入法确认不提前提交，Escape 取消修改', async () => {
    await render();
    await edit();
    await type('测试');
    await key('Enter', { isComposing: true });
    expect(onEdit).not.toHaveBeenCalled();
    expect(query('[aria-label="编辑字幕"]')).not.toBeNull();
    await key('Escape');
    expect(onEdit).not.toHaveBeenCalled();
    expect(latest[0].text).toBe(segments[0].text);
  });
  it('全屏编辑时 Escape 只取消改字，不退出全屏', async () => {
    await render();
    await click('[aria-label="全屏编辑"]');
    await edit();
    await type('取消');
    await key('Escape');
    expect(query('.storyboard-editor.is-fullscreen')).not.toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });
  it('失焦保存，外部文件更新后放弃过期编辑', async () => {
    await render();
    await edit();
    await type('快');
    await act(async () => query('[aria-label="编辑字幕"]').blur());
    expect(onEdit).toHaveBeenCalledOnce();
    await edit('[aria-label="字幕 快"]');
    await type('过期');
    await act(async () => externalUpdate((parts) => parts.map((part, index) => index ? part : { ...part, text: '外部更新' })));
    expect(query('[aria-label="编辑字幕"]')).toBeNull();
    expect(latest[0].text).toBe('外部更新');
    expect(onEdit).toHaveBeenCalledOnce();
  });
  it('只定位字幕行不能误删整镜，空分镜和禁用状态正常', async () => {
    await render();
    await click('[aria-label="定位第 2 个分镜"]');
    await click('[aria-label="删除所选字幕分镜"]');
    expect(onDelete).not.toHaveBeenCalled();
    expect(query('[aria-label="删除所选字幕分镜"]').disabled).toBe(true);
    await act(async () => {
      externalUpdate((parts) => [{ ...parts[0], blank: true, text: '', captions: [] }]);
      select('subtitle-0');
    });
    expect(query('.storyboard-subtitles__empty-chip').textContent).toBe('空分镜');
    expect(query('.storyboard-preview__subtitle').hidden).toBe(true);
  });
  it('禁用时不能编辑字幕或删除', async () => {
    await render({ disabled: true });
    await edit();
    expect(query('[aria-label="编辑字幕"]')).toBeNull();
    expect(query('[aria-label="删除所选字幕分镜"]').disabled).toBe(true);
  });
});
