---
name: vectcut-coze
description: "把一个或多个 VectCut RESTful API 请求转成 Coze 工作流工程目录并自动压缩成 zip，也支持在工作流里插入轻量 Python 代码节点做简单逻辑处理。只要用户提到“转为 coze 节点”“转成扣子工作流”“把 vectcut api 生成 MANIFEST.yml 和 workflow yaml”“把 restful request 转工作流文件夹/zip 包”“把一串步骤转成扣子工作流”“中间需要一个代码节点处理参数”，必须优先使用本技能。先联网读取 https://docs.vectcut.com/llms.txt 并按需抓取对应 Markdown/JSON/YAML 文档，再生成可落盘并可交付的工作流目录与 zip。"
---

# VectCut Coze Skill

用于把一个或多个现有的 VectCut RESTful API 请求，转换为一个可直接落盘并自动压缩的 Coze 工作流工程。

目标输出固定为：

```text
<output-folder>/
  MANIFEST.yml
  workflow/
    <name>-draft.yaml

<output-folder>.zip
```

## 适用场景

- 用户给你一个现有 VectCut API，请你“转成扣子节点”或“转成 coze 工作流”
- 用户只给接口名，例如“把提交异步对话大模型任务转为 coze 工作流”
- 用户给了 URL、method、headers、query、body，希望生成工作流目录或 zip 包
- 用户给了多步业务流程，例如“先创建草稿，再生图，再加图，再加字，再导出”
- 用户希望在某个 API 步骤前后插入一个 `code` 节点，做简单的参数整理、拼接、计数、条件前置处理
- 用户明确要求输出 `MANIFEST.yml` 和 `workflow/*.yaml`

## 你要先做什么

1. 先联网读取 `https://docs.vectcut.com/llms.txt`。
2. 如果用户只给接口名或模糊描述，再抓对应的 Markdown / OpenAPI 文档页。
3. 抽取这些信息：
   - 接口标题
   - method
   - URL
   - headers
   - query params
   - body 示例
   - 返回示例
4. 判断是不是异步接口：
   - 如果文档里出现“提交异步”“task_status”“查询任务状态”，优先生成“固定次数轮询 + 条件提前跳出”的工作流。
   - 常见结构是：提交任务 -> `from_json` 提取 `task_id` -> `loop(count)` -> 查询状态 -> `from_json` -> `delay` -> `condition` -> 成功则 `set_variable + break`，否则继续下一轮。
   - 如果是“提交异步对话大模型任务”，默认把最终结果收敛成字符串文本，而不是整个状态对象。
5. 判断用户要的是“单接口转工作流”还是“多步骤流程转工作流”：
   - 如果只是一个 API，优先走单接口模式。
   - 如果用户给的是一串步骤，优先整理成线性 `steps` 结构，再生成完整工作流。

## 生成规则

### 1. 节点编排

- 所有生成的工作流都必须包含 `start` 和 `end`
- 至少包含一个 `http` 节点
- 只要返回体是 JSON 字符串，就优先插入 `from_json`
- HTTP 节点的 `body / headers / params` 都可以引用前序节点输出，不能错误假设“只有 query params 才能引用”
- 每个节点的 `title` 和 `description` 都要按接口语义和节点阶段动态命名，不能写死成“发起请求”“查询结果”这类泛化文案
- 如果同一类节点在一个工作流里出现多次，标题要自动区分，避免重名冲突
- 多步骤流程默认按线性顺序编排：上一步完成后再进入下一步；如果中间某一步是异步接口，则该步骤内部自动展开为 `submit -> parse -> loop -> poll -> parse -> delay -> condition -> set_variable -> break`
- 允许在线性流程里插入 `code` 节点，适合做轻量 Python 逻辑，不适合承载复杂业务编排
- 异步接口默认生成：
  - `start`
  - `http` 提交任务
  - `from_json` 解析提交结果
  - `loop`
  - `http` 查询状态
  - `from_json` 解析状态结果
  - `delay`
  - `condition`
  - 成功分支：`set_variable` -> `break`
  - 否则分支：回到 `loop`
  - `end`
