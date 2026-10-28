import React from 'react';
import { render, screen, fireEvent } from './markdown-links.test-utils';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveMarkdownFilePath, markdownUrlTransform } from '../../../shared/markdownFileLinks';
import { ChatTaskContext } from '../ChatShell/ChatTaskContext';
import Markdown from './Markdown/Markdown';
vi.mock('./Markdown/CodeBlock', () => ({ default: () => null }));

describe('local markdown paths', () => {
  it.each([
    ['./中文%20文件%23%3F.pdf', '/work', '/work/中文 文件#?.pdf'],
    ['/tmp/中文 空格#?.png', '', '/tmp/中文 空格#?.png'],
    ['file:///tmp/中文%20文件%23%3F.mp4', '', '/tmp/中文 文件#?.mp4'],
    ['file:///tmp/a#b?.png', '', '/tmp/a#b?.png'],
    ['../other/./a.txt', '/work/current', '/work/other/a.txt'],
    ['C:\\work\\a.txt', '', 'C:/work/a.txt'],
    ['file:///C:/work/a.txt', '', 'C:/work/a.txt'],
    ['file://localhost/tmp/a', '', '/tmp/a']
  ])('resolves %s', (href, workspace, expected) => expect(resolveMarkdownFilePath(href, workspace)).toBe(expected));
  it.each(['sandbox:/mnt/data/a', 'file://server/tmp/a', '//server/a', '/tmp/%00a', '/tmp/%ZZ', 'javascript:alert(1)', 'https://example.com'])('rejects %s', href => expect(() => resolveMarkdownFilePath(href, '/work')).toThrow());
  it('requires session workspace for relative paths', () => expect(() => resolveMarkdownFilePath('a.txt')).toThrow(/工作空间/));
  it.each(['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,test'])('keeps sanitizer for %s', href => expect(markdownUrlTransform(href, 'href')).toBe(''));
  it('does not allow file or sandbox image sources', () => {
    expect(markdownUrlTransform('file:///tmp/a.png', 'src')).toBe('');
    expect(markdownUrlTransform('sandbox:/mnt/a.png', 'src')).toBe('');
  });
  it('legacy renderer passes real sanitized links into preview callback', () => {
    const load = vi.fn();
    const openFilePath = href => load(resolveMarkdownFilePath(href, '/session/work'));
    render(<ChatTaskContext.Provider value={{ openFilePath }}><Markdown content={'[local](./中文%20文件%23%3F.pdf)'} /></ChatTaskContext.Provider>);
    fireEvent.click(screen.getByText('local'));
    expect(load).toHaveBeenCalledWith('/session/work/中文 文件#?.pdf');
  });
  it('wires shell callback to current session workspace and existing loader', () => {
    const source = readFileSync('src/components/Chat/ChatShell/ChatShell.js', 'utf8');
    const callback = source.match(/const openFilePath = React.useCallback\(async \(href\) => \{([\s\S]*?)\n  \}, \[currentWorkspacePath, loadFilePreviewByPath\]\)/)[1];
    const load = vi.fn(); const warning = vi.fn();
    const run = new Function('href', 'resolveMarkdownFilePath', 'currentWorkspacePath', 'loadFilePreviewByPath', 'message', `return (async () => {${callback}})()`);
    expect(source).toContain('openFilePath,\n            openAttachmentPreview');
    expect(source).toContain('getSelectedWorkspacePath(runtimeSession)');
    const urlBody = source.match(/const createFilePreviewUrl = \(filePath = ''\) => \{([\s\S]*?)\n\};/)[1];
    const createUrl = new Function('filePath', 'normalizePath', urlBody);
    expect(createUrl('/tmp/中文 a#b?.png', value => value)).toBe('file:///tmp/%E4%B8%AD%E6%96%87%20a%23b%3F.png');
    expect(createUrl('C:/work/a#b.png', value => value)).toBe('file:///C:/work/a%23b.png');
    expect(readFileSync('src/renderer/src/pages/home/Markdown/Markdown.tsx', 'utf8')).toContain('urlTransform={markdownUrlTransform}');
    return (async () => {
      await run('./a.pdf', resolveMarkdownFilePath, '/session/work', load, { warning });
      expect(load).toHaveBeenCalledWith('/session/work/a.pdf');
      await run('sandbox:/mnt/a.pdf', resolveMarkdownFilePath, '/session/work', load, { warning });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('sandbox'));
      expect(load).toHaveBeenCalledTimes(1);
    })();
  });
});
