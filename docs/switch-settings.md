# switch 设置

聊天顶部“配置外部链接”窗口的“模型”Tab 管理本机 Codex 和 WorkBuddy 中的 VectCut 配置；“MCP”Tab 保留原有外部 Agent 工具连接。模型来自官方 PC 实时模型列表，不接受自定义地址、API Key 或手写模型 ID。设置侧栏不再单独提供 switch 入口。

## 使用

1. 登录当前账号，安装工具后点击聊天顶部“配置外部链接”（已连接时显示“已连接”），切到“模型”Tab。每次打开窗口默认显示 MCP。
2. 打开对应开关，直接按当前账号写入或更新 VectCut 配置，无确认弹窗。
3. 关闭开关，读取最新文件，只清理明确属于 VectCut 的 provider、模型及引用。离线、退出登录或模型列表尚未返回时，仍可关闭清理。
4. 开关操作期间显示 loading，两个开关暂时禁用，成功后更新状态；失败使用脱敏 `message.error`，不假报成功、不自动重试配置写入。
5. 配置变更后完全退出并重启目标工具。模型 Tab 只在显示时启动状态读取；切回该 Tab 会读取最新状态。切 Tab 或关窗不会中断已经提交的写入，重新进入时保留 pending loading，避免重复提交。隐藏期间不新发模型读取，账号变化仍使旧账号结果失效，不自动导出另一个账号的凭据。

API Key 与“账号与安全”使用同一长效账号凭据来源，明文保存在目标工具需要的配置项中。退出本应用不会撤销已导出的 Key；请仅在可信设备上开启。

## 配置位置

| 工具 | 默认文件 | 目录环境变量 | 接口 |
| --- | --- | --- | --- |
| Codex | `~/.codex/config.toml` | `CODEX_HOME`（绝对路径） | `https://open.vectcut.com/llm/chat/v1/responses` |
| WorkBuddy | `~/.workbuddy/models.json` | `WORKBUDDY_CONFIG_DIR`（绝对路径） | `https://open.vectcut.com/llm/chat/v1/chat/completions?client_type=pc` |

## 归属管理

### Codex

- 使用专属 `model_providers.vectcut_switch` 与 TOML 归属注释，不添加未知原生 schema 字段。
- 通过 TOML AST 定位和局部修改，保留其他 provider、MCP、无关配置、注释、BOM 和换行风格。不访问或修改 `auth.json`。
- 仅导出 PC 实时列表中规范 ID 以 `gpt-` 开头的 GPT 原生 Responses 模型。不会伪造模型能力、基础指令或内部模型目录。
- 公共模型/推理字段需要更新时读取当前值；本应用新增的字段附加归属注释，原有用户字段不因被更新就自动取得归属。
- 关闭移除已确认归属的 provider，并清理根级及 profiles 中指向它的精确引用。普通模型或推理档位改变不作为历史恢复冲突。
- 当前已切到其他 provider 时，保留该选择及其公共模型/档位设置。公共字段并非只因值像 GPT、URL 相同或名字相近就能删除。
- 同名但没有可信归属的 provider 不覆盖、不自动删除。旧版只有具备完整 VectCut 路由签名的专属项才识别为旧归属配置；否则 message 提示用户检查。
- 不读取或删除用户的外部 `model_catalog_json` 文件，不沿任意配置引用删除磁盘文件；开启不接管外部模型目录。

### WorkBuddy

