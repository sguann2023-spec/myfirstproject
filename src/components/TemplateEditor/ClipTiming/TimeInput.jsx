import React, { useLayoutEffect, useRef } from 'react';

export const formatClipTime = seconds => {
  const hundredths = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 100);
  const minutes = Math.floor(hundredths / 6000);
  const tail = `${String(minutes % 60).padStart(2, '0')}:${String(Math.floor(hundredths / 100) % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
  return minutes >= 60 ? `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${tail}` : tail;
};

export const parseClipTime = value => {
  if (!/^(?:\d+:){0,2}\d+(?:\.\d+)?$/.test(value.trim())) return NaN;
  const parts = value.trim().split(':').map(Number);
  if (parts.length > 1 && parts.at(-1) >= 60) return NaN;
  if (parts.length === 3 && parts[1] >= 60) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

export function timeSections(value) {
  const numbers = [...value.matchAll(/\d+/g)];
  const decimal = value.indexOf('.');
  const whole = numbers.filter(match => decimal < 0 || match.index < decimal);
  return numbers.map(match => ({
    start: match.index, end: match.index + match[0].length,
    step: match.index > decimal && decimal >= 0 ? 10 ** -match[0].length
      : 60 ** (whole.length - 1 - whole.indexOf(match))
  }));
}

export default function TimeInput({ value, onChange, onCommit, ...props }) {
  const ref = useRef(null);
  const pendingSelection = useRef(null);
  useLayoutEffect(() => {
    if (pendingSelection.current) {
      const sections = timeSections(value);
      const section = sections[Math.max(0, Math.min(pendingSelection.current.index, sections.length - 1))];
      if (section) ref.current.setSelectionRange(section.start, section.end);
      pendingSelection.current = null;
    }
  }, [value]);
  const selectSection = (input, index) => {
    const sections = timeSections(input.value);
    const section = sections[Math.max(0, Math.min(index, sections.length - 1))];
    if (section) input.setSelectionRange(section.start, section.end);
  };
  return <input {...props} ref={ref} value={value} inputMode="decimal"
    style={{ width: `${Math.max(8, value.length)}ch` }}
    onFocus={event => event.target.select()}
    onPointerUp={event => {
      const input = event.currentTarget;
      if (input.selectionStart !== input.selectionEnd) return;
      const sections = timeSections(input.value);
      const index = sections.findIndex(section => input.selectionStart <= section.end);
      selectSection(input, index < 0 ? sections.length - 1 : index);
    }}
    onChange={event => onChange(event.target.value)}
    onBlur={event => {
      if (!event.relatedTarget?.closest('[role="radio"], [role="switch"]')) onCommit();
    }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); onCommit(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const input = event.currentTarget;
      const sections = timeSections(value);
      const index = Math.max(0, sections.findIndex(section => input.selectionStart < section.end));
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        selectSection(input, index + (event.key === 'ArrowLeft' ? -1 : 1));
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const seconds = parseClipTime(value);
        if (!Number.isFinite(seconds) || !sections[index]) return;
        event.preventDefault();
        const next = formatClipTime(Math.max(0, seconds + (event.key === 'ArrowUp' ? 1 : -1) * sections[index].step));
        if (next === value) return;
        pendingSelection.current = { index: index + (timeSections(next).length - sections.length) };
        onChange(next);
      }
    }} />;
}
