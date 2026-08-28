# 第二步：切分音频并行提交字幕识别

本步骤把第一步产出的音频切分成不超过 20 分钟的片段，**并行提交 `basic` 档位字幕识别**，最后合并校正为原视频绝对时间轴的字幕分片文件。切分与合并已沉淀在技能目录的脚本里（`scripts/split_audio.py`、`scripts/merge_asr_results.py`），识别通过平台工具并行调用（识别工具直接接受本地片段路径，上传在工具内部完成，无需单独上传）；总时长不超过 20 分钟的音频不会物理切分，直接整体处理。并行切分的目的是缩短长音频的识别等待时间，提升整体体感。

## 输入定义

本步骤输入按 OpenAPI 3.1 接口入参格式定义（等价于一次 `POST /skills/live-clip/steps/upload-and-asr` 调用，Schema 遵循 JSON Schema 2020-12）。`audio_path` 来自第一步必填，是**唯一入参**；单片段切分上限（20 分钟）、识别档位（`basic`）、字幕分片单片时长（20 分钟）均为固定值，内聚在脚本内部，不作为入参。工作目录固定取 `audio_path` 所在目录（下文记作 `<工作目录>`），切片、识别回包、字幕分片分别保存在其 `chunks` / `asr_results` / `shards` 子目录下：

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [audio_path]
        properties:
          audio_path:
            type: string
            minLength: 1
            description: 第一步产出的音频文件绝对路径
            examples:
              - /Users/demo/work/live_clip_work/live_replay.mp3
      example:
        audio_path: /Users/demo/work/live_clip_work/live_replay.mp3
```

## 操作规则

按顺序执行。第 1 步（切分）和第 4 步（合并）用脚本，第 2～3 步用平台工具并行：

1. **切分音频**（总时长超过 50 小时直接中止）：

   ```bash
   python3 scripts/split_audio.py --source "<audio_path>" --output-dir "<工作目录>/chunks"
   ```

   脚本行为：总时长 > 180000 秒（50 小时）时输出 `duration_exceeds_limit` 错误；总时长 ≤ 20 分钟时不物理切分，原音频即唯一片段；否则按 20 分钟切分（MP3 流复制，不重编码）。成功时向 stdout 输出 JSON（`segments` 内含每段的 `index` / `file_path` / `start_seconds`），同时把同一份 JSON 写入 `<工作目录>/chunks/split_manifest.json` 供第 5 步使用。直接按字段读取 stdout JSON，不要解析 ffmpeg 日志。

   
2. **并行识别**：对 manifest 中每个片段的本地文件绝对路径直接调用字幕识别工具（`submit_subtitle_recognition_task`，`url` 参数传片段文件路径，上传由工具内部自动完成），`effectMode` 固定为 `basic`。**所有识别调用放在同一个工具块中一次性并行发出**（每个调用会各自等待识别完成，并行提交后整体耗时约等于最长一片的耗时）。识别本身有耗时，没必要频繁轮询。

3. **回包落盘**：每个片段的识别回包**原文**按片段编号存为 `<工作目录>/asr_results/asr_chunk_001.json`、`asr_chunk_002.json`……（三位数字补零，编号与 manifest 的 `index` 对齐）。不要把回包全文读进上下文，`result.content` 原始全文也不作为后续阅读输入。

4. **合并校正**：

   ```bash
   python3 scripts/merge_asr_results.py --manifest "<工作目录>/chunks/split_manifest.json" --results-dir "<工作目录>/asr_results" --output-dir "<工作目录>/shards"
   ```

   脚本把每条字幕时间（回包内为毫秒、相对片段起点）加上片段起点，校正为**原视频绝对时间轴**（第三步挑高光、第四步截片段直接使用，无需再换算），再按固定 20 分钟拆成 `asr_part_001.json`、`asr_part_002.json`……每片只保留 `text` 与绝对时间。回包结构由脚本内部兼容解析（basic 档位实测时间轴位于 `result.result.raw.result.utterances`，`start_time`/`end_time` 为毫秒），两种结构均提取不到分段时按 `asr_result_invalid` 报错，不会静默产出空结果。

## 输出定义

本步骤输出按 OpenAPI 3.1 响应格式定义，用于确保交给第三步的数据不遗漏字段：

```yaml
responses:
  '200':
    description: 字幕识别成功，字幕分片文件已生成
    content:
      application/json:
        schema:
          type: object
          required: [status, duration_seconds, segment_count, shard_files]
          properties:
            status:
              type: string
              enum: [success]
            duration_seconds:
              type: number
              description: 原音频总时长（秒），来自切分脚本输出
            segment_count:
              type: integer
              description: 音频被切分成的片段数量（未切分时为 1）
            subtitle_segment_count:
              type: number
              description: 合并后的字幕总条数
            shard_files:
              type: array
              description: 字幕分片文件绝对路径列表（asr_part_xxx.json），交给第三步阅读分析
              items:
                type: string
            time_range_seconds:
              type: object
              description: 字幕覆盖的绝对时间范围（秒）
              properties:
                start:
                  type: number
                end:
                  type: number
        example:
          status: success
          duration_seconds: 1500.029
          segment_count: 2
          subtitle_segment_count: 312
          shard_files:
            - /Users/demo/work/live_clip_work/shards/asr_part_001.json
            - /Users/demo/work/live_clip_work/shards/asr_part_002.json
            - /Users/demo/work/live_clip_work/shards/asr_part_003.json
          time_range_seconds:
            start: 0.4
            end: 1499.8
  '400':
    description: 输入参数错误（audio_path 为空等）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: invalid_input
          message: audio_path 不能为空
          source_audio: ''
  '404':
    description: 音频文件或 manifest 不存在
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: source_not_found
          message: 音频文件不存在：/Users/demo/work/live_clip_work/live_replay.mp3
          source_audio: /Users/demo/work/live_clip_work/live_replay.mp3
  '413':
    description: 音频总时长超过 50 小时上限，中止流程
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: duration_exceeds_limit
          message: 音频时长 180060 秒超过 50 小时上限（180000 秒），请提供更短的片段或手动截取后再试
          source_audio: /Users/demo/work/live_clip_work/live_replay.mp3
  '422':
    description: 音频内容问题（识别回包缺失或结构不符合预期，或音频无人声无法识别）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        examples:
          asrResultInvalid:
            summary: 回包缺失或结构异常
            value:
              status: error
              error_code: asr_result_invalid
              message: 缺少片段 2 的识别结果文件：/Users/demo/work/live_clip_work/asr_results/asr_chunk_002.json
              source_audio: /Users/demo/work/live_clip_work/live_replay.mp3
          noSpeech:
            summary: 音频无人声（平台返回 Volc 错误码 20000003）
            value:
              status: error
              error_code: no_speech
              message: 片段 1 音频无人声（平台返回 Volc 错误码 20000003），无法进行字幕识别
              source_audio: /Users/demo/work/live_clip_work/live_replay.mp3
  '500':
    description: FFmpeg 未安装或切分/合并执行失败
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: ffmpeg_missing
          message: 未找到 ffmpeg，请先安装 FFmpeg（macOS 运行 brew install ffmpeg）
          source_audio: /Users/demo/work/live_clip_work/live_replay.mp3
  '502':
    description: 平台侧失败（字幕识别任务失败）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: asr_failed
          message: 片段 1 字幕识别任务失败
          source_audio: /Users/demo/work/live_clip_work/live_replay.mp3
  '504':
    description: 切分/探测/识别等待超时
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: timeout
          message: 切分音频超时
          source_audio: /Users/demo/work/live_clip_work/live_replay.mp3
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
          enum: [invalid_input, source_not_found, duration_exceeds_limit, ffmpeg_missing, internal_error, asr_failed, asr_result_invalid, no_speech, timeout]
          description: 结构化错误码；脚本阶段（切分/合并）以脚本 stdout JSON 的 error_code 为准，识别阶段以平台工具返回的失败原因归类（Volc 错误码 20000003 归类为 no_speech）
        message:
          type: string
          description: 面向用户的错误原因说明，汇报时转成自然语言
        source_audio:
          type: string
          description: 触发错误的音频路径，可为空字符串
