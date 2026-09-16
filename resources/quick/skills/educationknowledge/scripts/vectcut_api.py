#!/usr/bin/env python3
"""Small, dependency-light VectCut API client used by the travel mixed-edit skill.

This module intentionally contains no imports from the repository. It can be
copied with the skill and used from another agent runtime.
"""

from __future__ import annotations

import json
import mimetypes
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import requests


BASE_URL = "https://open.vectcut.com"
DEFAULT_VOICE_ID = "gv_78ae9a269532441780ae4fdc8b41a678"


class VectCutError(RuntimeError):
    """Raised when a VectCut request or task result is invalid."""


def _first(data: Any, *paths: str) -> Any:
    """
    按优先级从字典中获取第一个非空值

    依次遍历paths中的每个路径，从data中提取对应的值，
    返回第一个非空（不为None且不为空字符串）的值。

    Args:
        data: 源字典数据
        *paths: 可变数量的路径字符串，用点号分隔嵌套键，如 "a.b.c"

    Returns:
        第一个找到的非空值，如果所有路径都无效则返回None
    """
    for path in paths:
        value = data
        for key in path.split("."):
            if not isinstance(value, dict) or key not in value:
                value = None
                break
            value = value[key]
        if value not in (None, ""):
            return value
    return None


def task_id(data: Any) -> Optional[str]:
    value = _first(data, "task_id", "id", "output.task_id", "output.id", "result.task_id")
    return str(value) if value not in (None, "") else None


def _status_text(data: Any) -> str:
    value = _first(data, "status", "output.status", "result.status", "message", "output.message")
    return str(value or "").strip().lower()


def _progress(data: Any) -> float:
    value = _first(data, "progress", "output.progress", "result.progress")
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def is_generic_task_complete(data: Any) -> bool:
    status = _status_text(data)
    return status in {"success", "completed", "complete", "done", "finish", "finished"} or _progress(data) >= 100


def _segments(data: Any) -> list:
    value = _first(data, "result.segments", "output.segments", "segments")
    return value if isinstance(value, list) else []


def is_asr_complete(data: Any) -> bool:
    return _status_text(data) == "success" and bool(_segments(data))


def is_smart_subtitle_complete(data: Any, draft_id: Optional[str] = None) -> bool:
    if not isinstance(data, dict) or data.get("success") is not True or _status_text(data) != "success":
        return False
    if str(data.get("error") or "").strip():
        return False
    output = data.get("output") if isinstance(data, dict) else None
    if not isinstance(output, dict):
        return False
    if str(output.get("draft_id") or "") != str(draft_id or ""):
        return False
    if not str(output.get("draft_url") or "").strip():
        return False
    return True


def is_capture_complete(data: Any) -> bool:
    if not is_generic_task_complete(data):
        return False
    value = _first(data, "result.timestamp", "result.time", "result.start", "result.start_time", "timestamp", "time")
    return value not in (None, "")


def response_duration(data: Any) -> Optional[float]:
    value = _first(
        data,
        "duration",
        "video_duration",
        "audio_duration",
        "duration_seconds",
        "duration_ms",
        "durationMilliseconds",
        "videoDuration",
        "audioDuration",
        "output.duration",
        "result.duration",
        "data.duration",
        "response.duration",
        "payload.duration",
    )
    if value in (None, ""):
        return None
    try:
        duration = float(value)
    except (TypeError, ValueError):
        return None
    if duration > 1000:
        duration /= 1000.0
    return duration if duration > 0 else None


def video_detail_text(data: Any) -> Optional[str]:
    value = _first(
        data,
        "result.response.choices[0].message.content",
        "choices[0].message.content",
        "output.video_detail",
        "output.detail",
        "output.content",
        "result.output.video_detail",
        "result.output.detail",
        "result.output.content",
        "result.video_detail",
        "result.detail",
        "result.content",
        "video_detail",
        "detail",
        "content",
    )
    return str(value).strip() if value not in (None, "") else None


def poll(
    fetch: Callable[[], Dict[str, Any]],
    complete: Callable[[Dict[str, Any]], bool],
    interval: float = 5.0,
    max_wait: float = 1800.0,
) -> Dict[str, Any]:
    started = time.monotonic()
    last: Optional[Dict[str, Any]] = None
    while True:
        last = fetch()
        if complete(last):
            return last
        if time.monotonic() - started >= max_wait:
            raise VectCutError("task polling timed out after %.1f seconds: %s" % (max_wait, json.dumps(last, ensure_ascii=False)))
        time.sleep(max(0.1, interval))


