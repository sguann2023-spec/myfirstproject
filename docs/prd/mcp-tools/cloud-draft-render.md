# 预渲染 MCP：短片段草稿效果验收 PRD

- **状态**：设计中
- **目录**：`docs/prd/mcp-tools/`
- **目标工具**：`render_draft`
- **工具显示名**：中文“预渲染”，英文“Pre-render”，通过 i18n 映射，不显示内部 MCP 名称。
- **建议 MCP Server**：`draft-render`
- **适用场景**：复刻视频时快速验证草稿的真实画面效果，以及在继续编辑前检查 5 秒以内的小片段。

## 1. 背景与目标

当前通过草稿 JSON 或时间线结构只能检查数据是否正确，无法确认素材、动画、字幕、转场和画布组合后的真实视觉效果。预渲染 MCP 调用 VectCut 预渲染接口，把一个已经存在的云端草稿渲染成 MP4，供 Agent 做短片段验收。

该 MCP 是**验证工具**，不是长视频导出工具：

- 默认只面向 5 秒以内的短片段。
- 素材会被云端读取或上传，长视频和重操作不适合该工具。
- 不提供本地渲染能力。
- 不接受 draft JSON 作为渲染输入。
- 不允许用户指定输出路径。
- 生成的视频是临时产物，不作为工作空间文件保存。

## 2. 接口范围

### 2.1 生成任务

```http
POST https://open.vectcut.com/cut_jianying/generate_video
Authorization: Bearer <token>
Content-Type: application/json
```

请求体：

```json
{
  "draft_id": "dfd_cat_...",
  "resolution": "720P",
  "framerate": "24"
}
```

其中：

- `draft_id` 必填，且是唯一的草稿输入。
- `resolution` 可选，默认 `720P`。
- `framerate` 可选，默认 `24`。
- 不支持 `draft_json`、`draftJson`、JSON 字符串、JSON 文件路径或本地草稿内容作为 `generate_video` 的替代输入。

成功响应包含 `output.task_id`。

### 2.2 查询任务

```http
POST https://open.vectcut.com/cut_jianying/task_status
Authorization: Bearer <token>
Content-Type: application/json
```

请求体：

```json
{
  "task_id": "..."
}
```

成功状态示例：

```json
{
  "success": true,
  "output": {
    "success": true,
    "status": "SUCCESS",
    "progress": null,
    "result": "https://...mp4",
    "task_id": "..."
  }
}
```

MCP 轮询直到 `SUCCESS`、`FAILURE` 或取消。外层 `success` 表示查询接口是否成功；内层 `output.success` 在处理中也为 `false`，不能据此认定任务失败。

- `PENDING`、`PROCESSING`、`UPLOADING`、`DOWNLOADING`、`EXPORTING`：继续轮询。
- `SUCCESS`：任务成功，以此状态为准，并读取 `output.result`。
- `FAILURE`：任务失败，终止轮询并保留已知积分消耗。

轮询间隔、超时和取消行为沿用 `video-understand` 的 MCP progress/AbortSignal 模式。

## 3. 工具契约

### 3.1 工具名

```text
render_draft
```

完整命名由现有共享命名规则生成，预期形如：

```text
mcp__vectcut__draft-render__render_draft
```

### 3.2 输入

```json
{
  "draftId": "dfd_cat_...",
  "draft_id": "dfd_cat_...",
  "resolution": "720P",
  "framerate": "24"
}
```

规则：

- `draftId` / `draft_id` 二选一，必填。
- 两者同时传入且不一致时直接报参数错误。
- **不提供 `outputPath` / `output_path`。**
- **不提供 `draftJsonPath` / `draft_json_path`。**
- **不提供 draft JSON 内联参数。**
- 工具描述以“预渲染”开头，同时包含英文 `Pre-render / preview`，让工具搜索能直接匹配验收需求。
- 描述明确列出：字幕验收、动画时序、轨道层叠、声音效果、声音大小、字体效果、转场效果、组合画面；这些需求词应置于描述前部。
- 保留“优先轻量预览、最后才用草稿渲染”的顺序，但不使用“真实收费、非常耗时”作为劝退描述。实际计费信息仍按原契约返回和展示。
- 该工具只接受云端 `draft_id`，单次验证草稿不超过 5 秒。能力限制用于指导 Agent 准备测试草稿，不是放弃渲染验收的理由。
- 当工作草稿过长或素材不满足限制时，Agent 应创建独立的云端测试草稿，仅复现需要验收的片段，保留相关字幕、字体、动画时序、轨道层叠、转场及声音设置，将时间段平移到测试草稿内，总时长不超过 5 秒；不得为了验收而裁短或破坏工作草稿。
- 测试素材必须为云端可访问的 HTTP(S) URL，视频/音频完整源时长不超过 20 秒、图片不超过 20 MiB。必要时先准备符合限制的短源素材；只缩短时间线上的使用区间不能满足完整源时长限制。
- 创建测试草稿由 Agent 编排现有草稿编辑工具完成，`render_draft` 本身不自动复制、裁剪或修改草稿，也不放宽内部校验。

