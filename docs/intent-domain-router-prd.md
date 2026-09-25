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
  primaryDomain: 'chat' | 'workspace' | 'materials' | 'web' | 'ai_media' | 'skills' | 'auxiliary' | 'scrapt' | 'cut'
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
- 通用命令执行 / Bash / terminal 任务

默认特征：

- 不挂或只挂极小工具面
- 优先保证回复速度和上下文稳定性

补充规则：

- `chat` 域默认不挂完整 `skills` 域能力
- 普通问答、总结、解释、改写等请求，仍按最小工具面处理
- 如果用户明确要求执行 shell / bash / terminal 命令，允许在 `chat` 域补充 `bash` 子能力
- 但如果用户输入中出现明确的本地 skill 信号，则不得继续按纯 `chat` 处理

建议子能力：

- `image_understand`
- `bash`

已接入工具：

- `image_understand` -> `mcp__vectcut__image-understand__inspect_image`；固定走视觉理解模型 `qwen3.7-plus`，远程图片 URL 直接透传，本地图片路径或 `file://` URL 由工具内部自动转成可提交格式；这是 chat 域默认挂载的识图能力，不需要先命中 `ai_media.image`
- `bash` -> `Bash`

说明：

- `image_understand`：用于“帮我看下这张图”“识别图里文字”“解释截图界面是什么”“描述图片内容”等聊天理解类识图请求。产品语义上属于 `chat` 域的固定理解能力，而不是 `ai_media.image` 那类图片生成/编辑能力；在 chat 域下应默认挂载，不要求先命中专门的识图路由才能暴露该 MCP
- `bash`：用于通用命令执行、终端探测、脚本运行、临时 shell 操作；它是底层通用执行能力，不等同于 `workspace` 域的工程读写能力；若任务核心是“跑一条命令”“执行脚本”“用 bash / terminal 处理文件”，应优先视为 `chat.bash`，再按需要伴随命中 `workspace`
- 除 `chat` 外，`workspace` / `materials` / `web` / `ai_media` / `skills` / `auxiliary` / `scrapt` / `cut` 这些已命中的主域，默认也允许伴随暴露 `Bash`，用于模型在主工具链不足时执行必要的目录探测、脚本编排或命令兜底；但它仍属于通用底层能力，不改变各主域的优先工具选择

本地 skill 信号至少包括：

- `@技能名`
- “执行这个技能”
- “运行这个技能”
- “用当前这个技能”
- 明确点名当前 workspace 下已存在的本地 skill 名

一旦命中上述信号，应直接升级到 `skills` 域，而不是继续停留在 `chat`

### 2. `workspace`

适用于本地工程、文件、代码、日志相关任务。

建议子能力：

- `read`
- `write`
- `find`
- `notebook`
- `task`
- `download`
- `upload`

已接入工具：

- `read` -> `Read` / `Bash`
- `write` -> `Write` / `Edit` / `MultiEdit`
- `find` -> `Bash`
- `notebook` -> `NotebookRead` / `NotebookEdit`
- `task` -> `Task` / `TodoWrite`
- `download` -> `mcp__vectcut__filesystem-server__download`
- `upload` -> `mcp__vectcut__file-upload__upload_file_to_oss`

说明：

- `Read` / `Bash`：当返回内容特别长（如大文件、长日志、长命令输出）时，允许工具内部先做一层“结果整理/摘要预览”，优先返回结构化的关键信息、统计信息、命中片段、头尾片段、错误摘要或下一步可继续读取的定位信息，而不是把整段原文直接塞进模型上下文
- `Read` / `Bash`：工具内摘要只负责改善可读性与上下文利用率，不替代原始结果持久化；系统侧仍应保留完整 `rawOutput`，模型消费侧仅使用工具提供的 `inline/summary` 结果，并保留统一的 `16KB` 硬截断兜底
- `download`：当用户需要把远程文件、图片、音频、视频链接下载到当前 workspace 时使用；应优先保存到当前工作空间内的目标目录，而不是系统 Downloads；适用于通用文件落地，不负责媒体裁剪、抽帧、拼接等后处理
- `upload`：当用户需要上传本地文件并拿到可复用 URL 时使用；统一走 `POST https://open.vectcut.com/sts/upload/agent_tmp/init`：先传 `file_name` 获取 `upload.upload_url`、`upload.form_data`、`download.signed_url` 与 `object_key`，再把本地文件按返回表单直传到 OSS，并返回 `download.signed_url` 作为后续提交给远端能力的可访问 URL；文件大小限制不超过 `500MB`，上传前先校验并在超限时报错；凡是本文提到的 MCP 工具需要上传本地文件时，无论是显式命中 `workspace.upload`，还是工具内部自动上传本地素材，都应复用这条 `/sts/upload/agent_tmp/init` 链路

### 3. `materials`

适用于搜寻、查看用户素材库信息相关任务。

建议子能力：

- `folder_links`

已接入工具：

- `folder_links` -> `mcp__vectcut__materials__folder_links`

说明：

- `folder_links`：用于获取素材库某个文件夹 `id` 下的文件列表；由于返回结果本质上是一组文件链接，执行时应优先将完整结果写入当前 workspace 内的结果文件，而不是直接把整包内容返回给模型；工具最终仅返回该结果文件路径，便于后续继续读取、过滤或二次处理
- 当用户已经明确给出素材库文件夹 `id`，或上下文中目标文件夹已可唯一确定时，应优先命中 `folder_links`

### 4. `web`

适用于联网信息获取和页面交互。

建议子能力：

- `search`
- `browser`
- `execute`
- `download`
- `screenshot`

已接入工具：

- `search` -> `WebSearch` / `mcp__vectcut__search__web_search`
- `browser` -> `mcp__vectcut__browser__open` / `mcp__vectcut__browser__click` / `mcp__vectcut__browser__type` / `mcp__vectcut__browser__press` / `mcp__vectcut__browser__scroll` / `mcp__vectcut__browser__focus` / `mcp__vectcut__browser__hover` / `mcp__vectcut__browser__wait_for` / `mcp__vectcut__browser__inspect` / `mcp__vectcut__browser__reload` / `mcp__vectcut__browser__list_tabs` / `mcp__vectcut__browser__switch_tab` / `mcp__vectcut__browser__close_tab` / `mcp__vectcut__browser__reset`
- `execute` -> `mcp__vectcut__browser__execute`
- `download` -> `mcp__vectcut__filesystem-server__download`
- `screenshot` -> `mcp__vectcut__browser__screenshot` / `mcp__vectcut__browser__snapshot`

说明：

- `download`：当任务核心是把远程链接内容保存到当前 workspace，而不是打开页面交互时使用；适用于下载网页上的文件直链、音频链接、视频链接、图片链接或其他可直接落地的远程资源；和 `browser` 的区别是：`download` 负责把文件保存到本地，`browser` 负责打开页面并交互

备注：当前不开放独立的网页抓取工具；已知 URL 如果目标是页面浏览、交互或截图，优先通过 `browser` / `execute` 处理；如果目标是把资源落地到本地，则应优先考虑 `download`。


### 5. `ai_media`

适用于 AI 媒体生成相关任务。

建议子能力：
- `image`
- `video`
- `speech`
- `voice_conversion`
- `seed_audio`
- `digital_human`

已接入工具：

- `image` -> `mcp__vectcut__image__generate_or_edit_image` / `mcp__vectcut__image__generate_image` / `mcp__vectcut__image__get_image_capabilities`；图片生成/编辑默认通过单个长任务工具直出最终结果；远程参考图可直接传入，本地图片路径或 `file://` URL 也允许直接传入并由工具内部自动上传处理；其中截图/剪贴板图片等无稳定 `filePath` 的附件素材仍可走 `workspace.upload` 的 `base64` / `dataUrl` 上传语义
- `video` -> `mcp__vectcut__video__generate_video` / `mcp__vectcut__video__get_video_capabilities`；用于 AI 视频生成聚合能力，覆盖文生视频、图生视频、首帧扩展、首尾帧视频，以及 Seedance 2.0 系列的多模态参考视频生成；默认通过单个长任务工具直出最终结果；远程参考图、参考视频、参考音频可直接传入，本地路径或 `file://` URL 也允许直接传入并由工具内部自动上传处理
- `speech` -> `mcp__vectcut__speech__generate_speech`
- `voice_conversion` -> `mcp__vectcut__voice-conversion__submit_voice_conversion_task` / `mcp__vectcut__voice-conversion__get_voice_conversion_task_status`
- `seed_audio` -> `mcp__vectcut__seed-audio__generate_seed_audio`
- `digital_human` -> `mcp__vectcut__digital-human__create_lip_sync_digital_human` / `mcp__vectcut__digital-human__create_image_driven_digital_human` / `mcp__vectcut__digital-human__create_omni_image_driven_digital_human` / `mcp__vectcut__digital-human__create_seedance_digital_human`（各工具内部完成提交与轮询，直接返回最终视频结果）

说明：

