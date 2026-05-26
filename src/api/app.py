import os
import json
import http.client
import base64
import hashlib
import urllib.parse
import mimetypes
import tempfile
import subprocess
from typing import Optional
from flask import Flask, request, jsonify, Response, stream_with_context
import time
import uuid
import socket
from chat_log_db import get_or_create_session, add_message, list_sessions, get_session_messages

app = Flask(__name__)

API_PATH = "/v1/chat/completions"
RESPONSES_API_PATH = "/v1/responses"

# API_HOST = os.getenv("ZAI_API_HOST", "yunwu.ai")
# API_KEY = os.getenv("ZAI_API_KEY", "sk-nHziCptO6JzzdTfq2883F7Dd70174dBaA2FeA6B7414dCcCb")
API_HOST = os.getenv("GEMINI_API_HOST", "yunwu.ai")
API_KEY = os.getenv("YUNWU_API_KEY", "sk-b0tBcXtaJBN0MEfHFf8d2b01Ac9b43D792081571Fc6bFa9a")
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", "sk-OtzxURZvxE1gRvtpnZyRzI05KJbF6sV24cl9cs3lhcMKEmam")
GPT_CODEX_API_KEY = os.getenv("GPT_CODEX_API_KEY", "sk-yZI60arfSv5vKqpZfyvUgmdJY9IElCXL3YeTNMCbr6lXbAx1")
FALLBACK_HOST = os.getenv("ZYAI_API_HOST", "api.zyai.online")
FALLBACK_KEY = os.getenv("ZYAI_API_KEY", "sk-nHziCptO6JzzdTfq2883F7Dd70174dBaA2FeA6B7414dCcCb")
QWEN_API_KEY = os.getenv("QWEN_API_KEY", "sk-57aeec85bb4c4d8691cded44e996a628")
QWEN_API_HOST = os.getenv("QWEN_API_HOST", "dashscope.aliyuncs.com")
QWEN_API_PATH = os.getenv("QWEN_API_PATH", "/compatible-mode/v1/chat/completions")
QWEN_DEFAULT_MODEL = os.getenv("QWEN_DEFAULT_MODEL", "qwen3.6-plus")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-fef3c444441a43c9a68f6b5e155b07c9")
DEEPSEEK_API_HOST = os.getenv("DEEPSEEK_API_HOST", "api.deepseek.com")
DEEPSEEK_API_PATH = os.getenv("DEEPSEEK_API_PATH", "/chat/completions")

# 支持的模型列表（单一真源：MODEL_CONFIG_JSON）
MODEL_PROJECT_ID = {}
MODEL_REGISTRY = {}
MODEL_CONFIG_JSON = {
    "models": [
        {"name": "gemini-3.1-pro-preview", "display_name": "Gemini-3.1-Pro-Preview", "project_id": 16, "provider_id": "gemini", "provider_type": "gemini", "provider_name": "Gemini"},
        {"name": "gemini-3.1-flash-lite-preview", "display_name": "Gemini-3.1-Flash-Lite-Preview", "project_id": 63, "provider_id": "gemini", "provider_type": "gemini", "provider_name": "Gemini"},
        {"name": "deepseek-v4-pro", "display_name": "DeepSeek-V4-Pro", "project_id": 68, "provider_id": "openai", "provider_type": "openai", "provider_name": "OpenAI"},
        {"name": "qwen3.6-plus", "display_name": "Qwen3.6-Plus", "project_id": 49, "provider_id": "openai", "provider_type": "openai", "provider_name": "OpenAI"},
        {"name": "claude-opus-4-7", "display_name": "Claude-Opus-4.7", "project_id": 58, "provider_id": "anthropic", "provider_type": "anthropic", "provider_name": "Anthropic"},
        {"name": "gpt-5.5", "display_name": "GPT-5.5", "project_id": 65, "provider_id": "openai", "provider_type": "openai", "provider_name": "OpenAI"},
    ],
    "default_model": "claude-opus-4-7",
}
PC_MODEL_CONFIG_JSON = {
    "models": [
        {"name": "gemini-3.1-pro-preview", "display_name": "Gemini-3.1-Pro-Preview", "project_id": 16, "provider_id": "gemini", "provider_type": "gemini", "provider_name": "Gemini"},
        {"name": "gemini-3.1-flash-lite-preview", "display_name": "Gemini-3.1-Flash-Lite-Preview", "project_id": 63, "provider_id": "gemini", "provider_type": "gemini", "provider_name": "Gemini"},
        {"name": "deepseek-v4-pro", "display_name": "DeepSeek-V4-Pro", "project_id": 68, "provider_id": "openai", "provider_type": "openai", "provider_name": "OpenAI"},
        {"name": "qwen3.6-plus", "display_name": "Qwen3.6-Plus", "project_id": 49, "provider_id": "openai", "provider_type": "openai", "provider_name": "OpenAI"},
        {"name": "claude-opus-4-7", "display_name": "Claude-Opus-4.7", "project_id": 58, "provider_id": "anthropic", "provider_type": "anthropic", "provider_name": "Anthropic"},
        {"name": "gpt-5.5", "display_name": "GPT-5.5", "project_id": 65, "provider_id": "openai", "provider_type": "openai", "provider_name": "OpenAI"},
    ],
    "default_model": "qwen3.6-plus",
}
conf = MODEL_CONFIG_JSON

MODEL_NAMES = []
DEFAULT_MODEL_NAME = ""
def _infer_provider_meta(model_name: str):
    lower_name = (model_name or "").lower()
    if lower_name.startswith("claude"):
        return {"provider_id": "anthropic", "provider_type": "anthropic", "provider_name": "Anthropic"}
    if lower_name.startswith("gemini"):
        return {"provider_id": "gemini", "provider_type": "gemini", "provider_name": "Gemini"}
    if lower_name.startswith("doubao"):
        return {"provider_id": "doubao", "provider_type": "openai", "provider_name": "Doubao"}
    if lower_name.startswith("minimax"):
        return {"provider_id": "minimax", "provider_type": "openai", "provider_name": "MiniMax"}
    if lower_name.startswith("glm") or lower_name.startswith("chatglm"):
        return {"provider_id": "glm", "provider_type": "openai", "provider_name": "GLM"}
    return {"provider_id": "openai", "provider_type": "openai", "provider_name": "OpenAI"}

for item in conf.get("models") or []:
    name = item.get("name")
    pid = item.get("project_id")
    if isinstance(name, str) and name:
        MODEL_NAMES.append(name)
        if isinstance(pid, int):
            MODEL_PROJECT_ID[name] = pid
        inferred = _infer_provider_meta(name)
        provider_id = str(item.get("provider_id") or inferred["provider_id"]).strip() or inferred["provider_id"]
        provider_type = str(item.get("provider_type") or inferred["provider_type"]).strip() or inferred["provider_type"]
        provider_name = str(item.get("provider_name") or inferred["provider_name"]).strip() or inferred["provider_name"]
        MODEL_REGISTRY[name] = {
            "model_id": name,
            "name": str(item.get("display_name") or item.get("label") or name),
            "provider_id": provider_id,
            "provider_type": provider_type,
            "provider_name": provider_name,
        }
DEFAULT_MODEL_NAME = conf.get("default_model") if isinstance(conf.get("default_model"), str) else ""
if not (isinstance(DEFAULT_MODEL_NAME, str) and DEFAULT_MODEL_NAME in MODEL_NAMES):
    DEFAULT_MODEL_NAME = MODEL_NAMES[0] if MODEL_NAMES else ""
for model_name in MODEL_NAMES:
    if model_name not in MODEL_REGISTRY:
        inferred = _infer_provider_meta(model_name)
        MODEL_REGISTRY[model_name] = {
            "model_id": model_name,
            "name": model_name,
            "provider_id": inferred["provider_id"],
            "provider_type": inferred["provider_type"],
            "provider_name": inferred["provider_name"],
        }

MODEL_BLACK_ICON_URLS = {
    "gemini": "https://player.install-ai-guider.top/example/model_icon/gemini.svg",
    "gpt": "https://player.install-ai-guider.top/example/model_icon/gpt.svg",
    "qwen": "https://player.install-ai-guider.top/example/model_icon/qwen.svg",
    "claude": "https://player.install-ai-guider.top/example/model_icon/claude.svg",
    "deepseek": "https://player.install-ai-guider.top/example/model_icon/deepseek.svg",
}

def _normalize_text(v):
    if v is None:
        return ""
    try:
        return str(v).strip()
    except Exception:
        return ""

def _is_pc_client(client_type: str):
    t = _normalize_text(client_type).lower()
    return t in ("pc", "desktop", "windows", "win", "mac", "macos", "linux")

def _extract_request_client_meta():
    client_type = _normalize_text(
        request.args.get("client_type")
        or request.headers.get("X-Client-Type")
        or request.headers.get("Client-Type")
    )
    version_code = _normalize_text(
        request.args.get("version_code")
        or request.headers.get("X-Version-Code")
    )
    locale = _normalize_text(
        request.args.get("locale")
        or request.args.get("i18n_locale")
        or request.headers.get("X-I18n-Locale")
        or request.headers.get("X-Locale")
    )
    return {
        "client_type": client_type,
        "version_code": version_code,
        "locale": locale,
    }

def _resolve_model_config_for_request():
    meta = _extract_request_client_meta()
    if _is_pc_client(meta.get("client_type")):
        return PC_MODEL_CONFIG_JSON
    return MODEL_CONFIG_JSON

def _build_model_snapshot(model_config: dict):
    names = []
    registry = {}
    default_name = ""
    for item in model_config.get("models") or []:
        name = item.get("name")
        if not (isinstance(name, str) and name):
            continue
        names.append(name)
        inferred = _infer_provider_meta(name)
        provider_id = str(item.get("provider_id") or inferred["provider_id"]).strip() or inferred["provider_id"]
        provider_type = str(item.get("provider_type") or inferred["provider_type"]).strip() or inferred["provider_type"]
        provider_name = str(item.get("provider_name") or inferred["provider_name"]).strip() or inferred["provider_name"]
        registry[name] = {
            "model_id": name,
            "name": str(item.get("display_name") or item.get("label") or name),
            "provider_id": provider_id,
            "provider_type": provider_type,
            "provider_name": provider_name,
        }
    raw_default = model_config.get("default_model")
    if isinstance(raw_default, str) and raw_default in names:
        default_name = raw_default
    elif names:
        default_name = names[0]
    return names, registry, default_name


def _resolve_messages_model(requested_model: str):
    if requested_model in MODEL_NAMES:
        return requested_model
    if isinstance(DEFAULT_MODEL_NAME, str) and DEFAULT_MODEL_NAME:
        return DEFAULT_MODEL_NAME
    return None


def _get_model_black_icon(model_name: str) -> str:
    if not isinstance(model_name, str):
        return ""
    lower_name = model_name.lower()
    if lower_name.startswith("gemini"):
        return MODEL_BLACK_ICON_URLS["gemini"]
    if lower_name.startswith("gpt"):
        return MODEL_BLACK_ICON_URLS["gpt"]
    if lower_name.startswith("qwen"):
        return MODEL_BLACK_ICON_URLS["qwen"]
    if lower_name.startswith("claude"):
        return MODEL_BLACK_ICON_URLS["claude"]
    if lower_name.startswith("deepseek"):
        return MODEL_BLACK_ICON_URLS["deepseek"]
    return ""

TOKEN_BILLING_PROJECT_IDS = {
    "gemini-3.1-pro-preview": {"input": 52, "output": 53},
    "gemini-3.1-flash-lite-preview": {"input": 63, "output": 64},
    "deepseek-v4-pro": {"input": 68, "output": 69},
    "qwen3.6-plus": {"input": 56, "output": 57},
    "claude-opus-4-7": {"input": 58, "output": 59},
    "gpt-5.5": {"input": 65, "output": 66},
}

def _read_int_env(name: str, default_value: int):
    try:
        return int(os.getenv(name, str(default_value)))
    except Exception:
        return default_value

FIRST_TOKEN_TIMEOUT_SECONDS = _read_int_env("LLM_FIRST_TOKEN_TIMEOUT_SECONDS", 300)
TIMEOUT_FALLBACK_MODEL = os.getenv("LLM_TIMEOUT_FALLBACK_MODEL", "qwen3.6-plus")
SAME_MODEL_RETRY_TIMES = _read_int_env("LLM_SAME_MODEL_RETRY_TIMES", 3)
QWEN_THINKING_BUDGET = _read_int_env("QWEN_THINKING_BUDGET", 5000)
DEEPSEEK_REASONING_EFFORT_MAX_BUDGET = _read_int_env("DEEPSEEK_REASONING_EFFORT_MAX_BUDGET", 12000)
# Preserve provider-specific tool metadata (e.g. Gemini thought_signature) across turns.
TOOL_EXTRA_CONTENT_CACHE = {}

def _normalize_tool_call_id(v):
    if not isinstance(v, str):
        return None
    s = v.strip()
    if not s:
        return None
    if ":" in s:
        tail = s.rsplit(":", 1)[-1].strip()
        if tail:
            return tail
    return s

