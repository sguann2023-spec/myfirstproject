// Coze workflow code node version
// Purpose: probe GitHub proxy nodes, update app-upgrade-config.json content,
// upload it to OSS, and refresh Alibaba Cloud CDN.
//
// Recommended inputs:
// - accessKeyId: string
// - accessKeySecret: string
// - bucketName: string, default oss-hangzhou-mp4
// - ossEndpoint: string, default oss-cn-hangzhou.aliyuncs.com
// - publicEndpoint: string, default https://player.install-ai-guider.top
// - cdnEndpoint: string, default https://cdn.aliyuncs.com
// - objectName: string, default client/config/app-upgrade-config.json
// - sourceUrl: string, default https://github.akams.cn/
// - repo: string, default sun-guannan/CapCutMaker
// - limit: number, default 5
// - publish: boolean, default true
// - dryRun: boolean, default false
// - currentConfigUrl: string, optional. Defaults to {publicEndpoint}/{objectName}
// - candidatePrefixes: string | string[], optional. JSON array or newline/comma separated.
// - fallbackPrefixes: string | string[], optional. JSON array or newline/comma separated.
//
// Recommended outputs:
// - success: boolean
// - message: string
// - selectedProxyPrefixes: array<string>
// - lastUpdated: string
// - publicUrl: string
// - cdnRequestId: string
// - configJson: string
// - initialProbeResultsJson: string
// - strictProbeResultsJson: string

// Fill constants here if you want to run the workflow without configuring node inputs.
// Non-empty values here take priority over `params`.
const STATIC_CONFIG = {
  accessKeyId: '',
  accessKeySecret: '',
  bucketName: 'oss-hangzhou-mp4',
  ossEndpoint: 'oss-cn-hangzhou.aliyuncs.com',
  publicEndpoint: 'https://player.install-ai-guider.top',
  cdnEndpoint: 'https://cdn.aliyuncs.com',
  objectName: 'client/config/app-upgrade-config.json',
  sourceUrl: 'https://github.akams.cn/',
  repo: 'sun-guannan/CapCutMaker',
  limit: 5,
  publish: true,
  dryRun: false,
  currentConfigUrl: '',
  candidatePrefixes: [],
  fallbackPrefixes: []
};

const DEFAULTS = {
  bucketName: 'oss-hangzhou-mp4',
  ossEndpoint: 'oss-cn-hangzhou.aliyuncs.com',
  publicEndpoint: 'https://player.install-ai-guider.top',
  cdnEndpoint: 'https://cdn.aliyuncs.com',
  objectName: 'client/config/app-upgrade-config.json',
  sourceUrl: 'https://github.akams.cn/',
  repo: 'sun-guannan/CapCutMaker',
  limit: 5,
  publish: true,
  dryRun: false,
  connectTimeoutMs: 10_000,
  initialTimeoutMs: 25_000,
  strictTimeoutMs: 45_000,
  initialHeadRange: '0-262143',
  initialDeepRange: '629145600-629407743',
  strictHeadRange: '0-1048575',
  strictDeepRange: '629145600-630194175',
  initialMinBytes: 131072,
  strictMinBytes: 262144,
  topCandidates: 8
};

const DEFAULT_FALLBACK_PREFIXES = [
  'https://gh.acmsz.top/',
  'https://gh.ddlc.top/',
  'https://githubdog.com/',
  'https://gh.monlor.com/',
  'https://gh.meali.top/',
  'https://ghproxy.imciel.com/',
  'https://ghproxy.felicity.land/',
  'https://gitproxy.mrhjx.cn/',
  'https://github.nswrz.cn/',
  'https://github.dpik.top/'
];

function getCryptoApi() {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  if (typeof require === 'function') {
    try {
      const nodeCrypto = require('crypto');
      return nodeCrypto.webcrypto;
    } catch (error) {
      return null;
    }
  }
  return null;
}

function getTextEncoder() {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder();
  }
  throw new Error('TextEncoder is not available in this runtime.');
}

function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let index = 0; index < view.length; index += 1) {
    binary += String.fromCharCode(view[index]);
  }

  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }

  throw new Error('No base64 encoder is available in this runtime.');
}

async function hmacSha1Base64(secret, value) {
  const cryptoApi = getCryptoApi();
  if (!cryptoApi || !cryptoApi.subtle) {
    throw new Error('Web Crypto API is not available in this runtime.');
  }

  const encoder = getTextEncoder();
  const key = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await cryptoApi.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64(new Uint8Array(signature));
}

