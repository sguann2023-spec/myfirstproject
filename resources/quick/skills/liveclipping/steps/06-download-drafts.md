# 第六步：下载草稿

本步骤把第五步生成的成片草稿通过 MCP 下载草稿工具触发下载，落到本地草稿库，完成交付。本步骤为纯平台工具调用，无脚本；下载完成后按技能总入口的交付口径向用户汇报最终结果。

## 输入定义

本步骤输入按 OpenAPI 3.1 接口入参格式定义（等价于一次 `POST /skills/live-clip/steps/download-drafts` 调用，Schema 遵循 JSON Schema 2020-12）。`drafts` 来自第五步的 `koubo_results.json` 必填：

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [drafts]
        properties:
          drafts:
            type: array
            minItems: 1
            items:
              type: object
              required: [draft_id, draft_name]
              properties:
                draft_id:
                  type: string
                  minLength: 1
                  description: 成片草稿 ID（第五步 drafts[].draft_id）
                draft_name:
                  type: string
                  description: 草稿名称（第五步 drafts[].draft_name）
      example:
        drafts:
          - draft_id: dfd_cat_abc123
            draft_name: clip_01_痛点开场
          - draft_id: dfd_cat_def456
            draft_name: clip_02_成交点讲解
          - draft_id: dfd_cat_ghi789
            draft_name: clip_03_逼单金句
```

## 操作规则

1. **批量下载**：触发 MCP 下载草稿工具 `mcp__draft-download__download_draft`（draft-download 服务的 `download_draft` 工具），一次性提交全部草稿——批量场景传 `drafts` 数组，每项含 `draftId` / `draftName`，可选 `cover`（第五步的降级场景下只下载成功的草稿）。不要逐条单发，也不要用外链方式下载。下载由客户端执行，工具返回受理结果。
2. **整理交付数据**：每条草稿整理出 `draft_id` / `draft_name` / `draft_url` 三元组。
3. **按交付口径汇报**：全部草稿处理完后，按技能总入口 SKILL.md 的输出定义（`clips` 数组：`draft_id` / `draft_name` / `draft_url`）组织最终交付内容，用自然语言汇报，链接逐条列出。

## 输出定义

本步骤输出按 OpenAPI 3.1 响应格式定义，同时就是技能最终交付数据的来源：

```yaml
responses:
  '200':
    description: 草稿下载受理成功
    content:
      application/json:
        schema:
          type: object
          required: [status, downloaded]
          properties:
            status:
              type: string
              enum: [success]
            downloaded:
              type: array
              description: 已提交下载的草稿列表（即最终交付的 clips）
              items:
                type: object
                required: [draft_id, draft_name, draft_url]
                properties:
                  draft_id:
                    type: string
                    description: 草稿 ID
                  draft_name:
                    type: string
                    description: 草稿名称
                  draft_url:
                    type: string
                    format: uri
                    description: 草稿打开链接（vectcut://open?draft_id=... 或工具回包链接）
            failed:
              type: array
              description: 下载失败的草稿（理想情况下为空）
              items:
                type: object
                required: [draft_id, reason]
                properties:
                  draft_id:
                    type: string
                  reason:
                    type: string
        example:
          status: success
          downloaded:
            - draft_id: dfd_cat_abc123
              draft_name: clip_01_痛点开场
              draft_url: vectcut://open?draft_id=dfd_cat_abc123
            - draft_id: dfd_cat_def456
              draft_name: clip_02_成交点讲解
              draft_url: vectcut://open?draft_id=dfd_cat_def456
            - draft_id: dfd_cat_ghi789
              draft_name: clip_03_逼单金句
              draft_url: vectcut://open?draft_id=dfd_cat_ghi789
          failed: []
  '400':
    description: 输入参数错误（drafts 为空、缺 draft_id 等）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: invalid_input
          message: drafts 不能为空，且每项必须包含 draft_id
  '404':
    description: 草稿数据来源缺失（koubo_results.json 不存在或无可下载草稿）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: source_not_found
          message: koubo_results.json 不存在：/Users/demo/work/live_clip_work/koubo_results.json
  '502':
    description: 平台侧下载失败
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: download_failed
          message: 草稿 dfd_cat_abc123 下载提交失败：草稿已被删除
  '504':
    description: 下载等待超时
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: timeout
          message: 下载等待超时（超过 5 分钟）
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
          enum: [invalid_input, source_not_found, download_failed, timeout]
          description: 结构化错误码，按平台工具返回的失败原因归类
        message:
          type: string
          description: 面向用户的错误原因说明，汇报时转成自然语言
        draft_id:
          type: string
          description: 触发错误的草稿 ID，可为空字符串
```

HTTP 状态码仅用于归类错误类型，实际执行以平台工具返回结果为准。

## 汇报内容

> **回复格式提醒**：按自然语言向用户汇报，不要直接输出 JSON。这是整个技能的最终交付，把 `downloaded` 中每条的 `draft_name` 和 `draft_url` 逐条列出，并说明对应的高光标题与时长，例如："切片任务已完成，共生成了 3 条高光切片：1. 痛点开场（77 秒）— 点击打开草稿；2. 成交点讲解（75 秒）— 点击打开草稿；3. 逼单金句（72 秒）— 点击打开草稿。"

## 异常处理

- `invalid_input`（drafts 为空）：说明第五步没有产出任何草稿（可能全部模板失败），回到第五步的降级口径处理，或与用户确认是否直接交付第四步的无字幕切片。
- 部分草稿下载失败（`download_failed`）：只重试失败的草稿 1 次；仍失败则在最终汇报中明确列出失败的草稿与原因，成功的正常交付。
- `timeout`：下载由客户端异步执行，提示用户稍后在草稿列表查看，链接仍然交付。
