import { alignWords, clipCaption, collectWords } from './wordTiming';

export const DRAFT_VERSION = 1;
const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
const basename = (value) => value.split('/').pop();

export const listRecognitionFiles = async (workspacePath, api) => {
  const root = normalizePath(workspacePath);
  if (!root) return [];
  if (!api?.file?.listDirectory) throw new Error('当前环境无法读取工作空间');
  const entries = await api.file.listDirectory(root, {
    recursive: true, maxDepth: 10, includeHidden: false,
    includeFiles: true, includeDirectories: false, maxEntries: 20000,
  });
  if (!Array.isArray(entries)) throw new Error('工作空间文件列表读取失败');
  if (entries.length >= 20000) throw new Error('匹配文件过多，请缩小工作空间范围后重试');
  const paths = [...new Set(entries.filter((entry) => typeof entry === 'string').map((entry) => {
    const path = normalizePath(entry);
    return path.startsWith('/') || /^[a-z]:\//i.test(path) ? path : `${root}/${path}`;
  }))].filter((path) => path.startsWith(`${root}/`) && !path.split('/').includes('..'));
  return paths.filter((path) => /^sre_.*\.json$/i.test(basename(path))).sort().map((path) => {
    const name = basename(path);
    const directory = path.slice(0, -name.length);
    const draftPath = `${directory}${name.replace(/^sre_/i, 'part_')}`;
    const legacyPath = `${directory}part_split_${name}`;
    return { path, name, relativePath: path.slice(root.length + 1), draftPath,
      hasDraft: paths.includes(draftPath), legacyPath: paths.includes(legacyPath) ? legacyPath : null };
  });
};

