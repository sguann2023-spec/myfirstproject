import React from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Info,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import {
  Alert,
  Button,
  Checkbox,
  ConfigProvider,
  Dropdown,
  Form,
  Input,
  Modal,
  Switch,
  Tooltip,
} from "antd";
import "./ModelSettings.css";
import { getCurrentChannelBrandConfig } from "../../../channel-branding/runtime";
import { confirmDelete } from "../../shared/confirmDelete.js";

const OFFICIAL_LOGO = getCurrentChannelBrandConfig().runtimeAssets.aboutLogo;
const formatContextWindow = (tokens) => {
  if (!Number.isSafeInteger(tokens) || tokens <= 0) return null;
  if (tokens >= 1000000) return `${Number((tokens / 1000000).toFixed(1))}M`;
  if (tokens >= 1000) return `${Number((tokens / 1000).toFixed(1))}K`;
  return String(tokens);
};
import { getChatModelList, testChatModel } from "../../api/chat.js";
// 品牌图标走模块打包：运行时绝对路径 /provider-icons/… 在 Electron file:// 下会 404，
// 导致全部图标回退成 Package；打包后开发态与打包态都可用。
import iconOpenai from "../../../public/provider-icons/model-provider-openai.png";
import iconAnthropic from "../../../public/provider-icons/model-provider-anthropic.png";
import iconDeepseek from "../../../public/provider-icons/model-provider-deepseek.png";
import iconOpenrouter from "../../../public/provider-icons/model-provider-openrouter-light.svg";
import iconBigmodel from "../../../public/provider-icons/logo-bigmodel.svg";
import iconZai from "../../../public/provider-icons/logo-zai-square.svg";
import iconKimi from "../../../public/provider-icons/model-provider-moonshot-kimi.png";
import iconMinimax from "../../../public/provider-icons/model-provider-minimax.png";
import iconAlibaba from "../../../public/provider-icons/model-provider-alibaba-cloud.png";
import iconMimo from "../../../public/provider-icons/model-provider-xiaomi-mimo.png";
import iconXai from "../../../public/provider-icons/model-provider-xai.png";
import iconOpencode from "../../../public/provider-icons/model-provider-opencode-light.svg";
import iconTokenhub from "../../../public/provider-icons/model-provider-tencent-tokenhub.svg";
import iconArk from "../../../public/provider-icons/model-provider-volcengine-ark.svg";
import iconStepfun from "../../../public/provider-icons/model-provider-stepfun.svg";
import iconSiliconflow from "../../../public/provider-icons/model-provider-siliconflow.svg";

export const BUILTIN_PROVIDER_ID = "builtin-vectcut";

// Match ZCode ControlHintTooltip (side=right, sideOffset=2, theme-zai-light):
// light #f0f0f0 surface, 12px medium label, 8px radius, hairline border, no arrow.
const NAV_TOOLTIP_PROPS = {
  placement: "right",
  align: { offset: [2, 0] },
  arrow: false,
  color: "#f0f0f0",
  overlayInnerStyle: {
    color: "#0d0d0d",
    border: "1px solid rgba(13, 13, 13, 0.1)",
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 500,
    minHeight: "auto",
    boxShadow: "none",
  },
};