### 3.3 输出

MCP 的正常结果只返回简短的机器可读状态，例如：

```json
{
  "provider": "vectcut",
  "action": "render_draft",
  "draft_id": "dfd_cat_...",
  "task_id": "...",
  "status": "SUCCESS",
  "video_url": "https://.../result.mp4",
  "billing": {
    "total_consumed_points": 12.5
  }
}
```

`billing.total_consumed_points` 是本次预渲染实际消耗的点数。已确认 `task_status` 的 `output.billing` 可以直接是数字，例如 `6.0`；MCP 必须将其归一化为 `{ "total_consumed_points": 6, "currency": "points" }`，数值 `0` 同样有效。如果云端没有返回计费字段，则返回 `billing: null`，不得由 AI 估算或补填。

首次取得 `SUCCESS` 和可用视频 URL 后，若计费仍未知，允许每 2 秒补查同一个 `task_id` 的 `task_status`，最多 5 次、总等待不超过 10 秒（含 HTTP 响应及响应体读取），并受全局 5 分钟期限约束；不得重新提交 `generate_video`。取得有效计费值（包括 `0`）后立即结束，按任务快照替换而非累加。补查失败、状态回退/异常或计费等待超时均保留原始 `SUCCESS` 和视频 URL；未知计费仍为 `null`。用户取消仍沿用现有 `CANCELLED` 语义。

失败结果必须使用 MCP `isError: true`，并返回可执行的原因，例如：

```text
草稿 dfd_cat_... 包含本地素材，无法进行预渲染：materials.video[0].path = /Users/.../a.mp4。请先将该素材替换为云端可访问素材后重试。
```

原则：

- 不返回工作空间文件链接。
- 不返回草稿 JSON 文件路径。
- 不返回完整 `query_script` 响应。
- 不把云端 MP4 URL作为用户可见的持久产物；该 URL 只在 MCP 内部用于下载。
- 如果 Agent 后续必须读取视频，应通过 MCP 内部的临时句柄/内部路径完成，不把这个路径作为普通用户产物展示。

## 4. 草稿素材检查

### 4.1 检查责任与时机

素材检查和时长检查**完全由 `render_draft` MCP tool 内部实现**，不是由 AI 根据工具返回的草稿 JSON 再检查，也不是把检查任务拆成另一个需要 Agent 编排的 MCP 调用。

`render_draft` 的内部流程固定为：

```text
接收 draft_id
  -> MCP 内部请求 query_script
  -> MCP 内部解析 JSON
  -> MCP 内部匹配本地素材和时长
  -> 检查通过后才请求 generate_video
  -> MCP 内部轮询 task_status
  -> 返回精简结果
```

调用 `generate_video` **之前**必须完成检查。发现问题时，工具直接返回 `isError: true` 和简短、可执行的错误原因；不得把完整草稿 JSON、素材清单或待检查内容返回给 AI。

### 4.2 查询来源与内存解析

实现层复用 `draft-management` 已有的认证和 `query_script` API 请求逻辑，但不能机械调用当前公开的 `query_script` MCP tool，因为它会把完整脚本保存到工作空间根目录。

应抽出一个供 `render_draft` 内部使用的查询函数，或者给 `query_script` 增加内部内存模式：

- 请求 `POST /cut_jianying/query_script`。
- 只在 MCP 进程内存中读取和解析 `output`。
- 不调用 `persistWorkspaceJsonArtifact`。
- 不在工作空间根目录创建 `<draft_id>.json`。
- 不把完整脚本塞入任何 MCP `content`、`structuredContent` 或工具进度消息。
- 该内部函数返回给 `render_draft` 的只是解析所需的内部对象，不暴露给 Agent。

