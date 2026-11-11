import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMarketTemplates, installMarketTemplate, distributeTemplateColumns, validateTemplatePage } from '../templateMarketService';
import fixture from '../../../../resources/skill-template-marketplace/mock/templates.json';

afterEach(() => { delete window.api; vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const template = fixture.data[0];
describe('isolated template marketplace', () => {
  it('paginates mock data without calling either old or new backends', async () => {
    window.api = { getAppInfo: vi.fn().mockResolvedValue({ version: '1.7.27' }) };
    const fetch = vi.spyOn(globalThis, 'fetch');
    const first = await listMarketTemplates({ offset: 0, limit: 3 });
    const second = await listMarketTemplates({ offset: 3, limit: 3 });
    const empty = await listMarketTemplates({ offset: 6, limit: 3 });
    expect(first.data).toHaveLength(3); expect(second.data).toHaveLength(3); expect(empty.data).toEqual([]);
    expect(new Set([...first.data, ...second.data].map((item) => item.id)).size).toBe(6);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps every template in exactly one column', () => {
    const columns = distributeTemplateColumns(fixture.data);
    expect(columns).toHaveLength(3);
    expect(new Set(columns.flat().map((item) => item.id)).size).toBe(6);
    expect(columns.flat()).toHaveLength(6);
  });
  it('rejects malformed media and unsafe installation folders', () => {
    expect(() => validateTemplatePage({ ...fixture, data: [{ ...template, folder_name: '../old' }] })).toThrow();
    expect(() => validateTemplatePage({ ...fixture, data: [{ ...template, preview: { ...template.preview, width: 0 } }] })).toThrow();
  });
  it('requests only the new endpoint when mock is disabled and passes the current app version', async () => {
    vi.stubEnv('VITE_SKILL_TEMPLATE_MARKETPLACE_MOCK', '0');
    vi.resetModules();
    const service = await import('../templateMarketService');
    window.api = { getAppInfo: vi.fn().mockResolvedValue({ version: '1.7.27' }), getVectcutApiKey: vi.fn().mockResolvedValue('test-key') };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ...fixture, limit: 20, offset: 0 }) });
    await service.listMarketTemplates();
    const [request, options] = fetch.mock.calls[0];
    expect(request.pathname).toBe('/skill_template_marketplace/templates');
    expect(request.searchParams.get('app_version')).toBe('1.7.27');
    expect(request.searchParams.get('limit')).toBe('20');
    expect(request.searchParams.has('version')).toBe(false);
    expect(options.headers.Authorization).toBe('Bearer test-key');
  });
  it('copies a new mock package from its isolated resources directory and resolves the registered path', async () => {
    const installed = { id: 'local', folderName: template.folder_name, name: template.name, path: '/global/' + template.folder_name };
    window.api = { getAppInfo: vi.fn().mockResolvedValue({ resourcesPath: '/resources' }), skill: {
      list: vi.fn().mockResolvedValueOnce({ success: true, data: [] }).mockResolvedValueOnce({ success: true, data: [installed] }),
      installFromDirectory: vi.fn().mockResolvedValue({ success: true, data: { id: 'local' } }),
      installFromRemotePackage: vi.fn(),
    } };
    const result = await installMarketTemplate(template);
    expect(window.api.skill.installFromDirectory).toHaveBeenCalledWith(expect.objectContaining({
      directoryPath: `/resources/skill-template-marketplace/mock/skills/${template.folder_name}`, folderName: template.folder_name,
    }));
    expect(window.api.skill.installFromRemotePackage).not.toHaveBeenCalled();
    expect(result.directoryPath).toBe(installed.path);
    expect(result.origin).toBe('template-market');
  });
  it.each([['1.0.0', false], ['2.0.0', false], [null, false], ['0.9.0', true]])('compares local version %s before replacing: %s', async (version, replace) => {
    const installed = { name: template.name, folderName: template.folder_name, id: 'local', path: '/global/template' };
    window.api = { getAppInfo: vi.fn().mockResolvedValue({ resourcesPath: '/resources' }), skill: {
      list: vi.fn().mockResolvedValue({ success: true, data: [installed] }),
      readSkillFile: vi.fn().mockResolvedValue({ success: true, data: version }),
      installFromDirectory: vi.fn().mockResolvedValue({ success: true, data: installed }),
    } };
    await installMarketTemplate(template);
    expect(window.api.skill.installFromDirectory).toHaveBeenCalledTimes(replace ? 1 : 0);
  });
});
