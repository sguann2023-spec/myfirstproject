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

- `bash`

已接入工具：

- `bash` -> `Bash`

说明：

- `bash`：用于通用命令执行、终端探测、脚本运行、临时 shell 操作；它是底层通用执行能力，不等同于 `workspace` 域的工程读写能力；若任务核心是“跑一条命令”“执行脚本”“用 bash / terminal 处理文件”，应优先视为 `chat.bash`，再按需要伴随命中 `workspace`
- 除 `chat` 外，`workspace` / `web` / `ai_media` / `skills` / `auxiliary` / `scrapt` / `cut` 这些已命中的主域，默认也允许伴随暴露 `Bash`，用于模型在主工具链不足时执行必要的目录探测、脚本编排或命令兜底；但它仍属于通用底层能力，不改变各主域的优先工具选择

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
- `download` -> `mcp__filesystem-server__download`
- `upload` -> `mcp__file-upload__upload_file_to_oss`

说明：

- `Read` / `Bash`：当返回内容特别长（如大文件、长日志、长命令输出）时，允许工具内部先做一层“结果整理/摘要预览”，优先返回结构化的关键信息、统计信息、命中片段、头尾片段、错误摘要或下一步可继续读取的定位信息，而不是把整段原文直接塞进模型上下文
- `Read` / `Bash`：工具内摘要只负责改善可读性与上下文利用率，不替代原始结果持久化；系统侧仍应保留完整 `rawOutput`，模型消费侧仅使用工具提供的 `inline/summary` 结果，并保留统一的 `16KB` 硬截断兜底
- `download`：当用户需要把远程文件、图片、音频、视频链接下载到当前 workspace 时使用；应优先保存到当前工作空间内的目标目录，而不是系统 Downloads；适用于通用文件落地，不负责媒体裁剪、抽帧、拼接等后处理
- `upload`：当用户需要上传本地文件并拿到可复用 URL 时使用；统一走 `POST https://open.vectcut.com/sts/upload/agent_tmp/init`：先传 `file_name` 获取 `upload.upload_url`、`upload.form_data`、`download.signed_url` 与 `object_key`，再把本地文件按返回表单直传到 OSS，并返回 `download.signed_url` 作为后续提交给远端能力的可访问 URL；文件大小限制不超过 `500MB`，上传前先校验并在超限时报错；凡是本文提到的 MCP 工具需要上传本地文件时，无论是显式命中 `workspace.upload`，还是工具内部自动上传本地素材，都应复用这条 `/sts/upload/agent_tmp/init` 链路

### 3. `web`

适用于联网信息获取和页面交互。

建议子能力：

- `search`
- `browser`
- `execute`
- `download`
- `screenshot`

已接入工具：

- `search` -> `WebSearch` / `mcp__search__web_search`
- `browser` -> `mcp__browser__open` / `mcp__browser__click` / `mcp__browser__type` / `mcp__browser__press` / `mcp__browser__scroll` / `mcp__browser__focus` / `mcp__browser__hover` / `mcp__browser__wait_for` / `mcp__browser__inspect` / `mcp__browser__reload` / `mcp__browser__list_tabs` / `mcp__browser__switch_tab` / `mcp__browser__close_tab` / `mcp__browser__reset`
- `execute` -> `mcp__browser__execute`
- `download` -> `mcp__filesystem-server__download`
- `screenshot` -> `mcp__browser__screenshot` / `mcp__browser__snapshot`

说明：

- `download`：当任务核心是把远程链接内容保存到当前 workspace，而不是打开页面交互时使用；适用于下载网页上的文件直链、音频链接、视频链接、图片链接或其他可直接落地的远程资源；和 `browser` 的区别是：`download` 负责把文件保存到本地，`browser` 负责打开页面并交互

备注：当前不开放独立的网页抓取工具；已知 URL 如果目标是页面浏览、交互或截图，优先通过 `browser` / `execute` 处理；如果目标是把资源落地到本地，则应优先考虑 `download`。


### 4. `ai_media`

适用于 AI 媒体生成相关任务。

