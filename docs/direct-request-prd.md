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
| `subtitle_recognition_request` | 识别音视频字幕 | `subtitle-recognition` | `submit_subtitle_recognition_task` | 是 | 是（表格、全文及分镜入口） | 是 | 是（默认） | 是 | 否 | 否 |
| `subtitle_storyboard_request` | 字幕分镜 AI 辅助 | 无 | 无 | 否 | 否 | 是 | 是（默认） | 是 | 否 | 否 |

---

## 3. 前端展示切换规则

### 3.1 展示类型定义

| 展示类型 | 含义 | 是否影响真实发送 | 是否影响持久化历史 |
| --- | --- | --- | --- |
| `文字` | 默认用户文案展示 | 否 | 否 |
| `Agent` | 通常在原文前增加前缀：`使用vectcut工具，xxx`；`subtitle_storyboard_request` 改为本地文件读写指令，不要求调用 MCP | 否 | 否 |
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

### 4.8 `subtitle_recognition_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 识别音频或视频字幕，不自动添加到草稿 |
| 目标 MCP | `subtitle-recognition.submit_subtitle_recognition_task` |
| 是否 direct request | 是，跳过普通 Agent 推理，直接执行同一 MCP 提交与轮询流程 |
| 是否 direct 回复 | 是，主进程基于实际结果生成 Markdown 表格、完整文本及工作区文件名，不调用聊天模型整理 |
| 前端消息标记对象 | `subtitleRecognitionRequest` |
| requestId | IPC 顶层及前端标记中保存；重试使用新的执行 requestId |
| 工具调用 ID | `subtitle_recognition_request_${requestId}` |
| 支持展示类型 | 默认 `文字`，外部 Agent 已连接时可切换 `Agent`，可切回文字；不支持 API / Coze |
| 前端发送条件 | 已选择音视频；浏览器文件需上传完成，本地文件由 MCP 内部上传 |
| 固定分句 | `effectMode: nlp`，`maxSentenceLength` 为 3～80 的整数，默认 12；映射后台 `max_sentence_length` |
| 不分句 | `effectMode: basic`，不传 `maxSentenceLength` |
| 校对文案 | 仅已启用且非空时传入 `content`，此时后台使用 STA，否则为 ASR |
| 回复条数及时间轴 | 使用返回 `result.segments`，毫秒转为 `HH:mm:ss,SSS`；不按字数再次切分 |
| 回复模板 | `字幕识别完成！以下是识别结果，共 N 条字幕，使用 X 字分句：`；basic 改为 `共 N 条字幕，不分句：` |
| 表格 | 三列：`#`、`时间轴`、`字幕文本`；序号从 1 开始，文本进行 Markdown 转义 |
| 完整文本 | 使用服务端完整文本，置于代码块；末尾展示实际工作区文件名，禁止使用示例固定值 |
| 分镜入口 | 有已保存的 `sre_*.json` 时在回复末尾增加“打开字幕分镜”超链接；以 `artifact.file_path`（缺失时用 `relative_path`）编码为 `#subtitle-storyboard?file=...` |
| 链接行为 | 在应用内打开字幕分镜弹窗并直接选中该识别结果，多文件时也不再要求选择；不打开浏览器或重新发起识别 |
| 文件校验 | 仅加载当前工作区文件列表中的目标；文件已删除或不属于当前工作区时提示错误，不回退打开其他文件；无结果文件时不展示入口 |
| 工作区与历史 | 在当前会话工作区保存详细 JSON，缺失工作区时自动创建；保存 user / assistant / tool / main_text，进入相同 session 上下文 |
| 点数 | 保留后台实际 `billing.consume`，工具卡片及消息合计展示；不使用预估价格替代实际扣费 |
| 错误与取消 | 失败保留已返回计费并显示失败卡片；取消后忽略迟到结果，服务端可能继续执行和扣费 |
| 超时 | 沿用字幕 MCP 的 35 分钟轮询上限，5 秒间隔；直连不经过普通 Agent 的工具桥接超时 |

