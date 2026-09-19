# Direct Request 标记位管理表

## 1. 目的

这个文档不再描述大段实现过程，而是作为 `direct request` 的统一管理表，重点回答下面几件事：

| 管理项 | 说明 |
| --- | --- |
| 标记位是什么 | 当前支持哪些 direct request 标记位 |
| 是否走直连 | 是否跳过普通 Agent 推理，直接调用指定 MCP tool |
| 是否有 direct 回复 | 是否由主进程直接生成固定 assistant 回复 |
| 前端是否可切换展示 | 这类 user message 是否支持前端展示态切换 |
| 可展示类型 | 支持 `文字 / Agent / API / Coze` 中的哪些 |
| 触发条件 | 什么时候允许显示某种切换卡片 |

---

## 2. 标记位总表

| 标记位 | 业务语义 | MCP Server | MCP Tool | 是否 direct request | 是否 direct assistant 固定回复 | 前端是否支持切换卡片 | 文字 | Agent | API | Coze |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `draft_request` | 创建草稿 | `draft-management` | `create_draft` | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| `draft_modify_request` | 修改草稿 | `draft-management` | `modify_draft` | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| `text_add_request` | 向草稿添加文本 | `draft-elements` | `add_text` | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| `draft_download_request` | 下载草稿 | `draft-download` | `download_draft` | 是 | 是 | 是 | 是 | 是 | 否 | 否 |
| `draft_export_request` | 导出草稿 | `draft-download` | `export_draft` | 是 | 是 | 是 | 是 | 是 | 否 | 否 |
| `draft_inspect` | 查看草稿 | `draft-management` | `query_script` | 否 | 否 | 是 | 是 | 是 | 否 | 否 |
| `reverse_prompt_request` | 反推视频文案提示词 | `copylab` | `derive_copy_prompt` | 是 | 是（整理工具结果） | 是 | 是（默认） | 是 | 否 | 否 |

---

## 3. 前端展示切换规则

### 3.1 展示类型定义

| 展示类型 | 含义 | 是否影响真实发送 | 是否影响持久化历史 |
| --- | --- | --- | --- |
| `文字` | 默认用户文案展示 | 否 | 否 |
| `Agent` | 在原文前增加前缀：`使用vectcut工具，xxx` | 否 | 否 |
| `API` | 将用户消息前端展示为 API / curl 形式 | 否 | 否 |
| `Coze` | 将用户消息前端展示为 Coze 工作流剪贴板 JSON | 否 | 否 |

---

## 4. 标记位详细配置表

### 4.1 `draft_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 创建一个新草稿 |
| 目标 MCP | `draft-management.create_draft` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` / `API` / `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是 |
| `Coze` 是否可展示 | 是，当前支持 `draft_request` / `draft_modify_request` / `text_add_request` |
| 前端发送条件 | 默认允许发送 |

典型 payload：

```json
{
  "action": "create",
  "width": 1080,
  "height": 1920,
  "name": "测试草稿",
  "cover": "/absolute/path/or/file/url/or/http-url"
}
```

### 4.2 `draft_modify_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 修改已有草稿的草稿名和/或封面 |
| 目标 MCP | `draft-management.modify_draft` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` / `API` / `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是 |
| `Coze` 是否可展示 | 是 |
| 前端发送条件 | 必须先选择一个草稿，且 `name` / `cover` 至少一个有值 |

典型 payload：

```json
{
  "draftId": "dfd_cat_xxx",
  "name": "新草稿名",
  "cover": "/absolute/path/or/file/url/or/http-url"
}
```

### 4.3 `text_add_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 向指定草稿添加一个文本元素 |
| 目标 MCP | `draft-elements.add_text` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` / `API` / `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是 |
| `Coze` 是否可展示 | 是 |
| 前端发送条件 | 必须先选择一个草稿，且必须输入文本内容 |
| 触发工具 | `mcp__vectcut__draft-elements__add_text` |

典型 payload：

```json
{
  "draft_id": "dfd_cat_xxx",
  "text": "这是一段要添加到草稿里的文本",
  "start": 0,
  "end": 3,
  "font": "优设标题黑",
  "font_size": 24,
  "font_color": "#FFFFFF",
  "letter_spacing": 0,
  "line_spacing": 0,
  "bold": false,
  "italic": false,
  "underline": false,
  "vertical": false,
  "align": 1,
  "scale_x": 1,
  "scale_y": 1,
  "transform_x_px": 0,
  "transform_y_px": 0,
  "fixed_width_px": 600,
  "fixed_height_px": 120,
  "rotation": 0
}
```

典型 API 展示：

```bash
curl --request POST \
  --url "https://open.vectcut.com/cut_jianying/add_text" \
  --header "Content-Type: application/json" \
  --data '{
    "draft_id": "dfd_cat_xxx",
    "text": "这是一段要添加到草稿里的文本",
    "start": 0,
    "end": 3,
    "font": "优设标题黑",
    "font_size": 24,
    "font_color": "#FFFFFF",
    "letter_spacing": 0,
    "line_spacing": 0,
    "bold": false,
    "italic": false,
    "underline": false,
    "vertical": false,
    "align": 1,
    "scale_x": 1,
    "scale_y": 1,
    "transform_x_px": 0,
    "transform_y_px": 0,
    "fixed_width_px": 600,
    "fixed_height_px": 120,
    "rotation": 0
  }'
```