建议子能力：
- `image`
- `video`
- `speech`
- `voice_conversion`
- `seed_audio`
- `digital_human`

已接入工具：

- `image` -> `mcp__image__generate_or_edit_image` / `mcp__image__generate_image` / `mcp__image__get_image_capabilities`；当引用本地参考图、截图、剪贴板图片等素材时，允许先通过 `workspace.upload`（`mcp__file-upload__upload_file_to_oss`）上传；其中截图/剪贴板图片可直接走附件图的 `base64` / `dataUrl` 上传，不强依赖本地文件路径
- `video` -> `mcp__video__generate_video` / `mcp__video__get_video_capabilities`；用于 AI 视频生成聚合能力，覆盖文生视频、图生视频、首帧扩展、首尾帧视频，以及 Seedance 2.0 系列的多模态参考视频生成；当引用截图、首帧参考图、剪贴板图片等无稳定 `filePath` 的图片素材时，同样应优先走 `workspace.upload` 的 `base64` / 附件上传语义，再将返回 URL 交给视频生成能力
- `speech` -> `mcp__speech__generate_speech`
- `voice_conversion` -> `mcp__voice-conversion__submit_voice_conversion_task` / `mcp__voice-conversion__get_voice_conversion_task_status`
- `seed_audio` -> `mcp__seed-audio__generate_seed_audio`
- `digital_human` -> `mcp__digital-human__create_lip_sync_digital_human` / `mcp__digital-human__get_lip_sync_digital_human_status` / `mcp__digital-human__create_image_driven_digital_human` / `mcp__digital-human__get_image_driven_digital_human_status` / `mcp__digital-human__create_omni_image_driven_digital_human` / `mcp__digital-human__get_omni_image_driven_digital_human_status` / `mcp__digital-human__create_seedance_digital_human` / `mcp__digital-human__get_seedance_digital_human_status`

说明：

- 本地参考图片 / 视频 / 音频的上传能力统一视为独立前置步骤，默认先命中 `workspace.upload`（`mcp__file-upload__upload_file_to_oss`），通过 `/sts/upload/agent_tmp/init` 拿到可访问 URL 后，再继续调用 `image` / `video` / 其他依赖远端可访问素材的能力；工具内部自动上传仅作为兼容兜底，不再视为这些能力自身的一部分
- `image`：图片生成/编辑默认可直接使用文本提示词，若还带参考图片，则应优先判断输入是远程图片链接还是本地文件；工具自身应消费已完成前置上传后的可访问 URL，禁止把本地路径直接传给远端图片生成/编辑接口
- `video`：AI 视频生成默认命中该子能力，适用于“生成视频”“文生视频”“图生视频”“首帧扩展”“首尾帧视频”“视频生成”等表述；调用上应优先使用 `mcp__video__generate_video`，提交后默认把它视为异步长任务，并持续用 `action="status"` 轮询到 `succeeded` / `failed` / `not_found` 等终态；当用户要查询可用模型、分辨率、时长、是否支持音频、首尾帧、多图参考、超分等能力时，应命中 `mcp__video__get_video_capabilities`；对于 Seedance 2.0 系列的多模态参考生成，优先使用 `content` 数组表达 `text` / `reference_image` / `reference_video` / `reference_audio` 输入
；如果用户给的是“参考视频”，应优先原样保留为 `video_url` + `role=reference_video`，不要默认把视频拆成抽帧图片 + 分离音频，除非用户明确要求“抽帧”“拆音轨”“提取参考图/参考音频”
- `speech`：传统 TTS，按“文字 + 音色”合成语音；凡是“语音合成”“生成语音”“配音”“朗读”“念出来”等表述，都默认命中 `speech`；即使出现“豆包”“多人”“背景音乐”“音效”等词，只要没有完整出现精确短语 `豆包生成语音` 或 `豆包语言生成`，也一律不要命中 `seed_audio`
- `voice_conversion`：AI 变声 / 声音转换，输入应是公网可访问的原始音频链接或视频链接，再指定目标 `voice_id`，将现有声音转换成另一种音色；默认理解为尽量保持原始语速、停顿和情绪不变，而不是重新按文本做 TTS；当用户表达“变声”“换音色”“把这段音频换成另一个声音”“保持语速不变”“保持情绪不变”等诉求时，应优先命中 `voice_conversion`；接口形态上应视为异步任务，先提交原始 `audio_url` / `video_url` 与目标 `voice_id` 获取 `task_id`，再轮询任务状态直至拿到 `result.converted_url`；若用户给的是本地文件，应先通过独立前置的 `workspace.upload` 获取可访问 URL，再进入该子能力
- `seed_audio`：仅在用户输入中完整出现精确短语 `豆包生成语音` 或 `豆包语言生成` 时才命中；少一个字、错一个字、换序表达（如“用豆包语音生成”）都不能命中 `seed_audio`

