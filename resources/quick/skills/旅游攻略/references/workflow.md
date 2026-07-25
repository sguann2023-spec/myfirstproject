# 旅行混剪远程执行顺序

本文件只描述顺序和状态机；每个接口的 HTTP 方法、请求体、响应体和字段提取规则见 [接口契约](api-contracts.md)。技能在外部智能体中运行，只调用远程接口，不读取或执行当前仓库代码。

## 认证

所有请求都必须使用用户本次外部传入的原始 API Key，脚本调用必须通过 `--api-key` 显式传入；不得读取 `VECTCUT_TOKEN`、使用历史缓存值或手动改写字符。请求头使用：

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

只调用本技能列出的基础接口，不额外发起任务代理、资源计算或计费流程；请求只传业务参数。

## 顺序

1. 规范化输入，先确定每个旅行素材的 `material_type`，再校验模式互斥、文案长度、源时长和目标时长。类型按显式 `type`、URL `path`、HTTP MIME、文件头顺序判断；无法确认时停止该素材，不默认当视频。
2. 并发查询已确认的视频时长，图片记为 `0`，图片不调用视频时长接口。
3. 并发分析素材：图片先走 LLM Chat `image_url` 识别内容并转成简洁文字描述；本地视频先上传成临时链接，再走 video detail；不超过 120 秒的视频按抽帧率理解，超过 120 秒的视频跳过整体理解。
4. 如果用户只给 `topic` 和旅行素材，按 [旅行混剪分镜提示词](llm-prompts.md) 里的攻略口播文案生成提示词，结合主题、可选人群/天数/预算和素材分析生成一条 `text_contents`。
5. 对生成的或用户给定的 `text_contents` 使用 `scripts/generate_tts.py` 生成口播音频；具体 TTS 参数和成功条件只看 [口播文案生成音频](tts.md)，成功后必须取得音频 URL。
6. `audio_urls`：查询时长后使用 `scripts/recognize_subtitles.py` 识别字幕；`video_urls`：提取音频、查询提取音频时长、再识别字幕；已生成的口播音频：查询音频时长、再识别字幕。字幕识别固定使用 LLM 档位，具体规则只看 [口播音频识别字幕](subtitles.md)；`broll_only`：建立 `0..target_duration` 的虚拟时间轴。
7. 收集长素材的搜索词，对每个唯一 `(video_url, search_sentence)` 最多请求一次画面定位，最多 4 个并发任务；先尽量用图片描述找图片，找不到再用视频定位结果补位。
8. 对每个口播源或纯素材目标时间轴调用一次 LLM Chat 规划，结合字幕时间轴、图片描述和视频理解结果严格解析 `plans` 并校验覆盖、索引和时间；口播模式始终以字幕时间轴为主轴，让图片和视频内容向主轴靠拢。
9. `broll_only` 额外调用一次 LLM Chat 提取最多 4 个关键词。
10. 为唯一计划和每个选定字幕模板生成一个草稿。计划只有 1 套；多个字幕模板产生 `1 x 模板数` 个草稿。
11. 口播模式先用 `scripts/generate_smart_subtitle.py`，字幕模板从 4 个固定 ID 里随机挑一个，再轮询 `smart_subtitle_task_status`；纯素材模式跳过字幕。
12. 按计划添加视频、图片和图片缩放关键帧。
13. 添加 BGM；从 `references/bgm.md` 里随机选一个，口播模式再添加 `audio_source`，纯素材模式不添加。
14. 纯素材模式按命中的画面片段添加关键词文字模板。
15. 生成封面元数据，先用 `scripts/query_script.py` 做最终校验，记录草稿结果并返回。默认只交付草稿，不额外渲染成片。

## 轮询规则

| 任务 | 轮询间隔 | 总超时 | 完成条件 |
|---|---:|---:|---|
| ASR | 5 秒 | 1800 秒 | `status=success` 且 `result.segments` 非空 |
| LLM Chat | 2 秒 | 1200 秒 | 返回可解析的 JSON 规划 |
| Video detail | 2 秒 | 600 秒 | `status=success`、进度 100 或完成消息 |
| Video capture | 2 秒 | 600 秒 | 成功且能提取 timestamp |
| Smart subtitle | 5 秒 | 1800 秒 | `status=success`、`success=true` 且 `output.draft_id`、`output.draft_url` 完整 |

失败状态或 `success=false` 立即停止当前步骤。超时返回 `task_id`、最后一次响应和接口名；不能伪造时间轴或素材分析。

## 重试规则

- ASR 不自动重试同一个成功之外的任务；失败直接报告，避免重复计费和重复时间轴。
- Video detail 单个素材最多重试一次。
- LLM 规划解析或时间轴校验失败，使用同一输入完整重试一次；第二次失败停止。
- Video capture 使用 `(video_url, search_sentence)` 缓存；同一键不重复请求，结果里的时间戳用于后续 `add_image` 或 `add_video` 的 `start`、`end`、`target_start`。
- `add_video` 只有服务端错误明确包含 `overlap` 或 `重叠` 时，才用 `track_name=<原轨道>_fill`、`relative_index=2` 重试一次。
- `generate_smart_subtitle`、`add_image`、`add_video_keyframe`、`add_audio`、`add_text_template` 任一写入失败，停止当前草稿，不把局部草稿报告为完成。
- 智能字幕查询返回 `status=processing` 且 `success=false` 时继续轮询；只有 `status=success`、`success=true` 且返回当前草稿 ID 和非空草稿 URL 才结束任务。其他失败状态停止当前草稿。

## 草稿变体

先完成输入、ASR、素材分析和 LLM 分镜，再逐个创建草稿。草稿名为：

```text
<用户自定义 title 或 旅行混剪-YYYY-MM-DD_HH_MM_SS><计划后缀><字幕风格后缀>
```

用户自定义名称不追加时间戳；计划后缀固定为 `_1`。创建成功后保存 `draft_id`、`draft_url`，之后每个写入请求都带同一 `draft_id`。