def _cache_tool_extra_content(tool_call_id: object, extra_content: object):
    if not (isinstance(tool_call_id, str) and tool_call_id and isinstance(extra_content, dict)):
        return
    TOOL_EXTRA_CONTENT_CACHE[tool_call_id] = extra_content
    normalized = _normalize_tool_call_id(tool_call_id)
    if isinstance(normalized, str):
        TOOL_EXTRA_CONTENT_CACHE[normalized] = extra_content
    if len(TOOL_EXTRA_CONTENT_CACHE) > 2000:
        try:
            for k in list(TOOL_EXTRA_CONTENT_CACHE.keys())[:500]:
                TOOL_EXTRA_CONTENT_CACHE.pop(k, None)
        except Exception:
            pass

def extract_user_id_from_token(jwt_token):
    try:
        parts = jwt_token.split('.')
        if len(parts) != 3:
            return None
        payload = parts[1]
        payload += '=' * (4 - len(payload) % 4) if len(payload) % 4 != 0 else ''
        try:
            decoded_payload = base64.urlsafe_b64decode(payload).decode('utf-8')
            payload_data = json.loads(decoded_payload)
            return payload_data.get('sub')
        except Exception:
            return None
    except Exception:
        return None

def _http_head_content_type(url: str):
    try:
        parsed = urllib.parse.urlsplit(url)
        conn = http.client.HTTPSConnection(parsed.netloc) if parsed.scheme == "https" else http.client.HTTPConnection(parsed.netloc)
        path = parsed.path + (("?" + parsed.query) if parsed.query else "")
        conn.request("HEAD", path)
        res = conn.getresponse()
        ct = res.getheader("Content-Type")
        conn.close()
        return ct
    except Exception:
        return None
def _guess_mime(url: str):
    try:
        mt, _ = mimetypes.guess_type(url)
        return mt
    except Exception:
        return None
def _download_to_temp(url: str):
    parsed = urllib.parse.urlsplit(url)
    conn = http.client.HTTPSConnection(parsed.netloc) if parsed.scheme == "https" else http.client.HTTPConnection(parsed.netloc)
    path = parsed.path + (("?" + parsed.query) if parsed.query else "")
    conn.request("GET", path)
    res = conn.getresponse()
    data_bin = res.read()
    conn.close()
    suffix = os.path.splitext(parsed.path)[1] or ".bin"
    f = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    f.write(data_bin)
    f.flush()
    f.close()
    return f.name
def _ffmpeg_to_wav(input_path: str):
    out_f = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    out_path = out_f.name
    out_f.close()
    subprocess.run(["ffmpeg", "-y", "-i", input_path, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out_path], check=True)
    return out_path
def _ffmpeg_to_mp3(input_path: str):
    out_f = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
    out_path = out_f.name
    out_f.close()
    subprocess.run(["ffmpeg", "-y", "-i", input_path, "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", out_path], check=True)
    return out_path
