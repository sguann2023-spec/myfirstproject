import { toMediaSrc } from '../../../../shared/mediaSrc';

const resolveCoverSrc = (value, root) => {
  const cover = String(value || '').trim();
  if (!cover) return '';
  if (/^(https?:|file:|data:image\/|blob:)/i.test(cover)) return toMediaSrc(cover);
  if (/^[a-zA-Z]:[\\/]/.test(cover) || /^(\/|\\\\)/.test(cover)) return toMediaSrc(cover);
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(cover) || !root) return '';
  return toMediaSrc(`${String(root).replace(/[\\/]+$/, '')}/${cover.replace(/^\.\//, '')}`);
};

export const parseSkillDisplayMetadata = (raw, root = '') => {
  try {
    const example = JSON.parse(raw);
    const url = String(example?.display_info?.web_share || '').trim();
    return {
      webUrl: /^https?:\/\//i.test(url) ? url : '',
      coverSrc: resolveCoverSrc(example?.display_info?.cover_url || example?.cover_url, root)
    };
  } catch (_error) {
    return { webUrl: '', coverSrc: '' };
  }
};