function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizePrefix(prefix) {
  const text = String(prefix || '').trim();
  if (!text) {
    throw new Error('Proxy prefix cannot be empty.');
  }
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  return `${withProtocol.replace(/\/+$/, '')}/`;
}

function uniquePreserveOrder(values) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseNumber(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseStringArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  const text = String(value).trim();
  if (!text) {
    return [];
  }

  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (error) {
      // fall through to split mode
    }
  }

  return text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickValue(staticValue, paramValue, defaultValue) {
  if (Array.isArray(staticValue)) {
    return staticValue.length > 0 ? staticValue : paramValue !== undefined ? paramValue : defaultValue;
  }
  if (typeof staticValue === 'boolean') {
    return staticValue;
  }
  if (typeof staticValue === 'number') {
    return Number.isFinite(staticValue) ? staticValue : paramValue !== undefined ? paramValue : defaultValue;
  }
  if (staticValue !== undefined && staticValue !== null && String(staticValue).trim() !== '') {
    return staticValue;
  }
  if (paramValue !== undefined && paramValue !== null && String(paramValue).trim() !== '') {
    return paramValue;
  }
  return defaultValue;
}

function buildLatestYmlTarget(repo) {
  return `https://github.com/${repo}/releases/latest/download/latest.yml`;
}

function buildProxiedUrl(prefix, targetUrl) {
  return `${normalizePrefix(prefix)}${targetUrl}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULTS.initialTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': 'CapCutHelper/1.0'
      }
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }

  return await response.text();
}

async function fetchJsonOrNull(url, timeoutMs) {
  try {
    const text = await fetchText(url, timeoutMs);
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function extractCandidatePrefixes(pageText) {
  const domainRegex = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi;
  const candidates = [];
  const matches = pageText.match(domainRegex) || [];

  for (const match of matches) {
    const domain = match.toLowerCase();
    if (domain === 'github.com' || domain === 'raw.githubusercontent.com') {
      continue;
    }

    const firstLabel = domain.split('.', 1)[0];
    if (firstLabel.startsWith('gh') || firstLabel.startsWith('github') || firstLabel.startsWith('gitproxy')) {
      candidates.push(normalizePrefix(domain));
    }
  }

  return uniquePreserveOrder(candidates);
}

async function probeLatestYml(prefix, latestYmlTarget, timeoutMs) {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(
      buildProxiedUrl(prefix, latestYmlTarget),
      {
        headers: {
          Range: 'bytes=0-511',
          'User-Agent': 'CapCutHelper/1.0'
        }
      },
      timeoutMs
    );
    const text = await response.text();
    const ok = response.ok && text.includes('version:') && text.includes('path:');
    return {
      ok,
      elapsedMs: Date.now() - startedAt,
      text: ok ? text : null,
      error: ok ? null : `latest.yml missing version/path fields or HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      text: null,
      error: String(error && error.message ? error.message : error)
    };
  }
}

function parseLatestYmlPath(latestYmlText) {
  const lines = String(latestYmlText).split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('path:')) {
      const value = line.split(':', 2)[1].trim();
      if (value) {
        return value;
      }
    }
  }
  throw new Error("Failed to parse 'path' from latest.yml.");
}

function parseRangeStart(byteRange) {
  return Number(String(byteRange).split('-', 1)[0]);
}

async function readPartialBody(response, minBytes) {
  if (!response.body || !response.body.getReader) {
    const buffer = await response.arrayBuffer();
    return {
      bytesRead: buffer.byteLength,
      cancelledEarly: false
    };
  }

  const reader = response.body.getReader();
  let bytesRead = 0;
  let cancelledEarly = false;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytesRead += chunk.value.byteLength;
      if (bytesRead >= minBytes) {
        cancelledEarly = true;
        await reader.cancel();
        break;
      }
    }
  } catch (error) {
    // keep bytes already read; caller decides whether this is acceptable
  }

  return { bytesRead, cancelledEarly };
}

