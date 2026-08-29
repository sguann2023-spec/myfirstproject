# 步骤 3：分句清洗 + 翻译 + 关键词（一次 LLM 完成）

> **⚡ 性能优化**：原 3 次 LLM 调用（分句→翻译→关键词）合并为 **1 次 LLM 调用**，耗时从 ~200s 降至 ~60s。

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
          text_content:
            type: string
            description: 可选校正文案。
```

## 操作规则

### 3.1 去气口模式（`remove_silence=true`）

1. **机械化清洗**：调用技能目录下的脚本 `python3 {skill_dir}/scripts/clean_asr.py --input {workspace}/asr_raw_result.json --output {workspace}/asr_cleaned_sentences.json`（脚本自动完成去标点、去气口、去重复）。
2. **一次 LLM 完成分句 + 翻译 + 关键词**（见下方统一 prompt）。

### 3.2 不去气口模式（`remove_silence=false`）

1. **跳过 `clean_asr.py` 脚本**——不去气口时不需要机械化清洗。
2. 直接从 ASR 原始结果提取语句：仅去除标点，**保留原始时间戳和语句边界**。
3. 同样用一次 LLM 完成分句 + 翻译 + 关键词。

### 统一 LLM Prompt（一次调用完成三项任务）

读取 `references/llm-prompts.md` 获取完整规则后，用以下 prompt 一次性生成：

```
你是字幕分句助手。对以下 ASR 清洗结果，一次性完成三项任务：

1. **语义分句**：按语义完整性拆分（主谓宾、动补、连词边界），每条 ≤12 字
2. **英文翻译**：每条分句的简短英文翻译
3. **关键词提取**：每条分句 1-2 个关键词（必须是原文连续子串）

硬规则：
- 不能合并相邻 ASR 句，不能删除/重排/改写原句
- 每条分句 ≤12 个有效字符；超 12 字必须在当前句内继续拆分
- 关键词必须是原文中连续出现的字词

输入（ASR 清洗结果）：
{cleaned_sentences_json}

输出 JSON 格式：
{
  "sentences": [
    {
      "source_index": 0,
      "original": "原句文本",
      "sub_segments": [
        {
          "text": "分句文本",
          "char_start": 0,
          "char_end": 6,
          "en": "English translation",
          "keyword": "关键词"
        }
      ]
    }
  ]
}
```

保存结果为 `{workspace}/asr_translation_keywords.json`。

## 通用硬规则

- 分句不能合并相邻 ASR 句子，不能删除、重排或改写原句。
- 每条分句最多 12 个有效字符；超过 12 字必须在当前 ASR 句内部继续拆分，每段尽量 8–12 字。
- 英文翻译要简短，优先表达当前中文含义。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 清洗与翻译完成。
    content:
      application/json:
        schema:
          type: object
          required: [cleaned_path, translation_path]
          properties:
            cleaned_path:
              type: string
              description: 清洗后分句文件（去气口模式为脚本产物，不去气口模式为仅去标点的原句提取）。
            translation_path:
              type: string
              description: 翻译与关键词文件（asr_translation_keywords.json）。
            sentence_count: { type: integer }
            keyword_count: { type: integer }
```
