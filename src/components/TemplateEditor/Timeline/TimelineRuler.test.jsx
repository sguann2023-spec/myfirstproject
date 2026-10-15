import { expect, it } from 'vitest';
import { rulerScale } from './TimelineRuler';

it('主刻度使用自然间隔，中间四个圆点随缩放变化', () => {
  const scale = rulerScale(70, 22);
  expect(scale.step).toBe(5);
  expect(scale.marks.slice(0, 6)).toEqual([
    { time: 0, major: true }, { time: 1, major: false },
    { time: 2, major: false }, { time: 3, major: false },
    { time: 4, major: false }, { time: 5, major: true }
  ]);
  expect(rulerScale(140, 22).step).toBe(2);
  expect(rulerScale(10, 30).step).toBe(50);
  expect(rulerScale(700, 2).marks.every(mark => mark.time <= 2)).toBe(true);
});
