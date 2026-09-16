# 输入格式

必需：

- `talking_head_url`：公网口播视频 URL 或本地口播视频上传后的公网 URL。
- `api_key`：用户本次消息显式传入的 VectCut API Key。

可选：

- `material_urls`：图片或视频素材 URL 列表，0 到 50 条。
- `topic`：视频主题。
- `asr_effect_mode`：`llm_vad` 或 `llm`，默认 `llm_vad`。
- `keep_original_duration`：可选；启用后保留句间停顿和尾部静音，草稿时长与原口播视频一致。
- `image_analysis_json`：可选，本地 Codex 或本地视觉模型提前生成的图片分析 JSON 路径。
- `image_effect_json`：可选，本地 Codex 或本地模型提前生成的统一图片效果计划 JSON 路径；每条效果必须指定 `effect=preset` 或 `effect=pip`。
- `preset_match_json`：可选，本地 Codex 或本地模型提前生成的图片-口播句子匹配 JSON 路径。
- `image_pip_json`：可选，本地 Codex 或本地模型提前生成的图片画中画计划 JSON 路径。
- `draft_title_json`：可选，本地 Codex 或本地模型提前生成的草稿标题 JSON 路径，支持 `{"title":"..."}` 或 `{"draft_title_base":"..."}`。

行为：

- `material_urls=[]` 时，只生成快乐体粉白字幕口播模板，不调用素材预设或画中画。
- `material_urls` 非空时，按图片和视频分类；未知类型素材跳过。
- 图片理解优先读取 `image_analysis_json`，其次调用 `LOCAL_IMAGE_ANALYZER_CMD` 指向的本地视觉模型命令；本地分析没有返回有效语义时，自动调用 VectCut LLM Chat 的 `image_url` 进行图片理解；只有本地和远程视觉分析都失败时，才记录 `metadata_fallback`，此时不得根据文件名编造图片内容。
- 图片效果选择优先读取 `image_effect_json`；未提供时，预设匹配优先读取 `preset_match_json` 或调用 `LOCAL_PRESET_MATCHER_CMD`，画中画优先读取 `image_pip_json` 或调用 `LOCAL_IMAGE_PIP_PLANNER_CMD`；未配置规划器时用本地关键词规则兜底，但不能把关键词规则当作图片理解结果。
- 效果选择按素材内容和文案阶段区分：商品整体图匹配开场推荐、整体外观、款式、价格或入手话术时使用图片画中画；细节/特写图匹配摸起来、看起来、材质、面料、纹理、柔软、亲肤或做工话术时使用图片+口播片段细节预设。整体图不得误用细节预设，细节图不得优先用于开场整体画中画。
- 同一素材只能使用一种效果；图片预设、视频画中画和图片画中画展示时间段不能重叠，重叠候选跳过。
- 图片预设匹配成功时，按命中 ASR 句子的源视频开始时间截取口播短视频；再调用指定预设，把 `image1` 替换为图片 URL，把 `video1` 替换为截取后的短视频新 URL。`add_preset.start/end` 必须使用 `0 -> 预计截取的原视频时长`，不要传口播源视频的绝对起止时间。
- 视频画中画匹配成功时，视频素材按匹配起点作为背景铺满画布，口播视频按命中 ASR 句子的源时间显示为右侧中间画中画；执行层会拆开对应区间的全屏口播主轨，避免遮挡背景。
- 草稿名称由口播文案标题基础词加本地时间戳组成；优先读取 `draft_title_json` 或调用 `LOCAL_DRAFT_TITLE_CMD`，未配置时用本地文案关键词规则兜底。
- `pip` 匹配成功时调用 `add_image` 添加画中画，展示固定 2 秒；位置 `transform_x_px=0`、`transform_y_px=0`；缩放按 1080x1920 画布和图片实际尺寸计算，未知尺寸时兜底 `0.42`；入场动画 `便利贴`，出场动画 `向上滑动`；起点距离片尾不足 2 秒时跳过。