- 异步 AI 对话任务默认额外约定：
  - `poll_success_path = status`
  - `poll_success_value = success`
  - `poll_result_path = output.result.response.choices.message.content`
  - `loop.output` 与 `set_variable` 使用 `string` 类型
- 异步 AI 生图任务默认额外约定：
  - `poll_success_path = status`
  - `poll_success_value = success`
  - `poll_result_path = output.result.image`
  - `loop.output` 与 `set_variable` 使用 `string` 类型，避免把整个 `result` 对象错误写入循环变量
- 同步接口默认生成：
  - `start`
  - `http`
  - `from_json`
  - `end`
- 代码节点默认生成：
  - `type = code`
  - `version = v2`
  - `language = 3`（Python）
  - `node_inputs` 支持引用前序节点
  - `node_outputs` 根据 `outputs_example` 自动推断 schema

### 1.1 代码节点约束

- 只优先支持 Python 代码节点
- 代码逻辑要保持轻量：参数整理、字段拼接、简单计算、结构重组可以做；不要把复杂业务主流程都塞进代码节点
- `code` 节点建议通过 `inputs` 显式声明输入变量，避免在代码里硬编码上游节点 id
- `outputs_example` 必须给出，这样脚本才能稳定生成 `node_outputs`
- 如果用户需要复杂分支、长循环、外部依赖，优先继续用 Coze 原生节点，而不是强行扩成大段代码

### 2. 鉴权与安全

- 优先读取本地环境变量 `VECTCUT_API_KEY` 并写入 `Authorization`。
- 如果本地没有 `VECTCUT_API_KEY`，再回退成 `Bearer <YOUR_VECTCUT_API_KEY>` 占位符。
- 对 `Authorization` 里的常见占位写法做跨平台兼容处理，例如 `Bearer ${VECTCUT_API_KEY}`、`Bearer %VECTCUT_API_KEY%`、`Bearer $env:VECTCUT_API_KEY` 都应解析为本地真实 API Key，而不是原样落盘。
- 允许保留其他无敏感信息的 header。
- 如果用户贴出了真实 token，落盘时仍然优先替换为本地 `VECTCUT_API_KEY`；不要把用户会话里的长 token 原样固化进交付文件。

### 3. 输出要求

- 目录名默认使用：`Workflow-<slug>-draft-<shortid>`
- 工作流 `name` 会在落盘前自动规范化为合法标识符，必须匹配 `^[a-zA-Z][a-zA-Z0-9_]*$`；例如 `testai-image` 会转成 `testai_image`
- `MANIFEST.yml` 必须和 `workflow/*.yaml` 中的 `id` / `name` 对齐
- 最终回复里必须给出生成出的文件夹绝对路径和 zip 绝对路径
- 如果用了多步骤模式，还要简要说明每个步骤映射成了哪些 Coze 节点

## 生成脚本

优先使用这个脚本来稳定落盘：

```bash
python <skill-path>/scripts/generate_coze_workflow.py --help
```

常见调用方式：

```bash
python <skill-path>/scripts/generate_coze_workflow.py \
  --name "testai" \
  --description "提交异步对话大模型任务" \
  --method POST \
  --url "https://open.vectcut.com/llm/chat/submit_task/submit_chat_task" \
  --headers-json '{"Authorization":"Bearer <YOUR_VECTCUT_API_KEY>","Accept":"*/*"}' \
  --body-json '{"system_prompt":"你是一个有用的助手","user_input":"你好,什么是勾股定理？","model":"qwen3.6-plus","stream":false}' \
  --submit-response-example-json '{"success":true,"task_id":"demo","status":"pending","message_id":"msg"}' \
  --poll-method GET \
  --poll-url "https://open.vectcut.com/llm/chat/submit_task/task_status" \
  --poll-response-example-json '{"success":true,"task_id":"demo","status":"success","progress":100,"message":"处理完成","result":{"assistant":"你好"}}' \
  --poll-result-path "output.result.response.choices.message.content" \
  --output-root "/Users/sunguannan/Documents/trae_projects/skilltest"
```

多步骤流程优先使用 `workflow spec` 模式：