- 本地参考图片 / 视频 / 音频不再默认视为独立前置上传步骤；对 `image` / `video` / `digital_human` 这类远端生成能力，只要工具本身已支持本地路径或 `file://` URL，就应优先直接调用对应工具，由工具内部完成上传与后续提交；只有用户明确要单独拿可复用公网 URL，或输入形态是截图 / 剪贴板 / base64 附件且没有稳定本地路径时，才应补充 `workspace.upload`
- `image`：图片生成/编辑默认可直接使用文本提示词；若还带参考图片，远程图片链接可直接传入，本地图片路径或 `file://` URL 也允许直接传入并由工具内部处理；对 Agent 暴露时应优先按单个长任务工具理解，等待其直接返回最终图片结果，而不是拆成独立状态查询步骤
- `video`：AI 视频生成默认命中该子能力，适用于“生成视频”“文生视频”“图生视频”“首帧扩展”“首尾帧视频”“视频生成”等表述；调用上应优先使用 `mcp__vectcut__video__generate_video`，并把它视为单个长任务工具，等待其直接返回最终视频结果；当用户要查询可用模型、分辨率、时长、是否支持音频、首尾帧、多图参考、超分等能力时，应命中 `mcp__vectcut__video__get_video_capabilities`；对于 Seedance 2.0 系列的多模态参考生成，优先使用 `content` 数组表达 `text` / `reference_image` / `reference_video` / `reference_audio` 输入
；如果用户给的是“参考视频”，应优先原样保留为 `video_url` + `role=reference_video`，不要默认把视频拆成抽帧图片 + 分离音频，除非用户明确要求“抽帧”“拆音轨”“提取参考图/参考音频”
- `speech`：传统 TTS，按“文字 + 音色”合成语音；凡是“语音合成”“生成语音”“配音”“朗读”“念出来”等表述，都默认命中 `speech`；即使出现“豆包”“多人”“背景音乐”“音效”等词，只要没有完整出现精确短语 `豆包生成语音` 或 `豆包语言生成`，也一律不要命中 `seed_audio`
- `voice_conversion`：AI 变声 / 声音转换，输入应是原始音频或视频，再指定目标 `voice_id`，将现有声音转换成另一种音色；默认理解为尽量保持原始语速、停顿和情绪不变，而不是重新按文本做 TTS；当用户表达“变声”“换音色”“把这段音频换成另一个声音”“保持语速不变”“保持情绪不变”等诉求时，应优先命中 `voice_conversion`；接口形态上应视为异步任务，先提交原始 `audio_url` / `video_url` 与目标 `voice_id` 获取 `task_id`，再轮询任务状态直至拿到 `result.converted_url`；远程音频/视频链接可直接传入，本地音频/视频绝对路径或 `file://` URL 也允许直接传入并由工具内部自动上传处理，不需要额外先走 `workspace.upload`
- `seed_audio`：仅在用户输入中完整出现精确短语 `豆包生成语音` 或 `豆包语言生成` 时才命中；少一个字、错一个字、换序表达（如“用豆包语音生成”）都不能命中 `seed_audio`
- `digital_human`：数字人生成功能对 Agent 暴露为单个长任务工具，内部自行处理异步任务提交与轮询，不再要求单独状态查询；远程音频 / 视频 / 图片链接可直接传入，本地绝对路径或 `file://` URL 也允许直接传入并由工具内部处理；整体耗时通常为 `15~30` 分钟，完成后直接返回最终视频结果

### 6. `skills`

适用于技能搜索、查看、修改、执行、删除，以及安装、创建、注册等技能相关任务。

建议子能力：

- `search_skill`
- `list_skill`
- `create_skill`
- `register_skill`
- `invoke_skill`

已接入工具：

- `search_skill` -> `mcp__vectcut__skills__skills`
- `list_skill` -> `mcp__vectcut__skills__skills`
- `create_skill` -> `mcp__vectcut__skills__skills`
- `register_skill` -> `mcp__vectcut__skills__skills`
- `invoke_skill` -> 宿主侧本地 skill invoke 能力

说明：

- `search_skill`：查技能市场里的现成能力，对应 `action="search"`
- `list_skill`：查看当前 agent 已启用或可见的技能，对应 `action="list"`
- `create_skill`：在当前 agent 的 `.claude/skills/<name>` 下初始化技能目录，对应 `action="init"`
- `register_skill`：校验并注册当前 agent 下刚创建的技能，对应 `action="register"`
- `invoke_skill`：执行当前 workspace 下的本地 skill；执行时必须定位并读取目标 `SKILL.md`，不能只靠 `name` / `description` / `filename`
- `skills` 域包含两类能力：
  - 技能管理能力：`search_skill` / `list_skill` / `create_skill` / `register_skill`
  - 技能执行能力：`invoke_skill`
- 技能管理能力不等于技能执行能力
- 不能因为已经挂载了 `search_skill` 或 `list_skill`，就认为系统已经具备执行本地 skill 的能力
- **只要命中 `skills` 域**，不区分它是主域还是伴随域，默认直接进入**全量挂载模式**
- 全量挂载模式包含两部分：
  - 挂载当前 workspace 下全部本地技能：`/workspace/.claude/skills/*/SKILL.md`
  - 挂载全部 builtin tools 与全部 runtime MCP tools
- `skills` 域优先保证技能相关任务的可执行性，不以最小工具面为目标
- `skills` 工具默认面向技能管理语义，但对于“当前 agent 是否已有某个本地技能 / 要执行哪个本地技能”这类判断，**唯一技能源** 应是当前 workspace 下的 `.claude/skills/<name>/SKILL.md`
- 这里的 `/workspace` 指当前会话绑定的 agent workspace root；例如 `/workspace/.claude/skills/<name>/SKILL.md`
- `search_skill` **只**用于查技能市场，不用于判断当前 workspace 里是否已存在某个技能；不能因为 `search_skill` 返回空就得出“本地没有这个技能”
- `list_skill` 的正确语义是“列出当前 agent 已启用或可见的技能”；其中“已启用”部分应优先从当前 workspace 的 `.claude/skills` 枚举，再补充全局技能目录中的可见但未启用技能
- 全局技能目录（如 `Data/Skills`）是安装缓存 / 共享注册表，不应覆盖当前 workspace 下本地技能的判定结果
- 如果用户说“执行这个技能 / @某个技能 / 当前就有这个技能”，应优先按当前 workspace 的 `.claude/skills/<name>/SKILL.md` 做本地命中，而不是先走 `search_skill`
- 如果用户要“查看 / 修改技能文件内容”，由于 `skills` 域命中后已经进入全量挂载模式，允许直接基于当前 workspace 下 `.claude/skills/<name>` 或 `list_skill` 返回的真实路径读取、编辑、执行或删除

#### 本地技能判定顺序

当用户请求涉及“当前 agent 的本地技能”时，建议按下面顺序处理：

1. 先确定当前会话绑定的 workspace root
2. 再检查 `/workspace/.claude/skills/<name>/SKILL.md` 是否存在
3. 若存在，直接视为本地技能命中
4. 如果用户意图是执行 skill，则直接进入 `invoke_skill`
5. 如果用户意图是查看当前可见技能，则调用 `list_skill`
6. 若本地不存在，再根据用户意图决定是否调用 `list_skill` 查看已启用 / 可见技能
7. 仅当用户明确要“搜索现成技能 / 安装新技能”时，才调用 `search_skill`

反例：

- 不能把“`search_skill("儿童绘本")` 没结果”解释为“当前 workspace 里没有 `儿童绘本` 技能”
- 不能只扫描全局 `Data/Skills` 就忽略当前 workspace 的 `.claude/skills`

### 7. `auxiliary`

适用于辅助型 Agent 能力，不直接归属技能发现或媒体生成。

建议子能力：

- `memory`
- `assistant`
- `automation`
- `system`

已接入工具：

- `assistant` -> `mcp__vectcut__assistant__navigate` / `mcp__vectcut__assistant__diagnose`
- `automation` -> `mcp__vectcut__claw__cron` / `mcp__vectcut__claw__notify` / `mcp__vectcut__claw__config`
- `system` -> `mcp__vectcut__system__open_deeplink`

### 8. `scrapt`

适用于爬虫反推提示词任务。

建议子能力：

- `derive_prompt`

已接入工具：

- `derive_prompt` -> `mcp__vectcut__copylab__derive_copy_prompt`


### 9. `cut`

适用于剪辑任务。

建议子能力：

- `audio_extract`
- `audio_concat`
- `media_download`
- `frame_capture`
- `media_duration`
- `media_trim`
- `video_concat`
- `draft_create`
- `draft_update_meta`
- `draft_inspect`
- `draft_download`
- `draft_export`
- `text_add`
- `text_add_batch`
- `text_delete`
- `text_update`
- `subtitle_srt`
- `subtitle_recognition`
- `video_understand`
- `text_intro_animation_list`
- `text_outro_animation_list`
- `text_loop_animation_list`
- `font_list`
- `image_add`
- `image_add_batch`
- `add_preset`
- `add_batch_preset`
- `image_update`
- `image_delete`
- `video_add`
- `video_add_batch`
- `video_update`
- `video_delete`
- `transition_type_list`
- `audio_add`
- `audio_add_batch`
- `audio_update`
- `audio_delete`
- `audio_effect_type_list`
- `keyframe_add`
- `effect_add`
- `effect_update`
- `effect_delete`
- `character_effect_type_list`
- `scene_effect_type_list`
- `filter_add`
- `filter_update`
- `filter_delete`
- `filter_type_list`
- `image_intro_animation_list`
- `image_outro_animation_list`
- `image_loop_animation_list`
- `workflow`：执行剪辑工作流
- `subtitle_template`
- `template`

已接入工具：