def _make_inline_data_from_url(u: str, prefer_wav: bool):
    ct = _http_head_content_type(u)
    guess = _guess_mime(u)
    content_type = ct or guess or "application/octet-stream"
    tmp_in = _download_to_temp(u)
    input_path = tmp_in
    out_mime = content_type
    MAX_INLINE_BYTES = 18 * 1024 * 1024
    try:
        is_video = isinstance(content_type, str) and content_type.startswith("video/")
        too_big = os.path.getsize(tmp_in) > MAX_INLINE_BYTES
        if is_video or too_big:
            mp3_path = _ffmpeg_to_mp3(tmp_in)
            input_path = mp3_path
            out_mime = "audio/mp3"
        elif prefer_wav and isinstance(content_type, str) and content_type.startswith("audio/"):
            wav_path = _ffmpeg_to_wav(tmp_in)
            input_path = wav_path
            out_mime = "audio/wav"
        with open(input_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        return {"inlineData": {"mimeType": out_mime, "data": b64}}, [tmp_in] + ([input_path] if input_path != tmp_in else [])
    except Exception as e:
        try:
            os.unlink(tmp_in)
        except Exception:
            pass
        raise e

def _to_list(v):
    if isinstance(v, list):
        return [x for x in v if isinstance(x, str) and x]
    if isinstance(v, str) and v:
        return [v]
    return []

def _openai_error_response(message: str, status_code: int = 400, err_type: str = "invalid_request_error", param: Optional[str] = None, code: Optional[str] = None):
    return jsonify({
        "error": {
            "message": message,
            "type": err_type,
            "param": param,
            "code": code
        }
    }), status_code

def _anthropic_error_response(message: str, status_code: int = 400, err_type: str = "invalid_request_error"):
    return jsonify({
        "type": "error",
        "error": {
            "type": err_type,
            "message": message
        }
    }), status_code

def _do_fallback_chat_completions(payload_str: str):
    fb_headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if isinstance(FALLBACK_KEY, str) and FALLBACK_KEY:
        fb_headers["Authorization"] = "Bearer " + FALLBACK_KEY
    conn_fb = http.client.HTTPSConnection(FALLBACK_HOST)
    conn_fb.request("POST", API_PATH, body=payload_str, headers=fb_headers)
    res_fb = conn_fb.getresponse()
    body_fb = res_fb.read()
    conn_fb.close()
    try:
        resp_fb_json = json.loads(body_fb.decode("utf-8"))
    except Exception:
        resp_fb_json = {"raw": body_fb.decode("utf-8")}
    return resp_fb_json, res_fb.status

def _do_qwen_chat_completions(payload_str: str):
    qwen_headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if isinstance(QWEN_API_KEY, str) and QWEN_API_KEY:
        qwen_headers["Authorization"] = "Bearer " + QWEN_API_KEY
    conn_qwen = http.client.HTTPSConnection(QWEN_API_HOST)
    conn_qwen.request("POST", QWEN_API_PATH, body=payload_str, headers=qwen_headers)
    res_qwen = conn_qwen.getresponse()
    body_qwen = res_qwen.read()
    conn_qwen.close()
    try:
        resp_qwen_json = json.loads(body_qwen.decode("utf-8"))
    except Exception:
        resp_qwen_json = {"raw": body_qwen.decode("utf-8")}
    return resp_qwen_json, res_qwen.status

def _extract_stream_text(chunk: dict):
    out = []
    try:
        choices = chunk.get("choices")
        if isinstance(choices, list) and choices:
            delta = choices[0].get("delta") or choices[0].get("message") or {}
            content = delta.get("content")
            if isinstance(content, str):
                out.append(content)
            elif isinstance(content, list):
                for item in content:
                    if isinstance(item, dict):
                        t = item.get("text")
                        if isinstance(t, str) and t:
                            out.append(t)
        if not out:
            t = chunk.get("output_text")
            if isinstance(t, str) and t:
                out.append(t)
        if not out:
            event_type = chunk.get("type")
            if isinstance(event_type, str) and event_type.endswith(".delta"):
                d = chunk.get("delta")
                if isinstance(d, str) and d:
                    out.append(d)
            elif isinstance(event_type, str) and event_type.endswith(".done"):
                t2 = chunk.get("text")
                if isinstance(t2, str) and t2:
                    out.append(t2)
    except Exception:
        pass
    return "".join(out)

def _extract_stream_segments(chunk: dict):
    segments = []
    def _add_segment(channel: str, value):
        if isinstance(value, str) and value:
            segments.append((channel, value))
    try:
        choices = chunk.get("choices")
        if isinstance(choices, list) and choices:
            delta = choices[0].get("delta") or choices[0].get("message") or {}
            if isinstance(delta, dict):
                thinking_val = delta.get("reasoning_content")
                if thinking_val is None:
                    thinking_val = delta.get("reasoning")
                if thinking_val is None:
                    thinking_val = delta.get("thinking")
                if isinstance(thinking_val, str):
                    _add_segment("thinking", thinking_val)
                elif isinstance(thinking_val, list):
                    for item in thinking_val:
                        if isinstance(item, dict):
                            _add_segment("thinking", item.get("text") or item.get("content") or item.get("value"))
                content = delta.get("content")
                if isinstance(content, str):
                    _add_segment("text", content)
                elif isinstance(content, list):
                    for item in content:
                        if not isinstance(item, dict):
                            continue
                        itype = item.get("type")
                        t = item.get("text") or item.get("content") or item.get("value")
                        if itype in ("reasoning", "thinking", "thinking_delta"):
                            _add_segment("thinking", t)
                        else:
                            _add_segment("text", t)
        event_type = chunk.get("type")
        if isinstance(event_type, str) and event_type.endswith(".delta"):
            d = chunk.get("delta")
            if isinstance(d, str) and d:
                if ("reasoning" in event_type) or ("thinking" in event_type):
                    _add_segment("thinking", d)
                else:
                    _add_segment("text", d)
        elif isinstance(event_type, str) and event_type.endswith(".done"):
            t2 = chunk.get("text")
            if isinstance(t2, str) and t2:
                if ("reasoning" in event_type) or ("thinking" in event_type):
                    _add_segment("thinking", t2)
                else:
                    _add_segment("text", t2)
        top_reasoning = chunk.get("reasoning_content")
        if isinstance(top_reasoning, str):
            _add_segment("thinking", top_reasoning)
        top_output = chunk.get("output_text")
        if isinstance(top_output, str):
            _add_segment("text", top_output)
    except Exception:
        pass
    return segments

def _extract_text_from_any_content(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                t = item.get("text")
                if isinstance(t, str) and t:
                    parts.append(t)
        return "".join(parts)
    if isinstance(content, dict):
        t2 = content.get("text")
        if isinstance(t2, str):
            return t2
    return ""

def _extract_prompt_completion_tokens_from_usage(usage_obj: object):
    prompt_tokens, completion_tokens = _extract_prompt_completion_tokens(usage_obj)
    cache_read_tokens, cache_write_tokens = _extract_cache_tokens_from_usage(usage_obj)
    return {
        "input_tokens": max(0, prompt_tokens),
        "output_tokens": max(0, completion_tokens),
        "cache_read_input_tokens": max(0, cache_read_tokens),
        "cache_creation_input_tokens": max(0, cache_write_tokens)
    }

def _map_finish_reason_to_anthropic(stop_reason: Optional[str]):
    if stop_reason == "length":
        return "max_tokens"
    if stop_reason in ("tool_calls", "function_call"):
        return "tool_use"
    if stop_reason == "stop":
        return "end_turn"
    return "end_turn"

def _anthropic_block_to_openai_item(block):
    if isinstance(block, str):
        if block:
            return {"type": "text", "text": block}
        return None
    if not isinstance(block, dict):
        return None
    btype = block.get("type")
    cache_control = block.get("cache_control")
    cache_control_obj = cache_control if isinstance(cache_control, dict) else None
    if btype == "text":
        text = block.get("text")
        if isinstance(text, str) and text:
            item = {"type": "text", "text": text}
            if cache_control_obj:
                item["cache_control"] = cache_control_obj
            return item
        return None
    if btype == "image":
        source = block.get("source")
        if isinstance(source, dict):
            stype = source.get("type")
            if stype == "base64":
                media_type = source.get("media_type") or "image/png"
                data_b64 = source.get("data")
                if isinstance(data_b64, str) and data_b64:
                    item = {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{data_b64}"}}
                    if cache_control_obj:
                        item["cache_control"] = cache_control_obj
                    return item
            if stype == "url":
                url = source.get("url")
                if isinstance(url, str) and url:
                    item = {"type": "image_url", "image_url": {"url": url}}
                    if cache_control_obj:
                        item["cache_control"] = cache_control_obj
                    return item
        return None
    if btype == "image_url":
        image_url = block.get("image_url")
        if isinstance(image_url, dict):
            url2 = image_url.get("url")
            if isinstance(url2, str) and url2:
                item = {"type": "image_url", "image_url": {"url": url2}}
                if cache_control_obj:
                    item["cache_control"] = cache_control_obj
                return item
        return None
    return None

def _anthropic_content_to_openai_content(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    items = []
    for block in content:
        mapped = _anthropic_block_to_openai_item(block)
        if mapped:
            items.append(mapped)
    if not items:
        return ""
    if all(
        isinstance(it, dict) and it.get("type") == "text" and not isinstance(it.get("cache_control"), dict)
        for it in items
    ):
        texts = [it.get("text") for it in items if isinstance(it.get("text"), str) and it.get("text")]
        return "\n".join(texts) if texts else ""
    return items

def _anthropic_content_to_reasoning_text(content):
    if not isinstance(content, list):
        return ""
    parts = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "thinking":
            continue
        thinking_text = block.get("thinking")
        if isinstance(thinking_text, str) and thinking_text:
            parts.append(thinking_text)
            continue
        text = block.get("text")
        if isinstance(text, str) and text:
            parts.append(text)
    return "".join(parts)

def _anthropic_tool_to_openai_tool(tool_obj):
    if not isinstance(tool_obj, dict):
        return None
    name = tool_obj.get("name")
    if not isinstance(name, str) or not name:
        return None
    description = tool_obj.get("description")
    input_schema = tool_obj.get("input_schema")
    if not isinstance(input_schema, dict):
        input_schema = {"type": "object", "properties": {}}
    fn = {"name": name, "parameters": input_schema}
    if isinstance(description, str) and description:
        fn["description"] = description
    return {"type": "function", "function": fn}

def _anthropic_tools_to_openai_tools(tools_obj):
    if not isinstance(tools_obj, list):
        return None
    out = []
    for t in tools_obj:
        mapped = _anthropic_tool_to_openai_tool(t)
        if mapped:
            out.append(mapped)
    return out if out else None

def _sanitize_openai_tools_for_model(model_name: str, openai_tools: object):
    """
    Provider compatibility patch:
    Some OpenAI-compatible backends reject/overfit Read.pages for plain text files.
    Strip Read.pages from tool schema on GPT models to avoid invalid pages retries.
    """
    if not (isinstance(model_name, str) and model_name.startswith("gpt")):
        return openai_tools
    if not isinstance(openai_tools, list):
        return openai_tools

    sanitized_tools = []
    sanitized_count = 0
    for tool in openai_tools:
        if not isinstance(tool, dict):
            sanitized_tools.append(tool)
            continue
        fn = tool.get("function")
        if not isinstance(fn, dict):
            sanitized_tools.append(tool)
            continue
        tool_name = fn.get("name")
        parameters = fn.get("parameters")
        if tool_name != "Read" or not isinstance(parameters, dict):
            sanitized_tools.append(tool)
            continue
        properties = parameters.get("properties")
        if not isinstance(properties, dict) or "pages" not in properties:
            sanitized_tools.append(tool)
            continue

        new_tool = dict(tool)
        new_fn = dict(fn)
        new_params = dict(parameters)
        new_properties = dict(properties)
        new_properties.pop("pages", None)
        new_params["properties"] = new_properties

        required = new_params.get("required")
        if isinstance(required, list):
            new_params["required"] = [x for x in required if x != "pages"]

        new_fn["parameters"] = new_params
        new_tool["function"] = new_fn
        sanitized_tools.append(new_tool)
        sanitized_count += 1

    if sanitized_count > 0:
        print(
            "[llm/chat][messages/tools_probe] "
            f"model={model_name} sanitized_read_pages_schema={sanitized_count}"
        )
    return sanitized_tools

def _anthropic_tool_choice_to_openai(tool_choice_obj):
    if tool_choice_obj is None:
        return None
    if isinstance(tool_choice_obj, str):
        v = tool_choice_obj.strip().lower()
        if v in ("auto", "none", "required"):
            return v
        return None
    if not isinstance(tool_choice_obj, dict):
        return None
    t = tool_choice_obj.get("type")
    if t == "auto":
        return "auto"
    if t == "none":
        return "none"
    if t == "any":
        return "required"
    if t == "tool":
        name = tool_choice_obj.get("name")
        if isinstance(name, str) and name:
            return {"type": "function", "function": {"name": name}}
    return None

def _anthropic_tool_result_content_to_text(content_obj, is_error: bool = False):
    if isinstance(content_obj, str):
        txt = content_obj
    elif isinstance(content_obj, list):
        parts = []
        for item in content_obj:
            if isinstance(item, str) and item:
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text":
                t = item.get("text")
                if isinstance(t, str) and t:
                    parts.append(t)
            else:
                try:
                    parts.append(json.dumps(item, ensure_ascii=False))
                except Exception:
                    pass
        txt = "\n".join(parts)
    elif isinstance(content_obj, dict):
        try:
            txt = json.dumps(content_obj, ensure_ascii=False)
        except Exception:
            txt = str(content_obj)
    else:
        txt = ""
    if is_error and txt:
        return "[tool_error] " + txt
    return txt

def _anthropic_system_to_openai_messages(system_obj):
    if isinstance(system_obj, str):
        if system_obj:
            return [{"role": "system", "content": system_obj}]
        return []
    if isinstance(system_obj, list):
        content = _anthropic_content_to_openai_content(system_obj)
        if isinstance(content, str):
            if content:
                return [{"role": "system", "content": content}]
            return []
        if isinstance(content, list) and content:
            return [{"role": "system", "content": content}]
    return []

def _anthropic_messages_to_openai_messages(system_obj, messages_obj):
    out = []
    tool_name_by_call_id = {}
    tool_extra_content_by_call_id = {}
    out.extend(_anthropic_system_to_openai_messages(system_obj))
    if not isinstance(messages_obj, list):
        return out
    for msg in messages_obj:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        if role not in ("user", "assistant"):
            continue
        raw_content = msg.get("content")
        if role == "assistant":
            text_content = _anthropic_content_to_openai_content(raw_content)
            reasoning_content = _anthropic_content_to_reasoning_text(raw_content)
            tool_calls = []
            if isinstance(raw_content, list):
                for block in raw_content:
                    if not isinstance(block, dict) or block.get("type") != "tool_use":
                        continue
                    tool_name = block.get("name")
                    tool_id = block.get("id")
                    tool_input = block.get("input")
                    if not isinstance(tool_name, str) or not tool_name:
                        continue
                    if not isinstance(tool_id, str) or not tool_id:
                        tool_id = "call_" + uuid.uuid4().hex[:24]
                    try:
                        args_s = json.dumps(tool_input if isinstance(tool_input, dict) else {}, ensure_ascii=False)
                    except Exception:
                        args_s = "{}"
                    tool_call_obj = {
                        "id": tool_id,
                        "type": "function",
                        "function": {"name": tool_name, "arguments": args_s},
                    }
                    block_extra_content = block.get("extra_content")
                    if not isinstance(block_extra_content, dict):
                        block_extra_content = TOOL_EXTRA_CONTENT_CACHE.get(tool_id) or TOOL_EXTRA_CONTENT_CACHE.get(
                            _normalize_tool_call_id(tool_id) or ""
                        )
                    if isinstance(block_extra_content, dict):
                        tool_call_obj["extra_content"] = block_extra_content
                        tool_extra_content_by_call_id[tool_id] = block_extra_content
                        _cache_tool_extra_content(tool_id, block_extra_content)
                    tool_calls.append(tool_call_obj)
                    tool_name_by_call_id[tool_id] = tool_name
                    normalized_tool_id = _normalize_tool_call_id(tool_id)
                    if isinstance(normalized_tool_id, str):
                        tool_name_by_call_id[normalized_tool_id] = tool_name
                        if isinstance(block_extra_content, dict):
                            tool_extra_content_by_call_id[normalized_tool_id] = block_extra_content
            msg_obj = {"role": "assistant", "content": text_content}
            if isinstance(reasoning_content, str) and reasoning_content:
                msg_obj["reasoning_content"] = reasoning_content
            if tool_calls:
                msg_obj["tool_calls"] = tool_calls
            out.append(msg_obj)
            continue
        if role == "user" and isinstance(raw_content, list):
            pending_user_blocks = []
            for block in raw_content:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    user_content = _anthropic_content_to_openai_content(pending_user_blocks)
                    if isinstance(user_content, str):
                        if user_content:
                            out.append({"role": "user", "content": user_content})
                    elif isinstance(user_content, list) and user_content:
                        out.append({"role": "user", "content": user_content})
                    pending_user_blocks = []
                    tool_call_id = block.get("tool_use_id")
                    if not isinstance(tool_call_id, str) or not tool_call_id:
                        continue
                    normalized_tool_call_id = _normalize_tool_call_id(tool_call_id)
                    tool_msg = {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": _anthropic_tool_result_content_to_text(
                            block.get("content"),
                            bool(block.get("is_error", False)),
                        ),
                    }
                    # Gemini-compatible tool response expects function_response.name.
                    # Prefer the original tool_use name tracked by tool_call_id.
                    tool_name = tool_name_by_call_id.get(tool_call_id)
                    if not (isinstance(tool_name, str) and tool_name):
                        tool_name = tool_name_by_call_id.get(normalized_tool_call_id)
                    if isinstance(tool_name, str) and tool_name:
                        tool_msg["name"] = tool_name
                    else:
                        # Last fallback for strict providers (e.g. Gemini) requiring non-empty name.
                        tool_msg["name"] = "tool"
                    tool_extra_content = tool_extra_content_by_call_id.get(tool_call_id)
                    if not isinstance(tool_extra_content, dict):
                        tool_extra_content = tool_extra_content_by_call_id.get(normalized_tool_call_id)
                    if not isinstance(tool_extra_content, dict):
                        tool_extra_content = TOOL_EXTRA_CONTENT_CACHE.get(tool_call_id) or TOOL_EXTRA_CONTENT_CACHE.get(
                            normalized_tool_call_id or ""
                        )
                    if isinstance(tool_extra_content, dict):
                        tool_msg["extra_content"] = tool_extra_content
                    out.append(tool_msg)
                else:
                    pending_user_blocks.append(block)
            user_content = _anthropic_content_to_openai_content(pending_user_blocks)
            if isinstance(user_content, str):
                if user_content:
                    out.append({"role": "user", "content": user_content})
            elif isinstance(user_content, list) and user_content:
                out.append({"role": "user", "content": user_content})
            continue
        content = _anthropic_content_to_openai_content(raw_content)
        out.append({"role": role, "content": content})
    return out

def _openai_message_to_anthropic_content(message_obj, message_id: Optional[str] = None):
    blocks = []
    if not isinstance(message_obj, dict):
        return blocks

    reasoning_content = message_obj.get("reasoning_content")
    if isinstance(reasoning_content, str) and reasoning_content:
        thinking_block = {"type": "thinking", "thinking": reasoning_content}
        if isinstance(message_id, str) and message_id:
            thinking_block["signature"] = _build_thinking_signature(message_id, reasoning_content)
        blocks.append(thinking_block)

    content = message_obj.get("content")
    text_val = _extract_text_from_any_content(content)
    if isinstance(text_val, str) and text_val:
        blocks.append({"type": "text", "text": text_val})

    tool_calls = message_obj.get("tool_calls")
    if isinstance(tool_calls, list):
        for tc in tool_calls:
            if not isinstance(tc, dict):
                continue
            call_id = tc.get("id")
            if not isinstance(call_id, str) or not call_id:
                call_id = "toolu_" + uuid.uuid4().hex[:24]
            fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
            tool_name = fn.get("name")
            if not isinstance(tool_name, str) or not tool_name:
                tool_name = "tool"
            args_raw = fn.get("arguments")
            tool_input = {}
            if isinstance(args_raw, str) and args_raw.strip():
                try:
                    parsed = json.loads(args_raw)
                    if isinstance(parsed, dict):
                        tool_input = parsed
                except Exception:
                    tool_input = {"raw": args_raw}
            blocks.append({
                "type": "tool_use",
                "id": call_id,
                "name": tool_name,
                "input": tool_input,
            })
    if not blocks:
        blocks.append({"type": "text", "text": ""})
    return blocks

def _build_anthropic_non_stream_response(openai_json: dict, fallback_model: str):
    choices = openai_json.get("choices") if isinstance(openai_json, dict) else None
    first_choice = choices[0] if isinstance(choices, list) and choices else {}
    message_obj = first_choice.get("message") if isinstance(first_choice, dict) else {}
    usage = _extract_prompt_completion_tokens_from_usage(openai_json.get("usage") if isinstance(openai_json, dict) else {})
    model_name = openai_json.get("model") if isinstance(openai_json, dict) else None
    if not isinstance(model_name, str) or not model_name:
        model_name = fallback_model
    finish_reason = first_choice.get("finish_reason") if isinstance(first_choice, dict) else None
    message_id = "msg_" + uuid.uuid4().hex
    return {
        "id": message_id,
        "type": "message",
        "role": "assistant",
        "model": model_name,
        "content": _openai_message_to_anthropic_content(
            message_obj if isinstance(message_obj, dict) else {},
            message_id
        ),
        "stop_reason": _map_finish_reason_to_anthropic(finish_reason),
        "stop_sequence": None,
        "usage": usage
    }

def _sse_event(event_name: str, payload_obj: dict):
    return (
        "event: " + event_name + "\n" +
        "data: " + json.dumps(payload_obj, ensure_ascii=False) + "\n\n"
    )

def _build_thinking_signature(msg_id: str, thinking_text: str):
    raw = (msg_id or "") + "\n" + (thinking_text or "")
    digest = hashlib.sha256(raw.encode("utf-8", errors="ignore")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")

def _stream_openai_sse_to_anthropic(source_iterable, model: str):
    msg_id = "msg_" + uuid.uuid4().hex
    line_buffer = ""
    started = False
    latest_model = model
    latest_finish_reason = "stop"
    latest_usage = {}
    channel_index = {}
    channel_buffer = {}
    tool_blocks = {}
    next_block_index = 0
    is_gemini_bridge = isinstance(model, str) and model.lower().startswith("gemini")
    saw_done_sentinel = False
    saw_finish_reason = False
    saw_tool_calls = False
    saw_empty_choices = False

    def _start_block_if_needed(channel: str):
        nonlocal next_block_index
        idx = channel_index.get(channel)
        if isinstance(idx, int):
            return idx
        idx = next_block_index
        next_block_index += 1
        channel_index[channel] = idx
        if channel == "thinking":
            yield _sse_event("content_block_start", {
                "type": "content_block_start",
                "index": idx,
                "content_block": {"type": "thinking", "thinking": ""}
            })
        else:
            yield _sse_event("content_block_start", {
                "type": "content_block_start",
                "index": idx,
                "content_block": {"type": "text", "text": ""}
            })

    def _ensure_tool_block(tool_idx: int, tool_id: Optional[str], tool_name: Optional[str], tool_extra_content=None):
        nonlocal next_block_index
        key = int(tool_idx) if isinstance(tool_idx, int) else len(tool_blocks)
        existing = tool_blocks.get(key)
        if isinstance(existing, dict):
            if isinstance(tool_extra_content, dict) and not isinstance(existing.get("extra_content"), dict):
                existing["extra_content"] = tool_extra_content
                tool_blocks[key] = existing
                if isinstance(existing.get("id"), str):
                    _cache_tool_extra_content(existing.get("id"), tool_extra_content)
            return [], existing["content_index"]
        cid = next_block_index
        next_block_index += 1
        tid = tool_id if isinstance(tool_id, str) and tool_id else ("toolu_" + uuid.uuid4().hex[:24])
        tname = tool_name if isinstance(tool_name, str) and tool_name else "tool"
        block_entry = {"content_index": cid, "id": tid, "name": tname, "args": ""}
        if isinstance(tool_extra_content, dict):
            block_entry["extra_content"] = tool_extra_content
            _cache_tool_extra_content(tid, tool_extra_content)
        tool_blocks[key] = block_entry
        content_block = {"type": "tool_use", "id": tid, "name": tname, "input": {}}
        if isinstance(tool_extra_content, dict):
            content_block["extra_content"] = tool_extra_content
        return [
            _sse_event("content_block_start", {
                "type": "content_block_start",
                "index": cid,
                "content_block": content_block
            })
        ], cid

    try:
        for chunk in source_iterable:
            if isinstance(chunk, bytes):
                chunk_text = chunk.decode("utf-8", errors="ignore")
            else:
                chunk_text = str(chunk)
            line_buffer += chunk_text
            while "\n" in line_buffer:
                line, line_buffer = line_buffer.split("\n", 1)
                s = line.strip()
                if not s.startswith("data:"):
                    continue
                payload_s = s[5:].strip()
                if not payload_s:
                    continue
                if payload_s == "[DONE]":
                    saw_done_sentinel = True
                    continue
                try:
                    obj = json.loads(payload_s)
                except Exception:
                    continue
                if not started:
                    yield _sse_event("message_start", {
                        "type": "message_start",
                        "message": {
                            "id": msg_id,
                            "type": "message",
                            "role": "assistant",
                            "model": latest_model,
                            "content": [],
                            "stop_reason": None,
                            "stop_sequence": None,
                            "usage": {"input_tokens": 0, "output_tokens": 0}
                        }
                    })
                    started = True
                segments = _extract_stream_segments(obj)
                for channel, piece in segments:
                    for ev in _start_block_if_needed(channel):
                        yield ev
                    idx = channel_index.get(channel, 0)
                    channel_buffer[channel] = (channel_buffer.get(channel) or "") + piece
                    if channel == "thinking":
                        yield _sse_event("content_block_delta", {
                            "type": "content_block_delta",
                            "index": idx,
                            "delta": {"type": "thinking_delta", "thinking": piece}
                        })
                    else:
                        yield _sse_event("content_block_delta", {
                            "type": "content_block_delta",
                            "index": idx,
                            "delta": {"type": "text_delta", "text": piece}
                        })
                cmodel = obj.get("model")
                if isinstance(cmodel, str) and cmodel:
                    latest_model = cmodel
                cusage = obj.get("usage")
                if isinstance(cusage, dict):
                    latest_usage = cusage
                choices = obj.get("choices")
                if isinstance(choices, list) and choices:
                    fr = choices[0].get("finish_reason")
                    if isinstance(fr, str) and fr:
                        latest_finish_reason = fr
                        saw_finish_reason = True
                    message_obj = choices[0].get("message")
                    delta_obj = choices[0].get("delta")
                    message_tool_calls = message_obj.get("tool_calls") if isinstance(message_obj, dict) else None
                    if message_tool_calls is not None:
                        try:
                            print(
                                "[anthropic_bridge] choices[0].message.tool_calls observed "
                                f"type={type(message_tool_calls).__name__} "
                                f"sample={_truncate_log_text(json.dumps(message_tool_calls, ensure_ascii=False), 800)}"
                            )
                        except Exception:
                            print(
                                "[anthropic_bridge] choices[0].message.tool_calls observed "
                                f"type={type(message_tool_calls).__name__} sample=<serialize_failed>"
                            )
                    if isinstance(delta_obj, dict):
                        tc_list = delta_obj.get("tool_calls")
                        if tc_list is not None:
                            try:
                                print(
                                    "[anthropic_bridge] choices[0].delta.tool_calls observed "
                                    f"type={type(tc_list).__name__} "
                                    f"sample={_truncate_log_text(json.dumps(tc_list, ensure_ascii=False), 800)}"
                                )
                            except Exception:
                                print(
                                    "[anthropic_bridge] choices[0].delta.tool_calls observed "
                                    f"type={type(tc_list).__name__} sample=<serialize_failed>"
                                )
                        if isinstance(tc_list, list):
                            if len(tc_list) > 0:
                                saw_tool_calls = True
                                if is_gemini_bridge:
                                    first_tc = tc_list[0] if isinstance(tc_list[0], dict) else {}
                                    first_fn = first_tc.get("function") if isinstance(first_tc.get("function"), dict) else {}
                                    print(
                                        "[anthropic_bridge][gemini] delta tool_calls detected "
                                        f"msg_id={msg_id} count={len(tc_list)} "
                                        f"first_tool={first_fn.get('name') if isinstance(first_fn.get('name'), str) else 'unknown'} "
                                        f"first_call_id={first_tc.get('id') if isinstance(first_tc.get('id'), str) else 'unknown'}"
                                    )
                            for tc in tc_list:
                                if not isinstance(tc, dict):
                                    continue
                                raw_idx = tc.get("index")
                                try:
                                    tc_idx = int(raw_idx)
                                except Exception:
                                    tc_idx = len(tool_blocks)
                                fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                                tc_id = tc.get("id")
                                tc_name = fn.get("name")
                                tc_extra_content = tc.get("extra_content") if isinstance(tc.get("extra_content"), dict) else None
                                if isinstance(tc_extra_content, dict):
                                    _cache_tool_extra_content(tc_id, tc_extra_content)
                                events_to_emit, content_idx = _ensure_tool_block(tc_idx, tc_id, tc_name, tc_extra_content)
                                for ev in events_to_emit:
                                    yield ev
                                args_piece = fn.get("arguments")
                                if isinstance(args_piece, str) and args_piece:
                                    tb = tool_blocks.get(tc_idx) or {}
                                    tb["args"] = (tb.get("args") or "") + args_piece
                                    tool_blocks[tc_idx] = tb
                                    yield _sse_event("content_block_delta", {
                                        "type": "content_block_delta",
                                        "index": content_idx,
                                        "delta": {"type": "input_json_delta", "partial_json": args_piece}
                                    })
                elif isinstance(choices, list) and len(choices) == 0:
                    if is_gemini_bridge:
                        saw_empty_choices = True
                        print(
                            "[anthropic_bridge][gemini] empty choices observed "
                            f"msg_id={msg_id} model={latest_model} payload={_truncate_log_text(payload_s, 500)}"
                        )
    finally:
        if is_gemini_bridge and (saw_tool_calls or saw_empty_choices):
            print(
                "[anthropic_bridge][gemini] stream summary "
                f"msg_id={msg_id} model={latest_model} "
                f"saw_tool_calls={saw_tool_calls} saw_finish_reason={saw_finish_reason} "
                f"saw_done_sentinel={saw_done_sentinel} saw_empty_choices={saw_empty_choices} "
                f"line_buffer_tail={_truncate_log_text(line_buffer[-300:] if isinstance(line_buffer, str) else '', 300)}"
            )
        if not started:
            yield _sse_event("message_start", {
                "type": "message_start",
                "message": {
                    "id": msg_id,
                    "type": "message",
                    "role": "assistant",
                    "model": latest_model,
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 0, "output_tokens": 0}
                }
            })
            for ev in _start_block_if_needed("text"):
                yield ev
        usage = _extract_prompt_completion_tokens_from_usage(latest_usage)
        ordered_blocks = sorted(
            [(idx, ch) for ch, idx in channel_index.items() if isinstance(idx, int)],
            key=lambda x: x[0]
        )
        ordered_blocks.extend(
            sorted(
                [(int(v.get("content_index", 0)), "__tool__") for v in tool_blocks.values() if isinstance(v, dict)],
                key=lambda x: x[0]
            )
        )
        for idx, _ch in ordered_blocks:
            if _ch == "thinking":
                signature = _build_thinking_signature(msg_id, channel_buffer.get("thinking") or "")
                yield _sse_event("content_block_delta", {
                    "type": "content_block_delta",
                    "index": idx,
                    "delta": {"type": "signature_delta", "signature": signature}
                })
            yield _sse_event("content_block_stop", {"type": "content_block_stop", "index": idx})
        yield _sse_event("message_delta", {
            "type": "message_delta",
            "delta": {
                "stop_reason": _map_finish_reason_to_anthropic(latest_finish_reason),
                "stop_sequence": None
            },
            "usage": usage
        })
        yield _sse_event("message_stop", {"type": "message_stop"})

def _truncate_log_text(v: str, limit: int = 500):
    if not isinstance(v, str):
        return ""
    if len(v) <= limit:
        return v
    return v[:limit] + "...(truncated)"

def _count_cache_markers_in_content(content):
    if isinstance(content, list):
        return sum(1 for item in content if isinstance(item, dict) and isinstance(item.get("cache_control"), dict))
    return 0

def _count_cache_markers_in_messages(messages):
    total = 0
    for msg in messages or []:
        if isinstance(msg, dict):
            total += _count_cache_markers_in_content(msg.get("content"))
    return total

def _is_qwen_model_name(model_name: str) -> bool:
    return isinstance(model_name, str) and model_name.startswith("qwen")

def _is_deepseek_model_name(model_name: str) -> bool:
    return isinstance(model_name, str) and model_name.startswith("deepseek")

def _resolve_model_alias(model_name: str):
    if not isinstance(model_name, str):
        return model_name, None
    lower_name = model_name.lower()
    if lower_name == "deepseek-chat":
        return "deepseek-v4-flash", False
    if lower_name == "deepseek-reasoner":
        return "deepseek-v4-flash", True
    return model_name, None

def _normalize_deepseek_reasoning_effort(reasoning_effort: object):
    if not isinstance(reasoning_effort, str):
        return None
    value = reasoning_effort.strip().lower()
    if value in ("high", "low", "medium"):
        return "high"
    if value in ("max", "xhigh"):
        return "max"
    return None

def _infer_deepseek_reasoning_effort(thinking_budget: Optional[int], reasoning_effort: Optional[str]):
    normalized = _normalize_deepseek_reasoning_effort(reasoning_effort)
    if normalized:
        return normalized
    if isinstance(thinking_budget, int) and thinking_budget > 0:
        if thinking_budget >= DEEPSEEK_REASONING_EFFORT_MAX_BUDGET:
            return "max"
        return "high"
    return "high"

def _adapt_messages_for_model(messages: list, is_qwen_model: bool, is_deepseek_model: bool):
    adapted = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        msg_copy = dict(msg)
        role = msg.get("role")
        content = msg.get("content")
        if is_qwen_model:
            if role == "system" and isinstance(content, list):
                should_flatten = all(
                    isinstance(item, dict) and item.get("type") == "text" and not isinstance(item.get("cache_control"), dict)
                    for item in content
                )
                if should_flatten:
                    texts = []
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            t = item.get("text")
                            if isinstance(t, str) and t:
                                texts.append(t)
                    msg_copy["content"] = "\n".join(texts)
                else:
                    msg_copy["content"] = content
                adapted.append(msg_copy)
            else:
                adapted.append(msg_copy)
        elif is_deepseek_model:
            if isinstance(content, list):
                should_flatten = all(isinstance(item, dict) and item.get("type") == "text" for item in content)
                if should_flatten:
                    texts = []
                    for item in content:
                        t = item.get("text") if isinstance(item, dict) else None
                        if isinstance(t, str) and t:
                            texts.append(t)
                    msg_copy["content"] = "\n".join(texts)
            adapted.append(msg_copy)
        else:
            if role == "system" and isinstance(content, str):
                msg_copy["content"] = [{"type": "text", "text": content}]
                adapted.append(msg_copy)
            else:
                adapted.append(msg_copy)
    return adapted

def _api_key_for_model(model_name: str):
    if _is_qwen_model_name(model_name):
        return QWEN_API_KEY
    if _is_deepseek_model_name(model_name):
        return DEEPSEEK_API_KEY or API_KEY
    if isinstance(model_name, str) and model_name.startswith("gpt"):
        return GPT_CODEX_API_KEY or API_KEY
    if model_name == "claude-opus-4-7":
        return CLAUDE_API_KEY
    return API_KEY

def _apply_json_only_instruction(messages: list, prefer_string_system: bool):
    for msg in messages:
        if not isinstance(msg, dict) or msg.get("role") != "system":
            continue
        content = msg.get("content")
        if isinstance(content, str):
            msg["content"] = (content + "\nPlease return valid JSON only.").strip()
            return
        if isinstance(content, list):
            msg["content"] = content + [{"type": "text", "text": "Please return valid JSON only."}]
            return
        msg["content"] = "Please return valid JSON only." if prefer_string_system else [{"type": "text", "text": "Please return valid JSON only."}]
        return
    if prefer_string_system:
        messages.insert(0, {"role": "system", "content": "Please return valid JSON only."})
    else:
        messages.insert(0, {"role": "system", "content": [{"type": "text", "text": "Please return valid JSON only."}]})

def _apply_thinking_instruction(messages: list, is_qwen_model: bool, enable_thinking: bool):
    if enable_thinking:
        instruction = "Please think step by step and provide a thorough, carefully reasoned answer."
    else:
        instruction = "Please keep reasoning concise and provide a direct answer."
    for msg in messages:
        if not isinstance(msg, dict) or msg.get("role") != "system":
            continue
        content = msg.get("content")
        if is_qwen_model:
            if isinstance(content, str):
                msg["content"] = (content + "\n" + instruction).strip()
                return
            if isinstance(content, list):
                msg["content"] = content + [{"type": "text", "text": instruction}]
                return
            msg["content"] = instruction
            return
        if isinstance(content, list):
            msg["content"] = content + [{"type": "text", "text": instruction}]
            return
        if isinstance(content, str):
            msg["content"] = (content + "\n" + instruction).strip()
            return
        msg["content"] = [{"type": "text", "text": instruction}]
        return
    if is_qwen_model:
        messages.insert(0, {"role": "system", "content": instruction})
    else:
        messages.insert(0, {"role": "system", "content": [{"type": "text", "text": instruction}]})

def _contains_json_word(v):
    if isinstance(v, str):
        return "json" in v.lower()
    if isinstance(v, list):
        for item in v:
            if _contains_json_word(item):
                return True
        return False
    if isinstance(v, dict):
        for val in v.values():
            if _contains_json_word(val):
                return True
        return False
    return False

def _merge_tool_call_delta(tool_calls_state: dict, tool_call_obj: object):
    if not isinstance(tool_call_obj, dict):
        return
    raw_index = tool_call_obj.get("index")
    try:
        tc_index = int(raw_index)
    except Exception:
        tc_index = len(tool_calls_state)
    existing = tool_calls_state.get(tc_index) or {
        "id": None,
        "type": "function",
        "function": {"name": "", "arguments": ""}
    }
    call_id = tool_call_obj.get("id")
    if isinstance(call_id, str) and call_id:
        existing["id"] = call_id
    call_type = tool_call_obj.get("type")
    if isinstance(call_type, str) and call_type:
        existing["type"] = call_type
    fn = tool_call_obj.get("function")
    if isinstance(fn, dict):
        existing_fn = existing.get("function") if isinstance(existing.get("function"), dict) else {"name": "", "arguments": ""}
        name = fn.get("name")
        if isinstance(name, str) and name:
            existing_fn["name"] = (existing_fn.get("name") or "") + name
        arguments = fn.get("arguments")
        if isinstance(arguments, str) and arguments:
            existing_fn["arguments"] = (existing_fn.get("arguments") or "") + arguments
        existing["function"] = existing_fn
    extra_content = tool_call_obj.get("extra_content")
    if isinstance(extra_content, dict):
        existing["extra_content"] = extra_content
    tool_calls_state[tc_index] = existing

def _collect_tool_calls_from_chunk(tool_calls_state: dict, chunk: dict):
    if not isinstance(chunk, dict):
        return
    choices = chunk.get("choices")
    if not (isinstance(choices, list) and choices):
        return
    choice0 = choices[0] if isinstance(choices[0], dict) else {}
    delta_obj = choice0.get("delta")
    if isinstance(delta_obj, dict):
        tc_list = delta_obj.get("tool_calls")
        if isinstance(tc_list, list):
            for tc in tc_list:
                _merge_tool_call_delta(tool_calls_state, tc)
    message_obj = choice0.get("message")
    if isinstance(message_obj, dict):
        tc_list = message_obj.get("tool_calls")
        if isinstance(tc_list, list):
            for i, tc in enumerate(tc_list):
                tc_copy = dict(tc) if isinstance(tc, dict) else {}
                if "index" not in tc_copy:
                    tc_copy["index"] = i
                _merge_tool_call_delta(tool_calls_state, tc_copy)

def _call_verify_resource(project_id: int, resource_amount: int, user_id: Optional[str], license_key: Optional[str], auth_header: Optional[str]):
    if resource_amount <= 0:
        return {"success": True, "required_points": 0}, 200
    if not (user_id or license_key):
        return {"error": "缺少必要参数: user_id或license_key"}, 400
    base = os.getenv("USER_MGR_URL", "https://user-manager-v-cgsugyakvo.cn-hangzhou.fcapp.run")
    parsed = urllib.parse.urlsplit(base)
    qs = urllib.parse.urlencode({
        "project_id": str(project_id),
        "resource_amount": str(resource_amount),
        "user_id": user_id or "",
        "license_key": license_key or ""
    })
    headers_verify = {"Accept": "application/json"}
    if auth_header:
        headers_verify["Authorization"] = auth_header
    path_verify = "/verify?" + qs
    conn_verify = http.client.HTTPSConnection(parsed.netloc) if parsed.scheme == "https" else http.client.HTTPConnection(parsed.netloc)
    conn_verify.request("GET", path_verify, headers=headers_verify)
    res_verify = conn_verify.getresponse()
    body_verify = res_verify.read()
    conn_verify.close()
    try:
        verify_json = json.loads(body_verify.decode("utf-8"))
    except Exception:
        verify_json = {"error": body_verify.decode("utf-8", errors="ignore")}
    return verify_json, res_verify.status

def _verify_resource(project_id: int, resource_amount: int, user_id: Optional[str], license_key: Optional[str], auth_header: Optional[str]):
    verify_json, verify_status = _call_verify_resource(project_id, resource_amount, user_id, license_key, auth_header)
    if verify_status != 200 or not (isinstance(verify_json, dict) and verify_json.get("success")):
        return verify_json, verify_status
    return None, 200

def _estimate_tokens_from_anthropic_messages(system_obj, messages_obj):
    parts = []
    if isinstance(system_obj, str) and system_obj:
        parts.append(system_obj)
    elif isinstance(system_obj, list):
        parts.append(_extract_text_from_any_content(system_obj))
    if isinstance(messages_obj, list):
        for msg in messages_obj:
            if not isinstance(msg, dict):
                continue
            parts.append(_extract_text_from_any_content(msg.get("content")))
    text_blob = "\n".join([p for p in parts if isinstance(p, str) and p])
    if not text_blob:
        return 1
    # Fallback heuristic: roughly 1 token ~= 4 chars for mixed zh/en text.
    return max(1, len(text_blob) // 4)

def _verify_before_chat(model: str, user_id: Optional[str], license_key: Optional[str], auth_header: Optional[str], skip_billing: bool):
    if skip_billing:
        return None, 200
    billing_ids = TOKEN_BILLING_PROJECT_IDS.get(model)
    if not billing_ids:
        return None, 200
    input_pid = billing_ids.get("input")
    if not isinstance(input_pid, int):
        return None, 200
    return _verify_resource(input_pid, 1, user_id, license_key, auth_header)

def _consume_resource(project_id: int, resource_amount: int, user_id: Optional[str], license_key: Optional[str], auth_header: Optional[str]):
    if resource_amount <= 0:
        return None, 200
    base = os.getenv("USER_MGR_URL", "https://user-manager-v-cgsugyakvo.cn-hangzhou.fcapp.run")
    parsed = urllib.parse.urlsplit(base)
    qs = urllib.parse.urlencode({
        "project_id": str(project_id),
        "resource_amount": str(resource_amount),
        "user_id": user_id or "",
        "license_key": license_key or ""
    })
    headers_cons = {"Accept": "application/json"}
    if auth_header:
        headers_cons["Authorization"] = auth_header
    path_cons = "/consume?" + qs
    conn_cons = http.client.HTTPSConnection(parsed.netloc) if parsed.scheme == "https" else http.client.HTTPConnection(parsed.netloc)
    conn_cons.request("GET", path_cons, headers=headers_cons)
    res_cons = conn_cons.getresponse()
    body_cons = res_cons.read()
    conn_cons.close()
    if res_cons.status not in (200, 201):
        try:
            err_json = json.loads(body_cons.decode("utf-8"))
        except Exception:
            err_json = {"error": body_cons.decode("utf-8")}
        return err_json, res_cons.status
    return None, res_cons.status

def _safe_int(v):
    try:
        if isinstance(v, bool):
            return 0
        return int(v)
    except Exception:
        return 0

def _ceil_token_k_units(token_count: int):
    n = max(0, _safe_int(token_count))
    return (n + 999) // 1000

def _extract_prompt_completion_tokens(usage_obj: object):
    if not isinstance(usage_obj, dict):
        return 0, 0
    prompt_tokens = _safe_int(usage_obj.get("prompt_tokens"))
    if prompt_tokens <= 0:
        prompt_tokens = _safe_int(usage_obj.get("input_tokens"))
    if prompt_tokens <= 0:
        prompt_tokens = _safe_int(usage_obj.get("promptTokenCount"))
    completion_tokens = _safe_int(usage_obj.get("completion_tokens"))
    if completion_tokens <= 0:
        completion_tokens = _safe_int(usage_obj.get("output_tokens"))
    if completion_tokens <= 0:
        completion_tokens = _safe_int(usage_obj.get("candidatesTokenCount"))
    return max(0, prompt_tokens), max(0, completion_tokens)

def _extract_cache_tokens_from_usage(usage_obj: object):
    if not isinstance(usage_obj, dict):
        return 0, 0
    cache_read_tokens = _safe_int(usage_obj.get("cache_read_input_tokens"))
    cache_write_tokens = _safe_int(usage_obj.get("cache_creation_input_tokens"))

    prompt_tokens_details = usage_obj.get("prompt_tokens_details")
    if isinstance(prompt_tokens_details, dict):
        if cache_read_tokens <= 0:
            cache_read_tokens = _safe_int(prompt_tokens_details.get("cached_tokens"))
        if cache_write_tokens <= 0:
            cache_write_tokens = _safe_int(
                prompt_tokens_details.get("cache_creation_input_tokens") or prompt_tokens_details.get("cache_write_tokens")
            )

    input_tokens_details = usage_obj.get("input_tokens_details")
    if isinstance(input_tokens_details, dict):
        if cache_read_tokens <= 0:
            cache_read_tokens = _safe_int(input_tokens_details.get("cached_tokens"))
        if cache_write_tokens <= 0:
            cache_write_tokens = _safe_int(
                input_tokens_details.get("cache_creation_input_tokens") or input_tokens_details.get("cache_write_tokens")
            )

    return max(0, cache_read_tokens), max(0, cache_write_tokens)

def _consume_by_usage(model: str, usage_obj: object, user_id: Optional[str], license_key: Optional[str], auth_header: Optional[str], skip_billing: bool):
    if skip_billing:
        print(f"[llm/chat][billing] skip_billing=true model={model}")
        return None, 200
    billing_ids = TOKEN_BILLING_PROJECT_IDS.get(model)
    if not billing_ids:
        print(f"[llm/chat][billing] no billing config for model={model}")
        return None, 200
    if not (user_id or license_key):
        print(f"[llm/chat][billing] missing user_id/license_key model={model}")
        return {"error": "缺少必要参数: user_id或license_key"}, 400
    print(f"[llm/chat][billing] raw usage model={model} usage_obj={usage_obj}")
    prompt_tokens, completion_tokens = _extract_prompt_completion_tokens(usage_obj)
    in_units = _ceil_token_k_units(prompt_tokens)
    out_units = _ceil_token_k_units(completion_tokens)
    print(
        f"[llm/chat][billing] parsed usage model={model} "
        f"prompt_tokens={prompt_tokens} completion_tokens={completion_tokens} "
        f"in_units={in_units} out_units={out_units} "
        f"input_pid={billing_ids['input']} output_pid={billing_ids['output']}"
    )
    err1, status1 = _consume_resource(billing_ids["input"], in_units, user_id, license_key, auth_header)
    if err1:
        print(f"[llm/chat][billing] input consume failed status={status1} err={err1}")
        return err1, status1
    err2, status2 = _consume_resource(billing_ids["output"], out_units, user_id, license_key, auth_header)
    if err2:
        print(f"[llm/chat][billing] output consume failed status={status2} err={err2}")
        return err2, status2
    print(f"[llm/chat][billing] consume success model={model}")
    return None, 200

def _stream_chat_with_retry(
    model: str,
    messages: list,
    enforce_json: bool,
    user_id: Optional[str],
    session_id: Optional[str],
    client_stream: bool,
    skip_billing: bool,
    license_key: Optional[str],
    auth_header: Optional[str],
    response_format: Optional[object] = None,
    stream_options: Optional[dict] = None,
    enable_thinking: Optional[bool] = None,
    thinking_budget: Optional[int] = None,
    reasoning_effort: Optional[str] = None,
    request_id: Optional[str] = None,
    tools: Optional[list] = None,
    tool_choice: Optional[object] = None
):
    same_model_attempts = max(1, SAME_MODEL_RETRY_TIMES + 1)
    candidate_models = [model] * same_model_attempts + [TIMEOUT_FALLBACK_MODEL]
    for idx, attempt_model in enumerate(candidate_models):
        attempt_start = time.monotonic()
        print(
            f"[llm/chat][retry] req_id={request_id} attempt={idx + 1}/{len(candidate_models)} "
            f"model={attempt_model}"
        )
        alias_model, alias_enable_thinking = _resolve_model_alias(attempt_model)
        is_qwen_model = _is_qwen_model_name(alias_model)
        is_deepseek_model = _is_deepseek_model_name(alias_model)
        effective_enable_thinking = enable_thinking if enable_thinking is not None else alias_enable_thinking
        attempt_messages = _adapt_messages_for_model(messages, is_qwen_model, is_deepseek_model)
        if enforce_json and not _contains_json_word(attempt_messages) and (is_qwen_model or is_deepseek_model):
            _apply_json_only_instruction(attempt_messages, prefer_string_system=(is_qwen_model or is_deepseek_model))
        if is_qwen_model:
            host = QWEN_API_HOST
            path = QWEN_API_PATH
        elif is_deepseek_model:
            host = DEEPSEEK_API_HOST
            path = DEEPSEEK_API_PATH
        else:
            host = API_HOST
            path = API_PATH
        api_key = _api_key_for_model(attempt_model)
        upstream_body = {"model": alias_model, "messages": attempt_messages, "stream": True}
        print(
            "[llm/chat][cache_probe] "
            f"req_id={request_id} model={attempt_model} upstream_model={alias_model} host={host} path={path} "
            f"message_count={len(attempt_messages)} cache_marker_count={_count_cache_markers_in_messages(attempt_messages)} "
            f"system_content_type={type((attempt_messages[0].get('content') if isinstance(attempt_messages[0], dict) and attempt_messages and attempt_messages[0].get('role') == 'system' else None)).__name__ if attempt_messages else 'none'}"
        )
        if isinstance(tools, list) and tools:
            upstream_body["tools"] = tools
        if tool_choice is not None:
            upstream_body["tool_choice"] = tool_choice
        effective_stream_options = dict(stream_options) if isinstance(stream_options, dict) else {}
        effective_stream_options["include_usage"] = True
        upstream_body["stream_options"] = effective_stream_options
        if is_qwen_model:
            thinking_enabled = False if effective_enable_thinking is None else bool(effective_enable_thinking)
            upstream_body["enable_thinking"] = thinking_enabled
            if thinking_enabled:
                upstream_body["thinking_budget"] = thinking_budget if isinstance(thinking_budget, int) and thinking_budget > 0 else QWEN_THINKING_BUDGET
        elif is_deepseek_model:
            thinking_enabled = False if effective_enable_thinking is None else bool(effective_enable_thinking)
            upstream_body["thinking"] = {"type": "enabled" if thinking_enabled else "disabled"}
            if thinking_enabled:
                upstream_body["reasoning_effort"] = _infer_deepseek_reasoning_effort(thinking_budget, reasoning_effort)
        elif effective_enable_thinking is not None:
            if not (isinstance(attempt_model, str) and attempt_model.startswith("gpt")):
                _apply_thinking_instruction(attempt_messages, is_qwen_model=False, enable_thinking=bool(effective_enable_thinking))
        if isinstance(response_format, dict):
            upstream_body["response_format"] = response_format
        elif enforce_json:
            upstream_body["response_format"] = {"type": "json_object"}
        print(
            f"[llm/chat] upstream request model={attempt_model} stream={upstream_body.get('stream')} "
            f"stream_options={upstream_body.get('stream_options')}"
        )
        try:
            upstream_tool_names = []
            if isinstance(upstream_body.get("tools"), list):
                for t in upstream_body.get("tools")[:8]:
                    fn = t.get("function") if isinstance(t, dict) and isinstance(t.get("function"), dict) else {}
                    n = fn.get("name")
                    if isinstance(n, str) and n:
                        upstream_tool_names.append(n)
            print(
                "[llm/chat][upstream/tools_probe] "
                f"req_id={request_id} attempt={idx + 1}/{len(candidate_models)} model={attempt_model} "
                f"has_tools={isinstance(upstream_body.get('tools'), list) and len(upstream_body.get('tools')) > 0} "
                f"tools_count={len(upstream_body.get('tools')) if isinstance(upstream_body.get('tools'), list) else 0} "
                f"tool_choice={upstream_body.get('tool_choice')} sample_tools={upstream_tool_names}"
            )
        except Exception as e:
            print(f"[llm/chat][upstream/tools_probe] req_id={request_id} log_failed error={str(e)}")
        payload = json.dumps(upstream_body)
        headers = {"Accept": "text/event-stream", "Content-Type": "application/json", "Authorization": "Bearer " + api_key}
        conn = http.client.HTTPSConnection(host, timeout=FIRST_TOKEN_TIMEOUT_SECONDS)
        try:
            conn.request("POST", path, body=payload, headers=headers)
            res = conn.getresponse()
            headers_elapsed_ms = int((time.monotonic() - attempt_start) * 1000)
            print(
                f"[llm/chat][timing] req_id={request_id} attempt={idx + 1}/{len(candidate_models)} "
                f"model={attempt_model} status={res.status} t_headers_ms={headers_elapsed_ms}"
            )
            if res.status not in (200, 201):
                body = res.read()
                conn.close()
                print(f"[llm/chat] 上游非成功状态 status={res.status} model={attempt_model}")
                print(f"[llm/chat] 上游错误响应 model={attempt_model} body={body.decode('utf-8', errors='ignore')[:500]}")
                try:
                    resp_json = json.loads(body.decode("utf-8"))
                except Exception:
                    resp_json = {"raw": body.decode("utf-8")}
                if res.status == 429 and idx < len(candidate_models) - 1:
                    retry_delay_s = min(2.0, 0.4 * (idx + 1))
                    print(
                        f"[llm/chat][retry] req_id={request_id} attempt={idx + 1}/{len(candidate_models)} "
                        f"model={attempt_model} status=429 -> retry_next_model={candidate_models[idx + 1]} "
                        f"backoff_s={retry_delay_s}"
                    )
                    time.sleep(retry_delay_s)
                    continue
                return jsonify(resp_json), res.status
            first_chunk = res.read(1)
            if not first_chunk:
                raise socket.timeout("empty stream")
            first_byte_elapsed_ms = int((time.monotonic() - attempt_start) * 1000)
            print(
                f"[llm/chat][timing] req_id={request_id} attempt={idx + 1}/{len(candidate_models)} "
                f"model={attempt_model} t_first_byte_ms={first_byte_elapsed_ms} first_byte_hex={first_chunk.hex()}"
            )
            try:
                conn.sock.settimeout(None)
            except Exception:
                pass

            if not client_stream:
                assistant_parts = []
                reasoning_parts = []
                line_buffer = ""
                finish_reason = "stop"
                usage_obj = {}
                usage_seen = False
                payload_count = 0
                first_data_logged = False
                latest_id = "chatcmpl-" + uuid.uuid4().hex
                latest_created = int(time.time())
                latest_model = attempt_model
                latest_fingerprint = None
                tool_calls_state = {}
                current_chunk = first_chunk
                while current_chunk:
                    chunk_text = current_chunk.decode("utf-8", errors="ignore")
                    line_buffer += chunk_text
                    while "\n" in line_buffer:
                        line, line_buffer = line_buffer.split("\n", 1)
                        s = line.strip()
                        if s.startswith("data:"):
                            payload_s = s[5:].strip()
                            if payload_s and payload_s != "[DONE]":
                                try:
                                    if not first_data_logged:
                                        print(
                                            f"[llm/chat][first_event] req_id={request_id} "
                                            f"attempt={idx + 1}/{len(candidate_models)} model={attempt_model} "
                                            f"payload={_truncate_log_text(payload_s)}"
                                        )
                                        first_data_logged = True
                                    chunk = json.loads(payload_s)
                                    payload_count += 1
                                    if payload_count <= 5:
                                        print(f"[llm/chat] non-stream chunk#{payload_count} keys={list(chunk.keys())}")
                                    for channel, piece in _extract_stream_segments(chunk):
                                        if not piece:
                                            continue
                                        if channel == "thinking":
                                            reasoning_parts.append(piece)
                                        else:
                                            assistant_parts.append(piece)
                                    _collect_tool_calls_from_chunk(tool_calls_state, chunk)
                                    cid = chunk.get("id")
                                    if isinstance(cid, str) and cid:
                                        latest_id = cid
                                    ccreated = chunk.get("created")
                                    if isinstance(ccreated, int):
                                        latest_created = ccreated
                                    cmodel = chunk.get("model")
                                    if isinstance(cmodel, str) and cmodel:
                                        latest_model = cmodel
                                    latest_fingerprint = chunk.get("system_fingerprint")
                                    cusage = chunk.get("usage")
                                    if payload_count <= 5:
                                        print(f"[llm/chat] non-stream usage type chunk#{payload_count} type={type(cusage).__name__} value={cusage}")
                                    if isinstance(cusage, dict):
                                        usage_obj = cusage
                                        usage_seen = True
                                        print(f"[llm/chat] non-stream usage chunk#{payload_count} usage={cusage}")
                                        print(
                                            "[llm/chat][cache_probe] "
                                            f"req_id={request_id} model={latest_model} non_stream_usage={cusage}"
                                        )
                                    choices = chunk.get("choices")
                                    if isinstance(choices, list) and choices:
                                        fr = choices[0].get("finish_reason")
                                        if isinstance(fr, str) and fr:
                                            finish_reason = fr
                                except Exception:
                                    pass
                    current_chunk = res.read(4096)
                conn.close()
                assistant_content = "".join(assistant_parts)
                if not usage_seen:
                    print(
                        f"[llm/chat] non-stream no usage captured model={latest_model} payload_count={payload_count} "
                        f"line_buffer_len={len(line_buffer)} line_buffer_tail={line_buffer[-200:]}"
                    )
                final_resp = {
                    "id": latest_id,
                    "object": "chat.completion",
                    "created": latest_created,
                    "model": latest_model,
                    "system_fingerprint": latest_fingerprint,
                    "choices": [{
                        "finish_reason": finish_reason,
                        "index": 0,
                        "message": {
                            "content": assistant_content,
                            "role": "assistant"
                        }
                    }],
                    "usage": usage_obj
                }
                reasoning_content = "".join(reasoning_parts)
                if reasoning_content:
                    final_resp["choices"][0]["message"]["reasoning_content"] = reasoning_content
                if tool_calls_state:
                    final_resp["choices"][0]["message"]["tool_calls"] = [
                        tool_calls_state[idx]
                        for idx in sorted(tool_calls_state.keys())
                        if isinstance(tool_calls_state.get(idx), dict)
                    ]
                print(f"[llm/chat] final usage before billing model={latest_model} usage={usage_obj}")
                bill_err, bill_status = _consume_by_usage(
                    model=latest_model,
                    usage_obj=usage_obj,
                    user_id=user_id,
                    license_key=license_key,
                    auth_header=auth_header,
                    skip_billing=skip_billing
                )
                if bill_err:
                    return jsonify(bill_err), bill_status
                return jsonify(final_resp), res.status

            def generate():
                assistant_parts = []
                line_buffer = ""
                usage_obj = {}
                usage_seen = False
                payload_count = 0
                first_data_logged = False
                latest_model = attempt_model
                current_chunk = first_chunk
                try:
                    while current_chunk:
                        chunk_text = current_chunk.decode("utf-8", errors="ignore")
                        line_buffer += chunk_text
                        while "\n" in line_buffer:
                            line, line_buffer = line_buffer.split("\n", 1)
                            s = line.strip()
                            if s.startswith("data:"):
                                payload_s = s[5:].strip()
                                if payload_s and payload_s != "[DONE]":
                                    try:
                                        if not first_data_logged:
                                            print(
                                                f"[llm/chat][first_event] req_id={request_id} "
                                                f"attempt={idx + 1}/{len(candidate_models)} model={attempt_model} "
                                                f"payload={_truncate_log_text(payload_s)}"
                                            )
                                            first_data_logged = True
                                        chunk = json.loads(payload_s)
                                        payload_count += 1
                                        if payload_count <= 5:
                                            print(f"[llm/chat] stream chunk#{payload_count} keys={list(chunk.keys())}")
                                        piece = _extract_stream_text(chunk)
                                        if piece:
                                            assistant_parts.append(piece)
                                        cusage = chunk.get("usage")
                                        if payload_count <= 5:
                                            print(f"[llm/chat] stream usage type chunk#{payload_count} type={type(cusage).__name__} value={cusage}")
                                        if isinstance(cusage, dict):
                                            usage_obj = cusage
                                            usage_seen = True
                                            print(f"[llm/chat] stream usage chunk#{payload_count} usage={cusage}")
                                            print(
                                                "[llm/chat][cache_probe] "
                                                f"req_id={request_id} model={latest_model} stream_usage={cusage}"
                                            )
                                        cmodel = chunk.get("model")
                                        if isinstance(cmodel, str) and cmodel:
                                            latest_model = cmodel
                                    except Exception:
                                        pass
                        yield current_chunk
                        current_chunk = res.read(4096)
                finally:
                    try:
                        conn.close()
                    except Exception:
                        pass
                    if not usage_seen:
                        print(
                            f"[llm/chat] stream no usage captured model={latest_model} payload_count={payload_count} "
                            f"line_buffer_len={len(line_buffer)} line_buffer_tail={line_buffer[-200:]}"
                        )
                    bill_err, bill_status = _consume_by_usage(
                        model=latest_model,
                        usage_obj=usage_obj,
                        user_id=user_id,
                        license_key=license_key,
                        auth_header=auth_header,
                        skip_billing=skip_billing
                    )
                    if bill_err:
                        print(f"[llm/chat] token计费失败 status={bill_status} err={bill_err}")
            return Response(stream_with_context(generate()), status=res.status, mimetype="text/event-stream")
        except socket.timeout:
            timeout_elapsed_ms = int((time.monotonic() - attempt_start) * 1000)
            print(
                f"[llm/chat][timeout] req_id={request_id} attempt={idx + 1}/{len(candidate_models)} "
                f"model={attempt_model} timeout_s={FIRST_TOKEN_TIMEOUT_SECONDS} elapsed_ms={timeout_elapsed_ms}"
            )
            try:
                conn.close()
            except Exception:
                pass
            continue
        except Exception as e:
            print(f"[llm/chat] 上游异常 model={attempt_model} error={str(e)}")
            try:
                conn.close()
            except Exception:
                pass
            return jsonify({"error": "上游请求失败", "details": str(e)}), 502
    print(f"[llm/chat] 所有尝试均首字超时，返回504 fallback_model={TIMEOUT_FALLBACK_MODEL}")
    return jsonify({"error": "首字超时", "timeout_seconds": FIRST_TOKEN_TIMEOUT_SECONDS, "fallback_model": TIMEOUT_FALLBACK_MODEL}), 504

def _responses_impl():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return _openai_error_response("Invalid JSON body.", 400, param="body")
    model = data.get("model")
    if not isinstance(model, str) or not model:
        return _openai_error_response("Missing required parameter: 'model'.", 400, param="model")
    if not model.startswith("gpt"):
        return _openai_error_response("Only gpt models are supported on this endpoint.", 400, param="model")
    payload = json.dumps(data)
    stream_mode = _to_bool(data.get("stream"), False)
    request_id = request.headers.get("X-Request-Id") or ("resp_" + uuid.uuid4().hex[:12])
    req_start = time.monotonic()
    print(f"[llm/chat][responses][entry] req_id={request_id} model={model} stream={stream_mode}")
    headers = {"Content-Type": "application/json", "Authorization": "Bearer " + _api_key_for_model(model)}
    headers["Accept"] = "text/event-stream" if stream_mode else "application/json"
    conn = http.client.HTTPSConnection(API_HOST, timeout=FIRST_TOKEN_TIMEOUT_SECONDS)
    try:
        conn.request("POST", RESPONSES_API_PATH, body=payload, headers=headers)
        res = conn.getresponse()
        headers_elapsed_ms = int((time.monotonic() - req_start) * 1000)
        print(
            f"[llm/chat][responses][timing] req_id={request_id} model={model} stream={stream_mode} "
            f"status={res.status} t_headers_ms={headers_elapsed_ms}"
        )
        if stream_mode:
            if res.status not in (200, 201):
                body = res.read()
                conn.close()
                try:
                    return jsonify(json.loads(body.decode("utf-8"))), res.status
                except Exception:
                    return jsonify({"raw": body.decode("utf-8", errors="ignore")}), res.status
            first_chunk = res.read(1)
            if not first_chunk:
                conn.close()
                return Response(status=res.status, mimetype="text/event-stream")
            first_byte_elapsed_ms = int((time.monotonic() - req_start) * 1000)
            print(
                f"[llm/chat][responses][timing] req_id={request_id} model={model} "
                f"t_first_byte_ms={first_byte_elapsed_ms} first_byte_hex={first_chunk.hex()}"
            )
            try:
                conn.sock.settimeout(None)
            except Exception:
                pass

            def generate():
                current_chunk = first_chunk
                line_buffer = ""
                first_event_line_logged = False
                try:
                    while current_chunk:
                        chunk_text = current_chunk.decode("utf-8", errors="ignore")
                        line_buffer += chunk_text
                        while "\n" in line_buffer:
                            line, line_buffer = line_buffer.split("\n", 1)
                            s = line.strip()
                            if s.startswith("event:") and not first_event_line_logged:
                                first_event_line_ms = int((time.monotonic() - req_start) * 1000)
                                event_name = s[6:].strip()
                                print(
                                    f"[llm/chat][responses][first_event_line] req_id={request_id} model={model} "
                                    f"t_first_event_line_ms={first_event_line_ms} event={event_name}"
                                )
                                first_event_line_logged = True
                        yield current_chunk
                        current_chunk = res.read(4096)
                finally:
                    try:
                        conn.close()
                    except Exception:
                        pass

            return Response(stream_with_context(generate()), status=res.status, mimetype="text/event-stream")
        body = res.read()
        status = res.status
        content_type = res.getheader("Content-Type") or "application/json"
        conn.close()
        return Response(body, status=status, content_type=content_type)
    except socket.timeout:
        timeout_elapsed_ms = int((time.monotonic() - req_start) * 1000)
        print(
            f"[llm/chat][responses][timeout] req_id={request_id} model={model} stream={stream_mode} "
            f"timeout_s={FIRST_TOKEN_TIMEOUT_SECONDS} elapsed_ms={timeout_elapsed_ms}"
        )
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"error": "首字超时", "timeout_seconds": FIRST_TOKEN_TIMEOUT_SECONDS}), 504
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"error": "上游请求失败", "details": str(e)}), 502


