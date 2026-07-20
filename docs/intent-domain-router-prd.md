# 意图域路由 PRD

## 背景

当前 Agent 工具数量较多，如果在每个请求里一次性向模型暴露完整工具面，会带来几个问题：

- token 开销过高
- 模型更容易被无关工具干扰
- 简单任务也会看到过大的工具选择空间
- 工具命中不稳定，容易出现“本该写文件却只拿到读工具”这类问题

本方案不讨论工具权限管理，重点解决：

1. 如何先做意图识别
2. 如何只挂载当前任务真正需要的工具域
3. 如何支持一个任务同时命中多个域
4. 如何在低置信度时逐步扩展，而不是一次性暴露全部工具

## 目标

- 建立一套面向 Agent 的意图域路由系统
- 将工具组织为“主域 + 子能力”的结构，而不是单一线性层级
- 支持多域组合，例如 `workspace.read + web.search`
- 默认只暴露最小必要工具面
- 在需要时按域逐步展开工具，而不是全量挂载

## 非目标

- 不在本期处理 tool permission / allow / deny 规则
- 不在本期设计具体 MCP 协议细节
- 不在本期处理模型侧复杂推理链优化

## 核心思路

系统先根据用户请求识别一个 **主域**，再补充若干 **子能力** 和 **伴随域**。

路由输出不是单一层级，而是一个可组合结构：

```ts
type IntentRoute = {
  primaryDomain: 'chat' | 'workspace' | 'web' | 'ai_media' | 'skills' | 'auxiliary' | 'scrapt' | 'cut'
  subdomains: string[]
  companionDomains: string[]
  confidence: number
}
```

其中：

- `primaryDomain`：当前任务的主处理域
- `subdomains`：主域下的细分能力
- `companionDomains`：需要同时挂载的伴随域
- `confidence`：当前路由置信度

## 一级意图域

### 1. `chat`

适用于：

- 普通问答
- 总结、解释、改写
- 不需要外部工具的轻量任务

默认特征：

- 不挂或只挂极小工具面
- 优先保证回复速度和上下文稳定性

### 2. `workspace`

适用于本地工程、文件、代码、日志、命令相关任务。

建议子能力：

- `read`
- `write`
- `execute`
- `find`
- `notebook`
- `task`
- `upload`

已接入工具：

- `read` -> `Read` / `Glob` / `Grep`
- `write` -> `Write` / `Edit` / `MultiEdit`
- `execute` -> `Bash`
- `find` -> `Glob` / `Grep`
- `notebook` -> `NotebookRead` / `NotebookEdit`
- `task` -> `Task` / `TodoWrite`
- `upload` -> `mcp__file-upload__upload_file_to_oss`

说明：

- `upload`：当用户需要上传本地文件时使用；逻辑上先获取临时 STS，再上传到 OSS 并返回 `public url`；文件大小限制不超过 `500MB`，上传前先校验并在超限时报错

### 3. `web`

适用于联网信息获取和页面交互。

建议子能力：

- `search`
- `fetch`
- `browser`
- `execute`
- `screenshot`

已接入工具：

- `search` -> `WebSearch` / `mcp__search__web_search`
- `fetch` -> `WebFetch`
- `browser` -> `mcp__browser__open` / `mcp__browser__click` / `mcp__browser__type` / `mcp__browser__press` / `mcp__browser__scroll` / `mcp__browser__focus` / `mcp__browser__hover` / `mcp__browser__wait_for` / `mcp__browser__inspect` / `mcp__browser__reload` / `mcp__browser__list_tabs` / `mcp__browser__switch_tab` / `mcp__browser__close_tab` / `mcp__browser__reset`
- `execute` -> `mcp__browser__execute`
- `screenshot` -> `mcp__browser__screenshot` / `mcp__browser__snapshot`


### 4. `ai_media`

适用于 AI 媒体生成相关任务。

建议子能力：
- `image`
- `speech`
- `seed_audio`
- `digital_human`

已接入工具：