```bash
python <skill-path>/scripts/generate_coze_workflow.py \
  --workflow-spec-file "/tmp/vectcut_workflow_spec.json" \
  --output-root "/Users/sunguannan/Documents/trae_projects/skilltest"
```

`workflow spec` 的核心结构如下：

```json
{
  "name": "draft_image_export",
  "description": "创建草稿 -> 生图 -> 加图 -> 加字 -> 导出",
  "inputs": [
    {"name": "prompt", "type": "string"}
  ],
  "steps": [
    {
      "id": "create_draft",
      "kind": "http",
      "title": "创建空白草稿",
      "method": "POST",
      "url": "https://open.vectcut.com/cut_jianying/create_draft",
      "headers": {
        "Authorization": "Bearer <YOUR_VECTCUT_API_KEY>",
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      "body": {
        "width": 1080,
        "height": 1920,
        "name": "AI 生图草稿"
      },
      "response_example": {
        "error": "",
        "output": {
          "draft_id": "dfd_cat_demo",
          "draft_url": "https://example.com/draft"
        },
        "purchase_link": "",
        "success": true
      }
    },
    {
      "id": "generate_image",
      "kind": "async_http",
      "submit": {
        "method": "POST",
        "url": "https://open.vectcut.com/llm/image/submit_task/generate",
        "headers": {
          "Authorization": "Bearer <YOUR_VECTCUT_API_KEY>",
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        "body": {
          "prompt": "${start.prompt}",
          "model": "seedream-4.5",
          "size": "1024x1024",
          "compose_draft": false
        },
        "response_example": {
          "success": true,
          "task_id": "demo",
          "status": "pending",
          "message_id": "msg"
        }
      },
      "poll": {
        "method": "GET",
        "url": "https://open.vectcut.com/llm/image/submit_task/task_status",
        "headers": {
          "Authorization": "Bearer <YOUR_VECTCUT_API_KEY>",
          "Accept": "application/json"
        },
        "response_example": {
          "success": true,
          "task_id": "demo",
          "status": "success",
          "progress": 100,
          "message": "ok",
          "result": {
            "image": "https://example.com/image.png"
          }
        },
        "result_path": "output.result.image",
        "success_path": "status",
        "success_value": "success",
        "loop_count": 60,
        "delay_seconds": 30
      }
    },
    {
      "id": "add_image",
      "kind": "http",
      "title": "添加生成图片到草稿",
      "method": "POST",
      "url": "https://open.vectcut.com/cut_jianying/add_image",
      "headers": {
        "Authorization": "Bearer <YOUR_VECTCUT_API_KEY>",
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      "body": {
        "draft_id": "${create_draft.output.draft_id}",
        "image_url": "${generate_image}",
        "start": 0,
        "end": 5
      },
      "response_example": {
        "error": "",
        "output": {
          "draft_id": "dfd_cat_demo",
          "draft_url": "https://example.com/draft",
          "marterial_id": "mat_demo"
        },
        "purchase_link": "",
        "success": true
      }
    }
  ],
  "return": {
    "step": "add_image",
    "path": "output"
  }
}
```

如果步骤里需要一个轻量 Python 代码节点，可以这样写：

```json
{
  "id": "prepare",
  "kind": "code",
  "title": "计算草稿参数",
  "description": "用 Python 代码把开始节点输入转换成后续接口需要的字段",
  "language": 3,
  "inputs": [
    {
      "name": "input",
      "value": "${start.count}"
    }
  ],
  "outputs_example": {
    "draft_name": "AI草稿-2",
    "duration": 4,
    "meta": {
      "source": "code"
    }
  },
  "code": "async def main(args: Args) -> Output:\n    params = args.params\n    count = int(params['input'])\n    ret: Output = {\n        'draft_name': f'AI草稿-{count}',\n        'duration': count * 2,\n        'meta': {'source': 'code'}\n    }\n    return ret"
}
```

## 引用规则

