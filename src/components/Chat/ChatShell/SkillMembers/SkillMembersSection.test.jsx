import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkillMembersSection from './SkillMembersSection';

vi.mock('antd', () => ({
  Dropdown: ({ children, menu, trigger }) => {
    const [open, setOpen] = React.useState(false);
    return <div data-testid="skill-dropdown" data-trigger={trigger.join(',')}>
      {React.cloneElement(children, { onClick: (event) => {
        children.props.onClick?.(event);
        setOpen((value) => !value);
      } })}
      {open && <div role="menu">{menu.items.map((item) => <button
        key={item.key}
        role="menuitem"
        data-danger={item.danger || undefined}
        onClick={(event) => {
          menu.onClick({ key: item.key, domEvent: event });
          setOpen(false);
        }}>{item.label}</button>)}</div>}
    </div>;
  },
  Empty: Object.assign(({ description }) => <div>{description}</div>, { PRESENTED_IMAGE_SIMPLE: 'simple' }),
  Popover: ({ children, content, open, onOpenChange, placement, trigger }) => (
    <div
      data-testid="skill-popover"
      data-placement={placement}
      data-trigger={trigger}
      onMouseOver={() => onOpenChange(true)}>
      {children}
      {open && <div role="tooltip">{content}</div>}
    </div>
  ),
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

const renderSection = (props = {}, inPreview = false) => act(async () => {
  const section = <SkillMembersSection
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
  />;
  root.render(inPreview ? (
    <section className="chat-preview-start">
      <div className="chat-preview-start__content">
        <h1>新标签页</h1>
        {section}
      </div>
    </section>
  ) : section);
});

const button = () => container.querySelector('.chat-panel__members-toggle-all');
const memberRows = () => [...container.querySelectorAll('.chat-panel__member-item, .skill-members-section__card .artifact-preview__item-title')]
  .map((node) => node.textContent);

describe('SkillMembersSection collapse button', () => {
  it('shows the skills and offers collapsing by default', async () => {
    await renderSection();
    expect(memberRows()).toEqual(['技能一', '技能二']);
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('.chat-panel__members-count').textContent).toBe('2');
    expect(container.querySelector('.chat-panel__section-divider')).not.toBeNull();
    expect(button().getAttribute('aria-label')).toBe('折叠技能成员');
    expect(button().title).toBe('折叠技能成员');
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

describe('SkillMembersSection preview variant', () => {
  it('uses a dedicated h1 alongside the new-tab heading, keeping the count without a trailing divider', async () => {
    await renderSection({ variant: 'preview', title: 'Skill members' }, true);

    const headings = [...container.querySelectorAll('h1')];
    expect(headings).toHaveLength(2);
    expect(headings[0].textContent).toBe('新标签页');
    expect(headings[1].classList.contains('skill-members-section__preview-title')).toBe(true);
    expect(headings[1].firstChild.textContent).toBe('Skill members');
    expect(headings[1].querySelector('.chat-panel__members-count').textContent).toBe('2');
    expect(headings[1].closest('.skill-members-section--preview')).not.toBeNull();
    expect(container.querySelector('h2')).toBeNull();
    expect(container.querySelector('.chat-panel__section-divider')).toBeNull();
    expect(memberRows()).toEqual(['技能一', '技能二']);
    expect(button()).toBeNull();
    expect(container.querySelector('.skill-members-section__view-all').textContent).toBe('查看所有技能 ');

    const onOpenSkillStore = vi.fn();
    await renderSection({ variant: 'preview', title: 'Skill members', skillMembersCollapsed: true, onOpenSkillStore }, true);
    expect(button()).toBeNull();
    await act(async () => container.querySelector('.skill-members-section__view-all').click());
    expect(onOpenSkillStore).toHaveBeenCalledOnce();
    expect(toggleCollapsed).not.toHaveBeenCalled();
    expect(memberRows()).toEqual(['技能一', '技能二']);
    expect(container.querySelector('.chat-panel__members-count').textContent).toBe('2');
    expect(container.querySelector('.chat-panel__section-divider')).toBeNull();
  });

  it('preserves loading, error, empty, and skill-store states', async () => {
    await renderSection({ variant: 'preview', skillsLoading: true });
    expect(container.textContent).toContain('加载中...');
    expect(container.querySelector('.chat-panel__members-count')).toBeNull();
    expect(button()).toBeNull();

    await renderSection({ variant: 'preview', skillsError: '读取技能失败' });
    expect(container.textContent).toContain('读取技能失败');
    expect(memberRows()).toEqual([]);
    expect(button()).toBeNull();

    const onOpenSkillStore = vi.fn();
    await renderSection({ variant: 'preview', skills: [], onOpenSkillStore });
    expect(container.textContent).toContain('未发现技能');
    expect(container.querySelector('.chat-panel__members-count').textContent).toBe('0');
    expect(button()).toBeNull();
    await act(async () => container.querySelector('.chat-panel__find-skills-button').click());
    expect(onOpenSkillStore).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.chat-panel__section-divider')).toBeNull();
  });

});

describe('SkillMembersSection preview cards', () => {
  it('uses artifact card styles, display names and descriptions instead of the directory tree', async () => {
    const description = '适合在窄窗口中显示的很长技能描述。'.repeat(12);
    const renderTreeNodes = vi.fn();
    await renderSection({
      variant: 'preview',
      skills: [{ ...skills[0], description }, { ...skills[1], name: '' }],
      skillPreviewPaths: { s1: '/preview.html' },
      getSkillFolderLabel: (skill) => `folder-${skill.id}`,
      expandedSkillKeys: new Set(['s1']),
      skillTrees: { s1: [{ name: 'SKILL.md' }] },
      renderTreeNodes,
    });

    const cards = [...container.querySelectorAll('.skill-members-section__card')];
    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.classList.contains('artifact-preview__item'))).toBe(true);
    expect(memberRows()).toEqual(['技能一', 'folder-s2']);
    const summary = cards[0].querySelector('.skill-members-section__description');
    expect(summary.textContent).toBe(description);
    expect(summary.hasAttribute('title')).toBe(false);
    expect(cards[1].querySelector('.skill-members-section__description').textContent).toBe('');
    const actions = cards[0].querySelector(':scope > .skill-members-section__card-actions');
    expect(actions).not.toBeNull();
    expect(actions.previousElementSibling).toBe(cards[0].querySelector('.artifact-preview__item-main'));
    expect(cards[0].querySelector('.artifact-preview__item-main .skill-members-section__card-actions')).toBeNull();
    expect([...actions.querySelectorAll('button')].map((node) => node.textContent)).toEqual(['使用', '']);
    expect(actions.querySelector('[aria-label="更多 技能一"] svg.lucide-ellipsis')).not.toBeNull();
    expect(actions.querySelectorAll('.artifact-preview__export')).toHaveLength(2);
    expect(container.querySelector('.chat-panel__tree-toggle')).toBeNull();
    expect(container.querySelector('.chat-panel__tree-icon')).toBeNull();
    expect(container.querySelector('.chat-panel__member-main')).toBeNull();
    expect(container.querySelector('.chat-panel__member-tree')).toBeNull();
    expect(renderTreeNodes).not.toHaveBeenCalled();
  });

  it('renders the supplied media src directly and a placeholder for missing covers', async () => {
    const src = 'media://skills/example%20cover.png';
    await renderSection({
      variant: 'preview',
      skills: [{ ...skills[0], __exampleCoverSrc: src }, skills[1]],
    });
    const covers = container.querySelectorAll('.artifact-preview__cover');
    expect(covers[0].querySelector('img').getAttribute('src')).toBe(src);
    expect(covers[0].querySelector('img').alt).toBe('');
    expect(covers[0].querySelector('.skill-members-section__cover-placeholder')).toBeNull();
    expect(covers[1].querySelector('img')).toBeNull();
    expect(covers[1].querySelector('[aria-label="暂无封面"] svg')).not.toBeNull();
  });

  it('falls back on image error, keeps the fallback for the same src, and retries when src changes', async () => {
    const showCover = (src) => renderSection({
      variant: 'preview',
      skills: [{ ...skills[0], __exampleCoverSrc: src }, { ...skills[1], __exampleCoverSrc: '/other.png' }],
    });
    const firstCover = () => container.querySelector('.artifact-preview__cover');
    await showCover('/broken.png');
    await act(async () => firstCover().querySelector('img').dispatchEvent(new Event('error')));
    expect(firstCover().querySelector('img')).toBeNull();
    expect(firstCover().querySelector('[aria-label="暂无封面"]')).not.toBeNull();
    expect(container.querySelectorAll('.artifact-preview__cover img')).toHaveLength(1);

    await showCover('/broken.png');
    expect(firstCover().querySelector('img')).toBeNull();
    await showCover('/replacement.png');
    expect(firstCover().querySelector('img').getAttribute('src')).toBe('/replacement.png');
    expect(firstCover().querySelector('[aria-label="暂无封面"]')).toBeNull();
    await showCover('');
    expect(firstCover().querySelector('img')).toBeNull();
    await showCover('/broken.png');
    expect(firstCover().querySelector('img').getAttribute('src')).toBe('/broken.png');
  });

  it.each([
    ['使用', 'onSelectSkill', {}],
    ['查看', 'onRunSkillExample', { skillExamplePaths: { s1: '/example.html' } }],
    ['查看', 'onRunSkillExample', { skillExamplePaths: { s1: '/example.html' }, skillPreviewPaths: { s1: '/preview.html' } }],
    ['查看', 'onOpenSkillWebPreview', { skillPreviewPaths: { s1: '/preview.html' } }],
  ])('calls %s through %s without bubbling or expanding', async (label, callback, paths) => {
    const callbacks = {
      onSelectSkill: vi.fn(),
      onRunSkillExample: vi.fn(),
      onOpenSkillWebPreview: vi.fn(),
    };
    const onToggleSkillExpanded = vi.fn();
    const onBubbledClick = vi.fn();
    document.body.addEventListener('click', onBubbledClick);
    await renderSection({ variant: 'preview', onToggleSkillExpanded, ...callbacks, ...paths });
    const card = container.querySelector('.skill-members-section__card');
    if (label === '查看') {
      await act(async () => card.querySelector('[aria-label="更多 技能一"]').click());
      await act(async () => card.querySelector('[role="menuitem"]').click());
    } else {
      await act(async () => card.querySelector(`[aria-label="${label} 技能一"]`).click());
    }

    expect(callbacks[callback]).toHaveBeenCalledExactlyOnceWith(skills[0]);
    Object.entries(callbacks).forEach(([name, fn]) => {
      if (name !== callback) expect(fn).not.toHaveBeenCalled();
    });
    expect(onToggleSkillExpanded).not.toHaveBeenCalled();
    expect(toggleCollapsed).not.toHaveBeenCalled();
    expect(onBubbledClick).not.toHaveBeenCalled();
    document.body.removeEventListener('click', onBubbledClick);
  });

  it('omits 查看 with no example or preview URL, while 使用 remains available', async () => {
    const onSelectSkill = vi.fn();
    await renderSection({ variant: 'preview', onSelectSkill });
    const card = container.querySelector('.skill-members-section__card');
    expect(card.querySelector('[aria-label="查看 技能一"]')).toBeNull();
    expect(card.querySelector('[aria-label="使用 技能一"]').disabled).toBe(false);
    expect(card.querySelectorAll('button')).toHaveLength(2);
    expect(card.querySelector('[aria-label="更多 技能一"]').disabled).toBe(true);
  });

  it('does not render a hover popover or native text tooltips for preview cards', async () => {
    const renderSkillTooltip = vi.fn();
    await renderSection({ variant: 'preview', skills: [{ ...skills[0], description: '技能描述' }], renderSkillTooltip });
    const card = container.querySelector('.skill-members-section__card');
    await act(async () => card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(container.querySelector('[data-testid="skill-popover"]')).toBeNull();
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    expect(card.querySelector('[title]')).toBeNull();
    expect(renderSkillTooltip).not.toHaveBeenCalled();
  });

  it.each(['card', 'title', 'cover', 'Enter', ' '])('opens the original webpage from %s', async (target) => {
    const onRunSkillExample = vi.fn();
    const onSelectSkill = vi.fn();
    await renderSection({ variant: 'preview', skillExamplePaths: { s1: '/example.html' }, onRunSkillExample, onSelectSkill });
    const card = container.querySelector('.skill-members-section__card');
    if (target === 'Enter' || target === ' ') {
      await act(async () => card.dispatchEvent(new KeyboardEvent('keydown', { key: target, bubbles: true, cancelable: true })));
    } else {
      const element = target === 'title' ? card.querySelector('.artifact-preview__item-title') : target === 'cover' ? card.querySelector('.artifact-preview__cover') : card;
      await act(async () => element.click());
    }
    expect(onRunSkillExample).toHaveBeenCalledExactlyOnceWith(skills[0]);
    expect(onSelectSkill).not.toHaveBeenCalled();
  });

  it.each(['view', 'source', 'modify', 'delete'])('invokes only the selected %s action from the click dropdown', async (action) => {
    const callbacks = { onRunSkillExample: vi.fn(), onOpenSkillSource: vi.fn(), onModifySkill: vi.fn(), onDeleteSkill: vi.fn(), onSelectSkill: vi.fn() };
    await renderSection({ variant: 'preview', skillExamplePaths: { s1: '/example.html' }, ...callbacks });
    const card = container.querySelector('.skill-members-section__card');
    await act(async () => card.querySelector('[aria-label="更多 技能一"]').click());
    Object.values(callbacks).forEach((callback) => expect(callback).not.toHaveBeenCalled());
    const items = [...card.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(['查看', '源码', '修改', '删除']);
    expect(items[3].dataset.danger).toBe('true');
    const index = { view: 0, source: 1, modify: 2, delete: 3 }[action];
    await act(async () => items[index].click());
    const selectedCallback = { view: 'onRunSkillExample', source: 'onOpenSkillSource', modify: 'onModifySkill', delete: 'onDeleteSkill' }[action];
    expect(callbacks[selectedCallback]).toHaveBeenCalledExactlyOnceWith(skills[0]);
    Object.entries(callbacks).forEach(([key, callback]) => {
      if (key !== selectedCallback) expect(callback).not.toHaveBeenCalled();
    });
    expect(card.querySelector('[role="menu"]')).toBeNull();
  });

  it('omits 查看 from the menu without a URL but still offers modify and delete', async () => {
    const onModifySkill = vi.fn();
    const onDeleteSkill = vi.fn();
    const onRunSkillExample = vi.fn();
    await renderSection({ variant: 'preview', onModifySkill, onDeleteSkill, onRunSkillExample });
    const card = container.querySelector('.skill-members-section__card');
    expect(card.hasAttribute('role')).toBe(false);
    await act(async () => card.click());
    expect(onRunSkillExample).not.toHaveBeenCalled();
    await act(async () => card.querySelector('[aria-label="更多 技能一"]').click());
    expect([...card.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(['修改', '删除']);
  });

  it.each([false, true])('enables the source-only menu without a webpage (hasRoot=%s) and stops clicks from bubbling', async (hasRoot) => {
    const onOpenSkillSource = vi.fn();
    const onToggleSkillExpanded = vi.fn();
    const onBubbledClick = vi.fn();
    const skill = { ...skills[0], ...(hasRoot ? { __skillRoot: '/skills/one' } : {}) };
    document.body.addEventListener('click', onBubbledClick);
    try {
      await renderSection({ variant: 'preview', skills: [skill], onOpenSkillSource, onToggleSkillExpanded });
      const card = container.querySelector('.skill-members-section__card');
      const more = card.querySelector('[aria-label="更多 技能一"]');
      expect(card.hasAttribute('role')).toBe(false);
      expect(more.disabled).toBe(false);
      await act(async () => more.click());
      expect(onOpenSkillSource).not.toHaveBeenCalled();
      const items = [...card.querySelectorAll('[role="menuitem"]')];
      expect(items.map((item) => item.textContent)).toEqual(['源码']);
      await act(async () => items[0].click());
      expect(onOpenSkillSource).toHaveBeenCalledExactlyOnceWith(skill);
      expect(onToggleSkillExpanded).not.toHaveBeenCalled();
      expect(onBubbledClick).not.toHaveBeenCalled();
      expect(card.querySelector('[role="menu"]')).toBeNull();
    } finally {
      document.body.removeEventListener('click', onBubbledClick);
    }
  });

  it('does not activate the row when keyboard events originate on its buttons', async () => {
    const onRunSkillExample = vi.fn();
    await renderSection({ variant: 'preview', skillExamplePaths: { s1: '/example.html' }, onRunSkillExample });
    const more = container.querySelector('[aria-label="更多 技能一"]');
    await act(async () => more.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onRunSkillExample).not.toHaveBeenCalled();
  });

  it('disables 使用 if no selection callback is supplied', async () => {
    await renderSection({ variant: 'preview' });
    expect(container.querySelector('.skill-members-section__card [aria-label="使用 技能一"]').disabled).toBe(true);
  });
});

describe('SkillMembersSection sidebar tree regression', () => {
  it('preserves root expansion and the existing tree renderer', async () => {
    const onToggleSkillExpanded = vi.fn();
    const renderTreeNodes = vi.fn(() => <div>SKILL.md</div>);
    const treeNodes = [{ name: 'SKILL.md' }];
    await renderSection({
      variant: 'sidebar',
      expandedSkillKeys: new Set(['s1']),
      skillTrees: { s1: treeNodes },
      onToggleSkillExpanded,
      renderTreeNodes,
    });
    expect(renderTreeNodes).toHaveBeenCalledWith('s1', undefined, treeNodes);
    expect(container.querySelector('.chat-panel__member-tree').textContent).toBe('SKILL.md');
    await act(async () => container.querySelector('.chat-panel__member-main').click());
    await act(async () => container.querySelector('.chat-panel__tree-toggle').click());
    expect(onToggleSkillExpanded).toHaveBeenCalledTimes(2);
    expect(onToggleSkillExpanded).toHaveBeenNthCalledWith(1, skills[0]);
    expect(onToggleSkillExpanded).toHaveBeenNthCalledWith(2, skills[0]);

    await renderSection({ variant: 'sidebar', expandedSkillKeys: new Set(['s1']), skillTreeLoading: { s1: true } });
    expect(container.querySelector('.chat-panel__member-tree').textContent).toBe('加载目录中...');
    await renderSection({ variant: 'sidebar', expandedSkillKeys: new Set(['s1']) });
    expect(container.querySelector('.chat-panel__member-tree').textContent).toBe('目录为空');
  });

});

describe.each(['sidebar'])('SkillMembersSection %s Popover actions', (variant) => {
  it.each([
    ['使用 技能一', 'onSelectSkill', {}],
    ['修改 技能一', 'onModifySkill', {}],
    ['技能一 网页', 'onRunSkillExample', { skillExamplePaths: { s1: '/skills/example.html' } }],
    ['技能一 网页', 'onOpenSkillWebPreview', { skillExamplePaths: {} }],
    ['删除 技能一', 'onDeleteSkill', {}],
  ])('calls %s through %s without expanding the skill', async (label, callback, overrides) => {
    const callbacks = {
      onSelectSkill: vi.fn(),
      onModifySkill: vi.fn(),
      onRunSkillExample: vi.fn(),
      onOpenSkillWebPreview: vi.fn(),
      onDeleteSkill: vi.fn(),
    };
    const onToggleSkillExpanded = vi.fn();
    const onBubbledClick = vi.fn();
    document.body.addEventListener('click', onBubbledClick);
    await renderSection({
      variant,
      skillPreviewPaths: { s1: '/skills/preview.html' },
      onToggleSkillExpanded,
      ...callbacks,
      ...overrides,
    });

    const popover = container.querySelector('[data-testid="skill-popover"]');
    expect(popover.dataset.placement).toBe('leftTop');
    expect(popover.dataset.trigger).toBe('hover');
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () => popover.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    const tooltip = popover.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect([...tooltip.querySelectorAll('button')].map((node) => node.textContent)).toEqual(['使用', '修改', '网页', '删除']);
    await act(async () => tooltip.querySelector(`[aria-label="${label}"]`).click());

    expect(callbacks[callback]).toHaveBeenCalledExactlyOnceWith(skills[0]);
    Object.entries(callbacks).forEach(([name, fn]) => {
      if (name !== callback) expect(fn).not.toHaveBeenCalled();
    });
    expect(onToggleSkillExpanded).not.toHaveBeenCalled();
    expect(toggleCollapsed).not.toHaveBeenCalled();
    expect(onBubbledClick).not.toHaveBeenCalled();
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    document.body.removeEventListener('click', onBubbledClick);
  });
});
