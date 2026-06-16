export function toMediaSrc(value) {
  if (!value) return '';

  const raw = String(value).trim().replace(/^[\s'"`]+|[\s'"`]+$/g, '');
  if (!raw) return '';

  if (/^(https?:|data:|blob:)/i.test(raw)) {
    return raw;
  }

  if (/^file:/i.test(raw)) {
    try {
      return new URL(raw).toString();
    } catch {
      return encodeURI(raw);
    }
  }

  if (/^[a-zA-Z]:[\\/]/.test(raw)) {
    return encodeURI(`file:///${raw.replace(/\\/g, '/')}`);
  }

  if (/^(\\\\|\/\/)/.test(raw)) {
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    return encodeURI(`file://${normalized}`);
  }

  if (raw.startsWith('/')) {
    return encodeURI(`file://${raw}`);
  }

  return raw;
}
