#!/usr/bin/env python3
"""One-command runner for the happy pink talking-head image-preset template.

The script intentionally does not store an API key. Pass it with --api-key,
set VECTCUT_API_KEY for this run, or type it when prompted.
"""

from __future__ import annotations

import argparse
import getpass
import io
import json
import mimetypes
import os
import random
import re
import shlex
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlencode, urlparse
from urllib.request import Request, urlopen


SKILL_DIR = Path(__file__).resolve().parents[1]
ROOT = Path.cwd()
HUNJIAN = SKILL_DIR / "scripts" / "hunjian_task.py"
TIMELINE = SKILL_DIR / "scripts" / "timeline.py"
QUERY = SKILL_DIR / "scripts" / "query_script.py"
VECTCUT_BASE_URL = os.environ.get("VECTCUT_BASE_URL", "https://open.vectcut.com").rstrip("/")

DEFAULT_MATERIAL_URLS: list[str] = []

BGM_URLS = [
    "https://player.install-ai-guider.top/example/bgm/void.MP3",
    "https://player.install-ai-guider.top/example/bgm/time_to_pretend.MP3",
    "https://player.install-ai-guider.top/example/bgm/the_right_path.MP3",
    "https://player.install-ai-guider.top/example/bgm/spoons_for_loons.MP3",
    "https://player.install-ai-guider.top/example/bgm/night_cruising.MP3",
    "https://player.install-ai-guider.top/example/bgm/Monsieur_melody.MP3",
    "https://player.install-ai-guider.top/example/bgm/melody_mix.MP3",
    "https://player.install-ai-guider.top/example/bgm/IV_feat.MP3",
    "https://player.install-ai-guider.top/example/bgm/Golden_hour.MP3",
    "https://player.install-ai-guider.top/example/bgm/Fight.MP3",
]

FLOWER_EFFECT_ID = "W0FmRVRXQV1EZ1JRS11BbEBWVQ=="
IMAGE_VIDEO_PRESET_ID = "12a0de93-6440-4b42-923e-54345def9193"
MATERIAL_VIDEO_PIP_MIN_DURATION = 2.0
MATERIAL_VIDEO_PIP_MAX_DURATION = 4.0
MATERIAL_VIDEO_BACKGROUND_TRACK = "happy_material_video_background"
MATERIAL_VIDEO_TALKING_PIP_TRACK = "happy_material_talking_head_pip"
TALKING_HEAD_PIP_X = 0.46
TALKING_HEAD_PIP_Y = 0
TALKING_HEAD_PIP_SCALE = 0.42
MIN_TALKING_HEAD_CHUNK_MS = 80
IMAGE_PIP_DURATION_MS = 2000
IMAGE_PIP_TRACK = "happy_image_pip"
CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920
IMAGE_PIP_MAX_WIDTH_RATIO = 0.46
IMAGE_PIP_MAX_HEIGHT_RATIO = 0.42
IMAGE_PIP_FALLBACK_SCALE = 0.42
DRAFT_TITLE_FALLBACK = "口播去气口视频"
DRAFT_TITLE_MAX_CHARS = 18
IMAGE_ANALYSIS_SYSTEM_PROMPT = """你是短视频素材理解助手。请直接观察用户提供的图片，输出严格 JSON，不要输出 Markdown 代码块。
JSON 必须包含 description、subject、scene、objects、text_in_image、keywords 六个字段；字段值使用简洁中文字符串或字符串数组。
description 要说明图片实际展示的主体、场景、动作、商品/人物和可用于口播剪辑的卖点。不要根据文件名猜测，不确定的内容不要编造。"""
IMAGE_DETAIL_CUE_TERMS = (
    "摸起来", "摸着", "手感", "看起来", "质感", "材质", "面料", "纹理", "细节", "微距", "特写", "局部",
    "柔软", "软糯", "糯糯", "亲肤", "厚实", "轻薄", "绒毛", "针织", "做工", "领口", "袖口", "下摆",
)
IMAGE_OVERALL_CUE_TERMS = (
    "整体", "上身", "穿搭", "外观", "款式", "版型", "颜色", "颜值", "好看", "大牌", "性价比", "价格",
    "便宜", "推荐", "分享", "种草", "入手", "挖到宝", "新品", "值得",
)
CAPTION_DETAIL_CUE_TERMS = IMAGE_DETAIL_CUE_TERMS + ("穿上", "穿着", "舒服", "保暖")
CAPTION_OVERALL_CUE_TERMS = IMAGE_OVERALL_CUE_TERMS + ("家人们", "宝藏", "这件", "这款", "这个")
CAPTION_INTRO_CUE_TERMS = ("家人们", "我又挖到宝了", "挖到宝", "推荐", "分享", "种草", "宝藏")
SUBTITLE_FONT = "快乐体"
SUBTITLE_FONT_COLORS = ["#ff96c2", "#FFFFFF"]
SUBTITLE_KEYWORD_COLOR = "#ffdd22"
SUBTITLE_BORDER_COLOR = "#000000"
SUBTITLE_BORDER_WIDTH = 30
SUBTITLE_Y_PX = -800
SUBTITLE_INTRO_CHOICES = [
    {"label": "none", "intro_animation": "", "intro_duration": 0.0},
    {"label": "fade", "intro_animation": "渐显", "intro_duration": 0.35},
    {"label": "typewriter_ii", "intro_animation": "打字机_II", "intro_duration": 0.45},
]
TEXT_TEMPLATE_ID = "7393022390638251303"
PRESET_IDS = [
    "5a0b0550-6cd9-4e1e-928c-c52ee7657904",
    "47bc790d-a58c-4eea-8d86-0852d8967664",
    "66f4d59a-a5a1-437a-9be3-ac70629de58e",
    "9353ff22-af9b-418f-b672-fc41fdf4918d",
]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif", ".heic", ".heif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".flv", ".wmv", ".mpeg", ".mpg"}

def log(message: str) -> None:
    print(f"[koubo-happy-pink-image-preset] {message}", flush=True)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def recursive_find(value: Any, keys: tuple[str, ...]) -> Any:
    if isinstance(value, dict):
        for key in keys:
            if key in value and value[key] not in (None, ""):
                return value[key]
        for child in value.values():
            found = recursive_find(child, keys)
            if found not in (None, ""):
                return found
    elif isinstance(value, list):
        for child in value:
            found = recursive_find(child, keys)
            if found not in (None, ""):
                return found
    return None


def first_json_string(value: Any) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        if text.startswith("{") and text.endswith("}"):
            return text
    if isinstance(value, dict):
        for key in ("assistant", "content", "response", "output", "data", "result"):
            if key in value:
                found = first_json_string(value[key])
                if found:
                    return found
        for child in value.values():
            found = first_json_string(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = first_json_string(child)
            if found:
                return found
    return None


def run_command(cmd: list[str], output_path: Path | None = None, check: bool = True) -> tuple[int, str, str, Any]:
    proc = subprocess.run(cmd, text=True, capture_output=True)
    parsed = None
    if output_path and output_path.exists():
        try:
            parsed = read_json(output_path)
        except json.JSONDecodeError:
            parsed = None
    if parsed is None and proc.stdout.strip():
        try:
            parsed = json.loads(proc.stdout)
        except json.JSONDecodeError:
            parsed = None
    if check and proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "command failed").strip())
    if check and isinstance(parsed, dict) and parsed.get("success") is False:
        raise RuntimeError(json.dumps(parsed, ensure_ascii=False)[:1500])
    return proc.returncode, proc.stdout, proc.stderr, parsed


def skill(api_key: str, run_dir: Path, label: str, args: list[str], check: bool = True) -> Any:
    output_path = run_dir / f"{label}.json"
    cmd = [sys.executable, str(HUNJIAN), "--api-key", api_key, "--output", str(output_path)] + args
    _, _, _, parsed = run_command(cmd, output_path=output_path, check=check)
    return parsed


def skill_wait(api_key: str, run_dir: Path, label: str, args: list[str], max_wait: int, check: bool = True) -> Any:
    output_path = run_dir / f"{label}.json"
    cmd = [
        sys.executable,
        str(HUNJIAN),
        "--api-key",
        api_key,
        "--poll-interval",
        "2",
        "--max-wait",
        str(max_wait),
        "--output",
        str(output_path),
    ] + args
    _, _, _, parsed = run_command(cmd, output_path=output_path, check=check)
    return parsed


def api_request(
    api_key: str,
    path: str,
    *,
    method: str = "POST",
    payload: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    allow_processing: bool = False,
    timeout: float = 120.0,
) -> dict[str, Any]:
    url = path if path.startswith("http") else f"{VECTCUT_BASE_URL}/{path.lstrip('/')}"
    if params:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{urlencode(params)}"
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "*/*",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except Exception as exc:
        raise RuntimeError(f"VectCut API request failed: {exc}") from exc
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"VectCut API returned non-JSON response: {raw[:500]}") from exc
    if isinstance(parsed, dict) and parsed.get("success") is False:
        status = str(recursive_find(parsed, ("status", "message", "error")) or "").lower()
        if not (allow_processing and ("processing" in status or "处理中" in status or "running" in status)):
            raise RuntimeError(str(parsed.get("error") or parsed.get("message") or parsed)[:1000])
    return parsed if isinstance(parsed, dict) else {"data": parsed}


def task_complete(data: dict[str, Any]) -> bool:
    status = str(recursive_find(data, ("status", "state", "message")) or "").strip().lower()
    if status in {"success", "completed", "complete", "done", "finish", "finished"}:
        return True
    progress = recursive_find(data, ("progress",))
    try:
        return float(progress) >= 100
    except Exception:
        return False


def collect_url_candidates(value: Any) -> list[str]:
    candidates: list[str] = []
    preferred_keys = {
        "video_url",
        "public_url",
        "download_url",
        "signed_url",
        "file_url",
        "output_url",
        "url",
    }
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).lower() in preferred_keys and isinstance(child, str) and child.startswith(("http://", "https://")):
                candidates.append(child)
            candidates.extend(collect_url_candidates(child))
    elif isinstance(value, list):
        for child in value:
            candidates.extend(collect_url_candidates(child))
    return candidates


def split_video_clip(
    api_key: str,
    run_dir: Path,
    label: str,
    video_url: str,
    start: float,
    end: float,
    max_wait: int,
) -> dict[str, Any]:
    payload = {
        "video_url": video_url,
        "start": round(float(start), 6),
        "end": round(float(end), 6),
    }
    if payload["end"] <= payload["start"]:
        raise RuntimeError(f"invalid split window: {payload}")
    submit = api_request(
        api_key,
        "/process/split_video/submit_task/submit_split_video_task",
        method="POST",
        payload=payload,
    )
    task = recursive_find(submit, ("task_id", "taskId", "id"))
    if not task:
        raise RuntimeError(f"split_video submit response did not include task_id: {json.dumps(submit, ensure_ascii=False)[:1000]}")
    started = time.monotonic()
    status: dict[str, Any] = {}
    while True:
        status = api_request(
            api_key,
            "/process/split_video/submit_task/task_status",
            method="GET",
            params={"task_id": str(task)},
            allow_processing=True,
        )
        urls = [url for url in collect_url_candidates(status) if url != video_url]
        if task_complete(status) and urls:
            result = {
                "request": payload,
                "submit": submit,
                "task_id": str(task),
                "status": status,
                "video_url": urls[0],
            }
            write_json(run_dir / f"{label}.json", result)
            return result
        if time.monotonic() - started >= max_wait:
            raise RuntimeError(f"split_video task timed out: {json.dumps(status, ensure_ascii=False)[:1000]}")
        time.sleep(2)


def media_duration(api_key: str, run_dir: Path, label: str, url: str) -> float:
    data = skill(api_key, run_dir, label, ["duration", "--url", url])
    duration = recursive_find(
        data,
        (
            "duration",
            "video_duration",
            "audio_duration",
            "duration_seconds",
            "duration_ms",
            "durationMilliseconds",
            "videoDuration",
            "audioDuration",
        ),
    )
    if duration is None:
        raise RuntimeError(f"Cannot read duration for {label}")
    duration = float(duration)
    if duration > 1000:
        duration = duration / 1000.0
    return duration


def extract_public_url(data: Any) -> str:
    url = recursive_find(data, ("public_url", "audio_url", "download_url", "url"))
    if not url:
        raise RuntimeError("Cannot find public URL in API response")
    return str(url)


def extract_segments(asr_data: Any) -> list[dict[str, Any]]:
    segments = recursive_find(asr_data, ("segments",))
    if not isinstance(segments, list) or not segments:
        raise RuntimeError("ASR response did not include non-empty segments")
    return segments


def run_timeline(asr_path: Path, source_duration: float, output_path: Path, keep_original_duration: bool = False) -> dict[str, Any]:
    cmd = [
        sys.executable,
        str(TIMELINE),
        "--asr-json",
        str(asr_path),
        "--source-duration",
        str(source_duration),
        "--output",
        str(output_path),
    ]
    if keep_original_duration:
        cmd.append("--keep-original-duration")
    _, _, _, parsed = run_command(cmd, output_path=output_path, check=True)
    return parsed or read_json(output_path)


def build_material_analysis(video_detail: Any) -> str:
    detail = recursive_find(video_detail, ("video_detail", "analysis", "content", "text"))
    if isinstance(detail, str) and detail.strip():
        return detail.strip()
    return json.dumps(video_detail, ensure_ascii=False)[:4000]


def analyze_video_material(
    api_key: str,
    run_dir: Path,
    index: int,
    url: str,
    duration: float,
    max_wait: int,
) -> dict[str, Any]:
    detail = skill_wait(
        api_key,
        run_dir,
        f"video_detail_material_video_{index:02d}",
        ["video-detail", "submit-and-wait", "--video-url", url],
        max_wait=max_wait,
    )
    analysis = build_material_analysis(detail)
    result = {
        "video_index": index,
        "url": url,
        "duration": duration,
        "task_id": str(recursive_find(detail, ("task_id", "taskId", "id")) or ""),
        "analysis": analysis,
    }
    write_json(run_dir / f"video_analysis_material_video_{index:02d}.json", result)
    return result


def material_kind(url: str) -> str:
    parsed = urlparse(url)
    path = unquote(parsed.path or url).lower()
    suffix = Path(path).suffix
    mime = mimetypes.guess_type(path)[0] or ""
    if suffix in IMAGE_EXTENSIONS or mime.startswith("image/"):
        return "image"
    if suffix in VIDEO_EXTENSIONS or mime.startswith("video/"):
        return "video"
    return "video"


def normalize_image_analysis(raw: Any, index: int, url: str, source: str) -> dict[str, Any]:
    parsed: dict[str, Any] = {
        "index": index,
        "url": url,
        "material_type": "image",
        "analysis_source": source,
    }
    try:
        if isinstance(raw, str):
            text = first_json_string(raw)
            data = json.loads(text) if text else {"description": raw.strip()[:4000]}
        else:
            data = raw if isinstance(raw, dict) else {"raw": raw}
        if isinstance(data, dict):
            parsed.update(data)
    except Exception as exc:
        parsed["analysis_error"] = str(exc)
        parsed["raw"] = raw
    parsed["index"] = index
    parsed["url"] = url
    parsed["material_type"] = "image"
    parsed["analysis_source"] = parsed.get("analysis_source") or source
    return parsed


def select_precomputed_image_analysis(data: Any, index: int, url: str) -> Any:
    items: list[Any] = []
    if isinstance(data, dict):
        if isinstance(data.get("images"), list):
            items = data["images"]
        elif str(index) in data:
            return data[str(index)]
        elif url in data:
            return data[url]
        else:
            items = [data]
    elif isinstance(data, list):
        items = data
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("index") == index or item.get("url") == url:
            return item
    if 0 <= index - 1 < len(items):
        return items[index - 1]
    return None


