# 第四步：截取高光片段

本步骤按第三步产出的 `clips.json`，从原视频（本地路径或远程 URL）截取本地切片文件。截取已完全脚本化：技能目录的 `scripts/trim_clips.py` 默认用 ffmpeg 流拷贝（`-c copy`）无损截断，不重编码、秒级完成，完整保留原视频的编码参数与关键帧结构（拖进剪映等剪辑软件预览流畅）；仅当切片起止点必须毫秒级精确时才用 `--mode reencode` 重编码。支持本地文件与远程 URL 直连、多切片并行执行。

## 输入定义

本步骤输入按 OpenAPI 3.1 接口入参格式定义（等价于一次 `POST /skills/live-clip/steps/trim-clips` 调用，Schema 遵循 JSON Schema 2020-12）。两个字段均为必填，分别来自第一步和第三步：

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [source_video, clips_file]
        properties:
          source_video:
            type: string
            minLength: 1
            description: 原视频，本地绝对路径或可访问 URL（第一步回传的 source_video）
            examples:
              - /Users/demo/Downloads/live_replay.mp4
              - https://example.com/live-replay.mp4
          clips_file:
            type: string
            minLength: 1
            description: 第三步产出的 clips.json 绝对路径（输出定义里的 output_path）
            examples:
              - /Users/demo/work/live_clip_work/clips.json
      example:
        source_video: /Users/demo/Downloads/live_replay.mp4
        clips_file: /Users/demo/work/live_clip_work/clips.json
```

## 操作规则

1. **调用脚本截取**：

   ```bash
   python3 scripts/trim_clips.py --source "<source_video>" --clips "<clips_file>" --output-dir "<工作目录>/clips" --mode copy
   ```

   脚本行为：读取 `clips.json` 的 `clips` 数组（`start_ms` / `end_ms` / `title` / `rank`），默认对每条执行 ffmpeg 流拷贝无损截断（`-c copy`，不重编码）：先探测 `start_ms` 前最近的源视频关键帧作为实际起点（提前量通常 < 2 秒，回传 `copy_start_ms` / `copy_start_shift_ms`），终点保持 `end_ms` 不变，因此实际时长略长于目标属正常；默认 2 路并行；输出文件命名为 `clip_{rank两位}_{标题安全化}.mp4`（标题转下划线安全文件名）；截取后用 ffprobe 校验实际时长（copy 模式偏差超过 12 秒、reencode 模式偏差超过 0.5 秒才记入 `warnings`）。任一条失败则以 `trim_failed` 整体报错并在 `failed` 数组列出原因；全部成功才输出成功 JSON。直接按字段读取 stdout JSON，不要解析 ffmpeg 日志。
2. **时间口径**：`clips.json` 里的时间已经是原视频绝对毫秒，脚本直接使用，不要换算。
3. **模式选择**：默认 `--mode copy`（流拷贝，不重编码）——画质与原视频完全一致，保留原视频关键帧结构，剪辑软件里预览流畅；代价是起点只能对齐到源视频关键帧（提前通常 < 2 秒），无法毫秒级精确。仅当起止点必须毫秒级精确时用 `--mode reencode`（libx264/aac 重编码）；注意重编码后关键帧间隔会拉长到约 250 帧（GOP 变长），剪辑软件里拖动预览可能变卡。
4. **无需等待提示**：copy 模式几乎瞬时完成；仅 reencode 模式在切片数量多或片段长时转码需要时间，属正常耗时。

## 输出定义

本步骤输出按 OpenAPI 3.1 响应格式定义，用于确保交给第五步的数据不遗漏字段：

```yaml
responses:
  '200':
    description: 全部切片截取成功
    content:
      application/json:
        schema:
          type: object
          required: [status, source_video, clip_count, output_dir, clips]
          properties:
            status:
              type: string
              enum: [success]
            source_video:
              type: string
              description: 回传原视频路径，便于追溯
            clip_count:
              type: integer
              description: 成功切片数量
            output_dir:
              type: string
              description: 切片输出目录（<工作目录>/clips）
            total_size_bytes:
              type: integer
              description: 全部切片总大小（字节）
            warnings:
              type: array
              items:
                type: string
                description: 非致命提醒（实际时长偏差等）
            clips:
              type: array
              items:
                type: object
                required: [rank, file_path, start_ms, end_ms, duration_seconds, size_bytes]
                properties:
                  rank:
                    type: integer
                    description: 与 clips.json 对应的序号
                  file_path:
                    type: string
                    description: 切片本地文件绝对路径（clip_xx_xxx.mp4），第五步逐条套用口播模板使用
                  start_ms:
                    type: integer
                    description: 片段起点（毫秒）
                  end_ms:
                    type: integer
                    description: 片段终点（毫秒）
                  duration_seconds:
                    type: number
                    description: 目标时长（秒）
                  actual_duration_seconds:
                    type: number
                    description: 实际截出时长（秒）
                  copy_start_ms:
                    type: integer
                    description: copy 模式实际起点（毫秒，对齐到源视频关键帧；reencode 模式无此字段）
                  copy_start_shift_ms:
                    type: integer
                    description: copy 模式起点提前量（毫秒，copy_start_ms - start_ms，≤ 0）
                  size_bytes:
                    type: integer
                    description: 文件大小（字节）
        example:
          status: success
          source_video: /Users/demo/Downloads/live_replay.mp4
          clip_count: 3
          output_dir: /Users/demo/work/live_clip_work/clips
          total_size_bytes: 68370124
          warnings: []
          clips:
            - rank: 1
              file_path: /Users/demo/work/live_clip_work/clips/clip_01_痛点开场.mp4
              start_ms: 754000
              end_ms: 831000
              duration_seconds: 77.0
              actual_duration_seconds: 77.0
              size_bytes: 23012053
            - rank: 2
              file_path: /Users/demo/work/live_clip_work/clips/clip_02_成交点讲解.mp4
              start_ms: 3620000
              end_ms: 3695000
              duration_seconds: 75.0
              actual_duration_seconds: 75.0
              size_bytes: 22758210
            - rank: 3
              file_path: /Users/demo/work/live_clip_work/clips/clip_03_逼单金句.mp4
              start_ms: 5410000
              end_ms: 5482000
              duration_seconds: 72.0
              actual_duration_seconds: 72.0
              size_bytes: 22599861
  '400':
    description: 输入参数错误（source 为空、concurrency 非法等）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: invalid_input
          message: source 不能为空
  '404':
    description: 原视频或 clips.json 不存在
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: source_not_found
          message: 候选片段文件不存在：/Users/demo/work/live_clip_work/clips.json
  '422':
    description: clips.json 结构非法（无 clips 数组、缺 start_ms / end_ms、时间非法）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: clips_invalid
          message: 第 2 条片段缺少 start_ms / end_ms 字段
  '500':
    description: FFmpeg 未安装、截取执行失败或部分片段失败
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: trim_failed
          message: 1 条切片截取失败：片段 2（Output file is empty）
  '504':
    description: 单条截取超时
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: timeout
          message: 截取超时（>120 秒）
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
          enum: [invalid_input, source_not_found, clips_invalid, ffmpeg_missing, trim_failed, timeout, internal_error]
          description: 结构化错误码，与脚本 stdout JSON 的 error_code 字段一致
        message:
          type: string
          description: 面向用户的错误原因说明，汇报时转成自然语言
        source_video:
          type: string
          description: 触发错误的源视频（路径或 URL），可为空字符串
