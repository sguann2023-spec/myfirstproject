# switch 设置

设置侧栏的 `switch` 只接入本机 Codex 和 WorkBuddy。模型由官方 PC 模型接口提供，不接受自定义地址、API key、服务商或手写模型 ID。首次启用会要求确认。

## 使用

1. 登录当前账号，安装目标工具后打开“设置 → switch”。
2. 刷新工具与官方 PC 实时模型列表。Codex 仅选择其中的 GPT 原生 Responses 模型作为默认模型；其他模型请在 WorkBuddy 使用。WorkBuddy 同步全部 PC 模型，进入 WorkBuddy 后再选择要使用的模型。
3. 点击“启用”并确认。完全退出目标工具后重新打开。
4. 后台模型变化或切换账号后，主动点击“更新配置”。刷新会重新读取模型与配置状态并显示“需要更新”，但不会自动改写本地配置或导出另一个账号的 key。每次启用/更新都会重新获取当前列表；若所选 Codex 模型已从实时列表移除或不属于 GPT 原生范围，本次写入拒绝执行，界面刷新后需重新选择并主动操作。
5. 不再使用时点击“停用并恢复”。恢复只处理本功能管理的字段；与外部改动冲突时停止，不强行覆盖。

API key 与“账号与安全”使用同一长效账号凭据来源。它将明文保存在目标工具配置中，供工具直接请求官方后端；备份使用 Electron safeStorage 加密保存。退出本应用不会撤销已导出的长效 key。请仅在可信设备启用。

## 配置位置与协议

| 工具 | 默认文件 | 目录环境变量 | 接口 |
| --- | --- | --- | --- |
| Codex | `~/.codex/config.toml` | `CODEX_HOME`（绝对路径） | `https://open.vectcut.com/llm/chat/v1/responses` |
| WorkBuddy | `~/.workbuddy/models.json` | `WORKBUDDY_CONFIG_DIR`（绝对路径） | `https://open.vectcut.com/llm/chat/v1/chat/completions?client_type=pc` |

Codex 仅写入模型、原生推理档位及 `vectcut_switch` Responses provider，不再生成或设置 `model_catalog_json`，不覆盖 Codex 自身的基础指令、工具或模型能力。地址、长效 key、PC 请求头/query、搜索设置和 `auth.json` 行为不变，保留原有 MCP、其他 provider 和登录。设置页可从 PC 列表选择 GPT；Codex 内部模型选择器由 Codex 自身管理，不保证展示完整 PC 名单。

### Codex 搜索配置与旧版本迁移

启用/更新配置会通过 TOML AST 在根级写入 `web_search = "disabled"`（不是 provider 内的字段），禁用 Codex 原生搜索；本轮不改变该搜索策略。原有 `enabled`、`cached`、`live` 或缺失的根级值会改为 `disabled`，已为 `disabled` 时保持原始文本。其他 provider、MCP、注释、BOM、CRLF 及非激活 profile 不改动。

已有 Switch 配置若缺少根级禁用设置，会显示“需要更新”。状态检查只读配置和备份，不会自动迁移、改写文件或刷新凭据。用户必须主动点击“更新配置”，然后完全退出并重新启动 Codex，已运行进程不会自动加载这项修复。如果根级 `profile` 选中的 profile 声明了 `web_search`（即使值也是 `disabled`），新启用/更新会拒绝写入；请先移除该激活 profile 的覆盖后重试。未激活的 profile 原样保留。

显式“更新配置”以当前 TOML 为基础，不再要求模型、推理档位或本应用 provider 与上次写入快照一致：本应用专属 `vectcut_switch` provider 段重建为官方配置，必要根级字段按本次选择更新，其他 provider、MCP 和无关设置保留。旧版本本应用生成的模型目录在核对备份所有权及文件内容后，移除引用并删除，不再重新生成；文件已被手改则拒绝自动删除。用户自己的外部模型目录不接管、不删除，需用户先确认并移除引用。不是向文件末尾盲目拼接，重复更新不会产生重复键。活动 profile 冲突与无效 TOML 仍拒绝写入。

第一次原始备份单独保留，后续更新不覆盖；恢复基线保留第一次接管前的受管字段值，并纳入之后接受的无关修改。停用仍沿用三方比较：未经显式更新就被外部修改的受管字段会停止恢复，不强制覆盖。`web_search` 仅在 BEFORE 与 APPLIED 语义不同才纳入管理，旧备份未改过或启用前已禁用的搜索不追溯取得所有权。

