// Run: pnpm exec vitest run src/components/ModelSettings/ModelSettings.test.jsx --environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChatModelList, testChatModel } from '../../api/chat.js';
import ModelSettings, { createProvider, PROVIDER_TEMPLATES, resolveProviderLogo } from './ModelSettings';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getCurrentChannelBrandConfig } from '../../../channel-branding/runtime';

vi.mock('../../api/chat.js', () => ({ getChatModelList: vi.fn(), testChatModel: vi.fn() }));
beforeEach(() => { getChatModelList.mockReset().mockResolvedValue({ modelItems: [{ model_id: 'official-real-id', name: '官方真实名称', read_image: true }], models: ['ignored-model'], defaultModel: 'official-real-id' }); testChatModel.mockReset(); });

vi.mock('antd', () => {
  const Input = ({ autoComplete, ...props }) => <input {...props} autoComplete={autoComplete} />;
  Input.Password = props => <input {...props} type="password" />;
  const Form = ({ children }) => <div>{children}</div>;
  Form.Item = ({ label, children, extra }) => <div>{label}{children}<small>{extra}</small></div>;
  return { Input, Form,
    ConfigProvider: ({ children }) => children,
    Button: ({ children, disabled, loading, onClick, icon, 'aria-label': ariaLabel }) => <button aria-label={ariaLabel} disabled={disabled || loading} onClick={onClick}>{icon}{children}</button>,
    Alert: ({ message }) => <div role="alert">{message}</div>,
    Checkbox: ({ children, ...props }) => <label><input type="checkbox" {...props} />{children}</label>,
    Switch: ({ onChange, size, ...props }) => <input type="checkbox" {...props} onChange={e => onChange(e.target.checked)} />,
    Select: ({ options, onChange, ...props }) => <select {...props} onChange={e => onChange(e.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
    Popconfirm: ({ children, title, onConfirm }) => <div>{children}<button aria-label={title} onClick={onConfirm}>确认</button></div>,
    Tooltip: ({ children }) => children,
    Dropdown: ({ children, dropdownRender }) => <div>{children}{dropdownRender ? dropdownRender() : null}</div>,
    Modal: ({ open, title, onOk, children }) => open ? <div>{title}<button aria-label={title} onClick={onOk}>确认</button>{children}</div> : null,
  };
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const provider = (id = 'custom-existing') => ({ id, name: id, protocol: 'openai', baseUrl: 'https://example.com/v1', apiKey: 'secret-key-never-echo', enabled: true, models: [{ id: 'custom-old-model', name: 'Model', modelId: 'actual-model-id', read_image: false, enabled: true }] });
const mount = async (items = [provider()], prefs = { disabledModelIds: [] }) => {
  let stored = items;
  window.electronAPI = {
    customChatModels: {
      listProviders: vi.fn(async () => stored),
      saveProviders: vi.fn(async (next) => { stored = next; return next; }),
    },
    officialChatModels: {
      getPrefs: vi.fn().mockResolvedValue(prefs),
      setPrefs: vi.fn().mockImplementation(async (next) => next),
      onChanged: vi.fn(() => () => {}),
    },
  };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ModelSettings />));
  return window.electronAPI.customChatModels;
};
const click = async text => {
  const button = [...host.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === text || item.textContent === text);
  expect(button, text).toBeTruthy();
  await act(async () => button.click());
};
const setInput = (label, value) => act(() => {
  const input = host.querySelector(`[aria-label="${label}"]`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const confirm = async title => act(async () => host.querySelector(`button[aria-label="${title}"]`).click());
// 自动保存 idle 1.2s（对齐 ZCode），测试等待落盘窗口。
const autoSave = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 1400)); });
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); vi.restoreAllMocks(); delete window.electronAPI; });

