/* 草稿下载跳链固定格式：https://www.vectcut.com/draft/downloader?draft_id=xxx */
export function parseDraftDownloaderUrl(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch (e) {
    return '';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  const host = parsed.hostname.toLowerCase();
  if (host !== 'www.vectcut.com' && host !== 'vectcut.com') return '';
  if (parsed.pathname.replace(/\/+$/, '') !== '/draft/downloader') return '';
  return String(parsed.searchParams.get('draft_id') || '').trim();
}

/* 拦截草稿跳链：解析 draft_id 后补全元数据并入队，非草稿跳链返回 false。
 * enrich / enqueue 由调用方注入（DownloadController 传入真实实现），便于独立测试与复用。 */
export async function enqueueDraftDownloaderLink(url, fallbackDraftName = '', deps = {}) {
  const draftId = parseDraftDownloaderUrl(url);
  if (!draftId) return false;
  const enrich = deps.enrich || (async (items) => items);
  const enqueue = deps.enqueue || (() => {});
  const fallbackName = String(fallbackDraftName || '').trim();
  const [item] = await enrich([{
    draft_id: draftId,
    draft_name: fallbackName || undefined,
  }]);
  if (!item?.draft_id) return false;
  enqueue(item);
  return true;
}
