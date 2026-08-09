# 智能字幕（已禁用）

本技能不再使用智能字幕。生成家装贴膜类口播卖货草稿时，禁止调用 `scripts/generate_smart_subtitle.py` 或 `/cut_jianying/generate_smart_subtitle`。

字幕必须使用 ASR `segments` 或去气口后的重映射句子时间轴，先派生规范化字幕列表，再通过 `/cut_jianying/add_text` 逐条写入字幕，轨道固定为 `manual_subtitle`。规范化需要处理长句切分和同轨重叠：超过 20 字的句子切分短句；相邻字幕重叠时，合并后不超过 20 字则合并，否则后句顺延。所有字幕默认 `fixed_width=0.65`，位置字段必须使用 `transform_x_px`、`transform_y_px`。普通字幕不得传 `effect_effect_id`，不得写入 `selling_text_template`。

只有关键转折、重要提示、业绩展示、效果优势、强 CTA 等强调话术，才允许把该句字幕做成花字字幕。花字不是新增关键词层，也不写入 `selling_text_template`；执行时只在该句字幕原本的 `add_text` payload 上增加固定 `effect_effect_id=W0FmRVRXQV1EZ1JRS11BbEBWVQ==`，其他字幕参数保持不变。