describe('ModelSettings', () => {
  it('pins official first and defaults to its read-only real model list outside persisted drafts', async () => {
    const api = await mount();
    const rows = host.querySelectorAll('.model-settings__provider');
    expect(rows[0].dataset.providerId).toBe('builtin-vectcut');
    expect(rows[0].classList.contains('is-active')).toBe(true);
    const logo = getCurrentChannelBrandConfig().runtimeAssets.aboutLogo;
    expect(rows[0].querySelector('img').getAttribute('src')).toBe(logo);
    expect(existsSync(path.join(process.cwd(), logo.split('?')[0]))).toBe(true);
    expect(rows[1].textContent).toContain('custom-existing');
    const detail = host.querySelector('.model-settings__detail');
    for (const text of ['官方真实名称', '视觉', '模型列表', '官方']) expect(detail.textContent).toContain(text);
    expect(detail.querySelector('[aria-label="测试模型"]')).not.toBeNull();
    expect(detail.textContent).not.toContain('只读');
    expect(detail.querySelector('.model-settings__official-heading img').getAttribute('src')).toBe(logo);
    expect(detail.querySelector('.model-settings__official-name').title).toBe('official-real-id');
    expect(detail.textContent).not.toContain('official-real-id');
    for (const text of ['ignored-model', 'API Key', 'Base URL', '删除供应商', '添加模型']) expect(detail.textContent).not.toContain(text);
    expect(detail.querySelector('input:not([type="checkbox"])')).toBeNull();
    expect(host.querySelector('.model-settings__footer')).toBeNull();
    expect(host.textContent).not.toContain('保存全部更改');
    await click('custom-existing');
    setInput('供应商名称', 'Draft');
    await click('流光剪辑');
    await autoSave();
    expect(api.saveProviders).toHaveBeenCalledWith([{ ...provider(), name: 'Draft' }]);
    expect(host.textContent).toContain('Draft 保存成功');
    expect(host.querySelector('.model-settings__feedback--neutral')).not.toBeNull();
  });
  it('falls back to real models and does not invent image capabilities or static models', async () => {
    getChatModelList.mockResolvedValue({ modelItems: [], models: ['real-fallback'], defaultModel: 'real-fallback' });
    await mount([]);
    expect(host.textContent).toContain('real-fallback');
    expect(host.querySelector('.model-settings__vision-badge')).toBeNull();
    expect(host.querySelector('.model-settings__context-badge')).toBeNull();
    expect(host.querySelectorAll('.model-settings__official-model')).toHaveLength(1);
    getChatModelList.mockResolvedValue({ modelItems: [], models: [] });
    await click('刷新');
    expect(host.textContent).toContain('暂无官方模型');
    expect(host.querySelectorAll('.model-settings__official-model')).toHaveLength(0);
  });
  it('groups compact rows with real badges plus per-model test and enable controls', async () => {
    getChatModelList.mockResolvedValue({ modelItems: [
      { model_id: 'vision-id', name: 'Vision model', read_image: true, context_window_tokens: 1000000 },
      { model_id: 'text-id', name: 'Text model', read_image: false, context_window_tokens: 128000 },
      ...[undefined, null, 0, -1, NaN, Infinity, '1000000'].map((tokens, index) => ({ model_id: `unknown-${index}`, context_window_tokens: tokens })),
    ] });
    const api = await mount([]);
    const list = host.querySelector('.model-settings__official-list');
    expect(list.tagName).toBe('UL');
    expect(list.getAttribute('aria-labelledby')).toBe('official-model-list-heading');
    expect(host.querySelectorAll('.model-settings__official-list')).toHaveLength(1);
    expect(list.children).toHaveLength(9);
    expect([...list.children].every(row => row.tagName === 'LI' && !row.classList.contains('model-settings__model'))).toBe(true);
    expect([...list.querySelectorAll('.model-settings__context-badge')].map(badge => badge.textContent)).toEqual(['1M', '128K']);
    expect(list.querySelector('.model-settings__context-badge').title).toBe('上下文窗口：1000000 tokens');
    expect(list.querySelectorAll('.model-settings__vision-badge')).toHaveLength(1);
    expect([...list.children].every(row => row.querySelector('.model-settings__official-actions button') && row.querySelector('.model-settings__official-actions input[type="checkbox"]'))).toBe(true);
    expect(list.textContent).not.toMatch(/不支持|未提供|vision-id|text-id/);
    expect(api.saveProviders).not.toHaveBeenCalled();
  });
  it('persists official enable switches immediately and restores them on save failure', async () => {
    const api = await mount();
    const official = window.electronAPI.officialChatModels;
    const selector = '[aria-label="启用官方模型 官方真实名称"]';
    expect(host.querySelector(selector).checked).toBe(true);
    await act(async () => host.querySelector(selector).click());
    expect(official.setPrefs).toHaveBeenCalledWith({ disabledModelIds: ['official-real-id'] });
    expect(host.querySelector(selector).checked).toBe(false);
    await act(async () => host.querySelector(selector).click());
    expect(official.setPrefs).toHaveBeenLastCalledWith({ disabledModelIds: [] });
    expect(host.querySelector(selector).checked).toBe(true);
    official.setPrefs.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => host.querySelector(selector).click());
    expect(host.querySelector(selector).checked).toBe(true);
    expect(host.textContent).toContain('保存官方模型开关失败');
    expect(api.saveProviders).not.toHaveBeenCalled();
  });
  it('loads persisted disabled official models as unchecked switches', async () => {
    await mount([provider()], { disabledModelIds: ['official-real-id'] });
    expect(host.querySelector('[aria-label="启用官方模型 官方真实名称"]').checked).toBe(false);
  });
  it('runs per-model tests with icon-only button and ZCode-style feedback banner', async () => {
    await mount();
    const detail = host.querySelector('.model-settings__detail');
    let resolveTest;
    testChatModel.mockImplementationOnce(() => new Promise(resolve => { resolveTest = resolve; }));
    const button = detail.querySelector('[aria-label="测试模型"]');
    expect(button.querySelector('.lucide-unplug')).not.toBeNull();
    await act(async () => button.click());
    expect(testChatModel).toHaveBeenCalledWith('official-real-id');
    expect(detail.querySelector('.model-settings__feedback--pending')).not.toBeNull();
    expect(detail.textContent).toContain('正在测试 流光剪辑 / 官方真实名称');
    expect(detail.querySelector('[aria-label="测试模型"]').disabled).toBe(true);
    expect(detail.querySelector('.model-settings__spin')).not.toBeNull();
    await act(async () => resolveTest({ ok: true, latencyMs: 42 }));
    expect(detail.querySelector('.model-settings__feedback--success')).not.toBeNull();
    expect(detail.textContent).toContain('流光剪辑 / 官方真实名称 连接成功');
    expect(detail.querySelector('[aria-label="测试模型"]').disabled).toBe(false);
    expect(detail.querySelector('[aria-label="测试模型"] .lucide-unplug')).not.toBeNull();
    await act(async () => detail.querySelector('[aria-label="关闭"]').click());
    expect(detail.querySelector('.model-settings__feedback')).toBeNull();
    testChatModel.mockResolvedValueOnce({ ok: false, error: '模型返回失败' });
    await act(async () => detail.querySelector('[aria-label="测试模型"]').click());
    expect(detail.querySelector('.model-settings__feedback--failure')).not.toBeNull();
    expect(detail.textContent).toContain('流光剪辑 / 官方真实名称 连接失败：模型返回失败');
    await act(async () => detail.querySelector('[aria-label="关闭"]').click());
    expect(detail.querySelector('.model-settings__feedback')).toBeNull();
  });
  it('allows custom editing and saving while official loading is pending or fails', async () => {
    let finishOfficial;
    getChatModelList.mockImplementation(() => new Promise(resolve => { finishOfficial = resolve; }));
    const api = await mount();
    expect(host.textContent).toContain('正在加载官方模型');
    await click('custom-existing');
    setInput('供应商名称', 'Working draft');
    await act(async () => { finishOfficial({ models: [] }); });
    getChatModelList.mockRejectedValue(new Error('secret-key-never-echo'));
    api.listProviders.mockRejectedValueOnce(new Error('custom failed'));
    await click('刷新');
    expect(api.saveProviders).toHaveBeenCalledWith([{ ...provider(), name: 'Working draft' }]);
    await click('流光剪辑');
    expect(host.textContent).toContain('加载官方模型失败');
    expect(host.textContent).not.toContain('secret-key-never-echo');
    await click('Working draft');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Working draft');
  });
  it('refresh flushes pending drafts then reloads both lists and retains drafts on custom failure', async () => {
    const api = await mount();
    await click('custom-existing');
    setInput('供应商名称', 'Retained');
    await click('流光剪辑');
    await click('刷新');
    expect(api.saveProviders).toHaveBeenCalledWith([{ ...provider(), name: 'Retained' }]);
    expect(getChatModelList).toHaveBeenCalledTimes(2);
    expect(api.listProviders).toHaveBeenCalledTimes(2);
    getChatModelList.mockResolvedValue({ modelItems: [{ model_id: 'refreshed-id', name: 'Refreshed', read_image: false }] });
    api.listProviders.mockRejectedValueOnce(new Error('custom failed'));
    await click('刷新');
    expect(getChatModelList).toHaveBeenCalledTimes(3);
    expect(api.listProviders).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain('Refreshed');
    expect(host.querySelector('.model-settings__vision-badge')).toBeNull();
    expect(host.textContent).not.toContain('不支持识图');
    await click('Retained');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Retained');
  });
  it('preserves drafts across official navigation and returns there after deleting the last custom provider', async () => {
    const api = await mount();
    await click('custom-existing');
    setInput('供应商名称', 'Kept');
    await click('流光剪辑');
    await click('Kept');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Kept');
    await click('删除供应商');
    await confirm('确认删除此供应商及其全部模型？');
    expect(host.querySelector('.model-settings__official')).not.toBeNull();
    expect(host.querySelector('.model-settings__provider.is-active').dataset.providerId).toBe('builtin-vectcut');
    expect(api.saveProviders).toHaveBeenCalledWith([]);
  });
  it('hides the custom provider group entirely when there are none', async () => {
    await mount([]);
    expect(host.textContent).not.toContain('自定义供应商');
    expect(host.textContent).not.toContain('暂无自定义供应商');
    await click('添加供应商');
    await click('Anthropic');
    expect(host.textContent).toContain('自定义供应商');
    expect(host.textContent).toContain('Anthropic');
  });
  it('shows availability dots: builtin always green, custom reflects configuration live', async () => {
    await mount([{ ...provider(), apiKey: '' }, provider('configured')]);
    const rows = [...host.querySelectorAll('.model-settings__provider')];
    expect(rows[0].querySelector('.model-settings__status--ready')).not.toBeNull();
    expect(rows[0].querySelector('.model-settings__status').getAttribute('aria-label')).toBe('供应商可用');
    expect(rows[1].querySelector('.model-settings__status--unavailable')).not.toBeNull();
    expect(rows[2].querySelector('.model-settings__status--ready')).not.toBeNull();
    await click('custom-existing');
    setInput('API Key', 'key');
    await click('添加模型');
    expect(rows[1].querySelector('.model-settings__status--ready')).not.toBeNull();
    expect(rows[1].querySelector('.model-settings__status--unavailable')).toBeNull();
  });
  it('creates new custom providers named 新供应商 with header switch, … menu and ZCode empty state', async () => {
    await mount([]);
    await click('添加供应商');
    await click('创建自定义供应商');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('新供应商');
    expect(host.querySelector('[aria-label="禁用供应商"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="更多操作"]')).not.toBeNull();
    expect(host.textContent).toContain('模型列表');
    expect(host.textContent).toContain('当前没有配置模型，添加模型后可在聊天中使用。');
  });
  it('provider switch disables the provider live and persists enabled=false on save', async () => {
    const api = await mount();
    await click('custom-existing');
    await act(async () => host.querySelector('[aria-label="禁用供应商"]').click());
    expect(host.querySelector('.model-settings__provider .model-settings__status--disabled')).not.toBeNull();
    expect(host.querySelector('[aria-label="启用供应商"]')).not.toBeNull();
    await autoSave();
    expect(api.saveProviders).toHaveBeenCalledWith([{ ...provider(), enabled: false }]);
  });
  it('renames via the … menu and restores the previous name on Escape', async () => {
    await mount();
    await click('custom-existing');
    await click('重命名');
    const input = host.querySelector('[aria-label="供应商名称"]');
    expect(document.activeElement).toBe(input);
    setInput('供应商名称', 'Renamed via menu');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(input.value).toBe('custom-existing');
  });
  it('shows ZCode-style connection fields with placeholders and endpoint format labels', async () => {
    await mount();
    await click('custom-existing');
    expect(host.querySelector('[aria-label="Base URL"]').placeholder).toBe('https://api.example.com/v1');
    expect(host.querySelector('[aria-label="API Key"]').placeholder).toBe('输入 API Key');
    expect([...host.querySelectorAll('[aria-label="API 协议"] option')].map(o => o.textContent)).toEqual(['Chat Completions (/v1/chat/completions)', 'Anthropic Messages (/v1/messages)']);
    expect(host.querySelector('.model-settings__provider-header')).not.toBeNull();
    expect(host.textContent).not.toContain('配置连接信息和可用模型');
  });
  it('mirrors the ZCode template catalog with protocol-correct endpoints and custom UUIDs', () => {
    expect(PROVIDER_TEMPLATES).toHaveLength(34);
    const byName = Object.fromEntries(PROVIDER_TEMPLATES.map(t => [t.name, t]));
    for (const template of PROVIDER_TEMPLATES) {
      const item = createProvider(template);
      expect(item.id).toMatch(/^custom-[0-9a-f-]{36}$/);
      expect(item.models).toEqual([]);
      expect(['openai', 'anthropic']).toContain(item.protocol);
      expect(item.protocol).toBe(template.protocol);
      expect(item.baseUrl).toBe(template.baseUrl);
    }
    expect(byName['智谱(中国) Coding Plan']).toMatchObject({ protocol: 'anthropic', baseUrl: 'https://open.bigmodel.cn/api/anthropic', group: 'zhipu' });
    expect(byName['智谱(国际) Coding Plan']).toMatchObject({ protocol: 'anthropic', baseUrl: 'https://api.z.ai/api/anthropic', group: 'zhipu' });
    expect(byName['智谱(中国) API']).toMatchObject({ protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', group: 'zhipu' });
    expect(byName['智谱(国际) API']).toMatchObject({ protocol: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', group: 'zhipu' });
    expect(byName['Kimi Code（国内）']).toMatchObject({ protocol: 'anthropic', baseUrl: 'https://api.kimi.com/coding' });
    expect(byName['Kimi Code（国际）']).toMatchObject({ protocol: 'anthropic', baseUrl: 'https://api.kimi.ai/coding' });
    expect(byName['MiniMax M Plan（中国）'].protocol).toBe('anthropic');
    expect(byName['阿里云百炼 Coding Plan（中国）'].baseUrl).toBe('https://coding.dashscope.aliyuncs.com/apps/anthropic');
    expect(byName['阿里云百炼 Token Plan 团队版（中国）'].baseUrl).toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic');
    expect(byName['腾讯 TokenHub 广州 API（中国站）'].baseUrl).toBe('https://tokenhub.tencentmaas.com/v1');
    expect(byName['腾讯 TokenHub 新加坡 API（中国站）'].baseUrl).toBe('https://tokenhub-intl.tencentmaas.com/v1');
    expect(byName['火山方舟 API'].baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3');
    expect(byName['火山方舟 Coding Plan'].baseUrl).toBe('https://ark.cn-beijing.volces.com/api/coding/v3');
    expect(byName['火山方舟 Agent Plan'].baseUrl).toBe('https://ark.cn-beijing.volces.com/api/plan/v3');
    expect(byName['阶跃星辰 API'].baseUrl).toBe('https://api.stepfun.com/v1');
    expect(byName['阶跃星辰 Step Plan']).toMatchObject({ protocol: 'anthropic', baseUrl: 'https://api.stepfun.com/step_plan' });
    expect(byName['硅基流动 API（中国）'].baseUrl).toBe('https://api.siliconflow.cn/v1');
    expect(byName['Kimi'].protocol).toBe('anthropic');
    expect(byName['MiniMax'].protocol).toBe('anthropic');
    expect(byName['阿里云百炼（中国）'].baseUrl).toBe('https://dashscope.aliyuncs.com/apps/anthropic');
    expect(byName['阿里云百炼（国际）'].baseUrl).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
    expect(byName['Anthropic'].baseUrl).toBe('https://api.anthropic.com');
    expect(PROVIDER_TEMPLATES.filter(t => t.group === 'zhipu')).toHaveLength(4);
  });
  it('resolves bundled brand assets for every catalog endpoint, not editable names', () => {
    for (const template of PROVIDER_TEMPLATES) {
      const src = resolveProviderLogo(template.baseUrl);
      expect(src, template.name).toBeTruthy();
      // 打包后小体积 SVG 会被内联为 data URI，其余资源保留 provider-icons 路径。
      expect(src).toMatch(/provider-icons|data:image/);
      if (!src.startsWith('data:')) {
        const candidates = [src, path.join(process.cwd(), src), path.join(process.cwd(), 'public', src.replace(/^\/(public\/)?/, ''))];
        expect(candidates.some(candidate => existsSync(candidate))).toBe(true);
      }
    }
    for (const url of ['', 'invalid', 'https://api.openai.com.evil.test/v1', 'https://evil.test/api.openai.com', 'https://api.openai.com@evil.test/v1', 'ftp://api.openai.com/v1']) expect(resolveProviderLogo(url)).toBeNull();
  });
  it('shows one merged template grid without group titles, custom Plus first, and a left back control without losing drafts', async () => {
    const api = await mount();
    await click('custom-existing');
    setInput('供应商名称', 'Draft');
    await click('添加供应商');
    const cards = [...host.querySelectorAll('.model-settings__template')];
    expect(cards).toHaveLength(PROVIDER_TEMPLATES.length + 1);
    expect(host.querySelectorAll('.model-settings__template-group-title')).toHaveLength(0);
    expect(host.querySelectorAll('.model-settings__template-grid')).toHaveLength(1);
    expect(cards[0].textContent).toBe('创建自定义供应商');
    expect(cards[0].querySelector('.lucide-plus')).not.toBeNull();
    expect(cards[1].textContent).toBe('智谱(中国) Coding Plan');
    expect(cards.slice(1).every(card => card.querySelector('img') && card.querySelector('.lucide-chevron-right') && !card.querySelector('small'))).toBe(true);
    expect(host.textContent).not.toContain('选择常用 API 模板');
    expect(host.querySelector('.model-settings__picker-heading').firstElementChild.getAttribute('aria-label')).toBe('返回供应商设置');
    await click('返回供应商设置');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Draft');
    await autoSave();
    expect(api.saveProviders).toHaveBeenCalledWith([{ ...provider(), name: 'Draft' }]);
  });
  it('creates providers from merged templates with the catalog protocol and endpoint', async () => {
    await mount([]);
    await click('添加供应商');
    await click('智谱(国际) Coding Plan');
    expect(host.querySelector('[aria-label="API 协议"]').value).toBe('anthropic');
    expect(host.querySelector('[aria-label="Base URL"]').value).toBe('https://api.z.ai/api/anthropic');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('智谱(国际) Coding Plan');
  });
  it('uses branded sidebar icons after renaming, Package for unknown endpoints and failed images', async () => {
    await mount([{ ...provider(), name: 'Renamed brand', baseUrl: 'https://api.openai.com/v1' }, { ...provider('other'), name: 'OpenAI' }]);
    const rows = [...host.querySelectorAll('.model-settings__provider')].slice(1);
    await click('Renamed brand');
    expect(rows[0].querySelector('img').getAttribute('src')).toContain('model-provider-openai.png');
    expect(rows[1].querySelector('img')).toBeNull();
    expect(rows[1].querySelector('.lucide-package')).not.toBeNull();
    await act(async () => rows[0].querySelector('img').dispatchEvent(new Event('error')));
    expect(rows[0].querySelector('.lucide-package')).not.toBeNull();
    setInput('Base URL', 'https://api.deepseek.com/v1');
    expect(rows[0].querySelector('img').getAttribute('src')).toContain('model-provider-deepseek.png');
  });
  it('persists new supplier drafts immediately and completes them on key entry', async () => {
    const api = await mount([]);
    await click('添加供应商');
    await click('Anthropic');
    expect(api.saveProviders).toHaveBeenCalledTimes(1);
    expect(api.saveProviders.mock.calls[0][0][0]).toMatchObject({ id: expect.stringMatching(/^custom-/), protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', models: [] });
    expect(host.textContent).toContain('Anthropic 保存成功');
    setInput('API Key', 'key');
    await autoSave();
    expect(api.saveProviders.mock.calls[1][0][0].apiKey).toBe('key');
  });
  it('keeps drafts when switching suppliers and auto-saves the entire array', async () => {
    const api = await mount([provider('first'), provider('second')]);
    await click('first');
    setInput('供应商名称', 'Edited');
    await click('second');
    setInput('Base URL', 'https://second.example/v1');
    await click('Edited');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Edited');
    await autoSave();
    expect(api.saveProviders).toHaveBeenCalledWith([{ ...provider('first'), name: 'Edited' }, { ...provider('second'), baseUrl: 'https://second.example/v1' }]);
  });
  it('preserves failed drafts, hides sensitive errors, and retries from the feedback banner', async () => {
    const api = await mount();
    api.saveProviders.mockRejectedValueOnce(new Error('secret-key-never-echo'));
    await click('custom-existing');
    setInput('供应商名称', 'Changed');
    await autoSave();
    expect(host.textContent).toContain('Changed 保存失败');
    expect(host.textContent).not.toContain('secret-key-never-echo');
    expect(host.querySelector('[aria-label="API Key"]').type).toBe('password');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Changed');
    await click('重试');
    expect(api.saveProviders).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Changed 保存成功');
  });
  it('adds an empty supplier via cards and validates its connection before saving', async () => {
    const api = await mount([]);
    await click('添加供应商');
    await click('Anthropic');
    expect(api.saveProviders).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Anthropic 保存失败：请输入 API Key');
    setInput('API Key', 'key');
    await autoSave();
    expect(api.saveProviders.mock.calls[0][0][0]).toMatchObject({ id: expect.stringMatching(/^custom-/), protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [] });
  });
  it('edits models with stable IDs, switches image/enabled flags, and confirms deletions', async () => {
    const api = await mount();
    await click('custom-existing');
    setInput('模型 1 名称', 'Renamed');
    setInput('模型 1 ID', 'new-service-id');
    await act(async () => host.querySelector('[aria-label="启用模型 1"]').click());
    await act(async () => host.querySelector('label input[type="checkbox"]').click());
    await autoSave();
    expect(api.saveProviders.mock.calls[0][0][0].models[0]).toEqual({ id: 'custom-old-model', name: 'Renamed', modelId: 'new-service-id', enabled: false, read_image: true });
    await click('添加模型');
    setInput('模型 2 名称', 'Second'); setInput('模型 2 ID', 'second-id');
    await autoSave();
    expect(api.saveProviders.mock.calls[1][0][0].models[1].id).toMatch(/^custom-[0-9a-f-]{36}$/);
    await click('删除模型 1');
    expect(host.querySelector('[aria-label="模型 2 名称"]')).not.toBeNull();
    await confirm('确认删除此模型？');
    expect(host.querySelector('[aria-label="模型 2 名称"]')).toBeNull();
    await click('删除供应商');
    await confirm('确认删除此供应商及其全部模型？');
    expect(api.saveProviders).toHaveBeenLastCalledWith([]);
  });
  it('refresh flushes drafts first and retains them when reload fails', async () => {
    const api = await mount();
    await click('custom-existing');
    setInput('供应商名称', 'Keep');
    await click('刷新');
    expect(api.saveProviders).toHaveBeenCalledWith([{ ...provider(), name: 'Keep' }]);
    expect(api.listProviders).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Keep');
    api.listProviders.mockRejectedValueOnce(new Error('secret-key-never-echo'));
    setInput('供应商名称', 'Keep2');
    await click('刷新');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Keep2');
    expect(host.textContent).not.toContain('secret-key-never-echo');
  });
  it('never auto-saves after initial load failure instead of overwriting unknown data', async () => {
    const api = await mount();
    act(() => root.unmount()); root = createRoot(host);
    window.electronAPI.customChatModels.listProviders.mockRejectedValue(new Error('secret-key-never-echo'));
    await act(async () => root.render(<ModelSettings />));
    expect(host.textContent).toContain('加载供应商失败');
    expect(host.textContent).not.toContain('secret-key-never-echo');
    expect(host.querySelector('.model-settings__footer')).toBeNull();
    await autoSave();
    expect(api.saveProviders).not.toHaveBeenCalled();
  });
});