### 4.3 本地素材判定

素材匹配由 `render_draft` 内部代码直接递归扫描脚本对象完成，不要求模型理解脚本结构。脚本中的所有素材引用都要扫描，至少覆盖图片、视频、音频、贴纸和其他带路径/URL的素材类型。以下情况视为本地素材并拒绝渲染：

- `path`、`file_path`、`local_path` 等字段为绝对本地路径。
- `file://` URL 指向本地文件。
- 素材字段只有本地文件名或相对路径，且无法证明是云端 URL。
- 素材 URL 是 `http(s)` 以外的本地 URI。

以下素材可继续渲染：

- `http://` 或 `https://` 远程 URL。
- 已明确表示为云端可访问对象的 URL。

拒绝时必须列出**素材类型、脚本字段位置和脱敏后的本地引用**，例如：

```text
包含本地素材，无法预渲染：
- video: materials.videos[0].path = /Users/.../clip.mp4
- audio: materials.audios[1].file_path = file:///Users/.../voice.wav
```

路径展示应脱敏，避免把用户本地目录完整暴露给模型或用户。

### 4.4 素材时长与图片大小限制

以下检查全部在 `render_draft` 内部、提交 `generate_video` 之前完成：

- 视频素材的源文件总时长不得超过 20 秒。
- 音频素材的源文件总时长不得超过 20 秒。
- 图片源文件大小不得超过 20 MB（20 × 1024 × 1024 字节）。
- 这里检查的是源素材，不是素材裁剪后在草稿中的可见时长；即使只使用长视频中的一小段，源素材超过限制也拒绝。
- 优先使用可靠的素材元数据；缺少元数据时，在工具内部探测远程素材，不生成本地中间文件。不能确认时返回明确错误，不让 AI 猜测。
- 错误需指出素材类型、脚本字段位置及超限值，不提交预渲染任务。

### 4.5 草稿时长判定

时长匹配同样在 `render_draft` MCP tool 内部完成，从已在内存中的脚本对象读取微秒值并换算成秒：

```text
duration_s = duration / 1_000_000
```

- `duration_s = 0`：立即拒绝空草稿，不探测素材、不发起渲染。
- `0 < duration_s <= 5`：允许继续检查素材并提交。
- `duration_s > 5`：直接拒绝，并说明该工具只适合 5 秒以内的验证片段。
- 无法读取时长：直接拒绝并说明无法安全确认片段长度；不应盲目提交长任务。

## 5. 临时产物与可见性设计

### 5.1 结论

**不要使用工作空间 `.tmp` 目录作为首选方案，也不要把 MP4 放到 `tool-result` 目录。**

推荐分层如下：

| 内容 | 推荐位置 | 是否返回给用户 |
|---|---|---|
| 查询到的草稿 JSON | MCP 内存 | 否 |
| 云端素材下载/处理中间文件 | 不在本地创建 | 否 |
| 预渲染得到的 MP4 | 不下载到本地；只保留云端返回值用于当前工具结果 | 由 pi-agent 按工具结果处理 |
| MCP 调试/审计 JSON | 不生成 | 否 |
| pi-agent 大型工具结果保留文件 | `.tool-results/<uuid>.json`，由现有桥接层自动管理 | 不额外管理 |

原因：

1. `.tmp` 只是隐藏目录命名，不是本需求要依赖的 pi-agent 原生工具结果机制。
2. `.capcut/tool-results` 是持久诊断 artifact 目录，不适合 MP4 等临时二进制。
3. `.tool-results` 是当前桥接层为超大 JSON 工具结果自动保存的备份目录，不是渲染输出目录；MCP 不主动写入或清理它。
4. 为了完全依赖 pi-agent，本工具不创建任何本地中间文件，直接把精简的云端结果交给 pi-agent。

### 5.2 采用 pi-agent 原生工具结果能力

本方案不新增 `.tmp` 文件夹、不新增 session 临时目录管理器，也不实现自定义的文件清理生命周期。预渲染 MCP 完全遵守 pi-agent 当前工具结果约定：

