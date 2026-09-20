export const REVERSE_PROMPT_TOOL = 'mcp__vectcut__copylab__derive_copy_prompt';
export const isReversePromptToolName = (name = '') => (
  [REVERSE_PROMPT_TOOL, 'mcp__copylab__derive_copy_prompt', 'derive_copy_prompt'].includes(name)
);

export const getReversePromptAccounting = (output, depth = 0) => {
  if (depth > 6 || output == null) return null;
  if (typeof output === 'string') {
    try { return getReversePromptAccounting(JSON.parse(output), depth + 1); } catch { return null; }
  }
  if (typeof output !== 'object') return null;
  if (output.billing || output.usage) return output;
  for (const nested of [
    output.responseRaw, output.response, output.result, output.output,
    ...(Array.isArray(output.content) ? output.content.map((item) => item.text) : []),
  ]) {
    const accounting = getReversePromptAccounting(nested, depth + 1);
    if (accounting) return accounting;
  }
  return null;
};

export const normalizeReversePromptRequest = (request) => {
  const shareText = String(request?.shareText || '').trim();
  if (!/https?:\/\/[^\s]+/i.test(shareText)) throw new Error('请粘贴包含视频链接的分享文案');
  return { shareText };
};

export const buildReversePromptBlocks = ({
  assistantMessageId,
  requestId,
  request,
  modelId = '',
  status = 'processing',
  response = null,
  assistantText = '',
  createdAt = new Date().toISOString(),
}) => {
  const toolCallId = `reverse_prompt_request_${requestId}`;
  return [{
    id: `${assistantMessageId}-reverse-prompt-tool`,
    messageId: assistantMessageId,
    type: 'tool',
    createdAt,
    updatedAt: createdAt,
    status,
    model: modelId,
    toolId: toolCallId,
    toolName: REVERSE_PROMPT_TOOL,
    arguments: request,
    content: response,
    metadata: {
      rawMcpToolResponse: {
        id: toolCallId,
        tool: { id: REVERSE_PROMPT_TOOL, name: REVERSE_PROMPT_TOOL, serverName: 'vectcut', serverId: 'vectcut', type: 'mcp' },
        arguments: request,
        status: status === 'processing' ? 'pending' : status === 'error' ? 'error' : 'done',
        response,
        responseRaw: response,
        truncated: false,
      },
    },
  }, ...(assistantText ? [{
    id: `${assistantMessageId}-reverse-prompt-text`,
    messageId: assistantMessageId,
    type: 'main_text',
    createdAt,
    updatedAt: createdAt,
    status,
    modelId,
    content: assistantText,
  }] : [])];
};

export const parseReversePromptResult = (result) => {
  const raw = (result?.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n').trim();
  if (result?.isError) {
    let response;
    try { response = JSON.parse(raw); } catch { /* Older tools returned plain text errors. */ }
    const error = new Error(response?.error || raw || '反推提示词失败');
    if (response && typeof response === 'object') error.toolResponse = { ...response, isError: true };
    throw error;
  }
  if (!raw) throw new Error('反推提示词返回内容为空');
  const response = JSON.parse(raw);
  const analysis = response?.analysis;
  const prompt = analysis?.prompt_json;
  const assistantText = typeof prompt?.reusable_prompt === 'string' && prompt.reusable_prompt.trim()
    ? [prompt.summary, prompt.reusable_prompt, prompt.user_prompt_template].filter(Boolean).join('\n\n')
    : String(analysis?.raw_response || '').trim();
  if (!assistantText) throw new Error('未获取到反推提示词');
  return { response, assistantText };
};
