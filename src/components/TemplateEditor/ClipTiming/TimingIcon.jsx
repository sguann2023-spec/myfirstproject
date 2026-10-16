import React from 'react';

const paths = {
  fixed: 'M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z',
  auto: 'M3.9,12C3.9,10.29 5.29,8.9 7,8.9H11V7H7A5,5 0 0,0 2,12A5,5 0 0,0 7,17H11V15.1H7C5.29,15.1 3.9,13.71 3.9,12M8,13H16V11H8V13M17,7H13V8.9H17C18.71,8.9 20.1,10.29 20.1,12C20.1,13.71 18.71,15.1 17,15.1H13V17H17A5,5 0 0,0 22,12A5,5 0 0,0 17,7Z',
  end: 'M4,11H14.2L10.6,7.4L12,6L18,12L12,18L10.6,16.6L14.2,13H4ZM19,6H21V18H19Z',
  fill: 'M4,6H6V18H4ZM6,11H13V8L20,12L13,16V13H6Z',
  media: 'M5,5V19L16,12ZM17,5H19V19H17Z',
  loop: 'M7,7H19L16,4L17.4,2.6L23,8.2L17.4,13.8L16,12.4L19,9.4H7V7ZM17,17H5L8,20L6.6,21.4L1,15.8L6.6,10.2L8,11.6L5,14.6H17V17Z'
};

export function clipTimingModes(native) {
  const range = native?.target_timerange ?? {};
  const timing = native?.auto_timing;
  const end = !!timing?.end && !timing?.start;
  const fixedStart = timing?.start?.target === 'parent' && timing.start.anchor === 'start' &&
    range.start !== undefined && timing.start.offset !== undefined && timing.start.offset === range.start;
  return {
    start: end ? 'end' : timing?.start && !fixedStart ? 'auto' : range.start !== undefined ? 'fixed' : 'auto',
    duration: native?.duration_mode === 'media' ? 'media' : native?.auto_duration || (!end && (timing?.end || (range.duration === undefined && range.end === undefined)))
      ? 'auto' : 'fixed'
  };
}

export default function TimingIcon({ mode, size = 12 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={paths[mode] ?? paths.fixed} />
  </svg>;
}
