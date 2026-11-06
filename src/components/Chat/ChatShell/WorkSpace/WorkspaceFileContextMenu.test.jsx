import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
let root;
let container;
const render = (element) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(element));
};
const cleanup = () => { act(() => root?.unmount()); container?.remove(); };
const screen = {
  getAllByRole: (role) => Array.from(document.querySelectorAll(`[role="${role}"]`)),
  getByRole: (role) => document.querySelector(`[role="${role}"]`),
  queryByRole: (role) => document.querySelector(`[role="${role}"]`),
};
const fireEvent = Object.fromEntries(['click', 'mouseDown', 'keyDown', 'resize', 'scroll'].map((type) => [type, (target, options = {}) => {
  act(() => target.dispatchEvent(type === 'keyDown'
    ? new KeyboardEvent('keydown', { bubbles: true, ...options })
    : new Event(type.toLowerCase(), { bubbles: true, ...options })));
}]));
import WorkspaceFileContextMenu from './WorkspaceFileContextMenu';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const entry = () => ({ x: 990, y: 790, rootPath: '/workspace', node: { path: 'a.txt', name: 'a.txt' }, absolutePath: '/workspace/a.txt', onOpen: vi.fn() });

describe('workspace file context menu', () => {
  it('opens the existing preview, reveals the exact path, and adds a reference without opening it', () => {
    const state = entry();
    const onClose = vi.fn();
    const onAddToChat = vi.fn();
    window.api = { file: { showInFolder: vi.fn() } };
    render(<WorkspaceFileContextMenu state={state} onClose={onClose} onAddToChat={onAddToChat} />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    fireEvent.click(items[0]);
    expect(state.onOpen).toHaveBeenCalledOnce();
    fireEvent.click(items[1]);
    expect(window.api.file.showInFolder).toHaveBeenCalledWith('/workspace/a.txt');
    fireEvent.click(items[2]);
    expect(onAddToChat).toHaveBeenCalledWith({ rootPath: state.rootPath, node: state.node });
    expect(state.onOpen).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('clamps to the viewport and supports keyboard navigation and dismissals', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 110 });
    const onClose = vi.fn();
    render(<WorkspaceFileContextMenu state={entry()} onClose={onClose} />);
    const menu = screen.getByRole('menu');
    expect(parseInt(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - 200);
    expect(parseInt(menu.style.top)).toBeLessThanOrEqual(window.innerHeight - 110);
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.mouseDown(items[1]);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    fireEvent.resize(window);
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('renders nothing while closed', () => {
    render(<WorkspaceFileContextMenu state={null} onClose={vi.fn()} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
