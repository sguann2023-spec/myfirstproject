export const SUBTITLE_RECOGNITION_TOOL = 'mcp__vectcut__subtitle-recognition__submit_subtitle_recognition_task';

export const normalizeSubtitleRecognitionRequest = (request) => {
  const url = String(request?.url || '').trim();
  if (!/^(https?:\/\/|file:\/\/|\/|[a-z]:[\\/])/i.test(url)) throw new Error('请添加有效的音频或视频');
  const effectMode = request?.effectMode || 'nlp';
  if (!['basic', 'nlp'].includes(effectMode)) throw new Error('字幕工具仅支持 basic 或 nlp 档位');
  const maxSentenceLength = request?.maxSentenceLength ?? 12;
  if (effectMode === 'nlp' && (!Number.isInteger(maxSentenceLength) || maxSentenceLength < 3 || maxSentenceLength > 80)) {
    throw new Error('分句字数必须是 3～80 的整数');
  }
  const content = String(request?.content || '').trim();
  return { url, effectMode, ...(effectMode === 'nlp' ? { maxSentenceLength } : {}), ...(content ? { content } : {}) };
};

export const buildSubtitleRecognitionBlocks = ({
  assistantMessageId, requestId, request, modelId = '', status = 'processing',
  response = null, assistantText = '', createdAt = new Date().toISOString(),
}) => {
  const toolId = `subtitle_recognition_request_${requestId}`;
  return [{
    id: `${assistantMessageId}-subtitle-tool`, messageId: assistantMessageId,
    type: 'tool', createdAt, updatedAt: createdAt, status, model: modelId,
    toolId, toolName: SUBTITLE_RECOGNITION_TOOL, arguments: request, content: response,
    metadata: { rawMcpToolResponse: {
      id: toolId,
      tool: { id: SUBTITLE_RECOGNITION_TOOL, name: SUBTITLE_RECOGNITION_TOOL, serverName: 'vectcut', serverId: 'vectcut', type: 'mcp' },
      arguments: request, status: status === 'processing' ? 'pending' : status === 'error' ? 'error' : 'done',
      response, responseRaw: response, truncated: false,
    } },
  }, ...(assistantText ? [{
    id: `${assistantMessageId}-subtitle-text`, messageId: assistantMessageId,
    type: 'main_text', createdAt, updatedAt: createdAt, status, modelId, content: assistantText,
  }] : [])];
};

const timestamp = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '--';
  const ms = Math.round(value);
  const pad = (n, length = 2) => String(n).padStart(length, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
const tableText = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/\\/g, '&#92;').replace(/\|/g, '&#124;')
  .replace(/`/g, '&#96;').replace(/[*_]/g, (char) => `&#${char.charCodeAt(0)};`).replace(/\r?\n/g, '<br>');

export const parseSubtitleRecognitionResult = (result, request) => {
  const raw = (result?.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  let response;
  try { response = JSON.parse(raw); } catch { response = { error: raw || '字幕识别返回内容为空' }; }
  if (result?.isError || response.error || response.success === false) {
    const error = new Error(response.error || '字幕识别失败');
    error.toolResponse = { ...response, isError: true };
    throw error;
  }
  const details = response.result;
  if (!Array.isArray(details?.segments)) {
    const error = new Error('字幕识别结果缺少时间轴');
    error.toolResponse = { ...response, isError: true };
    throw error;
  }
  const segments = details.segments;
  const text = String(details.content || response.content || segments.map((segment) => segment.text || '').join(''));
  const fence = '`'.repeat(Math.max(3, ...([...text.matchAll(/`+/g)].map((match) => match[0].length + 1))));
  const split = request.effectMode === 'basic' ? '不分句' : `使用 ${request.maxSentenceLength} 字分句`;
  const assistantText = [
    `字幕识别完成！以下是识别结果，共 ${segments.length} 条字幕，${split}：`,
    ['| # | 时间轴 | 字幕文本 |', '| --- | --- | --- |',
      ...segments.map((segment, index) => `| ${index + 1} | ${timestamp(segment.start)} → ${timestamp(segment.end)} | ${tableText(segment.text)} |`),
    ].join('\n'),
    `完整文本：\n${fence}text\n${text}\n${fence}`,
    response.artifact?.relative_path
      ? `详细结果已保存至工作区文件：${tableText(response.artifact.relative_path)}` : '',
  ].filter(Boolean).join('\n\n');
  // Keep the standard tool summary compact; the full result remains in the workspace artifact.
  const { result: _details, ...summary } = response;
  return { response: summary, assistantText };
};
