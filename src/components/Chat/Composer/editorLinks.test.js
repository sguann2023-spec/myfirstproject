import { readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.js`, 'utf8');
const config = source.match(/StarterKit\.configure\((\{[^}]*\})\)/)[1];
const options = new Function(`return (${config});`)();

function withEditor(run) {
  const editor = new Editor({ extensions: [StarterKit.configure(options)] });
  try {
    run(editor);
  } finally {
    editor.destroy();
  }
}

describe('composer URL text', () => {
  it('keeps typed and pasted URLs as ordinary text without a link mark', () => {
    withEditor((editor) => {
      const url = 'https://docs.justoneapi.com/zh/api/douyin-e-commerce/item-details-v2';
      expect(editor.schema.marks.link).toBeUndefined();
      editor.commands.insertContent(`${url} `);
      expect(editor.getText()).toBe(`${url} `);
      expect(editor.getHTML()).not.toContain('<a');
      editor.commands.setContent('');
      editor.view.pasteText(url, new Event('paste'));
      expect(editor.getText()).toBe(url);
      expect(editor.getHTML()).not.toContain('<a');
    });
  });

  it('strips pasted HTML links and does not open a URL when clicked', () => {
    withEditor((editor) => {
      const url = 'https://v.douyin.com/n3ER5oiVdZ8/';
      editor.view.pasteHTML(`<a href="${url}" target="_blank">${url}</a>`, new Event('paste'));
      expect(editor.getText()).toBe(url);
      expect(editor.view.dom.querySelector('a')).toBeNull();
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      try {
        editor.view.dom.querySelector('p').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(open).not.toHaveBeenCalled();
      } finally {
        open.mockRestore();
      }
    });
  });
});
