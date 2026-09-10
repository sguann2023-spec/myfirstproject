# Direct Request PRD

## 1. 背景

草稿相关操作里，存在一类“意图非常明确、目标 MCP 唯一确定”的请求：

- 创建草稿
- 修改草稿
- 下载草稿
- 导出草稿

这类请求如果仍然走完整 Agent 对话策略，会带来几个问题：

- 响应慢
- 消耗 token
- UI 展示和真实执行链路之间容易偏移
- 某些操作本质上并不需要自由推理

因此需要引入一条 `direct request` 直连链路：当用户消息带特定标记位时，前端和主进程直接调用目标 MCP tool，同时仍然保留“像正常对话一样”的展示、历史记录和上下文沉淀。

---

## 2. 目标

### 2.1 核心目标

为以下三类草稿操作提供稳定的直连能力：

- `draft_request`
- `draft_modify_request`
- `draft_download_request`
- `draft_export_request`

满足以下要求：

1. 不走普通 Agent 推理链路
2. 不消耗 token
3. 直接调用指定 MCP tool
4. 仍然生成完整 user / assistant 消息
5. 仍然写入对话历史
6. 仍然写入 Agent 上下文
7. UI 上继续显示标准 tool 卡片和 assistant 回复

### 2.2 非目标

以下内容不在本 PRD 目标内：

- 任何需要开放式推理的复杂草稿编辑
- 非草稿类 direct request
- 通用“本地素材上传”能力

---

## 3. 标记位定义

### 3.1 `draft_request`

表示“创建草稿”请求。

目标 MCP：

- server: `draft-management`
- tool: `create_draft`

### 3.2 `draft_modify_request`

表示“修改草稿元信息”请求。

目标 MCP：

- server: `draft-management`
- tool: `modify_draft`

### 3.3 `draft_download_request`

表示“下载草稿”请求。

目标 MCP：

- server: `draft-download`
- tool: `download_draft`

### 3.4 `draft_export_request`

表示“导出草稿”请求。

目标 MCP：

- server: `draft-download`
- tool: `export_draft`

---

## 4. 整体链路

统一链路如下：

1. `Composer` 根据当前 tool detail 生成普通用户文案
2. 同时在 `handleSend` 的 `options` 中附带 direct request 标记对象
3. `HomePage` 识别到该标记后，不走普通流式会话
4. `HomePage` 先插入一条 processing 状态的 assistant tool block
5. renderer 通过 preload -> IPC 调主进程 direct request handler
6. 主进程直接实例化对应 MCP server，并调用目标 tool
7. 主进程拼接固定 assistant message 和标准 tool block
8. 主进程将 user / assistant exchange 持久化到历史和上下文
9. renderer 用返回结果更新当前 assistant message
10. renderer 触发 hydrate，确保当前 UI 与持久化历史一致

---

## 5. 各标记位的请求语义

### 5.1 `draft_request`

语义：创建一个新草稿。

典型字段：

```json
{
  "action": "create",
  "width": 1080,
  "height": 1920,
  "name": "测试草稿",
  "cover": "/absolute/path/or/file/url/or/http-url"
}
```

说明：

- `width` / `height` 可选
- `name` 可选
- `cover` 可选
- 即使 `name` 和 `cover` 都为空，仍允许发送

### 5.2 `draft_modify_request`

语义：修改已有草稿的草稿名和/或封面。

典型字段：

```json
{
  "draftId": "dfd_cat_xxx",
  "name": "新草稿名",
  "cover": "/absolute/path/or/file/url/or/http-url"
}
```

说明：

- `draftId` 必填
- `name` / `cover` 至少一个有值
- 前端工具态要求先单选一个草稿，再允许发送

### 5.3 `draft_download_request`

语义：将一个或多个草稿提交到本地下载队列。

典型字段：

```json
{
  "drafts": [
    {
      "draftId": "dfd_cat_xxx",
      "draftName": "草稿A"
    },
    {
      "draftId": "dfd_cat_yyy",
      "draftName": "草稿B"
    }
  ]
}
```

说明：

- 支持单个或多个草稿
- 至少选择一个草稿才允许发送

### 5.4 `draft_export_request`

语义：将一个或多个草稿提交到本地导出队列。

典型字段：

```json
{
  "drafts": [
    {
      "draftId": "dfd_cat_xxx",
      "draftName": "草稿A"
    },
    {
      "draftId": "dfd_cat_yyy",
      "draftName": "草稿B"
    }
  ]
}
```

说明：

- 字段结构与 `draft_download_request` 完全一致
- 支持单个或多个草稿
- 至少选择一个草稿才允许发送

---

## 6. 前端职责

### 6.1 Composer

`Composer` 负责：

- 根据当前 tool detail 组装用户可见文案
- 生成 direct request payload
- 将 payload 通过 `handleSend(message, options)` 传给 `HomePage`

要求：

1. direct request 的发送资格判断应由各个 tool detail 提供
2. `Composer` 只消费 `canSend` 和 `disabledReason`
3. 回车发送和发送按钮点击必须共用同一套发送前校验

### 6.2 Tool Detail

各 tool detail 负责：

- 自己定义发送条件
- 自己定义禁发原因

当前约定：

