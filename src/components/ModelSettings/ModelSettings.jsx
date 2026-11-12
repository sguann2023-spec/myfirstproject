import React from "react";
import {
  ArrowLeft,
  ChevronRight,
  Package,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  Alert,
  Button,
  Checkbox,
  ConfigProvider,
  Form,
  Input,
  Popconfirm,
  Select,
  Switch,
} from "antd";
import "./ModelSettings.css";
import { getCurrentChannelBrandConfig } from "../../../channel-branding/runtime";

const OFFICIAL_LOGO = getCurrentChannelBrandConfig().runtimeAssets.aboutLogo;
const formatContextWindow = (tokens) => {
  if (!Number.isSafeInteger(tokens) || tokens <= 0) return null;
  if (tokens >= 1000000) return `${Number((tokens / 1000000).toFixed(1))}M`;
  if (tokens >= 1000) return `${Number((tokens / 1000).toFixed(1))}K`;
  return String(tokens);
};
import { getChatModelList } from "../../api/chat.js";

export const BUILTIN_PROVIDER_ID = "builtin-vectcut";

export const PROVIDER_TEMPLATES = [
  { name: "自定义供应商", protocol: "openai", baseUrl: "" },
  { name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1" },
  {
    name: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
  },
  {
    name: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    name: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    name: "智谱 BigModel",
    protocol: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  { name: "Kimi", protocol: "openai", baseUrl: "https://api.moonshot.cn/v1" },
  {
    name: "MiniMax",
    protocol: "anthropic",
    baseUrl: "https://api.minimaxi.com/anthropic",
  },
  {
    name: "阿里云百炼",
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
];
// Original assets copied from ZCode-main/packages/ui/src/assets/provider-icons.
// Exact endpoint hosts identify brands independently of the editable display name.
const BRAND_ASSETS = {
  "api.openai.com": "model-provider-openai.png",
  "api.anthropic.com": "model-provider-anthropic.png",
  "api.deepseek.com": "model-provider-deepseek.png",
  "openrouter.ai": "model-provider-openrouter-light.svg",
  "open.bigmodel.cn": "logo-bigmodel.svg",
  "api.moonshot.cn": "model-provider-moonshot-kimi.png",
  "api.moonshot.ai": "model-provider-moonshot-kimi.png",
  "api.minimaxi.com": "model-provider-minimax.png",
  "api.minimax.io": "model-provider-minimax.png",
  "dashscope.aliyuncs.com": "model-provider-alibaba-cloud.png",
};
export const resolveProviderLogo = (baseUrl) => {
  try {
    const url = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    const asset = BRAND_ASSETS[url.hostname];
    return asset
      ? `${process.env.PUBLIC_URL || ""}/provider-icons/${asset}`
      : null;
  } catch {
    return null;
  }
};
function ProviderIcon({ baseUrl, customTemplate = false }) {
  const src = resolveProviderLogo(baseUrl);
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
const uuid = () => `custom-${crypto.randomUUID()}`;
export const createProvider = (template) => ({
  id: uuid(),
  name: template.name,
  protocol: template.protocol,
  baseUrl: template.baseUrl,
  apiKey: "",
  models: [],
});
export const validateProvider = (provider) => {
  if (!provider.name?.trim()) return "请输入供应商名称";
  if (!["openai", "anthropic"].includes(provider.protocol))
    return "请选择有效协议";
  try {
    const url = new URL(provider.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    return "请输入有效的 HTTP/HTTPS Base URL（不含凭据或查询参数）";
  }
  if (/\/(chat\/completions|messages)\/?$/.test(provider.baseUrl))
    return "请填写基础地址，而非完整的请求端点";
  if (!provider.apiKey?.trim()) return "请输入 API Key";
  for (const model of provider.models) {
    if (!model.name?.trim()) return "请输入模型名称";
    if (!model.modelId?.trim()) return "请输入模型 ID";
  }
  return "";
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
  const [adding, setAdding] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const generation = React.useRef(0);
  const dirty = JSON.stringify(providers) !== saved;
  const busy = loading || saving;
  const provider = providers.find((item) => item.id === selected);
  const load = () => {
    const request = ++generation.current;
    loadOfficial(request);
    loadCustom(request);
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
    setNotice("");
    try {
      const result = await window.electronAPI.customChatModels.listProviders();
      if (request !== generation.current) return;
      if (!Array.isArray(result)) throw new Error();
      setProviders(result);
      setSaved(JSON.stringify(result));
      setLoaded(true);
      setSelected((current) =>
        result.some((item) => item.id === current)
          ? current
          : BUILTIN_PROVIDER_ID,
      );
      setAdding(false);
    } catch {
      if (request === generation.current)
        setError("加载供应商失败，请重试。当前草稿已保留。");
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
  React.useEffect(() => {
    const prevent = (event) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const update = (patch) => {
    setNotice("");
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
  const save = async () => {
    setError("");
    setNotice("");
    for (let index = 0; index < providers.length; index += 1) {
      const message = validateProvider(providers[index]);
      if (message) {
        setSelected(providers[index].id);
        setAdding(false);
        setError(`供应商 ${index + 1}：${message}`);
        return;
      }
    }
    setSaving(true);
    try {
      const payload = clean(providers);
      await window.electronAPI.customChatModels.saveProviders(payload);
      setProviders(payload);
      setSaved(JSON.stringify(payload));
      setNotice("已保存全部供应商");
    } catch {
      setError("保存失败，请检查配置后重试。当前草稿已保留。");
    } finally {
      setSaving(false);
    }
  };
  const refresh = (
    <Button
      className="model-settings__refresh"
      aria-label="刷新"
      title="刷新"
      icon={<RefreshCw size={14} />}
      disabled={busy}
      loading={loading}
      onClick={dirty ? undefined : load}
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
            {dirty ? (
              <Popconfirm
                title="放弃未保存的更改并刷新？"
                okText="放弃并刷新"
                cancelText="取消"
                onConfirm={load}
              >
                {refresh}
              </Popconfirm>
            ) : (
              refresh
            )}
            <Button
              type="primary"
              icon={<Plus size={16} />}
              disabled={busy || !loaded}
              onClick={() => setAdding(true)}
            >
              添加供应商
            </Button>
          </div>
        </header>
        {error && <Alert type="error" showIcon message={error} />}
        {notice && <Alert type="success" message={notice} />}
        <div className="model-settings__layout">
          <aside className="model-settings__sidebar">
            <div className="model-settings__eyebrow">
              内置供应商
            </div>
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
              <span>
                <strong>流光剪辑</strong>
              </span>
            </button>
            <div className="model-settings__eyebrow model-settings__custom-heading">
              自定义供应商
            </div>
            {providers.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                className={`model-settings__provider ${selected === item.id && !adding ? "is-active" : ""}`}
                onClick={() => {
                  setSelected(item.id);
                  setAdding(false);
                }}
              >
                <ProviderIcon baseUrl={item.baseUrl} />
                <span>
                  <strong>{item.name || "未命名供应商"}</strong>
                </span>
              </button>
            ))}
            {!providers.length && (
              <p className="model-settings__muted">暂无自定义供应商</p>
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
                <div className="model-settings__templates">
                  {PROVIDER_TEMPLATES.map((template) => (
                    <button
                      key={template.name}
                      disabled={busy}
                      className="model-settings__template"
                      onClick={() => {
                        const next = createProvider(template);
                        setProviders((items) => [...items, next]);
                        setSelected(next.id);
                        setAdding(false);
                        setNotice("");
                      }}
                    >
                      <ProviderIcon
                        baseUrl={template.baseUrl}
                        customTemplate={!template.baseUrl}
                      />
                      <strong>
                        {template.baseUrl ? template.name : "创建自定义供应商"}
                      </strong>
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
                  <span className="model-settings__badge">官方 · 只读</span>
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
                <div className="model-settings__section-heading">
                  <div>
                    <h2>{provider.name || "未命名供应商"}</h2>
                    <p>
                      配置连接信息和可用模型。API Key 仅用于连接服务，请勿分享。
                    </p>
                  </div>
                  <Popconfirm
                    title="确认删除此供应商及其全部模型？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => {
                      setProviders((items) =>
                        items.filter((item) => item.id !== selected),
                      );
                      setSelected(
                        providers.find((item) => item.id !== selected)?.id ??
                          BUILTIN_PROVIDER_ID,
                      );
                      setNotice("");
                    }}
                  >
                    <Button danger disabled={busy}>
                      删除供应商
                    </Button>
                  </Popconfirm>
                </div>
                <fieldset disabled={busy} className="model-settings__fields">
                  <Form layout="vertical" component="div">
                    <div className="model-settings__connection">
                      <Form.Item label="供应商名称" required>
                        <Input
                          aria-label="供应商名称"
                          value={provider.name}
                          onChange={(e) => update({ name: e.target.value })}
                        />
                      </Form.Item>
                      <Form.Item label="API 协议" required>
                        <Select
                          aria-label="API 协议"
                          disabled={busy}
                          value={provider.protocol}
                          options={[
                            {
                              label: "OpenAI Chat Completions",
                              value: "openai",
                            },
                            { label: "Anthropic Messages", value: "anthropic" },
                          ]}
                          onChange={(protocol) => update({ protocol })}
                        />
                      </Form.Item>
                    </div>
                    <Form.Item
                      label="Base URL"
                      required
                      extra={
                        provider.protocol === "anthropic"
                          ? "填写服务根地址，例如 https://api.anthropic.com；不含 /v1/messages。"
                          : "填写 API 基础地址，通常以 /v1 结尾；不含 /chat/completions。"
                      }
                    >
                      <Input
                        aria-label="Base URL"
                        value={provider.baseUrl}
                        onChange={(e) => update({ baseUrl: e.target.value })}
                      />
                    </Form.Item>
                    <Form.Item label="API Key" required>
                      <Input.Password
                        aria-label="API Key"
                        autoComplete="new-password"
                        value={provider.apiKey}
                        onChange={(e) => update({ apiKey: e.target.value })}
                      />
                    </Form.Item>
                  </Form>
                </fieldset>
                <div className="model-settings__section-heading model-settings__models-heading">
                  <div>
                    <h3>模型</h3>
                    <p>添加服务支持的模型 ID，并选择是否在聊天中启用。</p>
                  </div>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      update({
                        models: [
                          ...provider.models,
                          {
                            id: uuid(),
                            name: "",
                            modelId: "",
                            read_image: false,
                            enabled: true,
                          },
                        ],
                      })
                    }
                  >
                    添加模型
                  </Button>
                </div>
                {!provider.models.length && (
                  <div className="model-settings__empty">
                    尚未添加模型。可以先保存供应商，稍后再添加。
                  </div>
                )}
                {provider.models.map((model, index) => (
                  <div className="model-settings__model" key={model.id}>
                    <div className="model-settings__model-inputs">
                      <label>
                        模型名称
                        <Input
                          disabled={busy}
                          aria-label={`模型 ${index + 1} 名称`}
                          value={model.name}
                          onChange={(e) =>
                            updateModel(model.id, { name: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        模型 ID
                        <Input
                          disabled={busy}
                          aria-label={`模型 ${index + 1} ID`}
                          value={model.modelId}
                          onChange={(e) =>
                            updateModel(model.id, { modelId: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <div className="model-settings__model-actions">
                      <Checkbox
                        disabled={busy}
                        checked={Boolean(model.read_image)}
                        onChange={(e) =>
                          updateModel(model.id, {
                            read_image: e.target.checked,
                          })
                        }
                      >
                        支持识图
                      </Checkbox>
                      <label className="model-settings__enable">
                        启用{" "}
                        <Switch
                          aria-label={`启用模型 ${index + 1}`}
                          size="small"
                          disabled={busy}
                          checked={model.enabled !== false}
                          onChange={(enabled) =>
                            updateModel(model.id, { enabled })
                          }
                        />
                      </label>
                      <Popconfirm
                        title="确认删除此模型？"
                        okText="删除"
                        cancelText="取消"
                        onConfirm={() =>
                          update({
                            models: provider.models.filter(
                              (item) => item.id !== model.id,
                            ),
                          })
                        }
                      >
                        <Button size="small" danger disabled={busy}>
                          删除模型 {index + 1}
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="model-settings__empty">
                <h2>{loading ? "正在加载供应商…" : "连接你的模型服务"}</h2>
                <p>点击“添加供应商”开始配置。</p>
              </div>
            )}
          </main>
        </div>
        <footer className="model-settings__footer">
          <span>
            {dirty
              ? "有未保存的更改 · 切换供应商不会丢失草稿"
              : "所有更改已保存"}
          </span>
          <Button
            type="primary"
            disabled={busy || !loaded || !dirty}
            loading={saving}
            onClick={save}
          >
            保存全部更改
          </Button>
        </footer>
      </section>
    </ConfigProvider>
  );
}