- `audio_extract` -> `mcp__vectcut__ffmpeg-media__extract_audio_from_video`
- `audio_concat` -> `mcp__vectcut__ffmpeg-media__concatenate_audio_files`
- `media_download` -> `mcp__vectcut__filesystem-server__download`
- `frame_capture` -> `mcp__vectcut__ffmpeg-media__capture_frame_at_timestamp`
- `media_duration` -> `mcp__vectcut__ffmpeg-media__get_media_duration`
- `media_trim` -> `mcp__vectcut__ffmpeg-media__trim_media_segment`
- `video_concat` -> `mcp__vectcut__ffmpeg-media__concatenate_video_files`
- `draft_create` -> `mcp__vectcut__draft-management__create_draft`
- `draft_update_meta` -> `mcp__vectcut__draft-management__modify_draft`
- `draft_inspect` -> `mcp__vectcut__draft-management__query_script`
- `draft_download` -> `mcp__vectcut__draft-download__download_draft`
- `draft_export` -> `mcp__vectcut__draft-download__export_draft`
- `text_add` -> `mcp__vectcut__draft-elements__add_text`
- `text_add_batch` -> `mcp__vectcut__draft-elements__add_batch_text`
- `text_delete` -> `mcp__vectcut__draft-elements__remove_text`
- `text_update` -> `mcp__vectcut__draft-elements__modify_text`
- `subtitle_srt` -> `mcp__vectcut__draft-elements__add_subtitle`
- `subtitle_recognition` -> `mcp__vectcut__subtitle-recognition__submit_subtitle_recognition_task`（单工具封装任务提交 + 轮询直到完成，不再对 Agent 暴露独立的 task_status 工具；支持 `basic`、`nlp`、`llm`、`llm_vad` 四个档位；回包中的字幕内容可能很长，完整结果优先直接写入当前 workspace 根目录下的 `<taskId>.json`，工具只返回摘要与文件路径；该调用可能持续 `15~30` 分钟，应按长耗时工具处理，MCP tool 超时与前端运行态展示可参考 `mcp__vectcut__koubo-template__submit_koubo_template_task` / `KouboTemplateTool.tsx`）
- `video_understand` -> `mcp__vectcut__video-understand__submit_video_detail_task`（单工具封装本地视频上传 / 远程视频直传、异步任务提交与轮询直到完成；完整结果优先直接写入 workspace 本地 `.capcut/tool-results/video-understand/<taskId>.json`，工具只返回摘要与文件路径；该调用可能持续 `15~30` 分钟，应按长耗时工具处理）
- `text_intro_animation_list` -> `mcp__vectcut__draft-elements__get_text_intro_types`
- `text_outro_animation_list` -> `mcp__vectcut__draft-elements__get_text_outro_types`
- `text_loop_animation_list` -> `mcp__vectcut__draft-elements__get_text_loop_anim_types`
- `font_list` -> `mcp__vectcut__draft-elements__get_font_types`
- `image_add` -> `mcp__vectcut__draft-elements__add_image`
- `image_add_batch` -> `mcp__vectcut__draft-elements__add_batch_image`
- `add_preset` -> `mcp__vectcut__draft-elements__add_preset`
- `add_batch_preset` -> `mcp__vectcut__draft-elements__add_batch_preset`
- `image_update` -> `mcp__vectcut__draft-elements__modify_image`
- `image_delete` -> `mcp__vectcut__draft-elements__remove_image`
- `video_add` -> `mcp__vectcut__draft-elements__add_video`
- `video_add_batch` -> `mcp__vectcut__draft-elements__add_batch_video`
- `video_update` -> `mcp__vectcut__draft-elements__modify_video`
- `video_delete` -> `mcp__vectcut__draft-elements__remove_video`
- `transition_type_list` -> `mcp__vectcut__draft-elements__get_transition_types`
- `audio_add` -> `mcp__vectcut__draft-elements__add_audio`
- `audio_add_batch` -> `mcp__vectcut__draft-elements__add_batch_audio`
- `audio_update` -> `mcp__vectcut__draft-elements__modify_audio`
- `audio_delete` -> `mcp__vectcut__draft-elements__remove_audio`
- `audio_effect_type_list` -> `mcp__vectcut__draft-elements__get_audio_effect_types`
- `keyframe_add` -> `mcp__vectcut__draft-elements__add_video_keyframe`
- `effect_add` -> `mcp__vectcut__draft-elements__add_effect`
- `effect_update` -> `mcp__vectcut__draft-elements__modify_effect`
- `effect_delete` -> `mcp__vectcut__draft-elements__remove_effect`
- `character_effect_type_list` -> `mcp__vectcut__draft-elements__get_video_character_effect_types`
- `scene_effect_type_list` -> `mcp__vectcut__draft-elements__get_video_scene_effect_types`
- `filter_add` -> `mcp__vectcut__draft-elements__add_filter`
- `filter_update` -> `mcp__vectcut__draft-elements__modify_filter`
- `filter_delete` -> `mcp__vectcut__draft-elements__remove_filter`
- `filter_type_list` -> `mcp__vectcut__draft-elements__get_filter_types`
- `image_intro_animation_list` -> `mcp__vectcut__draft-elements__get_intro_animation_types`
- `image_outro_animation_list` -> `mcp__vectcut__draft-elements__get_outro_animation_types`
- `image_loop_animation_list` -> `mcp__vectcut__draft-elements__get_combo_animation_types`
- `workflow` -> `mcp__vectcut__cut-workflow__execute_workflow`
- `subtitle_template` -> `mcp__vectcut__subtitle-template__generate_smart_subtitle`
- `template` -> `mcp__vectcut__koubo-template__submit_koubo_template_task`

说明：

- `audio_extract` / `audio_concat` / `frame_capture` / `media_duration` / `media_trim` / `video_concat`：属于本地媒体处理能力，统一使用应用随包安装的 `ffmpeg` / `ffprobe` 执行，不依赖远端剪映草稿接口；其中 `audio_extract` / `audio_concat` / `frame_capture` / `media_trim` / `video_concat` 在未显式传入 `output_path` 时，若输入是本地文件，默认将产物写到首个源文件同目录；若输入是远程 URL，则可退回临时目录
- `media_download`：用于先把远程音频、图片、视频链接下载到当前 workspace，再交给后续 `ffmpeg` 能力处理；当用户给的是 OSS 临时链接、外部图片链接、音视频直链，且后续任务要求本地裁剪、拼接、抽帧或其他依赖本地文件的媒体处理时，应优先补充该子能力，避免直接把不稳定远程 URL 交给 `ffmpeg`
- `subtitle_recognition`：仅负责识别并提取音频或视频中的字幕内容，不负责把文字添加回草稿，也不负责上屏样式；对 Agent 暴露为单个长耗时工具，内部自行完成本地媒体上传（如有）、异步 ASR 任务提交与轮询，不再拆成独立状态查询工具；远程音频/视频链接可直接传入，本地音频/视频绝对路径或 `file://` URL 也允许直接传入并由工具内部自动上传处理；返回结果中的字幕 JSON 可能很大，完整内容优先直接落盘到当前 workspace 根目录下的 `<taskId>.json`，工具仅返回摘要与文件路径；整体耗时可能达到 `15~30` 分钟，超时与运行态展示策略参考口播模版长任务；档位分为 `basic`（基础、快速）、`nlp`（在 `basic` 基础上增加 12 字一句上限，适合短视频场景，属于快速分句）、`llm`（在 `basic` 基础上增加 12 字上限、翻译、关键词信息，属于智能分句）、`llm_vad`（在 `llm` 基础上进一步去除气口、重复、错误字）
- `video_understand`：视频理解能力，仅负责结构化理解视频画面内容，不描述声音；对 Agent 暴露为单个长耗时工具，内部自行完成本地视频上传（如有）、异步任务提交与轮询，不再拆成独立状态查询工具；支持单视频 `video_url` 或多视频 `video_urls`，也支持补充 `fps` / `fps_list` 控制抽帧；远程视频链接可直接传入，本地视频绝对路径或 `file://` URL 也允许直接传入并由工具内部处理；整体耗时通常为 `15~30` 分钟，完成后直接返回最终结果摘要与落盘文件路径
- `subtitle_template`：字幕样式模版能力，强调“把音频/视频中的文字按指定字幕模版添加回草稿并上屏”，而不是单纯提取字幕；可基于已有草稿继续编辑；用户可主动指定字幕模版，默认使用 `asr_42da310c1e4347ddb2c96dd2a5d055c2`；对 Agent 暴露为单个长耗时工具，内部自行完成异步任务提交与轮询，不再拆成独立状态查询工具；整体耗时通常为 `15~30` 分钟，完成后直接返回最终草稿结果；若输入是本地文件，则字幕模版阶段只提交音频素材（本地视频先抽取音频并上传，本地音频直接上传），并强制不在该阶段把素材写入草稿，待模板草稿生成完成后再把原始本地视频或音频补回草稿
- `workflow`：剪辑工作流能力，面向一次性提交 `inputs + script` 或 `workflow_id` 给 `/cut_jianying/execute_workflow`，由服务端按工作流 DSL 执行包含 `if` / `loop` / 多步骤编排在内的复杂剪辑流程；它不是“批量工具”的别名。`add_batch_*` 这类工具只表示单个平铺批量操作，不具备工作流分支、循环和编排语义。只要用户明确表达“执行工作流 / workflow / workflow_id / execute_workflow”，就必须优先命中 `workflow`，不能因为句子里同时出现“批量”“多个”“一次性”而退化到 `text_add_batch`、`image_add_batch`、`video_add_batch`、`audio_add_batch`、`add_batch_preset` 等批量工具；该调用可能持续 `15~30` 分钟，应按长耗时工具处理；工作流中的 `inputs` / `script` 既支持远程 URL，也支持本地音频、图片、视频绝对路径或 `file://` URL，Agent 不需要额外先走 `workspace.upload`
- `image_add` / `video_add` / `audio_add`：既支持远程 `image_url` / `video_url` / `audio_url`，也支持把本地文件路径直接放进对应的 `image_url` / `video_url` / `audio_url`；收到本地路径时不默认自动上传，只有用户明确要拿可复用公网 URL 时才应命中 `workspace.upload`，并统一通过 `/sts/upload/agent_tmp/init` 获取临时可访问 URL
- `add_preset` / `add_batch_preset`：预设片段能力，面向用户预先在剪映中制作并上传、已拿到 `preset_id` 的预设模版；`add_preset` 用于添加单个预设片段，支持通过 `replacements` 替换其中的图片、视频、文字、音频等素材，支持 `target_start`、`track_name`、位移缩放旋转以及画布尺寸参数，未传 `draft_id` 时默认生成新草稿；`add_batch_preset` 用于一次插入多个预设片段，核心参数是 `preset_ids`、`starts`、`ends`，并可选传入 `target_starts`、`target_ends` 控制各片段目标时间范围；适合字幕片段、混剪素材、批量画中画等重复结构内容生成
- `template`：口播模版剪辑，面向一段原始未剪辑口播做整体剪辑和套版；该子能力只接受视频输入，必须使用 `video_url` / `video_urls`，不能传 `audio_url` / `audio_urls`；远程视频链接可直接传入，本地视频文件路径或 `file://` URL 也允许直接传入并由工具内部自行处理，无需单独前置 `workspace.upload`；本地视频文件大小不得超过 `500MB`；模版内容通常包含字幕、音频、动画，不等同于字幕模版
- `transition_type_list`：转场类型主要用于图片/视频等视觉素材衔接；用户提到“查看可用的转场类型”时应直接命中该子能力
- `image_intro_animation_list` / `image_outro_animation_list` / `image_loop_animation_list`：图片和视频共用同一套动画查询工具；用户提到“查看视频入场动画 / 视频出场动画 / 视频循环动画”时，也应命中这三个子能力
- `draft_download`：专用于下载剪映草稿；当当前句子或前文上下文里已经出现 `草稿` / `draft` / `draft_id` / `draft_url` / `dfd_` 等草稿标识时，下载语义应优先命中 `draft_download`，不要误落到 `workspace.download` 或 `media_download`
- `draft_export`：专用于导出剪映草稿；当当前句子或前文上下文里已经出现 `草稿` / `draft` / `draft_id` / `draft_url` / `dfd_` 等草稿标识时，导出语义应优先命中 `draft_export`，不要误落到 `workspace.download`、`media_download` 或 `draft_download`
- `draft_export` 与 `draft_download` 在路由语义层保持分离，但执行层共用同一个 `draft-download` server 实现，分别调用 `mcp__vectcut__draft-download__export_draft` 与 `mcp__vectcut__draft-download__download_draft`

