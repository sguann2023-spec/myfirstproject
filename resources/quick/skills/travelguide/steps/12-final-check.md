# 步骤 12：最终校验

> 检查草稿脚本内容，确认轨道连续、字幕/配音/BGM 都已添加。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [draft_id]
        properties:
          draft_id:
            type: string
            description: 步骤 8 创建的草稿 ID。
```

## 操作规则

### 12.1 查询草稿脚本

调用 `query_script` 工具，获取当前草稿的完整脚本内容。

### 12.2 校验项

先重跑一次分镜硬校验脚本（确认 storyboard.json 与交付时点一致）：

```bash
python3 {skill_dir}/scripts/validate_storyboard.py {workspace}/storyboard.json {workspace}/source_durations.json {workspace}/video-understand
```

然后逐项检查以下内容：

1. **轨道连续性**：视频轨道上的片段是否连续无空隙，首段 `start=0`，末段 `end=总时长`。
2. **素材截取范围**：分镜校验脚本无硬错误（每个 `source_end ≤ 素材实测时长，不产生画面缺失）。
3. **字幕**：字幕层是否存在，条数是否合理。
4. **配音**：配音音频轨道是否存在，时长是否与成片时长匹配。
5. **背景音乐**：BGM 轨道（`bgm_audio`）是否存在，音量是否为 `3`。
6. **静音**：视频轨道的音量是否为 `-60`（静音）。

### 12.3 异常处理

- 发现空隙：记录空隙位置，尝试修正。
- 缺少轨道：记录缺失项，尝试补充。
- 无法修正：在最终回复中标注校验失败项。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 最终校验完成。
    content:
      application/json:
        schema:
          type: object
          required: [check_result]
          properties:
            check_result:
              type: object
              properties:
                video_track_continuous:
                  type: boolean
                  description: 视频轨道是否连续。
                source_ranges_valid:
                  type: boolean
                  description: 所有分镜素材截取范围是否在实测时长内（无画面缺失）。
                subtitle_present:
                  type: boolean
                  description: 字幕是否存在。
                audio_present:
                  type: boolean
                  description: 配音是否存在。
                bgm_present:
                  type: boolean
                  description: 背景音乐是否存在。
                video_muted:
                  type: boolean
                  description: 视频轨道是否已静音。
            issues:
              type: array
              description: 发现的问题列表（空数组表示全部通过）。
              items:
                type: string
```
