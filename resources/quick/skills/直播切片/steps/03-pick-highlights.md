# 第三步：根据字幕提取高光片段

本步骤按时间顺序阅读第二步产出的字幕分片，挑选适合发布的高光片段，产出候选片段列表 `clips.json`（时间精确到毫秒，原视频绝对时间轴）。**挑选由执行者完成，校验与规范化由脚本完成**：执行者先写出候选片段草稿，再调用技能目录的 `scripts/validate_highlights.py` 校验时间合法性并落盘，第四步只消费校验后的 `clips.json`。

## 输入定义

本步骤输入按 OpenAPI 3.1 接口入参格式定义（等价于一次 `POST /skills/live-clip/steps/pick-highlights` 调用，Schema 遵循 JSON Schema 2020-12）。`shard_files` 来自第二步必填；其余字段来自技能输入，缺失时用默认值：

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [shard_files]
        properties:
          shard_files:
            type: array
            minItems: 1
            items:
              type: string
            description: 第二步产出的字幕分片文件路径列表（asr_part_xxx.json，时间为原视频绝对秒）
          clip_count:
            type: integer
            minimum: 1
            default: 3
            description: 期望切片数量
          clip_duration:
            type: object
            description: 单条切片目标时长范围（秒）
            properties:
              min:
                type: integer
                minimum: 5
                default: 30
              max:
                type: integer
                maximum: 300
                default: 90
          highlight_style:
            type: string
            default: 传播/转化综合优先
            description: 高光类型偏好（传播优先 / 转化优先 / 冲突情绪优先等）
      example:
        shard_files:
          - /Users/demo/work/live_clip_work/shards/asr_part_001.json
          - /Users/demo/work/live_clip_work/shards/asr_part_002.json
        clip_count: 3
        clip_duration:
          min: 30
          max: 90
        highlight_style: 传播/转化综合优先
```

## 操作规则

1. **阅读字幕分片**：按文件名顺序逐个阅读 `shard_files`（每片约 20 分钟字幕），按 `highlight_style` 找有明确看点的段落（成交点、痛点、福利、逼单、观点密集、冲突、金句、反转、情绪强等）。不需要逐句打分或写分析理由，只要片段内容完整、有看点就记录。
2. **挑选规则**：
   - 数量满足 `clip_count`，单条尽量贴近 `clip_duration`（默认 30～90 秒）。
   - 片段不要从半句话开始，也不要在明显没说完的地方结束；起止可向前后扩 1～3 秒，避免断句。
   - 片段之间不要重叠（脚本允许 1 秒以内）。
   - 高光不足时可以少选，宁缺毋滥。
3. **写候选草稿**：把候选片段写到 `<工作目录>/highlights_draft.json`（工作目录沿用第二步约定，即音频所在目录），结构为 `{clips: [...]}`，每条含 `start` / `end`（`HH:MM:SS.mmm` 格式的原视频绝对时间，也接受毫秒整数）、`title`（可选）、`text`（对应字幕文案）。
4. **校验并落盘**：

   ```bash
   python3 scripts/validate_highlights.py --input "<工作目录>/highlights_draft.json" --shards <shard_files 逐个列出> --output "<工作目录>/clips.json" --clip-count <clip_count> --min-seconds <clip_duration.min> --max-seconds <clip_duration.max>
   ```

   脚本行为：解析时钟/毫秒时间 → 校验起止顺序、时长范围（±2 秒容差内自动夹紧到边界并给 warning）、越界（超出字幕覆盖范围 + 5 秒余量报错）、重叠（>1 秒报错）、数量（超过 `clip_count` 报错，不足仅 warning）→ 按开始时间重排 `rank`、自动计算时长、补默认标题 → 写入 `clips.json` 并向 stdout 输出 JSON。直接按字段读取 stdout JSON，不要人工换算时间。
5. **校验失败**：按 JSON 里的 `message` 修正草稿后重跑脚本，最多修正 2 次；仍失败则按异常处理执行。

## 输出定义

本步骤输出按 OpenAPI 3.1 响应格式定义，用于确保交给第四步的数据不遗漏字段：

```yaml
responses:
  '200':
    description: 候选片段校验通过，clips.json 已生成
    content:
      application/json:
        schema:
          type: object
          required: [status, clip_count, output_path, clips]
          properties:
            status:
              type: string
              enum: [success]
            clip_count:
              type: integer
              description: 校验通过的候选片段数量
            subtitle_segment_count:
              type: integer
              description: 字幕总条数（挑选基数）
            cover_end_ms:
              type: integer
              description: 字幕覆盖的终点（毫秒），用于校验参考
            output_path:
              type: string
              description: clips.json 绝对路径，第四步的 clips_file 入参
            warnings:
              type: array
              items:
                type: string
              description: 非致命提醒（自动夹紧时长、片段数不足等）
            clips:
              type: array
              items:
                type: object
                required: [rank, start_ms, end_ms, duration_seconds, title]
                properties:
                  rank:
                    type: integer
                    description: 按开始时间排序的序号
                  start_ms:
                    type: integer
                    description: 片段起点（毫秒，原视频绝对时间）
                  end_ms:
                    type: integer
                    description: 片段终点（毫秒，原视频绝对时间）
                  duration_seconds:
                    type: number
                    description: 片段时长（秒）
                  title:
                    type: string
                    description: 简短标题（缺失时自动取字幕前缀）
                  text:
                    type: string
                    description: 对应的字幕文案
        example:
          status: success
          clip_count: 3
          subtitle_segment_count: 1280
          cover_end_ms: 6120000
          output_path: /Users/demo/work/live_clip_work/clips.json
          warnings: []
          clips:
            - rank: 1
              start_ms: 754000
              end_ms: 831000
              duration_seconds: 77.0
              title: 痛点开场
              text: 很多人直播三个月不出单，问题不在话术……
            - rank: 2
              start_ms: 3620000
              end_ms: 3695000
              duration_seconds: 75.0
              title: 成交点讲解
              text: 这一单为什么能成，核心就三点……
            - rank: 3
              start_ms: 5410000
              end_ms: 5482000
              duration_seconds: 72.0
              title: 逼单金句
              text: 现在下单和不下单的区别，一年后见……
  '400':
    description: 输入参数错误（clip_count / 时长范围非法等）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: invalid_input
          message: clip-count 必须 >= 1，当前为 0
  '404':
    description: 字幕分片或草稿文件不存在
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: source_not_found
          message: 字幕分片文件不存在：/Users/demo/work/live_clip_work/shards/asr_part_002.json
  '422':
    description: 候选片段草稿结构或时间非法（end 不大于 start、时长超范围、越界、重叠、数量超限）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: clips_invalid
          message: 第 2 条片段时长 104.0 秒超过上限 90 秒（含 2.0 秒容差），请缩短后重试
  '500':
    description: 脚本内部错误
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: internal_error
          message: 写入 clips.json 失败
