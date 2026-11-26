import { useEffect, useRef } from 'react';
import { ATTACHMENT_PROMPTS, getAttachmentPrompt, shouldReplaceAttachmentPrompt } from './attachmentPrompt';

export default function useAttachmentPrompt({ editor, files, enabled, sessionId, getText, setText, buildDocument }) {
  const state = useRef({ sessionId, prompt: '', key: null });
  useEffect(() => {
    if (state.current.sessionId !== sessionId) {
      state.current = { sessionId, prompt: '', key: null };
      return;
    }
    if (!enabled || !editor || editor.isDestroyed) {
      state.current.key = null;
      state.current.prompt = '';
      return;
    }
    const nextPrompt = getAttachmentPrompt(files);
    if (state.current.key === nextPrompt) return;
    state.current.key = nextPrompt;
    const text = getText(editor);
    let hasInlineNodes = false;
    editor.state.doc.descendants((node) => {
      if (node.isInline && !node.isText) hasInlineNodes = true;
    });
    const previousPrompt = state.current.prompt || (Object.values(ATTACHMENT_PROMPTS).includes(text) ? text : '');
    state.current.prompt = '';
    if (!shouldReplaceAttachmentPrompt(text, previousPrompt, hasInlineNodes)) return;
    if (text !== nextPrompt) {
      editor.commands.setContent(buildDocument(nextPrompt), { emitUpdate: false });
      setText(nextPrompt);
    }
    state.current.prompt = nextPrompt;
  }, [editor, files, enabled, sessionId, getText, setText, buildDocument]);
}