def _to_bool(v, default_value: bool = False):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    return default_value

def _chat_impl(force_stream: Optional[bool] = None):
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return _openai_error_response("Invalid JSON body.", 400, param="body")
    system_prompt = data.get("system_prompt")
    user_input = data.get("user_input")
    model = data.get("model")
    stream_raw = data.get("stream", False)
    client_stream = _to_bool(stream_raw, False)
    if force_stream is not None:
        client_stream = force_stream
    request_id = request.headers.get("X-Request-Id") or ("chat_" + uuid.uuid4().hex[:12])
    response_format = data.get("response_format")
    enforce_json = False
    if response_format:
        if isinstance(response_format, str) and response_format.lower() == "json":
            enforce_json = True
        elif isinstance(response_format, dict) and response_format.get("type") in ("json_object", "json_schema"):
            enforce_json = True
    if "stream_options" in data and not isinstance(data.get("stream_options"), dict):
        return _openai_error_response("Invalid 'stream_options': expected an object.", 400, param="stream_options")
    stream_options = data.get("stream_options") if isinstance(data.get("stream_options"), dict) else None

    extra_body = data.get("extra_body") if isinstance(data.get("extra_body"), dict) else {}
    deepseek_thinking_obj = data.get("thinking")
    if not isinstance(deepseek_thinking_obj, dict):
        deepseek_thinking_obj = extra_body.get("thinking") if isinstance(extra_body.get("thinking"), dict) else None
    enable_thinking_raw = data.get("enable_thinking")
    if enable_thinking_raw is None:
        enable_thinking_raw = extra_body.get("enable_thinking")
    if enable_thinking_raw is None and isinstance(deepseek_thinking_obj, dict):
        deepseek_thinking_type = deepseek_thinking_obj.get("type")
        if deepseek_thinking_type == "enabled":
            enable_thinking_raw = True
        elif deepseek_thinking_type == "disabled":
            enable_thinking_raw = False
    enable_thinking = None if enable_thinking_raw is None else _to_bool(enable_thinking_raw, False)

    thinking_budget_raw = data.get("thinking_budget")
    if thinking_budget_raw is None:
        thinking_budget_raw = extra_body.get("thinking_budget")
    if thinking_budget_raw is None and isinstance(deepseek_thinking_obj, dict):
        thinking_budget_raw = deepseek_thinking_obj.get("budget_tokens")
    thinking_budget = None
    if thinking_budget_raw is not None:
        try:
            thinking_budget = int(thinking_budget_raw)
            if thinking_budget <= 0:
                return _openai_error_response("Invalid 'thinking_budget': expected a positive integer.", 400, param="thinking_budget")
        except Exception:
            return _openai_error_response("Invalid 'thinking_budget': expected a positive integer.", 400, param="thinking_budget")
    reasoning_effort = _normalize_deepseek_reasoning_effort(
        data.get("reasoning_effort")
        or extra_body.get("reasoning_effort")
        or (deepseek_thinking_obj.get("reasoning_effort") if isinstance(deepseek_thinking_obj, dict) else None)
    )

    auth_header = request.headers.get("Authorization")
    token = None
    if isinstance(auth_header, str) and auth_header:
        parts_auth = auth_header.split()
        token = parts_auth[-1] if parts_auth else None
    user_id_token = extract_user_id_from_token(token) if token else None
    user_id = user_id_token or data.get("user_id") or data.get("user")
    session_id_req = data.get("session_id")
    session_name_req = data.get("session_name")

    image_url = data.get("image_url")
    prefer_pcm_wav = bool(data.get("prefer_pcm_wav", False))
    skip_billing_raw = data.get("skip_billing", False)
    if isinstance(skip_billing_raw, bool):
        skip_billing = skip_billing_raw
    elif isinstance(skip_billing_raw, (int, float)):
        skip_billing = skip_billing_raw != 0
    elif isinstance(skip_billing_raw, str):
        skip_billing = skip_billing_raw.strip().lower() in ("1", "true", "yes", "on")
    else:
        skip_billing = False

    openai_messages = data.get("messages")
    has_openai_messages = isinstance(openai_messages, list)
    if "messages" in data and not has_openai_messages:
        return _openai_error_response("Invalid 'messages': expected an array.", 400, param="messages")
    if has_openai_messages and not model:
        return _openai_error_response("Missing required parameter: 'model'.", 400, param="model")
    if not has_openai_messages and not system_prompt and not user_input:
        return _openai_error_response("Missing required parameter: 'messages'.", 400, param="messages")
    resolved_model_alias, alias_enable_thinking = _resolve_model_alias(model)
    if enable_thinking is None and alias_enable_thinking is not None:
        enable_thinking = alias_enable_thinking
    if isinstance(resolved_model_alias, str) and resolved_model_alias:
        model = resolved_model_alias
    if has_openai_messages and model not in MODEL_NAMES:
        return _openai_error_response(
            f"The model `{model}` does not exist or you do not have access to it.",
            404,
            param="model",
            code="model_not_found"
        )
    if model not in MODEL_NAMES:
        print(f"不支持的模型: {model}, 使用默认模型: {DEFAULT_MODEL_NAME}")
        model = DEFAULT_MODEL_NAME
    print(
        f"[llm/chat][entry] req_id={request_id} route=chat_completions "
        f"model={model} stream={client_stream} enable_thinking={enable_thinking} "
        f"thinking_budget={thinking_budget}"
    )

    license_key = data.get("license_key")
    if TOKEN_BILLING_PROJECT_IDS.get(model) and not skip_billing:
        if not (user_id or license_key):
            return jsonify({"error": "缺少必要参数: user_id或license_key"}), 400
    auth_header_for_consume = request.headers.get("Authorization")
    verify_err, verify_status = _verify_before_chat(
        model=model,
        user_id=user_id,
        license_key=license_key,
        auth_header=auth_header_for_consume,
        skip_billing=skip_billing
    )
    if verify_err:
        msg = verify_err.get("error") if isinstance(verify_err, dict) else None
        if not isinstance(msg, str) or not msg:
            msg = "余额不足"
        return jsonify({"error": msg}), (verify_status if isinstance(verify_status, int) and verify_status > 0 else 400)

    session_id2 = None
    if isinstance(user_id, str) and user_id:
        session_id2 = get_or_create_session(user_id, session_id_req, session_name_req)
        add_message(user_id, session_id2, "user", user_input or "", model=model, media={"image_url": image_url}, meta={"system_prompt": system_prompt})
    is_qwen_model = _is_qwen_model_name(model)
    messages = []
    if has_openai_messages:
        messages = openai_messages
    elif is_qwen_model:
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        if image_url:
            qwen_items = [{"type": "image_url", "image_url": {"url": image_url}}]
            if user_input:
                qwen_items.append({"type": "text", "text": user_input})
            messages.append({"role": "user", "content": qwen_items})
        else:
            messages.append({"role": "user", "content": user_input or ""})
    else:
        if system_prompt:
            messages.append({"role": "system", "content": [{"type": "text", "text": system_prompt}]})
        user_items = []
        if user_input:
            user_items.append({"type": "text", "text": user_input})
        if image_url:
            user_items.append({"type": "image_url", "image_url": {"url": image_url}})
        messages.append({"role": "user", "content": user_items})
    return _stream_chat_with_retry(
        model=model,
        messages=messages,
        enforce_json=enforce_json,
        user_id=user_id,
        session_id=session_id2,
        client_stream=client_stream,
        skip_billing=skip_billing,
        license_key=license_key,
        auth_header=auth_header_for_consume,
        response_format=response_format if isinstance(response_format, dict) else ({"type": "json_object"} if enforce_json else None),
        stream_options=stream_options,
        enable_thinking=enable_thinking,
        thinking_budget=thinking_budget,
        reasoning_effort=reasoning_effort,
        request_id=request_id
    )