async function probeRange(prefix, targetUrl, byteRange, timeoutMs, minBytes) {
  const startedAt = Date.now();
  const rangeStart = parseRangeStart(byteRange);

  try {
    const response = await fetchWithTimeout(
      buildProxiedUrl(prefix, targetUrl),
      {
        headers: {
          Range: `bytes=${byteRange}`,
          'User-Agent': 'CapCutHelper/1.0'
        }
      },
      timeoutMs
    );

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const contentRange = response.headers.get('content-range') || '';
    const body = await readPartialBody(response, minBytes);

    const rangeMatched =
      rangeStart === 0
        ? response.status === 200 || response.status === 206
        : response.status === 206 && contentRange.startsWith(`bytes ${rangeStart}-`);

    const ok =
      response.ok &&
      rangeMatched &&
      body.bytesRead >= minBytes &&
      !contentType.includes('text/html');

    return {
      ok,
      httpCode: String(response.status),
      bytesDownloaded: body.bytesRead,
      speedDownload: body.bytesRead > 0 ? Math.round((body.bytesRead * 1000) / Math.max(Date.now() - startedAt, 1)) : 0,
      elapsedMs: Date.now() - startedAt,
      error: ok
        ? null
        : `HTTP ${response.status}, bytes=${body.bytesRead}, content-range=${contentRange || '-'}, content-type=${contentType || '-'}`
    };
  } catch (error) {
    return {
      ok: false,
      httpCode: null,
      bytesDownloaded: 0,
      speedDownload: 0,
      elapsedMs: Date.now() - startedAt,
      error: String(error && error.message ? error.message : error)
    };
  }
}

async function probeCandidate(prefix, latestYmlTarget, zipTarget, options) {
  const yml = await probeLatestYml(prefix, latestYmlTarget, options.timeoutMs);
  const head = await probeRange(prefix, zipTarget, options.headRange, options.timeoutMs, options.minBytes);
  const deep = await probeRange(prefix, zipTarget, options.deepRange, options.timeoutMs, options.minBytes);

  return {
    prefix,
    ymlOk: yml.ok,
    ymlElapsedMs: yml.elapsedMs,
    ymlError: yml.error,
    headResult: head,
    deepResult: deep,
    allOk: yml.ok && head.ok && deep.ok
  };
}

function candidateSortKey(result) {
  return [
    result.allOk ? 0 : 1,
    result.deepResult.elapsedMs,
    result.headResult.elapsedMs,
    result.ymlElapsedMs
  ];
}

function sortCandidateResults(results) {
  return [...results].sort((left, right) => {
    const leftKey = candidateSortKey(left);
    const rightKey = candidateSortKey(right);

    for (let index = 0; index < leftKey.length; index += 1) {
      if (leftKey[index] !== rightKey[index]) {
        return leftKey[index] - rightKey[index];
      }
    }
    return 0;
  });
}

function buildConfigObject(currentConfig, selectedProxyPrefixes) {
  const versions =
    currentConfig && typeof currentConfig === 'object' && currentConfig.versions && typeof currentConfig.versions === 'object'
      ? currentConfig.versions
      : {};

  return {
    lastUpdated: new Date().toISOString(),
    githubProxyPrefixes: selectedProxyPrefixes,
    versions
  };
}

function buildPublicUrl(publicEndpoint, objectName) {
  return `${String(publicEndpoint).replace(/\/+$/, '')}/${String(objectName).replace(/^\/+/, '')}`;
}

async function uploadConfigToOss(configText, objectName, options) {
  if (!options.accessKeyId || !options.accessKeySecret) {
    throw new Error('Missing OSS credentials.');
  }

  const endpointHost = String(options.ossEndpoint).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const canonicalResource = `/${options.bucketName}/${objectName}`;
  const date = new Date().toUTCString();
  const contentType = 'application/json';
  const stringToSign = `PUT\n\n${contentType}\n${date}\n${canonicalResource}`;
  const signature = await hmacSha1Base64(options.accessKeySecret, stringToSign);
  const encodedObjectName = String(objectName)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const uploadUrl = `https://${options.bucketName}.${endpointHost}/${encodedObjectName}`;

  const response = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'PUT',
      headers: {
        Date: date,
        'Content-Type': contentType,
        Authorization: `OSS ${options.accessKeyId}:${signature}`
      },
      body: configText
    },
    180_000
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OSS upload failed: status=${response.status}, body=${body}`);
  }

  return buildPublicUrl(options.publicEndpoint, objectName);
}

function buildAliyunTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function buildCdnQueryString(parameters) {
  return Object.keys(parameters)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(parameters[key])}`)
    .join('&');
}

