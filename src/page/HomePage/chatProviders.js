import { inferProviderLogoKey } from "../../shared/providerBranding.js";
import { normalizeThinkingLevels } from '../../components/Chat/Composer/thinkingLevels';

const resolveProviderIdByModel = (modelId = '') => {
  const lower = String(modelId || '').toLowerCase();
  if (lower.startsWith('claude-')) return { id: 'anthropic', type: 'anthropic', name: 'Anthropic' };
  if (lower.startsWith('qwen-') || lower.startsWith('qvq-') || lower.startsWith('qwq-')) return { id: 'bailian', type: 'openai', name: 'Aliyun Bailian' };
  if (lower.startsWith('gemini-')) return { id: 'gemini', type: 'openai', name: 'Google Gemini' };
  return { id: 'openai', type: 'openai', name: 'OpenAI' };
};

export const customModelToOption = (config) => ({
  value: `${config.id}:${config.modelId}`,
  label: config.name,
  read_image: config.read_image,
  ...(Array.isArray(config.reasoning_levels) ? { thinking_levels: normalizeThinkingLevels(config.reasoning_levels, true) } : {}),
  isCustom: true
});

// 「供应商→模型」两级选择器分组（对齐 ZCode）：内置供应商 + 各自定义供应商，
// 每组携带其启用模型的 value 列表。切换供应商即按 modelValues 过滤模型列表。
export const buildChatModelProviders = (builtInOptions = [], officialDisabled = [], customProviders = []) => {
  const disabled = new Set(Array.isArray(officialDisabled) ? officialDisabled : []);
  const officialValues = (Array.isArray(builtInOptions) ? builtInOptions : [])
    .filter((option) => option && !disabled.has(option.value))
    .map((option) => option.value);
  const groups = [];
  if (officialValues.length > 0) {
    groups.push({ id: 'builtin', name: '流光剪辑', kind: 'official', badge: '官方', modelValues: officialValues });
  }
  for (const provider of Array.isArray(customProviders) ? customProviders : []) {
    if (!provider || !provider.id) continue;
    const modelValues = (Array.isArray(provider.models) ? provider.models : [])
      .filter((item) => item && item.enabled !== false && String(item.modelId || '').trim())
      .map((item) => `${item.id}:${item.modelId}`);
    if (modelValues.length === 0) continue;
    groups.push({ id: provider.id, name: provider.name, kind: 'custom', badge: 'API', logoKey: inferProviderLogoKey(provider), modelValues });
  }
  return groups;
};

export const buildProvidersState = (modelIds = [], apiKey = '', customModels = []) => {
  const providersMap = new Map();
  const normalizedApiKey = String(apiKey || '').trim();
  modelIds.forEach((rawModelId) => {
    const option = rawModelId && typeof rawModelId === 'object' ? rawModelId : undefined;
    const modelId = String(option ? option.value || '' : rawModelId || '').trim();
    if (!modelId) return;
    if (option?.isCustom) {
      const config = customModels.find((item) => `${item.id}:${item.modelId}` === modelId);
      if (!config) return;
      providersMap.set(config.id, {
        // Cherry/aiCore 的 OpenAI 拓展别名 openai-response 走 Responses API。
        id: config.id, name: config.name, type: config.protocol === 'openai-responses' ? 'openai-response' : config.protocol, enabled: true,
        apiHost: config.baseUrl, apiKey: config.apiKey,
        models: [{ id: config.modelId, name: config.name, provider: config.id, read_image: config.read_image }]
      });
      return;
    }
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
  tokenLimits = {},
  thinking = tokenLimits
) => ({
  thinking_levels: Array.isArray(thinking?.thinking_levels) ? [...thinking.thinking_levels] : [],
  thinking_default: thinking?.thinking_default,
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

