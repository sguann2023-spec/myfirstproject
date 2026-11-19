export const TEMPLATE_MARKET_PAGE_SIZE = 20;

// 后端历史数据里 URL 可能被反引号/空白包裹，边界处统一清理
const cleanUrl = (url) => (typeof url === 'string' ? url.trim().replace(/^`+|`+$/g, '').trim() : url);

const normalizeItem = (item) => ({
  ...item,
  web_share: cleanUrl(item?.web_share),
  preview: { ...item?.preview, url: cleanUrl(item?.preview?.url), cover_url: cleanUrl(item?.preview?.cover_url) },
  package: { ...item?.package, download_url: cleanUrl(item?.package?.download_url) },
});

export const validateTemplatePage = (payload) => {
  if (payload?.code !== 0 || !Array.isArray(payload.data)
    || !Number.isSafeInteger(payload.total) || payload.total < 0) {
    throw new Error(payload?.message || '模板列表格式无效');
  }
  const data = payload.data.map(normalizeItem);
  const ids = new Set();
  for (const item of data) {
    if (!item?.id || ids.has(item.id) || !item.name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(item.folder_name || '')
      || !['image', 'video'].includes(item.preview?.type)
      || ![item.preview?.url, item.preview?.cover_url, item.web_share, item.package?.download_url].every((url) => /^https:\/\//i.test(url || ''))
      || !Number.isFinite(item.preview.width) || item.preview.width <= 0
      || !Number.isFinite(item.preview.height) || item.preview.height <= 0
      || !Number.isSafeInteger(item.likes_count) || item.likes_count < 0) throw new Error('模板条目格式无效');
    ids.add(item.id);
  }
  return { ...payload, data };
};

const TEMPLATE_MARKET_CACHE_TTL_MS = 10 * 60 * 1000;
const templatePageCache = new Map();
const templatePageRequests = new Map();

export function clearTemplateMarketCache() {
  templatePageCache.clear();
  templatePageRequests.clear();
}

async function requestMarketplaceJson(url) {
  const key = await window.api.getVectcutApiKey();
  if (!key) throw new Error('请先登录');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  const raw = await response.text();
  const ct = response.headers.get('content-type') || '';
  if (!response.ok) {
    let serverMessage = '';
    if (ct.includes('application/json')) {
      try {
        const err = JSON.parse(raw);
        serverMessage = err?.message || err?.Message || err?.error || '';
      } catch {}
    }
    if (!serverMessage) serverMessage = raw.slice(0, 120);
    throw new Error(`获取模板失败（HTTP ${response.status}）：${serverMessage || '未知错误'}`);
  }
  if (!ct.includes('application/json')) {
    throw new Error(`模板接口返回非 JSON 数据（content-type: ${ct || '未知'}）：${raw.slice(0, 120)}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`模板接口返回非 JSON 数据：${raw.slice(0, 120)}`);
  }
}

async function fetchTemplatePage({ offset, limit }) {
  const appInfo = await window.api.getAppInfo();
  const url = new URL('https://open.vectcut.com/skill_marketplace/templates');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('app_version', appInfo.version);
  return validateTemplatePage(await requestMarketplaceJson(url));
}

export async function listMarketTemplates({ offset = 0, limit = TEMPLATE_MARKET_PAGE_SIZE } = {}) {
  const cacheKey = `${offset}:${limit}`;
  const cached = templatePageCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < TEMPLATE_MARKET_CACHE_TTL_MS) return cached.data;
  const inFlight = templatePageRequests.get(cacheKey);
  if (inFlight) return inFlight;
  const request = fetchTemplatePage({ offset, limit })
    .then((data) => {
      templatePageCache.set(cacheKey, { data, fetchedAt: Date.now() });
      return data;
    })
    .finally(() => templatePageRequests.delete(cacheKey));
  templatePageRequests.set(cacheKey, request);
  return request;
}

// 首页推荐位只展示轻量卡片，放宽校验：只要求可展示与可安装的最小字段
export const validateRecommendedTemplates = (payload) => {
  if (payload?.code !== 0 || !Array.isArray(payload.data)) {
    throw new Error(payload?.message || '推荐模板列表格式无效');
  }
  return payload.data.map(normalizeItem).filter((item) => item?.id && item?.folder_name && item?.name
    && /^https:\/\//i.test(item.web_share || '')
    && /^https:\/\//i.test(item.package?.download_url || ''));
};

export async function listRecommendedTemplates(limit = 3) {
  const appInfo = await window.api.getAppInfo();
  const url = new URL('https://open.vectcut.com/skill_marketplace/templates/recommended');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('app_version', appInfo.version);
  return validateRecommendedTemplates(await requestMarketplaceJson(url)).slice(0, limit);
}

export async function installMarketTemplate(template) {
  const api = window.api.skill;
  const list = await api.list();
  if (!list?.success) throw new Error('读取已安装技能失败');
  // 已安装则直接复用，不做覆盖安装
  let installed = list.data.find((skill) => skill.folderName === template.folder_name);
  if (!installed) {
    let result = await api.installFromRemotePackage({ packageUrl: template.package.download_url,
      folderName: template.folder_name, remoteId: template.id, remoteName: template.name,
      iconUrl: template.icon_url || null,
      previewVideoUrl: template.preview.type === 'video' ? template.preview.url : null,
      sourceUrl: template.web_share });
    if (!result?.success) throw new Error(result?.error?.message || '安装模板失败');
    installed = result.data;
    if (!installed?.path) {
      const refreshed = await api.list();
      if (!refreshed?.success) throw new Error('刷新已安装技能失败');
      installed = refreshed.data.find((skill) => skill.folderName === template.folder_name);
    }
  }
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
