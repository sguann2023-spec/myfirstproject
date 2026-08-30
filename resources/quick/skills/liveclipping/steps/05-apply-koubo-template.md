# 第五步：套用口播模板

本步骤给第四步产出的每条切片套用口播模板，生成带模板包装的成片草稿。模板分配由脚本完成（技能目录的 `scripts/pick_koubo_template.py`，系统级均匀随机，避免选择分布不均）；模板套用通过平台工具并行调用（口播模板工具直接接受本地切片路径，上传在工具内部完成，无需单独上传），结果统一落盘为 `koubo_results.json` 交给第六步。

## 输入定义

本步骤输入按 OpenAPI 3.1 接口入参格式定义（等价于一次 `POST /skills/live-clip/steps/apply-koubo-template` 调用，Schema 遵循 JSON Schema 2020-12）。`clip_files` 来自第四步必填：

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [clip_files]
        properties:
          clip_files:
            type: array
            minItems: 1
            items:
              type: string
            description: 第四步产出的切片文件绝对路径列表（clips[].file_path，按 rank 顺序）
      example:
        clip_files:
          - /Users/demo/work/live_clip_work/clips/clip_01_痛点开场.mp4
          - /Users/demo/work/live_clip_work/clips/clip_02_成交点讲解.mp4
          - /Users/demo/work/live_clip_work/clips/clip_03_逼单金句.mp4
```

## 操作规则

1. **分配模板**（脚本，避免执行者"伪随机"）：

   ```bash
   python3 scripts/pick_koubo_template.py --count <切片数量>
   ```

   脚本从 4 个口播模板（带货/口播强调、高级感/知识内容、双语/港风、歌词/逐字强调）中均匀随机为每条切片分配一个，stdout 输出 `assignments` 数组（`rank` / `template_id` / `template_name`），按 rank 与切片一一对位。
2. **并行套用模板**：用口播模板工具对每条切片提交套用任务（直接传切片本地文件绝对路径和对应的 `template_id`，上传由工具内部自动完成，`name` 用切片文件名去除扩展名），多个任务调用放在**同一工具块并行发出**。工具会等待任务完成再返回，口播模板一般需要 3 分钟左右，耐心等待，不要中断。
3. **收集结果落盘**：从各任务回包提取 `draft_id` / 草稿名 / `taskId`，与切片、模板对位后写入 `<工作目录>/koubo_results.json`，结构见输出定义。回包原文不作为后续输入。
4. **草稿命名**：草稿名与切片标题对齐（如 `clip_01_痛点开场`），便于用户辨认。

## 输出定义

本步骤输出按 OpenAPI 3.1 响应格式定义，用于确保交给第六步的数据不遗漏字段：

```yaml
responses:
  '200':
    description: 全部切片套用口播模板成功，成片草稿已生成
    content:
      application/json:
        schema:
          type: object
          required: [status, draft_count, results_file, drafts]
          properties:
            status:
              type: string
              enum: [success]
            draft_count:
              type: integer
              description: 成功生成的成片草稿数量
            results_file:
              type: string
              description: koubo_results.json 绝对路径，第六步的入参来源
            drafts:
              type: array
              items:
                type: object
                required: [rank, draft_id, draft_name, clip_file, template_id, task_id]
                properties:
                  rank:
                    type: integer
                    description: 与切片对应的序号
                  draft_id:
                    type: string
                    description: 成片草稿 ID
                  draft_name:
                    type: string
                    description: 草稿名称（与切片标题对齐）
                  clip_file:
                    type: string
                    description: 来源切片文件路径
                  template_id:
                    type: string
                    description: 使用的口播模板 ID
                  template_name:
                    type: string
                    description: 使用的口播模板名称
                  task_id:
                    type: string
                    description: 模板任务 ID，便于平台侧追溯
        example:
          status: success
          draft_count: 3
          results_file: /Users/demo/work/live_clip_work/koubo_results.json
          drafts:
            - rank: 1
              draft_id: dfd_cat_abc123
              draft_name: clip_01_痛点开场
              clip_file: /Users/demo/work/live_clip_work/clips/clip_01_痛点开场.mp4
              template_id: koubo_1f9c8d7e6a2b4c0d9e8f123456789abc
              template_name: 高级感/知识内容
              task_id: task_9f8e7d6c
            - rank: 2
              draft_id: dfd_cat_def456
              draft_name: clip_02_成交点讲解
              clip_file: /Users/demo/work/live_clip_work/clips/clip_02_成交点讲解.mp4
              template_id: koubo_39ff88a1b2c34d5e9f0a6b7c8d9e0123
              template_name: 带货/口播强调
              task_id: task_5a4b3c2d
            - rank: 3
              draft_id: dfd_cat_ghi789
              draft_name: clip_03_逼单金句
              clip_file: /Users/demo/work/live_clip_work/clips/clip_03_逼单金句.mp4
              template_id: koubo_25829735dad8416a8698f1263384892c
              template_name: 歌词/逐字强调
              task_id: task_1a2b3c4d
  '400':
    description: 输入参数错误（clip_files 为空等）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: invalid_input
          message: count 必须 >= 1，当前为 0
  '502':
    description: 平台侧失败（口播模板任务失败）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: koubo_failed
          message: 片段 2 口播模板任务失败：模板渲染超时
  '504':
    description: 模板任务等待超时
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: timeout
          message: 口播模板任务等待超时（超过 15 分钟）
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
          enum: [invalid_input, koubo_failed, timeout]
          description: 结构化错误码；模板分配阶段以脚本 stdout JSON 为准，模板阶段以平台工具返回的失败原因归类（工具内部上传失败会表现为模板任务失败，统一归入 koubo_failed）
        message:
          type: string
          description: 面向用户的错误原因说明，汇报时转成自然语言
        clip_file:
          type: string
          description: 触发错误的切片路径，可为空字符串
```

模板分配脚本的错误（`invalid_input`）同样以 stdout JSON + 非零退出码为准；模板阶段的错误来自平台工具返回，需要按切片归类。HTTP 状态码仅用于归类错误类型。

## 汇报内容

> **回复格式提醒**：按自然语言向用户汇报，不要直接输出 JSON。把 schema 中的字段（`draft_count`、每条的 `draft_name` / `template_name`）作为必须包含的信息点，例如："3 条切片已全部套用口播模板完成：痛点开场用了高级感模板、成交点讲解用了带货强调模板、逼单金句用了逐字强调模板，草稿已生成，接下来下载交付。"

## 异常处理

- 模板任务失败（`koubo_failed`，工具内部上传失败也按此归类）：**换一个模板**重试 1 次（用脚本或手动改选未用过的模板；重试即重新提交任务，上传由工具内部重做）；仍失败则放弃该切片的模板包装，保留第四步的无字幕切片作为交付降级，并在汇报中明确指出哪些片段未成功套模板。
- 部分成功部分失败：不要整批中止，成功的结果正常进入第六步；失败的按上两条处理后在汇报中说明。
- `timeout`：模板任务一般 3 分钟左右，超过 15 分钟视为超时，按 `koubo_failed` 的口径处理。
