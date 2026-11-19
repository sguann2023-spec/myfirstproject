// 智能配置模型目录：搬运自 ZCode config/provider/zcode-builtin.json 的 modelConfigRules。
// 解析语义对齐 ZCode packages/provider/src/config/{schema,model-config}.ts：
//   - 规则按 modelRules → modelApiRules → providerSiteRules 的顺序遍历（后者覆盖前者）；
//   - modelMatch 为正则，全串锚定 ^(?:pattern)$、大小写不敏感；
//   - modelApiRules 额外要求 apiTypeMatch 命中供应商 API 格式；
//   - providerSiteRules 额外要求 baseUrlMatch 命中规范化后的 Base URL（apiTypeMatch 若存在也需命中）；
//   - 命中的规则依次 overlay（深合并）到结果上；首条 ".*" 兜底，任意非空 ID 恒有推荐配置。
//   推理参数映射（reasoningLevel.map，CEL 表达式）主要来自 modelApiRules。
import CATALOG from "./modelCatalog.json";

export const MODEL_CONFIG_RULES = CATALOG.modelRules;
export const MODEL_API_RULES = CATALOG.modelApiRules;
export const PROVIDER_SITE_RULES = CATALOG.providerSiteRules;

// 本应用 protocol → ZCode apiTypeMatch。
export const API_TYPE_BY_PROTOCOL = {
  openai: "openai-chat-completions",
  anthropic: "anthropic-messages",
  "openai-responses": "openai-responses",
};

const CAPABILITY_KEYS = [
  "supportsJsonSchemaOutput",
  "supportsNativeWebSearch",
  "supportsMidConversationSystem",
];

const matchesRule = (pattern, value) => {
  try {
    return new RegExp(`^(?:${pattern})$`, "i").test(value);
  } catch {
    return false;
  }
};

// 对齐 ZCode normalizeBaseURLForRuleMatch：去掉查询/哈希、尾部斜杠，host 大小写不敏感。
const normalizeBaseUrl = (value) => {
  try {
    const parsed = new URL(value);
    const endpoint = `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname}`.replace(/\/+$/, "");
    return endpoint;
  } catch {
    return undefined;
  }
};

const overlay = (base, config = {}) => {
  const props = config.properties || {};
  const specs = config.optionSpecs || {};
  const out = { ...base };
  if (props.contextWindow !== undefined) out.contextWindow = props.contextWindow;
  if (props.inputFormat) out.inputFormat = { ...out.inputFormat, ...props.inputFormat };
  for (const key of CAPABILITY_KEYS) {
    if (props[key] !== undefined) out[key] = props[key];
  }
  if (specs.maxOutputTokens?.max !== undefined) out.maxOutputTokens = specs.maxOutputTokens.max;
  if (specs.reasoningLevel) {
    if (Array.isArray(specs.reasoningLevel.values)) out.reasoningLevels = specs.reasoningLevel.values;
    if (specs.reasoningLevel.map !== undefined) out.reasoningMap = specs.reasoningLevel.map;
  }
  return out;
};

/** 解析模型 ID 的推荐配置。apiType/baseUrl 来自供应商，用于命中 modelApiRules/providerSiteRules。 */
export const resolveModelConfig = (modelId, apiType, baseUrl) => {
  const id = String(modelId || "").trim();
  if (!id) return null;
  let resolved = {};
  let matchedSpecific = false;
  const noteSpecific = (pattern) => {
    if (pattern !== ".*") matchedSpecific = true;
  };
  for (const rule of CATALOG.modelRules) {
    if (!matchesRule(rule.modelMatch, id)) continue;
    noteSpecific(rule.modelMatch);
    resolved = overlay(resolved, rule.config);
  }
  if (apiType) {
    for (const rule of CATALOG.modelApiRules) {
      if (rule.apiTypeMatch !== apiType || !matchesRule(rule.modelMatch, id)) continue;
      noteSpecific(rule.modelMatch);
      resolved = overlay(resolved, rule.config);
    }
    const normalizedBase = baseUrl ? normalizeBaseUrl(baseUrl) : undefined;
    for (const rule of CATALOG.providerSiteRules) {
      if (!matchesRule(rule.modelMatch, id)) continue;
      if (rule.apiTypeMatch !== undefined && rule.apiTypeMatch !== apiType) continue;
      if (normalizedBase === undefined || !matchesRule(rule.baseUrlMatch, normalizedBase)) continue;
      noteSpecific(rule.modelMatch);
      resolved = overlay(resolved, rule.config);
    }
  }
  const input = resolved.inputFormat || {};
  return {
    matchedSpecific,
    context_window_tokens: resolved.contextWindow,
    max_output_tokens: resolved.maxOutputTokens,
    read_image: Boolean(input.supportsImage),
    supports_video: Boolean(input.supportsVideo),
    supports_pdf: Boolean(input.supportsPdf),
    supports_json_schema: Boolean(resolved.supportsJsonSchemaOutput),
    supports_native_web_search: Boolean(resolved.supportsNativeWebSearch),
    supports_mid_conversation_system: Boolean(resolved.supportsMidConversationSystem),
    reasoning_levels: Array.isArray(resolved.reasoningLevels) ? resolved.reasoningLevels : [],
    reasoning_level_map: typeof resolved.reasoningMap === "string" ? resolved.reasoningMap : "",
  };
};

const legacyChatReasoningMap = MODEL_API_RULES.find(
  (rule) => rule.modelMatch === ".*" && rule.apiTypeMatch === API_TYPE_BY_PROTOCOL.openai,
)?.config.optionSpecs.reasoningLevel.map;
const openAiReasoningModelPattern = "(?:.*/)?(?:gpt-(?:[5-9]|[1-9][0-9]+)(?:[.-].*)?|o[1-9][0-9]*(?:-.*)?)";

/** 只兼容逐字匹配的旧默认；不回写存储，也不改动手写映射。 */
export const resolveCustomReasoningMap = (modelId, protocol, source, baseUrl) => {
  if (protocol !== "openai" || typeof source !== "string" || source !== legacyChatReasoningMap
    || !matchesRule(openAiReasoningModelPattern, String(modelId || "").trim())) {
    return source;
  }
  return resolveModelConfig(modelId, API_TYPE_BY_PROTOCOL.openai, baseUrl)?.reasoning_level_map ?? source;
};