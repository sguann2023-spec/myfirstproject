# Codemode 工具发现

## 目标

Agent 不再通过意图域选择工具。所有运行时 MCP 工具统一在宿主进程注册，只允许通过 Pi Codemode 按需发现和调用，避免把完整 MCP schema 放入主模型上下文。

## 工具面

主模型固定只看到：

- `AskUserQuestion`
- `codemode`

`Bash`、`Read`、`Write`、`Edit`、`Task` 等本地内置工具不再直接暴露。文件、网页、素材、草稿、媒体生成和系统能力均通过 Codemode 内的 MCP 工具完成。

前端 `direct_request` 快捷工具保持直连 MCP，不经过 Codemode。

## 发现流程

1. 使用 `searchTools(query, limit)` 搜索工具。
2. 搜索结果只返回工具名和短描述，不返回完整 input schema。
3. 使用 `describeTool(name)` 获取单个候选工具的完整 schema。
4. 使用 `tools[name](args)` 调用工具。

示例：

```js
return await searchTools("create blank draft", 5)
```

```js
return await describeTool("mcp__vectcut__draft-management__create_draft")
```

```js
return await tools["mcp__vectcut__draft-management__create_draft"]({
  name: "空白草稿"
})
```

## 安全边界

Codemode 使用 QuickJS/WASM 沙箱。脚本不能直接访问宿主进程、文件系统、网络、模块加载器或环境变量，只能通过注册工具执行操作。

嵌套 MCP 调用继续经过现有权限校验、超时处理和文件变更快照。
