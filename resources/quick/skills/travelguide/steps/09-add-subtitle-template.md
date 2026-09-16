# 步骤 9：添加字幕模板与口播音频

> 从已验证的真实字幕模板 ID 列表中随机选择一个，使用同一个调用将字幕模板和口播音频写入步骤 8 创建的草稿。此步骤未通过草稿写入校验时，必须停止，禁止改用其他字幕工具或模板别名。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [audio_url, draft_id]
        properties:
          audio_url:
            type: string
            format: uri
            description: 步骤 4 生成的口播音频 URL。
          draft_id:
            type: string
            description: 步骤 8 创建的草稿 ID。
```

## 操作规则

### 9.1 随机选择已验证模板 ID

仅可从以下真实模板 ID 中随机选择一个。它们已在现有共享技能的有效枚举或默认配置中使用；不得使用模板别名，不得使用列表外 ID：

- `asr_42da310c1e4347ddb2c96dd2a5d055c2`
- `asr_60348d11a5f54d2a98afb52f6acdb916`
- `asr_601e98ed739a43b5a310a17e327fbe01`
- `asr_f5f42fbfdd9045409c9b783bfdf4ba14`

将本次实际选中的 ID 记录为 `template_id`，并写入本次执行回执。

### 9.2 调用字幕模板工具

调用 `mcp__subtitle-template__generate_smart_subtitle`，参数必须严格为：

- `url`: `audio_url`
- `agentId`: `template_id`
- `draftId`: `draft_id`
- `addMedia`: `true`

不得传入 `template` 参数；不得调用 `add_subtitle` 作为静默替代方案。

### 9.3 写入门禁校验

> **重要说明**：字幕模板工具（`generate_smart_subtitle`）将字幕写入为 **贴纸材料**（`materials.stickers` + `materials.material_animations`），**不是** `materials.texts`。因此校验时**不能**检查 `materials.texts` 是否非空。

工具返回成功后，必须调用 `mcp__draft-management__query_script` 查询 `draft_id`，并同时满足以下条件才可进入步骤 10：

1. **模板一致性**：本次调用返回的 `agent_id` 与记录的 `template_id` 完全一致；
2. **字幕贴纸已写入**：草稿的 `materials.stickers` 非空 **或** `materials.material_animations` 非空（字幕模板以贴纸+动画形式写入）；
3. **字幕轨道已创建**：`track_count >= 2`（音频轨道 + 字幕贴纸轨道）；
4. **口播音频已写入**：`materials.audios` 非空，且音频时长与口播音频时长一致；
5. **工具返回字幕数 > 0**：工具响应中 `subtitles` 数组长度大于 0。

任一条件不满足，则步骤 9 失败：记录所选 `template_id`、工具响应和草稿校验结果后停止执行。禁止继续步骤 10，禁止静默切换至其他模板 ID 或基础字幕方案。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 字幕模板与口播音频已写入草稿并通过校验。
    content:
      application/json:
        schema:
          type: object
          required: [template_id, status, subtitle_count, audio_written, draft_verified]
          properties:
            template_id:
              type: string
              enum:
                - asr_42da310c1e4347ddb2c96dd2a5d055c2
                - asr_60348d11a5f54d2a98afb52f6acdb916
                - asr_601e98ed739a43b5a310a17e327fbe01
                - asr_f5f42fbfdd9045409c9b783bfdf4ba14
              description: 本次随机选中并实际传入的真实字幕模板 ID。
            status:
              type: string
              enum: [success]
            subtitle_count:
              type: integer
              minimum: 1
            audio_written:
              type: boolean
              const: true
            draft_verified:
              type: boolean
              const: true
  "500":
    description: 字幕模板调用或草稿写入校验失败；流程已停止。
```
