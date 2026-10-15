import { expect, it } from 'vitest';
import { clipDropTarget } from './clipDrop';
import { clipInsertion } from '../../../shared/templateClipInsertion';

const rows = [{ id: 'top', top: 100, bottom: 135 }, { id: 'bottom', top: 135, bottom: 170 }];

it('轨道中部换轨、边界插轨、底部建立新轨道，锁定轨道不允许落下', () => {
  expect(clipDropTarget(115, rows, new Set())).toEqual({ trackId: 'top', invalid: false });
  expect(clipDropTarget(135, rows, new Set())).toEqual({ beforeTrackId: 'bottom', top: 135 });
  expect(clipDropTarget(180, rows, new Set())).toEqual({ beforeTrackId: null, top: 170 });
  expect(clipDropTarget(150, rows, new Set(['bottom']))).toEqual({ trackId: 'bottom', invalid: true });
});

it('相邻片段前后半区分别选择前插与后插，后续冲突顺延', () => {
  const clips = [{ id: 'one', start: 2, end: 5 }, { id: 'two', start: 5, end: 8 }];
  expect(clipInsertion(2.5, 2, clips)).toEqual({ start: 2, duration: 2, shifts: [
    { id: 'one', start: 4, duration: 3 }, { id: 'two', start: 7, duration: 3 }] });
  expect(clipInsertion(4, 2, clips)).toEqual({ start: 5, duration: 2, shifts: [{ id: 'two', start: 7, duration: 3 }] });
});

it('自动长度落入空档会贴到下一段，显式长度则保留并顺延', () => {
  const clips = [{ id: 'audio', start: 3, end: 7 }];
  expect(clipInsertion(0, 12, clips, true)).toEqual({ start: 0, duration: 3, shifts: [] });
  expect(clipInsertion(0, 5, clips)).toEqual({ start: 0, duration: 5, shifts: [{ id: 'audio', start: 5, duration: 4 }] });
});
