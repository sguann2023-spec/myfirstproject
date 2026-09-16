# 步骤 4：整理时间轴

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [cleaned_path, raw_result_path, duration, remove_silence]
        properties:
          cleaned_path:
            type: string
            description: 步骤 3 的清洗后分句文件。
          raw_result_path:
            type: string
            description: 步骤 2 的原始 ASR 结果文件（词级时间戳来源）。
          duration:
            type: number
            description: 视频时长（秒），步骤 1 查询结果。
          remove_silence:
            type: boolean
            description: 去气口开关。
```

## 操作规则

**【读取 `references/workflow.md` 获取时间轴计算规则】**

### 4.1 去气口模式（`remove_silence=true`）

调用技能目录下的脚本自动计算时间轴：

```bash
python3 {skill_dir}/scripts/build_timeline.py --cleaned {workspace}/asr_cleaned_sentences.json --raw {workspace}/asr_raw_result.json --duration {视频时长} --output {workspace}/timeline.json
```

脚本自动完成：相邻句间距判断（≥0.6s 重叠 0.6s 转场 / 不足 0.6s 中间点切割连贯拼接）、切割点计算、词级时间映射、连续性验证。主视频比文字前后各多 0.3 秒。

### 4.2 不去气口模式（`remove_silence=false`）

**跳过 `build_timeline.py` 脚本调用——不去气口时不需要进行视频切分。**

直接用 ASR 原始语句边界构建简化时间轴：

- 每段 `target_timeline.start = source_video.start`、`target_timeline.end = source_video.end`（目标时间 = 源视频时间）。
- 所有片段 `transition_to_next = null`（段落之间硬切）。
- 保存为 `{workspace}/timeline.json`，字段结构与去气口模式保持一致，供后续步骤统一消费。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 时间轴就绪。
    content:
      application/json:
        schema:
          type: object
          required: [timeline_path, total_target_duration]
          properties:
            timeline_path:
              type: string
              description: 时间轴文件路径。
              examples: ["/Users/xxx/工作空间/timeline.json"]
            total_target_duration:
              type: number
              description: 目标时间轴总时长（秒）。
            segment_count:
              type: integer
              description: 视频段数（不去气口时等于 ASR 句段数或整段数）。
            mode:
              type: string
              enum: [remove_silence, original]
              description: 时间轴模式。
```