```

切分/合并阶段的错误以脚本 stdout JSON（`status: error`）+ 非零退出码为准；识别阶段的错误（`asr_failed`）来自平台工具返回，需要按片段归类。HTTP 状态码仅用于归类错误类型。

## 汇报内容

> **回复格式提醒**：按自然语言向用户汇报，不要直接输出 JSON。把 schema 中的字段（`segment_count`、`duration_seconds`、`subtitle_segment_count`、`shard_files` 数量）作为必须包含的信息点，例如："音频已切分为 3 段并行识别，全部完成；原音频全长 1 小时 42 分，共识别 1280 条字幕，已按绝对时间合并为 11 个分片文件，接下来开始挑高光片段。"

## 异常处理

- `duration_exceeds_limit`：中止流程，告知用户"音频时长超过 50 小时上限，请提供更短的片段或手动截取后再试"，不要继续识别。
- 部分片段识别失败（`asr_failed`）：只重试失败的片段（重新提交识别即可，上传由工具内部完成），不要重跑已成功的片段；最多重试 2 次；重试后仍有失败则中止，汇报失败片段编号与原因。
- 音频无人声（`no_speech`，平台返回 Volc 错误码 20000003）：**不要重试**，重试必然得到同样结果；直接中止并告知用户该音频没有有效人声，无法提取字幕，建议更换素材。
- `asr_result_invalid`：检查 `asr_chunk_xxx.json` 是否齐全、是否为合法识别回包；缺失时先补跑对应片段的识别，**不要凭空生成时间码**。
- 脚本类错误（`invalid_input` / `source_not_found` / `ffmpeg_missing` / `internal_error` / `timeout`）：与第一步口径一致，按 `error_code` 定位原因并转成自然语言告知用户。