def positive_int(value: Any) -> int | None:
    try:
        number = int(round(float(value)))
    except Exception:
        return None
    return number if number > 0 else None


def dimensions_from_value(value: Any) -> tuple[int, int] | None:
    if isinstance(value, dict):
        width = positive_int(
            value.get("width")
            or value.get("image_width")
            or value.get("w")
            or value.get("natural_width")
        )
        height = positive_int(
            value.get("height")
            or value.get("image_height")
            or value.get("h")
            or value.get("natural_height")
        )
        if width and height:
            return width, height
        for key in ("size", "dimensions", "resolution", "image_size"):
            found = dimensions_from_value(value.get(key))
            if found:
                return found
        for child in value.values():
            found = dimensions_from_value(child)
            if found:
                return found
    elif isinstance(value, (list, tuple)) and len(value) >= 2:
        width = positive_int(value[0])
        height = positive_int(value[1])
        if width and height:
            return width, height
    elif isinstance(value, str):
        match = re.search(r"(\d{2,5})\s*[xX×*]\s*(\d{2,5})", value)
        if match:
            width = positive_int(match.group(1))
            height = positive_int(match.group(2))
            if width and height:
                return width, height
    return None


def probe_image_dimensions(run_dir: Path, index: int, url: str, analysis: dict[str, Any] | None = None) -> tuple[int, int] | None:
    from_analysis = dimensions_from_value(analysis or {})
    if from_analysis:
        write_json(
            run_dir / f"image_dimensions_material_{index}.json",
            {"index": index, "url": url, "width": from_analysis[0], "height": from_analysis[1], "source": "analysis"},
        )
        return from_analysis
    try:
        from PIL import Image
    except Exception as exc:
        write_json(run_dir / f"image_dimensions_material_{index}.json", {"index": index, "url": url, "error": f"PIL unavailable: {exc}"})
        return None

    parsed = urlparse(url)
    try:
        if parsed.scheme in ("http", "https"):
            request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(request, timeout=20) as response:
                data = response.read(20 * 1024 * 1024 + 1)
            if len(data) > 20 * 1024 * 1024:
                raise RuntimeError("image exceeds 20MB probe limit")
            image_file: Any = io.BytesIO(data)
        elif parsed.scheme == "file":
            image_file = Path(unquote(parsed.path)).expanduser()
        else:
            image_file = Path(url).expanduser()
        with Image.open(image_file) as image:
            width, height = image.size
        write_json(
            run_dir / f"image_dimensions_material_{index}.json",
            {"index": index, "url": url, "width": width, "height": height, "source": "probe"},
        )
        return int(width), int(height)
    except Exception as exc:
        write_json(run_dir / f"image_dimensions_material_{index}.json", {"index": index, "url": url, "error": str(exc)})
        return None


def calculate_pip_scale(image_width: int | None, image_height: int | None) -> float:
    width = positive_int(image_width)
    height = positive_int(image_height)
    if not width or not height:
        return IMAGE_PIP_FALLBACK_SCALE
    max_width = CANVAS_WIDTH * IMAGE_PIP_MAX_WIDTH_RATIO
    max_height = CANVAS_HEIGHT * IMAGE_PIP_MAX_HEIGHT_RATIO
    scale = min(max_width / width, max_height / height, 1.0)
    return round(max(0.02, scale), 4)


def has_meaningful_image_analysis(analysis: dict[str, Any]) -> bool:
    for key in ("description", "summary", "scene", "subject", "objects", "text_in_image", "keywords"):
        value = analysis.get(key)
        if isinstance(value, (list, tuple)) and value:
            return True
        if isinstance(value, str) and value.strip():
            return True
    return False


def analyze_image_with_vectcut_llm(
    api_key: str,
    run_dir: Path,
    index: int,
    url: str,
    max_wait: int,
) -> dict[str, Any] | None:
    label = f"image_llm_material_{index:02d}"
    user_input = json.dumps(
        {
            "task": "理解这张图片素材，供口播视频按语义匹配使用",
            "material_index": index,
            "image_url": url,
            "output_requirements": [
                "识别图片中的主体、商品、人物、动作、场景和可见文字",
                "给出适合和口播文案匹配的关键词",
                "只描述实际看见的内容，不根据随机文件名推断",
            ],
        },
        ensure_ascii=False,
    )
    try:
        raw = skill_wait(
            api_key,
            run_dir,
            label,
            [
                "llm",
                "submit-and-wait",
                "--system-prompt",
                IMAGE_ANALYSIS_SYSTEM_PROMPT,
                "--user-input",
                user_input,
                "--model",
                "qwen3.7-plus",
                "--response-format",
                "json",
                "--image-url",
                url,
            ],
            max_wait=max_wait,
        )
        response_text = first_json_string(raw)
        parsed = normalize_image_analysis(response_text or raw, index, url, "vectcut_llm")
        parsed["vectcut_llm_task_id"] = str(recursive_find(raw, ("task_id", "taskId", "id")) or "")
        if not has_meaningful_image_analysis(parsed):
            raise RuntimeError("VectCut LLM response did not contain meaningful image analysis")
        write_json(run_dir / f"image_analysis_material_{index}.json", parsed)
        return parsed
    except Exception as exc:
        write_json(
            run_dir / f"image_llm_material_{index:02d}_error.json",
            {"index": index, "url": url, "error": str(exc)},
        )
        log(f"图片素材 {index} VectCut LLM 理解失败：{exc}")
        return None


def analyze_image_locally(
    api_key: str,
    run_dir: Path,
    index: int,
    url: str,
    max_wait: int,
    precomputed: Any = None,
) -> dict[str, Any]:
    raw_precomputed = select_precomputed_image_analysis(precomputed, index, url) if precomputed is not None else None
    if raw_precomputed is not None:
        parsed = normalize_image_analysis(raw_precomputed, index, url, "codex_precomputed")
        if has_meaningful_image_analysis(parsed):
            parsed["analysis_source"] = "codex_precomputed"
            write_json(run_dir / f"image_detail_material_{index}.json", parsed)
            write_json(run_dir / f"image_analysis_material_{index}.json", parsed)
            return parsed
        log(f"图片素材 {index} 预先提供的本地分析无有效语义，继续尝试本地命令和 VectCut LLM")

    cmd_template = os.environ.get("LOCAL_IMAGE_ANALYZER_CMD", "").strip()
    if cmd_template:
        try:
            cmd = shlex.split(cmd_template) + [url]
            proc = subprocess.run(cmd, text=True, capture_output=True, timeout=180)
            detail = {
                "cmd": cmd_template,
                "returncode": proc.returncode,
                "stdout": proc.stdout.strip(),
                "stderr": proc.stderr.strip(),
                "url": url,
            }
            write_json(run_dir / f"image_detail_material_{index}.json", detail)
            if proc.returncode == 0 and proc.stdout.strip():
                parsed = normalize_image_analysis(proc.stdout.strip(), index, url, "local_command")
                if has_meaningful_image_analysis(parsed):
                    parsed["analysis_source"] = "local_command"
                    parsed["local_command"] = cmd_template
                    write_json(run_dir / f"image_analysis_material_{index}.json", parsed)
                    return parsed
                log(f"图片素材 {index} 本地模型返回内容没有有效语义，继续调用 VectCut LLM")
            log(f"图片素材 {index} 本地模型理解失败，继续调用 VectCut LLM：{proc.stderr.strip() or proc.stdout.strip()}")
        except Exception as exc:
            write_json(run_dir / f"image_detail_material_{index}.json", {"error": str(exc), "url": url})
            log(f"图片素材 {index} 本地模型理解异常，继续调用 VectCut LLM：{exc}")

    vectcut_analysis = analyze_image_with_vectcut_llm(api_key, run_dir, index, url, max_wait)
    if vectcut_analysis is not None:
        return vectcut_analysis

    parsed_url = urlparse(url)
    filename = unquote(Path(parsed_url.path or url).name) or f"image_{index}"
    local_path = Path(url).expanduser() if parsed_url.scheme in ("", "file") else None
    metadata: dict[str, Any] = {
        "index": index,
        "url": url,
        "filename": filename,
        "material_type": "image",
        "analysis_source": "metadata_fallback",
        "analysis_warning": "本地视觉分析和 VectCut LLM 图片理解均失败，仅保留文件元信息；不得据此编造图片语义。",
    }
    if local_path and parsed_url.scheme == "file":
        local_path = Path(unquote(parsed_url.path)).expanduser()
    if local_path and local_path.exists():
        metadata["local_path"] = str(local_path)
        try:
            from PIL import Image

            with Image.open(local_path) as image:
                metadata["width"], metadata["height"] = image.size
                metadata["mode"] = image.mode
        except Exception as exc:
            metadata["image_probe_error"] = str(exc)
    size_text = ""
    if metadata.get("width") and metadata.get("height"):
        size_text = f"，尺寸 {metadata['width']}x{metadata['height']}"
    metadata["description"] = f"图片素材：{filename}{size_text}。这是静态图片素材，适合在文案强相关的位置短暂展示；按文件名、主题和用户文案进行匹配。"
    write_json(run_dir / f"image_detail_material_{index}.json", metadata)
    write_json(run_dir / f"image_analysis_material_{index}.json", metadata)
    return metadata


def default_material_role(index: int, total: int) -> str:
    if total == 3:
        return ["environment", "usage_scene", "usage_scene"][index]
    return "usage_scene"


def build_plan_input(
    timeline: dict[str, Any],
    host_url: str,
    host_duration: float,
    material_urls: list[str],
    material_types: list[str],
    material_durations: list[float],
    material_analyses: list[str],
    topic: str,
) -> dict[str, Any]:
    materials = [
        {
            "index": 0,
            "url": host_url,
            "material_type": "video",
            "material_role": "talking_head",
            "duration": host_duration,
            "analysis": f"主播口播主线，主题：{topic}。默认去气口后全程可使用主播画面；只有补充素材和当前文案强相关时才短暂穿插。",
        }
    ]
    for i, url in enumerate(material_urls):
        role = default_material_role(i, len(material_urls))
        materials.append(
            {
                "index": i + 1,
                "url": url,
                "material_type": material_types[i],
                "material_role": role,
                "duration": material_durations[i],
                "analysis": material_analyses[i],
            }
        )
    return {
        "mode": "koubo_keyword_caption_mix",
        "total_duration_ms": timeline["target_duration_ms"],
        "source_duration_ms": timeline["source_duration_ms"],
        "removed_duration_ms": timeline["removed_duration_ms"],
        "captions": [
            {
                "source_index": s["source_index"],
                "text": s["text"],
                "start_ms": s["target_start_ms"],
                "end_ms": s["target_end_ms"],
                "source_start_ms": s["source_start_ms"],
                "source_end_ms": s["source_end_ms"],
            }
            for s in timeline["segments"]
        ],
        "materials": materials,
        "has_broll_materials": bool(material_urls),
        "topic": topic,
        "use_smart_subtitle": False,
        "subtitle_mode": "manual_subtitle",
        "caption_style": {
            "font": SUBTITLE_FONT,
            "y_px": SUBTITLE_Y_PX,
            "base_colors": SUBTITLE_FONT_COLORS,
            "keyword_color": SUBTITLE_KEYWORD_COLOR,
            "border_color": SUBTITLE_BORDER_COLOR,
            "border_width": SUBTITLE_BORDER_WIDTH,
            "keyword_style_method": "add_text.text_styles",
        },
    }


def validate_plan(plan: dict[str, Any], timeline: dict[str, Any], material_types: list[str]) -> dict[str, Any]:
    total = int(timeline["target_duration_ms"])
    material_count = len(material_types)
    segments = plan.get("append_materials") or []
    if not segments:
        raise RuntimeError("Plan has no append_materials")
    if segments[0]["start"] != 0 or segments[-1]["end"] != total:
        raise RuntimeError("Plan does not cover the full timeline")
    if segments[0]["material_role"] != "talking_head" or segments[-1]["material_role"] != "talking_head":
        raise RuntimeError("Plan first/last segments must be talking_head")
    for i, seg in enumerate(segments):
        if seg["end"] <= seg["start"]:
            raise RuntimeError(f"Bad segment duration at append_materials[{i}]")
        if i and seg["start"] != segments[i - 1]["end"]:
            raise RuntimeError(f"Timeline gap/overlap before append_materials[{i}]")
        idx = seg["search_materials"][0]["index"]
        if not isinstance(idx, int) or idx < 0 or idx > material_count:
            raise RuntimeError(f"Invalid material index: {idx}")
    talking_ms = sum(s["end"] - s["start"] for s in segments if s["material_role"] == "talking_head")
    broll_segments = [s for s in segments if s["material_role"] != "talking_head"]
    used = set()
    for seg in broll_segments:
        duration = seg["end"] - seg["start"]
        idx = seg["search_materials"][0]["index"]
        kind = material_types[idx - 1] if idx > 0 else "video"
        max_duration = 2000 if kind == "image" else 3000
        if duration < 1000 or duration > max_duration:
            raise RuntimeError(f"A {kind} B-roll segment is outside 1000-{max_duration}ms")
        if idx in used:
            raise RuntimeError(f"B-roll material index {idx} was reused")
        used.add(idx)
    return {
        "talking_head_duration_ms": talking_ms,
        "broll_count": len(broll_segments),
        "talking_head_ratio": talking_ms / total,
    }


def normalize_plan(plan: dict[str, Any]) -> dict[str, Any]:
    if "append_materials" not in plan and isinstance(plan.get("segments"), list):
        plan["append_materials"] = plan["segments"]
    if "name" not in plan:
        plan["name"] = "koubo_keyword_caption_mix_1"
    if "effects_plan" not in plan:
        plan["effects_plan"] = []
    return plan


def repair_plan(plan: dict[str, Any], timeline: dict[str, Any], material_types: list[str] | None = None) -> dict[str, Any]:
    """Clamp B-roll durations while preserving a continuous timeline.

    LLM plans occasionally drift past the 3s B-roll cap. When that happens,
    give the extra time back to the immediately following talking-head segment.
    This keeps semantic ordering intact and avoids repeating B-roll materials.
    """
    plan = normalize_plan(plan)
    segments = plan.get("append_materials") or []
    if not segments:
        return plan
    total = int(timeline["target_duration_ms"])
    for i, seg in enumerate(segments):
        if seg.get("material_role") == "talking_head":
            continue
        duration = int(seg["end"] - seg["start"])
        idx = int((seg.get("search_materials") or [{"index": 1}])[0].get("index", 1))
        kind = (material_types[idx - 1] if material_types and idx > 0 and idx <= len(material_types) else "video")
        max_duration = 2000 if kind == "image" else 3000
        if 1000 <= duration <= max_duration:
            continue
        fixed_duration = max(1000, min(max_duration, duration))
        new_end = int(seg["start"] + fixed_duration)
        delta = int(seg["end"] - new_end)
        seg["end"] = new_end
        if i + 1 < len(segments) and segments[i + 1].get("material_role") == "talking_head":
            segments[i + 1]["start"] = new_end
        elif i > 0 and segments[i - 1].get("material_role") == "talking_head":
            segments[i - 1]["end"] += delta
            seg["start"] += delta
            seg["end"] += delta
        else:
            raise RuntimeError("Cannot repair B-roll duration without adjacent talking-head segment")
    for i in range(1, len(segments)):
        if segments[i]["start"] != segments[i - 1]["end"]:
            if segments[i].get("material_role") == "talking_head":
                segments[i]["start"] = segments[i - 1]["end"]
            elif segments[i - 1].get("material_role") == "talking_head":
                segments[i - 1]["end"] = segments[i]["start"]
    segments[0]["start"] = 0
    segments[-1]["end"] = total
    talking_ms = sum(s["end"] - s["start"] for s in segments if s.get("material_role") == "talking_head")
    broll_ms = sum(s["end"] - s["start"] for s in segments if s.get("material_role") != "talking_head")
    plan["stats"] = {
        "talking_head_duration_ms": talking_ms,
        "broll_duration_ms": broll_ms,
        "talking_head_ratio": round(talking_ms / total, 4) if total else 0,
    }
    return plan