- `image` -> `mcp__image__generate_or_edit_image` / `mcp__image__generate_image` / `mcp__image__get_image_capabilities`
- `speech` -> `mcp__speech__generate_speech`
- `seed_audio` -> `mcp__seed-audio__generate_seed_audio`
- `digital_human` -> `mcp__digital-human__create_lip_sync_digital_human` / `mcp__digital-human__get_lip_sync_digital_human_status` / `mcp__digital-human__create_image_driven_digital_human` / `mcp__digital-human__get_image_driven_digital_human_status` / `mcp__digital-human__create_omni_image_driven_digital_human` / `mcp__digital-human__get_omni_image_driven_digital_human_status` / `mcp__digital-human__create_seedance_digital_human` / `mcp__digital-human__get_seedance_digital_human_status`

说明：

- `speech`：TTS，按“文字 + 音色”合成语音
- `seed_audio`：豆包音频生成，按“描述 + 参考图片/音频/音色”等条件生成一段完整音频，可包含多人、背景音乐、音效，不等同于 TTS

### 5. `skills`

适用于技能发现、安装、创建、注册等技能管理任务。

建议子能力：

- `search_skill`
- `list_skill`
- `create_skill`
- `register_skill`

已接入工具：

- `search_skill` -> `mcp__skills__skills`
- `list_skill` -> `mcp__skills__skills`
- `create_skill` -> `mcp__skills__skills`
- `register_skill` -> `mcp__skills__skills`

说明：

- `search_skill`：查技能市场里的现成能力，对应 `action="search"`
- `list_skill`：查看当前 agent 已启用或可见的技能，对应 `action="list"`
- `create_skill`：在当前 agent 的 `.claude/skills/<name>` 下初始化技能目录，对应 `action="init"`
- `register_skill`：校验并注册当前 agent 下刚创建的技能，对应 `action="register"`
- `skills` 工具默认面向技能管理语义，但对于“当前 agent 是否已有某个本地技能 / 要执行哪个本地技能”这类判断，**唯一技能源** 应是当前 workspace 下的 `.claude/skills/<name>/SKILL.md`
- 这里的 `/workspace` 指当前会话绑定的 agent workspace root；例如 `/workspace/.claude/skills/<name>/SKILL.md`
- `search_skill` **只**用于查技能市场，不用于判断当前 workspace 里是否已存在某个技能；不能因为 `search_skill` 返回空就得出“本地没有这个技能”
- `list_skill` 的正确语义是“列出当前 agent 已启用或可见的技能”；其中“已启用”部分应优先从当前 workspace 的 `.claude/skills` 枚举，再补充全局技能目录中的可见但未启用技能
- 全局技能目录（如 `Data/Skills`）是安装缓存 / 共享注册表，不应覆盖当前 workspace 下本地技能的判定结果
- 如果用户说“执行这个技能 / @某个技能 / 当前就有这个技能”，应优先按当前 workspace 的 `.claude/skills/<name>/SKILL.md` 做本地命中，而不是先走 `search_skill`
- 如果用户要“查看 / 修改技能文件内容”，应补充 `workspace.read` / `workspace.write`，再基于当前 workspace 下 `.claude/skills/<name>` 或 `list_skill` 返回的真实路径读取或编辑
- `run_skill`：后续如需显式路由到技能执行，可补

#### 本地技能判定顺序

当用户请求涉及“当前 agent 的本地技能”时，建议按下面顺序处理：

1. 先确定当前会话绑定的 workspace root
2. 再检查 `/workspace/.claude/skills/<name>/SKILL.md` 是否存在
3. 若存在，则直接视为本地技能命中，可补充 `workspace.read` / `workspace.write` 读取或执行所需文件
4. 若不存在，再根据用户意图决定是否调用 `list_skill` 查看已启用 / 可见技能
5. 仅当用户明确要“搜索现成技能 / 安装新技能”时，才调用 `search_skill`

反例：

- 不能把“`search_skill("儿童绘本")` 没结果”解释为“当前 workspace 里没有 `儿童绘本` 技能”
- 不能只扫描全局 `Data/Skills` 就忽略当前 workspace 的 `.claude/skills`

### 6. `auxiliary`

适用于辅助型 Agent 能力，不直接归属技能发现或媒体生成。

建议子能力：

- `memory`
- `assistant`
- `automation`
- `system`

已接入工具：

- `memory` -> `mcp__agent-memory__memory`
- `assistant` -> `mcp__assistant__navigate` / `mcp__assistant__diagnose`
- `automation` -> `mcp__claw__cron` / `mcp__claw__notify` / `mcp__claw__config`
- `system` -> `mcp__system__open_deeplink`

