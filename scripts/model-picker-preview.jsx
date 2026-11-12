// 真实浏览器验证入口：挂载真实 Composer，仅验证模型下拉渲染（不接 Electron 后端）。
import React from 'react';
import { createRoot } from 'react-dom/client';

const noop = () => {};

// 通用空值桩：任意属性/调用都返回安全空值，供未手工覆盖的 IPC 命名空间兜底。
const makeEmptyStub = () => {
  const fn = () => Promise.resolve(empty);
  const empty = new Proxy(fn, {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === Symbol.iterator) return () => ({ next: () => ({ done: true, value: undefined }) });
      if (prop === 'then') return undefined;
      if (prop === 'length') return 0;
      if (['map', 'filter', 'forEach', 'slice', 'concat', 'flatMap'].includes(prop)) return () => [];
      if (['includes', 'some', 'every', 'startsWith', 'endsWith'].includes(prop)) return () => false;
      if (prop === 'find') return () => undefined;
      if (prop === 'join') return () => '';
      if (prop === 'split') return () => [];
      if (['trim', 'toLowerCase', 'toUpperCase', 'replace', 'toString', 'toFixed'].includes(prop)) return () => '';
      if (prop === 'current') return null;
      return empty;
    },
    apply: () => Promise.resolve(empty),
    construct: () => empty,
  });
  return empty;
};
const emptyStub = makeEmptyStub();
const withFallback = (special) => new Proxy(special, {
  get: (target, prop) => (prop in target ? target[prop] : emptyStub),
});

class ElectronStoreStub {
  constructor() { this.data = new Map(); }
  get(key) { return this.data.has(key) ? this.data.get(key) : null; }
  set(key, value) { this.data.set(key, value); }
  has(key) { return this.data.has(key); }
  delete(key) { this.data.delete(key); }
  on() { return noop; }
}

window.require = (name) => {
  if (name === 'electron') {
    return {
      shell: { openExternal: async () => {}, openPath: async () => '' },
      ipcRenderer: {
        on: noop, once: noop, addListener: noop, send: noop,
        sendSync: () => null, invoke: async () => null,
        removeListener: noop, removeAllListeners: noop,
      },
      webFrame: { setZoomFactor: noop, getZoomFactor: () => 1 },
    };
  }
  if (name === 'electron-store') return ElectronStoreStub;
  if (name === 'child_process') return { execFile: noop };
  if (name === 'ffprobe-static') return { path: '' };
  return {};
};

window.api = withFallback({
  apiServer: {
    onReady: () => noop,
    getStatus: async () => ({ running: false, config: { enabled: false, host: '127.0.0.1', port: 0, apiKey: '' } }),
  },
  skill: {
    list: async () => ({ success: true, data: [] }),
    readSkillFile: async () => ({ success: false, data: null }),
    installFromDirectory: async () => ({ success: false }),
  },
  fs: {
    exists: async () => false,
    readText: async () => '',
    readDir: async () => [],
  },
  getAppInfo: async () => ({ version: '0.0.0-harness', launchId: 'model-picker-harness' }),
});
window.electronAPI = withFallback({
  customChatModels: {
    listProviders: async () => [],
    saveProviders: async (items) => items,
  },
});

// 与后端下发同构的模型列表（read_image 保持下发，仅前端不再展示标签）。
const modelOptions = [
  { value: 'qwen3.8-max', label: 'Qwen3.8-Max', read_image: true, pricing: { price_multiplier_text: '4.75' } },
  { value: 'glm-5.3', label: 'GLM-5.3', read_image: false, pricing: { price_multiplier_text: '4.38' } },
  { value: 'kimi-k3', label: 'Kimi-K3', read_image: true, badges: ['限时优惠'], pricing: { price_multiplier_text: '8.21' } },
  { value: 'claude-fable-5.2', label: 'Claude-Fable-5.2', read_image: true, badges: ['官价5.8折', '热度3'], pricing: { price_multiplier_text: '10' } },
  { value: 'claude-opus-5.5', label: 'Claude-Opus-5.5', read_image: true, pricing: { price_multiplier_text: '5' } },
  { value: 'claude-haiku-5.5', label: 'Claude-Haiku-5.5', read_image: true, pricing: { price_multiplier_text: '0.13' } },
  {
    value: 'gpt-6.1-terra', label: 'GPT-6.1-Terra', read_image: true,
    description: '介于Luna和Sol之间的模型，水平无限接近Sol,同时价格只有Sol的一半',
    badges: ['官价3.2折', '热度1'],
    pricing: { price_multiplier_text: '0.75' },
    thinking_levels: ['low', 'medium', 'high', 'max'], thinking_default: 'max',
  },
  { value: 'gpt-6-astra', label: 'GPT-6-Astra', read_image: true, pricing: { price_multiplier_text: '6.11' } },
  { value: 'gpt-6-luna', label: 'GPT-6-Luna', read_image: true, pricing: { price_multiplier_text: '0.23' } },
  { value: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', read_image: true, badges: ['官价3.2折', '热度2'], pricing: { price_multiplier_text: '1.5' } },
];

const boot = async (attempt = 0) => {
  try {
    const [{ default: Composer }, { default: store }, { Provider }] = await Promise.all([
      import('../src/components/Chat/Composer/Composer.js'),
      import('../src/renderer/src/store/index.ts'),
      import('react-redux'),
    ]);
    const Harness = () => {
      const [model, setModel] = React.useState('gpt-6.1-terra');
      const [input, setInput] = React.useState('');
      return (
        <Provider store={store}>
          <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
            <Composer
              model={model}
              modelOptions={modelOptions}
              onModelChange={setModel}
              input={input}
              setInput={setInput}
              handleSend={noop}
              handleStop={noop}
              formatModelDisplayName={(text) => text}
            />
          </div>
        </Provider>
      );
    };
    createRoot(document.getElementById('root')).render(<Harness />);
  } catch (error) {
    // Vite 冷启动预构建可能使首次动态导入失效，重试几次再判定失败。
    if (attempt < 3) {
      setTimeout(() => boot(attempt + 1), 1500);
      return;
    }
    console.error('harness boot failed', error);
    document.getElementById('root').textContent = `harness boot failed: ${error?.message || error}`;
  }
};
boot();