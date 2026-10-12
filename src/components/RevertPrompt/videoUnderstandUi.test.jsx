import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('antd', () => ({
  Tooltip: ({ children }) => children,
  Popover: ({ content, children }) => <div>{children}{content}</div>,
  Select: () => null,
}));
vi.mock('../../shared/analytics', () => ({ trackEvent: vi.fn() }));

import ToolArea from '../Chat/Composer/ToolArea/index';
import VideoDetailTool from '../VideoDetailTool/index';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
});
const render = (element) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(element));
};

describe('逐帧拉片菜单', () => {
  it('位于视频菜单最后，使用 GalleryHorizontal 并发送工具 ID', () => {
    const onSelect = vi.fn();
    render(<ToolArea onSelect={onSelect} />);
    const items = container.querySelector('[aria-label="video工具菜单"]').querySelectorAll('button');
    const last = items[items.length - 1];
    expect(last.textContent).toBe('逐帧拉片');
    expect(last.querySelector('svg.lucide-gallery-horizontal')).not.toBeNull();
    act(() => last.click());
    expect(onSelect).toHaveBeenCalledWith('video-understand');
  });
  it('详情标签使用相同图标并允许退出', () => {
    const onBack = vi.fn();
    render(<VideoDetailTool onBack={onBack} />);
    expect(container.querySelector('svg.lucide-gallery-horizontal')).not.toBeNull();
    act(() => container.querySelector('button').click());
    expect(onBack).toHaveBeenCalledOnce();
  });
  it('发送期间禁止退出', () => {
    const onBack = vi.fn();
    render(<VideoDetailTool disabled onBack={onBack} />);
    act(() => container.querySelector('button').click());
    expect(onBack).not.toHaveBeenCalled();
  });
});
