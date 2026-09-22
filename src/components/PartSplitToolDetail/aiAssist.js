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

export const buildStoryboardAiPrompt = (file, instruction = '') => `请直接编辑当前字幕分镜文件，而不只是给出建议。请在本次对话中使用文件工具完成修改并报告结果。

目标分镜文件（唯一允许修改的文件）：${JSON.stringify(file.draftPath)}
原始字幕识别文件（只读参考）：${JSON.stringify(file.path)}
用户要求：${instruction.trim() || '去掉明显的嗯、啊等无意义气口，按完整语义合理分镜，适度缩短过长停顿，保留自然换气、完整语义和原有叙事顺序。不确定是否应删除的内容保留。'}

执行步骤：
1. 先读取这两个文件。目标文件的当前内容是唯一编辑基线，保留用户已有修改；禁止重新生成全部分镜而恢复已经删除的内容。不要修改源视频、sre 文件或其他文件，不调用字幕识别服务。
2. 所有时间是源媒体绝对时间，单位毫秒，不是拼接后的轨道时间。逐字时间读取 sre 的 result.segments[].words[]，兼容 word/text 和 start_time/end_time（或 start/end、start_ms/end_ms），禁止均分句子时长伪造字时间。仅处理能确定真实时间的内容；没有匹配时间的内容保留。
3. 分镜文档必须保持合法 JSON，顶层 type="subtitle_storyboard"、version=1、time_unit="ms"，source_file 不变；保留 media_source、原始 segments 及其他元数据，只更新 parts 和 updated_at（ISO 时间）。不要输出 Markdown 到文件。
4. 每个 part 必须有唯一非空字符串 id、非负整数 sourceIndex、布尔 blank、字符串 text、有限数字 start/end，且 0 <= start < end。保留未修改 part 的 id，新 part 使用不重复 id。label 按非空 part 的 sourceIndex+1 分组顺序编号为 partN_1、partN_2；空镜为 empty_1 等。parts 数组顺序就是播放顺序，禁止写 deleted 软删除占位。
5. 删除字词或停顿：从当前保留源区间减去精确删除区间，删除点前后生成独立 part；只剩一侧则只保留一侧，两侧都空则移除该 part。多个删除点可以生成多个 part。不要只改 text 而保留本应删除的画面。
6. 合并时按当前轨道相邻顺序操作，不包含 blank。存在被删除的源间隙时必须用 ranges:[{start,end},...] 保存原来保留的区间，不能用首尾一整个区间填回已删除画面。ranges 非空、按源时间排序、不重叠，part.start=首区间.start，part.end=末区间.end。单连续区间省略 ranges；blank 不允许 ranges。不得新增原来未保留的源时间。
7. 每个修改后的非空 part 必须有 captions:[{start,end,text,words:[{start,end,from,to,text}]}]。caption 时间必须完全落在该 part 的一个保留区间内；拆分/删除后同步裁剪 captions，不残留已删字词。part.text 等于 captions 的 text 用换行连接。words 可省略的唯一情况是原本确实无逐字时间；已有逐字时间必须保留。
8. caption.words 的 start/end 是真实毫秒时间，落在所属 caption 内且 end>start；from/to 是该 caption.text 的 UTF-16 字符串偏移，左闭右开，0<=from<to<=text.length，按文字顺序不重叠。文字变化或拆分后重新计算偏移，word.text 应与 caption.text.slice(from,to) 一致。标点可跟随前字。空镜 text=""，captions=[]。
9. 写入前用程序解析并校验以上格式、唯一 id、范围、字幕及逐字偏移；推荐写临时文件校验后原子替换目标文件，避免半写入状态。完成后再读目标文件确认合法。若无需修改，明确说明；若失败明确报告原因，不伪称成功。
`;