components:
  schemas:
    StepError:
      type: object
      required: [status, error_code, message]
      properties:
        status:
          type: string
          enum: [error]
        error_code:
          type: string
          enum: [invalid_input, source_not_found, clips_invalid, internal_error]
          description: 结构化错误码，与脚本 stdout JSON 的 error_code 字段一致
        message:
          type: string
          description: 面向用户的错误原因说明，汇报时转成自然语言
        draft_path:
          type: string
          description: 触发错误的草稿文件路径，可为空字符串
```

错误时脚本同样向 stdout 输出上方 `StepError` 结构的 JSON 并以非零码退出。HTTP 状态码仅用于归类错误类型，实际执行以脚本退出码和 JSON 字段为准。

## 汇报内容

> **回复格式提醒**：按自然语言向用户汇报，不要直接输出 JSON。把 schema 中的字段（`clip_count`、每条的 `title` / `duration_seconds` / `start`）作为必须包含的信息点，例如："已从 1280 条字幕中挑出 3 条高光片段：痛点开场（75 秒，12:34 起）、成交点讲解（75 秒，1:00:20 起）、逼单金句（72 秒，1:30:10 起），已校验落盘，接下来截取切片。"

## 异常处理

- `clips_invalid`：按 `message` 指出的具体片段修正草稿（缩短/延长/换起止点/去重叠）后重跑校验，最多修正 2 次；仍失败则减少候选数量（少选）再试一次。
- 高光不足（`warnings` 提示片段数少于 `clip_count`）：接受少选，交付时向用户说明候选不足的原因，不要强行凑低质量片段。
- 字幕质量差（识别错字多、断句乱）：用保守策略选择（选长句、时间留余量），并向用户说明识别质量风险，必要时建议提供校正文稿。
- `source_not_found`：检查 `shard_files` 路径是否与第二步输出一致，不要凭空继续。
