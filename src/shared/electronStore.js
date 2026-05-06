// 使用全局单例，避免在渲染进程多处 new Store()
const Store = window.require('electron-store');

if (!globalThis.__ELECTRON_STORE__) {
  globalThis.__ELECTRON_STORE__ = new Store({ name: 'vectcut', watch: true });
}

export const electronStore = globalThis.__ELECTRON_STORE__;
