# 创建草稿

本文件描述旅行混剪的草稿创建步骤。执行时优先使用 `scripts/create_draft.py`。

调用时必须使用用户本次外部传入的原始 API Key，并通过 `--api-key` 显式传入；不得读取环境变量、使用历史缓存值或手动改写字符。

## 接口

接口文档：`https://docs.vectcut.com/321174266e0`

基础地址：`https://open.vectcut.com`

```http
POST /cut_jianying/create_draft
```

请求头：

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
Accept: */*
```

## 请求体

```json
{
  "width": 1080,
  "height": 1920,
  "cover": "https://example.com/cover.jpg",
  "name": "旅行混剪-示例_1"
}
```

- `width` 固定默认 1080。
- `height` 固定默认 1920。
- `cover` 可传封面 URL，也可以传 `null`。
- `name` 必填。

## 成功条件

响应必须满足：

- HTTP 请求成功。
- 响应能解析为 JSON。
- `success` 不为 `false`。
- `output.draft_id` 非空。
- `output.draft_url` 非空。

成功示例：

```json
{
  "success": true,
  "output": {
    "draft_id": "draft-001",
    "draft_url": "https://www.vectcut.com/draft/downloader?draft_id=draft-001&is_capcut=0"
  }
}
```

缺少草稿 ID 或 URL 时停止，不要继续写入。

## 脚本

```bash
python scripts/create_draft.py \
  --name '旅行混剪-示例_1' \
  --cover 'https://example.com/cover.jpg' \
  --api-key '<API_KEY>'
```

没有封面时可以省略 `--cover`。