### 7. `scrapt`

适用于爬虫反推提示词任务。

建议子能力：

- `derive_prompt`

已接入工具：

- `derive_prompt` -> `mcp__copylab__derive_copy_prompt`


### 8. `cut`

适用于剪辑任务。

建议子能力：

- `draft_create`
- `draft_update_meta`
- `draft_inspect`
- `draft_download`
- `subtitle_template`
- `template`

已接入工具：

- `draft_create` -> `mcp__draft-management__create_draft`
- `draft_update_meta` -> `mcp__draft-management__modify_draft`
- `draft_inspect` -> `mcp__draft-management__query_script`
- `draft_download` -> `mcp__draft-download__download_draft`
- `subtitle_template` -> `mcp__subtitle-template__generate_smart_subtitle` / `mcp__subtitle-template__get_smart_subtitle_task_status`
- `template` -> `mcp__koubo-template__submit_koubo_template_task` / `mcp__koubo-template__get_koubo_template_task_status`

说明：

- `subtitle_template`：给一段音频或视频添加字幕模版，可基于已有草稿继续编辑；用户可主动指定字幕模版，默认使用 `asr_42da310c1e4347ddb2c96dd2a5d055c2`
- `template`：口播模版剪辑，面向一段原始未剪辑口播做整体剪辑和套版，模版内容通常包含字幕、音频、动画，不等同于字幕模版

- 用户提到“创建草稿”时，优先命中 `draft_create`
- 用户提到“修改草稿封面”或“修改草稿名称”时，优先命中 `draft_update_meta`
- 当任务涉及复杂草稿修改、修改了多个元素，或用户明确要求确认结果时，应补充 `draft_inspect`，用于查看草稿内容并校验是否添加正确
- 当句子中出现草稿标识（如 `草稿` / `draft` / `dfd_`），同时包含“检查 / 看一下 / 确认 / 校验 / 核对”等动词，且后续跟随视觉属性词（如动画、弹入、转场、位置、样式、特效等）时，应直接命中 `draft_inspect`

## 多域组合原则

一个任务不强制只能落在一个域。

典型组合：

- `workspace.read + web.search`
- `workspace.write + web.browser`
- `workspace.read + ai_media.image`
- `skills.find_skill + workspace.read`

建议规则：

1. 必须有一个 `primaryDomain`
2. `companionDomains` 最多挂 2 个，避免工具面再次膨胀
3. 先挂主域工具，再补伴随域工具

## 工具挂载策略

### 默认原则

- 不全量暴露工具
- 先暴露主域最小工具集
- 仅在子能力明确后继续扩展

### 例子

#### `workspace.read`

默认挂：

- `Read`
- `Glob`
- `Grep`

#### `workspace.write`

在 `workspace.read` 基础上追加：

- `Write`
- `Edit`
- `MultiEdit`

#### `workspace.execute`

在 `workspace.read` 基础上追加：

- `Bash`
- 测试/构建相关 runtime 工具

#### `web.search`

默认挂：

- `WebSearch`

#### `web.browser`

追加：

- `browser` MCP 相关工具

#### `ai_media.image`

只挂图片生成相关 MCP / runtime 工具

#### `skills.find_skill`

只挂技能发现相关工具，不直接挂技能执行全量工具

## 路由流程

建议分三步：

### 第一步：主域判断

先只判断任务主要属于哪一类：

- `chat`
- `workspace`
- `web`
- `ai_media`
- `skills`
- `auxiliary`
- `scrapt`
- `cut`

### 第二步：子能力判断

例如：

- `workspace.read`
- `workspace.write`
- `web.search`
- `ai_media.speech`

### 第三步：伴随域补充

如果请求明显跨域，再挂伴随域：

- 先主域
- 后伴随域
- 控制最大展开范围

## 低置信度兜底

当路由不够确定时，不要一次性暴露所有工具。

建议兜底方式：

1. 回退到 `chat`
2. 仅补最安全的发现型工具
3. 通过一次工具调用或一次补充判断，再进入更具体的域

可选兜底工具：

- `workspace.read/find`
- `web.search`
- `skills.find_skill`

## 示例

### 通用用户示例

