import React from 'react';

export function rulerScale(pixelsPerSecond, axisEnd, visibleStart = 0, visibleEnd = axisEnd) {
  const rawStep = 240 / pixelsPerSecond;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map(value => value * power).find(value => value >= rawStep);
  const minorStep = step / 5;
  const first = Math.max(0, Math.floor(visibleStart / minorStep) - 1);
  const last = Math.min(Math.floor(axisEnd / minorStep), Math.ceil(visibleEnd / minorStep) + 1);
  return {
    step,
    marks: Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => ({
      time: Number(((first + index) * minorStep).toFixed(6)),
      major: (first + index) % 5 === 0
    }))
  };
}

export default function TimelineRuler({ marks, pixelsPerSecond }) {
  return <div className="template-ruler-marks" aria-hidden="true">
    {marks.map(({ time, major }) => <div key={time}
      className={`template-ruler-mark ${major ? 'is-major' : ''} ${time === 0 ? 'is-origin' : ''}`} style={{ left: time * pixelsPerSecond }}>
      {major && <span>{time}s</span>}
      <i />
    </div>)}
  </div>;
}