// 对齐 ZCode 可选供应商目录（含 rev33 之后的新增套餐入口）：名称使用其中文本地化文案，
// 端点与协议逐条核对官方文档；anthropic-messages → anthropic，其余 → openai。
export const PROVIDER_TEMPLATES = [
  {
    name: "智谱（中国）Coding Plan",
    logoKey: "bigmodel",
    protocol: "anthropic",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    group: "zhipu",
    apiKeyUrl: "https://bigmodel.cn/coding-plan/personal/overview",
    models: [
      {
        modelId: "GLM-5-Turbo",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "GLM-5.3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5.3-Flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "智谱（国际）Coding Plan",
    logoKey: "zai",
    protocol: "anthropic",
    baseUrl: "https://api.z.ai/api/anthropic",
    group: "zhipu",
    apiKeyUrl: "https://z.ai/manage-apikey/apikey-list",
    models: [
      {
        modelId: "GLM-5-Turbo",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "GLM-5.3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5.3-Flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "智谱（中国）API",
    logoKey: "bigmodel",
    protocol: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    group: "zhipu",
    apiKeyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    models: [
      {
        modelId: "GLM-5.3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5.3-Flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5.3-FlashX",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5.2",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5V-Turbo",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5.1",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000
      },
      {
        modelId: "GLM-5.1-Highspeed",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000
      },
      {
        modelId: "GLM-5",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5-Turbo",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "GLM-4.7",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.7-FlashX",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.7-Flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.6",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.5-Air",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.5",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.6V",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.6V-Flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.6V-FlashX",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.1V-Thinking-FlashX",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.1V-Thinking-Flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4-FlashX-250414",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4-Flash-250414",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4V-Flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "codegeex-4",
        enabled: false,
        read_image: false,
        context_window_tokens: 131072,
      },
      {
        modelId: "charglm-4",
        enabled: false,
        read_image: false,
        context_window_tokens: 8192,
      },
      {
        modelId: "emohaa",
        enabled: false,
        read_image: false,
        context_window_tokens: 8192,
      },
    ],
  },
  {
    name: "智谱（国际）API",
    logoKey: "zai",
    protocol: "openai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    group: "zhipu",
    apiKeyUrl: "https://z.ai/manage-apikey/apikey-list",
    models: [
      {
        modelId: "GLM-5.3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5.3-Flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5.2",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5V-Turbo",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5.1",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000
      },
      {
        modelId: "GLM-5.1-Highspeed",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000
      },
      {
        modelId: "GLM-5",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-5-Turbo",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "GLM-4.7",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.7-FlashX",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.7-Flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.6",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.5-Air",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.5",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.6V",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.6V-Flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.6V-FlashX",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.1V-Thinking-FlashX",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4.1V-Thinking-Flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4-FlashX-250414",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4-Flash-250414",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "GLM-4V-Flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "codegeex-4",
        enabled: false,
        read_image: false,
        context_window_tokens: 131072,
      },
      {
        modelId: "charglm-4",
        enabled: false,
        read_image: false,
        context_window_tokens: 8192,
      },
      {
        modelId: "emohaa",
        enabled: false,
        read_image: false,
        context_window_tokens: 8192,
      },
    ],
  },
  {
    name: "Kimi",
    logoKey: "kimi",
    protocol: "anthropic",
    baseUrl: "https://api.moonshot.cn/anthropic",
    group: "other",
    apiKeyUrl: "https://platform.kimi.com/console/api-keys",
    models: [
      {
        modelId: "kimi-k3.1-pro",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576,
      },
      {
        modelId: "kimi-k3.1-pro-highspeed",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576,
      },
      {
        modelId: "kimi-k3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576,
      },
      {
        modelId: "kimi-k2.7-code",
        enabled: true,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "kimi-k2.6",
        enabled: true,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "k3",
        enabled: false,
        read_image: true,
        context_window_tokens: 1048576,
      },
      {
        modelId: "k3-256k",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "kimi-k2.7-code-highspeed",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
    ],
  },
  {
    name: "Kimi Code（国内）",
    logoKey: "kimi",
    protocol: "openai",
    baseUrl: "https://api.kimi.com/coding/v1",
    group: "other",
    apiKeyUrl: "https://www.kimi.com/code",
    models: [
      {
        modelId: "k3.1-pro",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "k3.1-pro-highspeed",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "k3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "k3-256k",
        enabled: true,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "kimi-for-coding",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "kimi-for-coding-highspeed",
        enabled: true,
        read_image: true,
        context_window_tokens: 262144,
      },
    ],
  },
  {
    name: "Kimi Code（国际）",
    logoKey: "kimi",
    protocol: "openai",
    baseUrl: "https://api.kimi.ai/coding/v1",
    group: "other",
    apiKeyUrl: "https://www.kimi.com/code",
    models: [
      {
        modelId: "k3.1-pro",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "k3.1-pro-highspeed",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "k3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "k3-256k",
        enabled: true,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "kimi-for-coding",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "kimi-for-coding-highspeed",
        enabled: true,
        read_image: true,
        context_window_tokens: 262144,
      },
    ],
  },
  {
    name: "MiniMax",
    logoKey: "minimax",
    protocol: "anthropic",
    baseUrl: "https://api.minimaxi.com/anthropic",
    group: "other",
    apiKeyUrl: "https://platform.minimaxi.com/console/access?tab=api-keys",
    models: [
      {
        modelId: "MiniMax-M2.7",
        enabled: true,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M2.7-highspeed",
        enabled: true,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "MiniMax-M3.1-Flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "MiniMax-M2.5",
        enabled: false,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M2.5-highspeed",
        enabled: false,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M2.1",
        enabled: false,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M2.1-highspeed",
        enabled: false,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M2",
        enabled: false,
        read_image: false,
        context_window_tokens: 204800,
      },
    ],
  },
  {
    name: "MiniMax M Plan（中国）",
    logoKey: "minimax",
    protocol: "anthropic",
    baseUrl: "https://api.minimaxi.com/anthropic",
    group: "other",
    apiKeyUrl: "https://platform.minimaxi.com",
    models: [
      {
        modelId: "MiniMax-M2.7",
        enabled: true,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M2.7-highspeed",
        enabled: true,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "MiniMax-M3.1-Flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "MiniMax-M2.5",
        enabled: false,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M2.5-highspeed",
        enabled: false,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M2.1",
        enabled: false,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M2.1-highspeed",
        enabled: false,
        read_image: false,
        context_window_tokens: 204800,
      },
      {
        modelId: "MiniMax-M2",
        enabled: false,
        read_image: false,
        context_window_tokens: 204800,
      },
    ],
  },
  {
    name: "DeepSeek",
    logoKey: "deepseek",
    protocol: "anthropic",
    baseUrl: "https://api.deepseek.com/anthropic",
    group: "other",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    models: [
      {
        modelId: "deepseek-v4-pro",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4.1-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "阿里云百炼（中国）",
    logoKey: "alibaba",
    protocol: "anthropic",
    baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
    group: "other",
    apiKeyUrl: "https://bailian.console.aliyun.com/cn-beijing?tab=model",
    models: [
      {
        modelId: "qwen3.8-max",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.8-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.5-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.5-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3-max",
        enabled: false,
        read_image: false,
        context_window_tokens: 262144,
      },
      {
        modelId: "qwen-plus",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3-vl-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "qwen3.7-max",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.6-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.6-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "阿里云百炼（国际）",
    logoKey: "alibaba",
    protocol: "openai",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    group: "other",
    apiKeyUrl:
      "https://modelstudio.console.aliyun.com/ap-southeast-1?tab=dashboard",
    models: [
      {
        modelId: "qwen3.8-max",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.8-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.5-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.5-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3-max",
        enabled: false,
        read_image: false,
        context_window_tokens: 262144,
      },
      {
        modelId: "qwen-plus",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3-vl-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "qwen3.7-max",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.6-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.6-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.8-omni-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 65536,
      },
    ],
  },
  {
    name: "阿里云百炼 Coding Plan（中国）",
    logoKey: "alibaba",
    protocol: "anthropic",
    baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    group: "other",
    apiKeyUrl: "https://bailian.console.aliyun.com",
    models: [
      {
        modelId: "qwen3.8-max",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.8-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.5-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.5-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3-max",
        enabled: false,
        read_image: false,
        context_window_tokens: 262144,
      },
      {
        modelId: "qwen-plus",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3-vl-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "qwen3.7-max",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.6-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.6-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "阿里云百炼 Token Plan 团队版（中国）",
    logoKey: "alibaba",
    protocol: "anthropic",
    baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
    group: "other",
    apiKeyUrl: "https://bailian.console.aliyun.com",
    models: [
      {
        modelId: "qwen3.8-max",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.8-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.5-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.5-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3-max",
        enabled: false,
        read_image: false,
        context_window_tokens: 262144,
      },
      {
        modelId: "qwen-plus",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3-vl-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "qwen3.7-max",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.6-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.6-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "Xiaomi MiMo API",
    logoKey: "mimo",
    protocol: "anthropic",
    baseUrl: "https://api.xiaomimimo.com/anthropic",
    group: "other",
    apiKeyUrl: "https://platform.xiaomimimo.com/",
    models: [
      {
        modelId: "mimo-v2.6-pro",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "mimo-v2.6-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "mimo-v2.6-pro-ultraspeed",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "mimo-v2.5-pro",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "mimo-v2.5",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "Xiaomi MiMo Token Plan",
    logoKey: "mimo",
    protocol: "anthropic",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
    group: "other",
    apiKeyUrl: "https://platform.xiaomimimo.com/",
    models: [
      {
        modelId: "mimo-v2.6-pro",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "mimo-v2.6-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "腾讯 TokenHub 广州 API（中国站）",
    logoKey: "tokenhub",
    protocol: "openai",
    baseUrl: "https://tokenhub.tencentmaas.com/v1",
    group: "other",
    apiKeyUrl: "https://console.cloud.tencent.com/tokenhub",
    models: [
      {
        modelId: "hy4",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576
      },
      {
        modelId: "hy4-preview",
        enabled: false,
        read_image: false,
        context_window_tokens: 1048576,
      },
      {
        modelId: "hy3",
        enabled: true,
        read_image: false,
        context_window_tokens: 262144
      },
      {
        modelId: "deepseek-v4-pro",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000
      },
      {
        modelId: "deepseek-v4.1-flash",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000
      },
      {
        modelId: "glm-5.3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000
      },
      {
        modelId: "kimi-k3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576
      },
      {
        modelId: "minimax-m3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000
      },
    ],
  },
  {
    name: "腾讯 TokenHub 新加坡 API（中国站）",
    logoKey: "tokenhub",
    protocol: "openai",
    baseUrl: "https://tokenhub-intl.tencentmaas.com/v1",
    group: "other",
    apiKeyUrl: "https://console.cloud.tencent.com/tokenhub",
    models: [
      {
        modelId: "hy4",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576
      },
      {
        modelId: "hy4-preview",
        enabled: false,
        read_image: false,
        context_window_tokens: 1048576,
      },
      {
        modelId: "hy3",
        enabled: true,
        read_image: false,
        context_window_tokens: 262144
      },
      {
        modelId: "deepseek-v4-pro",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000
      },
      {
        modelId: "deepseek-v4.1-flash",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000
      },
      {
        modelId: "glm-5.3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000
      },
      {
        modelId: "kimi-k3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576
      },
      {
        modelId: "minimax-m3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000
      },
    ],
  },
  {
    name: "火山方舟 API",
    logoKey: "ark",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    group: "other",
    apiKeyUrl: "https://console.volcengine.com/ark",
    models: [
      {
        modelId: "doubao-seed-2-1-pro-260915",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "doubao-seed-evolving",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "doubao-seed-2-1-turbo-260628",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "doubao-seed-2-0-pro-260215",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "doubao-seed-2-0-mini-260428",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
    ],
  },
  {
    name: "火山方舟 Coding Plan",
    logoKey: "ark",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    group: "other",
    apiKeyUrl: "https://console.volcengine.com/ark",
    models: [
      {
        modelId: "ark-code-latest",
        enabled: true,
        read_image: false,
        context_window_tokens: undefined,
      },
      {
        modelId: "doubao-seed-evolving",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "doubao-seed-2.1-pro",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "doubao-seed-2.1-lite",
        enabled: true,
        read_image: true,
        context_window_tokens: undefined,
      },
      {
        modelId: "doubao-seed-2.0-mini",
        enabled: true,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "glm-5.3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "glm-5.3-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4.1-flash",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4.1-flash-economy",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4-flash",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4-pro",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "kimi-k2.8-preview",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576,
      },
      {
        modelId: "kimi-k3.1-pro",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576,
      },
    ],
  },
  {
    name: "火山方舟 Agent Plan",
    logoKey: "ark",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    group: "other",
    apiKeyUrl: "https://console.volcengine.com/ark",
    models: [
      {
        modelId: "doubao-seed-2.1-turbo",
        enabled: true,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "doubao-seed-2.0-pro",
        enabled: true,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "doubao-seed-evolving",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "glm-5.2",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "kimi-k2.7-code",
        enabled: true,
        read_image: false,
        context_window_tokens: 262144,
      },
      {
        modelId: "deepseek-v4-pro",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "minimax-m3",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "阶跃星辰 API",
    logoKey: "stepfun",
    protocol: "openai",
    baseUrl: "https://api.stepfun.com/v1",
    group: "other",
    apiKeyUrl: "https://platform.stepfun.com",
    models: [
      {
        modelId: "step-3.5-flash",
        enabled: true,
        read_image: false,
        context_window_tokens: 262144
      },
      {
        modelId: "step-3.7-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "step-5-preview",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000
      },
    ],
  },
  {
    name: "阶跃星辰 Step Plan",
    logoKey: "stepfun",
    protocol: "anthropic",
    baseUrl: "https://api.stepfun.com/step_plan",
    group: "other",
    apiKeyUrl: "https://platform.stepfun.com",
    models: [
      {
        modelId: "step-3.5-flash",
        enabled: true,
        read_image: false,
        context_window_tokens: 262144
      },
    ],
  },
  {
    name: "OpenAI",
    logoKey: "openai",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    group: "other",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    models: [
      {
        modelId: "gpt-5.6-sol",
        enabled: true,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.6-terra",
        enabled: true,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.6-luna",
        enabled: true,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.6",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.3-codex",
        enabled: false,
        read_image: true,
        context_window_tokens: 400000,
      },
      {
        modelId: "gpt-6-astra",
        enabled: true,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.4",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.4-pro",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.4-mini",
        enabled: false,
        read_image: true,
        context_window_tokens: 400000,
      },
      {
        modelId: "gpt-5.4-nano",
        enabled: false,
        read_image: true,
        context_window_tokens: 400000,
      },
    ],
  },
  {
    name: "Anthropic",
    logoKey: "anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    group: "other",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      {
        modelId: "claude-fable-5-2",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-fable-5",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-opus-5",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-sonnet-5",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-opus-5-5",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-sonnet-5-5",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-haiku-5-5",
        enabled: false,
        read_image: true,
        context_window_tokens: 200000,
      },
      {
        modelId: "claude-haiku-4-5-20251001",
        enabled: true,
        read_image: true,
        context_window_tokens: 200000,
      },
      {
        modelId: "claude-fable-5-1",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "xAI",
    logoKey: "xai",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    group: "other",
    apiKeyUrl: "https://console.x.ai",
    models: [
      {
        modelId: "grok-4.6",
        enabled: true,
        read_image: true,
        context_window_tokens: 500000,
      },
      {
        modelId: "grok-4.5",
        enabled: false,
        read_image: true,
        context_window_tokens: 500000,
      },
      {
        modelId: "grok-build-0.1",
        enabled: true,
        read_image: true,
        context_window_tokens: 256000,
      },
      {
        modelId: "grok-4.3",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "硅基流动 API（中国）",
    logoKey: "siliconflow",
    protocol: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    group: "other",
    apiKeyUrl: "https://cloud.siliconflow.cn/me/account/ak",
    models: [
      {
        modelId: "deepseek-ai/DeepSeek-V4-Flash",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "Pro/zai-org/GLM-5.1",
        enabled: true,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "deepseek-ai/DeepSeek-V3.2",
        enabled: false,
        read_image: false,
        context_window_tokens: 131072,
      },
      {
        modelId: "moonshotai/Kimi-K2.6",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "Pro/MiniMaxAI/MiniMax-M2.7",
        enabled: false,
        read_image: false,
        context_window_tokens: 204800,
      },
    ],
  },
  {
    name: "OpenRouter",
    logoKey: "openrouter",
    protocol: "anthropic",
    baseUrl: "https://openrouter.ai/api",
    group: "other",
    apiKeyUrl: "https://openrouter.ai/keys",
    models: [
      {
        modelId: "openai/gpt-5.6-sol",
        enabled: true,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "openai/gpt-5.6-terra",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "openai/gpt-5.6-luna",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "openai/gpt-5.3-codex",
        enabled: false,
        read_image: true,
        context_window_tokens: 400000,
      },
      {
        modelId: "anthropic/claude-opus-5",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "anthropic/claude-sonnet-5",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "anthropic/claude-haiku-4.5",
        enabled: false,
        read_image: true,
        context_window_tokens: 200000,
      },
      {
        modelId: "deepseek/deepseek-v4-pro",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek/deepseek-v4-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "moonshotai/kimi-k3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576,
      },
      {
        modelId: "moonshotai/kimi-k2.7-code",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "z-ai/glm-5.3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "z-ai/glm-5.3-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "z-ai/glm-5.2",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "qwen/qwen3.8-max",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen/qwen3.8-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "minimax/minimax-m3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "minimax/minimax-m3.1-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "xiaomi/mimo-v2.6-pro",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "xiaomi/mimo-v2.6-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "x-ai/grok-4.6",
        enabled: true,
        read_image: true,
        context_window_tokens: 500000,
      },
      {
        modelId: "openai/gpt-5.6",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "anthropic/claude-opus-4.8",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "anthropic/claude-opus-4.7",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "anthropic/claude-opus-4.6",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "anthropic/claude-opus-4.5",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "anthropic/claude-sonnet-4.6",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "anthropic/claude-sonnet-4.5",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "moonshotai/kimi-k2.6",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "moonshotai/kimi-k2.5",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "z-ai/glm-5.1",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "z-ai/glm-5v-turbo",
        enabled: false,
        read_image: true,
        context_window_tokens: 200000,
      },
      {
        modelId: "z-ai/glm-5",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "z-ai/glm-5-turbo",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "z-ai/glm-4.7",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "z-ai/glm-4.7-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "z-ai/glm-4.6",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "z-ai/glm-4.6v",
        enabled: false,
        read_image: true,
        context_window_tokens: 131072,
      },
      {
        modelId: "z-ai/glm-4.5-air",
        enabled: false,
        read_image: false,
        context_window_tokens: 131072,
      },
      {
        modelId: "z-ai/glm-4.5",
        enabled: false,
        read_image: false,
        context_window_tokens: 131072,
      },
      {
        modelId: "qwen/qwen3.7-max",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen/qwen3.7-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen/qwen3.7-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen/qwen3.6-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen/qwen3.6-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen/qwen3.5-plus-20260420",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen/qwen3-vl-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "qwen/qwen3-vl-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "minimax/minimax-m2.7",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "minimax/minimax-m2.5",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "x-ai/grok-build-0.1",
        enabled: false,
        read_image: true,
        context_window_tokens: 256000,
      },
      {
        modelId: "x-ai/grok-4.3",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "openai/gpt-6-astra",
        enabled: true,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "anthropic/claude-fable-5.1",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "anthropic/claude-fable-5.2",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "openai/gpt-5.4",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "openai/gpt-5.4-pro",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "openai/gpt-5.4-mini",
        enabled: false,
        read_image: true,
        context_window_tokens: 400000,
      },
      {
        modelId: "openai/gpt-5.4-nano",
        enabled: false,
        read_image: true,
        context_window_tokens: 400000,
      },
      {
        modelId: "deepseek/deepseek-v4.1-flash",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen/qwen3.8-max-0902",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "OpenCode Go (Responses)",
    logoKey: "opencode",
    protocol: "openai",
    baseUrl: "https://opencode.ai/zen/go/v1",
    group: "other",
    apiKeyUrl: "https://opencode.ai/auth",
    models: [
      {
        modelId: "gpt-5.6-luna",
        enabled: true,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "grok-4.6",
        enabled: true,
        read_image: true,
        context_window_tokens: 500000,
      },
    ],
  },
  {
    name: "OpenCode Go (Anthropic)",
    logoKey: "opencode",
    protocol: "anthropic",
    baseUrl: "https://opencode.ai/zen/go",
    group: "other",
    apiKeyUrl: "https://opencode.ai/auth",
    models: [
      {
        modelId: "minimax-m3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "minimax-m3.1-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "minimax-m2.7",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "minimax-m2.5",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.8-max",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.8-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-max",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.6-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "OpenCode Go (Chat)",
    logoKey: "opencode",
    protocol: "openai",
    baseUrl: "https://opencode.ai/zen/go/v1",
    group: "other",
    apiKeyUrl: "https://opencode.ai/auth",
    models: [
      {
        modelId: "glm-5.3-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "glm-5.3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "glm-5.2",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "glm-5.1",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "kimi-k3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576,
      },
      {
        modelId: "kimi-k2.7-code",
        enabled: true,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "kimi-k2.6",
        enabled: false,
        read_image: true,
        context_window_tokens: 262144,
      },
      {
        modelId: "deepseek-v4.1-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4-pro",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4-flash-vision-exp",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "mimo-v2.6-flash",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "mimo-v2.6-pro",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "hy4-preview",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "hy3",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "grok-4.7",
        enabled: false,
        read_image: true,
        context_window_tokens: 500000,
      },
      {
        modelId: "kimi-k3.1-pro",
        enabled: false,
        read_image: true,
        context_window_tokens: 1048576,
      },
      {
        modelId: "step-5-preview",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "minimax-m3.1-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "longcat-2.0",
        enabled: false,
        read_image: false,
        context_window_tokens: undefined,
      },
      {
        modelId: "gemini-4-argon",
        enabled: false,
        read_image: true,
        context_window_tokens: undefined,
      },
    ],
  },
  {
    name: "OpenCode Zen (Responses)",
    logoKey: "opencode",
    protocol: "openai",
    baseUrl: "https://opencode.ai/zen/v1",
    group: "other",
    apiKeyUrl: "https://opencode.ai/auth",
    models: [
      {
        modelId: "gpt-5.6-sol",
        enabled: true,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.6-terra",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.6-luna",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.5",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "gpt-5.5-pro",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "gpt-5.4",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.4-pro",
        enabled: false,
        read_image: true,
        context_window_tokens: 1050000,
      },
      {
        modelId: "gpt-5.4-mini",
        enabled: false,
        read_image: true,
        context_window_tokens: 400000,
      },
      {
        modelId: "gpt-5.4-nano",
        enabled: false,
        read_image: true,
        context_window_tokens: 400000,
      },
      {
        modelId: "gpt-5.3-codex",
        enabled: false,
        read_image: true,
        context_window_tokens: 400000,
      },
      {
        modelId: "gpt-5.3-codex-spark",
        enabled: false,
        read_image: true,
        context_window_tokens: 400000,
      },
      {
        modelId: "gpt-5.2",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "gpt-5.1",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "gpt-6-astra",
        enabled: true,
        read_image: true,
        context_window_tokens: 1050000,
      },
    ],
  },
  {
    name: "OpenCode Zen (Anthropic)",
    logoKey: "opencode",
    protocol: "anthropic",
    baseUrl: "https://opencode.ai/zen",
    group: "other",
    apiKeyUrl: "https://opencode.ai/auth",
    models: [
      {
        modelId: "claude-fable-5",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-opus-5",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-sonnet-5",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-haiku-4-5",
        enabled: false,
        read_image: true,
        context_window_tokens: 200000,
      },
      {
        modelId: "claude-opus-4-8",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-opus-4-7",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-opus-4-6",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-opus-4-5",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-sonnet-4-6",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-sonnet-4-5",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-max",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.7-plus",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.6-plus",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "qwen3.5-plus",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "claude-fable-5-1",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
    ],
  },
  {
    name: "OpenCode Zen (Chat)",
    logoKey: "opencode",
    protocol: "openai",
    baseUrl: "https://opencode.ai/zen/v1",
    group: "other",
    apiKeyUrl: "https://opencode.ai/auth",
    models: [
      {
        modelId: "kimi-k3",
        enabled: true,
        read_image: true,
        context_window_tokens: 1048576,
      },
      {
        modelId: "minimax-m3",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "minimax-m2.7",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4-pro",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4-flash",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "glm-5.2",
        enabled: true,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "glm-5.1",
        enabled: false,
        read_image: false,
        context_window_tokens: 200000,
      },
      {
        modelId: "big-pickle",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "mimo-v2.6-flash-free",
        enabled: true,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "hy3-free",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "ling-3.0-flash-fin-free",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "nemotron-3-ultra-free",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "nemotron-3.5-lightning-free",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "muse-spark-1.2-contributor-free",
        enabled: true,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "deepseek-v4.1-flash-free",
        enabled: false,
        read_image: false,
        context_window_tokens: 1000000,
      },
      {
        modelId: "glm-5.3-flash-free",
        enabled: false,
        read_image: true,
        context_window_tokens: 1000000,
      },
      {
        modelId: "flint-40b-free",
        enabled: false,
        read_image: false,
        context_window_tokens: undefined,
      },
      {
        modelId: "nemotron-3.5-super-vl-free",
        enabled: false,
        read_image: true,
        context_window_tokens: undefined,
      },
    ],
  },
];
// Original assets copied from ZCode-main/packages/ui/src/assets/provider-icons.
// Exact endpoint hosts identify brands independently of the editable display name.
const BRAND_ASSETS = {
  "api.openai.com": iconOpenai,
  "api.anthropic.com": iconAnthropic,
  "api.deepseek.com": iconDeepseek,
  "openrouter.ai": iconOpenrouter,
  "open.bigmodel.cn": iconBigmodel,
  "api.z.ai": iconZai,
  "api.moonshot.cn": iconKimi,
  "api.moonshot.ai": iconKimi,
  "api.kimi.com": iconKimi,
  "api.kimi.ai": iconKimi,
  "api.minimaxi.com": iconMinimax,
  "api.minimax.io": iconMinimax,
  "dashscope.aliyuncs.com": iconAlibaba,
  "dashscope-intl.aliyuncs.com": iconAlibaba,
  "coding.dashscope.aliyuncs.com": iconAlibaba,
  "token-plan.cn-beijing.maas.aliyuncs.com": iconAlibaba,
  "api.xiaomimimo.com": iconMimo,
  "token-plan-cn.xiaomimimo.com": iconMimo,
  "tokenhub.tencentmaas.com": iconTokenhub,
  "tokenhub-intl.tencentmaas.com": iconTokenhub,
  "ark.cn-beijing.volces.com": iconArk,
  "api.stepfun.com": iconStepfun,
  "api.siliconflow.cn": iconSiliconflow,
  "api.x.ai": iconXai,
  "opencode.ai": iconOpencode,
};
// 品牌标识随供应商持久化（对齐 ZCode config.logo）：清空/改写 Base URL 不丢图标。
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
const TEMPLATE_NAME_TO_LOGO_KEY = Object.fromEntries(
  PROVIDER_TEMPLATES.map((template) => [template.name, template.logoKey]),
);
// 品牌标识不随设置变化（对齐 ZCode config.logo）：
// 优先已持久化 logoKey；旧存档按模板名称回填，其次按加载时的 URL 主机固定下来。
export const inferProviderLogoKey = (provider) => {
  if (provider?.logoKey) return provider.logoKey;
  const byName = TEMPLATE_NAME_TO_LOGO_KEY[provider?.name];
  if (byName) return byName;
  try {
    const url = new URL(provider?.baseUrl || "");
    return HOST_TO_LOGO_KEY[url.hostname];
  } catch {
    return undefined;
  }
};
export const resolveProviderLogo = (baseUrl, logoKey) => {
  if (logoKey && LOGO_ASSETS[logoKey]) return LOGO_ASSETS[logoKey];
  try {
    const url = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return BRAND_ASSETS[url.hostname] || null;
  } catch {
    return null;
  }
};
function ProviderIcon({ baseUrl, logoKey, customTemplate = false }) {
  const src = resolveProviderLogo(baseUrl, logoKey);
  const [failedSrc, setFailedSrc] = React.useState(null);
  return (
    <span
      className={`model-settings__avatar${customTemplate ? " model-settings__avatar--custom" : ""}`}
    >
      {customTemplate ? (
        <Plus size={18} aria-hidden="true" />
      ) : src && failedSrc !== src ? (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <Package size={22} aria-hidden="true" />
      )}
    </span>
  );
}
// 对齐 ZCode ProviderApiFormatSelect / select.tsx：浅色 popover、选中行右侧对勾、
// 高亮行 menu-hover 灰底（不用 antd 深色选中填充），含 Responses 协议入口。
const API_FORMATS = [
  { value: "anthropic", label: "Anthropic Messages (/v1/messages)" },
  { value: "openai", label: "Chat Completions (/chat/completions)" },
  { value: "openai-responses", label: "Responses (/responses)" },
];
function ApiFormatSelect({ value, onChange, disabled }) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const rootRef = React.useRef(null);
  const current = API_FORMATS.find((format) => format.value === value) || API_FORMATS[0];
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const openList = () => {
    setActiveIndex(Math.max(0, API_FORMATS.findIndex((format) => format.value === value)));
    setOpen(true);
  };
  const commit = (format) => {
    onChange(format.value);
    setOpen(false);
  };
  const onListKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => {
        const next = index + (event.key === "ArrowDown" ? 1 : -1);
        return (next + API_FORMATS.length) % API_FORMATS.length;
      });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(API_FORMATS[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };
  return (
    <div className="model-settings__format" ref={rootRef}>
      <button
        type="button"
        className="model-settings__format-trigger"
        aria-label="API 协议"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openList();
          }
        }}
      >
        <span className="model-settings__format-value">{current.label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="model-settings__format-popover"
          role="listbox"
          aria-label="API 格式"
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          ref={(node) => node?.focus()}
        >
          {API_FORMATS.map((format, index) => (
            <div
              key={format.value}
              role="option"
              aria-selected={format.value === value}
              className={`model-settings__format-option${index === activeIndex ? " is-active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(format)}
            >
              <span className="model-settings__format-option-label">{format.label}</span>
              {format.value === value && (
                <Check size={16} className="model-settings__format-check" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const uuid = () => `custom-${crypto.randomUUID()}`;
// 与 ZCode ProviderStatusIndicator 一致的展示映射：ready 绿 / unavailable 橙 / disabled 灰。
// 自定义供应商以配置完整性判定（API Key + 至少一个启用模型），不做实时联网检查。
export const resolveProviderStatus = (provider) => {
  if (provider?.enabled === false) return "disabled";
  return provider?.apiKey?.trim() &&
    provider.models?.some((model) => model.enabled !== false)
    ? "ready"
    : "unavailable";
};
const STATUS_LABEL = {
  ready: "供应商可用",
  unavailable: "供应商未配置完成：需要 API Key 和至少一个启用的模型",
  disabled: "供应商已禁用",
};
function ProviderStatusDot({ status }) {
  return (
    <span
      className={`model-settings__status model-settings__status--${status}`}
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
    />
  );
}
export const createProvider = (template) => ({
  id: uuid(),
  name: template.name,
  protocol: template.protocol,
  baseUrl: template.baseUrl,
  apiKey: "",
  apiKeyUrl: template.apiKeyUrl || "",
  logoKey: template.logoKey,
  enabled: true,
  // 对齐 ZCode：模板自带内置模型目录（含上下文/识图元数据与默认启用态）。
  models: (template.models || []).map((model) => ({
    id: uuid(),
    name: model.modelId,
    modelId: model.modelId,
    read_image: Boolean(model.read_image),
    context_window_tokens: model.context_window_tokens,
    enabled: model.enabled !== false,
  })),
});
// 存储层（主进程）是唯一校验源，对齐 ZCode：草稿可落盘，非法 URL 等错误以反馈条呈现。
// 反馈条不回显原始 IPC 错误文本，避免把凭据等敏感信息带进 UI。
const saveErrorMessage = (error) => {
  const raw = String(error?.message || error || "");
  if (/url/i.test(raw))
    return "请输入有效的 HTTP/HTTPS Base URL（不含凭据或查询参数）";
  return "写入配置失败，请检查配置后重试。";
};
const clean = (providers) =>
  providers.map((provider) => ({
    ...provider,
    name: provider.name.trim(),
    baseUrl: provider.baseUrl.trim(),
    apiKey: provider.apiKey.trim(),
    models: provider.models.map((model) => ({
      ...model,
      name: model.name.trim(),
      modelId: model.modelId.trim(),
    })),
  }));

export default function ModelSettings() {
  const [providers, setProviders] = React.useState([]);
  const [saved, setSaved] = React.useState("[]");
  const [selected, setSelected] = React.useState(BUILTIN_PROVIDER_ID);
  const [official, setOfficial] = React.useState({
    models: [],
    defaultModel: "",
  });
  const [officialLoading, setOfficialLoading] = React.useState(true);
  const [officialError, setOfficialError] = React.useState("");
  const [officialDisabled, setOfficialDisabled] = React.useState([]);
  const [testingModels, setTestingModels] = React.useState({});
  const [feedback, setFeedback] = React.useState(null);
  const feedbackTimerRef = React.useRef(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [editingModel, setEditingModel] = React.useState(null);
  const [isNewModel, setIsNewModel] = React.useState(false);
  const [modelError, setModelError] = React.useState("");
  const nameInputRef = React.useRef(null);
  const nameBeforeEditRef = React.useRef("");
  const [adding, setAdding] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState("");
  const generation = React.useRef(0);
  const busy = loading;
  const provider = providers.find((item) => item.id === selected);
  // 对齐 ZCode InlineEditableProviderCard：草稿 idle 1.2s 自动保存，
  // 保存过程以 pending/success/failure 反馈条呈现，不再需要手动“保存全部更改”。
  const AUTO_SAVE_IDLE_MS = 1200;
  const providersRef = React.useRef(providers);
  const savedRef = React.useRef("[]");
  const selectedRef = React.useRef(selected);
  const loadedRef = React.useRef(false);
  const saveTimerRef = React.useRef(null);
  const savingRef = React.useRef(false);
  const resaveRef = React.useRef(false);
  React.useEffect(() => {
    providersRef.current = providers;
  }, [providers]);
  React.useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const load = () => {
    const request = ++generation.current;
    loadOfficial(request);
    loadOfficialPrefs(request);
    loadCustom(request);
  };
  const loadOfficialPrefs = async (request) => {
    try {
      const prefs = await window.electronAPI.officialChatModels?.getPrefs();
      if (
        request === generation.current &&
        Array.isArray(prefs?.disabledModelIds)
      )
        setOfficialDisabled(prefs.disabledModelIds);
    } catch {
      // 偏好读取失败时保持全部启用，不阻塞模型列表展示。
    }
  };
  const loadOfficial = async (request) => {
    setOfficialLoading(true);
    setOfficialError("");
    try {
      const result = await getChatModelList();
      const items = result.modelItems?.length
        ? result.modelItems
        : result.models;
      if (!Array.isArray(items)) throw new Error();
      const models = items
        .map((item) =>
          typeof item === "string" ? { model_id: item, name: item } : item,
        )
        .filter((item) => item?.model_id || item?.id);
      if (request === generation.current)
        setOfficial({ models, defaultModel: result.defaultModel || "" });
    } catch {
      if (request === generation.current)
        setOfficialError("加载官方模型失败，请刷新重试。");
    } finally {
      if (request === generation.current) setOfficialLoading(false);
    }
  };
  const loadCustom = async (request) => {
    setLoading(true);
    setError("");
    try {
      const result = await window.electronAPI.customChatModels.listProviders();
      if (request !== generation.current) return;
      if (!Array.isArray(result)) throw new Error();
      // 旧存档迁移：把品牌标识固定下来（模板名称优先，其次加载时 URL 主机），
      // 之后编辑 Base URL 不再改变图标；savedRef 保留原始快照，差异由自动保存落盘一次。
      const withLogos = result.map((item) => {
        if (item.logoKey) return item;
        const logoKey = inferProviderLogoKey(item);
        return logoKey ? { ...item, logoKey } : item;
      });
      setProviders(withLogos);
      providersRef.current = withLogos;
      savedRef.current = JSON.stringify(result);
      setSaved(savedRef.current);
      loadedRef.current = true;
      setLoaded(true);
      setSelected((current) =>
        withLogos.some((item) => item.id === current)
          ? current
          : BUILTIN_PROVIDER_ID,
      );
      setAdding(false);
    } catch (error) {
      console.error("[ModelSettings] listProviders failed", error);
      if (request === generation.current)
        setError(
          /No handler registered/i.test(String(error?.message || error))
            ? "主进程尚未就绪（开发模式热重启中），请点击刷新重试。当前草稿已保留。"
            : "加载供应商失败，请重试。当前草稿已保留。",
        );
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };
  React.useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, []);
  // 官方模型开关跨窗口同步：主窗口聊天选择器与设置页共用同一份持久化偏好。
  React.useEffect(() => {
    const unsubscribe = window.electronAPI.officialChatModels?.onChanged?.(() =>
      loadOfficialPrefs(generation.current),
    );
    return () => unsubscribe?.();
  }, []);
  const toggleOfficialModel = async (id, enabled) => {
    const previous = officialDisabled;
    const next = enabled
      ? previous.filter((item) => item !== id)
      : [...new Set([...previous, id])];
    setOfficialDisabled(next);
    try {
      await window.electronAPI.officialChatModels.setPrefs({
        disabledModelIds: next,
      });
    } catch {
      setOfficialDisabled(previous);
      setError("保存官方模型开关失败，请重试。");
    }
  };
  // 对齐 ZCode ProviderDetailFeedback：pending 中性不自动消失，success 语义绿 3.5s，
  // failure 语义红 8s，均可手动关闭；同一模型的重复测试复用同一条反馈。
  const dismissFeedback = React.useCallback(() => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
    setFeedback(null);
  }, []);
  const showFeedback = React.useCallback((next, durationMs) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
    setFeedback(next);
    if (durationMs > 0)
      feedbackTimerRef.current = setTimeout(() => {
        feedbackTimerRef.current = null;
        setFeedback(null);
      }, durationMs);
  }, []);
  React.useEffect(
    () => () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    },
    [],
  );
  const testOfficialModel = async (id, modelName) => {
    if (testingModels[id]) return;
    const identity = `流光剪辑 / ${modelName}`;
    setTestingModels((current) => ({ ...current, [id]: true }));
    showFeedback({ state: "pending", message: `正在测试 ${identity}` }, 0);
    try {
      const result = await testChatModel(id);
      if (result.ok) {
        showFeedback(
          { state: "success", emphasis: true, message: `${identity} 连接成功` },
          3500,
        );
      } else {
        showFeedback(
          {
            state: "failure",
            message: `${identity} 连接失败：${result.error || "连接失败"}`,
          },
          8000,
        );
      }
    } catch (error) {
      showFeedback(
        {
          state: "failure",
          message: `${identity} 连接失败：${error?.message || "连接失败"}`,
        },
        8000,
      );
    } finally {
      setTestingModels((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };
  // 自动保存：整份供应商数组一次 IPC 写入；串行化并发请求，
  // 校验失败/IPC 失败都以可重试的 failure 反馈条呈现（对齐 ZCode runSaveOperation）。
  const flushSave = React.useCallback(
    async (snapshot) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const items = snapshot || providersRef.current;
      const serialized = JSON.stringify(items);
      if (!loadedRef.current || serialized === savedRef.current) return;
      if (savingRef.current) {
        resaveRef.current = true;
        return;
      }
      savingRef.current = true;
      const active =
        items.find((item) => item.id === selectedRef.current) ||
        items[items.length - 1];
      const label = active?.name?.trim() || "未命名供应商";
      showFeedback({ state: "pending", message: `正在保存 ${label}` }, 0);
      try {
        const payload = clean(items);
        await window.electronAPI.customChatModels.saveProviders(payload);
        savedRef.current = serialized;
        setSaved(serialized);
        showFeedback({ state: "success", message: `${label} 保存成功` }, 3500);
      } catch (error) {
        showFeedback(
          {
            state: "failure",
            message: `${label} 保存失败：${saveErrorMessage(error)}`,
            actionLabel: "重试",
            onAction: () => void flushSave(),
          },
          8000,
        );
      } finally {
        savingRef.current = false;
        if (resaveRef.current) {
          resaveRef.current = false;
          void flushSave();
        }
      }
    },
    [showFeedback],
  );
  React.useEffect(() => {
    if (!loaded || JSON.stringify(providers) === saved) return undefined;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave();
    }, AUTO_SAVE_IDLE_MS);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [providers, saved, loaded, flushSave]);
  // 卸载（关闭设置页/退出）前兜底提交未落盘草稿。
  React.useEffect(() => () => void flushSave(), [flushSave]);
  // 自定义模型连接测试：主进程 IPC 发起真实请求（渲染进程 fetch 受 CORS 限制）。
  const testCustomModel = async (targetProvider, model) => {
    const testKey = `${targetProvider.id}:${model.id}`;
    if (testingModels[testKey]) return;
    const identity = `${targetProvider.name?.trim() || "未命名供应商"} / ${model.modelId}`;
    setTestingModels((current) => ({ ...current, [testKey]: true }));
    showFeedback({ state: "pending", message: `正在测试 ${identity}` }, 0);
    try {
      const result = await window.electronAPI.customChatModels.testModel({
        baseUrl: targetProvider.baseUrl,
        protocol: targetProvider.protocol,
        apiKey: targetProvider.apiKey,
        modelId: model.modelId,
      });
      if (result.ok) {
        showFeedback(
          { state: "success", emphasis: true, message: `${identity} 连接成功` },
          3500,
        );
      } else {
        showFeedback(
          {
            state: "failure",
            message: `${identity} 连接失败：${result.error || "连接失败"}`,
          },
          8000,
        );
      }
    } catch (error) {
      showFeedback(
        {
          state: "failure",
          message: `${identity} 连接失败：${error?.message || "连接失败"}`,
        },
        8000,
      );
    } finally {
      setTestingModels((current) => {
        const next = { ...current };
        delete next[testKey];
        return next;
      });
    }
  };
  const addFromTemplate = (template) => {
    const next = [...providers, createProvider(template)];
    setProviders(next);
    setSelected(next[next.length - 1].id);
    setAdding(false);
    void flushSave(next);
  };
  const deleteProvider = () => {
    const next = providers.filter((item) => item.id !== selected);
    setProviders(next);
    setSelected(next[0]?.id ?? BUILTIN_PROVIDER_ID);
    void flushSave(next);
  };
  // 删除供应商走全局统一删除确认弹窗（对齐草稿删除样式）。
  const requestDeleteProvider = async () => {
    const target = providers.find((item) => item.id === selected);
    const confirmed = await confirmDelete({
      title: "确认删除供应商",
      content: `删除后不可恢复，确认删除供应商「${target?.name ?? ""}」及其全部模型吗？`,
    });
    if (!confirmed) return;
    deleteProvider();
  };
  const update = (patch) => {
    setProviders((items) =>
      items.map((item) =>
        item.id === selected ? { ...item, ...patch } : item,
      ),
    );
  };
  const updateModel = (id, patch) =>
    update({
      models: provider.models.map((model) =>
        model.id === id ? { ...model, ...patch } : model,
      ),
    });
  // 删除模型同样走全局统一删除确认弹窗。
  const requestDeleteModel = async () => {
    const target = editingModel;
    if (!target) return;
    const confirmed = await confirmDelete({
      title: "确认删除模型",
      content: `删除后不可恢复，确认删除模型「${target.name || target.modelId}」吗？`,
    });
    if (!confirmed) return;
    update({
      models: provider.models.filter((item) => item.id !== target.id),
    });
    setEditingModel(null);
    setModelError("");
  };
  const refresh = (
    <Button
      className="model-settings__refresh"
      aria-label="刷新"
      title="刷新"
      icon={<RefreshCw size={14} />}
      disabled={busy}
      loading={loading}
      onClick={async () => {
        await flushSave();
        load();
      }}
    />
  );
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#18181b",
          borderRadius: 8,
          controlHeight: 34,
          fontSize: 13,
        },
        // 开关尺寸与通用设置页的 small Switch 完全一致（不受 controlHeight 影响）。
        components: {
          Switch: { trackHeightSM: 16, trackMinWidthSM: 28, handleSizeSM: 12 },
        },
      }}
    >
      <section
        className="model-settings"
        aria-label="模型设置"
        aria-busy={busy}
      >
        <header className="model-settings__header">
          <div>
            <p>管理自定义模型供应商，配置后可在聊天时选择使用。</p>
          </div>
          <div className="model-settings__actions">
            {refresh}
            <Button
              type="primary"
              icon={<Plus size={16} />}
              disabled={busy || !loaded}
              onClick={() => setAdding(true)}
              style={{ marginRight: 2 }}
            >
              添加供应商
            </Button>
          </div>
        </header>
        {error && <Alert type="error" showIcon message={error} />}
        <div className="model-settings__layout">
          <aside className="model-settings__sidebar">
            <div className="model-settings__eyebrow">流光剪辑</div>
            <Tooltip title="流光剪辑" {...NAV_TOOLTIP_PROPS}>
              <button
                data-provider-id={BUILTIN_PROVIDER_ID}
                className={`model-settings__provider ${selected === BUILTIN_PROVIDER_ID && !adding ? "is-active" : ""}`}
                onClick={() => {
                  setSelected(BUILTIN_PROVIDER_ID);
                  setAdding(false);
                }}
              >
                <span className="model-settings__avatar">
                  <img src={OFFICIAL_LOGO} alt="" aria-hidden="true" />
                </span>
                <span className="model-settings__provider-name">
                  <strong>流光剪辑</strong>
                </span>
                {/* 内置供应商始终可用，状态点固定绿色。 */}
                <ProviderStatusDot status="ready" />
              </button>
            </Tooltip>
            {/* 与 ZCode Navigation 一致：没有自定义供应商时整组（标题+空态）不渲染。 */}
            {providers.length > 0 && (
              <>
                <div className="model-settings__eyebrow model-settings__custom-heading">
                  自定义供应商
                </div>
                {providers.map((item) => (
                  <Tooltip
                    key={item.id}
                    title={item.name || "未命名供应商"}
                    {...NAV_TOOLTIP_PROPS}
                  >
                    <button
                      disabled={busy}
                      className={`model-settings__provider ${selected === item.id && !adding ? "is-active" : ""}`}
                      onClick={() => {
                        setSelected(item.id);
                        setAdding(false);
                      }}
                    >
                      <ProviderIcon baseUrl={item.baseUrl} logoKey={inferProviderLogoKey(item)} />
                      <span className="model-settings__provider-name">
                        <strong>{item.name || "未命名供应商"}</strong>
                      </span>
                      <ProviderStatusDot status={resolveProviderStatus(item)} />
                    </button>
                  </Tooltip>
                ))}
              </>
            )}
          </aside>
          <main className="model-settings__detail">
            {adding ? (
              <>
                <div className="model-settings__picker-heading">
                  <Button
                    type="text"
                    aria-label="返回供应商设置"
                    disabled={busy}
                    icon={<ArrowLeft size={16} aria-hidden="true" />}
                    onClick={() => setAdding(false)}
                  />
                  <h2>添加供应商</h2>
                </div>
                {/* 单一大网格：自定义入口置顶，智谱与其他模板合并展示，不再分组标题。 */}
                <div className="model-settings__template-grid">
                  <button
                    disabled={busy}
                    className="model-settings__template"
                    onClick={() =>
                      addFromTemplate({
                        name: "新供应商",
                        protocol: "openai",
                        baseUrl: "",
                      })
                    }
                  >
                    <ProviderIcon baseUrl="" customTemplate />
                    <strong>创建自定义供应商</strong>
                    <ChevronRight
                      className="model-settings__template-chevron"
                      size={16}
                      aria-hidden="true"
                    />
                  </button>
                  {PROVIDER_TEMPLATES.map((template) => (
                    <button
                      key={template.name}
                      disabled={busy}
                      className="model-settings__template"
                      onClick={() => addFromTemplate(template)}
                    >
                      <ProviderIcon baseUrl={template.baseUrl} logoKey={template.logoKey} />
                      <strong>{template.name}</strong>
                      <ChevronRight
                        className="model-settings__template-chevron"
                        size={16}
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              </>
            ) : selected === BUILTIN_PROVIDER_ID ? (
              <div
                className="model-settings__official"
                aria-busy={officialLoading}
              >
                <div className="model-settings__section-heading model-settings__official-heading">
                  <div className="model-settings__official-brand">
                    <span className="model-settings__avatar">
                      <img src={OFFICIAL_LOGO} alt="" aria-hidden="true" />
                    </span>
                    <h2>流光剪辑</h2>
                  </div>
                </div>
                <h3
                  className="model-settings__official-list-heading"
                  id="official-model-list-heading"
                >
                  模型列表
                </h3>
                {officialError && (
                  <Alert type="error" showIcon message={officialError} />
                )}
                {officialLoading ? (
                  <div className="model-settings__empty">正在加载官方模型…</div>
                ) : (
                  <>
                    {!official.models.length && !officialError && (
                      <div className="model-settings__empty">暂无官方模型</div>
                    )}
                    {official.models.length > 0 && (
                      <ul
                        className="model-settings__official-list"
                        aria-labelledby="official-model-list-heading"
                      >
                        {official.models.map((model) => {
                          const id = model.model_id || model.id;
                          const context = formatContextWindow(
                            model.context_window_tokens,
                          );
                          const testing = Boolean(testingModels[id]);
                          return (
                            <li
                              className="model-settings__official-model"
                              key={id}
                            >
                              <span
                                className="model-settings__official-name"
                                title={id}
                              >
                                {model.name || id}
                              </span>
                              {context && (
                                <span
                                  className="model-settings__context-badge"
                                  title={`上下文窗口：${model.context_window_tokens} tokens`}
                                >
                                  {context}
                                </span>
                              )}
                              {model.read_image === true && (
                                <span className="model-settings__vision-badge">
                                  视觉
                                </span>
                              )}
                              <span className="model-settings__official-actions">
                                <Tooltip
                                  title={testing ? "测试中" : "测试模型"}
                                  {...NAV_TOOLTIP_PROPS}
                                  placement="top"
                                >
                                  <Button
                                    size="small"
                                    type="text"
                                    className="model-settings__test"
                                    aria-label="测试模型"
                                    disabled={testing}
                                    icon={
                                      testing ? (
                                        <Loader2
                                          size={14}
                                          className="model-settings__spin"
                                          aria-hidden="true"
                                        />
                                      ) : (
                                        <Unplug size={14} aria-hidden="true" />
                                      )
                                    }
                                    onClick={() =>
                                      testOfficialModel(id, model.name || id)
                                    }
                                  />
                                </Tooltip>
                                <Switch
                                  size="small"
                                  aria-label={`启用官方模型 ${model.name || id}`}
                                  checked={!officialDisabled.includes(id)}
                                  onChange={(checked) =>
                                    toggleOfficialModel(id, checked)
                                  }
                                />
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </div>
            ) : provider ? (
              <>
                {/* 对齐 ZCode ProviderCardHeader：图标 + 行内可编辑名称，右侧供应商开关 + …菜单（重命名/删除）。 */}
                <div className="model-settings__provider-header">
                  <div className="model-settings__provider-header-name">
                    <ProviderIcon baseUrl={provider.baseUrl} logoKey={inferProviderLogoKey(provider)} />
                    <input
                      ref={nameInputRef}
                      className="model-settings__name-input"
                      aria-label="供应商名称"
                      value={provider.name}
                      placeholder="新供应商"
                      disabled={busy}
                      onChange={(e) => update({ name: e.target.value })}
                      onFocus={(e) => {
                        nameBeforeEditRef.current = e.target.value;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          update({ name: nameBeforeEditRef.current });
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                  <div className="model-settings__provider-header-actions">
                    <Tooltip
                      title={
                        provider.enabled === false ? "启用供应商" : "禁用供应商"
                      }
                      {...NAV_TOOLTIP_PROPS}
                      placement="top"
                    >
                      <Switch
                        size="small"
                        aria-label={
                          provider.enabled === false
                            ? "启用供应商"
                            : "禁用供应商"
                        }
                        checked={provider.enabled !== false}
                        disabled={busy}
                        onChange={(enabled) => update({ enabled })}
                      />
                    </Tooltip>
                    <Dropdown
                      open={menuOpen}
                      onOpenChange={setMenuOpen}
                      trigger={["click"]}
                      disabled={busy}
                      dropdownRender={() => (
                        <div className="model-settings__menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            className="model-settings__menu-item"
                            onClick={() => {
                              setMenuOpen(false);
                              nameInputRef.current?.focus();
                            }}
                          >
                            <Pencil size={14} aria-hidden="true" />
                            重命名
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="model-settings__menu-item model-settings__menu-item--danger"
                            onClick={() => {
                              setMenuOpen(false);
                              void requestDeleteProvider();
                            }}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            删除
                          </button>
                        </div>
                      )}
                    >
                      <Button
                        type="text"
                        aria-label="更多操作"
                        disabled={busy}
                        icon={<MoreHorizontal size={16} aria-hidden="true" />}
                      />
                    </Dropdown>
                  </div>
                </div>
                <fieldset disabled={busy} className="model-settings__fields">
                  <Form layout="vertical" component="div">
                    <Form.Item label="Base URL">
                      <Input
                        aria-label="Base URL"
                        placeholder="https://api.example.com/v1"
                        value={provider.baseUrl}
                        onChange={(e) => update({ baseUrl: e.target.value })}
                      />
                    </Form.Item>
                    <Form.Item label="API 格式">
                      <ApiFormatSelect
                        value={provider.protocol}
                        disabled={busy}
                        onChange={(protocol) => update({ protocol })}
                      />
                    </Form.Item>
                    <Form.Item
                      label={
                        <span className="model-settings__key-label">
                          API Key
                          {provider.apiKeyUrl ? (
                            <a
                              className="model-settings__key-link"
                              href={provider.apiKeyUrl}
                              onClick={(event) => {
                                event.preventDefault();
                                // 兼容旧 preload：electronAPI.openExternal 曾为 undefined，
                                // 回退到 api.shell.openExternal（两版 preload 均已暴露）。
                                const openExternal =
                                  window.electronAPI?.openExternal ||
                                  window.api?.shell?.openExternal;
                                openExternal?.(provider.apiKeyUrl);
                              }}
                            >
                              获取 API Key
                            </a>
                          ) : null}
                        </span>
                      }
                    >
                      <Input.Password
                        aria-label="API Key"
                        placeholder="输入 API Key"
                        autoComplete="new-password"
                        value={provider.apiKey}
                        onChange={(e) => update({ apiKey: e.target.value })}
                      />
                    </Form.Item>
                  </Form>
                </fieldset>
                <div className="model-settings__section-heading model-settings__models-heading">
                  <h3>模型列表</h3>
                  <Button
                    disabled={busy}
                    icon={<Plus size={14} aria-hidden="true" />}
                    onClick={() => {
                      setEditingModel({
                        id: uuid(),
                        name: "",
                        modelId: "",
                        read_image: false,
                        enabled: true,
                      });
                      setIsNewModel(true);
                    }}
                  >
                    添加模型
                  </Button>
                </div>
                {!provider.models.length && (
                  <div className="model-settings__empty model-settings__empty--info">
                    <Info size={14} aria-hidden="true" />
                    当前没有配置模型，添加模型后可在聊天中使用。
                  </div>
                )}
                {provider.models.length > 0 && (
                  <ul className="model-settings__official-list">
                    {provider.models.map((model, index) => {
                      const testKey = `${provider.id}:${model.id}`;
                      const testing = Boolean(testingModels[testKey]);
                      const context = formatContextWindow(
                        model.context_window_tokens,
                      );
                      return (
                        <li
                          className="model-settings__official-model"
                          key={model.id}
                        >
                          <span
                            className="model-settings__custom-model-id"
                            title={model.modelId}
                          >
                            {model.modelId || "未命名模型"}
                          </span>
                          {context && (
                            <span
                              className="model-settings__context-badge"
                              title={`上下文窗口：${model.context_window_tokens} tokens`}
                            >
                              {context}
                            </span>
                          )}
                          {model.read_image === true && (
                            <span className="model-settings__vision-badge">
                              视觉
                            </span>
                          )}
                          <span className="model-settings__official-actions">
                            <Tooltip
                              title={testing ? "测试中" : "测试模型"}
                              {...NAV_TOOLTIP_PROPS}
                              placement="top"
                            >
                              <Button
                                size="small"
                                type="text"
                                className="model-settings__test"
                                aria-label={`测试模型 ${model.modelId || index + 1}`}
                                disabled={
                                  testing ||
                                  !model.modelId?.trim() ||
                                  !provider.apiKey?.trim()
                                }
                                icon={
                                  testing ? (
                                    <Loader2
                                      size={14}
                                      className="model-settings__spin"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <Unplug size={14} aria-hidden="true" />
                                  )
                                }
                                onClick={() => testCustomModel(provider, model)}
                              />
                            </Tooltip>
                            <Tooltip
                              title="编辑模型"
                              {...NAV_TOOLTIP_PROPS}
                              placement="top"
                            >
                              <Button
                                size="small"
                                type="text"
                                className="model-settings__test"
                                aria-label={`编辑模型 ${index + 1}`}
                                icon={<Pencil size={14} aria-hidden="true" />}
                                onClick={() => {
                                  setEditingModel({ ...model });
                                  setIsNewModel(false);
                                }}
                              />
                            </Tooltip>
                            <Switch
                              aria-label={`启用模型 ${index + 1}`}
                              size="small"
                              disabled={busy}
                              checked={model.enabled !== false}
                              onChange={(enabled) =>
                                updateModel(model.id, { enabled })
                              }
                            />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Modal
                  open={Boolean(editingModel)}
                  title={isNewModel ? "添加模型" : "编辑模型"}
                  okText="保存"
                  cancelText="取消"
                  onOk={() => {
                    const draft = {
                      ...editingModel,
                      name: editingModel.name.trim(),
                      modelId: editingModel.modelId.trim(),
                    };
                    if (!draft.modelId) {
                      setModelError("请输入模型 ID");
                      return;
                    }
                    if (isNewModel) {
                      update({ models: [...provider.models, draft] });
                    } else {
                      updateModel(draft.id, draft);
                    }
                    setEditingModel(null);
                    setModelError("");
                  }}
                  onCancel={() => {
                    setEditingModel(null);
                    setModelError("");
                  }}
                  footer={(_, { OkBtn, CancelBtn }) => (
                    <div className="model-settings__model-modal-footer">
                      {!isNewModel && (
                        <Button danger onClick={() => void requestDeleteModel()}>
                          删除模型
                        </Button>
                      )}
                      <span className="model-settings__model-modal-spacer" />
                      <CancelBtn />
                      <OkBtn />
                    </div>
                  )}
                >
                  {editingModel && (
                    <Form layout="vertical" component="div">
                      <Form.Item label="模型 ID" required>
                        <Input
                          aria-label="模型 ID"
                          value={editingModel.modelId}
                          onChange={(e) =>
                            setEditingModel({
                              ...editingModel,
                              modelId: e.target.value,
                            })
                          }
                        />
                      </Form.Item>
                      <Form.Item label="模型名称">
                        <Input
                          aria-label="模型名称"
                          value={editingModel.name}
                          onChange={(e) =>
                            setEditingModel({
                              ...editingModel,
                              name: e.target.value,
                            })
                          }
                        />
                      </Form.Item>
                      <Form.Item label="上下文窗口（tokens）">
                        <Input
                          aria-label="上下文窗口"
                          inputMode="numeric"
                          value={editingModel.context_window_tokens ?? ""}
                          onChange={(e) => {
                            const parsed = Number(e.target.value);
                            setEditingModel({
                              ...editingModel,
                              context_window_tokens:
                                e.target.value.trim() &&
                                Number.isSafeInteger(parsed) &&
                                parsed > 0
                                  ? parsed
                                  : undefined,
                            });
                          }}
                        />
                      </Form.Item>
                      <Checkbox
                        checked={Boolean(editingModel.read_image)}
                        onChange={(e) =>
                          setEditingModel({
                            ...editingModel,
                            read_image: e.target.checked,
                          })
                        }
                      >
                        支持识图
                      </Checkbox>
                      {modelError && (
                        <Alert type="error" showIcon message={modelError} />
                      )}
                    </Form>
                  )}
                </Modal>
              </>
            ) : (
              <div className="model-settings__empty">
                <h2>{loading ? "正在加载供应商…" : "连接你的模型服务"}</h2>
                <p>点击“添加供应商”开始配置。</p>
              </div>
            )}
            {/* 对齐 ZCode ProviderDetailFeedbackBoundary：不占高度的覆盖层 + sticky 底部反馈条。 */}
            {feedback && (
              <div className="model-settings__feedback-layer">
                <div
                  className="model-settings__feedback-viewport"
                  aria-live="polite"
                >
                  <div
                    role={feedback.state === "failure" ? "alert" : "status"}
                    className={`model-settings__feedback model-settings__feedback--${feedback.state}${feedback.state === "success" && !feedback.emphasis ? " model-settings__feedback--neutral" : ""}`}
                  >
                    {feedback.state === "pending" ? (
                      <Loader2
                        size={16}
                        className="model-settings__spin"
                        aria-hidden="true"
                      />
                    ) : feedback.state === "success" ? (
                      <CheckCircle2 size={16} aria-hidden="true" />
                    ) : (
                      <CircleAlert size={16} aria-hidden="true" />
                    )}
                    <span className="model-settings__feedback-message">
                      {feedback.message}
                    </span>
                    {feedback.actionLabel && feedback.onAction && (
                      <Button
                        size="small"
                        type="text"
                        className="model-settings__feedback-action"
                        onClick={feedback.onAction}
                      >
                        {feedback.actionLabel}
                      </Button>
                    )}
                    {feedback.state !== "pending" && (
                      <button
                        type="button"
                        className="model-settings__feedback-close"
                        aria-label="关闭"
                        onClick={dismissFeedback}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </section>
    </ConfigProvider>
  );
}
