import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const read = path => readFileSync(`${process.cwd()}/src/${path}`, 'utf8');
const source = read('main/services/LegacyMainCompatIpc.ts');
// Execute the real window handler in isolation from unrelated legacy services.
const block = source.slice(source.indexOf('  let pendingSettingsTab:'), source.indexOf("  safeHandle('restart-beginner-guide'"))
  .replace('let pendingSettingsTab: string | undefined', 'let pendingSettingsTab')
  .replace('payload?: { tab?: string }', 'payload');
function setup(dev = true) {
  let open;
  const windows = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.loading = true;
      this.webContents = new EventEmitter();
      this.webContents.isLoadingMainFrame = () => this.loading;
      this.webContents.send = vi.fn();
      this.focus = vi.fn(); this.loadURL = vi.fn(); this.loadFile = vi.fn();
      windows.push(this);
    }
    isDestroyed() { return false; }
    loaded() { this.loading = false; this.webContents.emit('did-finish-load'); }
  }
  const authorize = vi.fn();
  new Function('safeOn', 'getMainWindow', 'BrowserWindow', 'isWin', 'path', 'app', 'process', '__dirname', 'configManager', 'allowCustomChatModelsWindow', `let settingsWindow = null; ${block}`)(
    (_channel, handler) => { open = handler; }, () => ({ isDestroyed: () => false }), Window, false,
    { join: (...args) => args.join('/') }, { getVersion: () => 'test' },
    { env: dev ? { ELECTRON_RENDERER_URL: 'http://localhost:5173/' } : {} }, '/app', { get: () => '/drafts' }, authorize,
  );
  return { open: tab => open({}, tab === undefined ? undefined : { tab }), windows, authorize };
}

describe('settings window navigation', () => {
  it.each([true, false])('passes a valid initial tab to the URL (dev=%s)', dev => {
    const { open, windows, authorize } = setup(dev);
    open('models');
    expect(authorize).toHaveBeenCalledExactlyOnceWith(windows[0]);
    expect(windows[0].options.width).toBe(1100);
    expect(dev ? windows[0].loadURL.mock.calls[0][0] : windows[0].loadFile.mock.calls[0][1].search).toContain('?view=settings&tab=models');
    windows[0].loaded();
    expect(windows[0].webContents.send).toHaveBeenCalledWith('settings:navigate', { tab: 'models' });
  });
  it('keeps only the latest requested tab while loading and reuses the loaded window', () => {
    const { open, windows } = setup();
    open('general'); open('models'); open('policy');
    expect(windows).toHaveLength(1);
    expect(windows[0].webContents.send).not.toHaveBeenCalled();
    windows[0].loaded();
    expect(windows[0].webContents.send).toHaveBeenCalledExactlyOnceWith('settings:navigate', { tab: 'policy' });
    open('models');
    expect(windows[0].webContents.send).toHaveBeenLastCalledWith('settings:navigate', { tab: 'models' });
    expect(windows[0].focus).toHaveBeenCalledTimes(3);
  });
  it('rejects unknown tabs without resetting the selected tab on a plain open', () => {
    const { open, windows } = setup();
    open('../evil'); windows[0].loaded(); open(); open('evil');
    expect(windows[0].loadURL.mock.calls[0][0]).toBe('http://localhost:5173/?view=settings');
    expect(windows[0].webContents.send).not.toHaveBeenCalled();
  });
  it('resets pending navigation when the window closes', () => {
    const { open, windows } = setup();
    open('models'); windows[0].emit('closed'); open(); windows[1].loaded();
    expect(windows[1].webContents.send).not.toHaveBeenCalled();
  });
});

it('routes the composer entry through HomePage instead of the old dialog', () => {
  const composer = read('components/Chat/Composer/Composer.js');
  const home = read('page/HomePage/HomePage.jsx');
  const chat = read('components/Chat/Chat.js');
  // HomePage renders Chat, not Composer directly: guard both sides of the wrapper.
  const chatProps = chat.slice(chat.indexOf('const Chat = ({'), chat.indexOf('}) => {', chat.indexOf('const Chat = ({')));
  const composerProps = chat.slice(chat.indexOf('<Composer'), chat.indexOf('/>', chat.indexOf('<Composer')));
  expect(chatProps).toMatch(/\bonOpenModelSettings\b/);
  expect(composerProps).toContain('onOpenModelSettings={onOpenModelSettings}');
  expect(composer).not.toContain('CustomModelsDialog');
  expect(composer).toContain('onOpenModelSettings?.()');
  expect(home).toContain("ipcRenderer.send('open-settings-window', { tab: 'models' })");
  expect(home).not.toContain('onSaveCustomModels=');
});
