# 用 Pi 原生 read/write/edit 替换手写实现并放行（Write/Edit 免审批）

## 背景

- Bash **已经是** Pi 原生工具（`buildPiBashTool` 包装 `createBashTool()`，`create-harness.ts:293-318`），无需改动。
- `pi-agent-core@0.83.0` 已导出 `createReadTool/createWriteTool/createEditTool`（已验证 dist），无需新依赖。
- 手写 Read/Write/Edit/MultiEdit 在 `create-harness.ts:592-734`；Pi 原生参数是 `path` + `edits:[{oldText,newText}]`。
- MultiEdit 在渲染层有引用（`ToolsSettings.tsx:47`、`MessageAgentTools/index.tsx:70`），不能删，改为原生 edit 的别名。
- 权限事实：`canUseTool`（`permission-hooks.ts:53-115`）默认（`CHERRY_AUTO_ALLOW_TOOLS !== '0'`）自动放行除 AskUserQuestion 外的所有工具；本次把免审批变成显式保证，不依赖环境变量。
- **系统提示词零改动**：不激活 `hasWriteTools` 指引段，`prompt.ts` 不动。

## 改动

### 1. `harness/create-harness.ts`

新增通用包装函数（仿 `buildPiBashTool` 模式）`wrapPiNativeFileTool({ nativeTool, name, agentNode, cwd })`：

- 重命名为 'Read'/'Write'/'Edit'/'MultiEdit'；
- `execute` 内每次 `new NodeExecutionEnv({ cwd })`（shellPath 可选，文件工具不需要），finally `cleanup()`；
- execute 前做**遗留参数归一化**：`file_path`→`path`；顶层 `old_string/new_string`→`oldText/newText`（Pi 的 `prepareArguments` 支持顶层 oldText/newText）；`edits[]` 内的 `old_string/new_string`→`oldText/newText`；丢弃 `replace_all`（原生 edit 是"唯一匹配"语义）。

`buildBuiltinTools` 中：readTool/writeTool/editTool 改用包装后的原生工具；multiEditTool = 原生 edit 包装 + 名字 'MultiEdit'（渲染层兼容的别名）；清理 `countOccurrences`、`buildToolOutputPreview` 等不再使用的代码。

### 2. `tool-surface.ts`（放行 + 免审批）

- `builtinTools` 改为始终暴露：`['AskUserQuestion', 'Bash', 'Read', 'Write', 'Edit']`；删除 `hasExplicitSkillInvocation` 加 Read 的分支；`ReadImageAsContent` 条件保持不变。
- `autoAllowedTools`（`tool-surface.ts:24-29`，目前只收 `mcp__` 前缀）增加 `'Write'`、`'Edit'`——即使 `CHERRY_AUTO_ALLOW_TOOLS=0`，Write/Edit 也走 `permission-hooks.ts:96` 的 autoAllow 分支直接放行。

### 3. `tools.ts`（权限元数据与行为一致）

Write/Edit/MultiEdit 的 `requirePermissions: true` → `false`（该标志经 `tool-permissions.ts:299` 传给渲染端权限卡片）。

### 4. 测试更新

`__tests__/tool-surface.test.ts`：断言改为新数组（默认 `['AskUserQuestion','Bash','Read','Write','Edit']`）；如有 autoAllowedTools 断言一并更新。

### 无需改动的部分（已核实）

- **系统提示词**：`hasWriteTools` 保持未激活，`prompt.ts` 及其测试不动；
- `permission-hooks.ts`：autoAllow 分支已存在，零改动；
- 文件快照 `runtime-file-helpers.ts:44`：键提取兼容原生 `path`；
- Bash / ReadImageAsContent / Task / TodoWrite / Notebook*：不在本次范围。

## 行为变化（需要知晓）

1. Write/Edit 常驻暴露且**免审批**（显式 autoAllow + 元数据 false，双保险）；
2. Edit 语义从"支持 replace_all"变为 Pi 的"唯一匹配 + edits 数组"；
3. Read 输出从中文预览卡片格式变为 Pi 原生格式（行号截断、图片直接作为内容返回）；
4. prompt 增量仅 3 个工具 schema（约 300-400 token）。

## 验证

- `npx vitest run src/main/services/agents/services/claudecode/__tests__/tool-surface.test.ts`
- 项目现有 typecheck 确认无类型回归。
