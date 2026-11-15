import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { templates, templatePage } from './fixtures/marketTemplates';
import { trackEvent } from '../../../shared/analytics';
import { installMarketTemplate, listMarketTemplates } from '../templateMarketService';
import TemplateMarketPage from '../TemplateMarketPage';

vi.mock('../../../shared/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../templateMarketService', async () => {
  const original = await vi.importActual('../templateMarketService');
  return { ...original, listMarketTemplates: vi.fn(), installMarketTemplate: vi.fn() };
});
vi.mock('../../Chat/ChatShell/WebPagePreview', () => ({ default: ({ preview, onClose }) => <div data-testid="web-preview">{preview.url}<button onClick={onClose}>关闭网页</button></div> }));
let container, root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  listMarketTemplates.mockImplementation(async ({ offset }) => templatePage(offset, 3));
  installMarketTemplate.mockResolvedValue({ id: 'local', name: '模板', origin: 'template-market', directoryPath: '/global/template' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async (props = {}) => act(async () => root.render(<TemplateMarketPage {...props} />));
const hover = async (card) => act(async () => card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
const click = async (element) => act(async () => element.click());

describe('template marketplace interactions', () => {
  it('shows three columns and loads a second page without duplicating cards', async () => {
    await render();
    expect(container.querySelectorAll('.template-market-column')).toHaveLength(3);
    expect(container.querySelectorAll('article')).toHaveLength(3);
    expect(container.textContent).not.toContain('我安装的');
    expect(container.querySelector('input')).toBeNull();
    await act(async () => container.querySelector('.template-market-scroll').dispatchEvent(new Event('scroll', { bubbles: true })));
    expect(container.querySelectorAll('article')).toHaveLength(6);
  });
  it('exposes hover actions once and opens the original in an embedded webpage', async () => {
    await render();
    const card = container.querySelector('article');
    await hover(card); await hover(card);
    expect(trackEvent).toHaveBeenCalledWith('skill_market_do_same_explore', { skill_name: templates[0].name });
    expect(trackEvent.mock.calls.filter(([event]) => event === 'skill_market_watch_explore')).toHaveLength(1);
    await click(card.querySelector('[aria-label^="查看"]'));
    expect(container.querySelector('[data-testid="web-preview"]').textContent).toContain(templates[0].web_share);
    expect(trackEvent).toHaveBeenCalledWith('skill_market_watch_click', { skill_name: templates[0].name });
  });
  it('installs before applying the template to chat', async () => {
    const onGoChat = vi.fn();
    await render({ onGoChat });
    const card = container.querySelector('article'); await hover(card);
    await click(card.querySelector('.template-market-apply'));
    expect(installMarketTemplate).toHaveBeenCalledWith(templates[0]);
    expect(onGoChat).toHaveBeenCalledWith(expect.objectContaining({ origin: 'template-market' }));
    expect(installMarketTemplate.mock.invocationCallOrder[0]).toBeLessThan(onGoChat.mock.invocationCallOrder[0]);
  });
  it('mounts a muted hover video only for the active card and unloads it on leaving', async () => {
    await render();
    const cards = [...container.querySelectorAll('article')];
    const videoFixture = templates.find((item) => item.preview.type === 'video') || templates[0];
    const card = cards.find((c) => c.getAttribute('aria-label') === `播放 ${videoFixture.name}`);
    expect(container.querySelectorAll('video')).toHaveLength(0);
    await hover(card);
    if (videoFixture.preview.type === 'video') {
      expect(container.querySelectorAll('video')).toHaveLength(1);
      expect(container.querySelector('video').muted).toBe(true);
    }
    await act(async () => card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    if (videoFixture.preview.type === 'video') expect(container.querySelectorAll('video')).toHaveLength(0);
  });
  it('opens a centered playback modal when clicking the media area', async () => {
    await render();
    await click(container.querySelector('article'));
    const modal = document.querySelector('.template-market-preview');
    expect(modal).not.toBeNull();
    const media = modal.querySelector('img, video');
    expect(media.getAttribute('src')).toBe(templates[0].preview.url);
    expect(container.querySelector('[data-testid="web-preview"]')).toBeNull();
  });
  it('keeps chat untouched if template installation fails', async () => {
    installMarketTemplate.mockRejectedValueOnce(new Error('安装失败'));
    const onGoChat = vi.fn();
    await render({ onGoChat });
    const card = container.querySelector('article'); await hover(card);
    await click(card.querySelector('.template-market-apply'));
    expect(onGoChat).not.toHaveBeenCalled();
  });
});


it('keeps the action backdrop masked as one layer without a solid seam', async () => {
  await render();
  await hover(container.querySelector('article'));
  const actions = container.querySelector('.template-market-card-actions');
  expect(actions.querySelector('.template-market-card-backdrop')?.getAttribute('aria-hidden')).toBe('true');
  expect(actions.style.getPropertyValue('--tpl-cover')).toContain(templates[0].preview.cover_url);
  const css = readFileSync('src/components/SkillStore/TemplateMarketPage.css', 'utf8');
  expect(css.match(/\.template-market-card-actions \{([^}]+)\}/)[1]).toContain('background: transparent');
  expect(css.match(/\.template-market-card-backdrop \{([^}]+)\}/)[1]).toContain('mask-image: linear-gradient');
  expect(css.match(/\.template-market-card-backdrop::before \{([^}]+)\}/)[1]).toContain('inset: -52px');
});

it('reuses the homepage preview shell, supports resizing, and closes without leaving the market', async () => {
  const onGoChat = vi.fn();
  await render({ onGoChat });
  await hover(container.querySelector('article'));
  await click(container.querySelector('[aria-label^="查看"]'));
  const pane = container.querySelector('.chat-panel__preview-pane--trailing.is-open');
  expect(pane).not.toBeNull();
  const separator = container.querySelector('[role="separator"]');
  const initialWidth = parseInt(pane.style.width, 10);
  await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(parseInt(pane.style.width, 10)).toBe(initialWidth + 20);
  await act(async () => separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(pane.style.width).toBe('400px');
  await click(container.querySelector('[data-testid="web-preview"] button'));
  expect(container.querySelector('.chat-panel__preview-pane.is-open')).toBeNull();
  expect(container.querySelector('h1').textContent).toBe('精选技能');
  expect(onGoChat).not.toHaveBeenCalled();
});


it('keeps card hover actions and videos available while the web preview is open', async () => {
  await render();
  const cards = [...container.querySelectorAll('article')];
  await hover(cards[0]);
  await click(cards[0].querySelector('[aria-label^="查看"]'));
  expect(container.querySelector('[data-testid="web-preview"]')).not.toBeNull();
  const videoItem = templates.find((item) => item.preview.type === 'video');
  expect(videoItem).toBeDefined();
  const target = cards.find((card) => card.getAttribute('aria-label') === `播放 ${videoItem.name}`);
  await hover(target);
  expect(target.classList.contains('is-active')).toBe(true);
  expect(target.querySelector('.template-market-apply')).not.toBeNull();
  expect(target.querySelector('.template-market-card-backdrop')).not.toBeNull();
  expect(target.querySelector('video')).not.toBeNull();
  expect(container.querySelector('[data-testid="web-preview"]')).not.toBeNull();
  await act(async () => target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
  expect(target.querySelector('.template-market-card-actions')).toBeNull();
  expect(target.querySelector('video')).toBeNull();
  expect(container.querySelector('[data-testid="web-preview"]')).not.toBeNull();
  await hover(target);
  await click(target.querySelector('[aria-label^="查看"]'));
  expect(container.querySelector('[data-testid="web-preview"]').textContent).toContain(videoItem.web_share);
});
