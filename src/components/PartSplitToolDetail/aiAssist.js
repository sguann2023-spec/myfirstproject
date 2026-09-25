import { partRanges } from './model';
import { subtractRanges } from './subtitles';

export const validateAiStoryboard = (next, original) => {
  if (!original) throw new Error('缺少 AI 编辑前的文件快照');
  if (next.media_source !== original.media_source
    || JSON.stringify(next.segments) !== JSON.stringify(original.segments)) {
    throw new Error('AI 修改了应当保留的原始字幕或媒体信息');
  }
  const retained = original.parts.filter((part) => !part.blank).flatMap(partRanges);
  const timedWords = original.parts.flatMap((part) => (part.captions || []).flatMap((cue) => cue.words || []));
  for (const part of next.parts) {
    if (!part.blank && subtractRanges(partRanges(part), retained).length) {
      throw new Error('AI 结果包含原分镜未保留的画面时间');
    }
    const previous = original.parts.find((item) => item.id === part.id);
    if (JSON.stringify(previous) === JSON.stringify(part)) continue;
    if (!Array.isArray(part.captions) || part.text !== part.captions.map((cue) => cue.text).join('\n')) {
      throw new Error('AI 分镜文案与 captions 不一致');
    }
    if (part.blank && (part.text || part.captions.length)) throw new Error('AI 空分镜不能包含字幕');
    for (const cue of part.captions) {
      if (cue.text.trim() && !cue.words?.length
        && timedWords.some((word) => word.start < cue.end && word.end > cue.start)) {
        throw new Error('AI 丢失了已有的逐字时间戳');
      }
      if (cue.words?.some((word) => word.text !== cue.text.slice(word.from, word.to))) {
        throw new Error('AI 逐字文案与字符偏移不一致');
      }
    }
  }
};

export const AI_ASSIST_DEFAULT_INSTRUCTION = '每个分镜不超过12个字；去掉嗯、啊等气口；按完整语义重新分镜；缩短过长停顿，保留自然换气。';

