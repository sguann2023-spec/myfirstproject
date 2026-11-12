import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { normalizeThinkingLevels, resolveThinkingLevel, thinkingLevelLabel } from './thinkingLevels';

// Ported from ZCode's ComposerModelMenu: fixed seeds keep animation stable on rerenders.
const EFFORT_BUBBLES = [
  { top: 4, size: 2, duration: 2.6, delay: -0.4 },
  { top: 14, size: 3, duration: 3.2, delay: -2.1 },
  { top: 8, size: 4, duration: 2.8, delay: -1.1 },
  { top: 18, size: 2, duration: 3.6, delay: -0.8 },
  { top: 3, size: 3, duration: 3, delay: -2.5 },
  { top: 12, size: 2, duration: 3.4, delay: -1.7 },
  { top: 6, size: 3, duration: 3.1, delay: -0.9 },
  { top: 17, size: 4, duration: 2.9, delay: -2.3 },
  { top: 10, size: 2, duration: 3.5, delay: -0.2 },
  { top: 2, size: 2, duration: 2.7, delay: -1.8 },
  { top: 15, size: 3, duration: 3.3, delay: -1.2 },
  { top: 7, size: 4, duration: 3.6, delay: -3.1 },
];
const HIGHSPEED_BUBBLES = Array.from({ length: 32 }, (_, index) => ({
  ...EFFORT_BUBBLES[index % EFFORT_BUBBLES.length],
  duration: (8 + (index % 5)) / 10,
  delay: -index * 0.137,
}));

function RollingThoughtLabel({ label }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);
  return <span className="chat-panel__thinking-label" title={label}>
    {reducedMotion ? <span>{label}</span> : <AnimatePresence initial={false} mode="popLayout">
      <motion.span key={label} initial={{ y: '0.75em', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: '-0.75em', opacity: 0 }} transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}>{label}</motion.span>
    </AnimatePresence>}
  </span>;
}

export default function ThinkingLevelSlider({ option, value, onChange }) {
  const [hoveredStop, setHoveredStop] = useState(null);
  const levels = normalizeThinkingLevels(option?.thinking_levels);
  if (!levels.length) return null;
  const selected = resolveThinkingLevel(option, value);
  const index = levels.indexOf(selected);
  const progress = levels.length > 1 ? index / (levels.length - 1) : 0;
  const filled = !['disabled', 'false', 'no', 'none', 'nothink', 'no-think', 'no_think', 'off'].includes(selected);
  const max = filled && index === levels.length - 1;
  const modelName = String(option?.displayText || option?.label || '');
  const highspeed = /glm/i.test(modelName) && /highspeed|flashx/i.test(modelName);
  const selectValue = (nextIndex) => {
    const level = levels[nextIndex];
    if (levels.length > 1 && level) onChange?.(option.value, level);
  };
  return (
    <div className="chat-panel__thinking-control">
      <div className="chat-panel__thinking-heading"><span>思考强度</span><span><RollingThoughtLabel label={thinkingLevelLabel(selected)} /></span></div>
      {levels.length > 1 ? <div className="chat-panel__thinking-slider" data-disabled="false">
        <div key={JSON.stringify([option.value, levels])} aria-hidden="true" className="chat-panel__thinking-visual">
          <div className="chat-panel__thinking-track" data-progress={filled ? progress * 100 : 0}>
            <div className="chat-panel__thinking-track-border" />
            <div className="chat-panel__thinking-slider-fill" data-max={max} data-highspeed={highspeed}
              style={{ width: filled ? `calc(14px + (100% - 28px) * ${progress})` : 0 }}>
              {max ? <div className="chat-panel__thinking-bubbles">
                {(highspeed ? HIGHSPEED_BUBBLES : EFFORT_BUBBLES).map((bubble, bubbleIndex) => <span key={bubbleIndex}
                  className="chat-panel__thinking-bubble" style={{ top: bubble.top, animationDuration: `${bubble.duration}s`, animationDelay: `${bubble.delay}s` }}>
                  <span style={{ width: bubble.size, height: bubble.size }} />
                </span>)}
              </div> : null}
            </div>
          </div>
          <div className="chat-panel__thinking-stops">{levels.map((level, stopIndex) => <span key={level}
            className="chat-panel__thinking-slider-stop" data-filled={filled && stopIndex <= index}
            data-hovered={hoveredStop === `${option.value}:${level}`} />)}</div>
          <div className="chat-panel__thinking-slider-thumb" style={{ left: `calc((100% - 28px) * ${progress})` }} />
        </div>
        <input type="range" min="0" max={levels.length - 1} step="1" value={index}
          className="chat-panel__thinking-range" aria-label={`${modelName || option.value || ''} 思考强度`}
          aria-valuetext={thinkingLevelLabel(selected)} data-levels={JSON.stringify(levels)}
          onPointerLeave={() => setHoveredStop(null)}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const trackWidth = rect.width - 28;
            const stopIndex = Math.round(((event.clientX - rect.left - 14) / trackWidth) * (levels.length - 1));
            const level = levels[stopIndex];
            const center = rect.left + 14 + (trackWidth * stopIndex) / (levels.length - 1);
            setHoveredStop(event.pointerType !== 'touch' && level && Math.abs(event.clientX - center) <= 10 ? `${option.value}:${level}` : null);
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation(); }}
          onKeyUp={(event) => {
            if (['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) selectValue(Number(event.currentTarget.value));
          }}
          onPointerUp={(event) => selectValue(Number(event.currentTarget.value))}
          onChange={(event) => selectValue(Number(event.currentTarget.value))} />
      </div> : null}
    </div>
  );
}
