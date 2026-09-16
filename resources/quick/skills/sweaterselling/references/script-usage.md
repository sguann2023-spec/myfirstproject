# 脚本用法

基础命令：

```bash
python scripts/run_koubo_keyword_caption.py \
  --api-key '<API_KEY>' \
  --talking-head-url '<口播视频URL>'
```

传入素材时重复追加 `--material-url`，支持图片和视频：

```bash
python scripts/run_koubo_keyword_caption.py \
  --api-key '<API_KEY>' \
  --talking-head-url '<口播视频URL>' \
  --material-url '<图片素材URL>' \
  --material-url '<视频素材URL>'
```

参数：

- `--material-url`：可选，0 到 50 条，支持图片 URL 和视频 URL。
- `--topic`：视频主题，默认 `口播视频`。
- `--asr-effect-mode`：默认 `llm_vad`，可传 `llm` 对比识别效果。
- `--keep-original-duration`：保留原视频全部时长，包括句间停顿和尾部静音；不传时按 ASR 时间轴压缩静音。
- `--image-analysis-json`：可选，读取本地 Codex/本地视觉模型生成的图片分析结果；没有有效本地结果时，脚本自动调用 VectCut LLM `image_url` 兜底。
- `--effect-json`：可选，读取本地 Codex/本地模型生成的统一效果计划；兼容旧参数 `--image-effect-json`。
- `--preset-match-json`：可选，读取本地模型生成的图片预设匹配结果。
- `--image-pip-json`：可选，读取本地模型生成的图片画中画计划。
- `--video-pip-match-json`：可选，读取本地模型生成的视频画中画匹配结果；兼容旧参数 `--video-preset-match-json`。
- `--draft-title-json`：可选，读取本地模型生成的草稿标题，支持 `{"title":"..."}` 或 `{"draft_title_base":"..."}`。
- `--output-root`：默认当前工作目录下 `artifacts/koubo_happy_pink_image_preset_runs`。
- `--max-wait`：异步任务最大等待秒数。

本地模型命令：

- `LOCAL_IMAGE_ANALYZER_CMD`：图片理解命令，脚本会把图片 URL 作为最后一个参数传入。
- `LOCAL_PRESET_MATCHER_CMD`：图片预设匹配命令，脚本会把 `preset_match_input.json` 路径作为最后一个参数传入。
- `LOCAL_IMAGE_PIP_PLANNER_CMD`：图片画中画规划命令，脚本会把 `image_pip_input.json` 路径作为最后一个参数传入。
- `LOCAL_VIDEO_PIP_MATCHER_CMD`：视频画中画匹配命令，脚本会把 `video_pip_match_input.json` 路径作为最后一个参数传入；旧变量 `LOCAL_VIDEO_PRESET_MATCHER_CMD` 仍可兜底。
- `LOCAL_DRAFT_TITLE_CMD`：草稿标题命令，脚本会把 `draft_title_input.json` 路径作为最后一个参数传入。

图片理解顺序固定为：`--image-analysis-json` -> `LOCAL_IMAGE_ANALYZER_CMD` -> VectCut LLM Chat `image_url` -> 失败记录。VectCut LLM 兜底使用 `qwen3.7-plus`，每张图片的提交和轮询结果保存在 `image_llm_material_XX.json`，成功结果保存在 `image_analysis_material_XX.json`，任务 ID 写入 `summary.json` 的 `material_image_llm_task_ids`。

统一效果计划示例：

```json
{
  "effects": [
    {
      "material_index": 1,
      "source_index": 3,
      "effect": "pip",
      "reason": "图片内容适合在讲到店铺活动时作为画中画提示"
    },
    {
      "material_index": 2,
      "source_index": 5,
      "effect": "material_video_pip",
      "material_start": 1.2,
      "reason": "视频素材画面和口播句子匹配"
    }
  ]
}
```

视频画中画里模型只需要决定素材视频的起点和匹配的口播句子；执行时素材视频铺底，口播视频在画布右侧中间显示为小窗。

运行产物：

- `material_classification.json`：素材类型识别结果。
- `timeline.json`：去气口后的口播时间线。
- `image_analysis_material_XX.json`：每张图片的本地理解结果。
- `video_detail_material_video_XX.json`、`video_analysis_material_video_XX.json`：视频素材分析结果和 task id。
- `preset_match_input.json`、`video_pip_match_input.json`、`image_pip_input.json`：本地模型规划输入。
- `image_effect_plan_raw.json`：统一效果计划拆分结果。
- `preset_matches.json`、`material_video_pip_matches.json`、`image_pip_effects.json`：通过校验的效果点。
- `effect_blocked_intervals.json`：三类效果互斥后的占用时间段。
- `preset_video_clip_XX.json`：图片预设使用的 split-video 提交、轮询结果和短视频 URL。
- `preset_writes.json`、`material_video_pip_writes.json`、`image_pip_writes.json`：写入素材效果的请求和响应。
- `draft_title.json`、`draft_name.json`：草稿标题来源和最终草稿名。
- `image_dimensions.json`：图片画中画缩放使用的宽高。
- `subtitle_intro_animations.json`：每条字幕的颜色和入场动画。
