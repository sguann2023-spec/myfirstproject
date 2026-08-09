# 脚本使用

脚本路径：

```text
scripts/koubo_c6f1_atomic_task.py
```

该脚本是本 skill 的执行入口示例，必须按原子接口逐步创建草稿，不得调用既有模板总函数。

## 参数

```bash
python scripts/koubo_c6f1_atomic_task.py \
  --jwt-token "$VECTCUT_JWT_TOKEN" \
  --video-url "https://example.com/talking.mp4" \
  --title "可选标题" \
  --text-content "可选文案" \
  --material-url "https://example.com/material.mp4" \
  --remove-silence true
```

可重复传入 `--material-url`。

## dry-run

```bash
python scripts/koubo_c6f1_atomic_task.py --dry-run
```

dry-run 只校验样式参数、层级、互斥窗口和关键词限频，不调用远端接口。

## 日志

日志路径：

```text
.cache/koubo_c6f1_debug/<message_id>_brush_pip.jsonl
```

日志需要包含：

- 输入摘要。
- ASR/去气口摘要。
- LLM 请求和响应。
- 素材分析摘要。
- 图片素材优先通过 `--image-analysis-json` 传入当前 Codex/本地视觉模型的分析结果；未提供或结果无效时，脚本自动调用 VectCut LLM 的 `image_url` 视觉接口，不使用文件名推断图片内容。
- 最终轨道 items。
- 每次 VectCut API 响应。
