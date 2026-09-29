import { isVectcutApiUrl, withClientTypeHeader } from '@shared/network/clientMeta';
import axios from 'axios';

const INSTALLED_KEY = '__vectcutHttpClientInstalled';
const AXIOS_INSTALLED_KEY = '__vectcutAxiosHttpClientInstalled';

const buildRequestInit = (input, init = {}) => {
  if (!isVectcutApiUrl(input)) return init;

  const requestHeaders = typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined;
  return {
    ...init,
    headers: withClientTypeHeader(init.headers || requestHeaders),
  };
};

export function installRendererHttpClient() {
  if (globalThis[INSTALLED_KEY] || typeof globalThis.fetch !== 'function') return;
  globalThis[INSTALLED_KEY] = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init = {}) => originalFetch(input, buildRequestInit(input, init));

  if (!globalThis[AXIOS_INSTALLED_KEY] && axios?.Axios?.prototype?.request) {
    globalThis[AXIOS_INSTALLED_KEY] = true;
    const originalAxiosRequest = axios.Axios.prototype.request;
    axios.Axios.prototype.request = function requestWithClientMeta(configOrUrl, config) {
      const requestConfig = typeof configOrUrl === 'string'
        ? { ...(config || {}), url: configOrUrl }
        : { ...(configOrUrl || {}) };

      const baseURL = requestConfig.baseURL || this?.defaults?.baseURL || '';
      const targetUrl = requestConfig.url ? new URL(requestConfig.url, baseURL || window.location.href).toString() : baseURL;
      if (isVectcutApiUrl(targetUrl)) {
        requestConfig.headers = withClientTypeHeader(requestConfig.headers);
      }

      return originalAxiosRequest.call(this, requestConfig);
    };
  }
}
