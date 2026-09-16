# 创建草稿

本文件描述口播卖货混剪的草稿创建步骤。执行时优先使用 `scripts/create_draft.py`。

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

## 草稿命名

草稿名称必须使用“模型总结草稿名称 + 时间戳”：

```text
<draft_title_base>_YYYYMMDD_HHMMSS
```

规则：

- `draft_title_base` 由本地 Codex/本地模型根据口播内容、商品/场景和成交重点总结，不要直接使用固定模板名；脚本优先读取 `--draft-title-json` 或 `LOCAL_DRAFT_TITLE_CMD`，未提供时用本地文案关键词规则兜底。
- `draft_title_base` 建议 6 到 18 个中文字符，能概括本条视频，例如 `日料店餐桌贴膜成交案例`、`玻璃隔热膜旺季接单`。
- 创建草稿前清理 `draft_title_base`：去掉换行、首尾空格、连续空格和文件名非法字符 `/ \ : * ? " < > |`。
- 时间戳使用本地当前时间，格式固定为 `YYYYMMDD_HHMMSS`，例如 `20260730_183522`。
- 如果模型没有返回可用 `draft_title_base`，兜底使用 `口播去气口视频_YYYYMMDD_HHMMSS`。

## 请求体

```json
{
  "width": 1080,
  "height": 1920,
  "cover": "https://example.com/cover.jpg",
  "name": "日料店餐桌贴膜成交案例_20260730_183522"
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
  --name '日料店餐桌贴膜成交案例_20260730_183522' \
  --cover 'https://example.com/cover.jpg' \
  --api-key '<API_KEY>'
```

没有封面时可以省略 `--cover`。
