import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import useUploadCardVisibility from './useUploadCardVisibility';

let host, root, state, serial = 0;
function Harness(props) {
  state = useUploadCardVisibility(props);
  return state.visible ? <button onClick={state.dismiss}>初始上传卡片</button> : null;
}
const render = async (props) => act(async () => root.render(<Harness {...props} />));
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('new conversation upload cards', () => {
  it('only shows for an empty conversation after history has loaded', async () => {
    const sessionId = `visibility-${++serial}`;
    await render({ sessionId, historyLoading: true });
    expect(state.visible).toBe(false);
    await render({ sessionId, historyLoading: false });
    expect(state.visible).toBe(true);
    await render({ sessionId, hasUserMessages: true });
    expect(state.visible).toBe(false);
  });
  it('dismisses immediately after accepted send and keeps dismissal across conversation switches', async () => {
    const sessionId = `visibility-${++serial}`, other = `visibility-${++serial}`;
    await render({ sessionId });
    await act(async () => state.dismiss());
    expect(state.visible).toBe(false);
    await render({ sessionId: other });
    expect(state.visible).toBe(true);
    await render({ sessionId });
    expect(state.visible).toBe(false);
  });
  it('restores cards after leaving a tool or skill before sending', async () => {
    const sessionId = `visibility-${++serial}`;
    await render({ sessionId });
    expect(state.visible).toBe(true);
    await render({ sessionId, toolActive: true });
    expect(state.visible).toBe(false);
    await render({ sessionId, toolActive: false });
    expect(state.visible).toBe(true);
    await act(async () => state.dismiss());
    await render({ sessionId, toolActive: true });
    await render({ sessionId, toolActive: false });
    expect(state.visible).toBe(false);
  });
  it('shows cards again when New Conversation reuses the same empty session', async () => {
    const sessionId = `visibility-${++serial}`;
    await render({ sessionId });
    await act(async () => state.dismiss());
    expect(state.visible).toBe(false);
    await render({ sessionId, resetVersion: 1 });
    expect(state.visible).toBe(true);
    await act(async () => state.dismiss());
    expect(state.visible).toBe(false);
    await render({ sessionId, resetVersion: 2 });
    expect(state.visible).toBe(true);
    await render({ sessionId, resetVersion: 3, hasUserMessages: true });
    expect(state.visible).toBe(false);
  });
  it('recognizes an explicit new-conversation reset after remounting', async () => {
    const sessionId = `visibility-${++serial}`;
    await render({ sessionId });
    await act(async () => state.dismiss());
    await act(async () => root.unmount());
    root = createRoot(host);
    await render({ sessionId, resetVersion: 1 });
    expect(state.visible).toBe(true);
  });
  it('does not permanently dismiss a new session from stale messages while history loads', async () => {
    const sessionId = `visibility-${++serial}`;
    await render({ sessionId, hasUserMessages: true, historyLoading: true });
    await render({ sessionId, hasUserMessages: false, historyLoading: false });
    expect(state.visible).toBe(true);
  });
  it('keeps dismissal when the composer remounts', async () => {
    const sessionId = `visibility-${++serial}`;
    await render({ sessionId });
    await act(async () => state.dismiss());
    await act(async () => root.unmount());
    root = createRoot(host);
    await render({ sessionId });
    expect(state.visible).toBe(false);
  });
  it('keeps hover menus independent of card visibility and connects skills and accepted sends', () => {
    const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
    const composer = read('src/components/Chat/Composer/Composer.js');
    const chat = read('src/components/Chat/Chat.js');
    const tools = read('src/components/Chat/Composer/ToolArea/index.js');
    expect(chat).toContain("sessionHasUserMessages={messages.some((message) => message?.role === 'user')}");
    expect(chat).toContain('historyLoading={historyLoading}');
    expect(tools).toContain('trigger="hover"');
    expect(tools).not.toContain('onMenuOpenChange');
    expect(composer).not.toContain('toolMenuOpen');
    expect(composer).toContain('toolActive: hasSkillMention');
    expect(composer).toContain('const isDefaultAttachmentMode = !activeTool && !skillExample');
    expect(composer).not.toContain('onPointerDownCapture={dismissUploadCards}');
    expect(composer).toContain('if (!accepted) return;\n    dismissUploadCards();');
    expect(composer).not.toContain('const applySkillExampleDetail = React.useCallback(async (detail) => {\n    dismissUploadCards();');
    expect(composer).not.toContain('const handleToolSelect = React.useCallback((toolId) => {\n    dismissUploadCards();');
  });
});
