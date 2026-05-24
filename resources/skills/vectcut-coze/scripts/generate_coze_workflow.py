#!/usr/bin/env python3
"""Generate a Coze workflow project folder from one or more VectCut RESTful requests."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import time
import uuid
from pathlib import Path
from typing import Any


START_NODE_ID = "100001"
END_NODE_ID = "900001"
SUBMIT_HTTP_NODE_ID = "110001"
SUBMIT_PARSE_NODE_ID = "110002"
POLL_HTTP_NODE_ID = "110003"
POLL_PARSE_NODE_ID = "110004"
LOOP_NODE_ID = "151744"
DELAY_NODE_ID = "168335"
CONDITION_NODE_ID = "119222"
BREAK_NODE_ID = "154598"
SET_VARIABLE_NODE_ID = "107123"

START_ICON = (
    "https://lf3-static.bytednsdoc.com/obj/eden-cn/"
    "dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-Start-v2.jpg"
)
END_ICON = (
    "https://lf3-static.bytednsdoc.com/obj/eden-cn/"
    "dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-End-v2.jpg"
)
HTTP_ICON = (
    "https://lf3-static.bytednsdoc.com/obj/eden-cn/"
    "dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-HTTP.png"
)
FROM_JSON_ICON = (
    "https://lf3-static.bytednsdoc.com/obj/eden-cn/"
    "dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-from_json.png"
)
LOOP_ICON = (
    "https://lf3-static.bytednsdoc.com/obj/eden-cn/"
    "dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-Loop-v2.jpg"
)
CONDITION_ICON = (
    "https://lf3-static.bytednsdoc.com/obj/eden-cn/"
    "dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-Condition-v2.jpg"
)
BREAK_ICON = (
    "https://lf3-static.bytednsdoc.com/obj/eden-cn/"
    "dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-Break-v2.jpg"
)
SET_VARIABLE_ICON = (
    "https://lf3-static.bytednsdoc.com/obj/eden-cn/"
    "dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-LoopSetVariable-v2.jpg"
)
CODE_ICON = (
    "https://lf3-static.bytednsdoc.com/obj/eden-cn/"
    "dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-Code-v2.jpg"
)
DELAY_PLUGIN_ICON = (
    "https://p3-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/"
    "f281c9f5fd814badbc659e2e1766cb35~tplv-13w3uml6bg-resize:128:128.image"
    "?rk3s=2e2596fd&x-expires=1782115193&x-signature=nkuXDMgHlYo9au%2BTmYZgrXGJ3WQ%3D"
)

ALIAS_REF_EXACT_RE = re.compile(r"^\$\{([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_.]+))?\}$")
ALIAS_REF_IN_TEXT_RE = re.compile(r"\$\{([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_.]+))?\}")
BLOCK_OUTPUT_RE = re.compile(r"\{\{\s*block_output_(\d+)\.([A-Za-z0-9_.]+)\s*\}\}")
VECTCUT_API_KEY_PLACEHOLDER_RE = re.compile(
    r"(?i)^(?:bearer\s+)?(?:<YOUR_VECTCUT_API_KEY>|\$\{VECTCUT_API_KEY\}|\$VECTCUT_API_KEY|%VECTCUT_API_KEY%|\$env:VECTCUT_API_KEY)$"
)


class NodeIdAllocator:
    """Allocate string node ids that stay within the known-good 1xxxxx convention."""

    def __init__(self, start: int = 110001) -> None:
        self.value = start

    def next_id(self) -> str:
        node_id = str(self.value)
        self.value += 1
        return node_id

    def async_group(self) -> dict[str, str]:
        return {
            "submit_http": self.next_id(),
            "submit_parse": self.next_id(),
            "loop": self.next_id(),
            "poll_http": self.next_id(),
            "poll_parse": self.next_id(),
            "delay": self.next_id(),
            "condition": self.next_id(),
            "set_variable": self.next_id(),
            "break": self.next_id(),
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate MANIFEST.yml and workflow YAML for a Coze project."
    )
    parser.add_argument("--name", default="", help="Workflow name for single-request mode.")
    parser.add_argument("--description", default="", help="Workflow description.")
    parser.add_argument(
        "--output-root",
        default=os.getcwd(),
        help="Directory where the Workflow-*-draft-* folder will be created.",
    )
    parser.add_argument(
        "--folder-name",
        default="",
        help="Optional explicit folder name. Defaults to Workflow-<slug>-draft-<shortid>.",
    )
    parser.add_argument(
        "--workflow-spec-json",
        default="",
        help="Structured JSON spec for multi-step workflows.",
    )
    parser.add_argument(
        "--workflow-spec-file",
        default="",
        help="Path to a JSON file that contains the workflow spec.",
    )
    parser.add_argument("--method", default="", help="HTTP method for the main request.")
    parser.add_argument("--url", default="", help="HTTP URL for the main request.")
    parser.add_argument(
        "--headers-json",
        default="{}",
        help="JSON object of headers for the main request.",
    )
    parser.add_argument(
        "--params-json",
        default="{}",
        help="JSON object of query params for the main request.",
    )
    parser.add_argument(
        "--body-json",
        default="",
        help="JSON object/string for the main request body.",
    )
    parser.add_argument(
        "--submit-response-example-json",
        default="",
        help="Example JSON response used to build the first from_json node.",
    )
    parser.add_argument(
        "--poll-method",
        default="",
        help="Optional HTTP method for polling status.",
    )
    parser.add_argument(
        "--poll-url",
        default="",
        help="Optional HTTP URL for polling status.",
    )
    parser.add_argument(
        "--poll-headers-json",
        default="",
        help="JSON object of headers for polling. Defaults to main headers.",
    )
    parser.add_argument(
        "--poll-params-json",
        default="",
        help='JSON object of poll query params. Supports "${submit.task_id}" and "${step_id.output.xxx}".',
    )
    parser.add_argument(
        "--poll-body-json",
        default="",
        help="Optional JSON object/string for the poll request body.",
    )
    parser.add_argument(
        "--poll-response-example-json",
        default="",
        help="Example JSON response used to build the second from_json node.",
    )
    parser.add_argument(
        "--poll-loop-count",
        type=int,
        default=60,
        help="Fixed maximum polling loop count for async workflows.",
    )
    parser.add_argument(
        "--poll-delay-seconds",
        type=int,
        default=30,
        help="Delay seconds between async polling attempts.",
    )
    parser.add_argument(
        "--poll-success-path",
        default="status",
        help='Field path on poll from_json output used for break condition, e.g. "status".',
    )
    parser.add_argument(
        "--poll-success-value",
        default="success",
        help='Expected value for --poll-success-path that triggers loop break, e.g. "success".',
    )
    parser.add_argument(
        "--poll-result-path",
        default="output",
        help='Field path on poll from_json output stored as final loop result, e.g. "output" or "output.result".',
    )
    return parser.parse_args()


def load_json_arg(raw: str, default: Any) -> Any:
    if raw is None or raw == "":
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON argument: {exc}") from exc


def load_json_file(path: str) -> Any:
    try:
        return json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"Cannot read JSON file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON file {path}: {exc}") from exc


def parse_loose_literal(raw: str) -> Any:
    text = (raw or "").strip()
    if text == "":
        return ""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "workflow"


def normalize_workflow_name(value: str) -> str:
    """Coze workflow names must match ^[a-zA-Z][a-zA-Z0-9_]*$."""
    normalized = re.sub(r"[^a-zA-Z0-9_]+", "_", value.strip())
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    if not normalized:
        return "workflow"
    if not re.match(r"^[A-Za-z]", normalized):
        normalized = f"workflow_{normalized}"
    return normalized


def generate_numeric_id() -> int:
    return int(time.time() * 1000) * 1000 + (uuid.uuid4().int % 1000)


def resolve_vectcut_api_key() -> str:
    """Prefer local env var, otherwise keep a safe placeholder."""
    token = (os.environ.get("VECTCUT_API_KEY") or "").strip()
    if token:
        return token

    # Windows users sometimes set environment variables with different casing.
    for key, value in os.environ.items():
        if key.strip().upper() == "VECTCUT_API_KEY":
            normalized = str(value or "").strip()
            if normalized:
                return normalized

    return "<YOUR_VECTCUT_API_KEY>"


def is_vectcut_api_key_placeholder(text: str) -> bool:
    return bool(VECTCUT_API_KEY_PLACEHOLDER_RE.fullmatch((text or "").strip()))


def contains_dynamic_ref(text: str) -> bool:
    return bool(ALIAS_REF_IN_TEXT_RE.search(text or "") or BLOCK_OUTPUT_RE.search(text or ""))


def sanitize_headers(headers: dict[str, Any]) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    resolved_token = resolve_vectcut_api_key()
    for key, value in headers.items():
        header_name = str(key)
        if value is None:
            sanitized[header_name] = ""
            continue
        if not isinstance(value, str):
            sanitized[header_name] = value
            continue

        text = value
        if header_name.lower() == "authorization":
            if is_vectcut_api_key_placeholder(text):
                text = f"Bearer {resolved_token}"
            elif not contains_dynamic_ref(text):
                if text.lower().startswith("bearer "):
                    text = f"Bearer {resolved_token}"
                elif text:
                    text = resolved_token
        sanitized[header_name] = text
    return sanitized


def yaml_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    text = str(value)
    if text == "":
        return '""'
    if re.fullmatch(r"-?\d+(\.\d+)?", text):
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    if text.lower() in {"true", "false", "null", "~"}:
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    if re.fullmatch(r"[A-Za-z0-9_./:@<>=?&%+\-\{\}]+", text):
        return text
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def dump_yaml(data: Any, indent: int = 0) -> str:
    space = " " * indent
    if isinstance(data, dict):
        if not data:
            return f"{space}{{}}"
        lines: list[str] = []
        for key, value in data.items():
            if isinstance(value, dict) and not value:
                lines.append(f"{space}{key}: {{}}")
            elif isinstance(value, list) and not value:
                lines.append(f"{space}{key}: []")
            elif isinstance(value, (dict, list)):
                lines.append(f"{space}{key}:")
                lines.append(dump_yaml(value, indent + 4))
            elif isinstance(value, str) and "\n" in value:
                lines.append(f"{space}{key}: |-")
                for line in value.splitlines():
                    lines.append(f"{space}    {line}")
            else:
                lines.append(f"{space}{key}: {yaml_scalar(value)}")
        return "\n".join(lines)
    if isinstance(data, list):
        if not data:
            return f"{space}[]"
        lines: list[str] = []
        for item in data:
            if isinstance(item, dict):
                if not item:
                    lines.append(f"{space}- {{}}")
                    continue
                first = True
                for key, value in item.items():
                    prefix = "- " if first else "  "
                    if isinstance(value, dict) and not value:
                        lines.append(f"{space}{prefix}{key}: {{}}")
                    elif isinstance(value, list) and not value:
                        lines.append(f"{space}{prefix}{key}: []")
                    elif isinstance(value, (dict, list)):
                        lines.append(f"{space}{prefix}{key}:")
                        lines.append(dump_yaml(value, indent + 4))
                    elif isinstance(value, str) and "\n" in value:
                        lines.append(f"{space}{prefix}{key}: |-")
                        for line in value.splitlines():
                            lines.append(f"{space}    {line}")
                    else:
                        lines.append(f"{space}{prefix}{key}: {yaml_scalar(value)}")
                    first = False
            elif isinstance(item, list):
                lines.append(f"{space}-")
                lines.append(dump_yaml(item, indent + 4))
            elif isinstance(item, str) and "\n" in item:
                lines.append(f"{space}- |-")
                for line in item.splitlines():
                    lines.append(f"{space}    {line}")
            else:
                lines.append(f"{space}- {yaml_scalar(item)}")
        return "\n".join(lines)
    return f"{space}{yaml_scalar(data)}"


def typed_schema(example: Any) -> dict[str, Any]:
    if isinstance(example, bool):
        return {"type": "boolean", "value": None}
    if isinstance(example, int) and not isinstance(example, bool):
        return {"type": "integer", "value": None}
    if isinstance(example, float):
        return {"type": "float", "value": None}
    if isinstance(example, list):
        item_schema = typed_schema(example[0]) if example else {"type": "string", "value": None}
        return {"type": "list", "items": item_schema, "value": None}
    if isinstance(example, dict):
        return {
            "type": "object",
            "properties": {key: typed_schema(value) for key, value in example.items()},
            "value": None,
        }
    return {"type": "string", "value": None}


def copy_schema(schema: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(schema, ensure_ascii=False))


def ref_value(node_id: str, path: str) -> dict[str, Any]:
    return {"path": path, "ref_node": node_id}


def coze_block_ref(node_id: str, path: str) -> str:
    return f"{{{{block_output_{node_id}.{path}}}}}"


def combine_ref_path(base_path: str, extra_path: str | None) -> str:
    base = (base_path or "").strip(".")
    extra = (extra_path or "").strip(".")
    if base and extra:
        return f"{base}.{extra}"
    return base or extra


def normalize_output_path(path: str) -> str:
    normalized = (path or "").strip().strip(".")
    if not normalized:
        return "output"
    return normalized if normalized.startswith("output") else f"output.{normalized}"


def extract_path_value(data: Any, path: str) -> Any:
    normalized = (path or "").strip().strip(".")
    if not normalized:
        return data

    current = data
    for part in normalized.split("."):
        if isinstance(current, dict):
            if part not in current:
                return None
            current = current.get(part)
        elif isinstance(current, list):
            if not current:
                return None
            current = current[0]
            if isinstance(current, dict):
                if part not in current:
                    return None
                current = current.get(part)
            else:
                return None
        else:
            return None
    return current


def resolve_from_json_output_path(example: Any, path: str) -> str:
    """Convert an API response path into a valid Coze from_json output path."""
    raw = (path or "").strip().strip(".")
    if not raw:
        return "output"

    wrapped_output = {"output": example}
    candidates: list[str] = []

    def add_candidate(candidate: str) -> None:
        normalized = (candidate or "").strip().strip(".")
        if normalized and normalized not in candidates:
            candidates.append(normalized)

    if raw == "output":
        add_candidate("output.output")
        add_candidate("output")
    elif raw.startswith("output"):
        add_candidate(f"output.{raw}")
        add_candidate(raw)
    else:
        add_candidate(f"output.{raw}")
        add_candidate(raw)

    for candidate in candidates:
        if extract_path_value(wrapped_output, candidate) is not None:
            return candidate

    return normalize_output_path(raw)


def resolve_alias_ref(
    raw: str,
    placeholder_refs: dict[str, tuple[str, str]],
) -> tuple[str, str] | None:
    match = ALIAS_REF_EXACT_RE.fullmatch(raw.strip())
    if not match:
        return None
    alias = match.group(1)
    if alias not in placeholder_refs:
        return None
    ref_node_id, base_path = placeholder_refs[alias]
    return ref_node_id, combine_ref_path(base_path, match.group(2))


def resolve_block_output_ref(raw: str) -> tuple[str, str] | None:
    match = BLOCK_OUTPUT_RE.fullmatch(raw.strip())
    if not match:
        return None
    return match.group(1), match.group(2)


def replace_refs_in_text(text: str, placeholder_refs: dict[str, tuple[str, str]]) -> str:
    def _replace(match: re.Match[str]) -> str:
        alias = match.group(1)
        if alias not in placeholder_refs:
            return match.group(0)
        node_id, base_path = placeholder_refs[alias]
        combined_path = combine_ref_path(base_path, match.group(2))
        return coze_block_ref(node_id, combined_path)

    return ALIAS_REF_IN_TEXT_RE.sub(_replace, text)


def render_body_value(value: Any, placeholder_refs: dict[str, tuple[str, str]]) -> Any:
    if isinstance(value, dict):
        return {key: render_body_value(item, placeholder_refs) for key, item in value.items()}
    if isinstance(value, list):
        return [render_body_value(item, placeholder_refs) for item in value]
    if isinstance(value, str):
        return replace_refs_in_text(value, placeholder_refs)
    return value


def build_http_input(
    value: Any,
    placeholder_refs: dict[str, tuple[str, str]],
    *,
    prefer_ref_object: bool,
) -> dict[str, Any]:
    if isinstance(value, str):
        alias_ref = resolve_alias_ref(value, placeholder_refs)
        if alias_ref is not None and prefer_ref_object:
            node_id, path = alias_ref
            return {"value": ref_value(node_id, path)}
        rendered = replace_refs_in_text(value, placeholder_refs)
        return {"type": "string", "value": rendered}
    if isinstance(value, bool):
        return {"type": "boolean", "value": value}
    if isinstance(value, int):
        return {"type": "integer", "value": value}
    if isinstance(value, float):
        return {"type": "float", "value": value}
    if value is None:
        return {"type": "string", "value": ""}
    return {"type": "string", "value": json.dumps(value, ensure_ascii=False)}


def build_node_input(value: Any, placeholder_refs: dict[str, tuple[str, str]]) -> dict[str, Any]:
    if isinstance(value, str):
        alias_ref = resolve_alias_ref(value, placeholder_refs)
        if alias_ref is not None:
            node_id, path = alias_ref
            return {"value": ref_value(node_id, path)}
        block_ref = resolve_block_output_ref(value)
        if block_ref is not None:
            node_id, path = block_ref
            return {"value": ref_value(node_id, path)}
        return literal_input(value)
    return literal_input(value)


def extract_example_path(example: Any, path: str) -> Any:
    normalized = normalize_output_path(path)
    if normalized == "output":
        return example

    current = example
    parts = normalized.split(".")[1:]
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list):
            current = current[0] if current else None
            if isinstance(current, dict):
                current = current.get(part)
            else:
                return None
        else:
            return None
    return current


def infer_poll_result_path(submit_url: str, poll_url: str, configured_path: str) -> str:
    configured = (configured_path or "").strip()
    if configured and configured != "output":
        return configured

    submit = submit_url.lower()
    poll = poll_url.lower()
    if "/llm/chat/submit_task/" in submit or "/llm/chat/submit_task/" in poll:
        return "output.result.response.choices.message.content"
    if "/llm/image/submit_task/" in submit or "/llm/image/submit_task/" in poll:
        return "output.result.image"
    return configured or "output"


def resolve_poll_paths(
    *,
    submit_url: str,
    poll_url: str,
    poll_response_example: Any,
    configured_result_path: str,
    configured_success_path: str,
) -> tuple[str, str]:
    api_result_path = infer_poll_result_path(submit_url, poll_url, configured_result_path)
    effective_result_path = resolve_from_json_output_path(poll_response_example, api_result_path)
    effective_success_path = resolve_from_json_output_path(
        poll_response_example,
        configured_success_path or "status",
    )
    return effective_result_path, effective_success_path


def infer_workflow_subject(description: str, submit_url: str, poll_url: str) -> str:
    combined = f"{submit_url.lower()} {poll_url.lower()} {description}"
    route_rules = [
        ("/llm/chat/submit_task/", "对话任务"),
        ("smart_subtitle", "字幕任务"),
        ("/subtitle/", "字幕任务"),
        ("generate_ai_video", "AI视频任务"),
        ("ai_video", "AI视频任务"),
        ("digital_human", "数字人任务"),
        ("image", "生图任务"),
        ("matting", "抠像任务"),
        ("export_video", "云渲染任务"),
    ]
    for keyword, subject in route_rules:
        if keyword in combined:
            return subject

    cleaned = description.strip()
    cleaned = re.sub(r"^(提交|发起|创建|生成|查询|获取|添加)", "", cleaned)
    cleaned = re.sub(r"^(异步|同步)", "", cleaned)
    cleaned = re.sub(r"(接口|请求)$", "", cleaned)
    cleaned = cleaned.strip(" -_")
    return cleaned or "任务"


def unique_title(title: str, used_titles: set[str]) -> str:
    base = title.strip() or "节点"
    if base not in used_titles:
        used_titles.add(base)
        return base

    index = 2
    while f"{base}{index}" in used_titles:
        index += 1
    unique = f"{base}{index}"
    used_titles.add(unique)
    return unique


def build_node_labels(description: str, submit_url: str, poll_url: str) -> dict[str, dict[str, str]]:
    subject = infer_workflow_subject(description, submit_url, poll_url)
    used_titles: set[str] = set()
    return {
        "submit_http": {
            "title": unique_title(f"提交{subject}", used_titles),
            "description": f"调用接口发起{subject}。",
        },
        "submit_parse": {
            "title": unique_title(f"解析{subject}提交结果", used_titles),
            "description": f"解析提交{subject}后的响应，提取后续所需字段。",
        },
        "poll_http": {
            "title": unique_title(f"查询{subject}状态", used_titles),
            "description": f"调用状态接口，查询{subject}的当前进度。",
        },
        "poll_parse": {
            "title": unique_title(f"解析{subject}状态结果", used_titles),
            "description": f"解析{subject}状态查询响应，提取状态和结果字段。",
        },
        "loop": {
            "title": unique_title(f"轮询{subject}状态", used_titles),
            "description": f"按固定次数轮询{subject}状态，命中成功条件后提前结束。",
        },
        "delay": {
            "title": unique_title(f"等待后重试{subject}", used_titles),
            "description": f"在下一次查询{subject}状态前等待固定秒数。",
        },
        "condition": {
            "title": unique_title(f"判断{subject}是否完成", used_titles),
            "description": f"根据状态字段判断{subject}是否已完成。",
        },
        "set_variable": {
            "title": unique_title(f"保存{subject}结果", used_titles),
            "description": f"将{subject}的最终结果写入循环变量，供结束节点返回。",
        },
        "break": {
            "title": unique_title(f"结束{subject}轮询", used_titles),
            "description": f"成功获取{subject}结果后立即终止轮询。",
        },
    }


def schema_with_ref(example: Any, node_id: str, path: str) -> dict[str, Any]:
    schema = typed_schema(example)
    schema["value"] = ref_value(node_id, path)
    return schema


def literal_input(value: Any) -> dict[str, Any]:
    if isinstance(value, bool):
        return {"type": "boolean", "value": value}
    if isinstance(value, int) and not isinstance(value, bool):
        return {"type": "integer", "value": value}
    if isinstance(value, float):
        return {"type": "float", "value": value}
    return {"type": "string", "value": "" if value is None else str(value)}


def build_start_node(inputs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    normalized_inputs = inputs or [{"name": "input", "type": "string"}]
    node_outputs: dict[str, Any] = {}
    for item in normalized_inputs:
        name = str(item.get("name") or "input")
        node_type = str(item.get("type") or "string")
        node_outputs[name] = {"type": node_type, "value": None}

    return {
        "id": START_NODE_ID,
        "type": "start",
        "title": "开始",
        "icon": START_ICON,
        "description": "工作流的起始节点，用于设定启动工作流需要的信息",
        "position": {"x": -32.0, "y": 132.0},
        "parameters": {"node_outputs": node_outputs},
    }


def build_end_node(source_node_id: str, source_path: str, position_x: float = 1768.0) -> dict[str, Any]:
    return {
        "id": END_NODE_ID,
        "type": "end",
        "title": "结束",
        "icon": END_ICON,
        "description": "工作流的最终节点，用于返回工作流运行后的结果信息",
        "position": {"x": position_x, "y": 130.0},
        "parameters": {
            "node_inputs": [
                {
                    "name": "output",
                    "input": {"value": ref_value(source_node_id, source_path)},
                }
            ],
            "terminatePlan": "returnVariables",
        },
    }


def build_http_node(
    *,
    node_id: str,
    title: str,
    description: str,
    method: str,
    url: str,
    headers: dict[str, Any],
    params: dict[str, Any],
    body: Any,
    position_x: float,
    placeholder_refs: dict[str, tuple[str, str]],
) -> dict[str, Any]:
    method = method.upper()
    body_type = "EMPTY" if body in ("", None, {}, []) or method == "GET" else "JSON"
    body_string = ""
    if body_type == "JSON":
        if isinstance(body, str):
            body_string = replace_refs_in_text(body, placeholder_refs)
        else:
            rendered = render_body_value(body, placeholder_refs)
            body_string = json.dumps(rendered, ensure_ascii=False, indent=2)

    param_items = [
        {
            "name": str(key),
            "input": build_http_input(value, placeholder_refs, prefer_ref_object=True),
        }
        for key, value in params.items()
    ]
    header_items = [
        {
            "name": name,
            "input": build_http_input(value, placeholder_refs, prefer_ref_object=False),
        }
        for name, value in headers.items()
    ]

    return {
        "id": node_id,
        "type": "http",
        "title": title,
        "icon": HTTP_ICON,
        "description": description,
        "position": {"x": position_x, "y": 118.0},
        "parameters": {
            "apiInfo": {"method": method, "url": url},
            "auth": {
                "authData": {
                    "bearerTokenData": [
                        {"name": "token", "input": {"type": "string", "value": ""}}
                    ],
                    "customData": {"addTo": "header", "data": None},
                },
                "authOpen": False,
                "authType": "BEARER_AUTH",
            },
            "body": {
                "bodyData": {
                    "binary": {
                        "fileURL": {
                            "type": "string",
                            "value": {
                                "content": {"blockID": "", "name": "", "source": "block-output"},
                                "rawMeta": {"type": 1},
                                "type": "ref",
                            },
                        }
                    },
                    "formURLEncoded": None,
                    "json": body_string,
                    "rawText": "",
                },
                "bodyType": body_type,
            },
            "headers": header_items,
            "inputParam": None,
            "node_outputs": {
                "body": {"type": "string", "value": None},
                "headers": {"type": "string", "value": None},
                "statusCode": {"type": "integer", "value": None},
            },
            "params": param_items,
            "setting": {"retryTimes": 3, "timeout": 120},
            "settingOnError": {"switch": False},
        },
    }


def build_from_json_node(
    *,
    node_id: str,
    title: str,
    description: str,
    source_node_id: str,
    example: Any,
    position_x: float,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "from_json",
        "title": title,
        "icon": FROM_JSON_ICON,
        "description": description,
        "position": {"x": position_x, "y": 130.0},
        "parameters": {
            "node_inputs": [
                {"name": "input", "input": {"value": ref_value(source_node_id, "body")}}
            ],
            "node_outputs": {"output": typed_schema(example)},
        },
    }


def build_code_node(
    *,
    node_id: str,
    title: str,
    description: str,
    code: str,
    inputs: list[dict[str, Any]],
    outputs_example: dict[str, Any],
    placeholder_refs: dict[str, tuple[str, str]],
    position_x: float,
    language: int = 3,
) -> dict[str, Any]:
    node_inputs = []
    for item in inputs:
        name = str(item.get("name") or "")
        if not name:
            raise ValueError("Each code step input must provide a non-empty 'name'.")
        raw_value = item.get("value")
        if raw_value is None and "input" in item and isinstance(item["input"], dict):
            raw_value = item["input"].get("value")
        node_inputs.append(
            {
                "name": name,
                "input": build_node_input(raw_value, placeholder_refs),
            }
        )

    node_outputs = {
        str(key): typed_schema(value)
        for key, value in outputs_example.items()
    }

    return {
        "id": node_id,
        "type": "code",
        "title": title,
        "icon": CODE_ICON,
        "description": description,
        "version": "v2",
        "position": {"x": position_x, "y": 118.0},
        "parameters": {
            "code": code,
            "language": language,
            "node_inputs": node_inputs,
            "node_outputs": node_outputs,
            "settingOnError": {"processType": 1, "retryTimes": 0, "timeoutMs": 60000},
        },
    }


def build_delay_plugin_node(
    delay_seconds: int,
    title: str,
    description: str,
    *,
    node_id: str = DELAY_NODE_ID,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "plugin",
        "title": title,
        "icon": DELAY_PLUGIN_ICON,
        "description": description,
        "position": {"x": 546.0, "y": 99.0},
        "parameters": {
            "apiParam": [
                {"name": "apiID", "input": {"type": "string", "value": "7498369465021743114"}},
                {"name": "apiName", "input": {"type": "string", "value": "delay"}},
                {"name": "pluginID", "input": {"type": "string", "value": "7494208090473250828"}},
                {"name": "pluginName", "input": {"type": "string", "value": "流光剪辑的工具箱"}},
                {"name": "pluginVersion", "input": {"type": "string", "value": ""}},
                {"name": "tips", "input": {"type": "string", "value": ""}},
                {"name": "outDocLink", "input": {"type": "string", "value": ""}},
            ],
            "node_inputs": [{"name": "second", "input": {"type": "integer", "value": delay_seconds}}],
            "node_outputs": {
                "author": {"type": "string", "value": None},
                "msg": {"type": "string", "value": None},
            },
            "settingOnError": {"processType": 1, "retryTimes": 0, "timeoutMs": 180000},
        },
    }


def build_condition_node(
    success_path: str,
    success_value: Any,
    title: str,
    description: str,
    *,
    node_id: str = CONDITION_NODE_ID,
    poll_parse_node_id: str = POLL_PARSE_NODE_ID,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "condition",
        "title": title,
        "icon": CONDITION_ICON,
        "description": description,
        "position": {"x": 1045.0, "y": 99.0},
        "parameters": {
            "branches": [
                {
                    "condition": {
                        "conditions": [
                            {
                                "left": {
                                    "input": {
                                        "value": ref_value(
                                            poll_parse_node_id,
                                            normalize_output_path(success_path),
                                        )
                                    }
                                },
                                "operator": 1,
                                "right": {"input": literal_input(success_value)},
                            }
                        ],
                        "logic": 2,
                    }
                }
            ]
        },
    }


def build_set_variable_node(
    result_schema: dict[str, Any],
    result_path: str,
    title: str,
    description: str,
    *,
    node_id: str = SET_VARIABLE_NODE_ID,
    loop_node_id: str = LOOP_NODE_ID,
    poll_parse_node_id: str = POLL_PARSE_NODE_ID,
) -> dict[str, Any]:
    left_input = copy_schema(result_schema)
    left_input["value"] = ref_value(loop_node_id, "result")

    right_input = copy_schema(result_schema)
    right_input["value"] = ref_value(poll_parse_node_id, normalize_output_path(result_path))

    return {
        "id": node_id,
        "type": "set_variable",
        "title": title,
        "icon": SET_VARIABLE_ICON,
        "description": description,
        "position": {"x": 1455.0, "y": 110.0},
        "parameters": {
            "node_inputs": [
                {"left": {"input": left_input}, "right": {"input": right_input}}
            ]
        },
    }


def build_break_node(
    title: str,
    description: str,
    *,
    node_id: str = BREAK_NODE_ID,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "break",
        "title": title,
        "icon": BREAK_ICON,
        "description": description,
        "position": {"x": 1865.0, "y": 121.0},
        "parameters": {},
    }


def build_loop_node(
    *,
    poll_http_node: dict[str, Any],
    poll_parse_node: dict[str, Any],
    labels: dict[str, dict[str, str]],
    success_path: str,
    success_value: Any,
    result_path: str,
    result_example: Any,
    loop_count: int,
    delay_seconds: int,
    ids: dict[str, str] | None = None,
) -> dict[str, Any]:
    resolved_ids = ids or {
        "loop": LOOP_NODE_ID,
        "poll_http": POLL_HTTP_NODE_ID,
        "poll_parse": POLL_PARSE_NODE_ID,
        "delay": DELAY_NODE_ID,
        "condition": CONDITION_NODE_ID,
        "set_variable": SET_VARIABLE_NODE_ID,
        "break": BREAK_NODE_ID,
    }
    safe_result_example = "" if result_example is None else result_example
    result_schema = typed_schema(safe_result_example)
    loop_output = {"value": schema_with_ref(safe_result_example, resolved_ids["loop"], "result")}
    variable_input = copy_schema(result_schema)
    variable_input["value"] = " " if result_schema["type"] == "string" else None

    return {
        "id": resolved_ids["loop"],
        "type": "loop",
        "title": labels["loop"]["title"],
        "icon": LOOP_ICON,
        "description": labels["loop"]["description"],
        "position": {"x": 2398.0, "y": -14.0},
        "canvas_position": {"x": 2308.0, "y": 535.0},
        "parameters": {
            "loopCount": {
                "type": "integer",
                "value": {"content": loop_count, "rawMeta": {"type": 2}, "type": "literal"},
            },
            "loopType": "count",
            "node_outputs": {"output": loop_output},
            "variableParameters": [{"name": "result", "input": variable_input}],
        },
        "nodes": [
            poll_http_node,
            poll_parse_node,
            build_delay_plugin_node(
                delay_seconds,
                labels["delay"]["title"],
                labels["delay"]["description"],
                node_id=resolved_ids["delay"],
            ),
            build_condition_node(
                success_path,
                success_value,
                labels["condition"]["title"],
                labels["condition"]["description"],
                node_id=resolved_ids["condition"],
                poll_parse_node_id=resolved_ids["poll_parse"],
            ),
            build_set_variable_node(
                result_schema,
                result_path,
                labels["set_variable"]["title"],
                labels["set_variable"]["description"],
                node_id=resolved_ids["set_variable"],
                loop_node_id=resolved_ids["loop"],
                poll_parse_node_id=resolved_ids["poll_parse"],
            ),
            build_break_node(
                labels["break"]["title"],
                labels["break"]["description"],
                node_id=resolved_ids["break"],
            ),
        ],
        "edges": [
            {
                "source_node": resolved_ids["loop"],
                "target_node": resolved_ids["poll_http"],
                "source_port": "loop-function-inline-output",
            },
            {"source_node": resolved_ids["poll_http"], "target_node": resolved_ids["poll_parse"]},
            {"source_node": resolved_ids["poll_parse"], "target_node": resolved_ids["delay"]},
            {"source_node": resolved_ids["delay"], "target_node": resolved_ids["condition"]},
            {
                "source_node": resolved_ids["condition"],
                "target_node": resolved_ids["set_variable"],
                "source_port": "true",
            },
            {
                "source_node": resolved_ids["condition"],
                "target_node": resolved_ids["loop"],
                "source_port": "false",
                "target_port": "loop-function-inline-input",
            },
            {"source_node": resolved_ids["set_variable"], "target_node": resolved_ids["break"]},
        ],
    }


def append_edge(
    edges: list[dict[str, Any]],
    source_node: str,
    target_node: str,
    *,
    source_port: str | None = None,
    target_port: str | None = None,
) -> None:
    edge: dict[str, Any] = {"source_node": source_node, "target_node": target_node}
    if source_port:
        edge["source_port"] = source_port
    if target_port:
        edge["target_port"] = target_port
    edges.append(edge)


def resolve_return_ref(
    return_spec: Any,
    output_refs: dict[str, tuple[str, str]],
    default_ref: tuple[str, str],
) -> tuple[str, str]:
    if return_spec in (None, "", {}):
        return default_ref

    if isinstance(return_spec, str):
        alias_ref = resolve_alias_ref(return_spec, output_refs)
        if alias_ref is not None:
            return alias_ref
        block_ref = resolve_block_output_ref(return_spec)
        if block_ref is not None:
            return block_ref
        return default_ref

    if isinstance(return_spec, dict):
        if "step" in return_spec:
            step_name = str(return_spec.get("step"))
            if step_name in output_refs:
                node_id, base_path = output_refs[step_name]
                return node_id, combine_ref_path(base_path, str(return_spec.get("path") or ""))
        if "node_id" in return_spec and "path" in return_spec:
            return str(return_spec["node_id"]), str(return_spec["path"])
    return default_ref


def compile_single_request_workflow(args: argparse.Namespace) -> dict[str, Any]:
    if not args.name.strip() or not args.method.strip() or not args.url.strip():
        raise ValueError("--name, --method and --url are required in single-request mode.")

    headers = sanitize_headers(load_json_arg(args.headers_json, {}))
    params = load_json_arg(args.params_json, {})
    body = load_json_arg(args.body_json, None)
    submit_response_example = load_json_arg(args.submit_response_example_json, None)
    poll_headers = sanitize_headers(load_json_arg(args.poll_headers_json, headers))
    poll_params = load_json_arg(args.poll_params_json, {})
    poll_body = load_json_arg(args.poll_body_json, None)
    poll_response_example = load_json_arg(args.poll_response_example_json, None)

    if not isinstance(headers, dict) or not isinstance(params, dict):
        raise ValueError("--headers-json and --params-json must be JSON objects.")
    if args.poll_url and not isinstance(poll_headers, dict):
        raise ValueError("--poll-headers-json must be a JSON object.")
    if args.poll_url and not isinstance(poll_params, dict):
        raise ValueError("--poll-params-json must be a JSON object.")

    raw_workflow_name = args.name.strip()
    workflow_name = normalize_workflow_name(raw_workflow_name)
    description = args.description.strip() or raw_workflow_name or workflow_name
    workflow_id = generate_numeric_id()
    shortid = str(uuid.uuid4().int % 10000)
    folder_name = args.folder_name.strip() or f"Workflow-{slugify(raw_workflow_name or workflow_name)}-draft-{shortid}"
    labels = build_node_labels(description, args.url, args.poll_url)

    nodes = [
        build_start_node(),
        build_http_node(
            node_id=SUBMIT_HTTP_NODE_ID,
            title=labels["submit_http"]["title"],
            description=labels["submit_http"]["description"],
            method=args.method,
            url=args.url,
            headers=headers,
            params=params,
            body=body,
            position_x=420.0,
            placeholder_refs={"submit": (SUBMIT_PARSE_NODE_ID, "output"), "start": (START_NODE_ID, "")},
        ),
    ]
    edges: list[dict[str, Any]] = []
    append_edge(edges, START_NODE_ID, SUBMIT_HTTP_NODE_ID)

    last_node_id = SUBMIT_HTTP_NODE_ID
    last_path = "body"
    last_source_port: str | None = None

    if submit_response_example is not None:
        nodes.append(
            build_from_json_node(
                node_id=SUBMIT_PARSE_NODE_ID,
                title=labels["submit_parse"]["title"],
                description=labels["submit_parse"]["description"],
                source_node_id=SUBMIT_HTTP_NODE_ID,
                example=submit_response_example,
                position_x=834.0,
            )
        )
        append_edge(edges, SUBMIT_HTTP_NODE_ID, SUBMIT_PARSE_NODE_ID)
        last_node_id = SUBMIT_PARSE_NODE_ID
        last_path = "output"

    if args.poll_url:
        if not poll_params and not poll_body and (args.poll_method or "GET").upper() == "GET":
            poll_params = {"task_id": "${submit.task_id}"}
        effective_result_path, effective_success_path = resolve_poll_paths(
            submit_url=args.url,
            poll_url=args.poll_url,
            poll_response_example=poll_response_example,
            configured_result_path=args.poll_result_path,
            configured_success_path=args.poll_success_path,
        )
        poll_http_node = build_http_node(
            node_id=POLL_HTTP_NODE_ID,
            title=labels["poll_http"]["title"],
            description=labels["poll_http"]["description"],
            method=args.poll_method or "GET",
            url=args.poll_url,
            headers=poll_headers,
            params=poll_params,
            body=poll_body,
            position_x=-364.0,
            placeholder_refs={"submit": (SUBMIT_PARSE_NODE_ID, "output"), "start": (START_NODE_ID, "")},
        )

        if poll_response_example is None:
            nodes.append(poll_http_node)
            append_edge(edges, last_node_id, POLL_HTTP_NODE_ID, source_port=last_source_port)
            last_node_id = POLL_HTTP_NODE_ID
            last_path = "body"
            last_source_port = None
        else:
            poll_parse_node = build_from_json_node(
                node_id=POLL_PARSE_NODE_ID,
                title=labels["poll_parse"]["title"],
                description=labels["poll_parse"]["description"],
                source_node_id=POLL_HTTP_NODE_ID,
                example=poll_response_example,
                position_x=82.0,
            )
            result_example = extract_example_path(poll_response_example, effective_result_path)
            loop_node = build_loop_node(
                poll_http_node=poll_http_node,
                poll_parse_node=poll_parse_node,
                labels=labels,
                success_path=effective_success_path,
                success_value=parse_loose_literal(args.poll_success_value),
                result_path=effective_result_path,
                result_example=result_example,
                loop_count=args.poll_loop_count,
                delay_seconds=args.poll_delay_seconds,
            )
            nodes.append(loop_node)
            append_edge(edges, last_node_id, LOOP_NODE_ID, source_port=last_source_port)
            last_node_id = LOOP_NODE_ID
            last_path = "output"
            last_source_port = "loop-output"

    nodes.append(build_end_node(last_node_id, last_path, position_x=1768.0 if last_node_id != LOOP_NODE_ID else 3000.0))
    append_edge(edges, last_node_id, END_NODE_ID, source_port=last_source_port)

    workflow_yaml = {
        "schema_version": "1.0.0",
        "name": workflow_name,
        "id": workflow_id,
        "description": description,
        "mode": "workflow",
        "icon": "plugin_icon/workflow.png",
        "nodes": nodes,
        "edges": edges,
    }
    manifest_yaml = {
        "type": "Workflow",
        "version": "1.0.0",
        "main": {
            "id": workflow_id,
            "name": workflow_name,
            "desc": description,
            "icon": "plugin_icon/workflow.png",
            "version": "",
            "flowMode": 0,
            "commitId": "",
        },
        "sub": [],
    }

    return {
        "workflow_yaml": workflow_yaml,
        "manifest_yaml": manifest_yaml,
        "workflow_name": workflow_name,
        "folder_name": folder_name,
        "workflow_id": workflow_id,
        "mode": "single",
        "has_polling": bool(args.poll_url),
        "uses_loop_polling": bool(args.poll_url and poll_response_example is not None),
    }


def compile_workflow_spec(
    spec: dict[str, Any],
    *,
    output_root: str,
    folder_name_override: str,
) -> dict[str, Any]:
    raw_workflow_name = str(spec.get("name") or "").strip()
    if not raw_workflow_name:
        raise ValueError("Workflow spec must provide a top-level 'name'.")
    description = str(spec.get("description") or raw_workflow_name).strip()
    workflow_name = normalize_workflow_name(raw_workflow_name)
    workflow_id = generate_numeric_id()
    shortid = str(uuid.uuid4().int % 10000)
    folder_name = folder_name_override.strip() or str(spec.get("folder_name") or "").strip()
    if not folder_name:
        folder_name = f"Workflow-{slugify(raw_workflow_name)}-draft-{shortid}"

    start_inputs = spec.get("inputs") or [{"name": "input", "type": "string"}]
    if not isinstance(start_inputs, list):
        raise ValueError("'inputs' in workflow spec must be a list.")

    nodes: list[dict[str, Any]] = [build_start_node(start_inputs)]
    edges: list[dict[str, Any]] = []
    allocator = NodeIdAllocator()
    output_refs: dict[str, tuple[str, str]] = {"start": (START_NODE_ID, "")}
    previous_node_id = START_NODE_ID
    previous_source_port: str | None = None
    last_ref: tuple[str, str] = (START_NODE_ID, str(start_inputs[0].get("name") or "input"))
    cursor_x = 420.0

    steps = spec.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError("Workflow spec must provide a non-empty 'steps' array.")

    for index, step in enumerate(steps, start=1):
        if not isinstance(step, dict):
            raise ValueError(f"Step #{index} must be an object.")
        step_id = str(step.get("id") or f"step_{index}")
        step_kind = str(step.get("kind") or "http")

        if step_kind in {"http", "sync_http"}:
            method = str(step.get("method") or "").strip()
            url = str(step.get("url") or "").strip()
            if not method or not url:
                raise ValueError(f"HTTP step '{step_id}' must provide method and url.")

            headers = sanitize_headers(step.get("headers") or {})
            params = step.get("params") or {}
            body = step.get("body")
            response_example = step.get("response_example")
            title = str(step.get("title") or step_id)
            title_parse = str(step.get("parse_title") or f"解析{title}结果")
            desc = str(step.get("description") or f"调用接口执行{title}。")
            desc_parse = str(step.get("parse_description") or f"解析{title}返回结果。")

            http_node_id = allocator.next_id()
            http_node = build_http_node(
                node_id=http_node_id,
                title=title,
                description=desc,
                method=method,
                url=url,
                headers=headers,
                params=params,
                body=body,
                position_x=cursor_x,
                placeholder_refs=output_refs,
            )
            nodes.append(http_node)
            append_edge(edges, previous_node_id, http_node_id, source_port=previous_source_port)

            current_node_id = http_node_id
            current_path = "body"
            previous_source_port = None
            cursor_x += 420.0

            if response_example is not None:
                parse_node_id = allocator.next_id()
                parse_node = build_from_json_node(
                    node_id=parse_node_id,
                    title=title_parse,
                    description=desc_parse,
                    source_node_id=http_node_id,
                    example=response_example,
                    position_x=cursor_x,
                )
                nodes.append(parse_node)
                append_edge(edges, http_node_id, parse_node_id)
                current_node_id = parse_node_id
                current_path = "output"
                cursor_x += 420.0

            output_refs[step_id] = (current_node_id, current_path)
            previous_node_id = current_node_id
            last_ref = (current_node_id, current_path)
            continue

        if step_kind == "code":
            title = str(step.get("title") or step_id)
            code_description = str(step.get("description") or f"使用代码处理{title}所需的中间逻辑。")
            code = str(step.get("code") or "").rstrip()
            if not code:
                raise ValueError(f"Code step '{step_id}' must provide non-empty code.")

            inputs = step.get("inputs") or step.get("node_inputs") or []
            if not isinstance(inputs, list):
                raise ValueError(f"Code step '{step_id}' must provide a list in 'inputs'.")

            outputs_example = step.get("outputs_example")
            if outputs_example is None:
                outputs_example = step.get("node_outputs_example")
            if not isinstance(outputs_example, dict) or not outputs_example:
                raise ValueError(
                    f"Code step '{step_id}' must provide a non-empty object in 'outputs_example'."
                )

            language = int(step.get("language") or 3)
            code_node_id = allocator.next_id()
            code_node = build_code_node(
                node_id=code_node_id,
                title=title,
                description=code_description,
                code=code,
                inputs=inputs,
                outputs_example=outputs_example,
                placeholder_refs=output_refs,
                position_x=cursor_x,
                language=language,
            )
            nodes.append(code_node)
            append_edge(edges, previous_node_id, code_node_id, source_port=previous_source_port)
            output_refs[step_id] = (code_node_id, "")
            previous_node_id = code_node_id
            previous_source_port = None
            first_output_name = next(iter(outputs_example))
            last_ref = (code_node_id, str(first_output_name))
            cursor_x += 420.0
            continue

        if step_kind == "async_http":
            submit = step.get("submit") or {}
            poll = step.get("poll") or {}
            submit_method = str(submit.get("method") or "").strip()
            submit_url = str(submit.get("url") or "").strip()
            poll_method = str(poll.get("method") or "GET").strip()
            poll_url = str(poll.get("url") or "").strip()
            if not submit_method or not submit_url or not poll_url:
                raise ValueError(f"Async step '{step_id}' must provide submit.method, submit.url and poll.url.")

            submit_response_example = submit.get("response_example")
            poll_response_example = poll.get("response_example")
            if submit_response_example is None or poll_response_example is None:
                raise ValueError(f"Async step '{step_id}' must provide submit.response_example and poll.response_example.")

            labels = build_node_labels(
                str(step.get("description") or step.get("title") or step_id),
                submit_url,
                poll_url,
            )
            step_ids = allocator.async_group()
            submit_http_title = str(submit.get("title") or labels["submit_http"]["title"])
            submit_http_desc = str(submit.get("description") or labels["submit_http"]["description"])
            submit_parse_title = str(submit.get("parse_title") or labels["submit_parse"]["title"])
            submit_parse_desc = str(submit.get("parse_description") or labels["submit_parse"]["description"])
            poll_http_title = str(poll.get("title") or labels["poll_http"]["title"])
            poll_http_desc = str(poll.get("description") or labels["poll_http"]["description"])
            poll_parse_title = str(poll.get("parse_title") or labels["poll_parse"]["title"])
            poll_parse_desc = str(poll.get("parse_description") or labels["poll_parse"]["description"])

            submit_http_node = build_http_node(
                node_id=step_ids["submit_http"],
                title=submit_http_title,
                description=submit_http_desc,
                method=submit_method,
                url=submit_url,
                headers=sanitize_headers(submit.get("headers") or {}),
                params=submit.get("params") or {},
                body=submit.get("body"),
                position_x=cursor_x,
                placeholder_refs=output_refs,
            )
            submit_parse_node = build_from_json_node(
                node_id=step_ids["submit_parse"],
                title=submit_parse_title,
                description=submit_parse_desc,
                source_node_id=step_ids["submit_http"],
                example=submit_response_example,
                position_x=cursor_x + 420.0,
            )
            poll_placeholder_refs = dict(output_refs)
            poll_placeholder_refs["submit"] = (step_ids["submit_parse"], "output")

            poll_params = poll.get("params") or {}
            poll_body = poll.get("body")
            if not poll_params and not poll_body and poll_method.upper() == "GET":
                poll_params = {"task_id": "${submit.task_id}"}

            poll_http_node = build_http_node(
                node_id=step_ids["poll_http"],
                title=poll_http_title,
                description=poll_http_desc,
                method=poll_method,
                url=poll_url,
                headers=sanitize_headers(poll.get("headers") or submit.get("headers") or {}),
                params=poll_params,
                body=poll_body,
                position_x=-364.0,
                placeholder_refs=poll_placeholder_refs,
            )
            poll_parse_node = build_from_json_node(
                node_id=step_ids["poll_parse"],
                title=poll_parse_title,
                description=poll_parse_desc,
                source_node_id=step_ids["poll_http"],
                example=poll_response_example,
                position_x=82.0,
            )

            effective_result_path, effective_success_path = resolve_poll_paths(
                submit_url=submit_url,
                poll_url=poll_url,
                poll_response_example=poll_response_example,
                configured_result_path=str(poll.get("result_path") or "output"),
                configured_success_path=str(poll.get("success_path") or "status"),
            )
            result_example = extract_example_path(poll_response_example, effective_result_path)
            loop_node = build_loop_node(
                poll_http_node=poll_http_node,
                poll_parse_node=poll_parse_node,
                labels={
                    **labels,
                    "loop": {
                        "title": str(step.get("loop_title") or labels["loop"]["title"]),
                        "description": str(step.get("loop_description") or labels["loop"]["description"]),
                    },
                    "delay": {
                        "title": str(poll.get("delay_title") or labels["delay"]["title"]),
                        "description": str(poll.get("delay_description") or labels["delay"]["description"]),
                    },
                    "condition": {
                        "title": str(poll.get("condition_title") or labels["condition"]["title"]),
                        "description": str(poll.get("condition_description") or labels["condition"]["description"]),
                    },
                    "set_variable": {
                        "title": str(poll.get("set_variable_title") or labels["set_variable"]["title"]),
                        "description": str(poll.get("set_variable_description") or labels["set_variable"]["description"]),
                    },
                    "break": {
                        "title": str(poll.get("break_title") or labels["break"]["title"]),
                        "description": str(poll.get("break_description") or labels["break"]["description"]),
                    },
                },
                success_path=effective_success_path,
                success_value=parse_loose_literal(str(poll.get("success_value") or "success")),
                result_path=effective_result_path,
                result_example=result_example,
                loop_count=int(poll.get("loop_count") or 60),
                delay_seconds=int(poll.get("delay_seconds") or 30),
                ids=step_ids,
            )

            nodes.extend([submit_http_node, submit_parse_node, loop_node])
            append_edge(edges, previous_node_id, step_ids["submit_http"], source_port=previous_source_port)
            append_edge(edges, step_ids["submit_http"], step_ids["submit_parse"])
            append_edge(edges, step_ids["submit_parse"], step_ids["loop"])

            output_refs[step_id] = (step_ids["loop"], "output")
            previous_node_id = step_ids["loop"]
            previous_source_port = "loop-output"
            last_ref = (step_ids["loop"], "output")
            cursor_x += 1200.0
            continue

        raise ValueError(f"Unsupported step kind '{step_kind}' in step '{step_id}'.")

    end_node_id, end_path = resolve_return_ref(spec.get("return"), output_refs, last_ref)
    nodes.append(build_end_node(end_node_id, end_path, position_x=cursor_x + 300.0))
    append_edge(edges, previous_node_id, END_NODE_ID, source_port=previous_source_port)

    workflow_yaml = {
        "schema_version": "1.0.0",
        "name": workflow_name,
        "id": workflow_id,
        "description": description,
        "mode": "workflow",
        "icon": "plugin_icon/workflow.png",
        "nodes": nodes,
        "edges": edges,
    }
    manifest_yaml = {
        "type": "Workflow",
        "version": "1.0.0",
        "main": {
            "id": workflow_id,
            "name": workflow_name,
            "desc": description,
            "icon": "plugin_icon/workflow.png",
            "version": "",
            "flowMode": 0,
            "commitId": "",
        },
        "sub": [],
    }

    return {
        "workflow_yaml": workflow_yaml,
        "manifest_yaml": manifest_yaml,
        "workflow_name": workflow_name,
        "folder_name": folder_name,
        "workflow_id": workflow_id,
        "mode": "spec",
        "has_polling": any(str(step.get("kind") or "") == "async_http" for step in steps),
        "uses_loop_polling": any(str(step.get("kind") or "") == "async_http" for step in steps),
        "output_root": str(spec.get("output_root") or output_root),
    }


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def make_zip(output_dir: Path) -> Path:
    archive_base = output_dir.parent / output_dir.name
    return Path(
        shutil.make_archive(
            str(archive_base),
            "zip",
            root_dir=output_dir.parent,
            base_dir=output_dir.name,
        )
    )


def main() -> int:
    args = parse_args()
    try:
        workflow_spec: Any = None
        if args.workflow_spec_file:
            workflow_spec = load_json_file(args.workflow_spec_file)
        elif args.workflow_spec_json:
            workflow_spec = load_json_arg(args.workflow_spec_json, None)

        if workflow_spec is not None:
            compiled = compile_workflow_spec(
                workflow_spec,
                output_root=args.output_root,
                folder_name_override=args.folder_name,
            )
            output_root = Path(
                str(compiled.get("output_root") or args.output_root)
            ).expanduser().resolve()
        else:
            compiled = compile_single_request_workflow(args)
            output_root = Path(args.output_root).expanduser().resolve()
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    output_dir = output_root / str(compiled["folder_name"])
    workflow_dir = output_dir / "workflow"
    workflow_file = workflow_dir / f'{compiled["workflow_name"]}-draft.yaml'
    manifest_file = output_dir / "MANIFEST.yml"

    write_text(manifest_file, dump_yaml(compiled["manifest_yaml"]))
    write_text(workflow_file, dump_yaml(compiled["workflow_yaml"]))
    zip_file = make_zip(output_dir)

    summary = {
        "success": True,
        "mode": compiled["mode"],
        "output_dir": str(output_dir),
        "zip_path": str(zip_file),
        "manifest": str(manifest_file),
        "workflow": str(workflow_file),
        "has_polling": compiled["has_polling"],
        "uses_loop_polling": compiled["uses_loop_polling"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
