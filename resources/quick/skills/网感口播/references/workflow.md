# 1f9c 高级红工作流参考

本文件说明外部 Agent 如何把 ASR、模型规划和 VectCut 写草稿串起来。接口调用统一走 `scripts/koubo_1f9c_api.py`，不要依赖当前代码仓库。

## 接口入口

| 操作 | 脚本命令 | VectCut 接口 |
|---|---|---|
| 上传本地视频 | `upload-video` | `/sts/upload/agent_tmp/init` + OSS 表单上传 |
| 查询时长 | `duration` | `/cut_jianying/get_duration` |
| ASR 提交和轮询 | `asr submit-and-wait` | `/llm/asr/asr_llm/submit_task/*` |
| 执行工作流 | `execute-workflow` | `/cut_jianying/execute_workflow` |
| 查询草稿结构 | `query-script` | `/cut_jianying/query_script` |
| 渲染预览 | `render submit-and-wait` | `/cut_jianying/generate_video` + `/cut_jianying/task_status` |

`create-draft`、`add-video`、`add-text`、`add-audio`、`add-preset`、`add-keyframe` 只用于排查单个动作，不作为正常生产路径。

## 异步状态

ASR 和渲染这类异步任务都按同一状态机处理：

- `status=processing`、`status=pending` 或 `success=false` 但没有失败状态时继续轮询。
- `status=success`、`status=completed`、`status=done`、`status=finished` 或 `progress=100` 视为完成。
- `status=failed`、`status=error`、`status=cancelled` 视为失败。
- 轮询间隔建议 `2-5` 秒，最长等待 `1200` 秒。

ASR 成功必须取得非空 `segments`。如果 `llm_vad` 没有有效句子，用 `effect_mode=llm` 重试一次。

## 多视频处理

把公网 URL 和本地上传得到的临时 URL 合并成视频列表。每个视频独立处理：

1. 查询源视频时长。
2. ASR 识别。
3. 整理去气口时间轴。
4. 模型生成高级红规划。
5. 校验规划。
6. 执行当前视频的 workflow。
7. 查询草稿结构校验。

多视频返回统一使用：

```json
{
  "drafts": [
    {
      "source_video": "https://example.com/1.mp4",
      "status": "success",
      "draft_id": "dfd_xxx",
      "draft_url": "https://www.vectcut.com/draft/downloader?draft_id=dfd_xxx&is_capcut=0",
      "timeline_duration": 32.5,
      "asr_count": 18,
      "subtitle_count": 24
    }
  ]
}
```

## 去气口时间轴

`remove_silence=true` 表示开启去气口。根据 ASR 句段生成连续目标时间轴：

- 每个 ASR 句段保留 `source_index`、`text`、`source_start/source_end`、`target_start/target_end` 和 `words`。
- 每个有效片段前后最多借用 `1.0` 秒可用静音间隙。
- 借用不能超过源视频边界，不能与相邻片段重叠。
- 平移后必须保证目标时间轴连续，不能出现空洞。
- `timeline_segments` 的数量、顺序和文字必须与原始有效 ASR 段一一对应。

`remove_silence=false` 表示关闭去气口。目标时间直接使用源视频时间，主视频可以按完整视频或连续片段写入。

ASR 时间单位必须对同一次响应整体判断：只要任一句段明显是毫秒，全部句段和词级时间统一除以 `1000`。

## 模型规划

模型规划由当前 Codex 或接入方 Agent 自己完成，不调用 VectCut 远程 LLM Chat 接口。模型输入使用时间轴后的 `segments`，输出一次性包含：

- `title`：`top_title`、`bottom_title`。
- `subtitle_items`：普通字幕、分层字幕、英文字幕、关键词、高亮、弹出层所需字段。
- `transitions`：从 `向右`、`向左`、`竖向模糊` 中选择，每种最多一次。
- `zoom`：最多一处，缩放 `1.2`。
- `tone_presets`：结果音和强调音各最多一次。
- `bgm`：从固定 BGM 列表中选择一条。

规划必须遵守 `references/llm-prompts.md` 的字段和校验规则。不能跨 `source_index` 合并字幕，不能改写原文。

## 工作流写入策略

