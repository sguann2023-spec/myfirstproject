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

典型 payload：

```json
{
  "drafts": [
    {
      "draftId": "dfd_cat_xxx",
      "draftName": "草稿A"
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

典型 payload：

```json
{
  "drafts": [
    {
      "draftId": "dfd_cat_xxx",
      "draftName": "草稿A"
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

## 5. 固定约束

| 约束项 | 规则 |
| --- | --- |
| direct request 执行链路 | 不走普通 Agent 推理 |
| token 消耗 | 不消耗 token |
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
