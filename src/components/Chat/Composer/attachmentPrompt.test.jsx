import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ATTACHMENT_PROMPTS, getAttachmentPrompt, shouldReplaceAttachmentPrompt } from './attachmentPrompt';
import useAttachmentPrompt from './useAttachmentPrompt';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const reference = { purpose: 'reference' };
const material = { purpose: 'material' };
const buildDocument = (text) => ({ type: 'doc', content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] });
const getText = (editor) => editor.getText();
let host, root, editor, latest;
const setText = (text) => { latest = text; };
function Harness(props) {
  useAttachmentPrompt({ editor, files: [], enabled: true, sessionId: 'a', getText, setText, buildDocument, ...props });
  return null;
}
const render = async (props = {}) => act(async () => root.render(<Harness {...props} />));
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  editor = new Editor({ extensions: [StarterKit], content: buildDocument('') });
  latest = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  host.remove();
});

describe('editable attachment prompt', () => {
  it('keeps the editor empty and original hint intact without classified files', async () => {
    await render({ files: [{ name: '普通附件' }] });
    expect(editor.getText()).toBe('');
    expect(latest).toBeNull();
  });
  it.each([
    [[reference], 'reference'], [[material], 'material'], [[reference, material], 'both'],
  ])('inserts real editable text for %j', async (files, key) => {
    await render({ files });
    expect(editor.getText()).toBe(ATTACHMENT_PROMPTS[key]);
    expect(latest).toBe(ATTACHMENT_PROMPTS[key]);
    expect(editor.getJSON().content[0].content[0].type).toBe('text');
  });
  it('updates untouched generated text when file purposes change and clears it when both are removed', async () => {
    await render({ files: [reference] });
    await render({ files: [reference, material] });
    expect(editor.getText()).toBe(ATTACHMENT_PROMPTS.both);
    await render({ files: [material] });
    expect(editor.getText()).toBe(ATTACHMENT_PROMPTS.material);
    await render({ files: [] });
    expect(editor.getText()).toBe('');
  });
  it('does not replace existing or manually edited requests', async () => {
    editor.commands.setContent(buildDocument('保留我的要求'));
    await render({ files: [reference] });
    expect(editor.getText()).toBe('保留我的要求');
    editor.commands.clearContent();
    await render({ files: [] });
    await render({ files: [reference] });
    editor.commands.insertContent('我的修改');
    const edited = editor.getText();
    await render({ files: [reference, material] });
    await render({ files: [] });
    expect(editor.getText()).toBe(edited);
  });
  it('allows clearing the prefill without immediately reinserting it', async () => {
    await render({ files: [reference] });
    editor.commands.clearContent();
    await render({ files: [reference] });
    expect(editor.getText()).toBe('');
  });
  it('leaves tool-specific modes and restored custom text untouched', async () => {
    await render({ files: [reference], enabled: false });
    expect(editor.getText()).toBe('');
    editor.commands.setContent(buildDocument('另一个会话的正文'));
    await render({ files: [material], sessionId: 'b' });
    await render({ files: [material], sessionId: 'b' });
    expect(editor.getText()).toBe('另一个会话的正文');
  });
  it('recognizes restored automatic text and preserves inline reference nodes', async () => {
    editor.commands.setContent(buildDocument(ATTACHMENT_PROMPTS.reference));
    await render({ files: [reference, material] });
    expect(editor.getText()).toBe(ATTACHMENT_PROMPTS.both);
    expect(shouldReplaceAttachmentPrompt('', '', true)).toBe(false);
    expect(getAttachmentPrompt([{ purpose: 'invalid' }])).toBe('');
  });
});