### 5. `skills`

适用于技能搜索、查看、修改、执行、删除，以及安装、创建、注册等技能相关任务。

建议子能力：

- `search_skill`
- `list_skill`
- `create_skill`
- `register_skill`
- `invoke_skill`

已接入工具：

- `search_skill` -> `mcp__skills__skills`
- `list_skill` -> `mcp__skills__skills`
- `create_skill` -> `mcp__skills__skills`
- `register_skill` -> `mcp__skills__skills`
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

### 6. `auxiliary`

适用于辅助型 Agent 能力，不直接归属技能发现或媒体生成。

建议子能力：

- `memory`
- `assistant`
- `automation`
- `system`

已接入工具：

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
- `subtitle_template`
- `template`

已接入工具：

- `audio_extract` -> `mcp__ffmpeg-media__extract_audio_from_video`
- `audio_concat` -> `mcp__ffmpeg-media__concatenate_audio_files`
- `media_download` -> `mcp__filesystem-server__download`
- `frame_capture` -> `mcp__ffmpeg-media__capture_frame_at_timestamp`
- `media_duration` -> `mcp__ffmpeg-media__get_media_duration`
- `media_trim` -> `mcp__ffmpeg-media__trim_media_segment`
- `video_concat` -> `mcp__ffmpeg-media__concatenate_video_files`
- `draft_create` -> `mcp__draft-management__create_draft`
- `draft_update_meta` -> `mcp__draft-management__modify_draft`
- `draft_inspect` -> `mcp__draft-management__query_script`
- `draft_download` -> `mcp__draft-download__download_draft`
- `text_add` -> `mcp__draft-elements__add_text`
- `text_add_batch` -> `mcp__draft-elements__add_batch_text`
- `text_delete` -> `mcp__draft-elements__remove_text`
- `text_update` -> `mcp__draft-elements__modify_text`
- `subtitle_srt` -> `mcp__draft-elements__add_subtitle`
- `subtitle_recognition` -> `mcp__subtitle-recognition__submit_subtitle_recognition_task` / `mcp__subtitle-recognition__get_subtitle_recognition_task_status`（状态查询在返回长 JSON 结果时，优先将完整结果写入 workspace 本地 `.capcut/tool-results/subtitle-recognition/<taskId>.json`，工具只返回摘要与文件路径）
- `video_understand` -> `mcp__video-understand__submit_video_detail_task` / `mcp__video-understand__get_video_detail_task_status`（状态查询在返回长 JSON 结果时，优先将完整结果写入 workspace 本地 `.capcut/tool-results/video-understand/<taskId>.json`，工具只返回摘要与文件路径）
- `text_intro_animation_list` -> `mcp__draft-elements__get_text_intro_types`
- `text_outro_animation_list` -> `mcp__draft-elements__get_text_outro_types`
- `text_loop_animation_list` -> `mcp__draft-elements__get_text_loop_anim_types`
- `font_list` -> `mcp__draft-elements__get_font_types`
- `image_add` -> `mcp__draft-elements__add_image`
- `image_add_batch` -> `mcp__draft-elements__add_batch_image`
- `image_update` -> `mcp__draft-elements__modify_image`
- `image_delete` -> `mcp__draft-elements__remove_image`
- `video_add` -> `mcp__draft-elements__add_video`
- `video_add_batch` -> `mcp__draft-elements__add_batch_video`
- `video_update` -> `mcp__draft-elements__modify_video`
- `video_delete` -> `mcp__draft-elements__remove_video`
- `transition_type_list` -> `mcp__draft-elements__get_transition_types`
- `audio_add` -> `mcp__draft-elements__add_audio`
- `audio_add_batch` -> `mcp__draft-elements__add_batch_audio`
- `audio_update` -> `mcp__draft-elements__modify_audio`
- `audio_delete` -> `mcp__draft-elements__remove_audio`
- `audio_effect_type_list` -> `mcp__draft-elements__get_audio_effect_types`
- `keyframe_add` -> `mcp__draft-elements__add_video_keyframe`
- `effect_add` -> `mcp__draft-elements__add_effect`
- `effect_update` -> `mcp__draft-elements__modify_effect`
- `effect_delete` -> `mcp__draft-elements__remove_effect`
- `character_effect_type_list` -> `mcp__draft-elements__get_video_character_effect_types`
- `scene_effect_type_list` -> `mcp__draft-elements__get_video_scene_effect_types`
- `filter_add` -> `mcp__draft-elements__add_filter`
- `filter_update` -> `mcp__draft-elements__modify_filter`
- `filter_delete` -> `mcp__draft-elements__remove_filter`
- `filter_type_list` -> `mcp__draft-elements__get_filter_types`
- `image_intro_animation_list` -> `mcp__draft-elements__get_intro_animation_types`
- `image_outro_animation_list` -> `mcp__draft-elements__get_outro_animation_types`
- `image_loop_animation_list` -> `mcp__draft-elements__get_combo_animation_types`
- `subtitle_template` -> `mcp__subtitle-template__generate_smart_subtitle` / `mcp__subtitle-template__get_smart_subtitle_task_status`
- `template` -> `mcp__koubo-template__submit_koubo_template_task` / `mcp__koubo-template__get_koubo_template_task_status`

