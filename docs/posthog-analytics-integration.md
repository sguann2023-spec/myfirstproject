# PostHog 接入方案

## 1. 现状概览

项目当前通过 `src/shared/analytics.js` 直接调用 PostHog HTTP API，没有引入 `posthog-js` SDK。

当前链路如下：

1. 业务代码调用 `trackEvent(event, properties)`。
2. 从 `electronStore.user.id` 获取用户标识，作为 PostHog 的 `distinct_id`。
3. 事件写入 Electron Store 的 `analytics.posthog.queue` 队列。
4. 队列达到 10 条后，取前 10 条调用 `POST {POSTHOG_HOST}/batch/`。
5. 请求体包含 `api_key` 和 `batch`；失败时按 1 秒、5 秒、15 秒重试。

当前已接入的事件主要位于 `src/components/Chat/Composer/ToolArea/index.js`，包括：

- `一级_新草稿_展示`
- `一级_新草稿_点击`
- `二级_{工具名称}_点击`
- `{工具名称}_点击`

`src/renderer/src/utils/analytics.ts` 已预留 Token 用量统计入口，但 `trackTokenUsage` 当前只完成参数解析，没有真正发送事件。

## 2. 配置方式

通过构建环境变量配置：

```env
VITE_POSTHOG_API_KEY=phc_xxx
VITE_POSTHOG_HOST=https://app.posthog.com
```

代码默认 Host 为 `https://app.posthog.com`，并会移除末尾 `/`。自建 PostHog 时只需替换 `VITE_POSTHOG_HOST`。

建议：

- 不把真实 API Key 提交到 Git 仓库；本地使用 `.env.local`，CI/CD 使用密钥变量注入。
- PostHog 的 project API key 本身通常允许客户端使用，但仍应避免在日志、文档和截图中暴露。
- 发布前确认生产环境确实注入了 Key；未配置时系统会关闭统计，不影响主流程。

## 3. 事件数据结构

单条事件建议统一为以下结构：

```js
{
  event: '一级_新草稿_点击',
  distinct_id: 'user-123',
  properties: {
    user_id: 'user-123',
    app_version: '1.0.0',
    platform: 'MacIntel',
    source: 'composer_tool_area',
    tool_name: 'xxx'
  },
  timestamp: '2026-09-19T08:00:00.000Z'
}
```

现有实现自动补充：

- `user_id`：当前登录用户 ID
- `app_version`：`VITE_APP_VERSION`
- `platform`：`navigator.platform`

业务属性应遵循以下原则：

- 只传可用于产品分析的枚举、计数和版本信息。
- 不传聊天正文、提示词、文件内容、Token、密码、访问令牌等敏感信息。
- 事件名和属性名保持稳定，避免直接使用自由输入文本作为事件名。

## 4. 推荐事件模型

建议将事件名从展示文案中抽离，采用稳定的英文或固定中文标识；展示文案放在属性中，避免 UI 改名导致数据断裂。

| 事件 | 触发时机 | 建议属性 |
| --- | --- | --- |
| `draft_tool_area_viewed` | 新草稿工具区展示 | `source` |
| `draft_created` | 新草稿创建成功 | `source`, `draft_type` |
| `draft_tool_clicked` | 二级工具点击 | `tool_id`, `tool_label`, `source` |
| `chat_request_started` | 聊天请求发起 | `source`, `model_provider`, `model_id` |
| `chat_request_completed` | 请求成功完成 | `source`, `model_provider`, `model_id`, `duration_ms` |
| `chat_request_failed` | 请求失败 | `source`, `model_provider`, `model_id`, `error_code` |
| `llm_token_usage` | 获得模型用量后 | `source`, `model_provider`, `model_id`, `input_tokens`, `output_tokens`, `total_tokens` |

Token 用量事件应只记录聚合后的数字，不记录请求内容。`trackTokenUsage` 需要在所有聊天和 Agent 分支统一调用，避免同一请求重复上报。

## 5. 队列、重试与退出流程

当前实现的优点是网络失败时事件不会立即丢失，并且 `electronStore` 能跨应用重启保存队列。需要补齐以下边界：

### 5.1 应用退出前强制刷新

当前模块没有导出 `flushQueue`，也没有在 `before-quit` / `will-quit` 中触发强制发送。建议：

1. 导出 `flushAnalytics({ keepalive: true })`。
2. 在应用退出前触发一次刷新。
3. 不阻塞退出超过一个很短的超时；发送失败时保留队列，下一次启动继续发送。

### 5.2 队列大小控制

当前已增加基础保护：

- 单次批量发送仍为 10 条。
- 队列最大长度为 1,000 条；超过上限时丢弃最旧事件，并记录本地告警。
- 单条事件最大约 32 KB；超过限制或无法序列化时直接丢弃，并记录本地告警。

最大队列长度是异常保护，不改变“达到 10 条就按每批 10 条发送”的逻辑。正常网络下队列会持续被清空；只有网络长期不可用时才会触发上限。

### 5.3 重试策略

当前上报失败后会按 1 秒、5 秒、15 秒间隔重试，最多重试 3 次。建议后续区分：

- `4xx`：通常是参数或鉴权问题，不重复重试。
- `408`、`429`、`5xx`、网络错误：指数退避并增加随机抖动。
- 持续失败：保留队列，避免每次启动立即高频请求。

## 6. 隐私与用户控制

接入前应明确产品隐私策略：

- 在隐私政策中说明采集目的、数据类型、保存期限和第三方服务商。
- 提供“关闭使用数据统计”的配置，并在 `trackEvent` 入口统一拦截。
- 注销或切换账号时清理或隔离旧账号未发送事件，避免事件归属错误。
- 不将邮箱、手机号等直接身份信息作为 `distinct_id`；优先使用内部用户 ID。
- 对开发、测试、生产项目使用不同的 PostHog project，避免污染生产数据。

## 7. 验证清单

发布前至少验证：

- 无 API Key 时不发送请求，主功能正常。
- 无登录用户时不产生匿名事件，符合当前设计预期。
- 队列不足 10 条时可正常落盘；达到 10 条时能发送并删除已确认成功的批次。
- 网络断开后事件保留，恢复网络后能成功补发。
- PostHog 返回 4xx、429、5xx 时行为符合重试策略。
- 应用退出前队列能按预期刷新。
- 账号切换后新事件使用新用户 ID。
- 事件属性中没有聊天正文、密钥或其他敏感数据。
- Token 用量事件在 chat 和 agent 两类调用路径各只上报一次。

## 8. 实施顺序

建议按以下顺序落地：

1. 统一事件命名和属性字典，保留旧事件名的兼容映射。
2. 完成 `trackTokenUsage` 的真实上报，并补充去重策略。
3. 导出并接入退出前 flush，增加队列上限和失败分类。
4. 增加统计开关、账号切换清理和隐私说明。
5. 在 PostHog 中建立漏斗、留存、错误率和 Token 消耗看板。
6. 加入单元测试和网络异常测试，再进行灰度发布。

## 9. 相关代码

- `src/shared/analytics.js`：PostHog 配置、事件入队、批量发送和重试。
- `src/renderer/src/utils/analytics.ts`：Token 用量统计入口。
- `src/components/Chat/Composer/ToolArea/index.js`：当前业务事件调用点。
- `.env.local`：本地环境变量配置文件，不应提交真实密钥。
