# 输入格式

必需：

- `talking_head_url`：公网口播视频 URL 或本地口播视频上传后的公网 URL。
- `api_key`：用户本次消息显式传入的 VectCut API Key。

可选：

- `material_urls`：补充素材 URL 列表，0 到 50 条，支持视频或图片 URL。
- `topic`：视频主题。
- `asr_effect_mode`：`llm_vad` 或 `llm`，默认 `llm_vad`。

行为：

- `material_urls=[]` 时，全程展示口播视频内容。
- `material_urls` 非空时，分析素材并按文案匹配穿插；视频单段 1 到 3 秒，图片单段 1 到 2 秒。
- 素材不匹配时不强行插入。
- 图片素材按 URL 后缀识别，优先使用 `LOCAL_IMAGE_ANALYZER_CMD` 指向的本地图片理解命令；未配置时用本地元信息兜底。
