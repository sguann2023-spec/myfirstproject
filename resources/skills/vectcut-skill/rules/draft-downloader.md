---
name: draft-downloader
description: 通过 VectCut deeplink 触发草稿下载/打开。用户提到“下载草稿”“打开 dfd_cat 草稿”“批量下载草稿ID”“把草稿ID拉到客户端”时必须使用本技能。标准流程是先生成 deeplink，再由宿主层安全打开。支持去重、清洗与 `dfd_cat_` 前缀校验。
---

# Draft Downloader Skill

将一个或多个草稿 ID 组装为 `vectcut://download?draft_id=...` deeplink。标准路径是脚本只负责生成结构化结果，再由宿主层系统工具安全打开 deeplink；不要依赖 Bash 里的 `start` / `cmd.exe` / `open` / `xdg-open` 作为主流程。

## When to use

- 用户已拿到草稿 ID（通常是 `dfd_cat_` 前缀），希望下载到本地客户端
- 用户希望批量处理多个草稿 ID
- 用户提到“触发下载草稿”“打开草稿到 VectCut 客户端”“deeplink 打开草稿”

## Workflow

### Prerequisites

### Execution

单个草稿，默认只生成 deeplink：

```bash
python <skill-path>/scripts/draft_downloader.py "dfd_cat_xxx"
```

批量草稿，默认只生成 deeplink：

```bash
python <skill-path>/scripts/draft_downloader.py "dfd_cat_xxx" "dfd_cat_yyy"
```

可选参数：

```bash
python <skill-path>/scripts/draft_downloader.py \
  --scheme vectcut \
  --route download \
  "dfd_cat_xxx" "dfd_cat_yyy"
```

仅在本地手工运行时，显式要求脚本直接尝试打开：

```bash
python <skill-path>/scripts/draft_downloader.py \
  --open \
  "dfd_cat_xxx" "dfd_cat_yyy"
```

### What the script does

1. 清洗输入：去空白、按出现顺序去重。
2. 校验 ID：默认要求每个 ID 以 `dfd_cat_` 开头。
3. 构建 deeplink：`vectcut://download?draft_id=a&draft_id=b`（重复参数形式）。
4. 默认不在脚本内触发客户端，只返回 deeplink，交给上层宿主在桌面环境中打开。
5. 若显式传入 `--open`，脚本才会尝试按系统可用性调用本地打开器。
6. 输出结果：打印 JSON，包含 deeplink、有效草稿 ID 列表、是否尝试打开、是否成功打开。

### Standard host flow

1. 运行脚本，读取 JSON 输出中的 `deeplink`。
2. 若宿主暴露了 `open_deeplink` 一类系统层工具，则调用该工具打开 `vectcut://download?...`。
3. 不要在 agent 的 Bash 工具里拼 `start "vectcut://..."` 或 `cmd.exe /c start ...`。

### Output

```json
{
  "success": true,
  "deeplink": "vectcut://download?draft_id=dfd_cat_1&draft_id=dfd_cat_2",
  "draft_ids": ["dfd_cat_1", "dfd_cat_2"],
  "attempted_open": false,
  "opened": false,
  "message": "Deeplink generated. Let the host desktop app open it via a trusted system-layer tool."
}
```

### Error handling

- 若输入为空或清洗后无有效 ID，脚本返回非 0 退出码
- 若 ID 不符合前缀规则，脚本返回参数错误信息
- 默认模式下，不把“是否拉起客户端”作为成功条件；只要 deeplink 构建成功即返回 `success=true`
- 显式 `--open` 时，若未找到可用系统打开命令或协议未注册，则返回 `success=false`