- 用户提到“分离视频里的音频”“提取视频音频”“提取 xxx 文件的音频”“导出音轨”时，应优先命中 `audio_extract`
- 用户提到“把两个音频拼在一起”“合并多个音频”“拼接音频文件”“把几段录音接成一个”时，应优先命中 `audio_concat`
- 用户提到“下载这个音频”“下载这张图片”“下载这个视频”“把这个媒体链接保存到本地”时，应优先命中 `media_download`
- 用户提到“截取某个时间戳的帧图片”“在 10 秒处截一帧”“抽一张帧图”时，应优先命中 `frame_capture`
- 用户提到“获取视频时长”“查看音频时长”“查询 media duration”时，应优先命中 `media_duration`
- 用户提到“截取 10 秒到 25 秒的视频片段”“裁一段音频出来”“按时间范围剪一段素材”时，应优先命中 `media_trim`
- 用户提到“把两个视频拼在一起”“合并多个视频片段”“拼接视频文件”“把几段视频接成一个”时，应优先命中 `video_concat`
- 用户提到“识别这个音频里的字幕”“提取这个视频链接的字幕”“把这段音频转成带时间轴的字幕”“识别链接里的文案/字幕”时，应优先命中 `subtitle_recognition`
- 用户提到“理解这个视频在讲什么”“分析这个视频画面内容”“总结视频镜头内容”“识别视频里出现了什么画面/场景/人物/动作”时，应优先命中 `video_understand`
- 用户提到“帮我看下这张图”“识别图里文字”“解释这个截图界面是什么”“描述图片里有什么”“看看这张图在讲什么”时，应优先命中 `chat.image_understand`
- 用户提到“执行剪辑工作流”“运行 workflow_id”“把 inputs + script 一次性写进草稿”“调用 execute_workflow”“按工作流执行”时，应优先命中 `workflow`，且不要再并行命中 `add_batch_*` 或其他单步草稿编辑工具
- 用户提到“下载草稿”“把这个 draft 下载下来”“下载这个 draft_url”“下载 dfd_xxx 对应的草稿”时，应优先命中 `draft_download`
- 用户提到“导出草稿”“把这个 draft 导出来”“导出这个 draft_url”“导出 dfd_xxx 对应的草稿”时，应优先命中 `draft_export`
- `subtitle_recognition` 支持服务端可访问的音频/视频链接，也支持本地音频/视频文件路径、拖入文件或 workspace 内文件；遇到本地媒体时，工具内部负责上传后再调用远端字幕识别接口，Agent 不需要额外先走 `workspace.upload`
- `video_understand` 支持服务端可访问的视频链接，也支持本地视频文件路径、拖入文件或 workspace 内视频；遇到本地视频时，工具内部负责上传后再调用远端视频理解接口，Agent 不需要额外先走 `workspace.upload`
- 当用户明确表达“只提取字幕”“不要上屏”“不要添加到草稿”“先识别出字幕文本/时间轴”时，必须命中 `subtitle_recognition`，不要误落到 `subtitle_template`
- 当用户明确表达“添加字幕模版”“套字幕样式”“把字幕加回草稿”“识别后按某种样式上屏”时，应命中 `subtitle_template`；其核心目标是样式化字幕并回写草稿，而非只返回识别结果
- 若一句话里同时出现“识别字幕”和“添加模版/加回草稿/上屏”等表述，应以最终目标判断；最终目标是拿到字幕文本或时间轴时命中 `subtitle_recognition`，最终目标是生成带样式字幕并写回草稿时命中 `subtitle_template`
- 用户提到“添加预设片段”“插入一个预设模板”“把某个 preset 加到草稿里”“替换预设里的图片/文字/视频/音频”时，应命中 `add_preset`
- 用户提到“批量添加预设”“一次插入多个预设片段”“按多个 preset_id 顺序插入”“批量替换多个预设内容”时，应命中 `add_batch_preset`
- 当用户提供远程音频/图片/视频 URL，后续又要求本地 `ffmpeg` 处理（如拼接、裁剪、抽帧）时，推荐组合命中 `media_download`，先下载到 workspace 再处理，避免远程临时链接失效或 `ffprobe` / `ffmpeg` 直接读取失败
- 若“下载”请求同时满足草稿标识和普通 URL 特征，应以 `draft_download` 为最高优先级；只有在没有任何草稿上下文时，才考虑 `workspace.download` 或 `media_download`
- 对 `audio_extract` / `audio_concat` / `frame_capture` / `media_trim` / `video_concat`，如果输入媒体文件位于当前 workspace 且用户未指定输出路径，默认应将新文件生成在首个源文件同目录，而不是系统临时目录；`media_duration` 为只读探测，不生成新文件
- 用户提到“创建草稿” / “创建一个草稿” / “创建一个剪映草稿” / “创建一个剪辑草稿”时，应命中 `draft_create` + `draft_update_meta`
- 当同一句话同时包含“创建”语义，且路由结果同时带上 `workspace.write` 时，执行阶段仍应优先使用 `mcp__vectcut__draft-management__create_draft`；不要因为存在通用写文件工具就手动创建本地草稿目录、草稿 JSON 或空白草稿脚手架
- `draft_create` / `draft_update_meta` 的 `cover` 参数应支持远程 URL、`file://` URL 和绝对本地路径；若传入本地路径，应由工具内部完成上传与后续提交，不应额外前置独立 `workspace.upload`
- 用户提到“修改草稿封面”或“修改草稿名称”时，优先命中 `draft_update_meta`
- 若用户使用结构化提示词表达草稿元信息修改，例如“请修改当前草稿”并同时给出 `草稿ID` + `草稿名` / `封面图` 字段，也应命中 `draft_update_meta`
- 当任务涉及复杂草稿修改、修改了多个元素，或用户明确要求确认结果时，应补充 `draft_inspect`，用于查看草稿内容并校验是否添加正确
- 当句子中出现草稿标识（如 `草稿` / `draft` / `dfd_`），同时包含“检查 / 看一下 / 确认 / 校验 / 核对”等动词，且后续跟随视觉属性词（如动画、弹入、转场、位置、样式、特效等）时，应直接命中 `draft_inspect`


### 10. `story`

适用于字幕分镜编辑任务，专门服务于 `PartSplitToolDetail`（字幕分镜工具）的 AI 辅助能力。

设计动机：

- 当前 AI 辅助完全依赖一段冗长的自然语言提示词让模型直接 `Read` / `Write` 分镜 JSON 文件；自然语言难以准确表达“合并的 ranges 拼接规则”“逐字 words 的 UTF-16 偏移与 text 一致性”“删除区间后剩余源时间的分裂”等复杂结构约束
- 模型经常在时间、`ranges`、`captions.words.from/to` 之类的细节上出错，导致 `validateAiStoryboard` / `validateParts` 校验失败并回滚
- 引入一组“固定的分镜操作 MCP 工具”，把这些结构约束封装在工具内部实现（复用 `model.js` 已有的纯函数 `mergeParts / splitPart / activeParts / labelParts / validateParts` 等），模型只负责选择合适的工具与最少必要参数，不再手写整段 JSON