export const mediaPreviewUrl = (value) => {
  const source = String(value || '').trim();
  if (/^https?:\/\//i.test(source)) return source;
  if (/^file:\/\//i.test(source)) return source;
  const path = source.replace(/\\/g, '/');
  if (!path.startsWith('/') && !/^[a-z]:\//i.test(path)) return '';
  const encoded = path.split('/').map((part, index) => (
    index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)
  )).join('/');
  return `file://${path.startsWith('/') ? '' : '/'}${encoded}`;
};

export const parseRecognition = (content) => {
  let data;
  try { data = JSON.parse(String(content).replace(/^\uFEFF/, '')); }
  catch { throw new Error('字幕识别结果不是有效的 JSON 文件'); }
  if (!data || data.success === false || data.error || ['failed', 'error'].includes(data.status)) {
    throw new Error('该字幕识别任务未成功，请选择其他结果');
  }
  if (!Array.isArray(data.result?.segments) || !data.result.segments.length) {
    throw new Error('字幕识别结果中没有可用的字幕时间轴');
  }
  const rawWords = collectWords(data.result);
  const segments = data.result.segments.map((segment, index) => {
    if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
      || segment.start < 0 || segment.end <= segment.start || typeof segment.text !== 'string') {
      throw new Error(`第 ${index + 1} 条字幕的时间轴或文本无效`);
    }
    const cue = { start: segment.start, end: segment.end, text: segment.text, sourceIndex: index };
    const words = alignWords(cue, segment.words?.length ? collectWords(segment) : rawWords);
    return words.length ? { ...cue, words } : cue;
  }).sort((a, b) => a.start - b.start);
  const sources = [
    data.source_summary?.[0]?.original_input, data.url,
    data.source_summary?.[0]?.submitted_url, data.recognition_url,
  ].map(mediaPreviewUrl).filter(Boolean);
  return { segments, mediaSource: sources[0] || '', fallbackSource: sources.find((source) => source !== sources[0]) || '' };
};

export const createParts = (segments) => segments.map((segment, index) => ({
  ...segment, id: `subtitle-${segment.sourceIndex}`, blank: false,
  end: Math.max(segment.end, segments[index + 1]?.start ?? segment.end),
  captions: [{ start: segment.start, end: segment.end, text: segment.text,
    ...(segment.words?.length ? { words: segment.words } : {}) }],
}));

export const activeParts = (parts) => parts.filter((part) => !part.deleted);
export const partRanges = (part) => part.ranges || [{ start: part.start, end: part.end }];
export const partDuration = (part) => partRanges(part).reduce((sum, range) => sum + range.end - range.start, 0);

// A merged shot can contain disjoint source ranges after a deletion.
export const partPoint = (part, offset) => {
  const ranges = partRanges(part);
  const position = Math.max(0, Math.min(offset, partDuration(part)));
  let start = 0;
  for (const [index, range] of ranges.entries()) {
    const end = start + range.end - range.start;
    if (position < end || index === ranges.length - 1) {
      return { range, offsetStart: start, offsetEnd: end, sourceTime: range.start + position - start };
    }
    start = end;
  }
};

export const partOffset = (part, sourceTime) => {
  let offset = 0;
  for (const range of partRanges(part)) {
    if (sourceTime < range.end) return offset + Math.max(0, sourceTime - range.start);
    offset += range.end - range.start;
  }
  return offset;
};

export const canMergeParts = (parts, ids) => {
  parts = activeParts(parts);
  const selected = new Set(ids);
  const indices = parts.flatMap((part, index) => selected.has(part.id) ? [index] : []);
  if (indices.length < 2 || indices.length !== selected.size
    || indices.at(-1) - indices[0] + 1 !== indices.length) return false;
  const group = indices.map((index) => parts[index]);
  return group.every((part, index) => !part.blank && !part.deleted
    && (!index || part.start >= group[index - 1].start));
};

export const mergeParts = (parts, ids) => {
  if (!canMergeParts(parts, ids)) throw new Error('请选择相邻且按源时间顺序排列的非空分镜');
  const selected = new Set(ids);
  const group = parts.filter((part) => selected.has(part.id));
  const first = group[0];
  const ranges = [];
  for (const range of group.flatMap(partRanges)) {
    const previous = ranges.at(-1);
    if (previous && range.start >= previous.start && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else ranges.push({ ...range });
  }
  const merged = {
    ...first,
    end: Math.max(...group.map((part) => part.end)),
    text: group.map((part) => part.text).filter(Boolean).join('\n'),
  };
  delete merged.ranges;
  if (ranges.length > 1) merged.ranges = ranges;
  if (group.some((part) => part.captions)) {
    merged.captions = group.flatMap((part) => part.captions
      || partRanges(part).map((range) => ({ ...range, text: part.text })));
    merged.text = merged.captions.map((cue) => cue.text).join('\n');
  }
  return activeParts(parts).flatMap((part) => part.id === first.id ? [merged] : selected.has(part.id) ? [] : [part]);
};

export const labelParts = (parts) => {
  const counts = new Map();
  return parts.map((part) => {
    const group = part.blank ? 'empty' : `part${part.sourceIndex + 1}`;
    const count = (counts.get(group) || 0) + 1;
    counts.set(group, count);
    return { ...part, label: `${group}_${count}` };
  });
};

export const splitPart = (parts, id, position, nextId) => {
  const part = parts.find((item) => item.id === id);
  if (!part || part.deleted || partDuration(part) < 2) return parts;
  const duration = partDuration(part);
  const requested = Number.isFinite(position) ? partOffset(part, position) : 0;
  const splitOffset = Math.round(requested > 0 && requested < duration ? requested : duration / 2);
  if (splitOffset <= 0 || splitOffset >= duration) return parts;
  const left = [];
  const right = [];
  let cursor = 0;
  for (const range of partRanges(part)) {
    const splitAt = range.start + splitOffset - cursor;
    if (splitAt > range.start) left.push({ start: range.start, end: Math.min(range.end, splitAt) });
    if (splitAt < range.end) right.push({ start: Math.max(range.start, splitAt), end: range.end });
    cursor += range.end - range.start;
  }
  const characters = Array.from(part.text);
  const splitIndex = Math.round(characters.length * splitOffset / duration);
  const withRanges = (ranges, id, text) => {
    const next = { ...part, id, start: ranges[0].start, end: ranges.at(-1).end, text };
    delete next.ranges;
    if (ranges.length > 1) next.ranges = ranges;
    if (part.captions) {
      next.captions = part.captions.flatMap((cue) => ranges.flatMap((range) => {
        const start = Math.max(cue.start, range.start);
        const end = Math.min(cue.end, range.end);
        if (end <= start) return [];
        if (cue.words?.length) {
          const clipped = clipCaption(cue, start, end);
          return clipped ? [clipped] : [];
        }
        const characters = Array.from(cue.text);
        const from = Math.round(characters.length * (start - cue.start) / (cue.end - cue.start));
        const to = Math.round(characters.length * (end - cue.start) / (cue.end - cue.start));
        return [{ start, end, text: characters.slice(from, to).join('') }];
      }));
      next.text = next.captions.map((cue) => cue.text).join('\n');
    }
    return next;
  };
  return parts.flatMap((item) => item.id !== id ? [item] : [
    withRanges(left, id, characters.slice(0, splitIndex).join('')),
    withRanges(right, nextId, characters.slice(splitIndex).join('')),
  ]);
};

export const validateParts = (parts) => {
  if (!Array.isArray(parts)) throw new Error('分镜列表无效');
  const ids = new Set();
  for (const part of parts) {
    if (!part || typeof part.id !== 'string' || !part.id || ids.has(part.id)
      || !Number.isFinite(part.start) || !Number.isFinite(part.end)
      || part.start < 0 || part.end <= part.start || typeof part.text !== 'string'
      || typeof part.blank !== 'boolean' || (part.deleted !== undefined && typeof part.deleted !== 'boolean')
      || !Number.isInteger(part.sourceIndex) || part.sourceIndex < 0) {
      throw new Error('分镜数据无效，请确保结束时间大于开始时间');
    }
    if (part.ranges !== undefined && (part.blank || !Array.isArray(part.ranges) || !part.ranges.length
      || part.ranges.some((range, index) => !range || !Number.isFinite(range.start) || !Number.isFinite(range.end)
        || range.start < part.start || range.end > part.end || range.end <= range.start
        || (index > 0 && range.start < part.ranges[index - 1].end))
      || part.ranges[0].start !== part.start || part.ranges.at(-1).end !== part.end)) {
      throw new Error('分镜源时间范围无效');
    }
    if (part.captions !== undefined && (!Array.isArray(part.captions)
      || part.captions.some((cue) => !cue || typeof cue.text !== 'string'
        || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start
        || !partRanges(part).some((range) => cue.start >= range.start && cue.end <= range.end)))) {
      throw new Error('分镜字幕数据无效');
    }
    for (const cue of part.captions || []) {
      if (cue.words !== undefined && (!Array.isArray(cue.words) || cue.words.some((word, index) => (
        !word || !Number.isFinite(word.start) || !Number.isFinite(word.end)
        || word.start < cue.start || word.end > cue.end || word.end <= word.start
        || !Number.isInteger(word.from) || !Number.isInteger(word.to)
        || word.from < 0 || word.to <= word.from || word.to > cue.text.length
        || (index > 0 && word.from < cue.words[index - 1].to)
      )))) throw new Error('逐字时间戳无效');
    }
    ids.add(part.id);
  }
  return parts;
};

export const loadRecognition = async (file, api) => {
  if (!api?.fs?.read) throw new Error('当前环境无法读取字幕文件');
  const recognition = parseRecognition(await api.fs.read(file.path, 'utf8'));
  let parts = createParts(recognition.segments);
  if (file.hasDraft || file.legacyPath) {
    let saved;
    try { saved = JSON.parse(await api.fs.read(file.hasDraft ? file.draftPath : file.legacyPath, 'utf8')); }
    catch { throw new Error('已保存的分镜文件无法读取，请检查文件后重试'); }
    if (saved?.type !== 'subtitle_storyboard' || saved.version !== DRAFT_VERSION
      || saved.source_file !== file.path || saved.time_unit !== 'ms') {
      throw new Error('已保存的分镜文件格式不兼容，不会覆盖该文件');
    }
    parts = activeParts(validateParts(saved.parts));
  }
  return { ...recognition, parts };
};

export const buildPartsDocument = (file, recognition, parts) => {
  validateParts(parts);
  return {
    type: 'subtitle_storyboard', version: DRAFT_VERSION, time_unit: 'ms',
    source_file: file.path, media_source: recognition.mediaSource,
    updated_at: new Date().toISOString(), segments: recognition.segments,
    parts: labelParts(activeParts(parts)),
  };
};

export const saveParts = async (file, recognition, parts, api) => {
  const payload = buildPartsDocument(file, recognition, parts);
  if (!api?.file?.write) throw new Error('当前环境无法保存分镜');
  await api.file.write(file.draftPath, JSON.stringify(payload, null, 2));
  return file.draftPath;
};

export const formatTime = (milliseconds) => {
  const seconds = Math.max(0, milliseconds || 0) / 1000;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
};
