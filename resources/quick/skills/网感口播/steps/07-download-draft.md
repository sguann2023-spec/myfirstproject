# 步骤 7：下载草稿到剪映

> 工作流执行成功后，调用 MCP 下载草稿工具，把草稿直接下载到剪映桌面端，无需用户手动点击链接。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [drafts]
        properties:
          drafts:
            type: array
            description: 步骤 6 返回的草稿结果列表（与输入视频一一对应）；只提交 status=success 且 draft_id 非空的草稿。
            items:
              type: object
              required: [draft_id]
              properties:
                draft_id:
                  type: string
                  description: 草稿 ID。
                draft_name:
                  type: string
                  description: 可选，草稿名称。
                cover:
                  type: string
                  description: 可选，草稿封面图片地址。
```

## 操作规则

### 7a. 调用下载草稿工具

**单个草稿**时：

```
download_draft(draftId="{draft_id}", draftName="{draft_name}", cover="{cover_url}")
```

**多个草稿**（多视频输入）时，一次性批量提交：

```
download_draft(drafts=[{"draftId": "...", "draftName": "...", "cover": "..."}, ...])
```

规则：
- 只下载步骤 6 执行成功的草稿；失败的草稿跳过，并在最终回复中说明原因。
- 下载完成后**不再调用 `query_script` 或其他工具校验草稿**，以工具返回结果为准。
- 下载成功即视为整个技能流程完成，直接进入最终回复。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 草稿下载任务已提交，草稿将出现在剪映桌面端草稿列表中。
    content:
      application/json:
        schema:
          type: object
          properties:
            success: { type: boolean }
            downloaded_drafts:
              type: array
              description: 已提交下载的草稿列表。
              items:
                type: object
                properties:
                  draft_id: { type: string }
                  draft_name: { type: string }
  "500":
    description: 下载任务提交失败，已记录原因。
```
