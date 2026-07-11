#!/usr/bin/env python3
"""创建 VectCut 草稿，写入本地图片和音频路径，并执行字幕工作流。

接口文档：
- create_draft: https://docs.vectcut.com/321174266e0
- add_image: https://docs.vectcut.com/320460206e0
- add_audio: https://docs.vectcut.com/321196190e0
- execute_workflow: https://docs.vectcut.com/363414609e0

运行方式：
    export VECTCUT_API_KEY="你的 token"
    python3 example1.py

说明：
- `add_image` / `add_audio` 直接使用脚本目录下素材文件的本地路径字符串。
- 素材路径基于 `Path(__file__).resolve().parent` 计算，兼容 macOS / Windows。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


CREATE_DRAFT_URL = "https://open.vectcut.com/cut_jianying/create_draft"
ADD_IMAGE_URL = "https://open.vectcut.com/cut_jianying/add_image"
ADD_AUDIO_URL = "https://open.vectcut.com/cut_jianying/add_audio"
EXECUTE_WORKFLOW_URL = "https://open.vectcut.com/cut_jianying/execute_workflow"

BASE_DIR = Path(__file__).resolve().parent
DRAFT_NAME = "儿童绘本示例-单图草稿"
CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920
AUDIO_START = 0
AUDIO_TARGET_START = 0
AUDIO_TRACK_NAME = "audio_main"
AUDIO_PATH = BASE_DIR / "music.wav"
IMAGE_SPECS = [
    {"path": BASE_DIR / "image_1.png", "start": 0, "end": 12.75, "track_name": "video_main", "transition": "向左", "intro_animation": "放大", "intro_animation_duration": 0.5, "outro_animation": "缩小", "outro_animation_duration": 0.5},
    {"path": BASE_DIR / "image_2.png", "start": 12.75, "end": 28.61, "track_name": "video_main", "transition": "右移", "intro_animation": "放大", "intro_animation_duration": 0.5, "outro_animation": "缩小", "outro_animation_duration": 0.5},
    {"path": BASE_DIR / "image_3.png", "start": 28.61, "end": 47.07, "track_name": "video_main", "transition": "向右", "intro_animation": "放大", "intro_animation_duration": 0.5, "outro_animation": "缩小", "outro_animation_duration": 0.5},
    {"path": BASE_DIR / "image_4.png", "start": 47.07, "end": 57.38, "track_name": "video_main", "transition": "左移", "intro_animation": "放大", "intro_animation_duration": 0.5, "outro_animation": "缩小", "outro_animation_duration": 0.5},
    {"path": BASE_DIR / "image_5.png", "start": 57.38, "end": 76, "track_name": "video_main", "intro_animation": "放大", "intro_animation_duration": 0.5, "outro_animation": "缩小", "outro_animation_duration": 0.5},
]
WORKFLOW_ID = "42da310c1e4347ddb2c96dd2a5d055c2"
SUBTITLES = [
    {"id": "sub_001", "text": "森林深处住着一只小狮子", "start_time": 0.22, "end_time": 2.70, "target_track": "track_sub"},
    {"id": "sub_002", "text": "名叫阳阳", "start_time": 3.10, "end_time": 4.10, "target_track": "track_sub"},
    {"id": "sub_003", "text": "洋洋有一头金黄色的鬃毛", "start_time": 5.29, "end_time": 7.49, "target_track": "track_sub"},
    {"id": "sub_004", "text": "看起来威风极了", "start_time": 7.81, "end_time": 9.57, "target_track": "track_sub"},
    {"id": "sub_005", "text": "可是呀", "start_time": 10.43, "end_time": 10.99, "target_track": "track_sub"},
    {"id": "sub_006", "text": "洋洋有个小麻烦", "start_time": 11.39, "end_time": 12.75, "target_track": "track_sub"},
    {"id": "sub_007", "text": "每当他不开心的时候", "start_time": 13.42, "end_time": 15.02, "target_track": "track_sub"},
    {"id": "sub_008", "text": "就会大声吼叫", "start_time": 15.26, "end_time": 16.78, "target_track": "track_sub"},
    {"id": "sub_009", "text": "森林里的朋友们都有点害怕", "start_time": 19.08, "end_time": 21.56, "target_track": "track_sub"},
    {"id": "sub_010", "text": "他", "start_time": 21.72, "end_time": 21.80, "target_track": "track_sub"},
    {"id": "sub_011", "text": "一天早上", "start_time": 23.41, "end_time": 24.33, "target_track": "track_sub"},
    {"id": "sub_012", "text": "阳阳想和小兔子玩", "start_time": 24.89, "end_time": 26.57, "target_track": "track_sub"},
    {"id": "sub_013", "text": "小兔子摇摇头", "start_time": 27.29, "end_time": 28.61, "target_track": "track_sub"},
    {"id": "sub_014", "text": "蹦蹦跳跳走远了", "start_time": 28.85, "end_time": 30.65, "target_track": "track_sub"},
    {"id": "sub_015", "text": "洋洋觉得好难过", "start_time": 31.97, "end_time": 33.53, "target_track": "track_sub"},
    {"id": "sub_016", "text": "眼泪在眼眶里打转", "start_time": 34.05, "end_time": 36.13, "target_track": "track_sub"},
    {"id": "sub_017", "text": "洋洋", "start_time": 37.17, "end_time": 37.49, "target_track": "track_sub"},
    {"id": "sub_018", "text": "你是不是有心事呀", "start_time": 38.01, "end_time": 39.65, "target_track": "track_sub"},
    {"id": "sub_019", "text": "我只是想和大家一起玩", "start_time": 40.86, "end_time": 43.02, "target_track": "track_sub"},
    {"id": "sub_020", "text": "那你可以试着告诉朋友们你", "start_time": 44.39, "end_time": 47.07, "target_track": "track_sub"},
    {"id": "sub_021", "text": "的真实感受", "start_time": 47.07, "end_time": 48.39, "target_track": "track_sub"},
    {"id": "sub_022", "text": "对不起", "start_time": 50.26, "end_time": 50.90, "target_track": "track_sub"},
    {"id": "sub_023", "text": "我之前吼你了", "start_time": 51.18, "end_time": 52.74, "target_track": "track_sub"},
    {"id": "sub_024", "text": "我其实只是想和你做朋友", "start_time": 52.98, "end_time": 55.34, "target_track": "track_sub"},
    {"id": "sub_025", "text": "我也想和你玩呀", "start_time": 55.94, "end_time": 57.38, "target_track": "track_sub"},
    {"id": "sub_026", "text": "从那天起", "start_time": 58.14, "end_time": 59.02, "target_track": "track_sub"},
    {"id": "sub_027", "text": "洋洋学会了用温柔的话语", "start_time": 59.58, "end_time": 61.86, "target_track": "track_sub"},
    {"id": "sub_028", "text": "表达自己", "start_time": 61.90, "end_time": 62.74, "target_track": "track_sub"},
    {"id": "sub_029", "text": "森林里又充满了欢声笑语", "start_time": 63.53, "end_time": 66.05, "target_track": "track_sub"},
    {"id": "sub_030", "text": "夕阳洒下金色的光", "start_time": 67.14, "end_time": 69.14, "target_track": "track_sub"},
    {"id": "sub_031", "text": "阳阳和朋友们围坐在一起", "start_time": 69.78, "end_time": 71.98, "target_track": "track_sub"},
    {"id": "sub_032", "text": "讲着今天的故事", "start_time": 72.34, "end_time": 74.22, "target_track": "track_sub"},
]


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


def summarize_text(value: str, *, preview_length: int = 80) -> dict[str, Any]:
    normalized = str(value or "")
    return {
        "preview": normalized[:preview_length],
        "length": len(normalized),
    }


def emit_debug_log(event: str, payload: dict[str, Any]) -> None:
    print(
        json.dumps(
            {
                "debug": True,
                "event": event,
                "payload": payload,
            },
            ensure_ascii=False,
        ),
        file=sys.stderr,
    )


def emit_payload(
    *,
    ok: bool,
    phase: str,
    draft_ids: list[str] | None = None,
    draft_id: str = "",
    draft_url: str = "",
    create_draft_result: dict[str, Any] | None = None,
    add_image_result: dict[str, Any] | None = None,
    add_audio_result: dict[str, Any] | None = None,
    workflow_result: dict[str, Any] | None = None,
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
        "add_audio_result": add_audio_result or None,
        "workflow_result": workflow_result or None,
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


def local_path_to_string(path: Path, *, label: str) -> str:
    resolved = path.resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"缺少{label}: {resolved}")
    return str(resolved)


def create_draft(token: str) -> dict[str, Any]:
    payload = {
        "width": CANVAS_WIDTH,
        "height": CANVAS_HEIGHT,
        "name": DRAFT_NAME,
    }
    result = post_json(CREATE_DRAFT_URL, token, payload)
    return ensure_success("create_draft", CREATE_DRAFT_URL, result)


def add_image(
    token: str,
    draft_id: str,
    image_url: str,
    *,
    start: float,
    end: float,
    track_name: str,
    transition: str | None = None,
    intro_animation: str | None = None,
    intro_animation_duration: float | None = None,
    outro_animation: str | None = None,
    outro_animation_duration: float | None = None,
) -> dict[str, Any]:
    emit_debug_log(
        "add_image.request",
        {
            "url": ADD_IMAGE_URL,
            "draft_id": draft_id,
            "start": start,
            "end": end,
            "track_name": track_name,
            "transition": transition or "",
            "intro_animation": intro_animation or "",
            "intro_animation_duration": intro_animation_duration,
            "outro_animation": outro_animation or "",
            "outro_animation_duration": outro_animation_duration,
            "image_url": summarize_text(image_url),
        },
    )
    payload = {
        "draft_id": draft_id,
        "image_url": image_url,
        "start": start,
        "end": end,
        "track_name": track_name,
    }
    if transition:
        payload["transition"] = transition
    if intro_animation:
        payload["intro_animation"] = intro_animation
    if intro_animation_duration is not None:
        payload["intro_animation_duration"] = intro_animation_duration
    if outro_animation:
        payload["outro_animation"] = outro_animation
    if outro_animation_duration is not None:
        payload["outro_animation_duration"] = outro_animation_duration
    result = post_json(ADD_IMAGE_URL, token, payload)
    emit_debug_log(
        "add_image.response",
        {
            "url": ADD_IMAGE_URL,
            "draft_id": draft_id,
            "start": start,
            "end": end,
            "track_name": track_name,
            "transition": transition or "",
            "intro_animation": intro_animation or "",
            "intro_animation_duration": intro_animation_duration,
            "outro_animation": outro_animation or "",
            "outro_animation_duration": outro_animation_duration,
            "result": result,
        },
    )
    return ensure_success("add_image", ADD_IMAGE_URL, result)


def add_audio(token: str, draft_id: str, audio_url: str) -> dict[str, Any]:
    payload = {
        "draft_id": draft_id,
        "audio_url": audio_url,
        "start": AUDIO_START,
        "target_start": AUDIO_TARGET_START,
        "track_name": AUDIO_TRACK_NAME,
        "width": CANVAS_WIDTH,
        "height": CANVAS_HEIGHT,
    }
    result = post_json(ADD_AUDIO_URL, token, payload)
    return ensure_success("add_audio", ADD_AUDIO_URL, result)


def execute_workflow(token: str, draft_id: str) -> dict[str, Any]:
    payload = {
        "draft_id": draft_id,
        "inputs": {
            "subtitles": SUBTITLES,
        },
        "workflow_id": WORKFLOW_ID,
    }
    result = post_json(EXECUTE_WORKFLOW_URL, token, payload)
    return ensure_success("execute_workflow", EXECUTE_WORKFLOW_URL, result)


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
    audio_result: dict[str, Any] | None = None
    workflow_result: dict[str, Any] | None = None
    try:
        audio_url = local_path_to_string(AUDIO_PATH, label="音频文件")
        image_specs = [
            {
                "image_url": local_path_to_string(
                    spec["path"],
                    label=f"图片文件 {spec['path'].name}",
                ),
                "start": spec["start"],
                "end": spec["end"],
                "track_name": spec["track_name"],
                "transition": spec.get("transition"),
                "intro_animation": spec.get("intro_animation"),
                "intro_animation_duration": spec.get("intro_animation_duration"),
                "outro_animation": spec.get("outro_animation"),
                "outro_animation_duration": spec.get("outro_animation_duration"),
            }
            for spec in IMAGE_SPECS
        ]

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

        final_draft_id = draft_id
        final_draft_url = str(draft_output.get("draft_url") or "").strip()

        audio_result = add_audio(token, final_draft_id, audio_url)
        audio_output = audio_result.get("output") or {}
        audio_draft_id = str(audio_output.get("draft_id") or final_draft_id).strip()
        audio_draft_url = str(audio_output.get("draft_url") or final_draft_url).strip()
        if not audio_draft_id:
            raise ApiError(
                json.dumps(
                    {
                        "phase": "add_audio",
                        "url": ADD_AUDIO_URL,
                        "response": audio_result,
                        "message": "返回里缺少 output.draft_id",
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )

        workflow_result = execute_workflow(token, audio_draft_id)
        workflow_output = workflow_result.get("output") or {}
        workflow_draft_id = str(workflow_output.get("draft_id") or audio_draft_id).strip()
        workflow_draft_url = str(workflow_output.get("draft_url") or audio_draft_url).strip()
        if not workflow_draft_id:
            raise ApiError(
                json.dumps(
                    {
                        "phase": "execute_workflow",
                        "url": EXECUTE_WORKFLOW_URL,
                        "response": workflow_result,
                        "message": "返回里缺少 output.draft_id",
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )

        image_results: list[dict[str, Any]] = []
        final_draft_id = workflow_draft_id
        final_draft_url = workflow_draft_url
        for image_spec in image_specs:
            image_result = add_image(
                token,
                final_draft_id,
                image_spec["image_url"],
                start=image_spec["start"],
                end=image_spec["end"],
                track_name=image_spec["track_name"],
                transition=image_spec["transition"],
                intro_animation=image_spec["intro_animation"],
                intro_animation_duration=image_spec["intro_animation_duration"],
                outro_animation=image_spec["outro_animation"],
                outro_animation_duration=image_spec["outro_animation_duration"],
            )
            image_results.append(image_result)
            image_output = image_result.get("output") or {}
            final_draft_id = str(image_output.get("draft_id") or final_draft_id).strip()
            final_draft_url = str(image_output.get("draft_url") or final_draft_url).strip()
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
        image_result = image_results[-1] if image_results else None

        emit_payload(
            ok=True,
            phase="completed",
            draft_ids=[final_draft_id],
            draft_id=final_draft_id,
            draft_url=final_draft_url,
            create_draft_result=draft_result,
            add_image_result=image_result,
            add_audio_result=audio_result,
            workflow_result=workflow_result,
        )
        return 0
    except Exception as error:
        emit_payload(
            ok=False,
            phase="error",
            create_draft_result=draft_result,
            add_image_result=image_result,
            add_audio_result=audio_result,
            workflow_result=workflow_result,
            error=parse_error_payload(error),
            stream=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