典型 Coze 展示：

```json
{
  "type": "coze-workflow-clipboard-data",
  "source": {
    "workflowId": "7684115562197712911",
    "flowMode": 0,
    "spaceId": "7472683780642258985",
    "isDouyin": false,
    "host": "www.coze.cn"
  },
  "json": {
    "nodes": [
      {
        "id": "197345",
        "type": "4",
        "data": {
          "nodeMeta": {
            "title": "add_text",
            "subtitle": "流光剪辑_剪映草稿助手(会员版):add_text",
            "description": "添加文字"
          },
          "inputs": {
            "apiParam": [
              { "name": "apiName", "input": { "type": "string", "value": { "type": "literal", "content": "add_text" } } },
              { "name": "pluginName", "input": { "type": "string", "value": { "type": "literal", "content": "流光剪辑_剪映草稿助手(会员版)" } } }
            ],
            "inputParameters": [
              { "name": "draft_id", "type": "string" },
              { "name": "text", "type": "string" },
              { "name": "start", "type": "float" },
              { "name": "end", "type": "float" },
              { "name": "font", "type": "string" },
              { "name": "font_size", "type": "float" },
              { "name": "font_color", "type": "string" },
              { "name": "letter_spacing", "type": "float" },
              { "name": "line_spacing", "type": "float" },
              { "name": "bold", "type": "boolean" },
              { "name": "italic", "type": "boolean" },
              { "name": "underline", "type": "boolean" },
              { "name": "vertical", "type": "boolean" },
              { "name": "align", "type": "integer" },
              { "name": "scale_x", "type": "float" },
              { "name": "scale_y", "type": "float" },
              { "name": "transform_x_px", "type": "integer" },
              { "name": "transform_y_px", "type": "integer" },
              { "name": "fixed_width_px", "type": "integer" },
              { "name": "fixed_height_px", "type": "integer" },
              { "name": "rotation", "type": "float" }
            ]
          }
        }
      }
    ],
    "edges": []
  }
}
```

对齐字段约束：

| UI 语义 | `vertical` | `align` |
| --- | --- | --- |
| 左对齐 | `false` | `0` |
| 水平居中对齐 | `false` | `1` |
| 右对齐 | `false` | `2` |
| 上对齐 | `true` | `3` |
| 垂直居中对齐 | `true` | `1` |
| 下对齐 | `true` | `4` |

### 4.4 `draft_download_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 将一个或多个草稿加入本地下载队列 |
| 目标 MCP | `draft-download.download_draft` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 否 |
| 前端发送条件 | 至少选择一个草稿 |
| 参数约束 | 必须传 `draftId` 或 `draft_id`；`draftName` / `draft_name` 仅用于展示，不参与定位下载目标 |

典型 payload：

```json
{
  "drafts": [
    {
      "draftId": "dfd_cat_xxx"
    }
  ]
}
```

### 4.5 `draft_export_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 将一个或多个草稿加入本地导出队列 |
| 目标 MCP | `draft-download.export_draft` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 否 |
| 前端发送条件 | 至少选择一个草稿 |
| 参数约束 | 必须传 `draftId` 或 `draft_id`；`draftName` / `draft_name` 仅用于展示，不参与定位导出目标 |

典型 payload：

```json
{
  "drafts": [
    {
      "draftId": "dfd_cat_xxx"
    }
  ]
}
```

### 4.6 `draft_inspect`

| 项目 | 规则 |
| --- | --- |
| 语义 | 查看指定草稿内容 |
| 目标 MCP | `draft-management.query_script` |
| 是否 direct request | 否 |
| 是否 direct 回复 | 否 |
| 支持展示类型 | `文字` / `Agent` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 否 |
| 前端发送条件 | 必须先选择一个草稿，且必须输入查看要求 |
| 触发工具 | `mcp__vectcut__draft-management__query_script` |
| 前端消息标记对象 | `draftInspectRequest` |
| requestId | 写入 `draftInspectRequest.requestId`，用于请求追踪和前端展示判断 |

典型 payload：

```json
{
  "requestId": "req_xxx",
  "draftId": "dfd_cat_xxx",
  "requirement": "查看某个文案的字体"
}
```

---