export const buildStoryboardAiPrompt = (file, instruction = '') => `请编辑当前字幕分镜文件。你必须通过分镜编辑 MCP 工具修改，不允许直接读写这个 JSON 文件，不允许用 Write/Edit/Bash 工具改它。

目标分镜文件（唯一允许修改，绝对路径）：${JSON.stringify(file.draftPath)}
用户要求：${instruction.trim() || AI_ASSIST_DEFAULT_INSTRUCTION}

## 数据模型（先读懂再动手）

这是一个**非线性剪辑模型**，两条独立时间线：

- **source（源素材）**：原始视频 media_source 的时间线。JSON 顶层 segments[] 是 ASR 识别到"有说话"的区间（不代表源视频物理时长，源视频里的呼吸/静音仍是可用素材，只是没被识别成字幕）。**segments 在整个编辑过程里主要只读**——唯一例外是 adjust_part_bounds 把 part 的源边界撑到所有 segments 覆盖之外时，工具会自动向 segments[] 追加一条空文本 placeholder segment 覆盖新增区间；已有 segments 永不被改写或删除。
- **target（目标轨道）**：最终视频拼接后的时间线。由 parts[] 数组顺序决定：parts[0] 从 target 0 开始，parts[1] 紧接 parts[0] 播完的时刻，依次拼接。**target 顺序完全由 parts[] 数组顺序决定**，可以打乱、可以复用同一段源。

每个 part 表示"从 source 抠一段素材，放到 target 的某处"，有两组字段：

- source_timerange = { start_ms, end_ms, ranges }：**从原始视频截取哪一段**。start_ms/end_ms 是源素材的绝对毫秒时间（如 ASR 识别出的 [10000, 13000)）。当一个 part 被 delete_range 挖掉中间气口后，ranges 会有多段（比如 [[10000,10500),[10800,13000)]），source_timerange.start/end 是外框。
- target_timerange = { start_ms, end_ms, duration_ms }：**这个 part 播放时在最终视频轨道的位置**。是从 parts 数组顺序累加派生出来的，duration_ms = source_timerange 各段之和。你**读取时**可以直接看这个字段判断"这段字幕在最终视频的第几秒到第几秒"。

关键性质（重要！很多"看起来是 bug"的行为其实是这个模型的自然结果）：

1. **多个 part 可以引用同一段 source_timerange** —— duplicate_part 就是这么做的：把同一段素材放到 target 的两个位置。所以 adjust_part_bounds 不会检查跨 part 的源时间"重叠"，那不是重叠。
2. **调整 part.source_timerange 不会撞车** —— target 是拼接得到的，扩大 B 的 source 截取只会让后续 part 在 target 上顺延；不存在 target 层面的冲突。
3. **允许把 part 的 source_timerange 延伸到 segments 外** —— ASR 只识别到 [10s,13s]，但源视频里 9.5s、13.5s 的呼吸/字头字尾是真实素材。adjust_part_bounds 不会用 segments 卡边界。
4. **captions / words 的 start/end 是 source 时间**，播放时前端会自动换算到 target。你调工具时也用 source 时间。
5. **删除 part 不留 target 空隙** —— delete_parts 是把 part 从数组里拿掉，target 上后续 part 自动上移。想留空档要用 insert_blank_part。

所有工具的时间参数（split_at.value 的 source_time_ms、delete_range 的 start_ms/end_ms、adjust_part_bounds 的 delta / absolute）都用 **source 时间**。target 时间只用于"读懂现状"。

可用的 MCP 工具（全部属于 storyboard-editor 服务器）：
- mcp__vectcut__storyboard-editor__inspect_storyboard：只读。返回每个 part 的 id / label / source_index / blank / source_timerange / target_timerange / text / char_count / captions（含 words 可选）。**每次动手前必须先调这个工具拿到最新 part 列表**，不要凭记忆。**Token 预算重要**：一个 3 分钟视频的分镜全量 JSON 可能有 10+ MB。所以**默认应该只看要改的那个 part 前后各 5 个邻居**——传参 around_part_id="要修改的 part id"（可选 neighbor_radius，默认 5，返回中心+前后各 5 共最多 11 个 part）。仅在首次做全片规划时才用无参形式获取全量。也支持 part_ids 明确列出想看的 id 集。返回结构里 meta.window.truncated=true 表示已裁剪为窗口，不是全片。
- mcp__vectcut__storyboard-editor__update_part_text：只改一个 part 的显示文案（不改 part.start/end、不改 ranges）。用途：修错别字（如"区里"→"去市里"）、去掉气口字符（如"你嗯好"→"你好"）等**不想改总时长**的场景。**新旧文本字数可以不同**——若该 part 有逐字时间戳，工具会自动按新字符数把 caption 时长均匀重分（一字一 word）。若你希望连时间一起改，请用 delete_range 或 split_part。
- mcp__vectcut__storyboard-editor__split_part：把一个 part 拆成两个。支持 split_at.type='source_time_ms'（源媒体绝对毫秒时间）或 'char_index'（part.text 的字符下标，UTF-16 code point 数量）。适用于"每个分镜不超过 N 字"或"按完整语义重新分镜"。
- mcp__vectcut__storyboard-editor__merge_parts：将 2 个及以上**当前轨道相邻**的非空 part 合并成一个。传入 part_ids 数组，按轨道顺序。禁止跨越空镜合并。
- mcp__vectcut__storyboard-editor__delete_parts：整段删除一个或多个 part。传入 part_ids 数组，直接从分镜里移除。
- mcp__vectcut__storyboard-editor__delete_range：删除**目标轨道（target 时间线）**上一段区间 [start_target_ms, end_target_ms)，**可以横跨多个 part**。用于剔除"嗯/啊/呃"等气口、缩短过长停顿、或"一刀切掉视频里第 5–8 秒这段"。参数：range = { start_target_ms, end_target_ms }（目标时间线毫秒，0 <= start < end；end 超过总时长会被 clamp）。工具内部把 target 区间映射到相交 part 的源时间上做裁剪：**单 part 中间挖洞会拆成 2 个独立 part**（左 part 保留原 id，右 part 分配 '<原 id>-cut-N'，target 上首尾相接、source 各自独立）；只留左侧 / 只留右侧 / 整段被吃掉分别对应"收尾"、"推头"、"删除该 part"。跨 part 的开头/结尾 part 按上述规则处理，中间被完全覆盖的 part 直接删除。target 后续 part 自动前移补位；总时长减少 = 删除的 target 区间长度。
- mcp__vectcut__storyboard-editor__duplicate_part：复制某个 part 一份（含 ranges/captions/words，源时间完全一致），并插到轨道上的指定位置。用途：抽取"高光片段"复制放到开头、复述精彩句子等。参数 part_id 指定源分镜；insert_at 决定新分镜落点，type 支持 'start' | 'end' | 'index'(配 value) | 'before'(配 part_id) | 'after'(配 part_id)。可选 text 字段改写新分镜文案（按 \\n 切分行数必须等于原 captions 数）。注意复制会造成轨道上两个 part 引用同一段源时间，属于允许行为。
- mcp__vectcut__storyboard-editor__move_part：把某个 part 原地搬到轨道上另一个位置（不复制、不改内容）。参数 part_id 指定源分镜；insert_at 同 duplicate_part。目标位置与当前位置相同会报错。用途：纯粹调整播放顺序，例如把高光片段前置到开头。
- mcp__vectcut__storyboard-editor__clear_part_text：清空某个 part 的字幕文字（text 置空、captions=[]），但保留其 start/end/ranges/画面时间。用途：只想保留画面、不显示字幕（例如作为"纯画面镜头"）。**只影响该 part**，不改变时长，也不影响相邻 part。
- mcp__vectcut__storyboard-editor__insert_blank_part：在轨道上插入一个新的空分镜（blank=true，无画面、无字幕、只占位一段时长）。参数：duration_ms（正整数毫秒）+ insert_at（结构同 duplicate_part）。用途：在两个片段之间插入停顿/留白。空分镜播放时不产生画面，注意与 clear_part_text 区分（clear_part_text 保留画面只清字幕，insert_blank_part 是纯占位）。
- mcp__vectcut__storyboard-editor__adjust_part_bounds：微调分镜的开始/结束时间（源时间毫秒）。二选一参数：
    · delta：{ start_delta_ms?, end_delta_ms? } 相对偏移。正值向后，负值向前。**"前后各延长 200ms"→{ start_delta_ms:-200, end_delta_ms:200 }**；"结尾收进来 100ms"→{ end_delta_ms:-100 }。
    · absolute：{ start_ms?, end_ms? } 绝对源时间。
  用于"字幕切太突兀，前后各延长 0.2 秒"或"气口切了一半，尾部收 0.1 秒"，也用于"放大 / 缩小某个分镜的源覆盖"。工具内部会同步调整 ranges/captions/words。边界限制：新 start 必须 ≥ 0、new_end > new_start；**不会**用 ASR segments 卡边界（segments 只代表识别到的说话区间，不代表源媒体真实时长；允许把 part 延到 ASR 未覆盖的呼吸/字头字尾）；**也不会检查与其他 part 的源时间重叠**——part.start/end/ranges 记录的是"从原始视频哪一段截取"，多个 part 引用同一段源时间是合法的（duplicate_part 就是这样工作的），轨道播放顺序由 parts 数组顺序决定，扩大某个 part 的截取范围只会让后续 part 在轨道上顺延，不会真正撞车。**唯一会写 document.segments 的工具**：如果新的源边界越出所有 segments 覆盖，工具会自动向 segments[] 追加一条空文本 placeholder segment（text=''、新 sourceIndex）刚好覆盖新增区间；已有 segments 永不被改写或删除。
- mcp__vectcut__storyboard-editor__apply_operations：**批处理入口，多步编辑时优先用它**。一次调用里按顺序原子执行一组 op（op[i] 看到的是 op[i-1] 应用完的 parts / segments 状态），任一步失败整批回滚——文件绝不留半成品；成功时**只写盘一次**。支持的 op type 只有这 6 个：update_part_text / split_part / merge_parts / delete_parts / delete_range / adjust_part_bounds（duplicate_part / move_part / clear_part_text / insert_blank_part 不在批处理白名单里，也不允许嵌套 apply_operations）。参数：operations: [{ type, ...对应 op 的原始字段 }]（≥1 项）。示例：[{type:'delete_parts', part_ids:['p3']}, {type:'adjust_part_bounds', part_id:'p2', delta:{end_delta_ms:-200}}, {type:'update_part_text', part_id:'p1', text:'新文案'}]。**顺序建议**：为让引用的 part_id 稳定，从后往前操作、或先 delete 再 split；split_part 里 next_id 产生的新 part 可以被后续 op 立即引用。**什么时候用**：一次响应里想做 ≥2 步 update_part_text / split_part / merge_parts / delete_parts / delete_range / adjust_part_bounds 组合时，用 apply_operations 打包成一次调用（原子 + 一次写盘，比串行 6 次 tool call 快得多、也更安全）；只做 1 步、或涉及 duplicate/move/clear/insert_blank 时才用对应的 single-op 工具。

强制流程：
1. 先调用 inspect_storyboard 拿到 { parts: [...] }，识别每个 part 的 id、char_count、duration_ms、text、start、end；**同时把整段视频当成一个整体来看**：注意首个 part 的 start 相对源 segment 起点是否有留白、末个 part 的 end 与源 segment 尾部之间是否有空隙、相邻两个 part 之间（前一个 end 与后一个 start）是否有跨 part 停顿。对比用户要求列出所有**需要修改的操作点**。
2. **一定要按 part 在轨道中的顺序，从最前面（sourceIndex/label 最小、start 最小）到最后面依次执行**。原因：delete_parts / delete_range / split_part / merge_parts / insert_blank_part / adjust_part_bounds 会改变后续 part 的 id、label 编号甚至存在性，如果先动后面再动前面，前面的定位信息可能失效；从前往后做，前面的操作不会影响你已经拿到的后面 part 的定位。
3. **严格串行 + 做一步看一下**（这是最重要的规则，违反必错）：
   - **禁止并行**：所有编辑工具（update_part_text / split_part / merge_parts / delete_parts / delete_range / duplicate_part / move_part / clear_part_text / insert_blank_part / adjust_part_bounds / apply_operations）都在写同一个 storyboard JSON 文件，任何两个及以上工具调用被塞进"同一次响应的并行 tool_use"里都会互相覆盖、破坏时间线，属于**必错行为**。一次响应里**最多只能有一个**编辑工具调用（inspect_storyboard 也不要和编辑工具打包并行）。
   - **多步编辑优先走 apply_operations**：如果你从 inspect 结果里一次性想清楚了要做的 ≥2 步 update_part_text / split_part / merge_parts / delete_parts / delete_range / adjust_part_bounds 组合，请**把它们打进一个 apply_operations 调用里**——它内部会顺序应用、原子回滚、只写盘一次，等价于"串行 N 次单工具"但更快、更安全。这不违反"串行"原则——apply_operations 本身仍是**一次**tool_use。
   - **禁止批量流水（对 single-op 工具）**：如果你**没有**用 apply_operations 而是逐个调 single-op 工具，则**每做完一步编辑都必须紧接着调一次 inspect_storyboard 拿到最新 parts 后再决定下一步**——因为绝大多数编辑（split/merge/delete/delete_range/duplicate/move/insert_blank/adjust_bounds）都会改变 part 的 id、label、start/end、甚至存在性，凭上一轮的记忆做下一步等于闭着眼睛开刀，会把时间线搞乱。**每步 inspect 都应传 around_part_id=刚刚改动/接下来要改动的 part id 只看邻居窗口**，不要重复拉全量。
   - **唯一豁免**：只有 update_part_text 和 clear_part_text 完全不动时间线和结构，做完可以不重新 inspect；但**只要涉及时间/结构**，就"做一步 → inspect → 再做下一步"，不要为了省 tokens 跳过 inspect。
   - 反面示例（禁止）：一次响应里同时调 4 个 adjust_part_bounds；上一步 split 后没 inspect 就用旧 part_id 继续 delete_range；把 6 个操作拼成一段"批量任务清单"一口气发出。
   - 正面示例（apply_operations）：一次调用 apply_operations，operations 数组里 6 个 op 顺序排列（比如"先删 p3、再 split p2、再改 p2-split-1 的文本、再 adjust p1 边界"），一次搞定。
   - 正面示例（单工具串行）：调 adjust_part_bounds 调整 p3 → 等返回 → 调 inspect_storyboard → 看到 p3 边界确实变了、后续 p4 还在原位 → 再决定下一步。
4. 只使用上面的 12 个工具，**不要输出编辑后的 JSON、不要 Write、不要 Edit**、不要调用 Bash 去改文件。每次工具调用都要传绝对路径 storyboard_path=${JSON.stringify(file.draftPath)}。
5. 场景对应：拆句用 split_part；剔除口误/气口/停顿用 delete_range；纯改字面文案（不改总时长）用 update_part_text；合并短镜用 merge_parts；整段废镜用 delete_parts；把某段抽出来复制到别处（如高光前置）用 duplicate_part；仅调整播放顺序用 move_part；只保留画面、不要字幕用 clear_part_text；插入停顿/留白占位（无画面无字幕）用 insert_blank_part；字幕切太突兀想前后各延长/收进来一点用 adjust_part_bounds；一次要做 ≥2 步且都属于 update_part_text / split_part / merge_parts / delete_parts / delete_range / adjust_part_bounds 组合的用 apply_operations 打包。禁止均分句子时长伪造字时间——工具内部会自动处理时间与逐字偏移。
6. 全部完成后简明报告修改点，例如"拆分了 partN_2、删除了 partN_5 的 [12300, 12800) 气口、把 partN_7 复制到开头、partN_3 起点前移 200ms"。若无需修改则明确说明；若某一步失败请报告失败原因，不要伪称成功，也不要用 Write 兜底覆盖。

整体视角（重要）：
- 把整段视频当作一个整体分析，而不是一个个 part 孤立看。**"删停顿/缩短停顿"这类需求必须覆盖三种停顿**：
    a. 句首停顿：第一个 part.start 相对源 segment 起点（或用户可听到的说话起点）之间的空白；
    b. 句尾停顿：最后一个 part.end 与源 segment 尾部（或说话结束点）之间的空白；
    c. 分镜之间的停顿：相邻两 part 的 (前一个.end, 后一个.start) 之间的空隙——这段空隙不属于任何 part 的内容，但仍占据播放时长。
- 处理句首/句尾停顿：用 adjust_part_bounds 收进首/末 part 的边界（例如首 part start_delta_ms 正值向后收，末 part end_delta_ms 负值向前收）。
- 处理分镜之间的停顿：优先通过 adjust_part_bounds 微调相邻边界抹平间隙；如需保留局部换气则明确保留 0.1–0.3 秒即可。
- 不要只盯着 part 内部两字之间的气口，忽略了 part 与 part 之间、以及全片首尾的静音空白。

约束：
- 所有时间是源媒体绝对时间，单位毫秒，不是拼接后的轨道时间。
- 不确定是否应删除的内容保留；只处理能明确判断的地方。
- 不修改源视频、srt 文件或其他文件；不调用字幕识别服务。
`;