建议子能力：

- `storyboard_inspect`
- `storyboard_update_text`
- `storyboard_split_part`
- `storyboard_merge_parts`
- `storyboard_delete_parts`
- `storyboard_delete_range`
- `storyboard_duplicate_part`
- `storyboard_move_part`
- `storyboard_clear_part_text`
- `storyboard_insert_blank_part`
- `storyboard_adjust_part_bounds`
- `storyboard_apply_operations`

计划接入工具（尚未实现，落地在 `src/main/mcpServers/storyboard-editor.ts`）：

- `storyboard_inspect` -> `mcp__vectcut__storyboard-editor__inspect_storyboard`
- `storyboard_update_text` -> `mcp__vectcut__storyboard-editor__update_part_text`
- `storyboard_split_part` -> `mcp__vectcut__storyboard-editor__split_part`
- `storyboard_merge_parts` -> `mcp__vectcut__storyboard-editor__merge_parts`
- `storyboard_delete_parts` -> `mcp__vectcut__storyboard-editor__delete_parts`
- `storyboard_delete_range` -> `mcp__vectcut__storyboard-editor__delete_range`
- `storyboard_duplicate_part` -> `mcp__vectcut__storyboard-editor__duplicate_part`
- `storyboard_move_part` -> `mcp__vectcut__storyboard-editor__move_part`
- `storyboard_clear_part_text` -> `mcp__vectcut__storyboard-editor__clear_part_text`
- `storyboard_insert_blank_part` -> `mcp__vectcut__storyboard-editor__insert_blank_part`
- `storyboard_adjust_part_bounds` -> `mcp__vectcut__storyboard-editor__adjust_part_bounds`
- `storyboard_apply_operations` -> `mcp__vectcut__storyboard-editor__apply_operations`

公共约束：

- 所有工具都必须接收 `storyboard_path`（分镜 JSON 绝对路径，通常是 `<workspace>/part_*.json`），并直接读写该文件；禁止操作源 `sre_*.json` 或其他媒体文件
- 分镜 JSON 顶层必须保持 `type="subtitle_storyboard"` / `version=1` / `time_unit="ms"` / `source_file` 不变；工具只更新 `parts` 与 `updated_at`；`media_source` 始终只读；`segments` **主要只读**，唯一例外是 `adjust_part_bounds` 在把 `source_timerange` 撑到所有已有 segments 覆盖之外时会自动向 `segments[]` **追加** placeholder segment（`text=''` / `words` 缺省 / 新 `sourceIndex`），以保证 `parts[]` 的源覆盖始终能在 `segments[]` 找到落点；已有 segments 永不被改写或删除
- **数据模型（双时间线，非线性剪辑）**：`segments[]` 是 ASR 识别到的说话区间，视作**源素材库**、不可变；`parts[]` 是**目标轨道**上的分镜列表，其数组顺序即最终视频播放顺序。每个 part 表达"从原视频截取一段素材放到目标轨道"，落盘时每个 part 除了 legacy 扁平字段 `start / end / ranges` 之外，还会附带两个显式派生字段：
  - `source_timerange = { start, end, ranges? }`：这个 part **从原始视频截取哪一段**（毫秒源时间，等价于原 `start / end / ranges`）。工具的所有时间参数（`split_at.value` 的 `source_time_ms`、`delete_range` 的 `start_ms/end_ms`、`adjust_part_bounds` 的 `delta / absolute` 等）**只用源时间**表达
  - `target_timerange = { start, duration }`：这个 part **在最终视频轨道上占据的位置**（毫秒轨道时间）。它是纯派生字段，由 `parts[]` 数组顺序累加 `partDuration` 得到（含 blank 占位），**任何工具都不接收 target 时间作为输入**
- **target 自动补位是所有工具都遵守的默认行为**（因为 `target_timerange` 是每次落盘时按 `parts[]` 顺序重新累加算出来的，不是持久化的真值）：
  - 举例：ABC 三个 part 的 target 是 `[1-2][2-3][3-4]`，删掉 B 后 A/C 会自动补位成 `[1-2][2-3]`（此时 `[2-3]` 是原来的 C）
  - 举例：延长 B 的 source_timerange 让它多播 500ms，target 上 A 不动，C 自动往后顺延 500ms
  - 举例：`move_part` 把 C 挪到最前，target 自动变成 `C[1-2] A[2-3] B[3-4]`
  - 结论：**改变 `parts[]` 数组的顺序 / 长度 / 每个 part 的 duration 时，工具不需要显式调整任何 part 的 target 时间，也不会产生空隙或重叠**
- 时间单位统一为毫秒；`source_timerange` 是源媒体绝对时间，`target_timerange` 是轨道时间；工具输入永远是源时间
- 每次工具调用完成后应内部执行 `validateParts`；校验失败必须整体回滚，不产生半写入状态。**不做以下校验**（避免误伤合法用例）：
  - 不以 `document.segments` 为源时间硬边界（ASR 只识别到说话区间，源媒体可能更长）
  - 不检查多个 part 之间的源时间重叠（多 part 引用同一段源是合法，如 `duplicate_part`）
- 工具应支持"原子写入"：写临时文件校验成功后 rename 到目标文件

说明：

以下每个工具都注明它对 **source_timerange**（源素材引用）和 **target_timerange**（目标轨道位置）的作用；未特别说明的字段（如 `sourceIndex`、`label`）保持不变或按 `labelParts` 规则重新生成。

- `storyboard_inspect`：**只读**。参数：`storyboard_path`；可选 `part_ids`（只返回指定分镜）；可选 `around_part_id` + `neighbor_radius`（默认 5，以中心 part 为锚只返回前后 N 个邻居，避免拉整份 10+ MB 全量 JSON）；可选 `include_words`（默认 `false`，节省 token）。返回：`meta`（source_file / media_source / updated_at；若用了窗口还带 `window` 字段说明 `around_part_id / neighbor_radius / window_start_index / window_end_index / truncated`）+ `parts[]`（每个 part 同时返回 `source_timerange` 与 `target_timerange`，另外附上 `id / label / blank / text / captions.summary` 以及在原始 `segments` 命中的 sourceIndex 范围）+ 全局统计（总分镜数、空镜数、总时长、最长/最短分镜、可能超长的分镜 id 列表）。**source/target 均不变**（只读）

- `storyboard_update_text`：仅修改指定分镜的显示文本。参数：`storyboard_path`、`part_id`、`text`（或 `captions[]`）。**允许新旧字符数不同**——工具支持 4 种改写场景：(1) 等长替换 `ABC → DEF`；(2) 增长 `ABC → ABCD`；(3) 缩短 `ABC → AB`；(4) 清空 `ABC → 空`（画面照播，字幕整段消失）。工具内部按新文本字符数**均分该 caption 的 duration** 重建 `words[*].start/end` 与 UTF-16 `from/to`（一字一 word）；若 `newText` 为空，则 caption.text 置空、`words = []`，但 caption.start/end 保留（部件源时间、target 时间都不变）。**source_timerange 不变，target_timerange 不变**。若需要同时改变时间，请用 `delete_range` 或 `split_part`

- `storyboard_split_part`：把一个非空分镜按"源时间毫秒"或"字符索引"拆成**两个 part**。参数：`storyboard_path`、`part_id`、`split_at`（`{ type: 'source_time_ms', value: number }` 或 `{ type: 'char_index', value: number }`）、可选 `next_id`（新分镜 id，默认自动生成）。工具内部复用 `splitPart(parts, id, position, nextId)`，一次调用完成：
  - **ranges 分裂**：原 part 的 `ranges` 按切点切成两段，两段源区间首尾相接（左段 end = 右段 start = 切点）。切点如果落在某个 range 中间，该 range 被劈开一个进左、一个进右
  - **captions 分裂**：所有 caption 按切点重新分配。跨越切点的 caption 在两侧各留一半（例：原 caption "ABC" 切点在 A/B 之间 → 左 caption "A"、右 caption "BC"）；`caption.start/end` 被 clip 到新 part 的边界内；文字按字符索引精确切分
  - **words 分裂**（如果原 part 有逐字时间戳）：word 也按切点重分。切点若落在某个 word 内部，该 word 会同时出现在左右两段的 caption 里（左段的 word.end / 右段的 word.start = 切点），保证不丢字；`from/to` UTF-16 偏移在两侧各自重排
  - **text 分裂**：`part.text` 按字符索引精确切成两段，分别写到两个新 part 上
  
  举例（Case）：原 part = ABC → 切 A → 得到 A1 A2 B C 顺序两个 part —— **A1**（含 A 的前一半文本 + A 的前半段 word/caption 时间 + 前半段 ranges），**A2**（含 A 的后一半文本 + A 的后半段 word/caption 时间 + 后半段 ranges，随后串接原 B C 的 caption 与文本）。切点必须严格落在 part 内部（`0 < split < duration`），否则报错。
  
  **source_timerange**：原 part 的 `[source_start, source_end]` 被切点切成 `[source_start, split_source_time]` 与 `[split_source_time, source_end]`；总源覆盖不变。**target_timerange**：原 part 占据的 target 区间被两个新 part 精确瓜分（左段 duration = 切点前的源覆盖累计，右段 duration = 剩余），后续 part 全部不变