```

错误时脚本同样向 stdout 输出上方 `StepError` 结构的 JSON（`trim_failed` 时额外带 `failed` 失败明细与 `succeeded` 已成功列表）并以非零码退出。HTTP 状态码仅用于归类错误类型。

## 汇报内容

> **回复格式提醒**：按自然语言向用户汇报，不要直接输出 JSON。把 schema 中的字段（`clip_count`、每条的 `title`（从文件名可见）、起止时间、`duration_seconds`、大小）作为必须包含的信息点，例如："3 条切片已全部截取完成，保存在 clips 目录：痛点开场（12:34～13:51，77 秒，22 MB）、成交点讲解（1:00:20～1:01:35，75 秒，22 MB）、逼单金句（1:30:10～1:31:22，72 秒，22 MB），接下来套用口播模板。"

## 异常处理

- `trim_failed`（部分失败）：从 stdout JSON 的 `failed` 数组找到失败片段，只重跑失败片段（把成功片段从 clips.json 临时剔除后重跑，或调小范围单独截取），重试 1 次；仍失败则中止，汇报失败片段与原因。
- `source_not_found`：本地路径检查文件是否存在；URL 检查是否可访问，与第一步口径一致。
- `clips_invalid`：说明 `clips.json` 与第三步输出不一致，回到第三步重新校验落盘，不要手工改时间。
- `ffmpeg_missing`：告知用户安装 FFmpeg（macOS 运行 `brew install ffmpeg`）后重试。
- 远程 URL 截取超时/中断：重试一次；仍失败按失败处理并告知用户。