WorkBuddy 使用原生 `models` 数组，条目带 `vectcutSwitchProviderId` 标记；同步全部当前官方 PC 模型，更新时移除已下架的本应用条目，保留其他来源模型、顶层设置及可见性列表的无关部分。使用用户确认的完整 Chat Completions 地址，并通过 `client_type=pc` 选择 PC 渠道；Codex 仍使用独立的 Responses 接口。

## PC 实时模型与 Codex GPT 原生范围

模型来源是现有官方 PC 接口 `/llm/chat/model_list?client_type=pc`，无需新增协议查询接口、额外协议字段或兼容桥部署。客户端不维护具体型号的静态白名单：仅当实时列表中的规范 `model_id` 区分大小写地以 `gpt-` 开头（`model_id.startsWith('gpt-')`），才将其标记为可用于 Codex 的 GPT 原生 Responses 模型。新出现的 `gpt-` 型号无需发版增补名单；名称、服务商类型/名称、provider 别名或兼容声明都不能让其他 ID 获得资格，也不会把非 GPT ID 改写成 GPT ID。

服务目录始终保留全部 PC 实时模型供 WorkBuddy 使用。只有合格模型显示在 switch 的 Codex 下拉框，选择后写为根级 `model`；不再导出 Codex 模型目录。没有 GPT 模型时，Codex 显示空选择并禁用启用/更新，不影响 WorkBuddy 使用其他实时模型。官方列表为空时不会生成兜底模型，两个工具都不可启用/更新。停用并恢复不依赖模型列表、网络或登录，模型请求尚未结束时也不阻塞已有配置的恢复。

接口存在 `models` 列表时（包括显式空数组），其 ID 和顺序是权威结果，按首次出现去重；富元数据仅按 `model_id` 关联，不补入已下架的额外条目，也不按名称或 provider 别名关联。列表中缺少元数据的模型保持稀疏，GPT ID 仍可获得 Codex 资格，但不补造视觉或 token 能力。仅在没有列表时兼容富条目独立返回及既有旧式封装。Codex 默认模型优先使用后端推荐且属于实时 GPT 列表的模型，否则使用列表中的首个 GPT 模型；明确选择的已移除模型不会被静默替换后写入。界面优先保留仍然有效的现有选择。

设置页显示与 WorkBuddy 的能力元数据继续取自 PC 返回。Codex 不覆盖视觉、上下文、基础指令或工具能力；只写原生枚举 `none/minimal/low/medium/high/xhigh` 可表达的推理档位，`max/ultra` 不直传。同模型时保留仍有效的现有档位，否则取有效后台默认、支持的 medium/首档；没有可用元数据时保守使用 medium。通用开关仅映射 `off → none`、`on → high`。GPT 家族筛选与单测不等于线上实测，原生 Codex 实际调用仍需确认。

备份保存在本应用 userData 下的 `switch-backups`。写入采用私有权限、已初始化的独占锁、加密 write-ahead journal、原子替换及失败回滚。目标路径为符号链接、配置语法损坏、安全存储不可用、模型 ID 冲突或文件在写入前改变时均拒绝覆盖。保留加密备份供中断恢复，不应在启用期间手工删除它。

## 验证命令

```sh
pnpm exec vitest run --config src/main/services/switch/adapters.vitest.config.mjs
pnpm exec vitest run --config src/main/services/switch/switch.vitest.config.mjs --no-file-parallelism
pnpm exec vitest run --config src/components/SwitchSettings/vitest.config.mjs
pnpm exec vitest run --config vitest.config.mjs src/api/chat.catalog.test.js src/main/services/agents/services/claudecode/__tests__/model-api-metadata.test.ts
pnpm exec vitest run --config src/page/HomePage/customChatModels.vitest.config.mjs
```

单测使用临时目录、模拟账号及网络，不读写个人工具配置或发送计费模型请求。真实 Codex/WorkBuddy 的模型目录加载、重启和对话仍需安装相应版本后进行联调，尤其需要验证 WorkBuddy 对自定义完整 URL 的传递行为。

参考 CC Switch v4.0.35 的原生配置行为，MIT 声明随应用资源分发于 `resources/licenses/cc-switch-MIT.txt`。未引入其代理、账号切换或其他工具配置。
