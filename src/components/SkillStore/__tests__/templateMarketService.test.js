import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMarketTemplates, installMarketTemplate, distributeTemplateColumns, validateTemplatePage } from '../templateMarketService';
import { templates, templatePage } from './fixtures/marketTemplates';

afterEach(() => { delete window.api; vi.restoreAllMocks(); });
const template = templates[0];
const fetchOk = (payload) => {
  const body = JSON.stringify(payload);
  return { ok: true, status: 200, headers: { get: (h) => h.toLowerCase() === 'content-type' ? 'application/json' : '' }, text: async () => body, json: async () => JSON.parse(body) };
};

describe('template marketplace', () => {
  it('keeps every template in exactly one column', () => {
    const columns = distributeTemplateColumns(templates);
    expect(columns).toHaveLength(3);
    expect(new Set(columns.flat().map((item) => item.id)).size).toBe(templates.length);
    expect(columns.flat()).toHaveLength(templates.length);
  });
  it('rejects malformed media and unsafe installation folders', () => {
    expect(() => validateTemplatePage({ ...templatePage(), data: [{ ...template, folder_name: '../old' }] })).toThrow();
    expect(() => validateTemplatePage({ ...templatePage(), data: [{ ...template, preview: { ...template.preview, width: 0 } }] })).toThrow();
  });
  it('requests the templates endpoint with pagination and app version, and caches the page', async () => {
    window.api = { getAppInfo: vi.fn().mockResolvedValue({ version: '1.7.27' }), getVectcutApiKey: vi.fn().mockResolvedValue('test-key') };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fetchOk(templatePage(0, 20)));
    await listMarketTemplates();
    await listMarketTemplates();
    const [request, options] = fetch.mock.calls[0];
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(request.pathname).toBe('/skill_marketplace/templates');
    expect(request.searchParams.get('app_version')).toBe('1.7.27');
    expect(request.searchParams.get('limit')).toBe('20');
    expect(options.headers.Authorization).toBe('Bearer test-key');
  });
  it('installs a template from its remote package and resolves the registered path', async () => {
    const installed = { id: 'local', folderName: template.folder_name, name: template.name, path: '/global/' + template.folder_name };
    window.api = { skill: {
      list: vi.fn().mockResolvedValueOnce({ success: true, data: [] }).mockResolvedValueOnce({ success: true, data: [installed] }),
      installFromRemotePackage: vi.fn().mockResolvedValue({ success: true, data: { id: 'local' } }),
    } };
    const result = await installMarketTemplate(template);
    expect(window.api.skill.installFromRemotePackage).toHaveBeenCalledWith(expect.objectContaining({
      packageUrl: template.package.download_url, folderName: template.folder_name, remoteId: template.id,
    }));
    expect(result.directoryPath).toBe(installed.path);
    expect(result.origin).toBe('template-market');
  });
  it('strips wrap characters from urls returned by the backend', () => {
    const wrapped = { ...templatePage(), data: [{ ...template,
      web_share: ` ${template.web_share} `,
      preview: { ...template.preview, url: `\`${template.preview.url}\``, cover_url: `\`${template.preview.cover_url}\`` },
      package: { download_url: `\`${template.package.download_url}\`` } }] };
    const page = validateTemplatePage(wrapped);
    expect(page.data[0].preview.url).toBe(template.preview.url);
    expect(page.data[0].preview.cover_url).toBe(template.preview.cover_url);
    expect(page.data[0].package.download_url).toBe(template.package.download_url);
    expect(page.data[0].web_share).toBe(template.web_share);
  });
  it('reuses an already installed skill instead of overwriting it', async () => {
    const installed = { name: template.name, folderName: template.folder_name, id: 'local', path: '/global/template' };
    window.api = { skill: {
      list: vi.fn().mockResolvedValue({ success: true, data: [installed] }),
      installFromRemotePackage: vi.fn(),
    } };
    const result = await installMarketTemplate(template);
    expect(window.api.skill.installFromRemotePackage).not.toHaveBeenCalled();
    expect(result.directoryPath).toBe(installed.path);
  });
});