- VectCut 模型条目带 `vectcutSwitchProviderId: "vectcut_switch"`。导出的 `id` 与 `name` 均使用 PC 列表返回的显示名（空白时回退规范 ID），避免 WorkBuddy 拼接 `name:id`；后端须先部署显示名到规范 ID 的映射，路由和计费仍使用规范 ID。Codex 不受此调整影响。
- 更新会将旧版带归属标记的规范 ID 条目替换为显示名 ID，同步 `availableModels`；显示名重复时只导出首个条目。用户条目占用规范 ID 或显示名 ID 时都跳过，不覆盖。
- 开启替换当前所有带此标记的模型，同步 PC 实时列表及返回的能力元数据。未标记的同 ID 模型保持原样并跳过，继续添加剩余模型；部分跳过仍按成功处理。全部 ID 都被占用时成功结束、不改动原配置，也不会将用户模型认领为 VectCut 模型，因此没有受管项时开关仍显示关闭。
- 关闭只删除当前带标记的条目，并从 `availableModels` 中移除这些条目的 ID，保留用户模型、其他供应商、无关选择和顶层字段。
- 修改本应用模型的名称、能力或可见性不阻止清理。标记已被移除的条目按用户配置保留，不凭历史模型 ID 或地址重新认领。
- `vendor` 为 `VectCut`，`useCustomProtocol: false`。全部模型按后台 `thinking_levels/thinking_default` 统一映射，不按型号硬编码：原生 `minimal/low/medium/high/xhigh/max` 去重保序，写入 `reasoning.supportedEfforts`；合法默认强度写入 `reasoning.defaultEffort`。WorkBuddy 5.11.3 的运行时从嵌套对象读取能力，故不再写无效的顶层 `supportedEfforts/defaultEffort/canDisableThinking`。
- `off/none/disabled` 只表示可关闭思考，写 `reasoning.canDisableThinking: true`，不混入强度列表；`on/enabled` 表示支持思考开关，不伪造成某档强度。明确支持思考但没有关闭选项时写 `reasoning.canDisableThinking: false` 和顶层 `onlyReasoning: true`，允许关闭的条目省略 `onlyReasoning`。无元数据或只有未知值时不导出 `reasoning` 或强制思考标志；只有 off/on 时仅导出是否可关闭，不生成虚构强度。重新开启会完整替换带归属标记的旧条目，移除过时顶层字段，用户自有条目仍原样保留。

## 无备份与安全写入

不再创建或读取配置快照、恢复 journal 或 safeStorage 备份。关闭是按当前归属清理，**不是恢复启用前的原文件**；此前被更新的公共字段没有历史值可还原，由工具剩余配置或默认设置生效。

单文件写入保留私有权限、独占锁、UTF-8/大小/普通文件校验、符号链接防护、紧邻发布前的内容检查及原子替换。检测到提交期间变化会拒绝覆盖并提示重试。独占锁只约束本应用；对不遵守锁的外部程序，现有文件的最后检查与原子替换之间仍有无法用跨平台文件 API 完全消除的竞态窗口，不能承诺任意并发保存绝不丢失。建议更改配置时退出对应工具。

旧版 `userData/switch-backups/{codex,workbuddy}.json` 不再参与配置操作。成功操作后仅尝试删除结构明确的旧加密 envelope，不解密、不执行恢复；未知、不可读、符号链接或已发生并发修改的旧文件保留，且不阻塞当前配置清理。不会删除整个用户数据目录或其他文件。

## 模型选择

PC 接口为 `/llm/chat/model_list?client_type=pc`。有 `models` 列表时，其 ID 和顺序是权威结果，富元数据只按 `model_id` 关联；不补入已下架模型、不按显示名判资格。

Codex 优先保留仍有效的已配置模型，否则使用后台兼容默认或首个兼容模型；每次开启重新获取实时列表，所选模型已下架则失败并只读刷新，不静默改选自动重写。无兼容 GPT 时不能开启 Codex，但不影响 WorkBuddy。列表为空时两者不能开启，关闭不受此限制。

Codex 推理档位只写原生 `none/minimal/low/medium/high/xhigh`；不直传 `max/ultra`。WorkBuddy 的视觉、token 和推理能力只使用后台返回的元数据，允许其原生配置中的 `max` 强度，按上文统一规则写入嵌套 `reasoning`。

## 验证命令

```sh
pnpm exec vitest run --config src/main/services/switch/adapters.vitest.config.mjs
pnpm exec vitest run --config src/main/services/switch/switch.vitest.config.mjs --no-file-parallelism
pnpm exec vitest run --config src/components/SwitchSettings/vitest.config.mjs
pnpm exec vitest run --config src/main/services/__tests__/local-mcp.vitest.config.mjs
pnpm exec vitest run --config src/page/HomePage/customChatModels.vitest.config.mjs src/page/HomePage/settingsNavigation.test.js src/page/SettingPage/SettingPage.test.jsx
```

测试使用临时目录、模拟账号和网络，不操作个人工具配置或发送计费模型请求。真实 Codex/WorkBuddy 重启加载及对话仍需安装相应版本联调。

参考 CC Switch v4.0.35 的原生配置格式，MIT 声明随应用资源分发于 `resources/licenses/cc-switch-MIT.txt`。本项目归属清理逻辑独立实现，不引入其代理、账号切换或其他工具配置。
