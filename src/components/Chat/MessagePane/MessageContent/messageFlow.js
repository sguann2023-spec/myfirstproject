const serializeStructuredValue = (value) => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const parseStructuredValue = (value) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return '';
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
};

const normalizeToolResponseStatus = (status = '') => {
  const s = String(status || '').toLowerCase();
  if (!s) return 'done';
  if (s === 'running' || s === 'streaming' || s === 'invoking') return 'streaming';
  if (s === 'failed') return 'error';
  return s;
};

const normalizeBlockStatusFromTool = (status = '') => {
  const s = String(status || '').toLowerCase();
  if (s === 'error' || s === 'failed') return 'error';
  if (s === 'running' || s === 'streaming' || s === 'invoking' || s === 'pending') return 'processing';
  return 'success';
};

const buildToolFenceBlock = (tool) => {
  const payload = {
    name: String(tool?.name || 'tool'),
    args: String(tool?.args || ''),
    result: String(tool?.result || ''),
    status: String(tool?.status || 'done')
  };
  return `\`\`\`tool\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
};

const buildAssistantDisplayContent = ({ text = '', reasoning = '', tools = [] } = {}) => {
  const main = String(text || '').trim();
  const think = String(reasoning || '').trim();
  const toolBlocks = Array.isArray(tools) && tools.length > 0
    ? tools.map((item) => buildToolFenceBlock(item)).join('\n\n')
    : '';
  const segments = [];
  if (think) segments.push(`<think>\n${think}\n</think>`);
  if (main) segments.push(main);
  if (toolBlocks) segments.push(toolBlocks);
  return segments.join('\n\n').trim();
};

const mergeStreamingAccumulated = (previousValue = '', accumulatedValue = '', deltaValue = '') => {
  const previous = String(previousValue || '');
  const accumulated = String(accumulatedValue || '');
  const delta = String(deltaValue || '');

  if (accumulated) return accumulated;
  if (!delta) return previous;
  if (!previous) return delta;
  if (delta === previous) return previous;
  if (delta.startsWith(previous)) return delta;
  if (previous.startsWith(delta)) return previous;
  if (previous.includes(delta)) return previous;
  if (delta.includes(previous)) return delta;
  if (previous.endsWith(delta)) return previous;

  const maxOverlap = Math.min(previous.length, delta.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previous.slice(-overlap) === delta.slice(0, overlap)) {
      return `${previous}${delta.slice(overlap)}`;
    }
  }

  return `${previous}${delta}`;
};

const appendFlowSegment = (segments = [], kind = 'text', accumulatedValue = '', deltaValue = '') => {
  const list = Array.isArray(segments) ? [...segments] : [];
  const segmentKind = kind === 'thinking' ? 'thinking' : 'text';
  const last = list[list.length - 1];
  const isSameKind = last && last.kind === segmentKind;
  const baseContent = isSameKind ? String(last.content || '') : '';
  const merged = isSameKind
    ? mergeStreamingAccumulated(baseContent, accumulatedValue, deltaValue)
    : mergeStreamingAccumulated(baseContent, '', deltaValue || accumulatedValue);

  if (!merged.trim()) return list;
  if (isSameKind) {
    last.content = merged;
    return list;
  }
  list.push({ kind: segmentKind, content: merged });
  return list;
};

const appendToolFlowSegment = (segments = [], toolCallId = '') => {
  const list = Array.isArray(segments) ? [...segments] : [];
  const id = String(toolCallId || '').trim();
  if (!id) return list;
  if (list.some((item) => item?.kind === 'tool' && String(item?.toolCallId || '') === id)) return list;
  list.push({ kind: 'tool', toolCallId: id });
  return list;
};

const getFlowCombinedContent = (segments = [], kind = 'text') => (
  (Array.isArray(segments) ? segments : [])
    .filter((item) => item?.kind === kind)
    .map((item) => String(item?.content || '').trim())
    .filter(Boolean)
    .join('\n\n')
);

const buildAssistantDisplayContentFromFlow = ({ segments = [], tools = [] } = {}) => {
  const normalizedSegments = Array.isArray(segments) ? segments : [];
  const orderedTools = Array.isArray(tools) ? tools : [];
  const toolById = new Map(
    orderedTools
      .map((item) => [String(item?.id || ''), item])
      .filter(([id]) => Boolean(id))
  );
  const usedToolIds = new Set();
  const pieces = normalizedSegments
    .map((segment) => {
      const kind = segment?.kind === 'thinking'
        ? 'thinking'
        : (segment?.kind === 'tool' ? 'tool' : 'text');
      const content = String(segment?.content || '').trim();
      if (kind === 'tool') {
        const id = String(segment?.toolCallId || '').trim();
        if (!id) return '';
        const tool = toolById.get(id);
        if (!tool) return '';
        usedToolIds.add(id);
        return buildToolFenceBlock(tool);
      }
      if (!content) return '';
      return kind === 'thinking' ? `<think>\n${content}\n</think>` : content;
    })
    .filter(Boolean);
  const remainingTools = orderedTools.filter((tool) => !usedToolIds.has(String(tool?.id || '')));
  if (remainingTools.length > 0) {
    pieces.push(remainingTools.map((item) => buildToolFenceBlock(item)).join('\n\n'));
  }
  return pieces.join('\n\n').trim();
};

const buildStreamAssistantBlocks = ({ assistantMessageId, pendingState }) => {
  const messageId = String(assistantMessageId || '');
  if (!messageId) return [];
  const nowIso = new Date().toISOString();
  const blocks = [];
  const flowSegments = Array.isArray(pendingState?.flowSegments) ? pendingState.flowSegments : [];
  const reasoningText = String(pendingState?.reasoning || '').trim();
  const mainText = String(pendingState?.accumulated || '').trim();
  const tools = Object.values(pendingState?.toolMap || {});
  const renderedToolIds = new Set();

  const pushToolBlock = (tool) => {
    const toolCallId = String(tool?.id || '');
    if (!toolCallId) return false;
    const toolName = String(tool?.name || 'tool');
    const args = parseStructuredValue(tool?.args);
    const response = parseStructuredValue(tool?.result);
    const toolStatus = normalizeToolResponseStatus(tool?.status);
    blocks.push({
      id: `tool-${toolCallId}`,
      messageId,
      type: 'tool',
      createdAt: nowIso,
      status: normalizeBlockStatusFromTool(tool?.status),
      toolId: toolCallId,
      toolName,
      content: serializeStructuredValue(response),
      metadata: {
        rawMcpToolResponse: {
          id: toolCallId,
          tool: {
            id: toolName,
            name: toolName,
            description: '',
            type: 'builtin'
          },
          arguments: args,
          status: toolStatus,
          response,
          toolCallId
        }
      }
    });
    renderedToolIds.add(toolCallId);
    return true;
  };

  if (flowSegments.length > 0) {
    flowSegments.forEach((segment, index) => {
      const kind = segment?.kind === 'thinking'
        ? 'thinking'
        : (segment?.kind === 'tool' ? 'tool' : 'text');
      if (kind === 'tool') {
        const toolCallId = String(segment?.toolCallId || '').trim();
        const tool = tools.find((item) => String(item?.id || '') === toolCallId);
        if (tool) pushToolBlock(tool);
        return;
      }
      const content = String(segment?.content || '').trim();
      if (!content) return;
      if (kind === 'thinking') {
        blocks.push({
          id: `${messageId}-thinking-${index}`,
          messageId,
          type: 'thinking',
          createdAt: nowIso,
          status: 'success',
          content
        });
        return;
      }
      blocks.push({
        id: `${messageId}-main-${index}`,
        messageId,
        type: 'main_text',
        createdAt: nowIso,
        status: 'success',
        content
      });
    });
  } else if (reasoningText) {
    blocks.push({
      id: `${messageId}-thinking`,
      messageId,
      type: 'thinking',
      createdAt: nowIso,
      status: 'success',
      content: reasoningText
    });
  }

  if (flowSegments.length === 0 && mainText && tools.length > 0) {
    const interleavedTools = [...tools].sort((a, b) => {
      const aResponseOrder = Number(a?.responseOrder);
      const bResponseOrder = Number(b?.responseOrder);
      const hasAResponseOrder = Number.isFinite(aResponseOrder);
      const hasBResponseOrder = Number.isFinite(bResponseOrder);
      if (hasAResponseOrder && hasBResponseOrder && aResponseOrder !== bResponseOrder) return aResponseOrder - bResponseOrder;
      if (hasAResponseOrder !== hasBResponseOrder) return hasAResponseOrder ? -1 : 1;

      const aOffset = Number(a?.textOffset);
      const bOffset = Number(b?.textOffset);
      const hasAOffset = Number.isFinite(aOffset);
      const hasBOffset = Number.isFinite(bOffset);
      if (hasAOffset && hasBOffset && aOffset !== bOffset) return aOffset - bOffset;
      if (hasAOffset !== hasBOffset) return hasAOffset ? -1 : 1;

      return Number(a?.order || 0) - Number(b?.order || 0);
    });

    let cursor = 0;
    let segmentIndex = 0;
    interleavedTools.forEach((tool) => {
      const rawOffset = Number(tool?.textOffset);
      const boundedOffset = Number.isFinite(rawOffset)
        ? Math.max(cursor, Math.min(mainText.length, rawOffset))
        : cursor;
      const textSegment = mainText.slice(cursor, boundedOffset).trim();
      if (textSegment) {
        blocks.push({
          id: `${messageId}-main-${segmentIndex}`,
          messageId,
          type: 'main_text',
          createdAt: nowIso,
          status: 'success',
          content: textSegment
        });
        segmentIndex += 1;
      }
      pushToolBlock(tool);
      cursor = boundedOffset;
    });

    const tailSegment = mainText.slice(cursor).trim();
    if (tailSegment) {
      blocks.push({
        id: `${messageId}-main-${segmentIndex}`,
        messageId,
        type: 'main_text',
        createdAt: nowIso,
        status: 'success',
        content: tailSegment
      });
    }
  } else {
    if (flowSegments.length === 0 && mainText) {
      blocks.push({
        id: `${messageId}-main`,
        messageId,
        type: 'main_text',
        createdAt: nowIso,
        status: 'success',
        content: mainText
      });
    }

    const orderedTools = [...tools].sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
    orderedTools.forEach((tool) => {
      if (!renderedToolIds.has(String(tool?.id || ''))) pushToolBlock(tool);
    });
  }

  return blocks;
};

const normalizePersistedAssistantBlocks = (sessionMessage) => {
  const payload = sessionMessage?.content;
  if (!payload || typeof payload !== 'object') return [];
  const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
  return blocks.filter((block) => block && typeof block === 'object');
};

const getPersistedAssistantMainText = (blocks = []) => {
  const mainBlock = blocks.find((block) => {
    const type = String(block?.type || '').toLowerCase();
    return type === 'main_text' || type === 'code';
  });
  return String(mainBlock?.content || '').trim();
};

const hasThinkTag = (text = '') => /<(?:think|thinking)(?:\s[^>]*)?>[\s\S]*?<\/(?:think|thinking)>/i.test(String(text || ''));

const summarizeBlockTypes = (blocks = []) => {
  const map = {};
  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    const type = String(block?.type || 'unknown').toLowerCase();
    map[type] = Number(map[type] || 0) + 1;
  });
  return map;
};

export {
  appendFlowSegment,
  appendToolFlowSegment,
  buildAssistantDisplayContent,
  buildAssistantDisplayContentFromFlow,
  buildStreamAssistantBlocks,
  getFlowCombinedContent,
  getPersistedAssistantMainText,
  hasThinkTag,
  mergeStreamingAccumulated,
  normalizePersistedAssistantBlocks,
  serializeStructuredValue,
  summarizeBlockTypes
};
