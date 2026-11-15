import iconOpenai from "../../public/provider-icons/model-provider-openai.png";
import iconAnthropic from "../../public/provider-icons/model-provider-anthropic.png";
import iconDeepseek from "../../public/provider-icons/model-provider-deepseek.png";
import iconOpenrouter from "../../public/provider-icons/model-provider-openrouter-light.svg";
import iconBigmodel from "../../public/provider-icons/logo-bigmodel.svg";
import iconZai from "../../public/provider-icons/logo-zai-square.svg";
import iconKimi from "../../public/provider-icons/model-provider-moonshot-kimi.png";
import iconMinimax from "../../public/provider-icons/model-provider-minimax.png";
import iconAlibaba from "../../public/provider-icons/model-provider-alibaba-cloud.png";
import iconMimo from "../../public/provider-icons/model-provider-xiaomi-mimo.png";
import iconXai from "../../public/provider-icons/model-provider-xai.png";
import iconOpencode from "../../public/provider-icons/model-provider-opencode-light.svg";
import iconTokenhub from "../../public/provider-icons/model-provider-tencent-tokenhub.svg";
import iconArk from "../../public/provider-icons/model-provider-volcengine-ark.svg";
import iconStepfun from "../../public/provider-icons/model-provider-stepfun.svg";
import iconSiliconflow from "../../public/provider-icons/model-provider-siliconflow.svg";

const LOGO_ASSETS = {
  bigmodel: iconBigmodel,
  zai: iconZai,
  kimi: iconKimi,
  minimax: iconMinimax,
  deepseek: iconDeepseek,
  alibaba: iconAlibaba,
  mimo: iconMimo,
  tokenhub: iconTokenhub,
  ark: iconArk,
  stepfun: iconStepfun,
  siliconflow: iconSiliconflow,
  openai: iconOpenai,
  anthropic: iconAnthropic,
  xai: iconXai,
  openrouter: iconOpenrouter,
  opencode: iconOpencode,
};
const HOST_TO_LOGO_KEY = {
  "api.openai.com": "openai",
  "api.anthropic.com": "anthropic",
  "api.deepseek.com": "deepseek",
  "openrouter.ai": "openrouter",
  "open.bigmodel.cn": "bigmodel",
  "api.z.ai": "zai",
  "api.moonshot.cn": "kimi",
  "api.moonshot.ai": "kimi",
  "api.kimi.com": "kimi",
  "api.kimi.ai": "kimi",
  "api.minimaxi.com": "minimax",
  "api.minimax.io": "minimax",
  "dashscope.aliyuncs.com": "alibaba",
  "dashscope-intl.aliyuncs.com": "alibaba",
  "coding.dashscope.aliyuncs.com": "alibaba",
  "token-plan.cn-beijing.maas.aliyuncs.com": "alibaba",
  "api.xiaomimimo.com": "mimo",
  "token-plan-cn.xiaomimimo.com": "mimo",
  "tokenhub.tencentmaas.com": "tokenhub",
  "tokenhub-intl.tencentmaas.com": "tokenhub",
  "ark.cn-beijing.volces.com": "ark",
  "api.stepfun.com": "stepfun",
  "api.siliconflow.cn": "siliconflow",
  "api.x.ai": "xai",
  "opencode.ai": "opencode",
};
const TEMPLATE_NAME_TO_LOGO_KEY = {
  "智谱（中国）Coding Plan": "bigmodel",
  "智谱（国际）Coding Plan": "zai",
  "智谱（中国）API": "bigmodel",
  "智谱（国际）API": "zai",
  "Kimi": "kimi",
  "Kimi Code（国内）": "kimi",
  "Kimi Code（国际）": "kimi",
  "MiniMax": "minimax",
  "MiniMax M Plan（中国）": "minimax",
  "DeepSeek": "deepseek",
  "阿里云百炼（中国）": "alibaba",
  "阿里云百炼（国际）": "alibaba",
  "阿里云百炼 Coding Plan（中国）": "alibaba",
  "阿里云百炼 Token Plan 团队版（中国）": "alibaba",
  "Xiaomi MiMo API": "mimo",
  "Xiaomi MiMo Token Plan": "mimo",
  "腾讯 TokenHub 广州 API（中国站）": "tokenhub",
  "腾讯 TokenHub 新加坡 API（中国站）": "tokenhub",
  "火山方舟 API": "ark",
  "火山方舟 Coding Plan": "ark",
  "火山方舟 Agent Plan": "ark",
  "阶跃星辰 API": "stepfun",
  "阶跃星辰 Step Plan": "stepfun",
  "OpenAI": "openai",
  "Anthropic": "anthropic",
  "xAI": "xai",
  "硅基流动 API（中国）": "siliconflow",
  "OpenRouter": "openrouter",
  "OpenCode Go (Responses)": "opencode",
  "OpenCode Go (Anthropic)": "opencode",
  "OpenCode Go (Chat)": "opencode",
  "OpenCode Zen (Responses)": "opencode",
  "OpenCode Zen (Anthropic)": "opencode",
  "OpenCode Zen (Chat)": "opencode",
};

const own = (map, key) => Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

const logoKeyFromUrl = (baseUrl) => {
  try {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    return own(HOST_TO_LOGO_KEY, url.hostname);
  } catch {
    return undefined;
  }
};

// Persisted identity wins; legacy records use an exact template name, then endpoint host.
export const inferProviderLogoKey = (provider) => {
  if (typeof provider?.logoKey === "string" && provider.logoKey) return provider.logoKey;
  return own(TEMPLATE_NAME_TO_LOGO_KEY, provider?.name) || logoKeyFromUrl(provider?.baseUrl);
};

// Keep the existing argument order for ModelSettings consumers.
export const resolveProviderLogo = (baseUrl, logoKey) =>
  own(LOGO_ASSETS, logoKey) || own(LOGO_ASSETS, logoKeyFromUrl(baseUrl)) || null;
