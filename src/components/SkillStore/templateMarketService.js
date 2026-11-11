import semver from 'semver';
import mockResponse from '../../../resources/skill-template-marketplace/mock/templates.json';

export const TEMPLATE_MARKET_MOCK = import.meta.env.DEV && import.meta.env.VITE_SKILL_TEMPLATE_MARKETPLACE_MOCK !== '0';
export const TEMPLATE_MARKET_PAGE_SIZE = TEMPLATE_MARKET_MOCK ? 3 : 20;

export const validateTemplatePage = (payload) => {
  if (payload?.code !== 0 || !Array.isArray(payload.data)
    || !Number.isSafeInteger(payload.total) || payload.total < 0) {
    throw new Error(payload?.message || '模板列表格式无效');
  }
  const ids = new Set();
  for (const item of payload.data) {
    if (!item?.id || ids.has(item.id) || !item.name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(item.folder_name || '')
      || !semver.valid(item.version) || !['image', 'video'].includes(item.preview?.type)
      || ![item.preview?.url, item.preview?.cover_url, item.web_share, item.package?.download_url].every((url) => /^https:\/\//i.test(url || ''))
      || !Number.isFinite(item.preview.width) || item.preview.width <= 0
      || !Number.isFinite(item.preview.height) || item.preview.height <= 0
      || !Number.isSafeInteger(item.likes_count) || item.likes_count < 0) throw new Error('模板条目格式无效');
    ids.add(item.id);
  }
  return payload;
};

export async function listMarketTemplates({ offset = 0, limit = TEMPLATE_MARKET_PAGE_SIZE } = {}) {
  const appInfo = await window.api.getAppInfo();
  if (TEMPLATE_MARKET_MOCK) {
    return validateTemplatePage({ ...mockResponse, data: mockResponse.data.slice(offset, offset + limit), limit, offset });
  }
  const key = await window.api.getVectcutApiKey();
  if (!key) throw new Error('请先登录');
  const url = new URL('https://open.vectcut.com/skill_template_marketplace/templates');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('app_version', appInfo.version);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`获取模板失败（${response.status}）`);
  return validateTemplatePage(await response.json());
}

export async function installMarketTemplate(template) {
  const api = window.api.skill;
  const list = await api.list();
  if (!list?.success) throw new Error('读取已安装技能失败');
  let installed = list.data.find((skill) => skill.folderName === template.folder_name);
  let replace = !installed;
  if (installed) {
    const result = await api.readSkillFile(installed.id || installed.folderName, '.version');
    if (!result?.success) throw new Error('读取技能版本失败');
    const version = String(result.data || '').trim();
    replace = Boolean(semver.valid(version) && semver.gt(template.version, version));
  }
  if (replace) {
    let result;
    if (TEMPLATE_MARKET_MOCK) {
      const fixture = mockResponse.data.find((item) => item.id === template.id && item.folder_name === template.folder_name);
      if (!fixture) throw new Error('Mock 模板不存在');
      const info = await window.api.getAppInfo();
      result = await api.installFromDirectory({
        directoryPath: `${info.resourcesPath}/skill-template-marketplace/mock/skills/${fixture.folder_name}`,
        folderName: fixture.folder_name, source: 'builtin', iconUrl: fixture.icon_url,
        previewVideoUrl: fixture.preview.type === 'video' ? fixture.preview.url : null,
      });
    } else {
      result = await api.installFromRemotePackage({ packageUrl: template.package.download_url,
        folderName: template.folder_name, remoteId: template.id, remoteName: template.name,
        iconUrl: template.icon_url || null,
        previewVideoUrl: template.preview.type === 'video' ? template.preview.url : null,
        sourceUrl: template.web_share });
    }
    if (!result?.success) throw new Error(result?.error?.message || '安装模板失败');
    installed = result.data;
    if (!installed?.path) {
      const refreshed = await api.list();
      if (!refreshed?.success) throw new Error('刷新已安装技能失败');
      installed = refreshed.data.find((skill) => skill.folderName === template.folder_name);
    }
  }
  // Read the selected local version, including a newer user-installed copy.
  if (!installed?.path) throw new Error('技能安装目录不可用');
  window.dispatchEvent(new Event('skill-store-updated'));
  return { ...installed, directoryPath: installed.path, __skillRoot: installed.path, origin: 'template-market', title: installed.name };
}

export function distributeTemplateColumns(items, count = 3) {
  const columns = Array.from({ length: count }, () => []);
  const heights = Array(count).fill(0);
  for (const item of items) {
    const column = heights.indexOf(Math.min(...heights));
    columns[column].push(item);
    heights[column] += item.preview.height / item.preview.width;
  }
  return columns;
}
