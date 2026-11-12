import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TextFilePreview from './TextFilePreview';

vi.mock('shiki', () => ({ createHighlighter: vi.fn().mockRejectedValue(new Error('plain fallback')) }));

let container;
let root;
const content = '# 标题\n\n- 项目\n\n| 列 |\n| --- |\n| 内容 |\n\n```js\nconst a = 1;\n```';
const preview = { name: 'notes.md', path: '/tmp/notes.md', kind: 'markdown', language: 'markdown', status: 'ready', content };
const render = async (value = preview, props = {}) => {
  await act(async () => root.render(<TextFilePreview preview={value} {...props} />));
};
const click = async (label) => {
  const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => button.click());
};
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Markdown file preview', () => {
  it('renders real headings, lists, tables and fenced code by default', async () => {
    await render();
    expect(container.querySelector('h1')?.textContent).toBe('标题');
    expect(container.querySelector('li')?.textContent).toBe('项目');
    expect(container.querySelector('td')?.textContent).toBe('内容');
    expect(container.querySelector('.chat-markdown').textContent).toContain('const a = 1;');
    expect(container.querySelector('.chat-file-preview__line-action')).toBeNull();
  });

  it.each([
    { name: 'NOTES.MD' },
    { name: '', path: '/tmp/notes.markdown' },
    { name: 'notes', language: 'markdown' },
  ])('recognizes Markdown even when kind is text: %j', async (overrides) => {
    await render({ ...preview, kind: 'text', language: 'text', ...overrides });
    expect(container.querySelector('h1')).not.toBeNull();
    expect(container.querySelector('.chat-file-preview__kind').textContent).toBe('Markdown');
  });

  it('only offers edit in the preview toolbar and returns to preview after cancel', async () => {
    await render();
    expect(Array.from(container.querySelectorAll('.chat-file-preview__header-actions button')).map((node) => node.textContent)).toEqual(['编辑']);
    await click('编辑');
    expect(container.querySelector('textarea').value).toBe(content);
    await click('取消');
    expect(container.querySelector('h1')).not.toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    await render({ ...preview, path: '/tmp/other.md', name: 'other.md' });
    expect(container.querySelector('h1')).not.toBeNull();
  });

  it('edits and saves raw Markdown then returns to preview', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue(true);
    await render(preview, { onSaveEdit });
    await click('编辑');
    const textarea = container.querySelector('textarea');
    expect(textarea.value).toBe(content);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, '# 新标题');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('保存');
    expect(onSaveEdit).toHaveBeenCalledWith({ fileName: 'notes.md', filePath: '/tmp/notes.md', content: '# 新标题' });
    expect(container.querySelector('h1')).not.toBeNull();
  });

  it('keeps ordinary text as source and does not execute HTML', async () => {
    await render({ ...preview, name: 'notes.txt', path: '/tmp/notes.txt', kind: 'text', language: 'text' });
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('.chat-file-preview__code')).not.toBeNull();
    await render({ ...preview, content: '# Safe\n\n<script>alert(1)</script>' });
    expect(container.querySelector('script')).toBeNull();
  });
});
