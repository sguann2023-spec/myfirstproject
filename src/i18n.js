import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';
import { app } from 'electron';

// 在渲染进程中，我们需要通过remote获取app对象
// 注意：在Electron 12+中，remote模块已被移除，需要使用contextBridge或preload脚本
const electron = window.require('electron');
const Store = window.require('electron-store'); // 引入 electron-store
const store = new Store(); 
const isDev = process.env.NODE_ENV === 'development';

// 核心修正：获取初始语言
const getInitialLanguage = () => {
  const savedLang = store.get('language'); // 从 store 中读取保存的语言
  if (savedLang) {
    return savedLang;
  }
  return 'zh'; // 默认回退语言
};

// 确定本地化文件的路径
let localesPath;

if (isDev) {
  // 开发环境下的路径
  localesPath = path.join(__dirname, '../locales');
} else {
  // 生产环境下的路径（打包后）
  localesPath = path.join(electron.remote ? electron.remote.app.getAppPath() : process.resourcesPath, 'locales');
}

i18n
  .use(Backend)
  .use(initReactI18next)
  .init({
    backend: {
      loadPath: path.join(localesPath, '{{lng}}/{{ns}}.json')
    },
    // 修正：使用获取到的初始语言
    lng: getInitialLanguage(), 
    fallbackLng: 'zh',
    debug: isDev,
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });

export default i18n;