def fallback_plan(timeline: dict[str, Any], material_types: list[str]) -> dict[str, Any]:
    total = int(timeline["target_duration_ms"])
    captions = timeline.get("segments") or []
    text_all = " ".join(s.get("text", "") for s in captions)
    material_count = len(material_types)
    if material_count <= 0:
        return {
            "name": "koubo_keyword_caption_mix_1",
            "draft_title_base": "口播去气口视频",
            "stats": {
                "talking_head_duration_ms": total,
                "broll_duration_ms": 0,
                "talking_head_ratio": 1.0,
            },
            "append_materials": [
                {
                    "start": 0,
                    "end": total,
                    "material_role": "talking_head",
                    "covered_caption_text": text_all,
                    "narrative_stage": "hook",
                    "search_materials": [
                        {
                            "index": 0,
                            "search": "主播口播",
                            "role": "talking_head",
                            "match_reason": "用户未提供补充素材，全程展示去气口后的口播视频",
                        }
                    ],
                }
            ],
            "effects_plan": [],
        }
    if total < 7000:
        return {
            "name": "koubo_keyword_caption_mix_1",
            "draft_title_base": "口播去气口视频",
            "stats": {
                "talking_head_duration_ms": total,
                "broll_duration_ms": 0,
                "talking_head_ratio": 1.0,
            },
            "append_materials": [
                {
                    "start": 0,
                    "end": total,
                    "material_role": "talking_head",
                    "covered_caption_text": text_all,
                    "narrative_stage": "hook",
                    "search_materials": [
                        {
                            "index": 0,
                            "search": "主播口播",
                            "role": "talking_head",
                            "match_reason": "口播时长较短，不强行穿插补充素材",
                        }
                    ],
                }
            ],
            "effects_plan": [],
        }
    count = min(3, material_count, max(1, total // 6000))
    centers = [0.35, 0.55, 0.72][:count]
    brolls = []
    for i, ratio in enumerate(centers):
        idx = i + 1
        max_duration = 2000 if material_types[i] == "image" else 3000
        broll_duration = min(max_duration, max(1000, total // 8))
        start = int(round(total * ratio / 100.0) * 100)
        start = max(1000, min(start, total - broll_duration - 1000))
        if brolls and start < brolls[-1]["end"] + 1000:
            start = brolls[-1]["end"] + 1000
        end = min(start + broll_duration, total - 1000)
        if end - start >= 1000:
            brolls.append({"start": start, "end": end, "index": idx})
    role_by_index = {1: "environment", 2: "usage_scene", 3: "usage_scene"}
    search_by_index = {
        1: "团队外景和服务现场",
        2: "室内卷材搬运施工准备",
        3: "玻璃贴膜施工喷水细节",
    }
    stage_by_index = {1: "trust", 2: "proof", 3: "demo"}
    segments = []
    cursor = 0
    for broll in brolls:
        if broll["start"] > cursor:
            segments.append(
                {
                    "start": cursor,
                    "end": broll["start"],
                    "material_role": "talking_head",
                    "covered_caption_text": text_all,
                    "narrative_stage": "pain" if cursor else "hook",
                    "search_materials": [
                        {
                            "index": 0,
                            "search": "主播口播",
                            "role": "talking_head",
                            "match_reason": "保留主播口播主线，承接信任和转化话术",
                        }
                    ],
                    "transition": {"name": "左移", "duration": 0.2},
                }
            )
        idx = broll["index"]
        material_kind_name = material_types[idx - 1] if idx - 1 < len(material_types) else "video"
        segments.append(
            {
                "start": broll["start"],
                "end": broll["end"],
                "material_role": "image_reference" if material_kind_name == "image" else role_by_index.get(idx, "usage_scene"),
                "covered_caption_text": text_all,
                "narrative_stage": stage_by_index.get(idx, "proof"),
                "search_materials": [
                    {
                        "index": idx,
                        "search": "图片素材中的产品或场景主体" if material_kind_name == "image" else search_by_index.get(idx, "贴膜施工服务现场"),
                        "role": "image_reference" if material_kind_name == "image" else role_by_index.get(idx, "usage_scene"),
                        "match_reason": "兜底分镜使用真实素材短切展示服务现场，素材只使用一次",
                    }
                ],
                "transition": {"name": "左移", "duration": 0.2},
            }
        )
        cursor = broll["end"]
    if cursor < total:
        segments.append(
            {
                "start": cursor,
                "end": total,
                "material_role": "talking_head",
                "covered_caption_text": text_all,
                "narrative_stage": "cta",
                "search_materials": [
                    {
                        "index": 0,
                        "search": "主播口播收口",
                        "role": "talking_head",
                        "match_reason": "结尾必须回到主播口播完成行动引导",
                    }
                ],
            }
        )
    talking_ms = sum(s["end"] - s["start"] for s in segments if s["material_role"] == "talking_head")
    return {
        "name": "koubo_keyword_caption_mix_1",
        "draft_title_base": "口播去气口视频",
        "stats": {
            "talking_head_duration_ms": talking_ms,
            "broll_duration_ms": total - talking_ms,
            "talking_head_ratio": round(talking_ms / total, 4),
        },
        "append_materials": segments,
        "effects_plan": [],
    }


def seconds(ms: int | float) -> float:
    return round(float(ms) / 1000.0, 6)


def safe_title(title: str) -> str:
    clean = re.sub(r'[\\/:*?"<>|\r\n]+', "", title or "").strip()
    return clean or DRAFT_TITLE_FALLBACK


def compact_copy_text(text: str) -> str:
    text = re.sub(r"[\s，。！？；、,.!?;:：；“”\"'（）()【】\[\]《》<>]+", "", text or "")
    text = re.sub(r"(嗯|呃|啊|这个|那个){1,}", "", text)
    return text


def timeline_copy_text(timeline: dict[str, Any]) -> str:
    return " ".join(str(seg.get("text") or "") for seg in timeline.get("segments") or [])


def sanitize_draft_title_base(title: str) -> str:
    clean = safe_title(title)
    clean = re.sub(r"[_\s]+", "", clean)
    clean = re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9-]+", "", clean)
    if len(clean) > DRAFT_TITLE_MAX_CHARS:
        clean = clean[:DRAFT_TITLE_MAX_CHARS]
    return clean or DRAFT_TITLE_FALLBACK


def select_precomputed_title(data: Any) -> str | None:
    if data is None:
        return None
    if isinstance(data, str):
        return data.strip()
    if isinstance(data, dict):
        title = recursive_find(data, ("draft_title_base", "draft_title", "title", "name"))
        return str(title).strip() if title else None
    return None


def heuristic_draft_title_from_copy(timeline: dict[str, Any], topic: str) -> str:
    compact = compact_copy_text(timeline_copy_text(timeline))
    keyword_titles = [
        (("面包店", "面包", "烘焙", "吐司", "甜品"), "现烤面包分享"),
        (("蛋糕", "甜点", "甜品"), "甜品蛋糕分享"),
        (("升学", "志愿", "高考", "择校", "报考"), "升学规划口播"),
        (("课程", "学习", "老师", "课堂", "教育"), "教育课程口播"),
        (("装修", "家装", "设计", "施工"), "家装经验口播"),
        (("贴膜", "玻璃膜", "窗膜"), "玻璃贴膜口播"),
        (("优惠", "活动", "团购", "福利"), "福利活动口播"),
    ]
    for keywords, title in keyword_titles:
        if any(keyword in compact for keyword in keywords):
            return title
    topic_clean = compact_copy_text(topic)
    if topic_clean and topic_clean not in {"口播视频", "口播"}:
        return f"{topic_clean[:10]}口播"
    for seg in timeline.get("segments") or []:
        candidate = compact_copy_text(str(seg.get("text") or ""))
        if len(candidate) >= 4:
            return f"{candidate[:12]}口播"
    return DRAFT_TITLE_FALLBACK


def generate_draft_title_base(
    run_dir: Path,
    timeline: dict[str, Any],
    topic: str,
    precomputed: Any = None,
) -> str:
    title_input = {
        "topic": topic,
        "copy": timeline_copy_text(timeline),
        "segments": [
            {
                "source_index": seg.get("source_index"),
                "target_start_ms": seg.get("target_start_ms"),
                "target_end_ms": seg.get("target_end_ms"),
                "text": seg.get("text"),
            }
            for seg in timeline.get("segments") or []
        ],
        "rules": {
            "language": "zh-CN",
            "max_chars": DRAFT_TITLE_MAX_CHARS,
            "style": "根据口播文案生成短标题，不要标点，不要时间戳",
        },
    }
    write_json(run_dir / "draft_title_input.json", title_input)

    source = "local_heuristic"
    raw_title = select_precomputed_title(precomputed)
    if raw_title:
        source = "codex_precomputed"
    else:
        cmd_template = os.environ.get("LOCAL_DRAFT_TITLE_CMD", "").strip()
        if cmd_template:
            try:
                cmd = shlex.split(cmd_template) + [str(run_dir / "draft_title_input.json")]
                proc = subprocess.run(cmd, text=True, capture_output=True, timeout=120)
                write_json(
                    run_dir / "draft_title_command.json",
                    {
                        "cmd": cmd_template,
                        "returncode": proc.returncode,
                        "stdout": proc.stdout.strip(),
                        "stderr": proc.stderr.strip(),
                    },
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    try:
                        parsed = json.loads(proc.stdout)
                    except json.JSONDecodeError:
                        parsed = proc.stdout.strip()
                    raw_title = select_precomputed_title(parsed)
                    if raw_title:
                        source = "local_command"
            except Exception as exc:
                write_json(run_dir / "draft_title_command.json", {"cmd": cmd_template, "error": str(exc)})
    if not raw_title:
        raw_title = heuristic_draft_title_from_copy(timeline, topic)
    title = sanitize_draft_title_base(raw_title)
    write_json(run_dir / "draft_title.json", {"title_base": title, "raw_title": raw_title, "source": source})
    return title


def capture_timestamp(api_key: str, run_dir: Path, index: int, url: str, search: str, max_wait: int) -> float | None:
    try:
        data = skill_wait(
            api_key,
            run_dir,
            f"capture_material_{index}",
            ["video-capture", "submit-and-wait", "--video-url", url, "--search-sentence", search],
            max_wait=max_wait,
            check=False,
        )
        timestamp = recursive_find(data, ("timestamp",))
        return float(timestamp) if timestamp is not None else None
    except Exception as exc:
        log(f"素材 {index} 语义定位失败，使用兜底截取：{exc}")
        return None


def source_window(
    timestamp: float | None,
    source_duration: float,
    target_duration: float,
    min_duration: float = 1.5,
    max_duration: float = 3.0,
) -> tuple[float, float]:
    target_duration = max(min_duration, min(max_duration, target_duration))
    if timestamp is None:
        timestamp = source_duration / 2
    start = timestamp - target_duration / 2
    start = max(0.0, min(start, max(0.0, source_duration - target_duration - 0.05)))
    end = min(source_duration - 0.05, start + target_duration)
    if end <= start:
        start = 0.0
        end = min(source_duration, target_duration)
    return round(start, 6), round(end, 6)


def fixed_duration_window(start: float, source_duration: float, target_duration: float) -> tuple[float, float] | None:
    if source_duration <= 0 or target_duration <= 0 or source_duration + 1e-6 < target_duration:
        return None
    start = max(0.0, min(float(start), max(0.0, float(source_duration) - float(target_duration))))
    end = start + float(target_duration)
    return round(start, 6), round(end, 6)


def centered_fixed_duration_window(timestamp: float | None, source_duration: float, target_duration: float) -> tuple[float, float] | None:
    if timestamp is None:
        timestamp = source_duration / 2
    return fixed_duration_window(float(timestamp) - float(target_duration) / 2, source_duration, target_duration)


def caption_source_window(segment: dict[str, Any], host_duration: float, min_duration: float = 3.5) -> tuple[float, float]:
    source_start = float(segment.get("source_start_ms", 0)) / 1000.0
    source_end = float(segment.get("source_end_ms", segment.get("source_start_ms", 0))) / 1000.0
    duration = max(0.0, source_end - source_start)
    if duration >= min_duration:
        return round(source_start, 6), round(source_end, 6)
    start = max(0.0, min(source_start, max(0.0, host_duration - min_duration)))
    end = min(host_duration, start + min_duration)
    if end - start < min_duration:
        raise RuntimeError("Talking-head source video is shorter than the 3.5s preset replacement requirement")
    return round(start, 6), round(end, 6)


def segment_target_duration_seconds(segment: dict[str, Any], min_duration: float, max_duration: float) -> float:
    duration = (int(segment.get("target_end_ms", 0)) - int(segment.get("target_start_ms", 0))) / 1000.0
    return round(max(min_duration, min(max_duration, duration)), 6)


def clamp_video_material_window(match: dict[str, Any], video_duration: float, fallback_duration: float) -> tuple[float | None, float | None]:
    start_value = (
        match.get("material_start")
        if match.get("material_start") is not None
        else match.get("material_source_start", match.get("video1_start"))
    )
    try:
        start = float(start_value)
    except Exception:
        return None, None
    duration = max(MATERIAL_VIDEO_PIP_MIN_DURATION, min(MATERIAL_VIDEO_PIP_MAX_DURATION, float(fallback_duration)))
    window = fixed_duration_window(start, video_duration, duration)
    if window is None:
        return None, None
    return window


def candidate_windows_from_video_analysis(analysis: str, video_duration: float) -> list[tuple[float, float]]:
    windows: list[tuple[float, float]] = []
    text = str(analysis or "")
    patterns = [
        r"(?P<start>\d+(?:\.\d+)?)\s*(?:秒|s)?\s*[-~到至]\s*(?P<end>\d+(?:\.\d+)?)\s*(?:秒|s)",
        r"start[\"'：:\s]+(?P<start>\d+(?:\.\d+)?).*?end[\"'：:\s]+(?P<end>\d+(?:\.\d+)?)",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE | re.S):
            try:
                start = float(match.group("start"))
                end = float(match.group("end"))
            except Exception:
                continue
            duration = end - start
            if duration <= 0:
                continue
            if duration < MATERIAL_VIDEO_PIP_MIN_DURATION:
                end = start + MATERIAL_VIDEO_PIP_MIN_DURATION
            if end - start > MATERIAL_VIDEO_PIP_MAX_DURATION:
                end = start + MATERIAL_VIDEO_PIP_MAX_DURATION
            if video_duration > 0:
                start = max(0.0, min(start, max(0.0, video_duration - MATERIAL_VIDEO_PIP_MIN_DURATION)))
                end = min(video_duration, end)
            if end - start >= MATERIAL_VIDEO_PIP_MIN_DURATION:
                item = (round(start, 6), round(end, 6))
                if item not in windows:
                    windows.append(item)
    if not windows and video_duration >= MATERIAL_VIDEO_PIP_MIN_DURATION:
        end = min(video_duration, MATERIAL_VIDEO_PIP_MAX_DURATION)
        if end < MATERIAL_VIDEO_PIP_MIN_DURATION:
            end = MATERIAL_VIDEO_PIP_MIN_DURATION
        windows.append((0.0, round(end, 6)))
    return windows


def preset_target_time_window(segment: dict[str, Any], host_duration: float, min_duration: float = 3.5) -> tuple[float, float]:
    start = float(segment.get("target_start_ms", 0)) / 1000.0
    start = max(0.0, min(start, max(0.0, host_duration - min_duration)))
    end = min(host_duration, start + min_duration)
    if end - start < min_duration:
        raise RuntimeError("Talking-head source video is shorter than the 3.5s preset replacement requirement")
    return round(start, 6), round(end, 6)


def build_preset_match_input(timeline: dict[str, Any], image_analyses: list[dict[str, Any]], topic: str) -> dict[str, Any]:
    images = []
    for image in image_analyses:
        enriched = dict(image)
        enriched["presentation_type"] = classify_image_presentation(enriched)
        images.append(enriched)
    return {
        "topic": topic,
        "captions": [
            {
                "source_index": s["source_index"],
                "text": s["text"],
                "target_start_ms": s["target_start_ms"],
                "target_end_ms": s["target_end_ms"],
                "source_start_ms": s["source_start_ms"],
                "source_end_ms": s["source_end_ms"],
            }
            for s in timeline["segments"]
        ],
        "images": images,
        "preset_id": IMAGE_VIDEO_PRESET_ID,
        "video1_min_duration_seconds": 3.5,
        "effect_selection_rules": {
            "overall_product_image": "匹配开场推荐、种草、整体外观、款式、价格或入手话术时，使用图片画中画，优先安排在前2.5秒或第一处整体推荐句。",
            "detail_image": "匹配摸起来、看起来、材质、面料、纹理、柔软、亲肤、做工等细节点描述时，使用图片+口播片段细节预设，视频片段必须至少3.5秒。",
            "do_not_mix": "整体商品图不要用于细节预设；细节特写图不要用于开场整体画中画；同一时间段仍只允许一种效果。",
        },
    }


def build_video_preset_match_input(
    timeline: dict[str, Any],
    video_urls: list[str],
    video_durations: list[float],
    video_analyses: list[dict[str, Any]],
    topic: str,
    global_indices: list[int] | None = None,
) -> dict[str, Any]:
    videos = []
    for i, url in enumerate(video_urls, start=1):
        parsed = urlparse(url)
        filename = unquote(Path(parsed.path or url).name) or f"video_{i}"
        videos.append(
            {
                "video_index": i,
                "material_index": global_indices[i - 1] if global_indices and i - 1 < len(global_indices) else i,
                "url": url,
                "filename": filename,
                "material_type": "video",
                "duration": video_durations[i - 1] if i - 1 < len(video_durations) else 0,
                "analysis": (video_analyses[i - 1].get("analysis") if i - 1 < len(video_analyses) else "")
                or f"视频素材：{filename}。用于活动卡通风预设里的素材视频片段 video1，需和口播句子语义匹配。",
                "analysis_task_id": video_analyses[i - 1].get("task_id") if i - 1 < len(video_analyses) else "",
            }
        )
    return {
        "topic": topic,
        "captions": [
            {
                "source_index": s["source_index"],
                "text": s["text"],
                "target_start_ms": s["target_start_ms"],
                "target_end_ms": s["target_end_ms"],
                "source_start_ms": s["source_start_ms"],
                "source_end_ms": s["source_end_ms"],
            }
            for s in timeline["segments"]
        ],
        "videos": videos,
        "effect_type": "material_video_pip",
        "material_video_duration_seconds": {
            "min": MATERIAL_VIDEO_PIP_MIN_DURATION,
            "max": MATERIAL_VIDEO_PIP_MAX_DURATION,
        },
        "layout": {
            "video_material": "background",
            "talking_head": "picture_in_picture_right_middle",
            "talking_head_transform_x": TALKING_HEAD_PIP_X,
            "talking_head_transform_y": TALKING_HEAD_PIP_Y,
            "talking_head_scale": TALKING_HEAD_PIP_SCALE,
        },
        "rules": {
            "decision_owner": "local_model_or_precomputed_effect_json",
            "must_choose_material_clip": "For each material_video_pip, choose material_start from VectCut video_detail analysis. The uploaded material video is shown as the background, and the talking-head video is shown as a right-middle picture-in-picture overlay. Duration is 2-4 seconds.",
            "no_overlap": "image_preset, material_video_pip, and image_pip cannot overlap on the target timeline.",
        },
    }


def parse_preset_matches(raw: Any) -> list[dict[str, Any]]:
    try:
        if isinstance(raw, str):
            text = first_json_string(raw)
            data = json.loads(text) if text else json.loads(raw)
        else:
            data = raw
    except Exception:
        return []
    raw_matches = data.get("matches") if isinstance(data, dict) else data
    if isinstance(raw_matches, list):
        return [item for item in raw_matches if isinstance(item, dict)]
    return []


def parse_image_effect_plan(raw: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        if isinstance(raw, str):
            text = first_json_string(raw)
            data = json.loads(text) if text else json.loads(raw)
        else:
            data = raw
    except Exception:
        return [], []
    items = data.get("effects") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return [], []
    preset_by_image: dict[int, dict[str, Any]] = {}
    pip_by_image: dict[int, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            image_index = int(item.get("image_index"))
        except Exception:
            continue
        effect = str(item.get("effect") or item.get("effect_type") or item.get("type") or "").lower()
        normalized = {**item, "image_index": image_index}
        if effect in ("preset", "image_video_preset", "image_preset", "add_image_preset", "add_preset"):
            preset_by_image[image_index] = normalized
        elif effect in ("pip", "picture_in_picture", "image_pip", "image_overlay"):
            pip_by_image.setdefault(image_index, normalized)
    preset_matches = list(preset_by_image.values())
    pip_effects = [effect for image_index, effect in pip_by_image.items() if image_index not in preset_by_image]
    return preset_matches, pip_effects


def parse_video_effect_plan(raw: Any) -> list[dict[str, Any]]:
    try:
        if isinstance(raw, str):
            text = first_json_string(raw)
            data = json.loads(text) if text else json.loads(raw)
        else:
            data = raw
    except Exception:
        return []
    items = data.get("effects") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    by_video: dict[int, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        effect = str(item.get("effect") or item.get("effect_type") or item.get("type") or "").lower()
        if effect not in ("video_pip", "material_video_pip", "talking_head_pip", "video_background_pip", "video_preset", "material_video_preset", "video_material_preset", "add_video_preset", "video"):
            continue
        normalized = {**item}
        if item.get("video_index") is not None:
            try:
                video_index = int(item.get("video_index"))
            except Exception:
                continue
            normalized["video_index"] = video_index
        elif item.get("material_index") is not None:
            try:
                normalized["material_index"] = int(item.get("material_index"))
            except Exception:
                continue
            video_index = int(normalized["material_index"])
        elif item.get("index") is not None:
            try:
                video_index = int(item.get("index"))
            except Exception:
                continue
            normalized["video_index"] = video_index
        else:
            continue
        by_video[video_index] = normalized
    return list(by_video.values())


def resolve_effect_source_index(effect: dict[str, Any], by_source: dict[int, dict[str, Any]]) -> int | None:
    needles = effect_caption_needles(effect)
    if needles:
        for source_index, segment in sorted(by_source.items()):
            text = str(segment.get("text") or "")
            compact = compact_copy_text(text)
            if all(needle in text or compact_copy_text(needle) in compact for needle in needles):
                return source_index
    if effect.get("source_index") is not None:
        try:
            source_index = int(effect.get("source_index"))
        except Exception:
            return None
        if source_index in by_source:
            return source_index
    return None


def resolve_effect_segment(effect: dict[str, Any], by_source: dict[int, dict[str, Any]]) -> dict[str, Any] | None:
    source_index = resolve_effect_source_index(effect, by_source)
    if source_index is not None:
        return by_source.get(source_index)
    try:
        target_ms = int(effect.get("target_start_ms"))
    except Exception:
        target_ms = None
    if target_ms is not None:
        segments = sorted(by_source.values(), key=lambda item: int(item.get("target_start_ms", 0)))
        for segment in segments:
            if int(segment.get("target_start_ms", 0)) <= target_ms < int(segment.get("target_end_ms", 0)):
                return segment
        if segments:
            return min(segments, key=lambda item: abs(int(item.get("target_start_ms", 0)) - target_ms))
    return None


def effect_caption_needles(effect: dict[str, Any]) -> list[str]:
    contains = effect.get("caption_contains") or effect.get("text_contains") or effect.get("caption_keyword")
    if not contains:
        return []
    needles = [str(item).strip() for item in contains] if isinstance(contains, list) else [str(contains).strip()]
    return [item for item in needles if item]


def locate_text_in_segment_words(segment: dict[str, Any], needle: str) -> tuple[int, int] | None:
    words = segment.get("words") or []
    if not words:
        return None
    chars: list[str] = []
    char_times: list[tuple[int, int]] = []
    for word in words:
        text = compact_copy_text(str(word.get("text") or ""))
        if not text:
            continue
        try:
            start_ms = int(word.get("start_ms", word.get("start_time")))
            end_ms = int(word.get("end_ms", word.get("end_time")))
        except Exception:
            continue
        for char in text:
            chars.append(char)
            char_times.append((start_ms, end_ms))
    compact = "".join(chars)
    compact_needle = compact_copy_text(needle)
    if not compact or not compact_needle:
        return None
    index = compact.find(compact_needle)
    if index < 0:
        return None
    end_index = min(len(char_times) - 1, index + len(compact_needle) - 1)
    return char_times[index][0], char_times[end_index][1]


def map_source_ms_to_target_ms(timeline: dict[str, Any], source_ms: int, fallback_target_ms: int) -> int:
    for chunk in timeline.get("chunks") or []:
        source_start = int(chunk.get("source_start_ms", 0))
        source_end = int(chunk.get("source_end_ms", 0))
        if source_start <= source_ms <= source_end:
            return int(chunk.get("target_start_ms", 0)) + max(0, source_ms - source_start)
    return fallback_target_ms


def effect_caption_anchor(effect: dict[str, Any], segment: dict[str, Any], timeline: dict[str, Any]) -> dict[str, Any]:
    needles = effect_caption_needles(effect)
    located: list[tuple[int, int, str]] = []
    for needle in needles:
        location = locate_text_in_segment_words(segment, needle)
        if location:
            located.append((location[0], location[1], needle))
    if located:
        source_start_ms = min(item[0] for item in located)
        source_end_ms = max(item[1] for item in located)
        anchor_text = "".join(item[2] for item in located) if len(located) > 1 else located[0][2]
    else:
        source_start_ms = int(segment.get("source_start_ms", 0))
        source_end_ms = int(segment.get("source_end_ms", source_start_ms))
        anchor_text = str(segment.get("text") or "")
    target_start_ms = map_source_ms_to_target_ms(timeline, source_start_ms, int(segment.get("target_start_ms", 0)))
    return {
        "anchor_text": anchor_text,
        "anchor_source_start_ms": source_start_ms,
        "anchor_source_end_ms": source_end_ms,
        "anchor_target_start_ms": target_start_ms,
    }


def normalize_match_text(value: Any) -> str:
    if isinstance(value, dict):
        parts: list[str] = []
        for key in ("description", "summary", "scene", "subject", "objects", "text_in_image", "keywords", "filename"):
            item = value.get(key)
            if item:
                parts.append(json.dumps(item, ensure_ascii=False) if isinstance(item, (list, dict)) else str(item))
        return " ".join(parts)
    return str(value or "")


def contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def classify_image_presentation(image: dict[str, Any]) -> str:
    """Classify an image by what it is suitable to show, not only its keywords."""
    subject = str(image.get("subject") or "")
    scene = str(image.get("scene") or "")
    description = str(image.get("description") or "")
    objects = json.dumps(image.get("objects") or "", ensure_ascii=False)
    detail_score = 0
    overall_score = 0
    if contains_any(subject, ("面料", "纹理", "细节", "局部", "针织")):
        detail_score += 4
    if contains_any(scene, ("微距", "特写", "局部", "细节")):
        detail_score += 4
    if contains_any(description, ("微距", "特写", "局部", "纹理", "质感", "细节", "绒毛")):
        detail_score += 2
    if contains_any(subject, ("上衣", "毛衣", "衣服", "商品", "单品", "穿搭")):
        overall_score += 3
    if contains_any(scene, ("街道", "户外", "穿搭", "全身", "人物", "商品展示")):
        overall_score += 3
    if contains_any(description, ("整体", "悬挂", "上身", "外观", "款式", "版型")):
        overall_score += 2
    if contains_any(objects, ("面料", "纹理", "毛线", "绒毛")):
        detail_score += 1
    return "detail" if detail_score > overall_score else "overall"


def classify_caption_stage(caption: dict[str, Any]) -> str:
    text = compact_copy_text(str(caption.get("text") or ""))
    if contains_any(text, CAPTION_DETAIL_CUE_TERMS):
        return "detail"
    if contains_any(text, CAPTION_OVERALL_CUE_TERMS):
        return "overall"
    return "neutral"


def caption_match_priority(caption: dict[str, Any], stage: str) -> int:
    text = compact_copy_text(str(caption.get("text") or ""))
    start_ms = int(caption.get("target_start_ms", 0))
    score = 0
    if stage == "overall":
        if contains_any(text, CAPTION_INTRO_CUE_TERMS):
            score += 30
        if start_ms <= 2500:
            score += 10
    elif stage == "detail":
        if contains_any(text, ("摸起来", "看起来", "手感", "材质", "面料", "纹理", "质感", "亲肤", "软糯", "糯糯")):
            score += 30
    return score


def text_match_score(image_text: str, caption_text: str) -> int:
    stop_chars = set(" \t\r\n，。！？、：；,.!?;:\"'()（）[]【】{}<>《》-_/\\|0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
    image_chars = {ch for ch in image_text if ch not in stop_chars}
    caption_chars = {ch for ch in caption_text if ch not in stop_chars}
    return len(image_chars & caption_chars)


def heuristic_preset_matches(match_input: dict[str, Any]) -> list[dict[str, Any]]:
    images = match_input.get("images") or []
    captions = match_input.get("captions") or []
    used_sources: set[int] = set()
    matches: list[dict[str, Any]] = []
    for image in images:
        if not isinstance(image, dict):
            continue
        image_index = int(image.get("index") or len(matches) + 1)
        if classify_image_presentation(image) != "detail":
            continue
        image_text = normalize_match_text(image)
        scored = []
        for caption in captions:
            if not isinstance(caption, dict):
                continue
            source_index = int(caption.get("source_index", -1))
            if source_index in used_sources:
                continue
            if classify_caption_stage(caption) != "detail":
                continue
            score = 100 + caption_match_priority(caption, "detail") + text_match_score(image_text, str(caption.get("text") or ""))
            scored.append((score, source_index, caption))
        scored.sort(key=lambda item: (-item[0], item[1]))
        if not scored or scored[0][0] <= 0:
            continue
        _, source_index, caption = scored[0]
        matches.append(
            {
                "image_index": image_index,
                "source_index": source_index,
                "confidence": "low",
                "match_source": "local_heuristic",
                "reason": f"细节图优先匹配触感/材质/外观细节话术；图片信息：{image_text[:80]}；句子：{str(caption.get('text') or '')[:80]}",
            }
        )
        used_sources.add(source_index)
        if len(matches) >= 5:
            break
    return matches


def run_preset_match_locally(run_dir: Path, match_input: dict[str, Any], precomputed: Any = None) -> list[dict[str, Any]]:
    write_json(run_dir / "preset_match_input.json", match_input)
    if precomputed is not None:
        matches = parse_preset_matches(precomputed)
        for match in matches:
            match.setdefault("match_source", "codex_precomputed")
        write_json(run_dir / "preset_matches_raw.json", matches)
        return matches

    cmd_template = os.environ.get("LOCAL_PRESET_MATCHER_CMD", "").strip()
    if cmd_template:
        try:
            input_path = run_dir / "preset_match_input.json"
            cmd = shlex.split(cmd_template) + [str(input_path)]
            proc = subprocess.run(cmd, text=True, capture_output=True, timeout=180)
            detail = {
                "cmd": cmd_template,
                "returncode": proc.returncode,
                "stdout": proc.stdout.strip(),
                "stderr": proc.stderr.strip(),
                "input_path": str(input_path),
            }
            write_json(run_dir / "local_preset_match_raw.json", detail)
            if proc.returncode == 0 and proc.stdout.strip():
                matches = parse_preset_matches(proc.stdout.strip())
                for match in matches:
                    match.setdefault("match_source", "local_command")
                write_json(run_dir / "preset_matches_raw.json", matches)
                return matches
            log(f"本地图片-文案匹配失败，使用规则兜底：{proc.stderr.strip() or proc.stdout.strip()}")
        except Exception as exc:
            write_json(run_dir / "local_preset_match_raw.json", {"error": str(exc)})
            log(f"本地图片-文案匹配异常，使用规则兜底：{exc}")

    matches = heuristic_preset_matches(match_input)
    write_json(run_dir / "preset_matches_raw.json", matches)
    return matches


def heuristic_video_preset_matches(match_input: dict[str, Any], occupied: list[tuple[int, int]] | None = None) -> list[dict[str, Any]]:
    videos = match_input.get("videos") or []
    captions = match_input.get("captions") or []
    occupied = list(occupied or [])
    matches: list[dict[str, Any]] = []
    used_sources: set[int] = set()
    for video in videos:
        if not isinstance(video, dict):
            continue
        try:
            video_index = int(video.get("video_index") or len(matches) + 1)
        except Exception:
            continue
        video_text = normalize_match_text(video)
        video_duration = float(video.get("duration") or 0)
        material_windows = candidate_windows_from_video_analysis(str(video.get("analysis") or ""), video_duration)
        material_window = material_windows[min(len(matches), len(material_windows) - 1)] if material_windows else (None, None)
        scored = []
        for caption in captions:
            if not isinstance(caption, dict):
                continue
            source_index = int(caption.get("source_index", -1))
            if source_index in used_sources:
                continue
            start_ms = int(caption.get("target_start_ms", 0))
            target_duration_ms = int(
                max(
                    MATERIAL_VIDEO_PIP_MIN_DURATION * 1000,
                    min(MATERIAL_VIDEO_PIP_MAX_DURATION * 1000, int(caption.get("target_end_ms", 0)) - start_ms),
                )
            )
            end_ms = start_ms + target_duration_ms
            if any(not (end_ms <= start or start_ms >= end) for start, end in occupied):
                continue
            score = text_match_score(video_text, str(caption.get("text") or ""))
            scored.append((score, source_index, caption))
        scored.sort(key=lambda item: (-item[0], item[1]))
        if scored:
            _, source_index, caption = scored[0]
        else:
            usable = [
                caption
                for caption in captions
                if isinstance(caption, dict)
                and int(caption.get("source_index", -1)) not in used_sources
                and int(caption.get("target_start_ms", 0)) >= 1000
            ]
            if not usable:
                continue
            caption = usable[min(len(matches), len(usable) - 1)]
            source_index = int(caption.get("source_index", -1))
        matches.append(
            {
                "video_index": video_index,
                "source_index": source_index,
                "effect": "material_video_pip",
                "match_source": "local_heuristic",
                "material_start": material_window[0],
                "material_end": material_window[1],
                "material_search": str(caption.get("text") or ""),
                "reason": f"本地兜底规则选择视频素材和口播句子匹配；视频信息：{video_text[:80]}；句子：{str(caption.get('text') or '')[:80]}",
            }
        )
        used_sources.add(source_index)
        if len(matches) >= 5:
            break
    return matches


def run_video_preset_match_locally(
    run_dir: Path,
    match_input: dict[str, Any],
    occupied: list[tuple[int, int]] | None = None,
    precomputed: Any = None,
) -> list[dict[str, Any]]:
    write_json(run_dir / "video_pip_match_input.json", match_input)
    if precomputed is not None:
        matches = parse_video_effect_plan(precomputed)
        for match in matches:
            match.setdefault("match_source", "codex_precomputed_effect_plan")
        write_json(run_dir / "video_pip_matches_raw.json", matches)
        return matches
    cmd_template = os.environ.get("LOCAL_VIDEO_PIP_MATCHER_CMD", "").strip() or os.environ.get("LOCAL_VIDEO_PRESET_MATCHER_CMD", "").strip()
    if cmd_template:
        try:
            input_path = run_dir / "video_pip_match_input.json"
            cmd = shlex.split(cmd_template) + [str(input_path)]
            proc = subprocess.run(cmd, text=True, capture_output=True, timeout=180)
            detail = {
                "cmd": cmd_template,
                "returncode": proc.returncode,
                "stdout": proc.stdout.strip(),
                "stderr": proc.stderr.strip(),
                "input_path": str(input_path),
            }
            write_json(run_dir / "local_video_pip_match_raw.json", detail)
            if proc.returncode == 0 and proc.stdout.strip():
                matches = parse_video_effect_plan(proc.stdout.strip())
                for match in matches:
                    match.setdefault("match_source", "local_command")
                write_json(run_dir / "video_pip_matches_raw.json", matches)
                return matches
            log(f"本地视频素材-文案匹配失败，使用规则兜底：{proc.stderr.strip() or proc.stdout.strip()}")
        except Exception as exc:
            write_json(run_dir / "local_video_pip_match_raw.json", {"error": str(exc)})
            log(f"本地视频素材-文案匹配异常，使用规则兜底：{exc}")
    matches = heuristic_video_preset_matches(match_input, occupied=occupied)
    write_json(run_dir / "video_pip_matches_raw.json", matches)
    return matches


def parse_image_pip_effects(raw: Any) -> list[dict[str, Any]]:
    try:
        if isinstance(raw, str):
            text = first_json_string(raw)
            data = json.loads(text) if text else json.loads(raw)
        else:
            data = raw
    except Exception:
        return []
    raw_effects = data.get("effects") if isinstance(data, dict) else data
    if isinstance(raw_effects, list):
        return [item for item in raw_effects if isinstance(item, dict)]
    return []


def heuristic_image_pip_effects(match_input: dict[str, Any], excluded_images: set[int]) -> list[dict[str, Any]]:
    images = match_input.get("images") or []
    captions = match_input.get("captions") or []
    total_ms = max((int(c.get("target_end_ms", 0)) for c in captions if isinstance(c, dict)), default=0)
    if total_ms < IMAGE_PIP_DURATION_MS:
        return []
    effects: list[dict[str, Any]] = []
    for image in images:
        if not isinstance(image, dict):
            continue
        image_index = int(image.get("index") or len(effects) + 1)
        if image_index in excluded_images:
            continue
        if classify_image_presentation(image) != "overall":
            continue
        image_text = normalize_match_text(image)
        scored = []
        for caption in captions:
            if not isinstance(caption, dict):
                continue
            start_ms = int(caption.get("target_start_ms", 0))
            if start_ms > total_ms - IMAGE_PIP_DURATION_MS:
                continue
            if classify_caption_stage(caption) != "overall":
                continue
            score = 100 + caption_match_priority(caption, "overall") + text_match_score(image_text, str(caption.get("text") or ""))
            scored.append((score, int(caption.get("source_index", -1)), caption))
        scored.sort(key=lambda item: (-item[0], item[1]))
        if not scored or scored[0][0] <= 0:
            continue
        _, source_index, caption = scored[0]
        effects.append(
            {
                "image_index": image_index,
                "source_index": source_index,
                "effect": "pip",
                "match_source": "local_heuristic",
                "reason": f"整体商品图优先匹配开场推荐/整体展示话术；图片信息：{image_text[:80]}；句子：{str(caption.get('text') or '')[:80]}",
            }
        )
    return effects


def run_image_pip_locally(
    run_dir: Path,
    match_input: dict[str, Any],
    excluded_images: set[int],
    precomputed: Any = None,
) -> list[dict[str, Any]]:
    write_json(run_dir / "image_pip_input.json", {**match_input, "excluded_images": sorted(excluded_images)})
    if precomputed is not None:
        effects = parse_image_pip_effects(precomputed)
        for effect in effects:
            effect.setdefault("match_source", "codex_precomputed")
        write_json(run_dir / "image_pip_effects_raw.json", effects)
        return effects

    cmd_template = os.environ.get("LOCAL_IMAGE_PIP_PLANNER_CMD", "").strip()
    if cmd_template:
        try:
            input_path = run_dir / "image_pip_input.json"
            cmd = shlex.split(cmd_template) + [str(input_path)]
            proc = subprocess.run(cmd, text=True, capture_output=True, timeout=180)
            detail = {
                "cmd": cmd_template,
                "returncode": proc.returncode,
                "stdout": proc.stdout.strip(),
                "stderr": proc.stderr.strip(),
                "input_path": str(input_path),
            }
            write_json(run_dir / "local_image_pip_raw.json", detail)
            if proc.returncode == 0 and proc.stdout.strip():
                effects = parse_image_pip_effects(proc.stdout.strip())
                for effect in effects:
                    effect.setdefault("match_source", "local_command")
                write_json(run_dir / "image_pip_effects_raw.json", effects)
                return effects
            log(f"本地图片画中画规划失败，使用规则兜底：{proc.stderr.strip() or proc.stdout.strip()}")
        except Exception as exc:
            write_json(run_dir / "local_image_pip_raw.json", {"error": str(exc)})
            log(f"本地图片画中画规划异常，使用规则兜底：{exc}")

    effects = heuristic_image_pip_effects(match_input, excluded_images)
    write_json(run_dir / "image_pip_effects_raw.json", effects)
    return effects


def validate_preset_matches(
    matches: list[dict[str, Any]],
    timeline: dict[str, Any],
    image_urls: list[str],
    host_duration: float,
) -> list[dict[str, Any]]:
    by_source = {int(s["source_index"]): s for s in timeline["segments"]}
    used_images: set[int] = set()
    used_sources: set[int] = set()
    valid: list[dict[str, Any]] = []
    for match in matches:
        try:
            image_index = int(match.get("image_index"))
        except Exception:
            continue
        source_index = resolve_effect_source_index(match, by_source)
        if source_index is None:
            continue
        if image_index < 1 or image_index > len(image_urls) or source_index not in by_source:
            continue
        if image_index in used_images or source_index in used_sources:
            continue
        segment = by_source[source_index]
        try:
            source_start, source_end = caption_source_window(segment, host_duration)
        except RuntimeError:
            continue
        source_duration = round(source_end - source_start, 6)
        valid.append(
            {
                "image_index": image_index,
                "image_url": image_urls[image_index - 1],
                "source_index": source_index,
                "caption_text": segment.get("text", ""),
                "target_start_ms": int(segment["target_start_ms"]),
                "target_end_ms": int(segment["target_end_ms"]),
                "video_source_start": source_start,
                "video_source_end": source_end,
                "video_replacement_start": 0.0,
                "video_replacement_end": source_duration,
                "video_replacement_duration": source_duration,
                "reason": str(match.get("reason") or ""),
            }
        )
        used_images.add(image_index)
        used_sources.add(source_index)
        if len(valid) >= 5:
            break
    return valid


def validate_material_video_preset_matches(
    matches: list[dict[str, Any]],
    timeline: dict[str, Any],
    video_urls: list[str],
    video_durations: list[float],
    host_duration: float,
    occupied_intervals: list[tuple[int, int]] | None = None,
    global_indices: list[int] | None = None,
) -> list[dict[str, Any]]:
    by_source = {int(s["source_index"]): s for s in timeline["segments"]}
    occupied = list(occupied_intervals or [])
    used_videos: set[int] = set()
    used_sources: set[int] = set()
    valid: list[dict[str, Any]] = []
    for match in matches:
        raw_index = match.get("video_index", match.get("index"))
        try:
            video_index = int(raw_index)
        except Exception:
            video_index = -1
        if (video_index < 1 or video_index > len(video_urls)) and match.get("material_index") is not None:
            try:
                material_index = int(match.get("material_index"))
            except Exception:
                material_index = -1
            if global_indices and material_index in global_indices:
                video_index = global_indices.index(material_index) + 1
        if (video_index < 1 or video_index > len(video_urls)) and match.get("video_url"):
            try:
                video_index = video_urls.index(str(match.get("video_url"))) + 1
            except ValueError:
                pass
        if video_index < 1 or video_index > len(video_urls) or video_index in used_videos:
            continue
        segment = resolve_effect_segment(match, by_source)
        if not segment:
            continue
        source_index = int(segment["source_index"])
        if source_index in used_sources:
            continue
        display_duration = segment_target_duration_seconds(
            segment,
            MATERIAL_VIDEO_PIP_MIN_DURATION,
            MATERIAL_VIDEO_PIP_MAX_DURATION,
        )
        start_ms = int(segment["target_start_ms"])
        duration_ms = int(round(display_duration * 1000))
        end_ms = start_ms + duration_ms
        if any(not (end_ms <= start or start_ms >= end) for start, end in occupied):
            continue
        source_start = float(segment.get("source_start_ms", 0)) / 1000.0
        host_window = fixed_duration_window(source_start, host_duration, display_duration)
        if host_window is None:
            continue
        host_source_start, host_source_end = host_window
        video_duration = float(video_durations[video_index - 1]) if video_index - 1 < len(video_durations) else 0.0
        if video_duration < MATERIAL_VIDEO_PIP_MIN_DURATION:
            continue
        material_source_start, material_source_end = clamp_video_material_window(match, video_duration, display_duration)
        valid.append(
            {
                "video_index": video_index,
                "video_url": video_urls[video_index - 1],
                "video_duration": video_duration,
                "source_index": source_index,
                "caption_text": segment.get("text", ""),
                "target_start_ms": start_ms,
                "target_end_ms": end_ms,
                "preset_duration": display_duration,
                "video2_source_start": host_source_start,
                "video2_source_end": host_source_end,
                "material_source_start": material_source_start,
                "material_source_end": material_source_end,
                "material_window_source": str(match.get("match_source") or "precomputed") if material_source_start is not None else "fallback_capture",
                "material_search": str(match.get("material_search") or match.get("search") or segment.get("text") or ""),
                "reason": str(match.get("reason") or ""),
                "match_source": str(match.get("match_source") or ""),
            }
        )
        used_videos.add(video_index)
        used_sources.add(source_index)
        occupied.append((start_ms, end_ms))
        if len(valid) >= 5:
            break
    return valid


def preset_blocked_intervals(matches: list[dict[str, Any]]) -> list[tuple[int, int]]:
    intervals: list[tuple[int, int]] = []
    for match in matches:
        try:
            start_ms = int(match["target_start_ms"])
            source_duration_ms = round(float(match.get("video_replacement_duration") or (float(match["video_source_end"]) - float(match["video_source_start"]))) * 1000)
        except Exception:
            continue
        end_ms = start_ms + max(0, source_duration_ms)
        if end_ms > start_ms:
            intervals.append((start_ms, end_ms))
    return intervals


def fixed_effect_intervals(items: list[dict[str, Any]]) -> list[tuple[int, int]]:
    intervals: list[tuple[int, int]] = []
    for item in items:
        try:
            start_ms = int(item["target_start_ms"])
            end_ms = int(item["target_end_ms"])
        except Exception:
            continue
        if end_ms > start_ms:
            intervals.append((start_ms, end_ms))
    return intervals


def validate_image_pip_effects(
    effects: list[dict[str, Any]],
    timeline: dict[str, Any],
    image_urls: list[str],
    used_images: set[int],
    blocked_intervals: list[tuple[int, int]] | None = None,
    image_dimensions: dict[int, tuple[int, int]] | None = None,
) -> list[dict[str, Any]]:
    by_source = {int(s["source_index"]): s for s in timeline["segments"]}
    total_ms = int(timeline["target_duration_ms"])
    if total_ms < IMAGE_PIP_DURATION_MS:
        return []
    used_local = set(used_images)
    occupied: list[tuple[int, int]] = list(blocked_intervals or [])
    valid: list[dict[str, Any]] = []
    for effect in effects:
        try:
            image_index = int(effect.get("image_index"))
        except Exception:
            continue
        if image_index < 1 or image_index > len(image_urls) or image_index in used_local:
            continue
        source_index = None
        segment: dict[str, Any] | None = None
        source_index = resolve_effect_source_index(effect, by_source)
        if source_index is not None:
            segment = by_source.get(source_index)
        try:
            start_ms = int(effect.get("target_start_ms")) if effect.get("target_start_ms") is not None else None
        except Exception:
            start_ms = None
        if start_ms is None and segment is not None:
            start_ms = int(segment["target_start_ms"])
        if start_ms is None:
            continue
        if start_ms < 0 or start_ms > total_ms - IMAGE_PIP_DURATION_MS:
            continue
        end_ms = start_ms + IMAGE_PIP_DURATION_MS
        if any(not (end_ms <= start or start_ms >= end) for start, end in occupied):
            continue
        width, height = (image_dimensions or {}).get(image_index, (None, None))
        scale = calculate_pip_scale(width, height)
        valid.append(
            {
                "image_index": image_index,
                "image_url": image_urls[image_index - 1],
                "source_index": source_index,
                "caption_text": segment.get("text", "") if segment else str(effect.get("caption_text") or ""),
                "target_start_ms": start_ms,
                "target_end_ms": end_ms,
                "duration_ms": IMAGE_PIP_DURATION_MS,
                "image_width": width,
                "image_height": height,
                "scale": scale,
                "scale_basis": {
                    "canvas_width": CANVAS_WIDTH,
                    "canvas_height": CANVAS_HEIGHT,
                    "max_width_px": round(CANVAS_WIDTH * IMAGE_PIP_MAX_WIDTH_RATIO, 2),
                    "max_height_px": round(CANVAS_HEIGHT * IMAGE_PIP_MAX_HEIGHT_RATIO, 2),
                    "fallback_scale": IMAGE_PIP_FALLBACK_SCALE,
                },
                "intro_animation": "便利贴",
                "intro_duration": 0.35,
                "outro_animation": "向上滑动",
                "outro_duration": 0.35,
                "reason": str(effect.get("reason") or ""),
                "match_source": str(effect.get("match_source") or ""),
            }
        )
        used_local.add(image_index)
        occupied.append((start_ms, end_ms))
    return valid


def add_image_video_presets(
    api_key: str,
    run_dir: Path,
    draft_id: str,
    host_url: str,
    matches: list[dict[str, Any]],
    max_wait: int,
) -> dict[str, Any]:
    writes = []
    success_count = 0
    for i, match in enumerate(matches, start=1):
        replacement_duration = round(float(match.get("video_replacement_duration") or (float(match["video_source_end"]) - float(match["video_source_start"]))), 6)
        try:
            clip = split_video_clip(
                api_key,
                run_dir,
                f"preset_video_clip_{i:02d}",
                host_url,
                float(match["video_source_start"]),
                float(match["video_source_end"]),
                max_wait,
            )
        except Exception as exc:
            writes.append({"match": match, "success": False, "error": f"split_video failed: {exc}"})
            continue
        video1_url = str(clip["video_url"])
        payload = {
            "draft_id": draft_id,
            "preset_id": IMAGE_VIDEO_PRESET_ID,
            "replacements": [
                {"image1": match["image_url"]},
                {"video1": video1_url},
            ],
            "target_start": seconds(match["target_start_ms"]),
            "start": 0.0,
            "end": replacement_duration,
            "width": 1080,
            "height": 1920,
            "track_name": "happy_image_video_preset",
            "relative_index": 60 + i,
            "transform_x": 0,
            "transform_y": 0,
            "rotation": 0,
            "scale_x": 1.0,
            "scale_y": 1.0,
            "volume": -60,
        }
        result = skill(api_key, run_dir, f"add_image_video_preset_{i:02d}", ["add-preset", "--payload-json", json.dumps(payload, ensure_ascii=False)], check=False)
        ok = not (isinstance(result, dict) and result.get("success") is False)
        if ok:
            success_count += 1
        writes.append({"match": match, "video_clip": clip, "payload": payload, "success": ok, "response": result})
    report = {"requested": len(matches), "success_count": success_count, "writes": writes}
    write_json(run_dir / "preset_writes.json", report)
    return report


def add_material_video_pip_effects(
    api_key: str,
    run_dir: Path,
    draft_id: str,
    host_url: str,
    host_duration: float,
    matches: list[dict[str, Any]],
    max_wait: int,
) -> dict[str, Any]:
    writes = []
    success_count = 0
    for i, match in enumerate(matches, start=1):
        target_start = seconds(match["target_start_ms"])
        target_end = seconds(match["target_end_ms"])
        target_duration = round(target_end - target_start, 6)
        if target_duration < MATERIAL_VIDEO_PIP_MIN_DURATION or target_duration > MATERIAL_VIDEO_PIP_MAX_DURATION:
            writes.append({"match": match, "success": False, "error": f"invalid material video pip duration: {target_duration}"})
            continue
        try:
            video_duration = float(match["video_duration"])
            if match.get("material_source_start") is not None:
                material_window = fixed_duration_window(float(match["material_source_start"]), video_duration, target_duration)
            else:
                timestamp = capture_timestamp(
                    api_key,
                    run_dir,
                    i,
                    str(match["video_url"]),
                    str(match.get("material_search") or match.get("caption_text") or ""),
                    max_wait,
                )
                material_window = centered_fixed_duration_window(timestamp, video_duration, target_duration)
            if material_window is None:
                raise RuntimeError(f"material video is shorter than pip duration {target_duration}")
            material_start, material_end = material_window
            background_payload = {
                "draft_id": draft_id,
                "video_url": str(match["video_url"]),
                "start": material_start,
                "end": material_end,
                "duration": video_duration,
                "target_start": target_start,
                "width": CANVAS_WIDTH,
                "height": CANVAS_HEIGHT,
                "track_name": MATERIAL_VIDEO_BACKGROUND_TRACK,
                "relative_index": 30 + i,
                "volume": -60,
                "speed": 1.0,
                "transform_x_px": 0,
                "transform_y_px": 0,
                "scale_x": 1.0,
                "scale_y": 1.0,
                "rotation": 0,
                "alpha": 1.0,
            }
            talking_payload = {
                "draft_id": draft_id,
                "video_url": host_url,
                "start": float(match["video2_source_start"]),
                "end": float(match["video2_source_end"]),
                "duration": host_duration,
                "target_start": target_start,
                "width": CANVAS_WIDTH,
                "height": CANVAS_HEIGHT,
                "track_name": MATERIAL_VIDEO_TALKING_PIP_TRACK,
                "relative_index": 70 + i,
                "volume": -60,
                "speed": 1.0,
                "transform_x": TALKING_HEAD_PIP_X,
                "transform_y": TALKING_HEAD_PIP_Y,
                "scale_x": TALKING_HEAD_PIP_SCALE,
                "scale_y": TALKING_HEAD_PIP_SCALE,
                "rotation": 0,
                "alpha": 1.0,
            }
            background_result = skill(api_key, run_dir, f"add_material_video_background_{i:02d}", ["add-video", "--payload-json", json.dumps(background_payload, ensure_ascii=False)], check=False)
            talking_result = skill(api_key, run_dir, f"add_material_talking_pip_{i:02d}", ["add-video", "--payload-json", json.dumps(talking_payload, ensure_ascii=False)], check=False)
        except Exception as exc:
            writes.append({"match": match, "success": False, "error": f"add material video pip failed: {exc}"})
            continue
        background_ok = not (isinstance(background_result, dict) and background_result.get("success") is False)
        talking_ok = not (isinstance(talking_result, dict) and talking_result.get("success") is False)
        ok = background_ok and talking_ok
        if ok:
            success_count += 1
        writes.append(
            {
                "match": match,
                "material_background_payload": background_payload,
                "talking_head_pip_payload": talking_payload,
                "success": ok,
                "background_response": background_result,
                "talking_pip_response": talking_result,
            }
        )
    report = {"requested": len(matches), "success_count": success_count, "writes": writes}
    write_json(run_dir / "material_video_pip_writes.json", report)
    return report


def add_image_pip_effects(
    api_key: str,
    run_dir: Path,
    draft_id: str,
    effects: list[dict[str, Any]],
) -> dict[str, Any]:
    writes = []
    success_count = 0
    for i, effect in enumerate(effects, start=1):
        scale = float(effect.get("scale") or IMAGE_PIP_FALLBACK_SCALE)
        payload = {
            "draft_id": draft_id,
            "image_url": effect["image_url"],
            "start": seconds(effect["target_start_ms"]),
            "end": seconds(effect["target_end_ms"]),
            "width": CANVAS_WIDTH,
            "height": CANVAS_HEIGHT,
            "track_name": IMAGE_PIP_TRACK,
            "relative_index": 55 + i,
            "transform_x_px": 0,
            "transform_y_px": 0,
            "scale_x": scale,
            "scale_y": scale,
            "rotation": 0,
            "alpha": 1.0,
            "intro_animation": "便利贴",
            "intro_duration": 0.35,
            "outro_animation": "向上滑动",
            "outro_duration": 0.35,
        }
        result = skill(api_key, run_dir, f"add_image_pip_{i:02d}", ["add-image", "--payload-json", json.dumps(payload, ensure_ascii=False)], check=False)
        ok = not (isinstance(result, dict) and result.get("success") is False)
        if ok:
            success_count += 1
        writes.append({"effect": effect, "payload": payload, "success": ok, "response": result})
    report = {"requested": len(effects), "success_count": success_count, "writes": writes}
    write_json(run_dir / "image_pip_writes.json", report)
    return report


def subtitle_char_count(text: str) -> int:
    compact = re.sub(r"[\s，。！？；、,.!?;:：]+", "", text or "")
    return len(compact)


def split_subtitle_text(text: str, max_chars: int = 20) -> list[str]:
    text = (text or "").strip()
    if not text or subtitle_char_count(text) <= max_chars:
        return [text] if text else []

    clauses = [part for part in re.split(r"(?<=[，。！？；、,.!?;:：])", text) if part.strip()]
    if len(clauses) <= 1:
        compact = re.sub(r"\s+", "", text)
        count = max(1, subtitle_char_count(compact))
        parts_count = max(2, (count + max_chars - 1) // max_chars)
        size = (len(compact) + parts_count - 1) // parts_count
        return [compact[i : i + size] for i in range(0, len(compact), size) if compact[i : i + size]]

    result: list[str] = []
    current = ""
    for clause in clauses:
        candidate = current + clause
        if current and subtitle_char_count(candidate) > max_chars:
            result.extend(split_subtitle_text(current, max_chars=max_chars))
            current = clause
        else:
            current = candidate
    if current:
        result.extend(split_subtitle_text(current, max_chars=max_chars))
    return result


def split_long_subtitle_segments(
    segments: list[dict[str, Any]],
    *,
    max_chars: int = 20,
    min_duration_ms: int = 500,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    result: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    for segment in segments:
        text = str(segment.get("text") or "").strip()
        start = int(segment["target_start_ms"])
        end = int(segment["target_end_ms"])
        parts = split_subtitle_text(text, max_chars=max_chars)
        if len(parts) <= 1:
            result.append({**segment, "text": text, "normalized_from": [segment.get("source_index")]})
            continue

        duration = max(1, end - start)
        weights = [max(1, subtitle_char_count(part)) for part in parts]
        total_weight = sum(weights)
        cursor = start
        split_segments: list[dict[str, Any]] = []
        for index, (part, weight) in enumerate(zip(parts, weights)):
            if index == len(parts) - 1:
                part_end = end
            else:
                part_duration = max(min_duration_ms, round(duration * weight / total_weight))
                part_end = min(end, cursor + part_duration)
            if part_end <= cursor:
                part_end = min(end, cursor + min_duration_ms)
            split_segments.append(
                {
                    **segment,
                    "text": part,
                    "target_start_ms": cursor,
                    "target_end_ms": part_end,
                    "split_index": index,
                    "split_count": len(parts),
                    "normalized_from": [segment.get("source_index")],
                }
            )
            cursor = part_end
        result.extend(split_segments)
        events.append(
            {
                "type": "split_long",
                "source_index": segment.get("source_index"),
                "original_text": text,
                "parts": [item["text"] for item in split_segments],
            }
        )
    return result, events


def merge_subtitle_into_previous(previous: dict[str, Any], current: dict[str, Any], merged_text: str) -> None:
    previous["text"] = merged_text
    previous["target_end_ms"] = max(int(previous["target_end_ms"]), int(current["target_end_ms"]))
    previous_from = list(previous.get("normalized_from") or [previous.get("source_index")])
    current_from = list(current.get("normalized_from") or [current.get("source_index")])
    previous["normalized_from"] = previous_from + [item for item in current_from if item not in previous_from]
    previous["merged_source_indices"] = previous["normalized_from"]


def normalize_subtitle_segments(
    segments: list[dict[str, Any]],
    target_duration_ms: int,
    *,
    max_merge_chars: int = 20,
    max_chars: int = 20,
    gap_ms: int = 20,
    min_duration_ms: int = 300,
    short_adjacent_gap_ms: int = 180,
    short_adjacent_chars: int = 4,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    normalized, events = split_long_subtitle_segments(segments, max_chars=max_chars)
    normalized.sort(key=lambda item: (int(item["target_start_ms"]), int(item["target_end_ms"])))

    result: list[dict[str, Any]] = []
    for segment in normalized:
        current = {**segment}
        current["target_start_ms"] = int(current["target_start_ms"])
        current["target_end_ms"] = int(current["target_end_ms"])
        if current["target_end_ms"] <= current["target_start_ms"]:
            events.append({"type": "drop_empty", "text": current.get("text", "")})
            continue

        if not result:
            result.append(current)
            continue

        previous = result[-1]
        merged_text = f"{previous.get('text', '')}{current.get('text', '')}"
        target_gap = current["target_start_ms"] - previous["target_end_ms"]
        if (
            0 <= target_gap <= short_adjacent_gap_ms
            and subtitle_char_count(previous.get("text", "")) <= short_adjacent_chars
            and subtitle_char_count(merged_text) <= max_merge_chars
        ):
            old_previous = {k: previous.get(k) for k in ("target_start_ms", "target_end_ms", "text", "source_index")}
            merge_subtitle_into_previous(previous, current, merged_text)
            events.append(
                {
                    "type": "merge_short_adjacent",
                    "gap_ms": target_gap,
                    "previous": old_previous,
                    "current": {k: current.get(k) for k in ("target_start_ms", "target_end_ms", "text", "source_index")},
                    "merged_text": merged_text,
                }
            )
            continue

        if current["target_start_ms"] < previous["target_end_ms"]:
            if subtitle_char_count(merged_text) <= max_merge_chars:
                old_previous = {k: previous.get(k) for k in ("target_start_ms", "target_end_ms", "text", "source_index")}
                merge_subtitle_into_previous(previous, current, merged_text)
                events.append(
                    {
                        "type": "merge_overlap",
                        "previous": old_previous,
                        "current": {k: current.get(k) for k in ("target_start_ms", "target_end_ms", "text", "source_index")},
                        "merged_text": merged_text,
                    }
                )
                continue

            old_start = current["target_start_ms"]
            old_end = current["target_end_ms"]
            duration = old_end - old_start
            current["target_start_ms"] = previous["target_end_ms"] + gap_ms
            current["target_end_ms"] = current["target_start_ms"] + duration
            events.append(
                {
                    "type": "shift_overlap",
                    "text": current.get("text", ""),
                    "old_start_ms": old_start,
                    "old_end_ms": old_end,
                    "new_start_ms": current["target_start_ms"],
                    "new_end_ms": current["target_end_ms"],
                }
            )

        if current["target_end_ms"] > target_duration_ms:
            old_end = current["target_end_ms"]
            current["target_end_ms"] = target_duration_ms
            events.append({"type": "clamp_end", "text": current.get("text", ""), "old_end_ms": old_end, "new_end_ms": target_duration_ms})

        if current["target_end_ms"] - current["target_start_ms"] < min_duration_ms:
            if result and subtitle_char_count(f"{result[-1].get('text', '')}{current.get('text', '')}") <= max_merge_chars:
                result[-1]["text"] = f"{result[-1].get('text', '')}{current.get('text', '')}"
                result[-1]["target_end_ms"] = max(result[-1]["target_end_ms"], current["target_end_ms"])
                events.append({"type": "merge_too_short", "text": current.get("text", "")})
            else:
                events.append({"type": "drop_too_short", "text": current.get("text", "")})
            continue

        result.append(current)

    for index in range(1, len(result)):
        if result[index]["target_start_ms"] < result[index - 1]["target_end_ms"]:
            result[index]["target_start_ms"] = result[index - 1]["target_end_ms"] + gap_ms
            if result[index]["target_end_ms"] <= result[index]["target_start_ms"]:
                result[index]["target_end_ms"] = min(target_duration_ms, result[index]["target_start_ms"] + min_duration_ms)

    final = [item for item in result if item["target_end_ms"] > item["target_start_ms"] and item["target_start_ms"] < target_duration_ms]
    return final, events


def create_draft(api_key: str, run_dir: Path, title_base: str) -> tuple[str, str | None, str]:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    draft_name = f"{sanitize_draft_title_base(title_base)}_{timestamp}"
    write_json(run_dir / "draft_name.json", {"draft_title_base": sanitize_draft_title_base(title_base), "timestamp": timestamp, "draft_name": draft_name})
    data = skill(api_key, run_dir, "create_draft", ["create-draft", "--name", draft_name, "--width", "1080", "--height", "1920"])
    draft_id = recursive_find(data, ("draft_id", "draftId"))
    draft_url = recursive_find(data, ("draft_url", "draftUrl"))
    if not draft_id:
        raise RuntimeError("Create draft response did not include draft_id")
    return str(draft_id), str(draft_url) if draft_url else None, draft_name


def split_chunk_by_exclusions(chunk: dict[str, Any], exclude_intervals: list[tuple[int, int]] | None = None) -> list[dict[str, Any]]:
    pieces = [dict(chunk)]
    for exclude_start, exclude_end in sorted(exclude_intervals or []):
        next_pieces: list[dict[str, Any]] = []
        for piece in pieces:
            target_start = int(piece["target_start_ms"])
            target_end = int(piece["target_end_ms"])
            if exclude_end <= target_start or exclude_start >= target_end:
                next_pieces.append(piece)
                continue
            if exclude_start > target_start:
                left = dict(piece)
                left["target_end_ms"] = exclude_start
                left["source_end_ms"] = int(piece["source_start_ms"]) + (exclude_start - target_start)
                if left["target_end_ms"] - left["target_start_ms"] >= MIN_TALKING_HEAD_CHUNK_MS and left["source_end_ms"] > left["source_start_ms"]:
                    next_pieces.append(left)
            if exclude_end < target_end:
                right = dict(piece)
                right["target_start_ms"] = exclude_end
                right["source_start_ms"] = int(piece["source_start_ms"]) + (exclude_end - target_start)
                if right["target_end_ms"] - right["target_start_ms"] >= MIN_TALKING_HEAD_CHUNK_MS and right["source_end_ms"] > right["source_start_ms"]:
                    next_pieces.append(right)
        pieces = next_pieces
    return pieces


def add_talking_head(
    api_key: str,
    run_dir: Path,
    draft_id: str,
    host_url: str,
    host_duration: float,
    timeline: dict[str, Any],
    exclude_intervals: list[tuple[int, int]] | None = None,
) -> None:
    write_json(run_dir / "talking_head_excluded_intervals.json", [{"start_ms": start, "end_ms": end} for start, end in (exclude_intervals or [])])
    piece_count = 0
    for chunk in timeline["chunks"]:
        for piece in split_chunk_by_exclusions(chunk, exclude_intervals):
            piece_count += 1
            payload = {
                "draft_id": draft_id,
                "video_url": host_url,
                "start": seconds(piece["source_start_ms"]),
                "end": seconds(piece["source_end_ms"]),
                "duration": host_duration,
                "target_start": seconds(piece["target_start_ms"]),
                "width": 1080,
                "height": 1920,
                "track_name": "talking_head_clip",
                "relative_index": 1,
                "volume": -60,
                "speed": 1.0,
            }
            skill(api_key, run_dir, f"add_talking_head_{piece_count:02d}", ["add-video", "--payload-json", json.dumps(payload, ensure_ascii=False)])


def add_broll(
    api_key: str,
    run_dir: Path,
    draft_id: str,
    plan: dict[str, Any],
    material_urls: list[str],
    material_types: list[str],
    material_durations: list[float],
    max_wait: int,
) -> None:
    count = 0
    for seg in plan["append_materials"]:
        if seg["material_role"] == "talking_head":
            continue
        count += 1
        search_item = seg["search_materials"][0]
        index = int(search_item["index"])
        source_index = index - 1
        url = material_urls[source_index]
        kind = material_types[source_index]
        source_duration = material_durations[source_index]
        target_duration = (seg["end"] - seg["start"]) / 1000.0
        if kind == "image":
            payload = {
                "draft_id": draft_id,
                "image_url": url,
                "start": seconds(seg["start"]),
                "end": seconds(seg["end"]),
                "width": 1080,
                "height": 1920,
                "track_name": "selling_broll_clip",
                "relative_index": 2,
                "transform_x_px": 0,
                "transform_y_px": 0,
                "scale_x": 1.0,
                "scale_y": 1.0,
                "rotation": 0,
                "alpha": 1.0,
                "transition": (seg.get("transition") or {}).get("name", "左移"),
                "transition_duration": (seg.get("transition") or {}).get("duration", 0.2),
            }
            skill(api_key, run_dir, f"add_broll_image_{count:02d}", ["add-image", "--payload-json", json.dumps(payload, ensure_ascii=False)])
            continue
        timestamp = capture_timestamp(api_key, run_dir, index, url, search_item.get("search") or seg["covered_caption_text"], max_wait)
        start, end = source_window(timestamp, source_duration, target_duration)
        speed = round((end - start) / target_duration, 8) if target_duration else 1.0
        payload = {
            "draft_id": draft_id,
            "video_url": url,
            "start": start,
            "end": end,
            "duration": source_duration,
            "target_start": seconds(seg["start"]),
            "width": 1080,
            "height": 1920,
            "track_name": "selling_broll_clip",
            "relative_index": 2,
            "volume": -60,
            "speed": speed,
            "transition": (seg.get("transition") or {}).get("name", "左移"),
            "transition_duration": (seg.get("transition") or {}).get("duration", 0.2),
        }
        skill(api_key, run_dir, f"add_broll_{count:02d}", ["add-video", "--payload-json", json.dumps(payload, ensure_ascii=False)])


def subtitle_keywords(seg: dict[str, Any], plan: dict[str, Any]) -> list[str]:
    keywords: list[str] = []
    for item in seg.get("keywords") or []:
        if isinstance(item, dict):
            word = str(item.get("text") or "").strip()
        else:
            word = str(item or "").strip()
        if word:
            keywords.append(word)
    source_indices = set(seg.get("normalized_from") or [seg.get("source_index")])
    for effect in plan.get("effects_plan", []):
        if effect.get("source_index") in source_indices:
            word = str(effect.get("keyword") or "").strip()
            if word:
                keywords.append(word)
    seen: set[str] = set()
    result: list[str] = []
    for word in sorted(keywords, key=len, reverse=True):
        compact = re.sub(r"[\s，。！？；、,.!?;:：]+", "", word)
        if 2 <= len(compact) <= 8 and compact not in seen:
            seen.add(compact)
            result.append(compact)
    return result[:3]


def subtitle_text_styles(text: str, keywords: list[str]) -> list[dict[str, Any]]:
    ranges: list[tuple[int, int, str]] = []
    occupied: set[int] = set()
    for keyword in keywords:
        start = text.find(keyword)
        if start < 0:
            continue
        end = start + len(keyword)
        if any(pos in occupied for pos in range(start, end)):
            continue
        occupied.update(range(start, end))
        ranges.append((start, end, keyword))
    ranges.sort(key=lambda item: item[0])
    return [
        {
            "start": start,
            "end": end,
            "font": SUBTITLE_FONT,
            "style": {
                "color": SUBTITLE_KEYWORD_COLOR,
                "size": 12,
            },
            "border": {
                "color": SUBTITLE_BORDER_COLOR,
                "width": SUBTITLE_BORDER_WIDTH,
                "alpha": 1.0,
            },
        }
        for start, end, _ in ranges
    ]


def subtitle_intro_sequence(count: int) -> list[dict[str, Any]]:
    if count <= 0:
        return []
    rng = random.Random()
    choice_counts = [count // len(SUBTITLE_INTRO_CHOICES)] * len(SUBTITLE_INTRO_CHOICES)
    for index in rng.sample(range(len(SUBTITLE_INTRO_CHOICES)), count % len(SUBTITLE_INTRO_CHOICES)):
        choice_counts[index] += 1
    sequence: list[dict[str, Any]] = []
    for choice, choice_count in zip(SUBTITLE_INTRO_CHOICES, choice_counts):
        sequence.extend(dict(choice) for _ in range(choice_count))
    rng.shuffle(sequence)
    return sequence


def add_subtitles(api_key: str, run_dir: Path, draft_id: str, timeline: dict[str, Any], plan: dict[str, Any]) -> int:
    subtitle_segments, subtitle_events = normalize_subtitle_segments(
        timeline["segments"],
        int(timeline["target_duration_ms"]),
    )
    write_json(run_dir / "subtitle_segments_normalized.json", subtitle_segments)
    write_json(run_dir / "subtitle_normalization_events.json", subtitle_events)
    intro_sequence = subtitle_intro_sequence(len(subtitle_segments))
    intro_events: list[dict[str, Any]] = []
    rng = random.Random()
    for i, seg in enumerate(subtitle_segments):
        text_styles = subtitle_text_styles(seg["text"], subtitle_keywords(seg, plan))
        intro = intro_sequence[i] if i < len(intro_sequence) else SUBTITLE_INTRO_CHOICES[0]
        font_color = rng.choice(SUBTITLE_FONT_COLORS)
        payload = {
            "draft_id": draft_id,
            "track_name": "manual_subtitle",
            "text": seg["text"],
            "start": seconds(seg["target_start_ms"]),
            "end": seconds(seg["target_end_ms"]),
            "width": 1080,
            "height": 1920,
            "font": SUBTITLE_FONT,
            "font_color": font_color,
            "font_size": 12,
            "font_alpha": 1.0,
            "border_color": SUBTITLE_BORDER_COLOR,
            "border_width": SUBTITLE_BORDER_WIDTH,
            "background_color": "#000000",
            "background_alpha": 0.0,
            "shadow_enabled": True,
            "shadow_color": SUBTITLE_BORDER_COLOR,
            "shadow_alpha": 0.45,
            "shadow_smoothing": 0.06,
            "shadow_distance": 8,
            "letter_spacing": 0,
            "transform_x_px": 0,
            "transform_y_px": SUBTITLE_Y_PX,
            "align": 1,
            "intro_animation": intro["intro_animation"],
            "intro_duration": intro["intro_duration"],
            "fixed_width": 0.65,
            "relative_index": 10020 + i,
        }
        intro_events.append(
            {
                "index": i,
                "text": seg["text"],
                "start_ms": int(seg["target_start_ms"]),
                "end_ms": int(seg["target_end_ms"]),
                "label": intro["label"],
                "intro_animation": intro["intro_animation"],
                "intro_duration": intro["intro_duration"],
                "font_color": font_color,
            }
        )
        if text_styles:
            payload["text_styles"] = text_styles
        skill(api_key, run_dir, f"add_subtitle_{i:02d}", ["add-text", "--payload-json", json.dumps(payload, ensure_ascii=False)])
    write_json(run_dir / "subtitle_intro_animations.json", intro_events)
    return len(subtitle_segments)


def add_effects(api_key: str, run_dir: Path, draft_id: str, plan: dict[str, Any], total_duration_ms: int) -> None:
    sound_count = 0
    template_count = 0
    sticker_count = 0
    zoom_count = 0
    for effect in plan.get("effects_plan", []):
        effect_type = effect.get("type")
        time_s = float(effect.get("time", 0)) / 1000.0
        if time_s < 0 or time_s >= total_duration_ms / 1000.0:
            continue
        keyword = str(effect.get("keyword") or "重点")[:8]
        if effect_type == "text_template":
            template_count += 1
            payload = {
                "draft_id": draft_id,
                "template_id": TEXT_TEMPLATE_ID,
                "texts": [keyword],
                "start": time_s,
                "end": min(time_s + 1.6, total_duration_ms / 1000.0),
                "track_name": "selling_text_template",
                "transform_x_px": 0,
                "transform_y_px": 230,
                "width": 1080,
                "height": 1920,
                "relative_index": 10200 + template_count,
            }
            skill(api_key, run_dir, f"add_text_template_{template_count:02d}", ["add-text-template", "--payload-json", json.dumps(payload, ensure_ascii=False)], check=False)
        elif effect_type == "sticker" and sticker_count < 1:
            sticker_count += 1
            search = skill(
                api_key,
                run_dir,
                f"search_sticker_{sticker_count:02d}",
                ["search-sticker", "--payload-json", json.dumps({"keywords": keyword, "count": 3, "offset": 0}, ensure_ascii=False)],
                check=False,
            )
            sticker_id = recursive_find(search, ("sticker_id",))
            if sticker_id:
                payload = {
                    "draft_id": draft_id,
                    "sticker_id": sticker_id,
                    "start": time_s,
                    "end": min(time_s + 1.3, total_duration_ms / 1000.0),
                    "track_name": "selling_sticker",
                    "relative_index": 10300 + sticker_count,
                    "width": 1080,
                    "height": 1920,
                    "transform_x_px": 0,
                    "transform_y_px": 230,
                    "scale_x": 0.9,
                    "scale_y": 0.9,
                    "rotation": 0,
                    "alpha": 1.0,
                }
                skill(api_key, run_dir, f"add_sticker_{sticker_count:02d}", ["add-sticker", "--payload-json", json.dumps(payload, ensure_ascii=False)], check=False)
        elif effect_type == "sound_effect":
            sound_count += 1
            payload = {
                "draft_id": draft_id,
                "preset_id": PRESET_IDS[(sound_count - 1) % len(PRESET_IDS)],
                "start": 0,
                "target_start": time_s,
                "track_name": "preset_tone",
                "relative_index": 10400 + sound_count,
            }
            skill(api_key, run_dir, f"add_preset_{sound_count:02d}", ["add-preset", "--payload-json", json.dumps(payload, ensure_ascii=False)], check=False)
        elif effect_type == "zoom":
            zoom_count += 1
            duration_s = min(2.0, max(0.8, float(effect.get("duration", 1600)) / 1000.0))
            start = time_s
            end = min(time_s + duration_s, total_duration_ms / 1000.0 - 0.02)
            if end <= start:
                continue
            payload = {
                "draft_id": draft_id,
                "track_name": "talking_head_clip",
                "property_types": ["scale_x", "scale_y", "scale_x", "scale_y", "scale_x", "scale_y", "scale_x", "scale_y"],
                "times": [round(start - 0.01, 3), round(start - 0.01, 3), round(start, 3), round(start, 3), round(end, 3), round(end, 3), round(end + 0.01, 3), round(end + 0.01, 3)],
                "values": [1, 1, 1.2, 1.2, 1.2, 1.2, 1, 1],
            }
            skill(api_key, run_dir, f"add_zoom_{zoom_count:02d}", ["add-keyframe", "--payload-json", json.dumps(payload, ensure_ascii=False)], check=False)


def add_audio(api_key: str, run_dir: Path, draft_id: str, audio_url: str, host_duration: float, timeline: dict[str, Any]) -> None:
    bgm_url = BGM_URLS[2]
    try:
        bgm_duration = media_duration(api_key, run_dir, "duration_bgm", bgm_url)
        bgm_payload = {
            "draft_id": draft_id,
            "audio_url": bgm_url,
            "start": 0.0,
            "end": min(bgm_duration, timeline["target_duration_ms"] / 1000.0),
            "duration": bgm_duration,
            "target_start": 0.0,
            "track_name": "bgm_audio",
            "volume": 3,
            "speed": 1.0,
            "width": 1080,
            "height": 1920,
        }
        skill(api_key, run_dir, "add_bgm", ["add-audio", "--payload-json", json.dumps(bgm_payload, ensure_ascii=False)], check=False)
    except Exception as exc:
        log(f"BGM 添加失败，已跳过：{exc}")
    for chunk in timeline["chunks"]:
        payload = {
            "draft_id": draft_id,
            "audio_url": audio_url,
            "start": seconds(chunk["source_start_ms"]),
            "end": seconds(chunk["source_end_ms"]),
            "duration": host_duration,
            "target_start": seconds(chunk["target_start_ms"]),
            "track_name": "speech_audio",
            "volume": 20,
            "speed": 1.0,
            "width": 1080,
            "height": 1920,
        }
        skill(api_key, run_dir, f"add_speech_audio_{chunk['chunk_index']:02d}", ["add-audio", "--payload-json", json.dumps(payload, ensure_ascii=False)])


def query_draft(api_key: str, run_dir: Path, draft_id: str) -> dict[str, Any]:
    output_path = run_dir / "final_query.json"
    cmd = [sys.executable, str(QUERY), "--api-key", api_key, "--draft-id", draft_id, "--output", str(output_path)]
    run_command(cmd, output_path=output_path, check=True)
    return read_json(output_path)


def summarize_query(query: dict[str, Any]) -> dict[str, Any]:
    script = query.get("script")
    if isinstance(script, str):
        script = json.loads(script)
    tracks = script.get("tracks", []) if isinstance(script, dict) else []
    by_name = {}
    for track in tracks:
        by_name[track.get("name") or track.get("track_name") or track.get("type") or ""] = len(track.get("segments") or [])
    return {
        "duration_us": script.get("duration") if isinstance(script, dict) else None,
        "tracks": by_name,
        "has_smart_subtitle": bool(re.search("generate_smart_subtitle", json.dumps(script, ensure_ascii=False), re.I)) if script else False,
        "subtitle_recognition_id": (script.get("config") or {}).get("subtitle_recognition_id") if isinstance(script, dict) else None,
    }


def require_api_key(value: str | None) -> str:
    if value:
        return value
    env_value = os.environ.get("VECTCUT_API_KEY")
    if env_value:
        return env_value
    return getpass.getpass("VectCut API Key: ").strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a VectCut Jianying draft for the happy pink image-preset talking-head template.")
    parser.add_argument("--api-key", help="VectCut API key for this run. If omitted, reads VECTCUT_API_KEY or prompts.")
    parser.add_argument("--talking-head-url", required=True, help="Public URL of the talking-head video.")
    parser.add_argument("--material-url", action="append", default=[], help="Optional public image or video material URL. Repeat up to 50 times.")
    parser.add_argument("--topic", default="口播视频")
    parser.add_argument("--output-root", default=str(ROOT / "artifacts" / "koubo_happy_pink_image_preset_runs"))
    parser.add_argument("--max-wait", type=int, default=1200, help="Max wait seconds for async VectCut tasks.")
    parser.add_argument("--asr-effect-mode", default="llm_vad", choices=("llm_vad", "llm"), help="VectCut ASR effect_mode.")
    parser.add_argument("--keep-original-duration", action="store_true", help="Keep pauses and trailing silence instead of compacting the timeline.")
    parser.add_argument("--image-analysis-json", help="Optional JSON file produced by local Codex/image analysis. It can be a list, {'images': [...]}, or keyed by index/url.")
    parser.add_argument("--effect-json", help="Optional unified local Codex effect plan. Each effect chooses image preset, material video PIP, or image PIP.")
    parser.add_argument("--image-effect-json", help="Deprecated alias for --effect-json.")
    parser.add_argument("--preset-match-json", help="Optional JSON file produced by local Codex/preset matcher. It can be a list or {'matches': [...]}.")
    parser.add_argument("--image-pip-json", help="Optional JSON file produced by local Codex/image PIP planner. It can be a list or {'effects': [...]}.")
    parser.add_argument("--video-pip-match-json", help="Optional JSON file produced by local Codex/material video PIP matcher. It can be a list or {'effects': [...]}.")
    parser.add_argument("--video-preset-match-json", help="Deprecated alias for --video-pip-match-json.")
    parser.add_argument("--draft-title-json", help="Optional local Codex title JSON. It can be {'title': '...'} or {'draft_title_base': '...'}; timestamp is appended automatically.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api_key = require_api_key(args.api_key)
    if not api_key:
        raise SystemExit("Missing API key.")
    material_urls = args.material_url or DEFAULT_MATERIAL_URLS
    if len(material_urls) > 50:
        raise SystemExit("Need 0-50 material URLs.")
    material_types = [material_kind(url) for url in material_urls]
    image_materials = [(i + 1, url, kind) for i, (url, kind) in enumerate(zip(material_urls, material_types)) if kind == "image"]
    video_materials = [(i + 1, url, kind) for i, (url, kind) in enumerate(zip(material_urls, material_types)) if kind == "video"]
    image_urls = [url for _, url, _ in image_materials]
    video_global_indices = [index for index, _, _ in video_materials]
    video_urls = [url for _, url, _ in video_materials]
    run_dir = Path(args.output_root) / datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    log(f"运行目录：{run_dir}")
    write_json(
        run_dir / "material_classification.json",
        [
            {"index": i + 1, "url": url, "material_type": kind}
            for i, (url, kind) in enumerate(zip(material_urls, material_types))
        ],
    )

    log("查询视频时长")
    host_duration = media_duration(api_key, run_dir, "duration_talking_head", args.talking_head_url)
    video_durations = [
        media_duration(api_key, run_dir, f"duration_material_video_{i:02d}", url)
        for i, url in enumerate(video_urls, start=1)
    ]
    video_analyses: list[dict[str, Any]] = []
    if video_urls:
        log(f"调用 VectCut 视频分析接口理解视频素材：{len(video_urls)} 条")
        for i, (url, duration) in enumerate(zip(video_urls, video_durations), start=1):
            video_analyses.append(analyze_video_material(api_key, run_dir, i, url, duration, args.max_wait))
        write_json(run_dir / "video_material_analyses.json", video_analyses)

    log(f"提取口播音频并做 {args.asr_effect_mode} ASR")
    audio_data = skill(api_key, run_dir, "extract_audio", ["extract-audio", "--video-url", args.talking_head_url])
    audio_url = extract_public_url(audio_data)
    asr_data = skill_wait(
        api_key,
        run_dir,
        "asr",
        ["asr", "submit-and-wait", "--effect-mode", args.asr_effect_mode, "--url", audio_url],
        max_wait=args.max_wait,
    )
    extract_segments(asr_data)

    log("生成统一去气口时间轴")
    timeline = run_timeline(run_dir / "asr.json", host_duration, run_dir / "timeline.json", keep_original_duration=args.keep_original_duration)

    precomputed_image_analyses = read_json(Path(args.image_analysis_json)) if args.image_analysis_json else None
    log(f"本地理解图片素材：{len(image_urls)} 条；视频素材：{len(video_urls)} 条" if material_urls else "未传素材，将只生成口播字幕模板")
    image_analyses: list[dict[str, Any]] = []
    for i, url in enumerate(image_urls):
        image_analyses.append(analyze_image_locally(api_key, run_dir, i + 1, url, args.max_wait, precomputed=precomputed_image_analyses))
    image_dimensions = {
        i + 1: dims
        for i, (url, analysis) in enumerate(zip(image_urls, image_analyses))
        if (dims := probe_image_dimensions(run_dir, i + 1, url, analysis))
    }
    write_json(
        run_dir / "image_dimensions.json",
        [
            {"image_index": index, "width": dims[0], "height": dims[1]}
            for index, dims in sorted(image_dimensions.items())
        ],
    )

    log("生成口播主线计划")
    precomputed_draft_title = read_json(Path(args.draft_title_json)) if args.draft_title_json else None
    draft_title_base = generate_draft_title_base(run_dir, timeline, args.topic, precomputed=precomputed_draft_title)
    plan = fallback_plan(timeline, [])
    plan["draft_title_base"] = draft_title_base
    plan = repair_plan(plan, timeline, [])
    write_json(run_dir / "plan.json", plan)
    plan_stats = validate_plan(plan, timeline, [])

    preset_matches: list[dict[str, Any]] = []
    material_video_pip_matches: list[dict[str, Any]] = []
    image_pip_effects: list[dict[str, Any]] = []
    occupied_intervals: list[tuple[int, int]] = []
    effect_json_path = args.effect_json or args.image_effect_json
    precomputed_image_effects = read_json(Path(effect_json_path)) if effect_json_path else None
    if image_analyses:
        log("本地匹配图片素材与口播句子")
        match_input = build_preset_match_input(timeline, image_analyses, args.topic)
        raw_pip_effects: list[dict[str, Any]] = []
        if precomputed_image_effects is not None:
            raw_matches, raw_pip_effects = parse_image_effect_plan(precomputed_image_effects)
            for match in raw_matches:
                match.setdefault("match_source", "codex_precomputed_effect_plan")
            for effect in raw_pip_effects:
                effect.setdefault("match_source", "codex_precomputed_effect_plan")
            write_json(run_dir / "image_effect_plan_raw.json", {"preset_matches": raw_matches, "pip_effects": raw_pip_effects})
        else:
            precomputed_preset_matches = read_json(Path(args.preset_match_json)) if args.preset_match_json else None
            raw_matches = run_preset_match_locally(run_dir, match_input, precomputed=precomputed_preset_matches)
        preset_matches = validate_preset_matches(raw_matches, timeline, image_urls, host_duration)
        write_json(run_dir / "preset_matches.json", preset_matches)
        preset_used_images = {int(match["image_index"]) for match in preset_matches}
        occupied_intervals.extend(preset_blocked_intervals(preset_matches))
    else:
        preset_used_images = set()
        raw_pip_effects = []

    if video_urls:
        log("本地匹配视频素材与口播句子")
        video_match_input = build_video_preset_match_input(timeline, video_urls, video_durations, video_analyses, args.topic, global_indices=video_global_indices)
        video_pip_json_path = args.video_pip_match_json or args.video_preset_match_json
        precomputed_video_pip_matches = read_json(Path(video_pip_json_path)) if video_pip_json_path else None
        raw_video_matches = (
            parse_video_effect_plan(precomputed_image_effects)
            if precomputed_image_effects is not None
            else run_video_preset_match_locally(run_dir, video_match_input, occupied=occupied_intervals, precomputed=precomputed_video_pip_matches)
        )
        material_video_pip_matches = validate_material_video_preset_matches(
            raw_video_matches,
            timeline,
            video_urls,
            video_durations,
            host_duration,
            occupied_intervals=occupied_intervals,
            global_indices=video_global_indices,
        )
        write_json(run_dir / "material_video_pip_matches.json", material_video_pip_matches)
        occupied_intervals.extend(fixed_effect_intervals(material_video_pip_matches))

    write_json(run_dir / "effect_blocked_intervals.json", [{"start_ms": start, "end_ms": end} for start, end in occupied_intervals])
    if image_analyses:
        if precomputed_image_effects is None:
            precomputed_pip_effects = read_json(Path(args.image_pip_json)) if args.image_pip_json else None
            raw_pip_effects = run_image_pip_locally(run_dir, match_input, preset_used_images, precomputed=precomputed_pip_effects)
        image_pip_effects = validate_image_pip_effects(
            raw_pip_effects,
            timeline,
            image_urls,
            preset_used_images,
            blocked_intervals=occupied_intervals,
            image_dimensions=image_dimensions,
        )
        write_json(run_dir / "image_pip_effects.json", image_pip_effects)

    log("创建并写入剪映草稿")
    draft_id, draft_url, draft_name = create_draft(api_key, run_dir, plan.get("draft_title_base") or "口播去气口视频")
    material_video_pip_intervals = fixed_effect_intervals(material_video_pip_matches)
    add_talking_head(api_key, run_dir, draft_id, args.talking_head_url, host_duration, timeline, exclude_intervals=material_video_pip_intervals)
    preset_report = add_image_video_presets(api_key, run_dir, draft_id, args.talking_head_url, preset_matches, args.max_wait) if preset_matches else {"requested": 0, "success_count": 0, "writes": []}
    material_video_pip_report = add_material_video_pip_effects(api_key, run_dir, draft_id, args.talking_head_url, host_duration, material_video_pip_matches, args.max_wait) if material_video_pip_matches else {"requested": 0, "success_count": 0, "writes": []}
    image_pip_report = add_image_pip_effects(api_key, run_dir, draft_id, image_pip_effects) if image_pip_effects else {"requested": 0, "success_count": 0, "writes": []}
    subtitle_count = add_subtitles(api_key, run_dir, draft_id, timeline, plan)
    add_audio(api_key, run_dir, draft_id, audio_url, host_duration, timeline)

    log("查询最终草稿结构")
    final_query = query_draft(api_key, run_dir, draft_id)
    query_summary = summarize_query(final_query)
    summary = {
        "draft_id": draft_id,
        "draft_url": draft_url,
        "draft_name": draft_name,
        "run_dir": str(run_dir),
        "asr_effect_mode": args.asr_effect_mode,
        "keep_original_duration": args.keep_original_duration,
        "target_duration_ms": timeline["target_duration_ms"],
        "removed_duration_ms": timeline["removed_duration_ms"],
        "talking_head_chunks": len(timeline["chunks"]),
        "speech_audio_chunks": len(timeline["chunks"]),
        "subtitle_count": subtitle_count,
        "original_subtitle_count": len(timeline["segments"]),
        "broll_count": plan_stats["broll_count"],
        "material_video_count": len(video_urls),
        "material_video_analysis_task_ids": [item.get("task_id") for item in video_analyses],
        "material_image_count": len(image_urls),
        "material_image_analysis_sources": [item.get("analysis_source", "") for item in image_analyses],
        "material_image_llm_task_ids": [item.get("vectcut_llm_task_id", "") for item in image_analyses if item.get("vectcut_llm_task_id")],
        "preset_match_count": len(preset_matches),
        "preset_success_count": preset_report["success_count"],
        "material_video_pip_match_count": len(material_video_pip_matches),
        "material_video_pip_success_count": material_video_pip_report["success_count"],
        "image_pip_count": len(image_pip_effects),
        "image_pip_success_count": image_pip_report["success_count"],
        "preset_id": IMAGE_VIDEO_PRESET_ID,
        "material_video_effect": "material_video_background_plus_talking_head_pip",
        "talking_head_ratio": round(plan_stats["talking_head_ratio"], 4),
        "query_summary": query_summary,
    }
    write_json(run_dir / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
