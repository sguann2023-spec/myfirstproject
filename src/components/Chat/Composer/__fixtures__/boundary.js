// Install BEFORE dynamically importing any actual components. Browser-only, no Node access.
import { fixtureVoice } from './api-mocks.js';

if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(location.hostname)) {
  throw new Error('Composer fixture can run only on a local DEV/TEST server.');
}

const blocked = () => { throw new Error('DEV fixture: network, native access and persistence are disabled.'); };
const reject = async () => blocked();
const noop = () => {};
const storage = () => {
  const values = new Map([['chat-panel:selected-voice-library-item', JSON.stringify(fixtureVoice)]]);
  return Object.freeze({ getItem: (key) => values.get(String(key)) ?? null, setItem: noop, removeItem: noop, clear: noop, key: (index) => [...values.keys()][index] ?? null, get length() { return values.size; } });
};
// Never read or modify real browser/application storage, even on repeated visits.
Object.defineProperty(window, 'localStorage', { value: storage(), configurable: false });
Object.defineProperty(window, 'sessionStorage', { value: storage(), configurable: false });
Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: false });

class ReadonlyStore {
  get(key, fallback) { return key === 'user' ? {} : fallback; }
  has() { return false; }
  set() {} delete() {} clear() {}
  onDidChange() { return noop; }
  onDidAnyChange() { return noop; }
}
const ipc = Object.freeze({ on: () => noop, once: () => noop, removeListener: noop, removeAllListeners: noop, send: noop, sendSync: () => null, invoke: async () => null });
const api = Object.freeze({
  file: Object.freeze({ select: async () => [], getPathForFile: () => '' }),
  fs: Object.freeze({ read: reject, write: reject, exists: async () => false }),
  openInternalWebsite: noop,
});
Object.defineProperty(window, 'api', { value: api, configurable: false });
Object.defineProperty(window, 'ipc', { value: ipc, configurable: false });
Object.defineProperty(window, 'electron', { value: { ipcRenderer: ipc, process: { platform: 'browser', env: { NODE_ENV: 'test' } } }, configurable: false });
Object.defineProperty(window, 'require', { configurable: false, value: (name) => {
  if (name === 'electron-store') return ReadonlyStore;
  if (name === 'electron') return { ipcRenderer: ipc, shell: { openExternal: noop, openPath: async () => '' } };
  if (name === 'path') return { join: (...parts) => parts.filter(Boolean).join('/'), basename: (path) => String(path).split('/').pop(), extname: (path) => String(path).match(/\.[^.]+$/)?.[0] || '' };
  if (name === 'fs') return { existsSync: () => false, readdirSync: () => [], readFileSync: blocked, writeFileSync: blocked, statSync: blocked };
  return blocked();
} });

// CSP also blocks external images/media and HTTP connections; only Vite HMR is allowed.
window.fetch = reject;
window.XMLHttpRequest = class { constructor() { blocked(); } };
window.open = () => null;
if (navigator.sendBeacon) Object.defineProperty(navigator, 'sendBeacon', { value: () => false });
if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: reject });
for (const name of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
  if (name in window) Object.defineProperty(window, name, { value: reject });
}
const cancel = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
document.addEventListener('submit', cancel, true);
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('a[href], input[type="file"]')) cancel(event);
}, true);
for (const name of ['drop', 'paste']) document.addEventListener(name, (event) => {
  if ((event.dataTransfer || event.clipboardData)?.files?.length) cancel(event);
}, true);
