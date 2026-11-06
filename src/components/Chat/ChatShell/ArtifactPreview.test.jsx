import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import ArtifactPreview from './ArtifactPreview';
import { formatDraftUpdatedAt } from '../pinnedDraftMetadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const previewCss = readFileSync(resolve(process.cwd(), 'src/components/Chat/ChatShell/ArtifactPreview.css'), 'utf8');
import PinnedArtifactPannel from '@renderer/pages/home/Inputbar/components/PinnedArtifactPannel/PinnedArtifactPannel';
const { player } = vi.hoisted(() => ({ player: vi.fn() }));
vi.mock('@renderer/pages/home/Messages/Tools/MessageAgentTools/AudioGenerationTool', () => ({ AudioGenerationToolBody: (props) => { player(props); return <div data-testid="record-player" />; } }));
vi.mock('@renderer/pages/home/Inputbar/components/PinnedDraftTrackView/PinnedDraftTrackView', () => ({ default: () => <div /> }));
let container, root;
const audio = { id: 'a', runtimeSessionId: 'r', audioUrl: 'test.mp3', createdAt: 1, status: 'completed' };
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); player.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('renders real audio-only section, no empty draft section, and adapts player output', async () => {
  await act(async () => root.render(<ArtifactPreview audios={[audio]} />));
  expect(container.querySelector('section[aria-label="音频"]')).not.toBeNull();
  expect(container.textContent).not.toContain('草稿');
  expect(player.mock.calls[0][0]).toEqual({ output: { status: 'completed', audio_url: 'test.mp3' }, title: undefined, isRunning: false, compact: true });
});
it('passes the full speech copy as the artifact player title without adding a summary', async () => {
  const text = '这是一段很长的配音文案，'.repeat(30);
  await act(async () => root.render(<ArtifactPreview audios={[{ ...audio, text }]} />));
  expect(player.mock.calls[0][0]).toEqual({
    output: { status: 'completed', audio_url: 'test.mp3' },
    title: text, isRunning: false, compact: true
  });
});
it('shows audio after drafts and passes only actual billing and duration', async () => {
  const billing = { total_consumed_points: 2 };
  await act(async () => root.render(<ArtifactPreview drafts={[{ id: 'd', title: 'My draft', status: 'completed' }]} audios={[{ ...audio, billing, durationSeconds: 12 }]} />));
  expect([...container.querySelectorAll('h3')].map((el) => el.textContent)).toEqual(['草稿', '音频']);
  expect(container.textContent).toContain('My draft');
  expect(player.mock.calls[0][0].output).toEqual({ status: 'completed', audio_url: 'test.mp3', billing, duration_seconds: 12 });
});
it('renders audio-only pinned panel and supports keyboard activation', async () => {
  const onClick = vi.fn();
  await act(async () => root.render(<PinnedArtifactPannel audios={[audio]} onClick={onClick} />));
  const button = container.querySelector('[role="button"]');
  expect(button.getAttribute('aria-label')).toBe('查看生成的 1 音频');
  expect(button.textContent).toContain('生成 1 音频');
  await act(async () => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(onClick).toHaveBeenCalledOnce();
  await act(async () => root.render(<PinnedArtifactPannel drafts={[{ id: 'd' }]} audios={[audio]} />));
  expect(container.textContent).toContain('生成 1 草稿 1 音频');
  await act(async () => root.render(<PinnedArtifactPannel drafts={[{ id: 'd' }]} />));
  expect(container.textContent).toContain('生成 1 草稿');
  expect(container.textContent).not.toContain('音频');
  await act(async () => root.render(<PinnedArtifactPannel />));
  expect(container.textContent).toBe('');
});

const image = { id: 't', taskId: 't', runtimeSessionId: 'r', imageUrl: 'https://example.com/a.png', createdAt: 1, status: 'completed' };
it('renders real image-only grid and opens group preview only on click', async () => {
  await act(async () => root.render(<ArtifactPreview images={[image, { ...image, id: 'b', imageUrl: 'https://example.com/b.png' }]} />));
  expect(container.textContent).not.toContain('草稿');
  const grid = container.querySelector('.artifact-preview__image-grid');
  expect(grid.querySelectorAll('.ant-image img')).toHaveLength(2);
  expect([...grid.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([image.imageUrl, 'https://example.com/b.png']);
  expect(document.querySelector('.ant-image-preview')).toBeNull();
  await act(async () => grid.querySelector('.ant-image').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(document.querySelector('.ant-image-preview')).not.toBeNull();
  expect(document.querySelector('.ant-image-preview-switch-right')).not.toBeNull();
});
it('orders sections as drafts, images, audio', async () => {
  await act(async () => root.render(<ArtifactPreview drafts={[{ id: 'd', status: 'completed' }]} images={[image]} audios={[audio]} />));
  expect([...container.querySelectorAll('h3')].map((el) => el.textContent)).toEqual(['草稿', '图片', '音频']);
});
it('counts image-only and mixed artifacts, omitting zero counts', async () => {
  const onClick = vi.fn();
  await act(async () => root.render(<PinnedArtifactPannel images={[image]} onClick={onClick} />));
  const button = container.querySelector('[role="button"]');
  expect(button.getAttribute('aria-label')).toBe('查看生成的 1 图片');
  expect(button.textContent).toContain('生成 1 图片');
  expect(button.textContent).not.toMatch(/草稿|音频/);
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(onClick).toHaveBeenCalledOnce();
  await act(async () => root.render(<PinnedArtifactPannel drafts={[{ id: 'd' }]} images={[image, { ...image, id: 'b' }]} audios={[audio]} />));
  expect(container.textContent).toContain('生成 1 草稿 2 图片 1 音频');
});

it('renders document source entry after media and opens only on click', async () => {
  const item = { id: 'doc', filePath: '/workspace/test.html', createdAt: 1700000000000 };
  const open = vi.fn();
  await act(async () => root.render(<ArtifactPreview audios={[audio]} documents={[item]} onOpenDocument={open} />));
  expect([...container.querySelectorAll('h3')].map((el) => el.textContent)).toEqual(['音频', '文档']);
  expect(container.textContent).toContain('test.html');
  const section = container.querySelector('section[aria-label="文档"]');
  const row = section.querySelector('.artifact-preview__list > .artifact-preview__card > .artifact-preview__item');
  expect(row).not.toBeNull();
  expect(row.children[0].className).toBe('artifact-preview__cover is-placeholder');
  expect(row.children[0].querySelector('svg.lucide-file-chart-line')).not.toBeNull();
  const main = row.querySelector('.artifact-preview__item-main');
  expect(main.querySelector('.artifact-preview__item-title').getAttribute('title')).toBe('test.html');
  expect(main.querySelector('.artifact-preview__item-time').textContent).toBe(formatDraftUpdatedAt(item.createdAt));
  expect(row.querySelector('button.artifact-preview__export').textContent).toBe('打开');
  expect(previewCss).toMatch(/\.artifact-preview__cover\s*\{[^}]*width: 48px;[^}]*height: 48px;[^}]*border-radius: 12px;[^}]*background: #f0f0f0;/);
  expect(previewCss).toMatch(/\.artifact-preview__item-title\s*\{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  expect(previewCss).toMatch(/\.artifact-preview__list\s*\{[^}]*padding: 0 16px 16px;/);
  expect(previewCss).toMatch(/\.artifact-preview__export\s*\{[^}]*border-radius: 999px;/);
  expect(container.querySelector('iframe')).toBeNull();
  expect(open).not.toHaveBeenCalled();
  await act(async () => container.querySelector('section[aria-label="文档"] button').click());
  expect(open).toHaveBeenCalledWith(item);
  await act(async () => root.render(<PinnedArtifactPannel documents={[item]} />));
  expect(container.textContent).toContain('1 文档');
});
