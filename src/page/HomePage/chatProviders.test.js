import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Popover as AntPopover, Select as AntSelect } from 'antd';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProviderLogo } from '../../components/ProviderLogo.jsx';
import { buildProvidersState, customModelToOption, toModelOption, buildChatModelProviders } from './chatProviders';

const custom = (overrides = {}) => ({
  id: 'custom-12345678-1234-1234-1234-123456789abc', name: 'Private model',
  protocol: 'openai', baseUrl: 'https://private.example/v1', apiKey: 'SECRET-CUSTOM-KEY',
  modelId: 'claude-private:latest', read_image: false, ...overrides,
});

describe('chat provider integration', () => {
  it('exposes only safe selection metadata, never credentials or endpoint', () => {
    const model = custom();
    const option = customModelToOption(model);
    expect(option).toEqual({ value: `${model.id}:${model.modelId}`, label: model.name, read_image: false, isCustom: true });
    expect(JSON.stringify(option)).not.toContain(model.apiKey);
    expect(JSON.stringify(option)).not.toContain(model.baseUrl);
    expect(model).not.toHaveProperty('value');
  });

  it('projects custom reasoning levels without leaking executable mapping or credentials', () => {
    const model = custom({ reasoning_levels: [' disabled ', 'High', 'High', '', null, 'max'], reasoning_level_map: '{"reasoning_effort": reasoningLevel}' });
    const option = customModelToOption(model);
    expect(option.thinking_levels).toEqual(['disabled', 'High', 'max']);
    expect(option.thinking_levels).not.toBe(model.reasoning_levels);
    expect(model.reasoning_levels[0]).toBe(' disabled ');
    expect(option).not.toHaveProperty('reasoning_level_map');
    expect(JSON.stringify(option)).not.toContain(model.apiKey);
    expect(JSON.stringify(option)).not.toContain(model.baseUrl);
    expect(customModelToOption(custom({ reasoning_levels: [] })).thinking_levels).toEqual([]);
  });

  it.each(['openai', 'anthropic'])('uses explicit %s protocol, not the model name', (protocol) => {
    const model = custom({ protocol, modelId: protocol === 'openai' ? 'claude-test' : 'gpt-test' });
    const state = buildProvidersState([customModelToOption(model)], 'gateway-key', [model]);
    expect(state.llm.providers).toEqual([{
      id: model.id, name: model.name, type: protocol, enabled: true,
      apiHost: model.baseUrl, apiKey: model.apiKey,
      models: [{ id: model.modelId, name: model.name, provider: model.id, read_image: false }],
    }]);
  });

  it('isolates equal model IDs across providers and refreshes changed credentials', () => {
    const a = custom({ modelId: 'gpt-test' });
    const b = custom({ id: 'custom-87654321-1234-1234-1234-123456789abc', modelId: a.modelId, apiKey: 'second-key' });
    const options = [toModelOption(a.modelId, 'Built in'), ...[a, b].map(customModelToOption)];
    const first = buildProvidersState(options, ' gateway ', [a, b]);
    const next = buildProvidersState(options, 'gateway', [{ ...a, apiKey: 'rotated-key' }, b]);
    expect(first.llm.providers.map((p) => p.apiKey)).toEqual(['gateway', a.apiKey, b.apiKey]);
    expect(next.llm.providers[1].apiKey).toBe('rotated-key');
    expect(first.llm.providers[1].apiKey).toBe(a.apiKey);
    expect(buildProvidersState([customModelToOption(a)], 'gateway', []).llm.providers).toEqual([]);
  });

  it('preserves built-in routing, image flags, and optional token metadata', () => {
    const option = toModelOption('claude-test', 'Claude', '', true, { input: 1 }, '', '', [' fast ', ''], { max_output_tokens: 42 });
    expect(option.badges).toEqual(['fast']);
    expect(option.max_output_tokens).toBe(42);
    const state = buildProvidersState([option, 'qwen-test', 'gemini-test', 'gpt-test', '', null], ' key ');
    expect(state.llm.providers.map((p) => p.id)).toEqual(['anthropic', 'bailian', 'gemini', 'openai']);
    expect(state.llm.providers[0].models[0].read_image).toBe(true);
    expect(state.llm.providers.every((p) => p.apiKey === 'key')).toBe(true);
  });

  // Extract only the pure metadata helpers, not the HomePage component or its dependencies.
  const source = readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
  const helpers = source.slice(source.indexOf('const canonicalizeChatModelId ='), source.indexOf('const normalizeMembershipSummary ='));
  const buildMeta = new Function(`${helpers}; return buildChatMessageModelMeta;`)();
  it('matches the exact custom selection before a built-in model with the same ID', () => {
    const model = custom({ modelId: 'gpt-test' });
    const meta = buildMeta(`${model.id}:${model.modelId}`, [toModelOption('gpt-test', 'Built in'), customModelToOption(model)]);
    expect(meta).toMatchObject({ id: model.modelId, name: model.name, provider: model.id });
    expect(JSON.stringify(meta)).not.toContain(model.apiKey);
  });
  const metadataHelpers = source.slice(source.indexOf('const canonicalizeChatModelId ='), source.indexOf('const buildComparableModelMeta ='));
  const normalizeMeta = new Function(`${metadataHelpers}; return normalizeMessageModelMeta;`)();
  const resolveModelId = new Function(`${metadataHelpers}; return resolveMessageModelId;`)();
  it('never borrows official pricing for custom metadata, including deleted and polluted history', () => {
    const model = custom({ modelId: 'gpt-test' });
    const official = toModelOption('gpt-test', 'Official', '', false, { input: 100, output: 200 });
    const selection = `${model.id}:${model.modelId}`;
    for (const options of [[official, customModelToOption(model)], [official]]) {
      for (const raw of [selection, { id: model.modelId, provider: model.id, pricing: official.pricing }]) {
        const meta = normalizeMeta(raw, '', options);
        expect(meta).toMatchObject({ id: model.modelId, provider: model.id });
        expect(meta.pricing).toBeUndefined();
        expect(normalizeMeta(meta, '', options)).toEqual(meta);
      }
      expect(buildMeta(selection, options).pricing).toBeUndefined();
      expect(normalizeMeta('gpt-test', '', options).pricing).toEqual(official.pricing);
    }
    expect(normalizeMeta({ id: 'gpt-test' }, selection, [official]).provider).toBe(model.id);
    expect(normalizeMeta({ id: 'gpt-test' }, selection, [official]).pricing).toBeUndefined();
  });

  it('keeps the original summary title strategy for both official and custom conversations', async () => {
    const body = source.slice(source.indexOf('  const triggerAutoRenameSessionTitle = async'), source.indexOf('  const ensureAgentSessionForChat = async'));
    const run = async (model, title = 'New chat', messages = [{ role: 'user', content: '  本地标题\n第一条消息  ' }]) => {
      let sessions = [{ id: 'chat', title, messages }];
      const fetchSummary = vi.fn().mockResolvedValue({ text: 'Official title' });
      const timers = new Map();
      const trigger = new Function('chatSessionsRef', 'chatTitleGeneratingSessionIdsRef', 'setChatTitleRenamingSessionIds', 'DEFAULT_CHAT_TITLE', 'resolveMessageModelId', 'chatModel', 'fetchMessagesSummary', 'setChatSessions', 'sortChatSessions', 'setChatTitleNewlyRenamedSessionIds', 'chatTitleRevealTimersRef', 'logger', 'setTimeout', `${body}; return triggerAutoRenameSessionTitle;`)(
        { current: sessions }, { current: new Set() }, vi.fn(), 'New chat', resolveModelId, model,
        fetchSummary, (update) => { sessions = update(sessions); }, (value) => value, vi.fn(), { current: timers }, { warn: vi.fn() }, vi.fn(() => 1)
      );
      await trigger('chat', { modelOverride: model });
      return { sessions, fetchSummary };
    };
    const local = await run('custom-123:deepseek-v4-pro');
    expect(local.fetchSummary).toHaveBeenCalledExactlyOnceWith({ messages: expect.any(Array), model: 'deepseek-v4-pro' });
    expect(local.sessions[0].title).toBe('Official title');
    const official = await run('deepseek-v4-pro');
    expect(official.fetchSummary).toHaveBeenCalledOnce();
    expect(official.sessions[0].title).toBe('Official title');
    const manual = await run('custom-123:deepseek-v4-pro', 'Manual title');
    expect(manual.fetchSummary).not.toHaveBeenCalled();
    expect(manual.sessions[0].title).toBe('Manual title');
  });

  it('preserves colon-containing custom model IDs in history metadata', () => {
    const model = custom();
    const options = [customModelToOption(model)];
    const meta = buildMeta(`${model.id}:${model.modelId}`, options);
    expect(meta).toMatchObject({ id: model.modelId, provider: model.id });
    expect(normalizeMeta(meta, '', options)).toEqual(meta);
    expect(normalizeMeta(normalizeMeta(meta, '', options), '', options)).toEqual(meta);
  });
});

