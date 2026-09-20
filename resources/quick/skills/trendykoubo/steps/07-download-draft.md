# 步骤 7：下载草稿

> 工作流执行成功并拿到 `draft_id` 后，自动调用内部 MCP 下载工具将草稿推送到剪映桌面端，用户无需手动操作。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [draft_id]
        properties:
          draft_id:
            type: string
            description: 步骤 6 返回的草稿 ID。
            examples: ["dfd_cat_1787996361_7a42c8e0"]
          draft_name:
            type: string
            description: 可选，草稿名称，用于下载列表展示。
            examples: ["网感口播_高级红_马伟明"]
```

## 操作规则

调用 `download_draft` 内部 MCP 工具（`mcp__vectcut__draft-download__download_draft`），传入步骤 6 返回的 `draft_id`（可附 `draft_name`）：

```text
download_draft(draftId="{draft_id}", draftName="{draft_name}")
```

### 成功

工具返回成功即表示下载队列已提交，草稿将在剪映桌面端自动打开。

### 失败

下载失败不阻塞整体流程（草稿本身已成功生成），在最终回复中标注下载状态为失败即可。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 下载请求已提交。
    content:
      application/json:
        schema:
          type: object
          required: [download_status]
          properties:
            download_status:
              type: string
              enum: [success, failed]
              description: 下载状态。
            download_message:
              type: string
              description: 下载结果描述（失败时记录原因）。
  "500":
    description: 下载工具调用失败，已记录原因。
```