1. 草稿脚本通过 `query_script` 查询后只在 MCP 内存中解析，不写工作空间文件。
2. 预渲染 API 返回 MP4 URL 后，不在本地下载 MP4，不生成 `outputPath`，不把视频复制到工作空间。
3. MCP 只返回精简的 JSON 状态和云端结果引用；不返回草稿全文、素材清单、下载文件路径或额外诊断文档。
4. pi-agent/当前桥接层按自己的工具结果策略处理返回值；MCP 不创建、不移动、不清理 `.tool-results` 文件。
5. 如果 pi-agent 为大结果自动保留 JSON 文件，该文件属于 pi-agent 的工具结果机制，不属于本 MCP 的用户产物。

### 5.3 能力边界与明确取舍

当前仓库检查结果：

- pi-agent 的 `tool-result` 是工具调用结果事件，不是一个由 MCP 指定的临时文件 API。
- 当前桥接层的 `.tool-results/<uuid>.json` 只在结果超过约 16 KiB 时自动保存 JSON 备份。
- 当前没有确认到 pi-agent 会在每个 session 结束后自动清空 `.tool-results` 的机制。
- 因此本 MCP 不把 MP4、本地草稿 JSON或其他中间文件写入 `.tool-results`，也不自行实现清理。

第一版不产生本地中间文件、不下载 MP4、不返回工作空间路径。云端 MP4 URL 作为精简工具结果交给 pi-agent，后续视频理解工具可以直接消费该远程 URL，无需跨工具本地文件句柄。工具结果仍可能由 pi-agent 保存在对话历史中，因此这里的“不可见”指不产生用户工作空间文件、专用卡片不展示中间文档，不承诺工具结果永不被用户查看或 session 结束后自动删除。

### 5.4 工具结果约束

- MCP `content` 只包含短 JSON。
- 不放入完整 `query_script` 响应。
- 不放入 draft JSON。
- 不放入 MP4 二进制或 base64。
- 不放入 `outputPath` / `output_path`。
- 不调用 `persistWorkspaceJsonArtifact`。
- 不写 `.tmp`、`.capcut/tool-results` 或 `.tool-results`。
- 不要求 AI 主动删除文件。


## 6. `pi-agent` / `tool-result` 的正确用法

这里的 `tool-result` 有两层含义，不能混用：

1. **协议事件 `tool-result`**：表示工具调用完成的消息事件，不是文件存储目录。
2. **`.tool-results/` 目录**：桥接层在工具结果超过约 16 KiB 时自动保存 JSON 结果的备份位置。

因此：

- MCP 应返回短文本 JSON，只包含任务状态、任务 ID 和是否成功。
- 不要把草稿完整 JSON、完整远端响应或 MP4 二进制放进 MCP `content`。
- 不要把 `.tool-results/` 当作 MP4 输出目录。
- 不要返回 `outputPath`，避免 Agent 或 UI 把产物当成用户文件。
- 工具内部不下载 MP4；成功结果只报告云端任务完成，并按 pi-agent 的工具结果协议返回必要的云端结果引用。

## 7. 前端展示与积分

需要为 `render_draft` 增加专用工具卡片，不能依赖通用 MCP JSON 卡片展示积分。

参考 `video-understand.ts` 的计费链路和 `VideoUnderstandeToolRenderer`：

- MCP 返回标准化 `billing.total_consumed_points`。
- renderer 从 `response` / `responseRaw` 中提取该字段，兼容工具结果被包装或截断的情况。
- 使用现有积分图标和计费 badge 样式，在工具卡片标题区域展示：
  - `本次渲染消耗 12.50 点`
  - 没有计费值时不显示 badge，正文可显示“积分消耗：未知”。
- 卡片正文展示草稿 ID、渲染状态、任务 ID和积分消耗；不展示本地路径、草稿全文或隐藏文件路径。
- 云端 MP4 URL只用于工具内部结果字段或后续 pi-agent 能力，不直接渲染为工作空间文件链接。
- 云端计费字段的具体位置以实际接口响应为准；文档示例未列出完整 billing 契约。实现应提取已确认的实际消耗字段，缺失时返回 `billing: null`，不得根据渲染时长推算。
- `generate_video` 提交和 `task_status` 轮询可能携带同一任务的累计计费值，必须按任务去重，不可把每次轮询的相同消耗累加。
- MCP 成功、失败结果的 JSON `content` 均需保留已知 `billing`，防止现有 bridge 把 `isError` 转成错误文本后丢失积分。
- 如果渲染失败但云端已返回实际消耗，错误卡片仍应展示已消耗点数。

建议新增：

- `src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/DraftRenderToolRenderer.tsx`
- `src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/draftRenderTool.ts`
- `src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/DraftRenderTool.css`（如复用现有样式不足）

