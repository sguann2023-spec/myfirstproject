export const formatTemplateCount = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  const text = String(value).trim().replace(/[,，]/g, '');
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([千万亿]?)\s*(\+)?$/);
  if (!match) return '—';
  const units = { '': 1, 千: 1000, 万: 10000, 亿: 100000000 };
  const count = Number(match[1]) * (units[match[2]] || 1);
  if (!Number.isFinite(count)) return '—';
  if (count < 10000) return `${Math.floor(count)}${match[3] || ''}`;
  return `${(Math.round(count / 1000) / 10).toFixed(1)}万`;
};
