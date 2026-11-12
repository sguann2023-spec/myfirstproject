import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import CustomModelsDialog, { validateCustomModel } from './CustomModelsDialog';

vi.mock('antd', () => {
  const Input = props => <input {...props} />;
  Input.Password = props => <input {...props} type="password" />;
  const Form = ({ children }) => <div>{children}</div>;
  Form.Item = ({ label, children }) => <label>{label}{children}</label>;
  return {
    Input, Form,
    Modal: ({ children, footer }) => <div>{children}{footer}</div>,
    Button: ({ children, onClick, disabled, loading }) => <button disabled={disabled || loading} onClick={onClick}>{children}</button>,
    Alert: ({ message }) => <div role="alert">{message}</div>,
    Checkbox: ({ children, onChange, checked, disabled }) => <label><input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />{children}</label>,
    Select: ({ options, onChange, ...props }) => <select {...props} onChange={e => onChange(e.target.value)}>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>,
    Popconfirm: ({ children, onConfirm }) => <div>{children}<button onClick={onConfirm}>确认删除</button></div>,
  };
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const model = { id: 'custom-existing', name: 'My model', protocol: 'openai', baseUrl: 'https://example.com/v1', apiKey: 'secret', modelId: 'test', read_image: false };
const render = props => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root.render(<CustomModelsDialog {...props} />)); };
const click = async text => { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === text).click()); };
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); });

describe('custom model settings', () => {
  it('validates required fields, protocols and endpoint URLs', () => {
    expect(validateCustomModel(model)).toBe('');
    for (const key of ['name', 'baseUrl', 'apiKey', 'modelId']) expect(validateCustomModel({ ...model, [key]: ' ' })).not.toBe('');
    for (const baseUrl of ['file:///tmp/test', 'not-a-url', 'https://user:pass@example.com']) expect(validateCustomModel({ ...model, baseUrl })).not.toBe('');
    expect(validateCustomModel({ ...model, protocol: 'unsupported' })).not.toBe('');
  });
  it('keeps failed drafts and retries the entire edited array without selecting a model', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValueOnce([model]);
    const close = vi.fn();
    render({ customModels: [model], onSaveCustomModels: save, onClose: close });
    const input = host.querySelector('[aria-label="模型 1 名称"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Edited');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('[aria-label="模型 1 API Key"]').type).toBe('password');
    await click('保存');
    expect(close).not.toHaveBeenCalled();
    expect(host.textContent).toContain('当前草稿已保留');
    expect(host.textContent).not.toContain('secret');
    expect(input.value).toBe('Edited');
    await click('保存');
    expect(save).toHaveBeenLastCalledWith([{ ...model, name: 'Edited' }]);
    expect(close).toHaveBeenCalledOnce();
  });
  it('adds UUID models, validates them and saves confirmed deletions', async () => {
    const save = vi.fn().mockResolvedValue([]);
    render({ customModels: [model], onSaveCustomModels: save, onClose: vi.fn() });
    await click('新增模型');
    await click('保存');
    expect(save).not.toHaveBeenCalled();
    expect(host.textContent).toContain('请输入模型名称');
    await click('确认删除');
    await click('确认删除');
    await click('保存');
    expect(save).toHaveBeenCalledWith([]);
  });
  it('initializes models when loading finishes and disables editing during loading', async () => {
    const save = vi.fn();
    const close = vi.fn();
    render({ customModels: [], customModelsLoading: true, onSaveCustomModels: save, onClose: close });
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '新增模型').disabled).toBe(true);
    act(() => root.render(<CustomModelsDialog customModels={[model]} onSaveCustomModels={save} onClose={close} />));
    expect(host.querySelector('[aria-label="模型 1 名称"]').value).toBe('My model');
  });
  it('saves new models with a stable custom UUID and protocol/image fields', async () => {
    const save = vi.fn().mockResolvedValue([]);
    render({ onSaveCustomModels: save, onClose: vi.fn() });
    await click('新增模型');
    for (const [field, value] of [['名称', 'New'], ['Base URL', 'https://example.com'], ['API Key', 'key'], ['模型 ID', 'new-model']]) {
      const input = host.querySelector(`[aria-label="模型 1 ${field}"]`);
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await click('保存');
    expect(save.mock.calls[0][0][0]).toEqual({ id: expect.stringMatching(/^custom-[0-9a-f-]{36}$/), name: 'New', protocol: 'openai', baseUrl: 'https://example.com', apiKey: 'key', modelId: 'new-model', read_image: false });
  });
  it('keeps the popup footer accessible while built-in models are loading or empty', () => {
    const source = readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.js`, 'utf8');
    expect(source).toContain('popupRender={(menu) =>');
    expect(source).not.toContain('disabled={modelListLoading || availableModelOptions.length === 0}');
    expect(source).toContain("item?.isCustom ? '' : resolveModelOptionPriceMultiplier(item)");
    expect(source).toContain('availableModelOptions.filter(option => option.isCustom)');
  });
});