说明：

- `audio_extract` / `audio_concat` / `frame_capture` / `media_duration` / `media_trim` / `video_concat`：属于本地媒体处理能力，统一使用应用随包安装的 `ffmpeg` / `ffprobe` 执行，不依赖远端剪映草稿接口；其中 `audio_extract` / `audio_concat` / `frame_capture` / `media_trim` / `video_concat` 在未显式传入 `output_path` 时，若输入是本地文件，默认将产物写到首个源文件同目录；若输入是远程 URL，则可退回临时目录
- `media_download`：用于先把远程音频、图片、视频链接下载到当前 workspace，再交给后续 `ffmpeg` 能力处理；当用户给的是 OSS 临时链接、外部图片链接、音视频直链，且后续任务要求本地裁剪、拼接、抽帧或其他依赖本地文件的媒体处理时，应优先补充该子能力，避免直接把不稳定远程 URL 交给 `ffmpeg`
- `subtitle_recognition`：仅负责识别并提取音频或视频中的字幕内容，不负责把文字添加回草稿，也不负责上屏样式；底层走异步 ASR 任务提交 + 状态查询链路；输入必须是服务端可访问的远程 `url`，应消费已完成前置上传后的可访问链接；档位分为 `basic`（基础、快速）、`nlp`（在 `basic` 基础上增加 12 字一句上限，适合短视频场景，属于快速分句）、`llm`（在 `basic` 基础上增加 12 字上限、翻译、关键词信息，属于智能分句）、`llm_vad`（在 `llm` 基础上进一步去除气口、重复、错误字）
- `video_understand`：视频理解能力，仅负责结构化理解视频画面内容，不描述声音；底层走异步任务提交 + 状态查询链路；支持单视频 `video_url` 或多视频 `video_urls`，也支持补充 `fps` / `fps_list` 控制抽帧；输入应为已完成前置上传后的服务端可访问视频链接
- `subtitle_template`：字幕样式模版能力，强调“把音频/视频中的文字按指定字幕模版添加回草稿并上屏”，而不是单纯提取字幕；可基于已有草稿继续编辑；用户可主动指定字幕模版，默认使用 `asr_42da310c1e4347ddb2c96dd2a5d055c2`
- `image_add` / `video_add` / `audio_add`：既支持远程 `image_url` / `video_url` / `audio_url`，也支持把本地文件路径直接放进对应的 `image_url` / `video_url` / `audio_url`；收到本地路径时不默认自动上传，只有用户明确要拿可复用公网 URL 时才应命中 `workspace.upload`，并统一通过 `/sts/upload/agent_tmp/init` 获取临时可访问 URL
- `template`：口播模版剪辑，面向一段原始未剪辑口播做整体剪辑和套版；该子能力只接受视频输入，必须使用 `video_url` / `video_urls`，不能传 `audio_url` / `audio_urls`；输入要求为服务端可访问的远程视频链接，应消费已完成前置上传后的 URL；本地视频文件大小不得超过 `500MB`；模版内容通常包含字幕、音频、动画，不等同于字幕模版
- `transition_type_list`：转场类型主要用于图片/视频等视觉素材衔接；用户提到“查看可用的转场类型”时应直接命中该子能力
- `image_intro_animation_list` / `image_outro_animation_list` / `image_loop_animation_list`：图片和视频共用同一套动画查询工具；用户提到“查看视频入场动画 / 视频出场动画 / 视频循环动画”时，也应命中这三个子能力
- `draft_download`：专用于下载剪映草稿；当当前句子或前文上下文里已经出现 `草稿` / `draft` / `draft_id` / `draft_url` / `dfd_` 等草稿标识时，下载语义应优先命中 `draft_download`，不要误落到 `workspace.download` 或 `media_download`

