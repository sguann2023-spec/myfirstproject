# 旅行混剪输入配置

## 默认旅行攻略混剪

用户只需要提供旅行主题和旅行素材视频。没有口播音频、口播视频或现成文案时，技能先根据主题和素材理解结果生成一段攻略型口播文案，再进入配音和混剪流程。

```json
{
  "topic": "潮汕五天四晚亲子游",
  "material_urls": [
    "https://example.com/chaoshan-bridge.mp4",
    "https://example.com/lighthouse.mp4",
    "https://example.com/beach.mp4"
  ],
  "subtitle_templates": ["asr_6a4f2c9e8b1d4f7aa3c5e9d02b6f8c13"]
}
```

必填：

- `topic`：旅行主题，可以是目的地、玩法、天数、人群和预算的组合，例如“潮汕五天四晚亲子游”。
- `material_urls` 或 `kongjing_urls`：旅行素材视频数组；也接受带 `url` 和 `type` 的对象。

可选：

- `people`：同行人群，例如“一家三口”“闺蜜两人”“情侣”。
- `days`：行程天数，例如“五天四晚”。
- `budget`：预算表达，例如“人均八百”。
- `style_reference`：用户提供的口播风格参考。没有提供时，默认使用“现在最好玩、收藏攻略、低预算玩转、行程不赶不累、站点打卡、评论区领攻略”的旅行攻略号风格。

此模式会自动生成一条 `text_contents`。生成文案必须少于 1000 字，默认控制在 180 到 280 个汉字；如果素材里能识别出多个景点或画面，按“第一站、第二站……”组织。生成后正常调用 TTS，再对返回音频进行 ASR。

## 口播音频旅行混剪

```json
{
  "audio_urls": ["https://example.com/narration.wav"],
  "kongjing_urls": [
    {"url": "https://example.com/scene-01.mp4", "type": "video"},
    {"url": "https://example.com/scene-02.jpg", "type": "image"}
  ],
  "title": "海岛徒步",
  "subtitle_templates": ["asr_6a4f2c9e8b1d4f7aa3c5e9d02b6f8c13"]
}
```

空镜也可以继续传 URL 字符串。对于 OSS 签名地址，技能必须解析 URL 的路径部分再识别扩展名，不能把 `?OSSAccessKeyId=...&Expires=...&Signature=...` 当成文件名的一部分；没有扩展名时再检查 HTTP MIME 和文件头。显式 `type` 优先于所有自动判断。

## 口播视频旅行混剪

```json
{
  "video_urls": ["https://example.com/talking-head.mp4"],
  "material_urls": ["https://example.com/broll.mp4"],
  "cover_url": "https://example.com/cover.jpg"
}
```

系统会从口播视频远程提取音频做 ASR，并根据计划把人物画面和空镜交错放入草稿。

## 配音文案旅行混剪

```json
{
  "text_contents": [
    {
      "text": "这里是需要生成口播的文案。",
      "provider": "volc",
      "voice_id": "gv_989402eaac7b421ca713864f2da2aeb8",
      "model": ""
    }
  ],
  "kongjing_urls": ["https://example.com/broll.mp4"]
}
```

每项文案不超过 1000 字，最多 5 项。省略 `provider` 或 `voice_id` 时，默认使用 `volc` 和 `gv_989402eaac7b421ca713864f2da2aeb8`；旅行攻略口播优先使用这个默认音色。每项先正常调用 TTS，再对返回音频进行 ASR；请求只传业务参数。

## 不配音旅行素材混剪

```json
{
  "mix_mode": "broll_only",
  "target_duration": 45,
  "kongjing_urls": [
    {"url": "https://example.com/scene-01.mp4", "type": "video"},
    {"url": "https://example.com/scene-02.jpg", "type": "image"}
  ]
}
```

`target_duration` 必须大于 0 且不超过 180 秒。此模式不调用 TTS、ASR，不添加 `audio_source`，但仍会执行素材分析、LLM 分镜、BGM 和最终时间轴校验。

口播模式必须传 `subtitle_templates`，或者先让用户从官方字幕模板列表中选择。可使用模板名称或完整 ID，例如 `asr_6a4f2c9e8b1d4f7aa3c5e9d02b6f8c13`（双语模版·轻奢金）。未选择前不要创建草稿，也不要手工猜测字幕字体。选择后使用 `generate_smart_subtitle` 和 `smart_subtitle_task_status` 添加字幕。

## 可选覆盖

```json
{
  "draft_name": "我的混剪",
  "cover_urls": ["https://example.com/cover.jpg"],
  "subtitle_templates": ["39ff", "6a4f"],
  "generate_video": false
}
```

用户明确提供 `draft_name` 时原样使用，不再追加时间戳；默认名称才使用时间戳和计划后缀。`generate_video` 默认关闭，开启后才渲染并轮询成片任务。