describe('buildChatModelProviders (ZCode-style provider→model grouping)', () => {
  const builtin = [toModelOption('gpt-a', 'GPT A'), toModelOption('gpt-b', 'GPT B')];
  const customProvider = {
    id: 'provider-x', name: 'xyc中转gpt', logoKey: 'openai',
    models: [
      { id: 'm1', modelId: 'gpt-6.1-sol', enabled: true },
      { id: 'm2', modelId: 'gpt-disabled', enabled: false },
      { id: 'm3', modelId: '  ', enabled: true },
    ],
  };
  it('groups builtin first then custom providers, dropping disabled/empty models', () => {
    const groups = buildChatModelProviders(builtin, ['gpt-b'], [customProvider]);
    expect(groups.map((g) => g.id)).toEqual(['builtin', 'provider-x']);
    expect(groups[0]).toMatchObject({ name: '流光剪辑', kind: 'official', badge: '官方', modelValues: ['gpt-a'] });
    expect(groups[1]).toMatchObject({ name: 'xyc中转gpt', kind: 'custom', badge: 'API', modelValues: ['m1:gpt-6.1-sol'] });
  });
  it('omits builtin when all official models are disabled and skips empty providers', () => {
    expect(buildChatModelProviders(builtin, ['gpt-a', 'gpt-b'], [{ id: 'empty', name: 'Empty', models: [] }])).toEqual([]);
    expect(buildChatModelProviders([], [], [customProvider]).map((g) => g.id)).toEqual(['provider-x']);
  });
  it('never leaks credentials into the provider grouping', () => {
    const groups = buildChatModelProviders(builtin, [], [{ ...customProvider, apiKey: 'SECRET', baseUrl: 'https://x' }]);
    expect(JSON.stringify(groups)).not.toContain('SECRET');
  });
  it('wires the composer two-level selector: provider switch, filtered list, manage entry', () => {
    const source = readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.js`, 'utf8');
    // 右箭头供应商切换 + 管理模型入口（取代底部平铺的自定义模型入口）。
    expect(source).toContain('chat-panel__provider-switch');
    expect(source).toContain('切换供应商');
    expect(source).toContain('管理模型');
    expect(source).toContain('const switchProvider = (provider) =>');
    // 供应商菜单悬浮即展开（对齐 ZCode 子菜单 hover 行为），而非仅点击。
    expect(source).toMatch(/trigger="hover"\s*\n\s*mouseEnterDelay/);
    // 右箭头在有模型时恒可见：prop 为空时从模型选项回退推导供应商，而非直接隐藏。
    expect(source).toContain('const effectiveModelProviders = React.useMemo');
    expect(source).toMatch(/const providerPickerHeader\s*=\s*modelPickerOpen && activeProvider && providerModelOptions\.length > 0\s*\?\s*\(/);
    expect(source).toContain('options={providerModelOptions}');
    expect(source).not.toContain('const groupedModelOptions =');
    expect(source).toContain('{providerPickerHeader}');
    expect(source).toContain('chat-panel__provider-switch-arrow');
    // The toolbar has only the Select; its provider submenu lives inside popupRender.
    const picker = source.slice(source.lastIndexOf('<div', source.indexOf('ref={beginnerGuideModelPickerRef}')), source.indexOf('<Tooltip title={!sessionSending'));
    expect(picker).not.toContain('<Popover');
    expect(source).not.toContain('{Array.isArray(modelProviders) && modelProviders.length > 0 ? (');
    // 模型列表按活跃供应商过滤。
    expect(source).toContain('const providerModelOptions = React.useMemo');
    expect(source).toContain('allowed.has(option.value)');
    // 模型项 14px/400/#000。
    const css = readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.css`, 'utf8');
    expect(css).toMatch(/\.chat-panel__model-option-text\s*{[^}]*font-size:\s*14px[^}]*font-weight:\s*400[^}]*color:\s*#000000/s);
  });
});