- 用户提到“分离视频里的音频”“提取视频音频”“提取 xxx 文件的音频”“导出音轨”时，应优先命中 `audio_extract`
- 用户提到“把两个音频拼在一起”“合并多个音频”“拼接音频文件”“把几段录音接成一个”时，应优先命中 `audio_concat`
- 用户提到“下载这个音频”“下载这张图片”“下载这个视频”“把这个媒体链接保存到本地”时，应优先命中 `media_download`
- 用户提到“截取某个时间戳的帧图片”“在 10 秒处截一帧”“抽一张帧图”时，应优先命中 `frame_capture`
- 用户提到“获取视频时长”“查看音频时长”“查询 media duration”时，应优先命中 `media_duration`
- 用户提到“截取 10 秒到 25 秒的视频片段”“裁一段音频出来”“按时间范围剪一段素材”时，应优先命中 `media_trim`
- 用户提到“把两个视频拼在一起”“合并多个视频片段”“拼接视频文件”“把几段视频接成一个”时，应优先命中 `video_concat`
- 用户提到“识别这个音频里的字幕”“提取这个视频链接的字幕”“把这段音频转成带时间轴的字幕”“识别链接里的文案/字幕”时，应优先命中 `subtitle_recognition`
- 用户提到“理解这个视频在讲什么”“分析这个视频画面内容”“总结视频镜头内容”“识别视频里出现了什么画面/场景/人物/动作”时，应优先命中 `video_understand`
- 用户提到“下载草稿”“把这个 draft 下载下来”“下载这个 draft_url”“下载 dfd_xxx 对应的草稿”时，应优先命中 `draft_download`
- `subtitle_recognition` 仅接受音频/视频链接；若输入原始形态是本地文件路径、拖入文件或 workspace 内文件，应先通过独立前置的 `workspace.upload` 转成临时可访问 URL，再执行字幕识别；禁止把本地路径直接传给远端字幕识别接口
- `video_understand` 仅接受服务端可访问的视频链接；若输入原始形态是本地视频文件路径、拖入文件或 workspace 内视频，应先通过独立前置的 `workspace.upload` 转成临时可访问 URL，再执行视频理解；禁止把本地路径直接传给远端视频理解接口
- 当用户明确表达“只提取字幕”“不要上屏”“不要添加到草稿”“先识别出字幕文本/时间轴”时，必须命中 `subtitle_recognition`，不要误落到 `subtitle_template`
- 当用户明确表达“添加字幕模版”“套字幕样式”“把字幕加回草稿”“识别后按某种样式上屏”时，应命中 `subtitle_template`；其核心目标是样式化字幕并回写草稿，而非只返回识别结果
- 若一句话里同时出现“识别字幕”和“添加模版/加回草稿/上屏”等表述，应以最终目标判断；最终目标是拿到字幕文本或时间轴时命中 `subtitle_recognition`，最终目标是生成带样式字幕并写回草稿时命中 `subtitle_template`
- 当用户提供远程音频/图片/视频 URL，后续又要求本地 `ffmpeg` 处理（如拼接、裁剪、抽帧）时，推荐组合命中 `media_download`，先下载到 workspace 再处理，避免远程临时链接失效或 `ffprobe` / `ffmpeg` 直接读取失败
- 若“下载”请求同时满足草稿标识和普通 URL 特征，应以 `draft_download` 为最高优先级；只有在没有任何草稿上下文时，才考虑 `workspace.download` 或 `media_download`
- 对 `audio_extract` / `audio_concat` / `frame_capture` / `media_trim` / `video_concat`，如果输入媒体文件位于当前 workspace 且用户未指定输出路径，默认应将新文件生成在首个源文件同目录，而不是系统临时目录；`media_duration` 为只读探测，不生成新文件
- 用户提到“创建草稿” / “创建一个草稿” / “创建一个剪映草稿” / “创建一个剪辑草稿”时，应命中 `draft_create` + `draft_update_meta`
- 当同一句话同时包含“创建”语义，且路由结果同时带上 `workspace.write` 时，执行阶段仍应优先使用 `mcp__draft-management__create_draft`；不要因为存在通用写文件工具就手动创建本地草稿目录、草稿 JSON 或空白草稿脚手架
- 用户提到“修改草稿封面”或“修改草稿名称”时，优先命中 `draft_update_meta`
- 当任务涉及复杂草稿修改、修改了多个元素，或用户明确要求确认结果时，应补充 `draft_inspect`，用于查看草稿内容并校验是否添加正确
- 当句子中出现草稿标识（如 `草稿` / `draft` / `dfd_`），同时包含“检查 / 看一下 / 确认 / 校验 / 核对”等动词，且后续跟随视觉属性词（如动画、弹入、转场、位置、样式、特效等）时，应直接命中 `draft_inspect`

