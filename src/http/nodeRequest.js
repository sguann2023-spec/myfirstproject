import { isVectcutApiUrl, withClientTypeHeader } from '@shared/network/clientMeta';

export function withNodeRequestClientMeta(url, options = {}) {
  if (!isVectcutApiUrl(url)) return options;

  return {
    ...options,
    headers: Object.fromEntries(withClientTypeHeader(options.headers).entries()),
  };
}