describe('model picker provider header interactions', () => {
  let Picker;
  let RealPopoverPicker;
  let RealPicker;
  let host;
  let root;
  const official = { id: 'builtin', name: '流光剪辑', kind: 'official', badge: '官方', modelValues: ['gpt-a', 'gpt-b'] };
  const gateway = { id: 'gateway', name: 'Private gateway', kind: 'custom', badge: 'API', modelValues: ['private:a', 'private:b'] };
  const options = [
    { value: 'gpt-a', label: 'GPT A' }, { value: 'gpt-b', label: 'GPT B' },
    { value: 'private:a', label: 'Private A', isCustom: true }, { value: 'private:b', label: 'Private B', isCustom: true },
  ];

  beforeAll(async () => {
    // Compile only the production selector fragments. Importing Composer itself pulls in
    // Electron/editor dependencies unrelated to this regression. Keep production refs,
    // dismissal/effects, provider logic and wrapper events in both the isolated doubles
    // and real AntD Select + Popover harnesses.
    const source = readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.js`, 'utf8');
    const logicStart = source.indexOf('  const effectiveModelProviders =');
    const logicEnd = source.indexOf('\n  const ', source.indexOf('  const switchProvider =') + 1);
    const headerStart = source.indexOf('  const providerPickerHeader =');
    expect(headerStart).toBeGreaterThan(-1);
    const headerEnd = source.indexOf('\n  const ', headerStart + 1);
    const wrapperStart = source.lastIndexOf('<div', source.indexOf('ref={beginnerGuideModelPickerRef}'));
    const selectStart = source.indexOf('<Select', wrapperStart);
    const selectEnd = source.indexOf('\n              />', selectStart) + '\n              />'.length;
    const dismissStart = source.indexOf('  const dismissModelPicker =');
    const dismissEnd = source.indexOf('\n  const ', dismissStart + 1);
    const effectsStart = source.lastIndexOf('  React.useEffect(() => {', source.indexOf('    const closeFromOutside ='));
    const effectsEnd = source.indexOf('\n  const availableModelOptions =', effectsStart);
    const refs = ['modelPickerOpenRef', 'modelPickerDismissedRef'].map(name => {
      const declaration = source.match(new RegExp(`  const ${name} = React\\.useRef\\(false\\);`))?.[0];
      expect(declaration).toBeTruthy();
      return declaration;
    }).join('\n');
    const code = `function Picker({ modelProviders, availableModelOptions, initialModel, onOpenModelSettings, onChange }) {
      const [model, setModel] = React.useState(initialModel);
      const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
      const [providerMenuOpen, setProviderMenuOpen] = React.useState(false);
      const [modelPickerEpoch, setModelPickerEpoch] = React.useState(0);
      ${refs}
      const beginnerGuideModelPickerRef = React.useRef(null);
      const modelHoverCardRef = React.useRef(null);
      const onModelChange = value => { setModel(value); onChange(value); };
      const clearHoveredModelCard = React.useCallback(() => {}, []);
      ${source.slice(dismissStart, dismissEnd)}
      ${source.slice(effectsStart, effectsEnd)}
      const modelListLoading = false;
      const CHAT_MODEL_ANALYTICS_EVENTS = new Map();
      const trackEvent = () => {};
      const renderModelOptionInner = text => text;
      const showHoveredModelCard = () => {};
      const scheduleModelHoverClose = () => {};
      ${source.slice(logicStart, logicEnd)}
      ${source.slice(headerStart, headerEnd)}
      return <div data-provider-menu-open={String(providerMenuOpen)}>${source.slice(wrapperStart, selectEnd)}</div></div>;
    }`;
    // Transform in Node's own realm: importing esbuild inside jsdom violates its
    // TextEncoder/Uint8Array invariant. No generated files or extra test config needed.
    const compiled = execFileSync(process.execPath, ['--input-type=module', '-e',
      `import { transformWithEsbuild } from 'vite';
       let source = ''; for await (const chunk of process.stdin) source += chunk;
       const result = await transformWithEsbuild(source, 'provider-picker-fragment.jsx', { loader: 'jsx', jsx: 'transform' });
       process.stdout.write(result.code);`,
    ], { cwd: process.cwd(), input: code, encoding: 'utf8' });
    const Icon = props => React.createElement('svg', props);
    const Tooltip = ({ children, title }) => React.createElement('span', { 'data-tooltip': true }, children, React.createElement('span', { hidden: true }, title));
    const Popover = ({ children, open, onOpenChange, content, trigger }) => React.createElement('div', {
      'data-provider-popover': true,
      onMouseOver: () => { if (trigger === 'hover') onOpenChange(true); },
      onMouseOut: event => { if (!event.currentTarget.contains(event.relatedTarget)) onOpenChange(false); },
    }, children, open ? content : null);
    const Select = ({ open, onOpenChange, popupRender, options: modelOptions, value, onChange }) => React.createElement('div', null,
      React.createElement('button', { 'data-model-trigger': true, onClick: event => { event.currentTarget.dispatchEvent(new Event('pointerdown', { bubbles: true })); onOpenChange(!open); } }, value),
      open ? React.createElement('div', { 'data-model-popup': true },
        popupRender(React.createElement('div', { role: 'listbox' }, modelOptions.map(option =>
          React.createElement('button', { key: option.value, role: 'option', onClick: () => onChange(option.value) }, option.label)))),
        React.createElement('button', { 'data-close-models': true, onClick: () => onOpenChange(false) }, 'Close models')) : null);
    Picker = new Function('React', 'Select', 'Popover', 'Tooltip', 'ChevronRight', 'Package', 'Check', 'ChatModelsTipIcon', 'OFFICIAL_PROVIDER_LOGO', 'ProviderLogo', `${compiled}; return Picker;`)(
      React, Select, Popover, Tooltip, Icon, Icon, Icon, 'billing.svg', 'official.svg', ProviderLogo);
    RealPopoverPicker = new Function('React', 'Select', 'Popover', 'Tooltip', 'ChevronRight', 'Package', 'Check', 'ChatModelsTipIcon', 'OFFICIAL_PROVIDER_LOGO', 'ProviderLogo', `${compiled}; return Picker;`)(
      React, Select, AntPopover, Tooltip, Icon, Icon, Icon, 'billing.svg', 'official.svg', ProviderLogo);
    RealPicker = new Function('React', 'Select', 'Popover', 'Tooltip', 'ChevronRight', 'Package', 'Check', 'ChatModelsTipIcon', 'OFFICIAL_PROVIDER_LOGO', 'ProviderLogo', `${compiled}; return Picker;`)(
      React, AntSelect, AntPopover, Tooltip, Icon, Icon, Icon, 'billing.svg', 'official.svg', ProviderLogo);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    host?.remove();
    root = null;
    host = null;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  const renderPicker = (props = {}, Component = Picker) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const onChange = vi.fn();
    const onOpenModelSettings = vi.fn();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(React.createElement(Component, {
      modelProviders: [official, gateway], availableModelOptions: options,
      initialModel: 'gpt-a', onChange, onOpenModelSettings, ...props,
    })));
    return { onChange, onOpenModelSettings };
  };
  const click = selector => {
    const element = typeof selector === 'string' ? host.querySelector(selector) : selector;
    expect(element).not.toBeNull();
    act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };
  const hoverProvider = () => {
    act(() => host.querySelector('.chat-panel__provider-switch').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  };
  const labels = () => [...host.querySelectorAll('[role="option"]')].map(element => element.textContent);

  it('opens the real provider Popover outside the model popup clipping boundary', async () => {
    renderPicker({}, RealPopoverPicker);
    click('[data-model-trigger]');
    await act(async () => {
      host.querySelector('.chat-panel__provider-switch').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 250));
    });
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(host.contains(menu)).toBe(false);
    expect(host.querySelector('[data-model-popup]')).not.toBeNull();
    expect(menu.textContent).toContain(gateway.name);
    expect(menu.closest('.ant-popover').style.zIndex).toBe('1100');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => menu.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
  });

  const settle = async (milliseconds = 250) => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, milliseconds)); });
  };
  const pointerClick = element => {
    expect(element).not.toBeNull();
    // Separate acts let capture-phase outside dismissal commit before the click.
    act(() => element.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    act(() => element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    act(() => element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };
  const openRealPicker = async () => {
    pointerClick(host.querySelector('.ant-select-selector'));
    await settle();
    expect(host.querySelector('.chat-panel__provider-switch')).not.toBeNull();
  };
  const openRealProviders = async () => {
    hoverProvider();
    await settle();
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    return menu;
  };

  it('switches using the first available model and omits providers with no selectable models', async () => {
    const staleGateway = { ...gateway, modelValues: ['missing:first', ...gateway.modelValues] };
    const unavailable = { ...gateway, id: 'unavailable', name: 'Unavailable provider', modelValues: ['missing:only'] };
    const { onChange } = renderPicker({ modelProviders: [official, staleGateway, unavailable] }, RealPicker);
    await openRealPicker();
    const menu = await openRealProviders();
    expect(menu.textContent).not.toContain(unavailable.name);
    pointerClick([...menu.querySelectorAll('[role="menuitemradio"]')].find(element => element.textContent.includes(gateway.name)));
    await settle();
    expect(onChange).toHaveBeenCalledExactlyOnceWith('private:a');
    expect(host.querySelector('.chat-panel__provider-switch').textContent).toContain(gateway.name);
    expect(host.querySelectorAll('.ant-select-item-option')).toHaveLength(2);
    expect(host.querySelector('.ant-select-dropdown').textContent).toContain('private:a');
  });

  it('keeps real Select open when outside capture sees a portaled provider click', async () => {
    const { onChange } = renderPicker({}, RealPicker);
    await openRealPicker();
    const menu = await openRealProviders();
    expect(host.contains(menu)).toBe(false);
    pointerClick([...menu.querySelectorAll('[role="menuitemradio"]')].find(element => element.textContent.includes(gateway.name)));
    await settle();
    expect(onChange).toHaveBeenCalledExactlyOnceWith('private:a');
    expect(host.querySelector('.chat-panel__provider-switch').textContent).toContain(gateway.name);
    expect(host.querySelectorAll('.ant-select-item-option')).toHaveLength(2);
    expect(host.querySelector('.ant-select-dropdown').textContent).toContain('private:a');
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('tears down real Select and Popover on manage despite delayed hover and blur/focus, then reopens explicitly', async () => {
    const { onOpenModelSettings, onChange } = renderPicker({}, RealPicker);
    await openRealPicker();
    const input = host.querySelector('input');
    act(() => input.focus());
    const menu = await openRealProviders();
    act(() => host.querySelector('.chat-panel__provider-switch').dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    hoverProvider();
    pointerClick(menu.querySelector('.chat-panel__provider-menu-manage'));
    await settle(400);
    expect(onOpenModelSettings).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
    expect(host.querySelector('.chat-panel__provider-switch')).toBeNull();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector('.ant-select-open')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
      input.focus();
    });
    await settle();
    expect(host.querySelector('.ant-select-open')).toBeNull();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    await openRealPicker();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    await openRealProviders();
  });

  it('dismisses on real outside pointer and Escape, allowing an explicit keyboard reopen', async () => {
    renderPicker({}, RealPicker);
    await openRealPicker();
    await openRealProviders();
    pointerClick(document.body);
    await settle();
    expect(host.querySelector('.ant-select-open')).toBeNull();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    const input = host.querySelector('input');
    act(() => {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
    });
    await settle();
    expect(host.querySelector('.ant-select-open')).not.toBeNull();
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })));
    await settle();
    expect(host.querySelector('.ant-select-open')).toBeNull();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('removes the real provider portal on window blur and does not resurrect it on focus', async () => {
    renderPicker({}, RealPicker);
    await openRealPicker();
    await openRealProviders();
    act(() => window.dispatchEvent(new Event('blur')));
    await settle(400);
    expect(host.querySelector('.ant-select-open')).toBeNull();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    act(() => window.dispatchEvent(new Event('focus')));
    await settle();
    expect(host.querySelector('.chat-panel__provider-switch')).toBeNull();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    await openRealPicker();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('switches hover ownership from the provider header to the model list', async () => {
    renderPicker({}, RealPicker);
    await openRealPicker();
    await openRealProviders();
    const content = host.querySelector('.chat-panel__model-picker-content');
    expect(content.dataset.providerOpen).toBe('true');
    act(() => {
      host.querySelector('.chat-panel__model-picker-list').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await settle(400);
    expect(content.dataset.providerOpen).toBe('false');
    expect(host.querySelector('.chat-panel__provider-switch').getAttribute('aria-expanded')).toBe('false');
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector('.ant-select-open')).not.toBeNull();
    const css = readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.css`, 'utf8');
    expect(css).toMatch(/\.chat-panel__provider-switch:hover,[\s\S]*?\.ant-select-item-option-active:not\(\.ant-select-item-option-selected\),[\s\S]*?\.chat-panel__provider-menu-item:hover\s*\{\s*background: #f0f0f0;\s*border-radius: 6px;/);
    expect(css).toContain('[data-provider-open="true"] .ant-select-item-option-active');
  });

  it('separates official/custom once for multiple real custom providers, plus the manage separator', async () => {
    const secondGateway = { ...gateway, id: 'gateway-two', name: 'Second gateway', modelValues: ['second:model'] };
    const { onChange } = renderPicker({
      modelProviders: [official, gateway, secondGateway],
      availableModelOptions: [...options, { value: 'second:model', label: 'Second model', isCustom: true }],
    }, RealPicker);
    await openRealPicker();
    const menu = await openRealProviders();
    expect(menu.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3);
    const dividers = menu.querySelectorAll('.chat-panel__provider-menu-divider');
    expect(dividers).toHaveLength(2);
    expect(dividers[0].nextElementSibling.textContent).toContain(gateway.name);
    expect(dividers[1].previousElementSibling.textContent).toContain(secondGateway.name);
    expect(dividers[1].nextElementSibling.textContent).toContain('管理模型');
    pointerClick([...menu.querySelectorAll('[role="menuitemradio"]')].find(element => element.textContent.includes(secondGateway.name)));
    await settle();
    expect(onChange).toHaveBeenCalledExactlyOnceWith('second:model');
    expect(host.querySelectorAll('.ant-select-item-option')).toHaveLength(1);
  });

  it('shows the named provider and billing help only inside the open model popup, without a duplicate group title', () => {
    renderPicker();
    expect(host.querySelector('.chat-panel__provider-switch')).toBeNull();
    click('[data-model-trigger]');
    const popup = host.querySelector('[data-model-popup]');
    const header = popup.querySelector('.chat-panel__provider-switch');
    expect(header.textContent).toContain(official.name);
    expect(header.querySelector('[alt="模型计费说明"]')).not.toBeNull();
    expect(header.querySelector('.chat-panel__provider-switch-arrow')).toBe(header.lastElementChild);
    expect(popup.querySelectorAll('.chat-panel__model-group-title')).toHaveLength(1);
    expect(header.querySelector('.chat-panel__model-group-title')).not.toBeNull();
    expect(labels()).toEqual(['GPT A', 'GPT B']);
  });

  it('keeps models open on hover and switches to the selected provider’s first model and filtered flat list', () => {
    const { onChange } = renderPicker();
    click('[data-model-trigger]');
    hoverProvider();
    expect(host.querySelector('[data-model-popup]')).not.toBeNull();
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    expect(labels()).toEqual(['GPT A', 'GPT B']);
    click([...host.querySelectorAll('[role="menuitemradio"]')].find(element => element.textContent.includes(gateway.name)));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('private:a');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(labels()).toEqual(['Private A', 'Private B']);
    expect(host.querySelector('.chat-panel__provider-switch').textContent).toContain(gateway.name);
    expect(host.querySelector('[alt="模型计费说明"]')).toBeNull();
  });

  it('does not change the model when selecting its already active first-model provider', () => {
    const { onChange } = renderPicker();
    click('[data-model-trigger]');
    hoverProvider();
    click(host.querySelector('[role="menuitemradio"][aria-checked="true"]'));
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector('[data-model-popup]')).not.toBeNull();
  });

  it('closes the provider submenu with the main popup and reopens with no stale submenu', () => {
    renderPicker();
    click('[data-model-trigger]');
    hoverProvider();
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    click('[data-close-models]');
    expect(host.querySelector('[data-model-popup]')).toBeNull();
    expect(host.querySelector('[data-provider-menu-open]').dataset.providerMenuOpen).toBe('false');
    click('[data-model-trigger]');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector('.chat-panel__provider-switch').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes both popups before opening model management', () => {
    const { onOpenModelSettings } = renderPicker();
    click('[data-model-trigger]');
    hoverProvider();
    click('.chat-panel__provider-menu-manage');
    expect(onOpenModelSettings).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-model-popup]')).toBeNull();
    click('[data-model-trigger]');
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it('derives a usable provider header when provider metadata has not arrived', () => {
    renderPicker({ modelProviders: [] });
    click('[data-model-trigger]');
    expect(host.querySelector('.chat-panel__provider-switch').textContent).toContain(official.name);
    hoverProvider();
    expect(host.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2);
    expect(labels()).toEqual(['GPT A', 'GPT B']);
  });

  it('renders an empty model list without a provider switch when no models exist', () => {
    renderPicker({ modelProviders: [], availableModelOptions: [], initialModel: '' });
    click('[data-model-trigger]');
    expect(host.querySelector('.chat-panel__provider-switch')).toBeNull();
    expect(labels()).toEqual([]);
  });
});