async function refreshCdnCache(publicUrl, options) {
  if (!options.accessKeyId || !options.accessKeySecret) {
    throw new Error('Missing CDN credentials.');
  }

  const parameters = {
    AccessKeyId: options.accessKeyId,
    Action: 'RefreshObjectCaches',
    Format: 'JSON',
    ObjectPath: publicUrl,
    ObjectType: 'File',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce:
      (getCryptoApi() && getCryptoApi().randomUUID && getCryptoApi().randomUUID()) ||
      `nonce-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    SignatureVersion: '1.0',
    Timestamp: buildAliyunTimestamp(),
    Version: '2018-05-10'
  };

  const canonicalized = buildCdnQueryString(parameters);
  const stringToSign = `GET&%2F&${percentEncode(canonicalized)}`;
  parameters.Signature = await hmacSha1Base64(`${options.accessKeySecret}&`, stringToSign);

  const endpoint = String(options.cdnEndpoint).replace(/\/+$/, '');
  const requestUrl = `${endpoint}/?${new URLSearchParams(parameters).toString()}`;
  const response = await fetchWithTimeout(requestUrl, { method: 'GET' }, 180_000);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`CDN refresh failed: status=${response.status}, body=${text}`);
  }

  const parsed = JSON.parse(text);
  return parsed;
}

function pickStrictCandidatePrefixes(initialResults, limit) {
  const count = Math.max(limit, Math.min(DEFAULTS.topCandidates, initialResults.length));
  return initialResults.slice(0, count).map((item) => item.prefix);
}

function safeJsonStringify(value) {
  return JSON.stringify(value, null, 2);
}

async function main({ params } = {}) {
  const runtimeParams = params || {};
  const limit = Math.max(1, Math.floor(parseNumber(pickValue(STATIC_CONFIG.limit, runtimeParams.limit, DEFAULTS.limit), DEFAULTS.limit)));
  const publish = parseBoolean(pickValue(STATIC_CONFIG.publish, runtimeParams.publish, DEFAULTS.publish), DEFAULTS.publish);
  const dryRun = parseBoolean(pickValue(STATIC_CONFIG.dryRun, runtimeParams.dryRun, DEFAULTS.dryRun), DEFAULTS.dryRun);

  const options = {
    accessKeyId: String(pickValue(STATIC_CONFIG.accessKeyId, runtimeParams.accessKeyId, '')).trim(),
    accessKeySecret: String(pickValue(STATIC_CONFIG.accessKeySecret, runtimeParams.accessKeySecret, '')).trim(),
    bucketName: String(pickValue(STATIC_CONFIG.bucketName, runtimeParams.bucketName, DEFAULTS.bucketName)).trim(),
    ossEndpoint: String(pickValue(STATIC_CONFIG.ossEndpoint, runtimeParams.ossEndpoint, DEFAULTS.ossEndpoint)).trim(),
    publicEndpoint: String(pickValue(STATIC_CONFIG.publicEndpoint, runtimeParams.publicEndpoint, DEFAULTS.publicEndpoint)).trim(),
    cdnEndpoint: String(pickValue(STATIC_CONFIG.cdnEndpoint, runtimeParams.cdnEndpoint, DEFAULTS.cdnEndpoint)).trim(),
    objectName: String(pickValue(STATIC_CONFIG.objectName, runtimeParams.objectName, DEFAULTS.objectName)).trim(),
    sourceUrl: String(pickValue(STATIC_CONFIG.sourceUrl, runtimeParams.sourceUrl, DEFAULTS.sourceUrl)).trim(),
    repo: String(pickValue(STATIC_CONFIG.repo, runtimeParams.repo, DEFAULTS.repo)).trim()
  };

  const publicUrl = buildPublicUrl(options.publicEndpoint, options.objectName);
  const currentConfigUrl = String(pickValue(STATIC_CONFIG.currentConfigUrl, runtimeParams.currentConfigUrl, publicUrl)).trim();

  try {
    let currentConfig = await fetchJsonOrNull(currentConfigUrl, DEFAULTS.initialTimeoutMs);
    if (!currentConfig || typeof currentConfig !== 'object') {
      currentConfig = { versions: {} };
    }

    let scrapedPrefixes = [];
    let scrapeError = '';
    try {
      const sourcePage = await fetchText(options.sourceUrl, DEFAULTS.initialTimeoutMs);
      scrapedPrefixes = extractCandidatePrefixes(sourcePage);
    } catch (error) {
      scrapeError = String(error && error.message ? error.message : error);
    }

    const currentPrefixes = parseStringArray(currentConfig.githubProxyPrefixes).map(normalizePrefix);
    const candidatePrefixes = parseStringArray(pickValue(STATIC_CONFIG.candidatePrefixes, runtimeParams.candidatePrefixes, [])).map(normalizePrefix);
    const fallbackPrefixes = uniquePreserveOrder(
      [
        ...parseStringArray(pickValue(STATIC_CONFIG.fallbackPrefixes, runtimeParams.fallbackPrefixes, [])).map(normalizePrefix),
        ...DEFAULT_FALLBACK_PREFIXES.map(normalizePrefix)
      ]
    );
    const allCandidates = uniquePreserveOrder([...currentPrefixes, ...candidatePrefixes, ...scrapedPrefixes, ...fallbackPrefixes]);

    if (allCandidates.length < limit) {
      throw new Error(`Only found ${allCandidates.length} proxy candidates, need at least ${limit}.`);
    }

    const latestYmlTarget = buildLatestYmlTarget(options.repo);
    let latestYmlText = null;
    for (const prefix of allCandidates) {
      const result = await probeLatestYml(prefix, latestYmlTarget, DEFAULTS.initialTimeoutMs);
      if (result.ok && result.text) {
        latestYmlText = result.text;
        break;
      }
    }

    if (!latestYmlText) {
      throw new Error('Failed to resolve latest.yml through all candidate proxies.');
    }

    const zipPath = parseLatestYmlPath(latestYmlText);
    const zipTarget = `https://github.com/${options.repo}/releases/latest/download/${zipPath}`;

    const initialResults = sortCandidateResults(
      await Promise.all(
        allCandidates.map((prefix) =>
          probeCandidate(prefix, latestYmlTarget, zipTarget, {
            headRange: DEFAULTS.initialHeadRange,
            deepRange: DEFAULTS.initialDeepRange,
            timeoutMs: DEFAULTS.initialTimeoutMs,
            minBytes: DEFAULTS.initialMinBytes
          })
        )
      )
    );

    const strictCandidatePrefixes = pickStrictCandidatePrefixes(initialResults, limit);
    const strictResults = sortCandidateResults(
      await Promise.all(
        strictCandidatePrefixes.map((prefix) =>
          probeCandidate(prefix, latestYmlTarget, zipTarget, {
            headRange: DEFAULTS.strictHeadRange,
            deepRange: DEFAULTS.strictDeepRange,
            timeoutMs: DEFAULTS.strictTimeoutMs,
            minBytes: DEFAULTS.strictMinBytes
          })
        )
      )
    );

    const selectedProxyPrefixes = strictResults.filter((item) => item.allOk).slice(0, limit).map((item) => item.prefix);
    if (selectedProxyPrefixes.length < limit) {
      throw new Error(`Only ${selectedProxyPrefixes.length} proxies passed strict validation, need ${limit}.`);
    }

    const nextConfig = buildConfigObject(currentConfig, selectedProxyPrefixes);
    const configJson = safeJsonStringify(nextConfig);

    let cdnRequestId = '';
    let message = dryRun
      ? 'Dry run completed. Config JSON generated without upload.'
      : 'Config updated without publishing.';

    if (!dryRun && publish) {
      await uploadConfigToOss(configJson, options.objectName, options);
      const refreshResult = await refreshCdnCache(publicUrl, options);
      cdnRequestId = String(refreshResult.RequestId || '');
      message = 'Config updated, uploaded to OSS, and CDN refreshed.';
    }

    return {
      success: true,
      message: scrapeError ? `${message} Source page warning: ${scrapeError}` : message,
      selectedProxyPrefixes,
      lastUpdated: nextConfig.lastUpdated,
      publicUrl,
      cdnRequestId,
      configJson,
      initialProbeResultsJson: safeJsonStringify(initialResults.slice(0, 10)),
      strictProbeResultsJson: safeJsonStringify(strictResults)
    };
  } catch (error) {
    return {
      success: false,
      message: String(error && error.message ? error.message : error),
      selectedProxyPrefixes: [],
      lastUpdated: '',
      publicUrl,
      cdnRequestId: '',
      configJson: '',
      initialProbeResultsJson: '[]',
      strictProbeResultsJson: '[]'
    };
  }
}

if (typeof module !== 'undefined') {
  module.exports = { main };
}
