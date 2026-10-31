import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { formatTemplateCount } from './formatCount';
import { trackEvent } from '../../../../shared/analytics';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../shared/analytics', () => ({ trackEvent: vi.fn() }));
let root;
let container;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  delete window.api;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('homepage operations cards', () => {
  it('shows only the first three compatible operations, opens the original and executes without installation', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const skill = (folderName, order, extra = {}) => ({ folderName, order, version: '1.0.0',
      name: folderName, title: `${folderName}模版`, followers_count: '15万+', likes_count: '1千+',
      web_share: 'https://example.com/original', ...extra });
    const manifest = { skills: {
      retired: skill('retired', 0, { deleted: true }),
      old: skill('old', 0, { maxAppVersion: '1.0.0' }),
      fourth: skill('fourth', 4), first: skill('first', 1), third: skill('third', 3), second: skill('second', 2)
    } };
    const install = vi.fn();
    window.api = { getAppInfo: async () => ({ version: '1.7.27', appDataPath: '/data', resourcesPath: '/resources' }),
      fs: { readText: vi.fn().mockResolvedValue(JSON.stringify(manifest)) } };
    window.electronAPI = { agentSkills: { installFromDirectory: install } };
    const onSelectSkill = vi.fn();
    const onOpenWebPreview = vi.fn();
    const onOpenSkillStore = vi.fn();
    const { default: WelcomePage } = await import('./index.js');
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<WelcomePage emptyWelcomeText="今天想要做什么视频？"
      onSelectSkill={onSelectSkill} onOpenWebPreview={onOpenWebPreview} onOpenSkillStore={onOpenSkillStore} />));
    const cards = container.querySelectorAll('article');
    expect(cards).toHaveLength(3);
    expect(trackEvent.mock.calls.filter(([event]) => event === 'quick_skill_explore')).toEqual([
      ['quick_skill_explore', { title: 'first模版' }],
      ['quick_skill_explore', { title: 'second模版' }],
      ['quick_skill_explore', { title: 'third模版' }],
    ]);
    expect([...cards].map((card) => card.querySelector('.chat-panel__welcome-skill-name').textContent)).toEqual(['first模版', 'second模版', 'third模版']);
    await act(async () => cards[0].click());
    expect(onOpenWebPreview).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: 'https://example.com/original' }));
    expect(document.querySelector('.ant-modal')).toBeNull();
    expect(trackEvent).toHaveBeenCalledWith('quick_skill_preview_url_click', { title: 'first模版' });
    for (const key of ['Enter', ' ']) {
      await act(async () => cards[0].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
    }
    expect(onOpenWebPreview).toHaveBeenCalledTimes(3);
    await act(async () => cards[0].querySelector('.chat-panel__welcome-skill-actions button').click());
    expect(onOpenWebPreview).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/original' }));
    await act(async () => cards[0].querySelectorAll('.chat-panel__welcome-skill-actions button')[1].click());
    expect(trackEvent).toHaveBeenCalledWith('quick_skill_do_same_click', { title: 'first模版' });
    expect(onSelectSkill).toHaveBeenCalledWith(expect.objectContaining({ folderName: 'first', directoryPath: '/resources/quick/skills/first' }));
    expect(window.api.fs.readText).toHaveBeenCalledExactlyOnceWith('/resources/quick/skills/manifest.json');
    expect(install).not.toHaveBeenCalled();
    await act(async () => container.querySelector('.chat-panel__welcome-more-skills').click());
    expect(onOpenSkillStore).toHaveBeenCalledOnce();
    delete window.electronAPI;
  });
});

describe('template count formatting', () => {
  it.each([[0, '0'], [9999, '9999'], [10000, '1.0万'], [16500, '1.7万'],
    ['15万+', '15.0万'], ['1千+', '1000+'], ['6千+', '6000+'], ['6,853', '6853'], [null, '—']])(
    'formats %s as %s', (input, output) => expect(formatTemplateCount(input)).toBe(output)
  );
});
