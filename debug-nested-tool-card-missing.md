# Debug Session: nested-tool-card-missing
- **Status**: [OPEN]
- **Issue**: Codemode 内部成功调用 MCP 工具时，聊天流中缺少对应的工具卡片；直接工具调用可以正常显示。
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-nested-tool-card-missing.ndjson

## Reproduction Steps
1. 在 Agent 中发起字幕识别请求。
2. Agent 通过 Codemode 搜索并调用 `submit_subtitle_recognition_task`。
3. 观察工具实际执行成功，但聊天流中没有字幕识别工具卡片。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Codemode 嵌套 MCP 调用没有发出工具生命周期事件 | High | Low | Confirmed：第 39 行仅有嵌套执行采集，没有对应流层真实工具事件 |
| B | 嵌套事件被标记为父工具 `codemode` 并被前端隐藏 | High | Low | Confirmed：第 37 行 Pi 流层登记 `codemode` |
| C | 后端事件缺少前端工具卡片所需字段而被丢弃 | Medium | Medium | Confirmed：第 38、40 行渲染器拒绝 `codemode` |
| D | 消息合并逻辑覆盖了嵌套工具块 | Low | Medium | Rejected：渲染器收到了对应消息块 |
| E | 嵌套工具桥导致 Thinking/Bash 不再产生流事件 | Low | Low | Rejected：post-fix 日志仍登记 Thinking block，且多次登记 `toolName: Bash` |
| F | 完成态折叠把 Thinking/Bash 隐藏在“已完成”内 | High | Low | Pending：持久化消息包含 14 个 block；最终 renderer 选择日志待复现采集 |
| G | 父级不可见 `codemode` TOOL 被当作结果锚点，错误影响折叠边界 | High | Low | Pending：`isResultAnchorBlock()` 接受所有 TOOL，但 renderer 明确拒绝 `codemode` |
| H | `tool-error` 没有进入完成态历史累加器，失败卡片在 hydration 后丢失 | High | Low | Confirmed：流式阶段收到两次 Bash `tool-error`，完成时 `toolCallCount=10`、`toolResultCount=8` |

## Log Evidence
- 现有 `log.txt` 显示嵌套层执行 `mcp__vectcut__image-understand__inspect_image` 成功。
- 同一次调用在 Pi 流层输出为 `toolName: codemode`。
- 渲染器随后记录 `Skip non-mcp tool render: no renderer matched`。
- 专用日志第 39 行确认真实字幕识别 MCP 已执行。
- 专用日志第 37 行确认流层只登记父级 `codemode`。
- 专用日志第 38、40 行确认 `codemode` 被渲染器拒绝。
- post-fix 专用日志确认真实字幕 MCP 已以 `source: nested-codemode` 登记。
- post-fix 专用日志确认后续多次 Bash 调用仍进入 Pi 流层。
- `log.txt` 的完成事件确认最终持久化消息包含 `thinking` 和多个 `tool` block。
- 前端 `MessageBlockRenderer` 在完成态会把最后一个结果锚点之前的 block 收进“已完成”折叠区。
- 父级 `codemode` 同时满足 TOOL 结果锚点条件、又在 `MessageTool` 中渲染为 `null`。
- `TextStreamAccumulator.add()` 原本只处理 `tool-result`，没有处理 `tool-error`。
- 失败工具虽然保留了 tool block，但被持久化为 `pending/processing`，错误状态和错误回包均丢失。

## Verification Conclusion
根因是 Codemode 嵌套 MCP 执行没有向 Pi 查询流透传独立工具生命周期事件。前端只能收到父级 `codemode` 工具块，因此无法匹配 MCP 工具渲染器。

第一阶段已通过嵌套工具事件桥修复，真实 MCP 卡片已经出现。第二阶段正在确认 Thinking/Bash 是仅被完成态折叠，还是被不可见的父级 `codemode` 锚点改变了折叠边界。

失败工具持久化已补齐：`tool-error` 现在作为终态结果写入累加器，历史 block 保留 `status: error`、错误内容和原始回包。对应回归测试已通过。
