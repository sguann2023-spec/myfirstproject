# Coze 工作流版本

这个文件对应的代码在：

- [coze_refresh_app_upgrade_config.js](file:///Users/sunguannan/CapCutHelper/config/coze_refresh_app_upgrade_config.js)

用途：
- 探测 GitHub 代理
- 真实拉取 `latest.yml`
- 真实做 ZIP Range 下载校验
- 生成新的 `app-upgrade-config.json`
- 直接上传到 OSS
- 直接刷新阿里云 CDN

建议在扣子代码节点里配置这些输入：

- `accessKeyId`：阿里云 AccessKeyId
- `accessKeySecret`：阿里云 AccessKeySecret
- `bucketName`：默认 `oss-hangzhou-mp4`
- `ossEndpoint`：默认 `oss-cn-hangzhou.aliyuncs.com`
- `publicEndpoint`：默认 `https://player.install-ai-guider.top`
- `cdnEndpoint`：默认 `https://cdn.aliyuncs.com`
- `objectName`：默认 `client/config/app-upgrade-config.json`
- `sourceUrl`：默认 `https://github.akams.cn/`
- `repo`：默认 `sun-guannan/CapCutMaker`
- `limit`：默认 `5`
- `publish`：默认 `true`
- `dryRun`：默认 `false`
- `currentConfigUrl`：可选，默认 `{publicEndpoint}/{objectName}`
- `candidatePrefixes`：可选，补充候选代理，支持 JSON 数组或逗号/换行分隔
- `fallbackPrefixes`：可选，补充兜底代理，支持 JSON 数组或逗号/换行分隔

建议输出：

- `success`：布尔
- `message`：字符串
- `selectedProxyPrefixes`：字符串数组
- `lastUpdated`：字符串
- `publicUrl`：字符串
- `cdnRequestId`：字符串
- `configJson`：字符串
- `initialProbeResultsJson`：字符串
- `strictProbeResultsJson`：字符串

建议使用方式：

1. 先把节点设成 `dryRun=true`，确认输出的 5 个代理合理
2. 再改成 `dryRun=false` 且 `publish=true`
3. 最后把工作流挂到定时触发

注意：
- 这份代码依赖运行时支持 `fetch` 和 `crypto.subtle`
- 如果扣子代码节点禁用了某些标准能力，需要改成 HTTP 节点 + 代码节点拆分
- OSS 上传和 CDN 刷新都在代码里做了签名，不再依赖本地 Python 脚本
