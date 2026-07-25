# 智能字幕

本文件描述旅行混剪的智能字幕步骤。执行时优先使用 `scripts/generate_smart_subtitle.py`。

调用时必须使用用户本次外部传入的原始 API Key，并通过 `--api-key` 显式传入；不得读取环境变量、使用历史缓存值或手动改写字符。

## 接口

接口文档：`https://docs.vectcut.com/390410295e0`

查询接口文档：`https://docs.vectcut.com/395278111e0`

基础地址：`https://open.vectcut.com`

```http
POST /cut_jianying/generate_smart_subtitle
GET /cut_jianying/smart_subtitle_task_status?task_id=<task_id>
```

## 模板

字幕模板固定从下面四个 ID 里随机选一个：

- `asr_1f9c8d7e6a2b4c0d9e8f123456789abc`
- `asr_6a4f2c9e8b1d4f7aa3c5e9d02b6f8c13`
- `asr_9d550677d16a4c879a19bfeee1623a38`
- `asr_e7c1a9d4b6f24c8e91a3d5b7f0c2e6a8`

## 请求体

```json
{
  "agent_id": "asr_6a4f2c9e8b1d4f7aa3c5e9d02b6f8c13",
  "draft_id": "draft-001",
  "url": "https://example.com/narration.wav",
  "add_media": false
}
```

- `agent_id` 必须从模板列表里随机选一个。
- `draft_id` 是第 8 步创建草稿得到的草稿 ID。
- `url` 是口播音频 URL。
- `add_media` 固定为 `false`。

## 成功条件

提交后必须能拿到 `task_id`。查询成功必须同时满足：

- `status=success`
- `success=true`
- `output.draft_id` 与当前草稿一致
- `output.draft_url` 非空
- `error` 为空

## 脚本

```bash
python scripts/generate_smart_subtitle.py \
  --agent-id asr_6a4f2c9e8b1d4f7aa3c5e9d02b6f8c13 \
  --draft-id draft_xxx \
  --url 'https://example.com/narration.wav' \
  --api-key '<API_KEY>'
```