- `body` 里的字符串支持写 `${step_id.path}`，脚本会自动转成 Coze 可识别的 `{{block_output_xxx.path}}`
- `params` 支持写 `${step_id.path}`，脚本会优先生成结构化引用
- `headers` 也支持写 `${step_id.path}` 或直接写 Coze 模板字符串
- `code.inputs[].value` 也支持写 `${step_id.path}` 或 `{{block_output_xxx.path}}`
- 开始节点输入用 `${start.input_name}`，例如 `${start.prompt}`
- 如果某个步骤是同步 `http + from_json`，它的默认输出基准路径是 `output`
- 如果某个步骤是异步 `async_http`，它的默认输出基准路径是该步骤轮询后的 `loop.output`
- 如果某个步骤是 `code`，则它的输出字段直接挂在该节点上，例如 `${prepare.draft_name}`
- `poll.success_path` 和 `poll.result_path` 优先按“API 返回 JSON 路径”来写，脚本会结合 `poll.response_example` 自动归一化为 Coze `from_json` 节点路径
- 例如 API 返回里成功状态在 `output.status`，则生成后的 Coze 引用会自动变成 `output.output.status`
- 因此 `${generate_image}` 在默认生图场景下就等价于最终图片 URL；`${create_draft.output.draft_id}` 则会映射到解析节点里的 `draft_id`

如果用户已经给了现成的 Coze 模板引用，例如：

```yaml
"prompt": "{{block_output_100001.input}}"
```

也允许原样保留，不要强行改写。

## 推荐执行流程

1. 先确认用户给的是“接口名”还是“完整请求”。
2. 再确认用户是“单接口”还是“多步骤流程”。
3. 如果只是接口名，去在线文档里补齐 method / URL / 示例 body / 示例 response。
4. 如果是完整请求，优先复用用户给的 headers / params / body。
5. 如果是多步骤流程：
   - 先整理成线性 `steps`
   - 明确每一步的上游依赖
   - 对需要复用上一步结果的字段，优先写成 `${step_id.path}` 或保留用户给的 `{{block_output_xxx.path}}`
   - 如果中间需要轻量计算或参数整理，插入 `kind = code` 步骤，并补齐 `inputs`、`outputs_example`、`code`
6. 如果是异步接口，补齐轮询成功条件：
   - 成功判断字段，例如 `status`
   - 成功值，例如 `success`
   - 默认轮询次数 `60`
   - 默认等待秒数 `30`
   - 如果是异步 AI 对话，默认把结果路径收敛成 `output.result.response.choices.message.content`
   - 如果是异步 AI 生图，默认把结果路径收敛成 `output.result.image`
7. 调用脚本生成目录并自动压缩 zip。
8. 读取生成出的 `MANIFEST.yml` 和 `workflow/*.yaml` 做一次快速自检：
   - `start/end` 是否存在
   - `edges` 是否连通
   - 是否至少一个 `http`
   - 异步场景是否包含 `loop / condition / break`
   - JSON 解析节点是否引用正确
   - 多步骤场景下，后续步骤里是否正确引用了前序节点输出
   - 如果包含 `code` 节点，检查 `language / node_inputs / node_outputs / code` 是否完整
9. 把文件夹路径和 zip 路径一起返回给用户。

## 用户没给全信息时的默认策略

- 没给 headers：默认只保留常用的 `Authorization`、`Accept`、`User-Agent`
- 没给 query：生成空数组
- 没给 response 示例：可以只生成 `http -> end`，但要明确告诉用户这是“未补全 response schema 的简版”
- 没给输出目录：默认写到当前项目根目录
- 用户给的是多步自然语言但没给完整请求：你要自己去文档补齐每一步接口，再组装成 spec

## 示例触发语句

- “把提交异步对话大模型任务转为 coze 工作流”
- “把这个 VectCut restful request 转成扣子节点”
- “给我生成一个包含 MANIFEST.yml 和 workflow yaml 的 coze 工程，并压缩成 zip”
- “把这个 API 调用改成 Coze 的 http + json 解析节点”
- “先创建草稿，再生图，再加图片和文字，最后导出，帮我转成扣子工作流”
- “这个 HTTP body 里要引用前一个节点的输出，帮我一起生成 Coze workflow”
- “这里中间加一个 Python 代码节点，把开始节点输入处理一下再调用接口”
