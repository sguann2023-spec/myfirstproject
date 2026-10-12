import { buildReversePromptBlocks } from './reversePrompt';

export const VIDEO_UNDERSTAND_TOOL = 'mcp__vectcut__video-understand__submit_video_detail_task';
export const VIDEO_UNDERSTAND_HINT = '导入本地视频，粘贴视频链接、或者视频的分享链接';

export const buildVideoUnderstandRequest = ({ input = '', uploadedFiles = [] } = {}) => {
  const videos = uploadedFiles.filter((file) => /^video\//i.test(file?.fileType || '')
    || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file?.name || ''));
  const text = String(input || '').trim();
  const links = [...text.matchAll(/https?:\/\/[^\s<>"\]]+/gi)]
    .map((match) => match[0].replace(/[，。；！）)]+$/, ''));
  const paths = /^(file:\/\/|\/|[a-z]:[\\/])/i.test(text) && !links.length ? [text] : [];
  const sources = videos.map((file) => file.sourcePath || file.url || `local-attachment:${file.uid}`);
  return normalizeVideoUnderstandRequest({
    videoUrls: [...new Set([...sources, ...links, ...paths])],
    prompt: paths.length ? '' : text.replace(/https?:\/\/[^\s]+/gi, '').trim(),
  });
};

export const normalizeVideoUnderstandRequest = (request) => {
  const videoUrls = (Array.isArray(request?.videoUrls) ? request.videoUrls : [request?.videoUrl])
    .map((value) => String(value || '').trim()).filter(Boolean);
  if (!videoUrls.length || videoUrls.some((url) => !/^(https?:\/\/|file:\/\/|\/|[a-z]:[\\/]|local-attachment:)/i.test(url))) {
    throw new Error('请添加本地视频或粘贴有效的视频链接');
  }
  return { videoUrls, prompt: String(request?.prompt || '').trim() };
};

export const getVideoUnderstandSendState = (context) => {
  try {
    buildVideoUnderstandRequest(context);
    return { canSend: true, disabledReason: '' };
  } catch (error) {
    return { canSend: false, disabledReason: error.message };
  }
};

export const buildVideoUnderstandBlocks = (options) => {
  const blocks = buildReversePromptBlocks(options);
  const toolId = `video_understand_request_${options.requestId}`;
  return blocks.map((block) => {
    if (block.type !== 'tool') return { ...block, id: `${options.assistantMessageId}-video-understand-text` };
    const raw = block.metadata.rawMcpToolResponse;
    return {
      ...block, id: `${options.assistantMessageId}-video-understand-tool`,
      toolId, toolName: VIDEO_UNDERSTAND_TOOL,
      metadata: { rawMcpToolResponse: {
        ...raw, id: toolId,
        tool: { ...raw.tool, id: VIDEO_UNDERSTAND_TOOL, name: VIDEO_UNDERSTAND_TOOL },
      } },
    };
  });
};

export const parseVideoUnderstandResult = (result) => {
  const raw = (result?.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  let response;
  try { response = JSON.parse(raw); } catch { response = { error: raw || '逐帧拉片返回内容为空' }; }
  if (result?.isError || response.error) {
    const error = new Error(response.error || '逐帧拉片失败');
    error.toolResponse = { ...response, isError: true };
    throw error;
  }
  const files = (Array.isArray(response.result_files) ? response.result_files : [])
    .filter((file) => file?.file_path || file?.relative_path);
  const summaries = Array.isArray(response.video_summaries) ? response.video_summaries
    : (response.videos || []).map((video, index) => ({
      video_index: video.video_index || index + 1,
      title: video.analysis?.title,
      summary: video.analysis?.summary,
    }));
  const count = Number(response.total_video_count) || summaries.length;
  const indexFile = files.find((file) => file.kind === 'result_index');
  const aggregateFile = files.find((file) => file.kind === 'aggregate_result');
  const selectedFiles = [indexFile, aggregateFile].filter(Boolean);
  if (!selectedFiles.length) selectedFiles.push(...files.slice(0, 5));
  const lines = [`已完成 ${count} 个视频的逐帧拉片，完整内容已保存到结果文件。`];
  const shortText = (text, length) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, length);
  for (const video of summaries.slice(0, 5)) {
    lines.push(`视频 ${video.video_index}：${shortText(video.title, 100) || '逐帧拉片'}`,
      shortText(video.summary, 300),
      video.speech_message ? `语音字幕：${shortText(video.speech_message, 150)}` : '');
  }
  if (count > 5) lines.push('其余视频的摘要和完整分析请查看结果文件。');
  for (const file of selectedFiles) {
    lines.push(`${file.kind === 'result_index' ? '文件索引' : file.kind === 'aggregate_result' ? '分析汇总' : '结果文件'}：\`${file.file_path || file.relative_path}\``);
  }
  if (response.artifact?.file_path) lines.push(`结构化结果：\`${response.artifact.file_path}\``);
  if (!selectedFiles.length && !response.artifact?.file_path) {
    const error = new Error('未获取到逐帧拉片结果');
    error.toolResponse = { ...response, isError: true };
    throw error;
  }
  const { videos: _videos, ...summary } = response;
  return { response: summary, assistantText: lines.filter(Boolean).join('\n\n') };
};
