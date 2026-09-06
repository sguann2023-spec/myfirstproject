# 步骤 11：添加背景音乐（可与步骤 10 并行）

> 从 BGM 列表中随机选一首，添加到草稿中，时长与配音音频一致。
>
> ⚡ **并行执行**：本步骤与步骤 10（添加画面素材）写入不同轨道（音频轨 vs 视频轨），**可以同时调用**，无需等待对方完成。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [draft_id, audio_duration]
        properties:
          draft_id:
            type: string
            description: 步骤 8 创建的草稿 ID。
          audio_duration:
            type: number
            description: 步骤 4 生成的配音音频时长（秒）。
```

## 操作规则

### 11.1 选择 BGM

从 `references/bgm.md` 里随机选一个 BGM URL。

### 11.2 获取 BGM 时长

使用 `get_media_duration` 获取选中 BGM 的原始总时长。

### 11.3 添加 BGM 到草稿

背景音乐的时长必须与配音音频时长一致。添加音频时，截断通过 `start` 和 `end` 参数控制（表示从原始素材中截取的起止时间），`duration` 是原始素材的总时长（不可用于截断）：

**情况 A：BGM 时长 ≥ 配音时长**
- 设置 `start=0`、`end=配音时长` 即可截断多余尾部。

**情况 B：BGM 时长 < 配音时长**
- 需要多次调用 `add_audio` 循环拼接，每次通过 `start` 和 `end` 指定从原始素材中截取的片段范围，直到覆盖完整配音时长（最后一段的 `end` 截断到精确对齐）。

### 11.4 轨道和音量设置

- 背景音乐轨道为 `bgm_audio`
- 音量设置为 `3`

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 背景音乐添加成功。
    content:
      application/json:
        schema:
          type: object
          required: [bgm_url, bgm_duration, loop_count]
          properties:
            bgm_url:
              type: string
              description: 使用的 BGM URL。
            bgm_duration:
              type: number
              description: BGM 原始时长（秒）。
            loop_count:
              type: integer
              description: 循环拼接次数（BGM 不足配音时长时 > 1）。
            target_duration:
              type: number
              description: 目标覆盖时长（等于配音时长）。
  "500":
    description: 背景音乐添加失败，已记录原因。
```