def _messages_impl():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return _anthropic_error_response("Invalid JSON body.", 400)
    model = data.get("model")
    if not isinstance(model, str) or not model:
        return _anthropic_error_response("Missing required parameter: 'model'.", 400)
    requested_model = model
    resolved_model_alias, alias_enable_thinking = _resolve_model_alias(model)
    if isinstance(resolved_model_alias, str) and resolved_model_alias:
        model = resolved_model_alias
    resolved_model = _resolve_messages_model(model)
    if isinstance(resolved_model, str) and resolved_model:
        model = resolved_model
        if model != requested_model:
            print(f"[llm/chat][messages] remap model {requested_model} -> {model}")
    if model not in MODEL_NAMES:
        return _anthropic_error_response(
            f"The model `{model}` does not exist or you do not have access to it.",
            404,
            "not_found_error"
        )
    stream_mode = _to_bool(data.get("stream"), True)
    anthropic_messages = data.get("messages")
    if not isinstance(anthropic_messages, list) or not anthropic_messages:
        return _anthropic_error_response("Missing required parameter: 'messages'.", 400)
    openai_messages = _anthropic_messages_to_openai_messages(data.get("system"), anthropic_messages)
    if not openai_messages:
        return _anthropic_error_response("Invalid or empty 'messages'.", 400)
    openai_tools = _anthropic_tools_to_openai_tools(data.get("tools"))
    openai_tools = _sanitize_openai_tools_for_model(model, openai_tools)
    openai_tool_choice = _anthropic_tool_choice_to_openai(data.get("tool_choice"))
    try:
        tool_names = []
        if isinstance(openai_tools, list):
            for t in openai_tools[:8]:
                fn = t.get("function") if isinstance(t, dict) and isinstance(t.get("function"), dict) else {}
                name = fn.get("name")
                if isinstance(name, str) and name:
                    tool_names.append(name)
        print(
            "[llm/chat][messages/tools_probe] "
            f"model={model} incoming_tools_count={len(data.get('tools') or []) if isinstance(data.get('tools'), list) else 0} "
            f"resolved_openai_tools_count={len(openai_tools) if isinstance(openai_tools, list) else 0} "
            f"resolved_tool_choice={openai_tool_choice} sample_tools={tool_names}"
        )
    except Exception as e:
        print(f"[llm/chat][messages/tools_probe] log_failed error={str(e)}")

    thinking_obj = data.get("thinking")
    enable_thinking = None
    thinking_budget = None
    reasoning_effort = _normalize_deepseek_reasoning_effort(
        (data.get("output_config") or {}).get("effort") if isinstance(data.get("output_config"), dict) else None
    )
    if alias_enable_thinking is not None:
        enable_thinking = alias_enable_thinking
    if isinstance(thinking_obj, dict):
        ttype = thinking_obj.get("type")
        if ttype == "enabled":
            enable_thinking = True
            budget_raw = thinking_obj.get("budget_tokens")
            if budget_raw is not None:
                try:
                    thinking_budget = int(budget_raw)
                    if thinking_budget <= 0:
                        return _anthropic_error_response("Invalid 'thinking.budget_tokens': expected a positive integer.", 400)
                except Exception:
                    return _anthropic_error_response("Invalid 'thinking.budget_tokens': expected a positive integer.", 400)
        elif ttype == "disabled":
            enable_thinking = False

    auth_header = request.headers.get("Authorization")
    token = None
    if isinstance(auth_header, str) and auth_header:
        parts_auth = auth_header.split()
        token = parts_auth[-1] if parts_auth else None
    user_id_token = extract_user_id_from_token(token) if token else None
    user_id = user_id_token or data.get("user_id") or data.get("user")
    session_id_req = data.get("session_id")
    session_name_req = data.get("session_name")

    skip_billing = _to_bool(data.get("skip_billing", False), False)
    license_key = data.get("license_key")
    if TOKEN_BILLING_PROJECT_IDS.get(model) and not skip_billing:
        if not (user_id or license_key):
            return _anthropic_error_response("缺少必要参数: user_id或license_key", 400)
    verify_err, verify_status = _verify_before_chat(
        model=model,
        user_id=user_id,
        license_key=license_key,
        auth_header=request.headers.get("Authorization"),
        skip_billing=skip_billing
    )
    if verify_err:
        msg = verify_err.get("error") if isinstance(verify_err, dict) else None
        if not isinstance(msg, str) or not msg:
            msg = "余额不足"
        return _anthropic_error_response(msg, verify_status if isinstance(verify_status, int) and verify_status > 0 else 400)

    session_id2 = None
    if isinstance(user_id, str) and user_id:
        session_id2 = get_or_create_session(user_id, session_id_req, session_name_req)
        try:
            user_text = ""
            for m in anthropic_messages:
                if isinstance(m, dict) and m.get("role") == "user":
                    user_text = _extract_text_from_any_content(m.get("content"))
                    if user_text:
                        break
            add_message(user_id, session_id2, "user", user_text, model=model, media=None, meta={"source": "anthropic_messages"})
        except Exception:
            pass

    result = _stream_chat_with_retry(
        model=model,
        messages=openai_messages,
        enforce_json=False,
        user_id=user_id,
        session_id=session_id2,
        client_stream=stream_mode,
        skip_billing=skip_billing,
        license_key=license_key,
        auth_header=request.headers.get("Authorization"),
        response_format=None,
        stream_options=None,
        enable_thinking=enable_thinking,
        thinking_budget=thinking_budget,
        reasoning_effort=reasoning_effort,
        request_id=request.headers.get("X-Request-Id") or ("msg_" + uuid.uuid4().hex[:12]),
        tools=openai_tools,
        tool_choice=openai_tool_choice
    )

    if stream_mode:
        if isinstance(result, Response) and result.mimetype == "text/event-stream":
            return Response(
                stream_with_context(_stream_openai_sse_to_anthropic(result.response, requested_model)),
                status=result.status_code,
                mimetype="text/event-stream"
            )
        if isinstance(result, tuple) and len(result) == 2:
            resp_obj, status_code = result
            try:
                err_json = resp_obj.get_json(silent=True) if hasattr(resp_obj, "get_json") else {}
            except Exception:
                err_json = {}
            msg = (err_json or {}).get("error") or "Upstream request failed."
            return _anthropic_error_response(str(msg), status_code if isinstance(status_code, int) else 502)
        return _anthropic_error_response("Upstream stream response is invalid.", 502, "api_error")

    if isinstance(result, tuple) and len(result) == 2:
        resp_obj, status_code = result
        body_json = None
        try:
            body_json = resp_obj.get_json(silent=True) if hasattr(resp_obj, "get_json") else None
        except Exception:
            body_json = None
        if isinstance(status_code, int) and status_code in (200, 201) and isinstance(body_json, dict):
            resp_obj = _build_anthropic_non_stream_response(body_json, requested_model)
            if requested_model and isinstance(requested_model, str):
                resp_obj["model"] = requested_model
            return jsonify(resp_obj), status_code
        if isinstance(body_json, dict):
            err_msg = body_json.get("error")
            if isinstance(err_msg, dict):
                err_msg = err_msg.get("message") or body_json.get("error")
            return _anthropic_error_response(str(err_msg or "Upstream request failed."), status_code if isinstance(status_code, int) else 502)
    return _anthropic_error_response("Unexpected upstream response.", 502, "api_error")