## 多域组合原则

一个任务不强制只能落在一个域。

典型组合：

- `workspace.read + web.search`
- `workspace.write + web.browser`
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
- `skills.list_skill`

## 示例

### 通用用户示例

| 用户输入 | 预期主域 | 预期子能力 | 备注 |
| --- | --- | --- | --- |
| `你好` | `chat` | `[]` | 基础对话 |
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
| `识别这个视频链接里的字幕` | `cut` | `["subtitle_recognition"]` | 远端异步字幕识别，仅接受可访问 URL |
| `把这个本地音频文件识别成字幕` | `cut + workspace` | `["subtitle_recognition", "upload"]` | 先上传再识别，禁止直接传本地路径 |
| `把这段视频的字幕提取出来，但不要上屏` | `cut` | `["subtitle_recognition"]` | 只提取字幕内容，不写回草稿 |
| `先识别这段音频字幕，再按字幕模版加回草稿` | `cut` | `["subtitle_template"]` | 目标是样式化字幕并回写草稿 |
| `把这个草稿的封面和名称改一下` | `cut` | `["draft_update_meta"]` | 草稿元信息修改 |
| `下载草稿` | `cut` | `["draft_download"]` | 剪辑任务 |
| `给这段视频添加字幕模板` | `cut` | `["subtitle_template"]` | 识别后按字幕样式模版上屏并写回草稿 |
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
  "subdomains": ["search_skill", "create_skill"],
  "companionDomains": [],
  "confidence": 0.95
}
```

### 示例 5

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