- `storyboard_merge_parts`：把 2 个及以上**在 `parts[]` 数组里连续、按源时间递增、非空**的分镜合并成 1 个 part。参数：`storyboard_path`、`part_ids[]`（必须是 parts 数组里的连续片段；如果不满足相邻/顺序/非空要求会报错）。工具内部复用 `canMergeParts` / `mergeParts`：
  - **结果 part 的 id**：**沿用组里第一个 part 的 id**（不是新分配的 id）；其它被合并的 part 从 `parts[]` 里移除
  - **captions**：合并组每个 part 的 `captions[]` 按顺序平铺拼接（不会主动去重、不会重排、不会重写文本），`part.text = merged.captions.map(c => c.text).join('\n')`
  - **source_timerange**：`start = min(源 start)`、`end = max(源 end)`。若被合并 part 之间源时间完全首尾相接（前 part.end === 后 part.start）则只保留一条 `[start, end]`；若源时间上有空档（前 part.end < 后 part.start）则写入 `ranges: [...]`，每段就是原 part 的源区间，模型不需要理解 `ranges` 结构
  - **合并同时不改写文字**：如果需要"合并后把文案压成一句更简洁的话"，请先合并再调 `update_part_text`
  
  举例（Case）：原 ABC 三个 part，`part_ids=[A.id, B.id]` → 合并后得到 D（占据原 A 的位置）+ C。**D.id = A.id**；**D.source_timerange** = `[A.start, B.end]`（源相接时）或 `[A.start, B.end] + ranges=[A_range, B_range]`（源有空档时）；**D.captions** = `A.captions + B.captions`；**D.text** = 前者文本用换行拼接；**C** 完全不变
  
  **source_timerange**：合并后 D 引用的源覆盖 = A ∪ B 的源覆盖（相邻则合成一段，否则用 ranges 记录多段）；其它 part（例中 C）不变。**target_timerange**：D 占据原 A、B 加起来的 target 区间（duration = A.duration + B.duration）；C 的 target 完全不变（因为它前面的 A + B 总长度没变，只是合并成了一个）

- `storyboard_delete_parts`：从 `parts[]` 中彻底移除若干分镜（非软删）。参数：`storyboard_path`、`part_ids[]`。**source_timerange**：所有**保留下来**的 part 的 `source_timerange` 完全不变（源截取范围不动）。**target_timerange**：被删 part 后面的所有 part **在 target 上自动前移**填补空缺（因为 target 是按 `parts[]` 顺序累加 duration 每次落盘重算的派生量），target 上不留空隙；**整份分镜的总时长会变短**（缩短量 = 被删 part 的 duration 之和）。同时重新执行 `labelParts`
  
  举例（Case）：原 ABC 三个 part，target 为 `[0-1000][1000-2000][2000-3000]`：
  - **删 A**：剩 BC；B 的 source 不变，target 自动前移到 `[0-1000]`；C 前移到 `[1000-2000]`；总时长 3000 → 2000
  - **删 B**：剩 AC；A 完全不变；C 的 source 不变，target 自动前移到 `[1000-2000]`（顶到原 B 的开始位置）；总时长 3000 → 2000
  - **删 C（末尾）**：剩 AB；A、B 都完全不变；不存在需要"补位"的后续 part；总时长 3000 → 2000

- `storyboard_delete_range`：删除**目标轨道（target 时间线）**上一段区间，**可以横跨多个 part**。用于"去掉嗯/啊等气口"、"缩短过长停顿"、"一刀切掉视频里第 5-8 秒这段"。参数：`storyboard_path`、`range = { start_target_ms, end_target_ms }`（目标时间线毫秒，必须 `0 <= start < end`；`end` 超过总时长会被 clamp）。工具内部把 target 区间映射到每个相交 part 的 source 时间上做裁剪。
  
  **同一 part 的裁剪结果**：
  - **两侧都留下（中间挖洞）**：该 part 被**拆成 2 个独立 part**（左 part 保留原 id，右 part 分配一个新 id `<原 id>-cut-N`），左右各自有独立的 `source_timerange` 和 `captions`，target 上首尾相接
  - **只有左侧留下**：只保留左半段（`source_timerange.end` 收到裁剪点）
  - **只有右侧留下**：只保留右半段（`source_timerange.start` 推到裁剪点后）
  - **整段被吃掉**：该 part 从 `parts[]` 中移除
  
  **跨 part**：一次调用可以横跨多个 part。裁剪区间开头/结尾所落 part 按上面 4 种情况各自处理；中间被完全覆盖的 part 直接删除。captions/words 沿新边界用 `clipCaption` 精确裁剪。
  
  **source_timerange**：其他未被裁剪 part 的源不变；被裁 part 的源按上述规则更新；**不再产生"一个 part 多段 ranges"的合并镜**（中间挖洞会拆成 2 个 part）。**target_timerange**：**所有后续 part 在 target 上自动前移补位**（因为 target 是派生量），整份分镜总时长减少 = 被删的 target 区间长度。
  
  举例（单 part，target `[0-3]`）：
  - **中间挖 [1-2]** → 拆成 2 个独立 part：source 分别是原 part 的 `[0-1]` 和 `[2-3]`，target 分别是 `[0-1]` 和 `[1-2]`（首尾相接），字幕各自分开；后续 part 全部前移 1 秒
  - **前端挖 [0-1]** → 只剩 1 个 part：source 是原 part 的 `[1-3]`，target 顶到 `[0-2]`；后续 part 前移 1 秒
  - **末端挖 [2-3]** → 只剩 1 个 part：source 是原 part 的 `[0-2]`，target 是 `[0-2]`，本 part 无需前移；后续 part 前移 1 秒
  
  举例（跨 part）：
  - **原分镜 ABC，删除区间横跨 A 尾和 B 首** → 形成 `A1 B1 C`（A1 是 A 去尾、B1 是 B 去头，C 的 source 完全不动；C 在 target 上前移补位）
  - **原分镜 ABC，删除区间横跨 A 尾 + 完整 B + C 首** → 形成 `A1 C1`（A1 是 A 去尾、B 整体消失、C1 是 C 去头；A1 后面直接接 C1）

- `storyboard_duplicate_part`：复制一个已存在的非空分镜（含 `source_timerange` / `captions` / `words` / `text`），在 `parts[]` 数组任意位置再插入一份。参数：`storyboard_path`、`part_id`（源分镜 id）、`insert_at`（`{ type: 'index', value: number }` / `{ type: 'before', part_id }` / `{ type: 'after', part_id }` / `{ type: 'start' }` / `{ type: 'end' }`）、可选 `new_id`（默认自动生成 `<原 id>-copy-N`）、可选 `text`（复制后立即改写显示文案，行为同 `update_text`）。
  
  **source_timerange**：新 part 的 `source_timerange`（`start / end / ranges` / `sourceIndex`）**与原 part 完全一致**——多个 part 引用同一段源素材是合法的，也不检查源时间重叠。原 part 完全不动。**target_timerange**：新 part 按 `insert_at` 插入到 `parts[]` 相应下标；由于 target 是按 `parts[]` 顺序累加 duration 派生的，**插入点之后的所有 part（含原 part 如果它在插入点之后）target 自动后移一个 `new_part.duration` 的量**，插入点之前的 part 完全不变；整份分镜总时长增加 = 新 part 的 duration。
  
  举例（ABC，每个 part duration=1000）：
  - `dup(B, insert_at=start)` → `B' A B C`：B'.target=`[0-1000]`；A/B/C 全部后移 → target 分别 `[1000-2000][2000-3000][3000-4000]`
  - `dup(B, insert_at=end)` → `A B C B'`：A/B/C 不动；B'.target=`[3000-4000]`
  - `dup(B, insert_at={index:2})` → `A B B' C`：A/B 不动；B'.target=`[2000-3000]`；C 后移到 `[3000-4000]`
  - `dup(B, insert_at={before, part_id:'A'})` → `B' A B C`
  - `dup(B, insert_at={after, part_id:'C'})` → `A B C B'`

- `storyboard_move_part`：把一个已存在的分镜在 `parts[]` 内换个位置（纯粹调整播放顺序，例如把结尾高光句拉到最前面做钩子）。参数：`storyboard_path`、`part_id`、`insert_at`（结构同 `duplicate_part.insert_at`；`insert_at` 的目标下标基于**移除源 part 之后**的数组计算，即"最终位置就是给的这个下标"）。
  
  **source_timerange**：**该 part 及所有其它 part 的 `source_timerange` 完全不变**（不改源截取范围，只改 `parts[]` 顺序）。**target_timerange**：只有 `parts[]` 顺序变了 → 从"原位置和新位置之间的所有 part"的 target 自动重排（前移或后移各自的 duration 差值），源 part 之外的 part 若不落在原位置与新位置之间的区段则 target 也不变；无需模型显式给出新 target 时间；分镜总时长保持不变。
  
  举例（ABC，每个 part duration=1000）：
  - `move(C, insert_at=start)` → `C A B`：C.target 从 `[2000-3000]` → `[0-1000]`；A/B 各自后移 1000 → `[1000-2000][2000-3000]`
  - `move(A, insert_at=end)` → `B C A`：B/C 各自前移 1000 → `[0-1000][1000-2000]`；A.target → `[2000-3000]`
  - `move(A, insert_at={after, part_id:'C'})` → `B C A`：同上
  - 边界：不允许把 part 移到它当前位置（`Move had no effect`）；不允许 `insert_at` 锚定 part 自身

