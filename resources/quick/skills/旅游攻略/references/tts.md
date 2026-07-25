# 口播文案生成音频

本文件描述语音合成的接口请求方式。

- 默认音色为 `gv_989402eaac7b421ca713864f2da2aeb8`。
- 默认 `provider` 为 `volc`。
- 调用时可以从外部传入 `provider` 和 `voice_id`；API Key 必须使用用户本次从外部传入的原始值，并通过脚本参数显式传递。

## 接口

接口文档：`https://docs.vectcut.com/387705655e0`

基础地址：`https://open.vectcut.com`

```http
POST /cut_jianying/generate_speech
```

请求头：

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
Accept: */*
```

## 默认参数和外部输入

旅行攻略口播默认使用：

```json
{
  "provider": "volc",
  "voice_id": "gv_989402eaac7b421ca713864f2da2aeb8",
  "only_tts": true
}
```

外部可传入：

- `provider`：覆盖默认 `volc`。
- `voice_id`：覆盖默认音色。
- `api_key`：必填的接口鉴权密钥；必须来自用户本次外部输入，脚本中使用 `--api-key` 传入。不得读取 `VECTCUT_TOKEN`、不得使用历史缓存值、不得手动改写字符。

`only_tts` 始终固定为 `true`，不允许外部改成其他值。

默认补充参数：

```json
{
  "speed": 1.0,
  "track_name": "travel_tts_audio_1",
  "model": ""
}
```

## 请求体

```json
{
  "provider": "volc",
  "voice_id": "gv_989402eaac7b421ca713864f2da2aeb8",
  "text": "这里是生成好的旅行攻略口播文案。",
  "only_tts": true,
  "speed": 1.0,
  "track_name": "travel_tts_audio_1",
  "model": ""
}
```

`text` 必须是已经生成或用户提供的口播文案，不能为空，最多 1000 个汉字。请求只传上面这些业务字段，不附加内部控制字段。

## 成功条件

响应必须满足：

- HTTP 请求成功。
- 响应能解析为 JSON。
- `success` 不为 `false`。
- 能从 `output.audio_url` 取得非空音频 URL；兼容根级 `audio_url`。

成功示例：

```json
{
  "success": true,
  "output": {
    "audio_url": "https://example.com/tts.wav"
  }
}
```

失败或缺少音频 URL 时停止，不要把 HTTP 200 当成生成成功。

## 后续处理

拿到音频 URL 后必须继续：

1. 查询音频时长。
2. 对音频做 ASR。
3. 用 ASR 时间轴进入分镜规划。

## 脚本

专门脚本：

```bash
python scripts/generate_tts.py \
  --text '潮汕什么时候最好玩？当然是现在！' \
  --provider volc \
  --voice-id gv_989402eaac7b421ca713864f2da2aeb8 \
  --api-key '<API_KEY>'
```
