# 脚本用法

使用新技能自带脚本：

```bash
python scripts/run_koubo_keyword_caption.py \
  --api-key '<API_KEY>' \
  --talking-head-url '<口播视频URL>'
```

传素材时重复追加，素材可以是视频或图片：

```bash
python scripts/run_koubo_keyword_caption.py \
  --api-key '<API_KEY>' \
  --talking-head-url '<口播视频URL>' \
  --material-url '<素材1URL>' \
  --material-url '<素材2URL>'
```

参数：

- `--material-url`：可选，0 到 50 条；不传时全程展示口播视频。
- `--topic`：视频主题，默认 `口播视频`。
- `--asr-effect-mode`：默认 `llm_vad`，可传 `llm` 对比识别效果。
- `--output-root`：默认当前工作目录下 `artifacts/koubo_keyword_caption_runs`。
- `--max-wait`：异步任务最大等待秒数。

字幕固定写入 `manual_subtitle` 轨道，普通文字和关键词都通过同一次 `add_text` 请求完成；关键词样式必须使用 `text_styles`。字幕入场动画会在无动画、`渐显`、`打字机_III` 三档中均衡随机选择，实际结果写入运行目录的 `subtitle_intro_animations.json`。

图片素材会自动识别，优先调用 `LOCAL_IMAGE_ANALYZER_CMD` 指向的本地图片理解命令；图片展示时长固定受控在 1 到 2 秒。