def _messages_count_tokens_impl():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return _anthropic_error_response("Invalid JSON body.", 400)
    model = data.get("model")
    if not isinstance(model, str) or not model:
        return _anthropic_error_response("Missing required parameter: 'model'.", 400)

    requested_model = model
    resolved_model = _resolve_messages_model(model)
    if isinstance(resolved_model, str) and resolved_model:
        model = resolved_model
    if model not in MODEL_NAMES:
        return _anthropic_error_response(
            f"The model `{requested_model}` does not exist or you do not have access to it.",
            404,
            "not_found_error"
        )

    anthropic_messages = data.get("messages")
    if not isinstance(anthropic_messages, list) or not anthropic_messages:
        return _anthropic_error_response("Missing required parameter: 'messages'.", 400)

    auth_header = request.headers.get("Authorization")
    token = None
    if isinstance(auth_header, str) and auth_header:
        parts_auth = auth_header.split()
        token = parts_auth[-1] if parts_auth else None
    user_id_token = extract_user_id_from_token(token) if token else None
    user_id = user_id_token or data.get("user_id") or data.get("user")
    license_key = data.get("license_key")
    skip_billing = _to_bool(data.get("skip_billing", False), False)

    input_tokens = _estimate_tokens_from_anthropic_messages(data.get("system"), anthropic_messages)
    required_points = None
    verify_status = None

    billing_ids = TOKEN_BILLING_PROJECT_IDS.get(model)
    if billing_ids and not skip_billing and (user_id or license_key):
        input_pid = billing_ids.get("input")
        if isinstance(input_pid, int):
            verify_json, verify_status = _call_verify_resource(
                project_id=input_pid,
                resource_amount=1,
                user_id=user_id,
                license_key=license_key,
                auth_header=auth_header
            )
            if isinstance(verify_json, dict):
                rp = verify_json.get("required_points")
                if not isinstance(rp, (int, float)):
                    data_obj = verify_json.get("data")
                    if isinstance(data_obj, dict):
                        rp = data_obj.get("required_points")
                if isinstance(rp, (int, float)) and rp >= 0:
                    required_points = float(rp)
                    input_tokens = max(1, int(round(required_points * 1000)))

    print(
        "[llm/chat][messages/count_tokens] "
        f"model={model} estimated_input_tokens={input_tokens} "
        f"required_points={required_points} verify_status={verify_status}"
    )
    return jsonify({"input_tokens": int(input_tokens)}), 200

