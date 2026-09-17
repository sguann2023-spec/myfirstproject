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

调用技能目录下的脚本自动计算时间轴（输出含 `mode: "remove_silence"` 字段）：

```bash
python3 {skill_dir}/scripts/build_timeline.py --cleaned {workspace}/asr_cleaned_sentences.json --raw {workspace}/asr_raw_result.json --duration {视频时长} --output {workspace}/timeline.json
```

脚本自动完成：相邻句间距判断（≥0.6s 重叠 0.6s 转场 / 不足 0.6s 中间点切割连贯拼接）、切割点计算、词级时间映射、连续性验证。主视频比文字前后各多 0.3 秒。

### 4.2 不去气口模式（`remove_silence=false`）

调用同一脚本的去气口关闭模式，自动构建简化时间轴（**target = source，保留原始停顿空档，段落硬切**）：

```bash
python3 {skill_dir}/scripts/build_timeline.py --cleaned {workspace}/asr_cleaned_sentences.json --raw {workspace}/asr_raw_result.json --duration {视频时长} --output {workspace}/timeline.json --keep-pauses
```

脚本自动完成：每段 `target_timeline = source_video`（目标时间 = 源时间）、段间保留原始停顿、`transition_to_next` 全部为 null、词级时间直接使用原始时间，并写入 `mode: "original"` 字段。**禁止 Agent 手工构建时间轴。**

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