class VectCutClient:
    def __init__(
        self,
        token: Optional[str] = None,
        base_url: str = BASE_URL,
        timeout: float = 120.0,
    ) -> None:
        self.token = str(token or "").strip()
        if not self.token:
            raise VectCutError("missing API key: pass --api-key with the externally supplied value")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()

    @property
    def headers(self) -> Dict[str, str]:
        return {
            "Authorization": "Bearer " + self.token,
            "Content-Type": "application/json",
            "Accept": "*/*",
        }

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        payload: Any = None,
        allow_processing: bool = False,
    ) -> Dict[str, Any]:
        url = path if path.startswith("http") else self.base_url + "/" + path.lstrip("/")
        try:
            response = self.session.request(
                method=method,
                url=url,
                headers=self.headers,
                params=params,
                json=payload,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise VectCutError("request failed: %s" % exc) from exc
        try:
            data = response.json()
        except ValueError as exc:
            raise VectCutError("non-JSON response (%s): %s" % (response.status_code, response.text[:500])) from exc
        if response.status_code >= 400:
            raise VectCutError("HTTP %s: %s" % (response.status_code, json.dumps(data, ensure_ascii=False)))
        if isinstance(data, dict) and data.get("success") is False:
            processing = allow_processing and _status_text(data) == "processing"
            if not processing:
                raise VectCutError(str(data.get("error") or data.get("message") or "VectCut request failed"))
        return data

    def post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.request("POST", path, payload=payload)

    def get(self, path: str, params: Dict[str, Any], *, allow_processing: bool = False) -> Dict[str, Any]:
        return self.request("GET", path, params=params, allow_processing=allow_processing)

    def duration(self, url: str) -> Dict[str, Any]:
        return self.post("/cut_jianying/get_duration", {"url": url})

    def extract_audio(self, video_url: str) -> Dict[str, Any]:
        return self.post("/process/extract_audio", {"video_url": video_url})

    def init_temp_upload(self, file_name: str) -> Dict[str, Any]:
        return self.post("/sts/upload/agent_tmp/init", {"file_name": file_name})

    def upload_temp_file(self, file_path: str, init_response: Dict[str, Any]) -> Dict[str, Any]:
        upload = _first(init_response, "upload")
        if not isinstance(upload, dict):
            raise VectCutError("upload init response did not contain upload metadata: %s" % json.dumps(init_response, ensure_ascii=False))
        upload_url = str(upload.get("upload_url") or upload.get("host") or "").strip()
        form_data = upload.get("form_data")
        if not upload_url:
            raise VectCutError("upload init response did not contain upload.upload_url")
        if not isinstance(form_data, dict):
            raise VectCutError("upload init response did not contain upload.form_data")
        path = Path(file_path)
        if not path.is_file():
            raise VectCutError("local file does not exist: %s" % file_path)
        file_name = str(_first(init_response, "file_name") or path.name)
        mime_type, _ = mimetypes.guess_type(file_name)
        try:
            with path.open("rb") as handle:
                response = self.session.post(
                    upload_url,
                    data=form_data,
                    files={"file": (file_name, handle, mime_type or "application/octet-stream")},
                    timeout=self.timeout,
                )
        except requests.RequestException as exc:
            raise VectCutError("temporary upload failed: %s" % exc) from exc
        if response.status_code >= 400:
            raise VectCutError("temporary upload failed: HTTP %s: %s" % (response.status_code, response.text[:500]))
        body = response.text.strip()
        if body.startswith("<Error") or "<Error>" in body:
            raise VectCutError("temporary upload returned an error response: %s" % body[:500])
        signed_url = _first(init_response, "download.signed_url", "signed_url")
        if not signed_url:
            raise VectCutError("upload init response did not contain download.signed_url")
        return {
            "file_name": file_name,
            "object_key": _first(init_response, "object_key"),
            "upload_url": upload_url,
            "download_url": str(signed_url),
            "init_response": init_response,
            "upload_response": {
                "status_code": response.status_code,
                "text": body,
            },
        }

    def generate_speech(
        self,
        text: str,
        *,
        provider: str = "volc",
        voice_id: str = DEFAULT_VOICE_ID,
        only_tts: bool = True,
        speed: float = 1.0,
        track_name: str = "hunjian_text_audio_1",
        model: str = "",
    ) -> Dict[str, Any]:
        return self.post(
            "/cut_jianying/generate_speech",
            {
                "provider": provider,
                "voice_id": voice_id,
                "text": text,
                "only_tts": only_tts,
                "speed": speed,
                "track_name": track_name,
                "model": model,
            },
        )

    def submit_asr(self, url: str, *, effect_mode: str = "llm", content: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"url": url, "effect_mode": effect_mode}
        if content:
            payload["content"] = content
        return self.post("/llm/asr/asr_llm/submit_task/submit_asr_llm_task", payload)

    def asr_status(self, value: str) -> Dict[str, Any]:
        return self.get("/llm/asr/asr_llm/submit_task/task_status", {"task_id": value})

    def submit_llm(
        self,
        *,
        system_prompt: str,
        user_input: str,
        model: str = "qwen3.7-plus",
        response_format: str = "json",
        image_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": model,
            "system_prompt": system_prompt,
            "user_input": user_input,
            "response_format": response_format,
        }
        if image_url:
            payload["image_url"] = image_url
        return self.post("/llm/chat/submit_task/submit_chat_task", payload)

    def llm_status(self, value: str) -> Dict[str, Any]:
        return self.get("/llm/chat/submit_task/task_status", {"task_id": value})

    def submit_video_detail(self, video_url: str, *, prompt: Optional[str] = None, fps: Optional[float] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"video_url": video_url}
        if prompt:
            payload["prompt"] = prompt
        if fps is not None:
            payload["fps"] = fps
        return self.post("/llm/video_detail/submit/submit_video_detail_task", payload)

    def submit_video_detail_batch(
        self,
        video_urls: list,
        *,
        prompt: Optional[str] = None,
        fps_list: Optional[list] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"video_urls": video_urls}
        if prompt:
            payload["prompt"] = prompt
        if fps_list is not None:
            payload["fps_list"] = fps_list
        return self.post("/llm/video_detail/submit/submit_video_detail_task", payload)

    def video_detail_status(self, value: str) -> Dict[str, Any]:
        return self.get("/llm/video_detail/submit/task_status", {"task_id": value})

    def submit_video_capture(self, video_url: str, search_sentence: str) -> Dict[str, Any]:
        return self.post(
            "/llm/video_capture/submit_task/submit_video_capture_task",
            {"search_sentence": search_sentence, "video_url": video_url},
        )

    def video_capture_status(self, value: str) -> Dict[str, Any]:
        return self.get("/llm/video_capture/submit_task/task_status", {"task_id": value})

    def create_draft(self, *, name: str, cover: Optional[str] = None, width: int = 1080, height: int = 1920) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"width": width, "height": height, "cover": cover, "name": name}
        if cover is None:
            payload["cover"] = None
        return self.post(
            "/cut_jianying/create_draft",
            payload,
        )

    def generate_smart_subtitle(
        self,
        *,
        agent_id: str,
        draft_id: str,
        url: str,
        text_content: Optional[str] = None,
        add_media: bool = False,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "agent_id": agent_id,
            "draft_id": draft_id,
            "url": url,
            "add_media": add_media,
        }
        if text_content:
            payload["text_content"] = text_content
        return self.post("/cut_jianying/generate_smart_subtitle", payload)

    def smart_subtitle_status(self, value: str) -> Dict[str, Any]:
        return self.get(
            "/cut_jianying/smart_subtitle_task_status",
            {"task_id": value},
            allow_processing=True,
        )

    def add_video(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_video", payload)

    def add_image(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_image", payload)

    def add_video_keyframe(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_video_keyframe", payload)

    def add_audio(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_audio", payload)

    def add_text_template(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_text_template", payload)

    def add_text(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_text", payload)

    def search_sticker(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/search_sticker", payload)

    def add_sticker(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_sticker", payload)

    def add_preset(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_preset", payload)

    def get_video_scene_effect_types(self) -> Dict[str, Any]:
        return self.get("/cut_jianying/get_video_scene_effect_types", {})

    def get_video_character_effect_types(self) -> Dict[str, Any]:
        return self.get("/cut_jianying/get_video_character_effect_types", {})

    def add_effect(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_effect", payload)
