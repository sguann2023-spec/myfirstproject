import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../shared/analytics', () => ({ trackEvent: vi.fn() }));
let root;
let container;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  delete window.api;
  vi.restoreAllMocks();
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
    window.api = { getAppInfo: async () => ({ version: '1.7.27', appDataPath: '/data', resourcesPath: '/resources', homepageOperationsPath: '/data/Data/QuickSkillsMock' }),
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
    expect([...cards].map((card) => card.querySelector('.chat-panel__welcome-skill-name').textContent)).toEqual(['first模版', 'second模版', 'third模版']);
    await act(async () => cards[0].querySelector('.chat-panel__welcome-skill-actions button').click());
    expect(onOpenWebPreview).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/original' }));
    await act(async () => cards[0].querySelectorAll('.chat-panel__welcome-skill-actions button')[1].click());
    expect(onSelectSkill).toHaveBeenCalledWith(expect.objectContaining({ folderName: 'first', directoryPath: '/data/Data/QuickSkillsMock/skills/first' }));
    expect(install).not.toHaveBeenCalled();
    await act(async () => container.querySelector('.chat-panel__welcome-more-skills').click());
    expect(onOpenSkillStore).toHaveBeenCalledOnce();
    delete window.electronAPI;
  });
});