- 新建草稿：默认可发送，无禁发提示
- 下载草稿：未选草稿时提示 `至少选择一个草稿`
- 导出草稿：未选草稿时提示 `至少选择一个草稿`
- 修改草稿：未选草稿时提示 `必须选择一个草稿进行修改`

### 6.3 HomePage

`HomePage` 负责 direct request 分流。

识别逻辑：

- 有 `draft_request` -> 走 create 直连
- 有 `draft_modify_request` -> 走 modify 直连
- 有 `draft_download_request` -> 走 download 直连
- 有 `draft_export_request` -> 走 export 直连

分流后职责：

1. 更新 user message 上的标记对象
2. 插入 processing tool block
3. 调用 preload 暴露的 IPC 方法
4. 收到结果后更新 assistant message
5. 触发 hydrate 持久化历史

---

## 7. 主进程职责

主进程 `sessionStreamIpc` 负责：

1. 接收 renderer 的 direct request IPC
2. 直接实例化目标 MCP server
3. 调用固定 tool
4. 解析 tool 结果
5. 拼接固定 assistant 文案
6. 构造标准 MCP tool block
7. 落库 user / assistant exchange
8. 广播 session changed

要求：

- 不通过通用 Agent 推理
- 不通过 `mcpService.callToolById`
- 对非全局注册 MCP 服务直接实例化 server 并取 handler

---

## 8. Tool 卡片规范

直连生成的 tool block 必须保持和正常 MCP tool 一致的元数据，至少包括：

- `type: 'tool'`
- `toolName`
- `metadata.rawMcpToolResponse`
- `tool.type === 'mcp'`
- 对外统一名称遵循 `mcp__vectcut__[server]__[tool]`

当前对应关系：

- 创建草稿：`mcp__vectcut__draft-management__create_draft`
- 修改草稿：`mcp__vectcut__draft-management__modify_draft`
- 下载草稿：`mcp__vectcut__draft-download__download_draft`
- 导出草稿：`mcp__vectcut__draft-download__export_draft`

否则前端可能无法正确渲染工具卡片或标题。

---

## 9. assistant 固定回复

### 9.1 创建草稿

固定回复包含：

- 创建成功提示
- 草稿 ID
- 草稿名（如有）
- 分辨率（如有）
- 封面是否已设置
- 后续引导语

### 9.2 修改草稿

固定回复包含：

- 修改成功提示
- 草稿 ID
- 新草稿名（如有）
- 新封面是否已设置
- 后续引导语

### 9.3 下载草稿

固定回复包含：

- 下载任务提交成功提示
- 被提交的草稿列表
- 队列完成后的说明

要求：

- 使用系统换行符 `EOL`
- 文案由主进程统一拼接，避免 renderer 与持久化结果不一致

### 9.4 导出草稿

固定回复包含：

- 导出任务提交成功提示
- 被提交的草稿列表
- 队列完成后的说明

---

## 10. 历史与上下文

direct request 虽然不走 Agent 推理，但必须像正常对话一样沉淀。

### 10.1 必须落历史

需要持久化：

- user message
- assistant message
- tool block
- main_text block

### 10.2 必须进上下文

后续继续对话时，Agent 应能知道：

- 当前是否创建过草稿
- 修改的是哪个草稿
- 下载过哪些草稿

因此 direct request 的 exchange 必须写入同一条 session/topic 的历史中。

---

## 11. API 视图规则

user message 的 API 化展示仅是前端展示态：

- 不改变 chat history
- 不改变 persisted message
- 不改变 Agent 上下文
- 不影响复制以外的真实发送结果

### 11.1 支持 API 化展示

- `draft_request`
- `draft_modify_request`

### 11.2 不支持 API 化展示

- `draft_download_request`

原因：

- 下载草稿属于桌面端下载队列语义，不对应同一类开放 API 展示场景

---

## 12. IPC 接口

当前需要的 direct request IPC：

- `CherryChatStream_DraftRequest`
- `CherryChatStream_DraftModifyRequest`
- `CherryChatStream_DraftExportRequest`
- `CherryChatStream_DraftDownloadRequest`

preload 对应方法：

- `createDraftRequest`
- `createDraftModifyRequest`
- `createDraftExportRequest`
- `createDraftDownloadRequest`

---

## 13. 关键代码位置

前端：

- `src/components/Chat/Composer/Composer.js`
- `src/page/HomePage/HomePage.jsx`
- `src/components/Chat/MessagePane/MessageItem/MessageItem.js`

主进程：

- `src/main/services/agents/services/channels/sessionStreamIpc.ts`
- `src/main/mcpServers/draft-management.ts`
- `src/main/mcpServers/draft-download.ts`

桥接：

- `src/packages/shared/IpcChannel.ts`
- `src/preload/index.ts`
- `src/preload/preload.d.ts`

---

## 14. 后续扩展原则

后面如果继续增加 direct request，建议统一遵循以下模板：

1. 新增独立标记位
2. 明确唯一目标 MCP server/tool
3. 在 tool detail 中定义发送条件
4. 在 `Composer` 中透传 request payload
5. 在 `HomePage` 中新增单独分流
6. 在 `sessionStreamIpc` 中新增直连 handler
7. 拼接固定 assistant message
8. 保证历史、上下文、tool card 三者一致

这样可以继续获得：

- 更快的响应
- 更低的 token 消耗
- 更稳定的 UI 呈现
- 更容易维护的工程结构
