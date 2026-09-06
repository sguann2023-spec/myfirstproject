# 步骤 10：添加画面素材（可与步骤 11 并行）

> 读取分镜计划，批量添加视频片段到草稿。目标时间轴连续无空隙，静音处理避免原始视频声音干扰。
>
> ⚡ **并行执行**：本步骤与步骤 11（添加 BGM）写入不同轨道（视频轨 vs 音频轨），**可以同时调用**，无需等待对方完成。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [storyboard_path, media_sources, draft_id]
        properties:
          storyboard_path:
            type: string
            description: 步骤 6 的分镜计划文件路径（storyboard.json）。
          media_sources:
            type: array
            description: 素材列表。
            items:
              type: string
          draft_id:
            type: string
            description: 步骤 8 创建的草稿 ID。
```

## 操作规则

### 10.1 运行准备脚本（含二次硬校验）

**调用 add_batch_video 前必须先跑一次分镜硬校验**（防止步骤 6 之后 storyboard.json 被手工修改引入新问题）：

```bash
python3 {skill_dir}/scripts/validate_storyboard.py {workspace}/storyboard.json {workspace}/source_durations.json {workspace}/video-understand
```

脚本存在硬错误时：回到步骤 6 修复分镜，禁止带病添加视频（否则目标时间轴会出现黑屏/画面缺失）。

然后运行 `scripts/prepare_batch_video.py` 脚本读取 `storyboard.json`，自动完成：
- 解析每个分镜的素材路径
- 通过 ffprobe 获取各素材原始总时长
- 校验分镜时间连续性
- 校验 `source_end` 是否超出素材实际时长
- 输出 `add_batch_video` 所需的全部参数（JSON 格式）

```bash
python3 {skill_dir}/scripts/prepare_batch_video.py {workspace}/storyboard.json <素材目录路径>
```

### 10.2 脚本必须确保的两点

1. **目标视频轨道上的时间必须连续无空隙**——即每个分镜的 `target_start` 必须等于上一个分镜的 `target_end`，首段 `target_start=0`，最后一段 `target_end` 等于总分镜时长，不允许出现任何时间间隙。如果分镜之间存在间隙，脚本必须自动消除。
2. **`durations` 参数必填**——每个视频片段必须传入该素材的原始总时长（脚本已通过 ffprobe 自动获取，单位为秒），不是目标时间轴上的播放时长，否则 API 会报"视频时长无效: 0.0"错误。

### 10.3 批量添加视频

使用脚本返回的参数调用 `add_batch_video` 一次性将所有分镜的视频片段添加到草稿中：
- `target_starts` 和 `target_ends` 必须同时传递（都是数组），只传其中一个会报错。
- ⚠️ **`volume=-60` 为必填参数**（单位 dB，-60 即静音），必须在 `add_batch_video` 调用中显式传入，不可省略。遗漏会导致视频原声干扰配音和 BGM。调用示例：
  ```
  add_batch_video(
    video_urls=[...],
    starts=[...], ends=[...], durations=[...],
    target_starts=[...], target_ends=[...],
    volume=-60   # ← 必填，静音原始视频音轨
  )
  ```

### 10.4 失败兜底

如果批量添加失败，则回退为逐条串行添加作为兜底方案。发生素材轨道冲突时先修正时间轴，只在明确轨道重叠错误时重试备用轨道。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 画面素材添加成功。
    content:
      application/json:
        schema:
          type: object
          required: [added_count, mode]
          properties:
            added_count:
              type: integer
              description: 成功添加的视频片段数量。
            mode:
              type: string
              enum: [batch, sequential]
              description: 添加模式（批量或逐条兜底）。
  "500":
    description: 画面素材添加失败，已记录原因。
```
