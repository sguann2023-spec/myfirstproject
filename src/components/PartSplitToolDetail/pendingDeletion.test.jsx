import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StoryboardEditor from './StoryboardEditor';
import { createParts, labelParts, parseRecognition, mergeParts, splitPart, validateParts, buildPartsDocument } from './model';
import { buildTimeline, timelinePoint } from './timeline';
import { captionCues, deleteSubtitleTextUnits, deleteSubtitleUnits, editCaption, subtitleUnits, timedTokens } from './subtitles';

vi.mock('./Filmstrip', () => ({ default: () => null }));
vi.mock('antd', () => ({ Tooltip: ({ children }) => children }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const raw = {
  success: true,
  result: {
    segments: [
      { start: 100, end: 1600, text: '外卖满30，' },
      { start: 2000, end: 2800, text: '减15。' },
    ],
    result: { raw: { result: { utterances: [
      { words: [
        { text: '外', start_time: 100, end_time: 250 },
        { text: '卖', start_time: 250, end_time: 500 },
        { text: '满', start_time: 500, end_time: 900 },
        { text: '30', start_time: 900, end_time: 1600 },
      ] },
      { words: [
        { text: '减', start_time: 2000, end_time: 2200 },
        { text: '15', start_time: 2200, end_time: 2800 },
      ] },
    ] } } },
  },
};
const recognition = () => parseRecognition(JSON.stringify(raw));
// Reduced from the user's nlp result: no media URLs or local paths.
const wordFieldResult = { result: { segments: [{
  start: 370, end: 1850, text: '最近在做一个新的功能',
  words: [
    { word: '最', start_time: 370, end_time: 490 },
    { word: '近', start_time: 490, end_time: 570 },
    { word: '在', start_time: 570, end_time: 770 },
    { word: '做', start_time: 770, end_time: 930 },
    { word: '一', start_time: 930, end_time: 1050 },
    { word: '个', start_time: 1050, end_time: 1210 },
    { word: '新', start_time: 1210, end_time: 1410 },
    { word: '的', start_time: 1410, end_time: 1570 },
    { word: '功', start_time: 1570, end_time: 1690 },
    { word: '能', start_time: 1690, end_time: 1850 },
  ],
}] } };
let container;
let root;
let latest;
let saved;
let updateExternal;
let frames;
let frameId;

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(10);
  frames = new Map();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = async (data = raw, legacy = false) => {
  const { segments } = parseRecognition(JSON.stringify(data));
  saved = vi.fn();
  const Harness = () => {
    const [parts, setParts] = React.useState(() => labelParts(createParts(segments)).map((part) => {
      if (!legacy) return part;
      const { words, ...previous } = part;
      return { ...previous, captions: part.captions.map(({ words, ...cue }) => cue) };
    }));
    const [id, setId] = React.useState(parts[0].id);
    latest = parts;
    updateExternal = setParts;
    return <StoryboardEditor parts={parts} segments={segments} selectedId={id}
      source="https://example.com/video.mp4" onSelect={setId}
      onDelete={() => { throw new Error('Word selection must not delete a whole shot'); }}
      onDeleteSubtitles={(units) => {
        const next = labelParts(deleteSubtitleUnits(parts, segments, units));
        validateParts(next);
        saved(next);
        setParts(next);
      }}
      onDeleteSubtitleText={(units) => {
        const next = labelParts(deleteSubtitleTextUnits(parts, segments, units));
        validateParts(next);
        saved(next);
        setParts(next);
      }}
      onEditCaption={(id, edit) => setParts((parts) => parts.map((part) => part.id === id ? editCaption(part, segments, edit) : part))}
      onInsert={() => {}} onMerge={() => {}} onSplit={() => {}} />;
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
};
const q = (selector) => container.querySelector(selector);
const qa = (selector) => [...container.querySelectorAll(selector)];
const click = async (label, options = {}) => act(async () => q(`[aria-label="${label}"]`)
  .dispatchEvent(new MouseEvent('click', { bubbles: true, ...options })));
const contextMenu = async (label) => act(async () => q(`[aria-label="${label}"]`)
  .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 34 })));