@app.route("/cut_jianying/llm/chat", methods=["POST"])
@app.route("/llm/chat", methods=["POST"])
def chat():
    return _chat_impl(force_stream=None)

@app.route("/llm/chat/v1/chat/completions", methods=["POST"])
@app.route("/cut_jianying/llm/chat_stream", methods=["POST"])
@app.route("/llm/chat/stream", methods=["POST"])
def chat_stream():
    return _chat_impl(force_stream=True)

@app.route("/llm/chat/v1/responses", methods=["POST"])
@app.route("/cut_jianying/llm/chat/v1/responses", methods=["POST"])
def chat_responses():
    return _responses_impl()

@app.route("/v1/messages", methods=["POST"])
@app.route("/llm/chat/v1/messages", methods=["POST"])
@app.route("/cut_jianying/llm/chat/v1/messages", methods=["POST"])
def chat_messages():
    return _messages_impl()

@app.route("/v1/messages/count_tokens", methods=["POST"])
@app.route("/llm/chat/v1/messages/count_tokens", methods=["POST"])
@app.route("/cut_jianying/llm/chat/v1/messages/count_tokens", methods=["POST"])
def chat_messages_count_tokens():
    return _messages_count_tokens_impl()

@app.route("/v1/models", methods=["GET"])
@app.route("/llm/chat/v1/models", methods=["GET"])
@app.route("/cut_jianying/llm/chat/v1/models", methods=["GET"])
def list_anthropic_models():
    model_names, model_registry, _ = _build_model_snapshot(_resolve_model_config_for_request())
    data = []
    now_ts = int(time.time())
    for model_name in model_names:
        meta = model_registry.get(model_name) or {}
        data.append({
            "type": "model",
            "id": model_name,
            "display_name": str(meta.get("name") or model_name),
            "created_at": now_ts,
        })
    return jsonify({"data": data}), 200

