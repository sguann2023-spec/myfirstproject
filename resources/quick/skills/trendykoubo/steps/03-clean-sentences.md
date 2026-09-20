# 步骤 3：机械化清洗

> **⚡ 性能优化**：删除了原「一次 LLM 完成分句+翻译+关键词」环节——其产物 `asr_translation_keywords.json` 从未被任何后续脚本消费（步骤 4 用 `asr_cleaned_sentences.json`，步骤 5 的打包模板单次 LLM 调用已完整包含 text/en/keyword），属纯冗余；删除后本步骤从 ~133s 降至 <5s。**本步骤不调用 LLM。**

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [raw_result_path, remove_silence]
        properties:
          raw_result_path:
            type: string
            description: 步骤 2 保存的原始 ASR 结果文件路径。
          remove_silence:
            type: boolean
            default: true
            description: 去气口开关，决定脚本模式：true 走去气口清洗（默认），false 加 `--keep-pauses` 仅去标点。
```

## 操作规则

### 3.1 去气口模式（`remove_silence=true`）

**只做机械化清洗**，调用技能目录下的脚本（脚本自动完成去标点、去气口、去重复）：

```bash
python3 {skill_dir}/scripts/clean_asr.py --input {workspace}/asr_raw_result.json --output {workspace}/asr_cleaned_sentences.json
```

### 3.2 不去气口模式（`remove_silence=false`）

调用同一脚本的去气口关闭模式（**仅去标点，保留原始语句边界与时间戳，不删任何句**）：

```bash
python3 {skill_dir}/scripts/clean_asr.py --input {workspace}/asr_raw_result.json --output {workspace}/asr_cleaned_sentences.json --keep-pauses
```

脚本自动完成：仅去除标点、保留原句时间戳和边界，输出字段结构与去气口模式完全一致（`is_filler`/`is_duplicate` 全部为 false），供步骤 4 统一消费。**禁止 Agent 手工提取或改写语句。**

## 通用硬规则

- 本步骤**禁止调用 LLM**，全部为机械操作；分句、翻译、关键词统一由步骤 5 的单次 LLM 调用生成。
- 不得合并相邻 ASR 句，不得删除、重排或改写原句。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 机械化清洗完成。
    content:
      application/json:
        schema:
          type: object
          required: [cleaned_path]
          properties:
            cleaned_path:
              type: string
              description: 清洗后分句文件 asr_cleaned_sentences.json（两种模式均由脚本生成，字段结构一致）。
            sentence_count:
              type: integer
              description: 清洗后句数。
```