- `storyboard_clear_part_text`：只保留画面/时间，不显示字幕。参数：`storyboard_path`、`part_id`。工具内部把 `part.text` 置空、`part.captions = []`，但 `part.blank` 仍为 `false`。**source_timerange 不变**（`start / end / ranges / sourceIndex` 全保留）—— 这段画面继续在轨道上播放。**target_timerange 不变**。与 `insert_blank_part`（无画面占位）的区别：`clear_part_text` 保留原始画面，仅剥离字幕；`insert_blank_part` 是新建一段没有画面的黑场空镜

- `storyboard_insert_blank_part`：在轨道上插入一段没有画面的空分镜（`blank=true`，无任何 ranges / captions / words）。参数：`storyboard_path`、`duration_ms`（**该空镜在 target 轨道上占据的时长**，必须为正整数毫秒）、`insert_at`（结构同 `duplicate_part.insert_at`，决定插入到 `parts[]` 的哪个位置）、可选 `new_id`。工具内部：新 part 的 `blank=true`、`text=''`、`captions=[]`、`sourceIndex` 沿用相邻 part（若无相邻取 0）。**source_timerange**：blank part 不引用任何源素材，落盘时以占位形式写入 `start=0 / end=duration_ms`（仅为满足 `end>start>=0` 结构约束，语义上无意义，不参与源边界校验）；其它 part 的 source 完全不变。**target_timerange**：新 part 按 `duration_ms` 占据 target 一段区间，插入点之后所有 part 的 target 自动后移 `duration_ms`

- `storyboard_adjust_part_bounds`：微调分镜的**源时间**边界，用于修正字幕切割过突或把气口切了一半的情况，也用于"放大 / 缩小"某个 part 的源覆盖。参数：`storyboard_path`、`part_id`、以及**二选一**：
  - `delta`：`{ start_delta_ms?: number, end_delta_ms?: number }` —— 相对偏移，正值向后、负值向前。典型用法："前后各延长 200ms" -> `{ start_delta_ms: -200, end_delta_ms: 200 }`；"结尾收进来 100ms" -> `{ end_delta_ms: -100 }`
  - `absolute`：`{ start_ms?: number, end_ms?: number }` —— 绝对源时间（毫秒）
  
  工具内部约束：调整后必须满足 `new_end > new_start >= 0`；**故意不用 `document.segments` 卡边界**（ASR 只识别到说话区间，源媒体真实时长可能更长，例如 ASR 只识别到 10s-13s 但用户想延到 9.5s-13.5s 吃回呼吸/字头字尾时必须允许）；**也故意不检查与其他 part 的源时间重叠**（多个 part 引用同一段源时间是合法，见 `duplicate_part`）。工具会自动把该 part 的 `ranges` 首尾裁剪到新边界（若 part 无自定义 `ranges` 则直接更新 `start/end`）、把落在新边界外的 `captions` / `words` 裁掉（复用 `clipCaption`）。若调整会把该 part 完全消耗则报错，要求改用 `delete_parts`。
  
  **自动补 segments 语义**（唯一会写 `document.segments` 的工具）：如果新的 `source_timerange` 落在**所有现有 segments 联合覆盖之外**（比如把 B 放到比 ASR 更大，或吃回 ASR 前后的呼吸），工具会自动向 `document.segments` **追加**一条或多条 placeholder segment 精确覆盖那些 gap（`text=''`、无 `words`、分配一个新的 `sourceIndex`）；已有 segments **不会被修改或删除**。这保证了"parts 源覆盖必须能在 segments 找到落点"这一不变式，同时不需要模型显式操作 segments。
  
  举例（ABC，每个 part duration=1000，source 相接）：
  - **缩小 B**：B1 拿到收紧后的 source/target，B1 target 相对原 B 前移或保持，C 及其后所有 part 的 target 自动前移（缩短量 = B 缩小的 duration）；总时长变短；source 完全不撑出 segments 时不追加 placeholder
  - **放大 B**：若新 source 仍在 segments 覆盖内则不动 segments；若新 source **越过 ASR segments**，工具按"源能放的最大范围"允许延伸并对超出部分自动向 `document.segments` 追加 placeholder segment；C 及其后所有 part target 自动后移（伸长量 = B 放大的 duration）
  - **首/末 part A/C 调整**：与中间 part 语义一致；若把首 part start 往负方向拉需保证 `new_start >= 0`；若把尾 part end 往后拉越出 segments 同样触发 placeholder 补写
  - **允许放大 B 后与 A/C 的源时间区间重叠**：多个 part 引用同一段源素材是合法（`duplicate_part` 就是这样工作）；工具**不检查跨 part 的源时间重叠**；但由于 target 是按 `parts[]` 顺序派生的，任何操作后 target 依然首尾相接、绝不重叠
  
  **source_timerange**：只改被调整的 part（其它 part 完全不动）。**target_timerange**：该 part 的 `duration` 变化多少，target 就伸缩多少；后续所有 part 在 target 上自动补位（前移或后移），模型无需管后续 part。**segments**：仅当新 source 越出已有覆盖时追加 placeholder，其它 part 的 source 不变，所以不会引发额外的 segments 变更

- `storyboard_apply_operations`：**批处理入口**。把 `update_part_text` / `split_part` / `merge_parts` / `delete_parts` / `delete_range` / `adjust_part_bounds` **在一次调用里按顺序原子执行**——一次响应完成"删嗯字 + 拆长句 + 收气口 + 删废镜"这种成组编辑，避免"做一步 inspect 一次"的高延迟串行链路。参数：`storyboard_path`、`operations[]`（≥1 项，按数组顺序依次应用）。每个 op 形如 `{ type, ... }`，`type` 取值与对应参数：
  - `type='update_part_text'`：`part_id`、`text` 或 `captions[]`
  - `type='split_part'`：`part_id`、`split_at`、可选 `next_id`
  - `type='merge_parts'`：`part_ids[]`（≥2，当前状态里相邻）
  - `type='delete_parts'`：`part_ids[]`（≥1）
  - `type='delete_range'`：`range = { start_target_ms, end_target_ms }`（作用于**当前批处理状态**的 target 时间线，不是原始状态）
  - `type='adjust_part_bounds'`：`part_id` + `delta` 或 `absolute`
  
  语义要点：
  
  1. **顺序执行 + 每步基于上一步的结果**：内部状态就是 `parts[]` / `segments[]`；op[i] 看到的是 op[i-1] 应用完的 parts 状态。所以 `split_part` 产生的 `next_id` 可以在后续 op 里立即引用；`delete_parts` 里的 `part_id` 必须在当前状态里还存在；`delete_range` 的 target 时间是"这一步开始时"的 target（不是最初 target）。
  2. **全或全无原子性**：**任何一步**（参数错误、id 不存在、`validateParts` 校验失败、边界越界等）失败都整体回滚——文件保持调用前状态，不会出现"改了前 3 个 op、第 4 个报错、写出半成品"。写盘只发生一次（成功走完所有 op 之后）。
  3. **不允许在 batch 里嵌套 batch**：`type='apply_operations'` 会被拒绝。
  4. **顺序建议**：为了让 id 稳定，AI 应尽量**从后往前**操作（先动尾部 part 再动头部），或**先 delete 再 split**，避免同一个 batch 里出现"先动的 op 让后一步引用的 part 消失"。这不是硬约束，但是**违反了就会在那一步 op 报错并整批回滚**。
  5. **segments 追加语义沿用 `adjust_part_bounds`**：如果 batch 里包含 adjust_part_bounds 且新 source 越出 segments 覆盖，同样追加 placeholder segment；其它 op 不写 segments。
  
  **source / target 语义**：由每个 op 各自的语义组合决定；batch 结束时 `target_timerange` 按最终 parts[] 顺序重新累加。
  
  举例：
  - `[{type:'delete_parts', part_ids:['p3']}, {type:'delete_range', range:{start_target_ms:1500,end_target_ms:2000}}, {type:'update_part_text', part_id:'p1', text:'新文案'}]` —— 先删 p3、再在新 target 时间线上删 [1500,2000)、最后改 p1 文本；一次落盘
  - `[{type:'split_part', part_id:'p1', split_at:{type:'char_index', value:5}, next_id:'p1-2'}, {type:'update_part_text', part_id:'p1-2', text:'后半改写'}]` —— 拆分后立即引用新产生的 `next_id` 改文本
  - 任一步失败（例如第二个 op 引用了不存在的 part_id）→ 整批回滚，文件不变

不进入分镜域工具的能力（继续沿用其它域）：

- 读取源 `sre_*.json`：属于 `workspace.read`，`storyboard_inspect` 只暴露分镜文件本身
- 播放 / 预览媒体：不属于 AI 辅助工具面
- 生成新的字幕识别：属于 `cut.subtitle_recognition`

路由信号：

- 用户在 `PartSplitToolDetail` 的 AI 辅助入口发起请求时，宿主应显式带上 `storyboard` 域信号，让路由直接命中 `story` 主域，无需依赖关键词识别
- 当模型正在 `story` 域中工作时，`workspace.write` 不应默认伴随挂载，避免模型退回“直接 Write 整份 JSON”的老路径；`workspace.read` 可以作为伴随域，用于按需读取 `sre_*.json` 原始识别文本
- 若用户请求同时涉及“先识别字幕再分镜”，`story` 与 `cut.subtitle_recognition` 可作为组合命中，先字幕识别再进入分镜编辑

后续实现步骤：

