# 接口约定

基础地址：`https://open.vectcut.com`。

本技能使用的核心接口：

- `/cut_jianying/get_duration`
- `/cut_jianying/extract_audio`
- `/cut_jianying/asr`
- `/cut_jianying/asr_task_status`
- `/cut_jianying/video_detail`
- `/cut_jianying/video_detail_task_status`
- `/cut_jianying/video_capture`
- `/cut_jianying/video_capture_task_status`
- `/cut_jianying/llm`
- `/cut_jianying/llm_task_status`
- `/cut_jianying/create_draft`
- `/cut_jianying/add_video`
- `/cut_jianying/add_image`
- `/cut_jianying/add_audio`
- `/cut_jianying/add_text`
- 查询草稿结构脚本 `scripts/query_script.py`

## 字幕 add_text payload

普通字幕和关键词高亮必须同一次 `add_text` 完成。

```json
{
  "draft_id": "draft_xxx",
  "track_name": "manual_subtitle",
  "text": "今天重点看这个服务",
  "start": 0,
  "end": 1.8,
  "width": 1080,
  "height": 1920,
  "font": "江户招牌",
  "font_color": "#FFFFFF",
  "font_size": 12,
  "font_alpha": 1.0,
  "border_color": "#3488F3",
  "border_width": 30,
  "background_color": "#000000",
  "background_alpha": 0.0,
  "shadow_enabled": true,
  "shadow_color": "#3488F3",
  "shadow_alpha": 0.45,
  "letter_spacing": 0,
  "transform_x_px": 0,
  "transform_y_px": -900,
  "align": 1,
  "fixed_width": 0.65,
  "intro_animation": "渐显",
  "intro_duration": 0.35,
  "text_styles": [
    {
      "start": 2,
      "end": 4,
      "font": "江户招牌",
      "style": {
        "color": "#ffdd00",
        "size": 12
      },
      "border": {
        "color": "#3488F3",
        "width": 30,
        "alpha": 1.0
      }
    }
  ]
}
```

禁止用 `add_text_template` 创建关键词层；关键词只走 `text_styles`。

## 排比短语预设

对 3 到 4 字排比短语使用 `add_preset`，每个短语独立调用一次。固定 `preset_id=3ca1d5d3-0a76-438a-946d-64805a1f5772`，通过 `replacements` 替换 `text1`。`target_start/target_end` 使用 ASR 词级首字开始、末字结束映射到去气口目标时间后的结果；`start` 固定为 `0`，`end` 使用 `target_end-target_start`，把预设内部片段限制为排比短语时长。统一轨道为 `parallel_text_preset`，全片最多 4 个。

## 开场标题 add_text

标题由模型总结两行，使用普通 `add_text` 分别写入 `selling_title_top` 和 `selling_title_bottom`，展示时间为 `0` 到 `min(3.0, total_duration)`。标题字体统一为 `优设标题黑`，文字颜色为白色，描边颜色为 `#3488F3`。第一行使用字号 `18`、描边宽 `23`、黄色背景透明度 `0.0`、`transform_y_px=1450`；第二行使用字号 `15`、描边宽 `35`、黄色背景透明度 `1.0`、`transform_y_px=1200`。两行 `background_height` 和 `background_width` 均为 `0.0`，`transform_x_px=0`，不写入 `manual_subtitle`。

字幕入场动画执行阶段随机均衡选择：无动画、`渐显`、`打字机_III` 各约三分之一。无动画时 `intro_animation` 传空字符串、`intro_duration` 传 `0.0`。

## 素材

- 无素材：不调用素材理解和素材定位，不写 B-roll。
- 视频素材：先 `video_detail` 分析，再由 LLM 匹配文案；写入 B-roll 前可用 `video_capture` 定位画面。
- 图片素材：不调用 `video_detail` 或 `video_capture`；优先使用 `LOCAL_IMAGE_ANALYZER_CMD` 本地理解，最后用 `add_image` 写入草稿。
- 单个视频 B-roll 展示 1 到 3 秒；单个图片 B-roll 展示 1 到 2 秒。
