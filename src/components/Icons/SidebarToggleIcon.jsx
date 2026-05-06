import React from 'react';

const SidebarToggleIcon = ({ size = 20, color = '#5f6368', strokeWidth = 2, direction = 'right' }) => {
  const isLeft = direction === 'left';
  const arrowPath = isLeft ? 'M17 9L14 12L17 15' : 'M14 9L17 12L14 15';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="18" height="18" rx="2.5" stroke={color} strokeWidth={strokeWidth} />
      <path d="M9 3V21" stroke={color} strokeWidth={strokeWidth} />
      <path d={arrowPath} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export default SidebarToggleIcon;
