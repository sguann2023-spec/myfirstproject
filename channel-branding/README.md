# Channel Branding

统一管理渠道品牌配置。

## 目录说明

- `brand-config.json`
  - 渠道文案、邀请码、构建产物命名、运行时资源标识
- `index.cjs`
  - 给 `electron-builder.config.cjs`、`electron.vite.config.mjs` 用的 Node 侧读取方法
- `runtime.js`
  - 给前端页面和 HTTP Client 用的运行时读取方法

## 新增渠道时怎么改

1. 在 `brand-config.json` 里新增一个渠道 key
2. 如果这个渠道有新的图片资源：
   - 先把资源放到 `public/` 或 `build-resources/brands/<channel>/`
   - 再到 `runtime.js` 里的 `BRAND_ASSET_MAP` 补上映射
3. 构建相关字段放到 `build`
4. 页面标题等文案放到 `ui`
5. 需要透传给后端的邀请码放到 `inviteCode`
