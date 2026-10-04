const firstString = (...values) => {
  const value = values.find((item) => typeof item === 'string' && item.trim());
  return typeof value === 'string' ? value.trim() : '';
};

export const normalizeVoiceConversionRequestPayload = (voiceConversionRequest = {}) => {
  if (!voiceConversionRequest || typeof voiceConversionRequest !== 'object') return null;

  const audioUrl = firstString(voiceConversionRequest.audio_url, voiceConversionRequest.audioUrl);
  const videoUrl = firstString(voiceConversionRequest.video_url, voiceConversionRequest.videoUrl);
  const voiceId = firstString(voiceConversionRequest.voice_id, voiceConversionRequest.voiceId);
  if ((!audioUrl && !videoUrl) || !voiceId) return null;

  return {
    ...(videoUrl ? { video_url: videoUrl } : { audio_url: audioUrl }),
    voice_id: voiceId,
  };
};

export const buildVoiceConversionRequestProcessingBlocks = ({
  assistantMessageId,
  requestId,
  voiceConversionRequest = {},
  modelId = '',
}) => {
  const toolCallId = `voice_conversion_request_${String(requestId || '').trim() || Date.now()}`;
  return [{
    id: `${assistantMessageId}-voice-conversion-tool`,
    messageId: assistantMessageId,
    type: 'tool',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'processing',
    model: modelId,
    toolId: toolCallId,
    toolName: 'mcp__vectcut__voice-conversion__submit_voice_conversion_task',
    arguments: voiceConversionRequest,
    metadata: {
      rawMcpToolResponse: {
        id: toolCallId,
        tool: {
          id: 'mcp__vectcut__voice-conversion__submit_voice_conversion_task',
          name: 'mcp__vectcut__voice-conversion__submit_voice_conversion_task',
          serverName: 'vectcut',
          serverId: 'vectcut',
          type: 'mcp'
        },
        arguments: voiceConversionRequest,
        status: 'pending'
      }
    }
  }];
};
