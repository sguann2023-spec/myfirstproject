# 步骤 13：下载草稿

> 调用下载接口将草稿推送到剪映桌面端，用户无需手动操作。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [draft_id, draft_name]
        properties:
          draft_id:
            type: string
            description: 步骤 8 创建的草稿 ID。
          draft_name:
            type: string
            description: 草稿名称，用于下载列表展示。
```

## 操作规则

1. 调用 `download_draft` 工具，传入 `draft_id` 和 `draft_name`：

```
download_draft(draftId="{draft_id}", draftName="{draft_name}")
```

2. 工具返回成功即表示下载队列已提交，草稿将在剪映桌面端自动打开。

### 成功

工具返回成功即表示下载队列已提交。

### 失败

下载失败不阻塞整体流程（草稿本身已成功生成），在最终回复中标注下载状态为失败即可。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 草稿下载请求已提交。
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
              description: 下载结果描述。
```