# 列出支持模型
@app.route("/llm/chat/model_list", methods=["GET"])
def list_models():
    model_names, model_registry, default_model_name = _build_model_snapshot(_resolve_model_config_for_request())
    model_items = []
    for model_name in model_names:
        meta = model_registry.get(model_name) or {}
        model_items.append({
            "model_id": model_name,
            "name": str(meta.get("name") or model_name),
            "provider_id": str(meta.get("provider_id") or "openai"),
            "provider_type": str(meta.get("provider_type") or "openai"),
            "provider_name": str(meta.get("provider_name") or "OpenAI"),
            "provider_model_id": model_name,
            "id": f"{str(meta.get('provider_id') or 'openai')}:{model_name}",
        })
    return jsonify({
        "models": model_names,
        "model_items": model_items,
        "default_model": default_model_name,
        "black_icon": {
            model_name: _get_model_black_icon(model_name)
            for model_name in model_names
        }
    })

@app.route("/llm/chat/history", methods=["GET"])
def chat_history():
    auth_header = request.headers.get("Authorization")
    token = None
    if isinstance(auth_header, str) and auth_header:
        parts_auth = auth_header.split()
        token = parts_auth[-1] if parts_auth else None
    user_id_token = extract_user_id_from_token(token) if token else None
    user_id = user_id_token or request.args.get("user_id")
    if not user_id:
        return jsonify({"error": "缺少必要参数: user_id"}), 400
    try:
        limit = int(request.args.get("limit", "20"))
    except Exception:
        limit = 20
    try:
        offset = int(request.args.get("offset", "0"))
    except Exception:
        offset = 0
    sessions = list_sessions(user_id, limit, offset)
    try:
        messages_limit = int(request.args.get("messages_limit", "50"))
    except Exception:
        messages_limit = 50
    out = []
    for s in sessions or []:
        sid = s.get("session_id")
        msgs = get_session_messages(sid, messages_limit, 0) if sid else []
        ss = dict(s)
        ss["messages"] = msgs
        out.append(ss)
    sessions = out
    return jsonify({"user_id": user_id, "sessions": sessions})

@app.route("/llm/chat/healthy", methods=["GET"])
@app.route("/cut_jianying/llm/chat/healthy", methods=["GET"])
def chat_healthy():
    return jsonify({
        "ok": True,
        "service": "llm_chat",
        "ts": int(time.time())
    }), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9000)