1. 在 `src/main/mcpServers/storyboard-editor.ts` 落地上述 6 个工具，内部复用 `src/components/PartSplitToolDetail/model.js` 的纯函数（必要时抽到 `shared` 目录避免主进程依赖 React 侧代码）
2. 在 `capability-router.ts` / `tool-surface.ts` 注册 `story` 域及其工具映射
3. 改造 [aiAssist.js](file:///Users/sunguannan/CapCutHelper/src/components/PartSplitToolDetail/aiAssist.js) 中的提示词，把冗长的结构约束替换为“工具选择指南”，明确指令模型必须使用 `mcp__vectcut__storyboard-editor__*` 系列工具完成修改，禁止直接 `Write` 整份分镜文件

## 多域组合原则

一个任务不强制只能落在一个域。

典型组合：

- `workspace.read + web.search`
- `workspace.write + web.browser`
- `materials.folder_links + workspace.write`
- `workspace.read + ai_media.image`
- `skills.invoke_skill + workspace.read`

建议规则：

1. 必须有一个 `primaryDomain`
2. `companionDomains` 最多挂 2 个，避免工具面再次膨胀
3. 先挂主域工具，再补伴随域工具

## 工具挂载策略

### 默认原则

- 命中某个域时，直接挂载该域下全部已接入子功能
- 多域命中时，并行挂载所有命中域的完整工具包
- 域只负责对工具做分组打包，不负责对子功能做二次裁剪
- 本地 `skills` 仍按域整体挂载，与其他域遵循同一规则

### 例子

#### `workspace.read`

默认挂：

- `Read`
- `Bash`

#### `workspace.write`

在 `workspace.read` 基础上追加：

- `Write`
- `Edit`
- `MultiEdit`

#### `chat.bash`

默认挂：

- `Bash`
- 测试/构建相关 runtime 工具

#### `chat`

默认挂：

- `mcp__vectcut__image-understand__inspect_image`

#### `materials.folder_links`

默认挂：

- `mcp__vectcut__materials__folder_links`
- `Write` / `Edit` / `MultiEdit`（用于将链接结果落盘到 workspace，并仅返回文件路径）

#### `web.search`

默认挂：

- `WebSearch`

#### `web.browser`

追加：

- `browser` MCP 相关工具

#### `ai_media.image`

只挂图片生成相关 MCP / runtime 工具

#### `skills.invoke_skill`

命中 `skills` 域后，直接挂载全部工具与当前 workspace 下全部本地技能；如果本轮是执行本地 skill，则必须进一步进入 `invoke_skill` 执行链路，而不能停留在技能发现或技能管理阶段

## 路由流程

建议分三步：

### 第一步：主域判断

先只判断任务主要属于哪一类：

- `chat`
- `workspace`
- `materials`
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
- `materials.folder_links`
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
- `skills.list_skill`

## 示例

### 通用用户示例

| 用户输入 | 预期主域 | 预期子能力 | 备注 |
| --- | --- | --- | --- |
| `你好` | `chat` | `[]` | 基础对话 |
| `帮我看看这张图里写了什么` | `chat` | `["image_understand"]` | 识图属于聊天理解能力，默认挂 chat 域的固定 MCP |
| `看下今天热点` | `web` | `["search"]` | 网络搜索 |
| `反推 xx 链接的提示词` | `scrapt` | `["derive_prompt"]` | 爬虫反推提示词 |
| `将一段文案合成语音` | `ai_media` | `["speech"]` | 默认按传统 TTS 理解 |
| `把这段文字念出来` | `ai_media` | `["speech"]` | 未强调豆包时默认走 TTS |
| `把这段音频链接变成另一个音色，语速和情绪保持不变` | `ai_media` | `["voice_conversion"]` | 已有音频链接做变声，不是文本转语音 |
| `豆包生成语音：一段带背景音乐和音效的音频` | `ai_media` | `["seed_audio"]` | 只有完整命中精确短语 `豆包生成语音` 或 `豆包语言生成` 才走 seed_audio |
| `豆包语言生成：一段多人对话音频` | `ai_media` | `["seed_audio"]` | 精确短语白名单中的另一种说法，同样走 seed_audio |
| `用豆包语音生成一段多人对话音频` | `ai_media` | `["speech"]` | 近似说法，不是精确短语，仍按 TTS 处理 |
| `生成数字人` | `ai_media` | `["digital_human"]` | AI 媒体 |
| `写文案` | `chat` | `[]` | 基础对话 |
| `看看有没有文件` | `workspace` | `["find", "read"]` | 工作空间 |
| `写文件` | `workspace` | `["write"]` | 工作空间 |
| `写网页` | `workspace` | `["write"]` | 默认按生成/修改项目文件理解 |
| `查一下有没有 xxx 文字` | `workspace` | `["find", "read"]` | 工作空间文本检索 |
| `把这个链接下载到本地` | `workspace` | `["download", "read"]` | 通用文件下载到 workspace |
| `把这个文件上传到 oss` | `workspace` | `["upload", "read"]` | 本地文件上传 |
| `帮我看一下素材库这个文件夹 id 下面有哪些文件` | `materials` | `["folder_links"]` | 获取素材库文件夹下的文件链接；完整结果写入 workspace，只返回文件路径 |
| `把这个网页上的音频链接下载下来` | `web` | `["download"]` | 联网场景下直接下载远程资源，不打开浏览器页面 |
| `打开网页` | `web` | `["browser"]` | 网络搜索 / 浏览器交互 |
| `生成图片` | `ai_media` | `["image"]` | AI 媒体 |
| `创建一个草稿` | `cut` | `["draft_create", "draft_update_meta"]` | 草稿创建，默认进入草稿创建 + 元信息设置链路 |
| `创建一个剪映草稿` | `cut` | `["draft_create", "draft_update_meta"]` | 与“创建一个草稿”同义，默认进入草稿创建 + 元信息设置链路 |
| `分离视频里的音频` | `cut` | `["audio_extract"]` | 本地 `ffmpeg` 媒体处理 |
| `提取 xxx 文件的音频` | `cut` | `["audio_extract"]` | 文件导向表述，仍属于音频提取 |
| `把这两个音频拼接在一起` | `cut` | `["audio_concat"]` | 本地 `ffmpeg` 音频拼接 |
| `把这个音频链接下载到本地再处理` | `cut` | `["media_download"]` | 先下载媒体，再进入本地处理链路 |
| `截取 12.5 秒的帧图片` | `cut` | `["frame_capture"]` | 本地 `ffmpeg` 单帧截图 |
| `获取这个视频的时长` | `cut` | `["media_duration"]` | 本地 `ffprobe` 时长探测 |
| `截取 10 秒到 25 秒的视频片段` | `cut` | `["media_trim"]` | 本地 `ffmpeg` 时间范围裁剪 |
| `把这两个视频拼接在一起` | `cut` | `["video_concat"]` | 本地 `ffmpeg` 视频拼接 |
| `识别这个视频链接里的字幕` | `cut` | `["subtitle_recognition"]` | 远端异步字幕识别，远程链接可直接传入 |
| `把这个本地音频文件识别成字幕` | `cut` | `["subtitle_recognition"]` | 本地音频可直接传入，由工具内部上传并识别 |
| `把这段视频的字幕提取出来，但不要上屏` | `cut` | `["subtitle_recognition"]` | 只提取字幕内容，不写回草稿 |
| `先识别这段音频字幕，再按字幕模版加回草稿` | `cut` | `["subtitle_template"]` | 目标是样式化字幕并回写草稿 |
| `把这个 preset_id 加到草稿里，并替换里面的文字和图片` | `cut` | `["add_preset"]` | 单个预设片段插入，允许 replacements 覆盖素材 |
| `批量添加 3 个预设片段，按顺序排到时间线上` | `cut` | `["add_batch_preset"]` | 多个预设批量插入，可按目标时间范围控制落点 |
| `把这个草稿的封面和名称改一下` | `cut` | `["draft_update_meta"]` | 草稿元信息修改 |
| `请修改当前草稿。草稿ID：dfd_cat_xxx 草稿名：全量效果测试` | `cut` | `["draft_update_meta"]` | 结构化的当前草稿元信息修改请求 |
| `下载草稿` | `cut` | `["draft_download"]` | 剪辑任务 |
| `导出草稿` | `cut` | `["draft_export"]` | 剪辑任务 |
| `给这段视频添加字幕模板` | `cut` | `["subtitle_template"]` | 识别后按字幕样式模版上屏并写回草稿 |
| `执行这个剪辑工作流，把多个 add_text 和 add_video 一次写进草稿` | `cut` | `["workflow"]` | 长耗时远端工作流执行 |
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

`帮我把素材库 folder_id=123456 下面的文件链接导出来`

路由结果：

```json
{
  "primaryDomain": "materials",
  "subdomains": ["folder_links"],
  "companionDomains": ["workspace"],
  "confidence": 0.95
}
```

### 示例 4

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

### 示例 5

用户输入：

`有没有现成技能能做这个流程，没有就帮我创建一个`

路由结果：

```json
{
  "primaryDomain": "skills",
  "subdomains": ["search_skill", "create_skill"],
  "companionDomains": [],
  "confidence": 0.95
}
```

### 示例 6

用户输入：

`@儿童绘本 制作一个司马光砸缸的 3 页绘本`

路由结果：

```json
{
  "primaryDomain": "skills",
  "subdomains": ["invoke_skill"],
  "companionDomains": [],
  "confidence": 0.99
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
- 命中 `skills` 域时，会挂载全部工具与当前 workspace 下全部本地技能
- 显式 `@技能名` 请求能够稳定命中 `skills.invoke_skill`，而不是退化成普通聊天或技能搜索
- `search_skill` / `list_skill` / `create_skill` / `register_skill` 不再被误当作本地 skill 执行能力