const press = async (key) => act(async () => q('.storyboard-subtitles')
  .dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key })));
const frame = async () => {
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => pending.forEach((callback) => callback(performance.now() + 16)));
};

describe('真实逐字时间戳', () => {
  it('用户 nlp 样例的 word 字段全部映射，能字保留 1690–1850ms', () => {
    const { segments } = parseRecognition(JSON.stringify(wordFieldResult));
    expect(segments[0].words).toHaveLength(10);
    expect(timedTokens(segments[0]).at(-1)).toMatchObject({ text: '能', sourceStart: 1690, sourceEnd: 1850 });
  });
  it('word 字段同样支持嵌套 utterances，仍兼容 text 字段', () => {
    const segment = wordFieldResult.result.segments[0];
    const data = { result: { segments: [{ start: segment.start, end: segment.end, text: segment.text }],
      raw: { result: { utterances: [{ words: segment.words }] } } } };
    expect(parseRecognition(JSON.stringify(data)).segments[0].words).toHaveLength(10);
    expect(recognition().segments[0].words).toHaveLength(4);
  });
  it('提取嵌套 ASR words 并对齐文字和标点，保留不均匀时间', () => {
    const { segments } = recognition();
    expect(segments[0].words.map((word) => [word.start, word.end])).toEqual([[100, 250], [250, 500], [500, 900], [900, 1600]]);
    expect(timedTokens(segments[0]).map((token) => token.text)).toEqual(['外', '卖', '满', '30，']);
    expect(timedTokens(segments[0])[1]).toMatchObject({ sourceStart: 250, sourceEnd: 500 });
  });
  it('兼容直接 segments.words 的 start/end 和 start_ms/end_ms', () => {
    for (const fields of [{ start: 100, end: 250 }, { start_ms: 100, end_ms: 250 }]) {
      const data = { result: { segments: [{ start: 100, end: 250, text: '字。', words: [{ text: '字', ...fields }] }] } };
      expect(parseRecognition(JSON.stringify(data)).segments[0].words[0]).toMatchObject({ start: 100, end: 250, from: 0, to: 2 });
    }
  });
  it('旧 part 文件从识别结果补回逐字时间，不对不匹配文案伪造时间', () => {
    const { segments } = recognition();
    const parts = createParts(segments);
    delete parts[0].captions[0].words;
    expect(captionCues(parts[0], segments)[0].words).toHaveLength(4);
    expect(timedTokens(captionCues({ ...parts[0], text: '全新文案' }, segments)[0])
      .every((token) => token.sourceStart === undefined)).toBe(true);
  });
  it('多字 ASR word 保持一个字块，不凭空均分时间', () => {
    const data = { result: { segments: [{ start: 0, end: 800, text: '你好！', words: [{ text: '你好', start: 0, end: 800 }] }] } };
    expect(timedTokens(parseRecognition(JSON.stringify(data)).segments[0])).toHaveLength(1);
  });
  it('删除字块只移除真实范围，保留停顿，序列时间和字幕一致', () => {
    const { segments } = recognition();
    const parts = createParts(segments);
    const units = subtitleUnits(buildTimeline(parts), segments);
    const next = deleteSubtitleUnits(parts, segments, [units[1]]);
    expect(next).toHaveLength(3);
    expect(next[0]).toMatchObject({ start: 100, end: 250, text: '外', id: parts[0].id });
    expect(next[1]).toMatchObject({ start: 500, end: 2000, text: '满30，' });
    expect(next[1].id).not.toBe(next[0].id);
    expect(next.every((part) => !part.ranges)).toBe(true);
    expect(buildTimeline(next).at(-1).timelineEnd).toBe(2450);
    expect(timelinePoint(buildTimeline(next), 150).sourceTime).toBe(500);
    expect(validateParts(next)).toBe(next);
    const document = buildPartsDocument({ path: '/sre.json' }, recognition(), next);
    const reopened = JSON.parse(JSON.stringify(document)).parts;
    expect(buildTimeline(reopened)).toEqual(buildTimeline(document.parts));
    expect(subtitleUnits(buildTimeline(reopened), segments).filter((unit) => unit.kind === 'word')
      .map((unit) => [unit.start, unit.end])).not.toContainEqual([250, 500]);
  });
  it('删除停顿不删字幕，全部删除可清空轨道', () => {
    const { segments } = recognition();
    const parts = createParts(segments);
    const units = subtitleUnits(buildTimeline(parts), segments);
    const next = deleteSubtitleUnits(parts, segments, units.filter((unit) => unit.kind === 'pause'));
    expect(next[0].end).toBe(1600);
    expect(next[0].text).toBe(parts[0].text);
    expect(deleteSubtitleUnits(parts, segments, units)).toEqual([]);
  });
  it('首尾删除只保留实际区间，多处删除生成独立且不重名的分镜', () => {
    const { segments } = parseRecognition(JSON.stringify(wordFieldResult));
    const parts = createParts(segments);
    const units = subtitleUnits(buildTimeline(parts), segments);
    const trimmed = deleteSubtitleUnits(parts, segments, [units[0], units.at(-1)]);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]).toMatchObject({ start: 490, end: 1690, text: '近在做一个新的功' });
    const collision = { ...parts[0], id: `${parts[0].id}-cut-570` };
    const next = deleteSubtitleUnits([...parts, collision], segments, [units[1], units[6]]);
    expect(next.slice(0, 3).map((part) => part.text)).toEqual(['最', '在做一个', '的功能']);
    expect(next.at(-1)).toBe(collision);
    expect(new Set(next.map((part) => part.id)).size).toBe(next.length);
    expect(validateParts(next)).toBe(next);
    const merged = mergeParts(next.slice(0, 3), next.slice(0, 3).map((part) => part.id));
    expect(merged[0].ranges).toEqual([
      { start: 370, end: 490 }, { start: 570, end: 1210 }, { start: 1410, end: 1850 },
    ]);
  });
  it('句内真实停顿也可独立选择，删除后不影响两侧字词', () => {
    const data = { result: { segments: [{ start: 0, end: 1000, text: '你好', words: [
      { text: '你', start: 0, end: 300 }, { text: '好', start: 600, end: 1000 },
    ] }] } };
    const { segments } = parseRecognition(JSON.stringify(data));
    const parts = createParts(segments);
    const units = subtitleUnits(buildTimeline(parts), segments);
    expect(units[1]).toMatchObject({ kind: 'pause', start: 300, end: 600 });
    const next = deleteSubtitleUnits(parts, segments, [units[1]]);
    expect(next.map((part) => part.text)).toEqual(['你', '好']);
    expect(next.map(({ start, end }) => [start, end])).toEqual([[0, 300], [600, 1000]]);
    expect(buildTimeline(next).at(-1).timelineEnd).toBe(700);
    expect(validateParts(next)).toBe(next);
  });
  it('删字后合并拆分和再次编辑不会恢复已删除字词', () => {
    const { segments } = recognition();
    const parts = createParts(segments);
    const next = deleteSubtitleUnits(parts, segments, [subtitleUnits(buildTimeline(parts), segments)[1]]);
    const merged = mergeParts(next, next.map((part) => part.id));
    const split = splitPart(merged, merged[0].id, 900, 'new');
    expect(split.map((part) => part.text).join('')).not.toContain('卖');
    expect(validateParts(split)).toBe(split);
    const cue = captionCues(split[0], segments)[0];
    const edited = editCaption(split[0], segments, { cueIndex: 0, originalText: cue.text, start: 0, end: 1, value: '外面' });
    expect(edited.captions[0].words[0]).toMatchObject({ from: 0, to: 2, start: 100, end: 250 });
    expect(validateParts([edited])).toHaveLength(1);
  });
});