完成 ASR、去气口时间轴和模型规划后，不要逐条串行调用 `add_video`、`add_text`、`add_audio`、`add_preset`、`add_video_keyframe`。应该为当前视频组装一个完整 workflow，并调用：

```bash
python scripts/koubo_1f9c_api.py --api-key "$VECTCUT_API_KEY" execute-workflow --workflow-file "/tmp/koubo_1f9c_workflow.json"
```

工作流采用 `inputs + script` 结构。推荐顺序：

1. `create_draft`：创建 `1080x1920` 草稿。用户自定义 `draft_name` 原样使用；多视频时追加序号；未指定时使用“高级红口播”加时间戳。
2. `add_video`：按去气口后的 `clip_ranges` 循环添加主视频片段，轨道 `video_main`，音量 `20`，必要时带转场；所有转场的 `transition_duration` 固定为 `0.2` 秒。
3. `add_text`：添加开头标题。
4. `add_text`：循环添加中文、英文、关键词高亮和关键词弹出文字层。关键词弹出必须用源码的全角空格占位叠加方式：原字幕显示层使用 `*_display_text` 挖空关键词，关键词弹出层使用同长度 `*_keyword_pop_text` 只露关键词，并复用原字幕层的坐标、`fixed_width` 和 `align`。
   分层字幕必须按层复用固定轨道：`yimei_layered_top`、`yimei_layered_bottom`、`yimei_layered_top_en`、`yimei_layered_bottom_en`；分层关键词弹出复用 `yimei_layered_top_keyword_pop` 和 `yimei_layered_bottom_keyword_pop`。不要按字幕序号创建独立分层轨道。
5. `add_video_keyframe`：如果命中缩放句，给 `video_main` 添加缩放关键帧。
6. `add_preset`：添加结果音和强调音，每个 preset 最多一次。
7. `add_audio`：循环添加 BGM，铺满目标时间轴。

workflow 成功只表示写入完成，仍要用 `query-script` 查询草稿结构做最终校验。若 workflow 失败，再用单个 `add-*` 命令调试定位问题。

## 关键词弹出写入校验

生成 workflow 前必须检查关键词弹出字段：

- `normal_display_text` 和 `normal_keyword_pop_text` 长度必须等于原普通中文字幕长度。
- `top_display_text` 和 `top_keyword_pop_text` 长度必须等于原上行中文字幕长度。
- `bottom_display_text` 和 `bottom_keyword_pop_text` 长度必须等于原下行中文字幕长度。
- `*_display_text` 中弹出关键词位置必须是全角空格 `\u3000`。
- `*_keyword_pop_text` 中非关键词位置必须是全角空格 `\u3000`。
- 弹出层位置必须复用对应原字幕层位置：普通层复用 `normal_y_px`，上行复用 `top_x_px/top_y_px/align=0/fixed_width=0.78`，下行复用 `bottom_x_px/bottom_y_px/align=2/fixed_width=0.86`。
- 弹出层层级必须高于对应原字幕显示层：普通 `10022 > 10020`，上行 `10034 > 10030`，下行 `10035 > 10032`。
- 没有 `打字机_I` 动画的字幕不能进入 `top_keyword_pop_texts`、`bottom_keyword_pop_texts` 或 `normal_keyword_pop_texts`。
- 所有分层上行、下行及其英文、关键词弹出都必须使用共享轨道；同一层的多个字幕片段在同一个轨道里按时间排列。

## BGM 列表

从下面列表随机选择一条，查询时长后循环铺满时间轴。查询 BGM 时长失败时按 `5.0` 秒切片兜底，最多 200 段。

```text
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/void.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/time_to_pretend.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/the_right_path.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/spoons_for_loons.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/night_cruising.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Monsieur_melody.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/melody_mix.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/IV_feat.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Golden_hour.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Fight.MP3
```

## 输出校验

最终至少检查：

- 草稿 ID 和草稿链接非空。
- 主视频片段覆盖目标时间轴，没有大段空白。
- 标题存在，结束时间为 `min(5.0, timeline_duration)`。
- 中文字幕和英文字幕数量与规划一致。
- 关键词弹出只在命中打字机动画的字幕上出现。
- 转场不超过三种固定类型。
- 缩放最多一处。
- BGM 覆盖到时间轴末尾。