并在 `McpServerToolRenderer.tsx` 和 `index.tsx` 中按工具名路由到专用 renderer。`index.tsx` 已经会为需要完整计费信息的 MCP 同时传递 `response` 与 `responseRaw`，`render_draft` 应加入同样的提取条件。

## 8. 注册位置

新增 server 后需要同时注册到：

1. `src/main/services/agents/services/claudecode/tools/registry.ts`
   - `DraftRenderServer(cwd)`。
   - `longRunning: true`。
   - 适合短渲染的超时。
   - 自动允许 `render_draft` 并允许 `draft-render` pattern。

2. `src/main/services/LocalAggregateMcpService.ts`
   - 动态 import。
   - 增加 `AggregateServerEntry`。
   - 构造时传入 `workspacePath`（仅用于运行上下文，不用于保存 MP4）。

不需要只修改 `src/main/mcpServers/factory.ts`；该 factory 不是 `video-understand` 和现有草稿 MCP 的注册入口。

## 9. 错误场景

| 场景 | 行为 |
|---|---|
| 缺少 `draft_id` | 参数错误，不发起请求 |
| 同时传入不一致的 `draftId` 与 `draft_id` | 参数错误，不发起请求 |
| `query_script` 失败 | 返回查询失败，不发起渲染 |
| 脚本存在本地素材 | 返回“包含 xxx 本地文件，无法渲染”，不发起渲染 |
| 无法解析素材引用 | 为安全起见拒绝渲染并说明无法确认素材来源 |
| 时长超过 5 秒 | 返回短片限制，不发起渲染 |
| 无法读取时长 | 拒绝，不盲目渲染 |
| `generate_video` 失败 | 返回云端错误，不写工作空间产物 |
| 轮询失败或超时 | 返回任务 ID和状态；不产生或清理本地临时文件 |
| 用户取消 | 停止轮询；不自动重试，不产生或清理本地临时文件 |
| 云端结果不可用 | 返回云端错误；不产生本地 MP4 |

## 10. 验收标准

- [ ] 只接受 `draft_id`，不接受 draft JSON。
- [ ] 不存在 `outputPath` / `output_path` 参数。
- [ ] 调用预渲染前完成 `query_script` 检查。
- [ ] 视频和音频源素材时长均不超过 20 秒。
- [ ] 图片源文件大小不超过 20 MB。
- [ ] 超限或无法确认素材时长/大小时，在工具内部拒绝，不提交渲染、不交给 AI 判断。
- [ ] 发现任意本地素材时不调用 `generate_video`，并返回素材字段位置和脱敏路径。
- [ ] 超过 5 秒或无法确认时长时不调用 `generate_video`。
- [ ] 不在工作空间创建草稿 JSON、MP4 或可见中间文档。
- [ ] 不创建 `.tmp`、session 临时目录或其他本地中间文件。
- [ ] 不把 MP4 放入 `.capcut/tool-results` 或 `.tool-results`。
- [ ] 清理不依赖 AI、模型提示词或 Agent 自己调用命令；因为本工具不创建本地文件。
- [ ] MCP `content` 保持精简，不触发大结果文件保存。
- [ ] 正确发送 MCP progress 通知。
- [ ] MCP 返回本次实际积分消耗，不由 AI 估算。
- [ ] 云端返回计费值时，前端专用卡片展示“本次渲染消耗 X 点”。
- [ ] 渲染失败但已有计费值时，前端仍展示已消耗点数。
- [ ] 没有计费值时不伪造数值。
- [ ] 专用 renderer 能兼容 `response` / `responseRaw` 包装和截断情况。
- [ ] 不在卡片中展示本地路径、草稿全文或隐藏文件路径。
- [ ] 支持 401 重试、取消、轮询超时和失败状态。
- [ ] 运行时 registry 与 local aggregate 均能发现该工具。

## 11. 非目标

- 不支持从 draft JSON 创建或上传草稿。
- 不支持本地文件自动上传后再渲染。
- 不支持长视频导出。
- 不支持用户指定 MP4 保存路径。
- 不承诺跨对话保留渲染视频。
- 不把预渲染 MP4 作为工作空间素材库资产。
- 不把 pi-agent 的 `.tool-results/` 目录当成 session 临时目录；本方案不需要新增清理机制，因为不创建本地中间文件。
