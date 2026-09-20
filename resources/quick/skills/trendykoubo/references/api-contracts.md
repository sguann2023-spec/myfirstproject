# 内部 MCP 工具合约

本技能所有远程能力一律通过内部 MCP 工具调用（对应参考实现 `koubo_1f9c8d7e6a2b4c0d9e8f123456789abc.py` 中 `pipeline.tasks` 的服务端调用），禁止脚本或 Agent 直连 HTTP 接口。

## 工具映射表

| 环节 | 参考实现（服务端） | 内部 MCP 工具 | 关键参数 |
|---|---|---|---|
| 查询视频时长 | `get_video_duration` | `mcp__vectcut__ffmpeg-media__get_media_duration` | `source` = 视频 URL/本地路径 |
| 提取音频 | （服务端 ASR 直读视频） | `mcp__vectcut__ffmpeg-media__extract_audio_from_video` | `source` = 视频 URL/本地路径，`format` = mp3 |
| ASR 识别 | `llm_asr_task` | `mcp__vectcut__subtitle-recognition__submit_subtitle_recognition_task` | `url` = 音频路径，`effectMode` = basic（submit-and-wait，工具返回 artifact.file_path 即原始结果文件） |
| 批量写入草稿 | `execute_workflow` | `mcp__vectcut__cut-workflow__execute_workflow` | `workflow_file` = workflow.json（inputs + script，一次提交全部 add_video/add_text/add_preset/add_audio） |
| 下载草稿 | 消息推送 | `mcp__vectcut__draft-download__download_draft` | `draftId`、`draftName` |
| BGM 时长探测 | `get_video_duration`（循环铺满前） | build_workflow.py 内置 ffprobe（代码，非工具） | `--bgm-duration` 可显式覆盖 |

## 使用规则

1. **本地视频**：先用 `extract_audio_from_video` 直接处理本地路径（工具支持本地绝对路径与 file URL），无需预先上传。
2. **ASR**：只传步骤 1 输出的音频文件路径（mp3），`effectMode` 固定 `basic`；工具返回的 `artifact.file_path` 直接作为 `asr_raw_result.json` 消费，禁止复制/改名/重存。
3. **工作流**：`build_workflow.py` 产出的 `workflow.json` 通过 `execute_workflow(workflow_file=...)` 一次提交；不要逐条调用 `draft-elements` 写入主干（提示音等 post 项已并入 workflow 的 `add_preset`）。
4. **下载**：`download_draft` 失败不阻塞流程，仅在最终回复中标注。
