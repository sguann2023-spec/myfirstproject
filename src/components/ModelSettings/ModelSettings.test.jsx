// Run: pnpm exec vitest run src/components/ModelSettings/ModelSettings.test.jsx --environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChatModelList } from '../../api/chat.js';
import ModelSettings, { createProvider, PROVIDER_TEMPLATES, resolveProviderLogo, validateProvider } from './ModelSettings';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getCurrentChannelBrandConfig } from '../../../channel-branding/runtime';

vi.mock('../../api/chat.js', () => ({ getChatModelList: vi.fn() }));
beforeEach(() => { getChatModelList.mockReset().mockResolvedValue({ modelItems: [{ model_id: 'official-real-id', name: '官方真实名称', read_image: true }], models: ['ignored-model'], defaultModel: 'official-real-id' }); });

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
  };
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const provider = (id = 'custom-existing') => ({ id, name: id, protocol: 'openai', baseUrl: 'https://example.com/v1', apiKey: 'secret-key-never-echo', models: [{ id: 'custom-old-model', name: 'Model', modelId: 'actual-model-id', read_image: false, enabled: true }] });
const mount = async (items = [provider()]) => {
  window.electronAPI = { customChatModels: { listProviders: vi.fn().mockResolvedValue(items), saveProviders: vi.fn().mockResolvedValue(items) } };
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
    for (const text of ['官方真实名称', '视觉', '模型列表', '官方 · 只读']) expect(detail.textContent).toContain(text);
    expect(detail.querySelector('.model-settings__official-heading img').getAttribute('src')).toBe(logo);
    expect(detail.querySelector('.model-settings__official-name').title).toBe('official-real-id');
    expect(detail.textContent).not.toContain('official-real-id');
    for (const text of ['ignored-model', 'API Key', 'Base URL', '删除供应商', '添加模型', '启用']) expect(detail.textContent).not.toContain(text);
    expect(detail.querySelector('input')).toBeNull();
    expect(host.textContent).toContain('所有更改已保存');
    await click('保存全部更改');
    expect(api.saveProviders).not.toHaveBeenCalled();
    await click('custom-existing');
    setInput('供应商名称', 'Draft');
    await click('流光剪辑');
    await click('保存全部更改');
    expect(api.saveProviders).toHaveBeenCalledWith([{ ...provider(), name: 'Draft' }]);
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
  it('groups compact read-only rows and shows only real positive context and supported vision badges', async () => {
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
    expect(list.querySelector('code, input, button, [role="switch"]')).toBeNull();
    expect(list.textContent).not.toMatch(/不支持|未提供|vision-id|text-id/);
    expect(api.saveProviders).not.toHaveBeenCalled();
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
    await confirm('放弃未保存的更改并刷新？');
    await click('流光剪辑');
    expect(host.textContent).toContain('加载官方模型失败');
    expect(host.textContent).not.toContain('secret-key-never-echo');
    await click('Working draft');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Working draft');
    await click('保存全部更改');
    expect(api.saveProviders).toHaveBeenCalledWith([{ ...provider(), name: 'Working draft' }]);
  });
  it('refreshes both lists after dirty confirmation and retains drafts on custom failure', async () => {
    const api = await mount();
    await click('custom-existing');
    setInput('供应商名称', 'Retained');
    await click('流光剪辑');
    await click('刷新');
    expect(getChatModelList).toHaveBeenCalledTimes(1);
    expect(api.listProviders).toHaveBeenCalledTimes(1);
    getChatModelList.mockResolvedValue({ modelItems: [{ model_id: 'refreshed-id', name: 'Refreshed', read_image: false }] });
    api.listProviders.mockRejectedValueOnce(new Error('custom failed'));
    await confirm('放弃未保存的更改并刷新？');
    expect(getChatModelList).toHaveBeenCalledTimes(2);
    expect(api.listProviders).toHaveBeenCalledTimes(2);
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
    await confirm('确认删除此供应商及其全部模型？');
    expect(host.querySelector('.model-settings__official')).not.toBeNull();
    expect(host.querySelector('.model-settings__provider.is-active').dataset.providerId).toBe('builtin-vectcut');
    await click('保存全部更改');
    expect(api.saveProviders).toHaveBeenCalledWith([]);
  });
  it('uses protocol-correct templates and custom UUIDs', () => {
    for (const template of PROVIDER_TEMPLATES) {
      const item = createProvider(template);
      expect(item.id).toMatch(/^custom-[0-9a-f-]{36}$/);
      expect(item.models).toEqual([]);
      expect(item.protocol).toBe(template.protocol);
      if (template.name === 'Anthropic') expect(item.baseUrl).toBe('https://api.anthropic.com');
      else if (template.name === '智谱 BigModel') expect(item.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
      else if (template.name === 'MiniMax') {
        expect(item.protocol).toBe('anthropic');
        expect(item.baseUrl).toBe('https://api.minimaxi.com/anthropic');
      } else if (template.baseUrl) expect(item.baseUrl).toMatch(/\/v1$/);
    }
  });
  it('resolves local brand assets by exact endpoint, not editable names', () => {
    for (const template of PROVIDER_TEMPLATES.filter(item => item.baseUrl)) {
      const src = resolveProviderLogo(template.baseUrl);
      expect(src).toMatch(/\/provider-icons\//);
      expect(existsSync(path.join(process.cwd(), 'public', src.replace(process.env.PUBLIC_URL || '', '')))).toBe(true);
    }
    for (const url of ['', 'invalid', 'https://api.openai.com.evil.test/v1', 'https://evil.test/api.openai.com', 'https://api.openai.com@evil.test/v1', 'ftp://api.openai.com/v1']) expect(resolveProviderLogo(url)).toBeNull();
  });
  it('shows compact brand cards, custom Plus first, and a left back control without losing drafts', async () => {
    const api = await mount();
    await click('custom-existing');
    setInput('供应商名称', 'Draft');
    await click('添加供应商');
    const cards = [...host.querySelectorAll('.model-settings__template')];
    expect(cards).toHaveLength(PROVIDER_TEMPLATES.length);
    expect(cards[0].textContent).toBe('创建自定义供应商');
    expect(cards[0].querySelector('.lucide-plus')).not.toBeNull();
    expect(cards.slice(1).every(card => card.querySelector('img') && card.querySelector('.lucide-chevron-right') && !card.querySelector('small'))).toBe(true);
    expect(host.textContent).not.toContain('选择常用 API 模板');
    expect(host.querySelector('.model-settings__picker-heading').firstElementChild.getAttribute('aria-label')).toBe('返回供应商设置');
    await click('返回供应商设置');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Draft');
    expect(api.saveProviders).not.toHaveBeenCalled();
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
  it('allows zero models but validates connection information and models', () => {
    expect(validateProvider({ ...provider(), models: [] })).toBe('');
    for (const field of ['name', 'baseUrl', 'apiKey']) expect(validateProvider({ ...provider(), [field]: '' })).not.toBe('');
    for (const baseUrl of ['file:///tmp', 'https://user:password@example.com', 'https://example.com?key=secret', 'https://example.com/v1/messages', 'https://example.com/v1/chat/completions']) expect(validateProvider({ ...provider(), baseUrl })).not.toBe('');
    expect(validateProvider({ ...provider(), protocol: 'bad' })).not.toBe('');
    expect(validateProvider({ ...provider(), models: [{ name: '', modelId: '' }] })).toBe('请输入模型名称');
  });
  it('keeps drafts when switching suppliers and saves the entire array explicitly', async () => {
    const api = await mount([provider('first'), provider('second')]);
    await click('first');
    setInput('供应商名称', 'Edited');
    await click('second');
    setInput('Base URL', 'https://second.example/v1');
    await click('Edited');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Edited');
    expect(api.saveProviders).not.toHaveBeenCalled();
    await click('保存全部更改');
    expect(api.saveProviders).toHaveBeenCalledWith([{ ...provider('first'), name: 'Edited' }, { ...provider('second'), baseUrl: 'https://second.example/v1' }]);
  });
  it('preserves failed drafts, hides sensitive errors, and retries', async () => {
    const api = await mount();
    api.saveProviders.mockRejectedValueOnce(new Error('secret-key-never-echo'));
    await click('custom-existing');
    setInput('供应商名称', 'Changed');
    await click('保存全部更改');
    expect(host.textContent).toContain('当前草稿已保留');
    expect(host.textContent).not.toContain('secret-key-never-echo');
    expect(host.querySelector('[aria-label="API Key"]').type).toBe('password');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Changed');
    await click('保存全部更改');
    expect(api.saveProviders).toHaveBeenCalledTimes(2);
  });
  it('adds an empty supplier via cards and validates its connection before saving', async () => {
    const api = await mount([]);
    await click('添加供应商');
    await click('Anthropic');
    await click('保存全部更改');
    expect(api.saveProviders).not.toHaveBeenCalled();
    expect(host.textContent).toContain('请输入 API Key');
    setInput('API Key', 'key');
    await click('保存全部更改');
    expect(api.saveProviders.mock.calls[0][0][0]).toMatchObject({ id: expect.stringMatching(/^custom-/), protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [] });
  });
  it('edits models with stable IDs, switches image/enabled flags, and confirms deletions', async () => {
    const api = await mount();
    await click('custom-existing');
    setInput('模型 1 名称', 'Renamed');
    setInput('模型 1 ID', 'new-service-id');
    await act(async () => host.querySelector('[aria-label="启用模型 1"]').click());
    await act(async () => host.querySelector('label input[type="checkbox"]').click());
    await click('保存全部更改');
    expect(api.saveProviders.mock.calls[0][0][0].models[0]).toEqual({ id: 'custom-old-model', name: 'Renamed', modelId: 'new-service-id', enabled: false, read_image: true });
    await click('添加模型');
    setInput('模型 2 名称', 'Second'); setInput('模型 2 ID', 'second-id');
    await click('保存全部更改');
    expect(api.saveProviders.mock.calls[1][0][0].models[1].id).toMatch(/^custom-[0-9a-f-]{36}$/);
    await click('删除模型 1');
    expect(host.querySelector('[aria-label="模型 2 名称"]')).not.toBeNull();
    await confirm('确认删除此模型？');
    expect(host.querySelector('[aria-label="模型 2 名称"]')).toBeNull();
    await confirm('确认删除此供应商及其全部模型？');
    await click('保存全部更改');
    expect(api.saveProviders).toHaveBeenLastCalledWith([]);
  });
  it('requires confirmation to refresh dirty drafts and retains drafts on refresh failure', async () => {
    const api = await mount();
    await click('custom-existing');
    setInput('供应商名称', 'Keep');
    await click('刷新');
    expect(api.listProviders).toHaveBeenCalledTimes(1);
    api.listProviders.mockRejectedValueOnce(new Error('secret-key-never-echo'));
    await confirm('放弃未保存的更改并刷新？');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('Keep');
    expect(host.textContent).not.toContain('secret-key-never-echo');
    await confirm('放弃未保存的更改并刷新？');
    expect(host.querySelector('[aria-label="供应商名称"]').value).toBe('custom-existing');
  });
  it('blocks saving after initial load failure instead of overwriting unknown data', async () => {
    await mount();
    act(() => root.unmount()); root = createRoot(host);
    window.electronAPI.customChatModels.listProviders.mockRejectedValue(new Error('secret-key-never-echo'));
    await act(async () => root.render(<ModelSettings />));
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '保存全部更改').disabled).toBe(true);
    expect(host.textContent).not.toContain('secret-key-never-echo');
  });
});
