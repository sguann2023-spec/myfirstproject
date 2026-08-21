#!/usr/bin/env python3
"""Small VectCut API client for the koubo 1f9c skill.

The file is intentionally standalone so the skill can run outside the source
repository. It only depends on requests and the standard library.
"""

from __future__ import annotations

import json
import mimetypes
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import requests


BASE_URL = "https://open.vectcut.com"


class VectCutError(RuntimeError):
    pass


def _first(data: Any, *paths: str) -> Any:
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


def status_text(data: Any) -> str:
    value = _first(data, "status", "output.status", "result.status", "message")
    return str(value or "").strip().lower()


def progress_value(data: Any) -> float:
    try:
        return float(_first(data, "progress", "output.progress", "result.progress") or 0)
    except (TypeError, ValueError):
        return 0.0


def asr_segments(data: Any) -> list:
    value = _first(data, "result.segments", "output.segments", "segments")
    return value if isinstance(value, list) else []


def is_asr_complete(data: Dict[str, Any]) -> bool:
    return status_text(data) == "success" and bool(asr_segments(data))


def is_generic_task_complete(data: Dict[str, Any]) -> bool:
    return status_text(data) in {"success", "completed", "complete", "done", "finish", "finished"} or progress_value(data) >= 100


def poll(
    fetch: Callable[[], Dict[str, Any]],
    complete: Callable[[Dict[str, Any]], bool],
    interval: float = 5.0,
    max_wait: float = 1200.0,
) -> Dict[str, Any]:
    started = time.monotonic()
    while True:
        last = fetch()
        if complete(last):
            return last
        if status_text(last) in {"failed", "fail", "error", "cancelled", "canceled"}:
            raise VectCutError("task failed: %s" % json.dumps(last, ensure_ascii=False))
        if time.monotonic() - started >= max_wait:
            raise VectCutError("task polling timed out after %.1f seconds: %s" % (max_wait, json.dumps(last, ensure_ascii=False)))
        time.sleep(max(0.1, interval))


class VectCutClient:
    def __init__(self, token: str, base_url: str = BASE_URL, timeout: float = 120.0) -> None:
        self.token = str(token or "").strip()
        if not self.token:
            raise VectCutError("missing API key")
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
        payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        url = path if path.startswith("http") else self.base_url + "/" + path.lstrip("/")
        try:
            response = self.session.request(method, url, headers=self.headers, params=params, json=payload, timeout=self.timeout)
        except requests.RequestException as exc:
            raise VectCutError("request failed: %s" % exc) from exc
        try:
            data = response.json()
        except ValueError as exc:
            raise VectCutError("non-JSON response (%s): %s" % (response.status_code, response.text[:500])) from exc
        if response.status_code >= 400:
            raise VectCutError("HTTP %s: %s" % (response.status_code, json.dumps(data, ensure_ascii=False)))
        if isinstance(data, dict) and data.get("success") is False and status_text(data) not in {"processing", "pending"}:
            raise VectCutError(str(data.get("error") or data.get("message") or "VectCut request failed"))
        return data

    def post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.request("POST", path, payload=payload)

    def get(self, path: str, params: Dict[str, Any]) -> Dict[str, Any]:
        return self.request("GET", path, params=params)

    def create_draft(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/create_draft", payload)

    def execute_workflow(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/execute_workflow", payload)

    def submit_asr(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/llm/asr/asr_llm/submit_task/submit_asr_llm_task", payload)

    def asr_status(self, value: str) -> Dict[str, Any]:
        return self.get("/llm/asr/asr_llm/submit_task/task_status", {"task_id": value})

    def duration(self, url: str) -> Dict[str, Any]:
        return self.post("/cut_jianying/get_duration", {"url": url})

    def init_temp_upload(self, file_name: str) -> Dict[str, Any]:
        return self.post("/sts/upload/agent_tmp/init", {"file_name": file_name})

    def upload_temp_file(self, file_path: str, init_response: Dict[str, Any]) -> Dict[str, Any]:
        upload = init_response.get("upload") if isinstance(init_response.get("upload"), dict) else {}
        upload_url = str(upload.get("upload_url") or upload.get("host") or "").strip()
        form_data = upload.get("form_data")
        signed_url = _first(init_response, "download.signed_url", "signed_url")
        if not upload_url:
            raise VectCutError("upload init response did not contain upload.upload_url")
        if not isinstance(form_data, dict):
            raise VectCutError("upload init response did not contain upload.form_data")
        if not signed_url:
            raise VectCutError("upload init response did not contain download.signed_url")

        path = Path(file_path)
        if not path.is_file():
            raise VectCutError("local file does not exist: %s" % file_path)
        file_name = path.name
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

    def add_video(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_video", payload)

    def add_audio(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_audio", payload)

    def add_text(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_text", payload)

    def add_preset(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_preset", payload)

    def add_video_keyframe(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/add_video_keyframe", payload)

    def query_script(self, draft_id: str) -> Dict[str, Any]:
        return self.post("/cut_jianying/query_script", {"draft_id": draft_id})

    def generate_video(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.post("/cut_jianying/generate_video", payload)

    def render_status(self, value: str) -> Dict[str, Any]:
        return self.get("/cut_jianying/task_status", {"task_id": value})