describe('待删除视觉与轨道关联', () => {
  it.each([false, true])('真实 word 字段可选中和删除，旧分镜=%s', async (legacy) => {
    await render(wordFieldResult, legacy);
    expect(q('[aria-label="字幕 能"]').title).not.toContain('无匹配');
    await click('字幕 能');
    expect(q('[aria-label="字幕 能"]').classList.contains('is-pending')).toBe(true);
    expect(q('.storyboard-pending-range').dataset).toMatchObject({ start: '1320', end: '1480' });
    expect(q('[aria-label="删除所选字幕分镜"]').disabled).toBe(false);
    await click('删除所选字幕分镜');
    expect(saved).toHaveBeenCalledOnce();
    expect(latest[0].text).toBe('最近在做一个新的功');
    expect(q('[role="slider"]').getAttribute('aria-valuemax')).toBe('1320');
  });
  it('停顿默认普通状态，选中字块只压暗对应真实区间且不写入', async () => {
    await render();
    expect(q('.storyboard-subtitles__pause').classList.contains('is-pending')).toBe(false);
    expect(q('[aria-label="删除所选字幕分镜"]').disabled).toBe(true);
    await click('字幕 卖');
    expect(q('[aria-label="字幕 卖"]').classList.contains('is-pending')).toBe(true);
    expect(q('.storyboard-pending-range').dataset).toMatchObject({ start: '150', end: '400' });
    const scale = (parseFloat(q('.storyboard-clip').style.width) + 3) / 1.9;
    expect(parseFloat(q('.storyboard-pending-range').style.width)).toBeCloseTo(0.25 * scale);
    expect(q('.storyboard-preview__media').currentTime).toBe(0.25);
    expect(q('[role="slider"]').getAttribute('aria-valuemax')).toBe('2700');
    expect(saved).not.toHaveBeenCalled();
  });
  it('再次点击取消，停顿选中变待删除，Esc 恢复且不修改数据', async () => {
    await render();
    await click('字幕 卖');
    await click('字幕 卖');
    expect(qa('.storyboard-pending-range')).toHaveLength(0);
    await click('停顿 0.40 秒');
    expect(q('.storyboard-subtitles__pause.is-pending')).not.toBeNull();
    expect(q('.storyboard-pending-range').dataset).toMatchObject({ start: '1500', end: '1900' });
    await press('Escape');
    expect(q('.storyboard-subtitles__pause.is-pending')).toBeNull();
    expect(qa('.storyboard-pending-range')).toHaveLength(0);
    expect(saved).not.toHaveBeenCalled();
  });
  it('跨行点选和 Shift 连选保留所有待删除项', async () => {
    await render();
    await click('字幕 卖');
    await click('字幕 减');
    expect(qa('.storyboard-subtitles__word.is-pending')).toHaveLength(2);
    await press('Escape');
    await click('字幕 卖');
    await click('字幕 满', { shiftKey: true });
    expect(qa('.storyboard-subtitles__word.is-pending').map((node) => node.textContent)).toEqual(['卖', '满']);
  });
  it('连续 Shift 连选会按当前锚点范围更新高亮，不残留旧范围', async () => {
    await render();
    await click('字幕 卖');
    await click('字幕 减', { shiftKey: true });
    expect(qa('.storyboard-subtitles__word.is-pending').map((node) => node.textContent)).toEqual(['卖', '满', '30，', '减']);
    await click('字幕 满', { shiftKey: true });
    expect(qa('.storyboard-subtitles__word.is-pending').map((node) => node.textContent)).toEqual(['卖', '满']);
  });
  it('普通取消一个已选中字后，Shift 连选按同一锚点范围反选', async () => {
    await render();
    await click('字幕 卖');
    await click('字幕 减', { shiftKey: true });
    expect(qa('.storyboard-subtitles__word.is-pending')).toHaveLength(4);
    await click('字幕 卖');
    await click('字幕 30，', { shiftKey: true });
    expect(qa('.storyboard-subtitles__word.is-pending').map((node) => node.textContent)).toEqual(['减']);
  });
  it('右键仅删除文字不删除分镜或时间范围，停顿会被忽略', async () => {
    await render();
    await click('停顿 0.40 秒');
    await click('字幕 卖');
    await contextMenu('字幕 卖');
    expect(q('.storyboard-subtitles__menu').textContent).toBe('仅删除文字');
    await act(async () => q('.storyboard-subtitles__menu button').click());
    expect(saved).toHaveBeenCalledOnce();
    expect(latest).toHaveLength(2);
    expect(latest[0]).toMatchObject({ start: 100, end: 2000, text: '外满30，' });
    expect(latest[1]).toMatchObject({ start: 2000, end: 2800, text: '减15。' });
    expect(q('[aria-label="停顿 0.40 秒"]')).not.toBeNull();
    expect(q('[role="slider"]').getAttribute('aria-valuemax')).toBe('2700');
  });
  it('右键未选中的字会先选中该字，再仅删除文字', async () => {
    await render();
    await contextMenu('字幕 满');
    await act(async () => q('.storyboard-subtitles__menu button').click());
    expect(saved).toHaveBeenCalledOnce();
    expect(latest[0]).toMatchObject({ start: 100, end: 2000, text: '外卖30，' });
    expect(latest).toHaveLength(2);
  });
  it('确认删除后区间才移除，后续播放跳过已删画面', async () => {
    await render();
    await click('字幕 卖');
    await click('删除所选字幕分镜');
    expect(saved).toHaveBeenCalledOnce();
    expect(q('[aria-label="字幕 卖"]')).toBeNull();
    expect(qa('.storyboard-clip')).toHaveLength(3);
    expect(qa('.storyboard-subtitles__row')).toHaveLength(3);
    await click('选择 part1_2');
    expect(q('.storyboard-preview__media').currentTime).toBe(0.5);
    expect(qa('.storyboard-pending-range')).toHaveLength(0);
    expect(q('[role="slider"]').getAttribute('aria-valuemax')).toBe('2450');
    await click('选择 part1_1');
    await click('播放分镜序列');
    q('.storyboard-preview__media').currentTime = 0.251;
    await frame();
    expect(q('.storyboard-preview__media').currentTime).toBe(0.5);
  });
  it('轨道定位保留待删除选区，外部修改才清除', async () => {
    await render();
    await click('字幕 卖');
    await click('选择 part2_1');
    expect(qa('.storyboard-pending-range')).toHaveLength(1);
    expect(q('[aria-label="字幕 卖"]').classList.contains('is-pending')).toBe(true);
    await click('字幕 满');
    await act(async () => updateExternal((parts) => parts.map((part) => ({ ...part }))));
    expect(qa('.storyboard-pending-range')).toHaveLength(0);
    expect(saved).not.toHaveBeenCalled();
  });
  it('点预览轨道其他位置只定位，不取消已标记待删除', async () => {
    await render();
    await click('字幕 卖');
    const surface = q('.storyboard-lane__surface');
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000 });
    Object.defineProperty(surface, 'offsetWidth', { value: 1000, configurable: true });
    await act(async () => {
      surface.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
      surface.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    });
    expect(q('[aria-label="字幕 卖"]').classList.contains('is-pending')).toBe(true);
    expect(qa('.storyboard-pending-range')).toHaveLength(1);
  });
  it('双击编辑不保留删除预览，字幕 Delete 只处理已选时间片段', async () => {
    await render();
    await click('字幕 卖');
    await act(async () => q('[aria-label="字幕 卖"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(q('[aria-label="编辑字幕"]')).not.toBeNull();
    expect(qa('.storyboard-pending-range')).toHaveLength(0);
    await act(async () => q('[aria-label="编辑字幕"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await click('字幕 满');
    await press('Delete');
    expect(saved).toHaveBeenCalledOnce();
    expect(latest.slice(0, 2).map((part) => part.text)).toEqual(['外卖', '30，']);
  });
});