### 4.7 `reverse_prompt_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 根据视频分享链接或分享文案，反推可复用的文案提示词 |
| 目标 MCP | `copylab.derive_copy_prompt` |
| 是否 direct request | 是，跳过普通 Agent 推理，工具内部仍调用 ASR 和文案分析模型 |
| 是否 direct 回复 | 是，由主进程整理工具返回的提示词，不额外调用聊天模型 |
| 前端消息标记对象 | `reversePromptRequest` |
| requestId | IPC 顶层 `requestId`，同时保存到 `reversePromptRequest.requestId`；重试生成新的执行 requestId |
| 工具调用 ID | `reverse_prompt_request_${requestId}`，用于匹配进度事件 |
| 支持展示类型 | 默认 `文字`，仅提供 `Agent` 转换选项；可切回文字 |
| `Agent` 是否可展示 | 外部链接已连接时可展示，与其他请求保持一致 |
| `API` / `Coze` 是否可展示 | 否 |
| 前端发送条件 | 输入包含 HTTP(S) 视频链接的分享文案 |
| MCP 参数 | 将完整分享文案传入 `shareText`；不把内部 requestId 传给 MCP |
| token / 点数 | 直连不等于零消耗；内部模型仍可能消耗 token，点数以服务端计费返回为准 |
| 点数汇总 | 链接解析 + 字幕识别 + 文案分析，按阶段汇总；提交与轮询属于同一任务，不重复累加 |
| 缺失计费字段 | 不当作 0；“预估消耗”即已返回阶段的合计，不追加“已知”或计费不完整的额外说明，悬浮面板仅保留消耗明细；所有阶段均未返回时不显示点数 |
| 长时任务超时 | 与图片生成一致：MCP 注册设置 `longRunning: true`、`timeout: 600`（秒），桥接调用总上限 10 分钟；内部 ASR 和文案分析的单阶段轮询上限各为 10 分钟，经 MCP 桥接调用时仍受外层总上限约束 |
| 失败处理 | 已返回的点数随错误工具卡片保留，不能把已发生的消耗清零；取消后服务端仍可能继续计费，以账单为准 |
| 历史保留 | 工具结果保留 `billing` 分阶段明细及服务端 `usage`；不按当前聊天模型价格推算内部模型点数 |
| 消耗展示 | 新旧工具卡片均展示汇总点数；消息底部累加已返回的内部 token 用量但不重复计费，未返回的用量或点数不显示为零 |

典型前端标记：

```json
{
  "reversePromptRequest": {
    "requestId": "req_xxx",
    "shareText": "视频分享文案 https://v.douyin.com/xxx/"
  }
}
```

工具返回计费结构（示例数字不代表固定价格）：

```json
{
  "billing": {
    "total_consumed_points": 1.8,
    "complete": true,
    "missing_stages": [],
    "stages": [
      { "stage": "parse_share_link", "points_consumed": 0.1 },
      { "stage": "asr", "task_id": "asr_xxx", "points_consumed": 0.5 },
      { "stage": "analyze_prompt", "task_id": "chat_xxx", "points_consumed": 1.2 }
    ]
  }
}
```

---

## 5. 固定约束

| 约束项 | 规则 |
| --- | --- |
| direct request 执行链路 | 不走普通 Agent 推理 |
| token 消耗 | 仅跳过普通 Agent 推理；工具内部的模型调用仍可能消耗 token 和点数，不可统一标记为 0 |
| 工具计费 | 使用后端实际返回值；组合工具去重汇总各阶段，缺失字段不视为零，不与聊天 token 费用重复计算 |
| assistant 回复来源 | 由主进程统一拼接固定回复 |
| tool 卡片 | 继续按标准 MCP tool 卡片渲染 |
| 历史落库 | 必须写入 user / assistant / tool block / main_text block |
| Agent 上下文 | 必须进入同一条 session/topic 的上下文 |
| 展示切换影响范围 | 仅影响前端展示态和复制内容，不改真实发送和持久化结果 |

---

## 6. Tool 卡片命名表

| 标记位 | Tool 名称 |
| --- | --- |
| `draft_request` | `mcp__vectcut__draft-management__create_draft` |
| `draft_modify_request` | `mcp__vectcut__draft-management__modify_draft` |
| `text_add_request` | `mcp__vectcut__draft-elements__add_text` |
| `draft_download_request` | `mcp__vectcut__draft-download__download_draft` |
| `draft_export_request` | `mcp__vectcut__draft-download__export_draft` |
| `reverse_prompt_request` | `mcp__vectcut__copylab__derive_copy_prompt` |

---

## 7. 新增标记位时的维护模板

后续如果新增 direct request，按下面这张表补齐即可，不再写大段过程说明：

| 必填项 | 示例 |
| --- | --- |
| 标记位 | `xxx_request` |
| 业务语义 | 这类请求是做什么的 |
| MCP Server | `xxx-server` |
| MCP Tool | `xxx_tool` |
| 是否 direct request | 是 / 否 |
| 是否 direct assistant 固定回复 | 是 / 否 |
| 是否支持前端切换卡片 | 是 / 否 |
| 文字 | 是 / 否 |
| Agent | 是 / 否 |
| API | 是 / 否 |
| `Agent` 展示条件 | 是否要求外部链接已连接 |
| `API` 展示条件 | 是否支持 API 化展示 |
| `Coze` 展示条件 | 是否支持 Coze 工作流剪贴板展示 |
| 前端发送条件 | 例如至少选一个草稿 |
