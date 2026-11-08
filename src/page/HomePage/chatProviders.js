const resolveProviderIdByModel = (modelId = '') => {
  const lower = String(modelId || '').toLowerCase();
  if (lower.startsWith('claude-')) return { id: 'anthropic', type: 'anthropic', name: 'Anthropic' };
  if (lower.startsWith('qwen-') || lower.startsWith('qvq-') || lower.startsWith('qwq-')) return { id: 'bailian', type: 'openai', name: 'Aliyun Bailian' };
  if (lower.startsWith('gemini-')) return { id: 'gemini', type: 'openai', name: 'Google Gemini' };
  return { id: 'openai', type: 'openai', name: 'OpenAI' };
};

export const buildProvidersState = (modelIds = [], apiKey = '') => {
  const providersMap = new Map();
  const normalizedApiKey = String(apiKey || '').trim();
  modelIds.forEach((rawModelId) => {
    const option = rawModelId && typeof rawModelId === 'object' ? rawModelId : undefined;
    const modelId = String(option ? option.value || '' : rawModelId || '').trim();
    if (!modelId) return;
    const p = resolveProviderIdByModel(modelId);
    if (!providersMap.has(p.id)) {
      providersMap.set(p.id, { id: p.id, name: p.name, type: p.type, enabled: true, apiKey: normalizedApiKey, apiHost: '', models: [] });
    }
    const provider = providersMap.get(p.id);
    provider.models.push({
      id: modelId, name: option?.label || modelId, provider: p.id,
      ...(typeof option?.read_image === 'boolean' ? { read_image: option.read_image } : {})
    });
  });
  return { llm: { providers: Array.from(providersMap.values()) } };
};

export const toModelOption = (
  model_id,
  name,
  icon = '',
  readImage = undefined,
  pricing = undefined,
  priceText = '',
  description = '',
  badges = [],
  tokenLimits = {}
) => ({
  value: model_id,
  label: name,
  icon,
  read_image: typeof readImage === 'boolean' ? readImage : undefined,
  context_window_tokens: tokenLimits.context_window_tokens,
  max_input_tokens: tokenLimits.max_input_tokens,
  max_output_tokens: tokenLimits.max_output_tokens,
  compaction_trigger_tokens: tokenLimits.compaction_trigger_tokens,
  pricing: pricing && typeof pricing === 'object' ? { ...pricing } : undefined,
  price_text: String(priceText || '').trim(),
  description: String(description || '').trim(),
  badges: Array.isArray(badges) ? badges.map((badge) => String(badge || '').trim()).filter(Boolean) : [],
});

