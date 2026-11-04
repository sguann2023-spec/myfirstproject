import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkillMembersSection from './SkillMembersSection';

vi.mock('antd', () => ({
  Empty: Object.assign(() => null, { PRESENTED_IMAGE_SIMPLE: 'simple' }),
  Popover: ({ children }) => children,
}));

const skills = [
  { id: 's1', name: '技能一' },
  { id: 's2', name: '技能二' },
];

let container, root, toggleCollapsed;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  toggleCollapsed = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const renderSection = (props = {}) => act(async () => root.render(
  <SkillMembersSection
    skillsLoading={false}
    skills={skills}
    skillPreviewPaths={{}}
    skillExamplePaths={{}}
    expandedSkillKeys={new Set()}
    skillTrees={{}}
    skillTreeLoading={{}}
    skillMembersCollapsed={false}
    onToggleSkillExpanded={vi.fn()}
    onToggleSkillMembersCollapsed={toggleCollapsed}
    getSkillKey={(skill) => skill.id}
    getSkillFolderLabel={() => ''}
    getSkillDisplayName={(skill) => skill.name}
    renderSkillTooltip={(skill, actions) => actions}
    renderTreeNodes={() => null}
    childrensBookSkillLabel=""
    {...props}
  />
));

const button = () => container.querySelector('.chat-panel__members-toggle-all');
const memberRows = () => [...container.querySelectorAll('.chat-panel__member-item')]
  .map((node) => node.textContent);

describe('SkillMembersSection collapse button', () => {
  it('shows the skills and offers collapsing by default', async () => {
    await renderSection();
    expect(memberRows()).toEqual(['技能一', '技能二']);
    expect(button().getAttribute('aria-label')).toBe('折叠技能成员');
    await act(async () => button().click());
    expect(toggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('hides every skill row while the section is collapsed', async () => {
    await renderSection({ skillMembersCollapsed: true });
    expect(memberRows()).toEqual([]);
    expect(button().getAttribute('aria-label')).toBe('展开技能成员');
    await act(async () => button().click());
    expect(toggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('hides the button while loading, on error, or with no skills', async () => {
    await renderSection({ skillsLoading: true });
    expect(button()).toBeNull();
    await renderSection({ skillsError: 'boom' });
    expect(button()).toBeNull();
    await renderSection({ skills: [] });
    expect(button()).toBeNull();
  });
});