典型前端标记：

```json
{
  "subtitleRecognitionRequest": {
    "requestId": "req_xxx",
    "url": "/absolute/path/video.mp4",
    "effectMode": "nlp",
    "maxSentenceLength": 20,
    "content": "可选的完整校对文案"
  }
}
```

固定回复示例（条数、内容、字数及文件名均由真实结果替换）：

````markdown
字幕识别完成！以下是识别结果，共 2 条字幕，使用 20 字分句：

| # | 时间轴 | 字幕文本 |
| --- | --- | --- |
| 1 | 00:00:00,370 → 00:00:01,850 | 最近在做一个新的功能 |
| 2 | 00:00:02,170 → 00:00:06,010 | 打算把画布的功能和剪辑做一个结合 |

完整文本：
```text
最近在做一个新的功能，打算把画布的功能和剪辑做一个结合。
```

详细结果已保存至工作区文件：sre_task-id.json

[打开字幕分镜](#subtitle-storyboard?file=%2Fworkspace%2Fsre_task-id.json)
````

---

### 4.9 `subtitle_storyboard_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 按用户要求编辑当前绑定的字幕分镜 JSON，例如去气口、重新分镜、缩短停顿 |
| 目标 MCP / 工具调用 ID | 无，不注册专用 MCP tool，不生成虚构工具卡片 |
| 是否 direct request | 否，走普通 Agent 对话与文件读写流程 |
| 是否 direct 回复 | 否，由实际 Agent 回答，不拼接固定回复 |
| 前端消息标记对象 | `subtitleStoryboardRequest` |
| requestId | 首次发送时使用 IPC 顶层 `requestId`，同时写入标记对象；普通对话重试使用新的执行 requestId 并透传标记 |
| 支持展示类型 | 默认 `文字`；外部 Agent 已连接时可切换 `Agent` 并切回；不支持 API / Coze |
| Agent 展示及复制 | 保留完整任务提示词、文件路径和 JSON 格式约束，增加本地文件读写说明，不添加“使用vectcut工具”前缀 |
| 外部 Agent 条件 | 必须能访问指定识别文件和分镜文件；无法访问时应说明原因，不得虚构修改结果 |
| 前端发送条件 | 当前分镜已绑定文件并成功保存，当前会话空闲；用户要求可留空，正文使用默认处理规则 |
| 执行与展示边界 | 切换卡片只改变展示和复制内容，不自动向外部 Agent 再次发送，不改变当前 AI 任务 |
| 历史与上下文 | 标记随 user message 进入普通会话历史，重新加载后仍可切换；不因该标记额外创建 tool block |
| 执行期间 UI | 缩为预览弹窗，编辑保持禁用，但允许通过关闭按钮、Esc 或遮罩关闭；关闭不取消 AI，后台继续完成文件校验或自动回滚 |
| 关闭与重开 | 关闭后任务完成不自动弹出；下次打开读取最新文件；任务未结束时菜单和结果链接共用当前任务预览，不读取半写入文件 |
| 校验失败 | 用任务前完整快照覆盖错误文件，message 提示校验遇到问题、建议重试；回滚失败如实提示 |

典型前端标记（完整 AI 提示词仍保存在消息 `content`）：

```json
{
  "subtitleStoryboardRequest": {
    "requestId": "req_xxx",
    "sourceFile": "/workspace/sre_xxx.json",
    "storyboardFile": "/workspace/part_xxx.json",
    "instruction": "按完整语义重新分镜，保留自然换气"
  }
}
```

---

## 5. 固定约束

以下直连执行、固定回复及工具卡片约束仅适用于总表中“是否 direct request = 是”的请求；非直连标记沿用普通 Agent 流程，展示切换和会话上下文约束仍适用。

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
| `subtitle_recognition_request` | `mcp__vectcut__subtitle-recognition__submit_subtitle_recognition_task` |
| `subtitle_storyboard_request` | 无，仅提供用户消息的文字 / Agent 展示切换 |

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