| 用户输入 | 预期主域 | 预期子能力 | 备注 |
| --- | --- | --- | --- |
| `你好` | `chat` | `[]` | 基础对话 |
| `看下今天热点` | `web` | `["search"]` | 网络搜索 |
| `反推 xx 链接的提示词` | `scrapt` | `["derive_prompt"]` | 爬虫反推提示词 |
| `将一段声音合成语音` | `ai_media` | `["speech"]` | AI 媒体 |
| `用豆包语音生成一段带背景音乐和音效的音频` | `ai_media` | `["seed_audio"]` | 豆包音频生成，不是 TTS |
| `生成数字人` | `ai_media` | `["digital_human"]` | AI 媒体 |
| `写文案` | `chat` | `[]` | 基础对话 |
| `看看有没有文件` | `workspace` | `["find", "read"]` | 工作空间 |
| `写文件` | `workspace` | `["write"]` | 工作空间 |
| `写网页` | `workspace` | `["write"]` | 默认按生成/修改项目文件理解 |
| `查一下有没有 xxx 文字` | `workspace` | `["find", "read"]` | 工作空间文本检索 |
| `把这个文件上传到 oss` | `workspace` | `["upload", "read"]` | 本地文件上传 |
| `打开网页` | `web` | `["browser"]` | 网络搜索 / 浏览器交互 |
| `生成图片` | `ai_media` | `["image"]` | AI 媒体 |
| `创建一个草稿` | `cut` | `["draft_create"]` | 草稿创建 |
| `把这个草稿的封面和名称改一下` | `cut` | `["draft_update_meta"]` | 草稿元信息修改 |
| `下载草稿` | `cut` | `["draft_download"]` | 剪辑任务 |
| `给这段视频添加字幕模板` | `cut` | `["subtitle_template"]` | 字幕模版任务 |
| `剪一下口播` | `cut` | `["template"]` | 剪辑任务，后续可再细分 |
| `模版剪辑` | `cut` | `["template"]` | 剪辑任务 |
| `看下这个草稿内容对不对` | `cut` | `["draft_inspect"]` | 主动查看草稿内容 |
| `把这个草稿里很多元素都改一下，并确认有没有加对` | `cut` | `["template", "draft_inspect"]` | 复杂修改后追加核查 |

### 示例 1

用户输入：

`看下这个报错在哪个文件，再帮我修一下`

路由结果：

```json
{
  "primaryDomain": "workspace",
  "subdomains": ["find", "read", "write"],
  "companionDomains": [],
  "confidence": 0.93
}
```

### 示例 2

用户输入：

`查一下 React 19 的官方变更，再看下我们项目哪里要改`

路由结果：

```json
{
  "primaryDomain": "web",
  "subdomains": ["search"],
  "companionDomains": ["workspace"],
  "confidence": 0.91
}
```

### 示例 3

用户输入：

`给这段文案生成配音，再做一个数字人口播`

路由结果：

```json
{
  "primaryDomain": "ai_media",
  "subdomains": ["speech", "digital_human"],
  "companionDomains": [],
  "confidence": 0.96
}
```

### 示例 4

用户输入：

`有没有现成技能能做这个流程，没有就帮我创建一个`

路由结果：

```json
{
  "primaryDomain": "skills",
  "subdomains": ["find_skill", "create_skill"],
  "companionDomains": [],
  "confidence": 0.95
}
```

## 与当前实现的主要差异

当前实现更偏向：

- 按关键词直接推断最终工具层
- 一次性决定本轮要挂哪些 builtin / MCP

目标实现应改为：

- 先识别意图域
- 再按域装配工具面
- 支持多域组合
- 支持低置信度渐进展开

## 后续实现建议

### Phase 1

- 固化一级域与二级子能力枚举
- 建立“域 -> 默认工具集”映射

### Phase 2

- 替换当前单轴 `toolLayer` 判定
- 输出 `primaryDomain + subdomains + companionDomains`

### Phase 3

- 接入渐进展开机制
- 低置信度时只挂发现型工具

### Phase 4

- 为每个域补路由测试样例
- 为跨域组合补回归测试

## 验收标准

- 简单聊天任务不再挂载大工具面
- 写文件请求能够稳定命中 `workspace.write`
- 联网 + 本地分析任务能够同时挂载 `web + workspace`
- AI 媒体任务不会误挂大量无关工具
- 技能相关任务优先走 `skills` 域，而不是混入普通工具路由
