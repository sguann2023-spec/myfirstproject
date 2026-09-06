# 步骤 8：创建草稿

> 创建竖屏草稿（1080×1920），取得草稿 ID 和草稿 URL。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [draft_name]
        properties:
          draft_name:
            type: string
            description: 草稿名称。
          cover_url:
            type: string
            description: 可选，草稿封面图片地址。
```

## 操作规则

1. 调用 `create_draft` 工具，创建竖屏草稿：
   - `width`: 1080
   - `height`: 1920
   - `name`: 草稿名称
   - `cover`: 封面 URL（可选）
2. **必须取得草稿 ID 和草稿 URL**。
3. 创建失败时**停止**，不得进入后续步骤。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 草稿创建成功。
    content:
      application/json:
        schema:
          type: object
          required: [draft_id, draft_url]
          properties:
            draft_id:
              type: string
              description: 草稿 ID。
              examples: ["dfd_xxx"]
            draft_url:
              type: string
              description: 草稿在线链接。
              examples: ["https://www.vectcut.com/draft/downloader?draft_id=dfd_xxx&is_capcut=0"]
            draft_name:
              type: string
              description: 草稿名称。
  "500":
    description: 草稿创建失败，已记录原因。
```
