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
            description: 去气口开关，决定是否调用清洗脚本。
```

## 操作规则

### 3.1 去气口模式（`remove_silence=true`）

**只做机械化清洗**，调用技能目录下的脚本（脚本自动完成去标点、去气口、去重复）：

```bash
python3 {skill_dir}/scripts/clean_asr.py --input {workspace}/asr_raw_result.json --output {workspace}/asr_cleaned_sentences.json
```

### 3.2 不去气口模式（`remove_silence=false`）

1. **跳过 `clean_asr.py` 脚本**——不去气口时不需要机械化清洗。
2. 直接从 ASR 原始结果提取语句：仅去除标点，**保留原始时间戳和语句边界**，保存为 `{workspace}/asr_cleaned_sentences.json`（字段结构与去气口模式保持一致，供步骤 4 统一消费）。

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
              description: 清洗后分句文件 asr_cleaned_sentences.json（去气口模式为脚本产物，不去气口模式为仅去标点的原句提取）。
            sentence_count:
              type: integer
              description: 清洗后句数。
```
