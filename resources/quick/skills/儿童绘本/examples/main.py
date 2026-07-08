#!/usr/bin/env python3
"""创建 VectCut 草稿，并把本地图片写入草稿的 0~5 秒区间。

接口文档：
- create_draft: https://docs.vectcut.com/321174266e0
- add_image: https://docs.vectcut.com/320460206e0

运行方式：
    export VECTCUT_API_KEY="你的 token"
    python3 example1.py

说明：
- `add_image` 文档要求传 `image_url`，这里会把本地图片转成 `data:image/...;base64,...` 后提交。
- 如果服务端不接受 data URL，脚本会打印接口错误详情；此时可将图片先上传到公网，再替换为公网 URL。
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


CREATE_DRAFT_URL = "https://open.vectcut.com/cut_jianying/create_draft"
ADD_IMAGE_URL = "https://open.vectcut.com/cut_jianying/add_image"

BASE_DIR = Path(__file__).resolve().parent
IMAGE_PATH = BASE_DIR / "shop_image_5.jpg"
DRAFT_NAME = "儿童绘本示例-单图草稿"
CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920
IMAGE_START = 0
IMAGE_END = 5


class ApiError(RuntimeError):
    """包装接口失败信息，方便直接打印结构化错误。"""


def parse_error_payload(error: Exception) -> dict[str, Any]:
    message = str(error)
    try:
        parsed = json.loads(message)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    return {"message": message}


def emit_payload(
    *,
    ok: bool,
    phase: str,
    draft_ids: list[str] | None = None,
    draft_id: str = "",
    draft_url: str = "",
    create_draft_result: dict[str, Any] | None = None,
    add_image_result: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
    stream: Any = sys.stdout,
) -> None:
    normalized_draft_id = str(draft_id or "").strip()
    normalized_draft_ids = (
        [str(item).strip() for item in (draft_ids or []) if str(item).strip()]
        or ([normalized_draft_id] if normalized_draft_id else [])
    )
    payload = {
        "ok": ok,
        "phase": phase,
        "draft_ids": normalized_draft_ids,
        "draft_id": normalized_draft_ids[0] if normalized_draft_ids else normalized_draft_id,
        "draft_url": str(draft_url or "").strip(),
        "create_draft_result": create_draft_result or None,
        "add_image_result": add_image_result or None,
        "error": error or None,
    }
    print(json.dumps(payload, ensure_ascii=False), file=stream)


def post_json(url: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise ApiError(
            json.dumps(
                {
                    "phase": "http_error",
                    "url": url,
                    "http_status": error.code,
                    "response": body,
                },
                ensure_ascii=False,
                indent=2,
            )
        ) from error
    except URLError as error:
        raise ApiError(
            json.dumps(
                {
                    "phase": "network_error",
                    "url": url,
                    "reason": str(error.reason),
                },
                ensure_ascii=False,
                indent=2,
            )
        ) from error

    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise ApiError(
            json.dumps(
                {
                    "phase": "invalid_json",
                    "url": url,
                    "response": raw,
                },
                ensure_ascii=False,
                indent=2,
            )
        ) from error


def ensure_success(phase: str, url: str, result: dict[str, Any]) -> dict[str, Any]:
    if result.get("success") is True:
        return result

    raise ApiError(
        json.dumps(
            {
                "phase": phase,
                "url": url,
                "response": result,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def local_image_to_data_url(image_path: Path) -> str:
    if not image_path.exists():
        raise FileNotFoundError(f"图片不存在: {image_path}")

    mime_type, _ = mimetypes.guess_type(str(image_path))
    resolved_mime = mime_type or "image/jpeg"
    raw = image_path.read_bytes()
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:{resolved_mime};base64,{encoded}"


def create_draft(token: str) -> dict[str, Any]:
    payload = {
        "width": CANVAS_WIDTH,
        "height": CANVAS_HEIGHT,
        "name": DRAFT_NAME,
    }
    result = post_json(CREATE_DRAFT_URL, token, payload)
    return ensure_success("create_draft", CREATE_DRAFT_URL, result)


def add_image(token: str, draft_id: str, image_url: str) -> dict[str, Any]:
    payload = {
        "draft_id": draft_id,
        "image_url": image_url,
        "start": IMAGE_START,
        "end": IMAGE_END,
        "track_name": "main",
    }
    result = post_json(ADD_IMAGE_URL, token, payload)
    return ensure_success("add_image", ADD_IMAGE_URL, result)


def main() -> int:
    token = os.getenv("VECTCUT_API_KEY", "").strip()
    if not token:
        emit_payload(
            ok=False,
            phase="bootstrap",
            error={"message": "缺少环境变量 VECTCUT_API_KEY"},
            stream=sys.stderr,
        )
        return 1

    draft_result: dict[str, Any] | None = None
    image_result: dict[str, Any] | None = None
    try:
        image_data_url = local_image_to_data_url(IMAGE_PATH)

        draft_result = create_draft(token)
        draft_output = draft_result.get("output") or {}
        draft_id = str(draft_output.get("draft_id") or "").strip()
        if not draft_id:
            raise ApiError(
                json.dumps(
                    {
                        "phase": "create_draft",
                        "url": CREATE_DRAFT_URL,
                        "response": draft_result,
                        "message": "返回里缺少 output.draft_id",
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )

        image_result = add_image(token, draft_id, image_data_url)
        final_output = image_result.get("output") or {}
        final_draft_id = str(final_output.get("draft_id") or draft_id).strip()
        final_draft_url = str(final_output.get("draft_url") or draft_output.get("draft_url") or "").strip()
        if not final_draft_id:
            raise ApiError(
                json.dumps(
                    {
                        "phase": "add_image",
                        "url": ADD_IMAGE_URL,
                        "response": image_result,
                        "message": "返回里缺少 output.draft_id",
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )

        emit_payload(
            ok=True,
            phase="completed",
            draft_ids=[final_draft_id],
            draft_id=final_draft_id,
            draft_url=final_draft_url,
            create_draft_result=draft_result,
            add_image_result=image_result,
        )
        return 0
    except Exception as error:
        emit_payload(
            ok=False,
            phase="error",
            create_draft_result=draft_result,
            add_image_result=image_result,
            error=parse_error_payload(error),
            stream=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
