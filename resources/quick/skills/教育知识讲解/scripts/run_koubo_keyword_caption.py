#!/usr/bin/env python3
"""One-command runner for a debreathed talking-head draft with keyword captions.

The script intentionally does not store an API key. Pass it with --api-key,
set VECTCUT_API_KEY for this run, or type it when prompted.
"""

from __future__ import annotations

import argparse
import getpass
import json
import mimetypes
import os
import random
import re
import shlex
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


SKILL_DIR = Path(__file__).resolve().parents[1]
ROOT = Path.cwd()
HUNJIAN = SKILL_DIR / "scripts" / "hunjian_task.py"
TIMELINE = SKILL_DIR / "scripts" / "timeline.py"
QUERY = SKILL_DIR / "scripts" / "query_script.py"

DEFAULT_TALKING_HEAD_URL = (
    "http://player.install-ai-guider.top/files/69b3b9368c13f302ca261ea8/"
    "upload_bb1ac4d2cf174f87af3a928dbce3408c.mp4?OSSAccessKeyId=LTAI5t8QxFyxBtk3ApZgrQfZ"
    "&Expires=1786277324&Signature=W5MFRMgL8DzunIY02K9BS8YdOOo%3D"
)
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
SUBTITLE_FONT = "江户招牌"
SUBTITLE_FONT_COLOR = "#FFFFFF"
SUBTITLE_KEYWORD_COLOR = "#ffdd00"
SUBTITLE_BORDER_COLOR = "#3488F3"
SUBTITLE_BORDER_WIDTH = 30
SUBTITLE_Y_PX = -900
TITLE_FONT = "优设标题黑"
TITLE_FONT_COLOR = "#FFFFFF"
TITLE_BORDER_COLOR = "#3488F3"
TITLE_BACKGROUND_COLOR = "#ffdd00"
TITLE_DURATION_SECONDS = 3.0
PARALLEL_TEXT_PRESET_ID = "3ca1d5d3-0a76-438a-946d-64805a1f5772"
PARALLEL_STARTERS = set("用给做让先再看选学懂讲把守留放练记抓")
SUBTITLE_INTRO_CHOICES = [
    {"label": "none", "intro_animation": "", "intro_duration": 0.0},
    {"label": "fade", "intro_animation": "渐显", "intro_duration": 0.35},
    {"label": "typewriter_iii", "intro_animation": "打字机_III", "intro_duration": 0.45},
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

PLAN_PROMPT = f"""
你是口播视频剪辑导演。根据主播口播 ASR 句子时间轴、主播口播素材信息、可选补充素材理解结果，生成 1 套竖屏剪映草稿分镜计划。

只返回 JSON 对象，不要 Markdown，不要解释。计划必须放在 plans 数组中，且只能有 1 套，计划名后缀为 _1。

硬规则：
1. 所有 start/end 使用毫秒，必须从 0 完整覆盖到 total_duration_ms；第一段 start=0，后一段 start 等于前一段 end，最后一段 end=total_duration_ms，不能空洞、负时长或重叠。
2. 第一段和最后一段必须使用 material_role=talking_head 的主播口播视频。没有补充素材时，全片只能返回 1 段 talking_head，覆盖完整时间轴。
3. 如果有补充素材，只有在素材画面和当前口播文案语义强相关时才穿插；素材不匹配时回到 talking_head。返回 stats.talking_head_duration_ms、stats.broll_duration_ms、stats.talking_head_ratio。
4. 每段只能使用真实素材 index。talking_head 固定 index=0；补充素材 index 从 1 开始。B-roll 必须和 covered_caption_text 强相关，search 必须是素材中能定位的具体画面。
5. 非 talking_head 素材必须遵守时长：视频素材每段 1000 到 3000 毫秒，图片素材每段 1000 到 2000 毫秒。同一个补充素材 index 或 URL 在全片最多出现 1 次；不要重复使用同一条 B-roll。
6. 每个 append_materials 分镜段必须包含 start、end、material_role、covered_caption_text、narrative_stage、search_materials。search_materials 每项包含 index、search、role、match_reason。narrative_stage 只能是 hook、pain、interest、feature、proof、demo、contrast、offer、trust、cta 或 transition_back。
7. 除最后一项外，每项可以包含 transition，transition.name 只能是“翻页”或“左移”，transition.duration 建议 0.2。
8. effects_plan 默认返回空数组。发现排比/对仗短语时，才返回 type=parallel_preset；不要规划 text_template、flower_text、sticker、sound_effect、scene_effect。关键词高亮由执行阶段在字幕 add_text 的 text_styles 内完成，不要新增关键词文字层。
9. parallel_preset 专门处理口播中的排比短语，例如“用对立、给空间、做榜样”这类有节奏的 3 到 4 字短语。每个 text1 必须是当前 ASR 句子中连续出现的原文，最少 3 字、最多 4 字，全片最多 4 个且不能重复；只返回 source_index 和 text1，不要估算时间，脚本会按 ASR 词级边界计算 target_start/target_end。
10. 固定 use_smart_subtitle=false、subtitle_mode=manual_subtitle。字幕按 ASR 时间轴逐条 add_text 写入 manual_subtitle，fixed_width=0.65，位置字段使用 transform_x_px/transform_y_px。被 parallel_preset 接管的 text1 不要重复放进普通字幕；若 text1 位于较长 ASR 句子中间，脚本会拆出前后普通字幕。
11. 轨道固定复用：B-roll 用 selling_broll_clip，字幕用 manual_subtitle，排比预设统一用 parallel_text_preset。不要规划多条同类轨道。
12. plans[0] 必须包含 draft_title_base，建议 6 到 18 个中文字符，不含时间戳、斜杠、换行、引号或文件名非法字符。
13. plans[0] 必须返回 title_lines 对象，包含 line1 和 line2。line1 为 4 到 6 个字，line2 为 6 到 8 个字；标题概括当前口播主题，不要标点、英文、空格或空泛口号。
14. 标题只展示前 3 秒，执行阶段使用 selling_title_top 和 selling_title_bottom 两个文字轨道，不能把标题混入 manual_subtitle。
""".strip()


def log(message: str) -> None:
    print(f"[koubo-keyword-caption] {message}", flush=True)


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


def run_timeline(asr_path: Path, source_duration: float, output_path: Path) -> dict[str, Any]:
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
    _, _, _, parsed = run_command(cmd, output_path=output_path, check=True)
    return parsed or read_json(output_path)


def build_material_analysis(video_detail: Any) -> str:
    detail = recursive_find(video_detail, ("video_detail", "analysis", "content", "text"))
    if isinstance(detail, str) and detail.strip():
        return detail.strip()
    return json.dumps(video_detail, ensure_ascii=False)[:4000]


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


def local_image_analysis(url: str, run_dir: Path, index: int) -> str:
    """Analyze an image without sending it to the remote LLM/video-detail APIs.

    If LOCAL_IMAGE_ANALYZER_CMD is set, it is treated as a local vision-model
    command and the material URL/path is appended as the last argument.
    """
    cmd_template = os.environ.get("LOCAL_IMAGE_ANALYZER_CMD", "").strip()
    if cmd_template:
        try:
            cmd = shlex.split(cmd_template) + [url]
            proc = subprocess.run(cmd, text=True, capture_output=True, timeout=180)
            result = {
                "cmd": cmd_template,
                "returncode": proc.returncode,
                "stdout": proc.stdout.strip(),
                "stderr": proc.stderr.strip(),
            }
            write_json(run_dir / f"image_detail_material_{index}.json", result)
            if proc.returncode == 0 and proc.stdout.strip():
                return proc.stdout.strip()[:4000]
            log(f"图片素材 {index} 本地模型理解失败，使用元信息兜底：{proc.stderr.strip() or proc.stdout.strip()}")
        except Exception as exc:
            write_json(run_dir / f"image_detail_material_{index}.json", {"error": str(exc), "url": url})
            log(f"图片素材 {index} 本地模型理解异常，使用元信息兜底：{exc}")

    parsed = urlparse(url)
    filename = unquote(Path(parsed.path or url).name) or f"image_{index}"
    local_path = Path(url).expanduser() if parsed.scheme in ("", "file") else None
    metadata: dict[str, Any] = {"url": url, "filename": filename, "material_type": "image"}
    if local_path and parsed.scheme == "file":
        local_path = Path(unquote(parsed.path)).expanduser()
    if local_path and local_path.exists():
        metadata["local_path"] = str(local_path)
        try:
            from PIL import Image

            with Image.open(local_path) as image:
                metadata["width"], metadata["height"] = image.size
                metadata["mode"] = image.mode
        except Exception as exc:
            metadata["image_probe_error"] = str(exc)
    write_json(run_dir / f"image_detail_material_{index}.json", metadata)
    size_text = ""
    if metadata.get("width") and metadata.get("height"):
        size_text = f"，尺寸 {metadata['width']}x{metadata['height']}"
    return f"图片素材：{filename}{size_text}。这是静态图片素材，适合在文案强相关的位置短暂展示 1 到 2 秒；按文件名、主题和用户文案进行匹配。"


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
            "base_color": SUBTITLE_FONT_COLOR,
            "keyword_color": SUBTITLE_KEYWORD_COLOR,
            "border_color": SUBTITLE_BORDER_COLOR,
            "border_width": SUBTITLE_BORDER_WIDTH,
            "keyword_style_method": "add_text.text_styles",
        },
    }


def run_plan_llm(api_key: str, run_dir: Path, plan_input: dict[str, Any], max_wait: int) -> dict[str, Any]:
    prompt_path = run_dir / "plan_prompt.txt"
    input_path = run_dir / "plan_input.json"
    prompt_path.write_text(PLAN_PROMPT, encoding="utf-8")
    write_json(input_path, plan_input)
    raw = skill_wait(
        api_key,
        run_dir,
        "llm_plan_raw",
        [
            "llm",
            "submit-and-wait",
            "--system-prompt",
            PLAN_PROMPT,
            "--user-input",
            json.dumps(plan_input, ensure_ascii=False),
            "--model",
            "qwen3.7-plus",
            "--response-format",
            "json",
        ],
        max_wait=max_wait,
    )
    plan_text = first_json_string(raw)
    if not plan_text:
        raise RuntimeError("LLM response did not contain a JSON plan")
    plan_obj = json.loads(plan_text)
    plan = normalize_plan(plan_obj["plans"][0])
    write_json(run_dir / "plan.json", plan)
    return plan


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
    if isinstance(plan.get("parallel_phrases"), list):
        plan["effects_plan"].extend(
            {"type": "parallel_preset", "source_index": item.get("source_index"), "text1": item.get("text1") or item.get("text")}
            for item in plan["parallel_phrases"]
            if isinstance(item, dict)
        )
    plan["title_lines"] = normalize_title_lines(plan)
    return plan


def _title_text(value: Any) -> str:
    text = str(value or "")
    return re.sub(r'[\s，。！？；、,.!?;:："“”‘’]+', "", text).strip()


def _title_line(value: Any, minimum: int, maximum: int, fallback: str) -> str:
    text = _title_text(value)
    if len(text) < minimum:
        text = _title_text(fallback)
    return text[:maximum]


def normalize_title_lines(plan: dict[str, Any]) -> dict[str, str]:
    raw = plan.get("title_lines") or plan.get("title") or {}
    if isinstance(raw, dict):
        line1 = raw.get("line1") or raw.get("top_title") or raw.get("top")
        line2 = raw.get("line2") or raw.get("bottom_title") or raw.get("bottom")
    elif isinstance(raw, list):
        line1 = raw[0] if raw else ""
        line2 = raw[1] if len(raw) > 1 else ""
    elif isinstance(raw, str):
        parts = [part for part in re.split(r"[\\n|/]+", raw) if part.strip()]
        line1 = parts[0] if parts else ""
        line2 = parts[1] if len(parts) > 1 else ""
    else:
        line1 = line2 = ""
    draft_title = _title_text(plan.get("draft_title_base"))
    line1 = _title_line(line1, 4, 6, draft_title[:6] or "重点卖点")
    line2 = _title_line(line2, 6, 8, draft_title[6:14] or "核心优势分享")
    if len(line1) < 4:
        line1 = "重点卖点"
    if len(line2) < 6:
        line2 = "核心优势分享"
    return {"line1": line1, "line2": line2}


def fallback_parallel_effects(timeline: dict[str, Any]) -> list[dict[str, Any]]:
    """Find consecutive ASR short phrases when the planner omits them."""
    candidates = []
    for segment in timeline.get("segments") or []:
        text = _title_text(segment.get("text"))
        if 3 <= len(text) <= 4 and text[:1] in PARALLEL_STARTERS:
            candidates.append(segment)
        else:
            candidates.append(None)
    effects: list[dict[str, Any]] = []
    run: list[dict[str, Any]] = []
    for segment in candidates + [None]:
        if segment is not None and (not run or int(segment.get("source_index", 0)) == int(run[-1].get("source_index", 0)) + 1):
            run.append(segment)
            continue
        if len(run) >= 2:
            for item in run[:4]:
                effects.append({
                    "type": "parallel_preset",
                    "source_index": int(item["source_index"]),
                    "text1": _title_text(item.get("text")),
                    "reason": "连续的三到四字动词短句，疑似排比表达",
                })
                if len(effects) >= 4:
                    return effects
        run = [segment] if segment is not None else []
    return effects


def repair_parallel_effects(plan: dict[str, Any], timeline: dict[str, Any]) -> None:
    """Keep only original 3-4 character parallel phrases, at most four."""
    captions = {int(seg.get("source_index")): str(seg.get("text") or "") for seg in timeline.get("segments") or []}
    kept: list[dict[str, Any]] = []
    seen: set[str] = set()
    for effect in plan.get("effects_plan") or []:
        if effect.get("type") != "parallel_preset":
            kept.append(effect)
            continue
        if len(seen) >= 4:
            continue
        text1 = _title_text(effect.get("text1") or effect.get("keyword"))
        try:
            source_index = int(effect.get("source_index"))
        except (TypeError, ValueError):
            continue
        if not 3 <= len(text1) <= 4 or text1 in seen or text1 not in captions.get(source_index, ""):
            continue
        seen.add(text1)
        kept.append({**effect, "source_index": source_index, "text1": text1})
    for effect in fallback_parallel_effects(timeline):
        if len(seen) >= 4:
            break
        text1 = str(effect["text1"])
        if text1 in seen:
            continue
        seen.add(text1)
        kept.append(effect)
    plan["effects_plan"] = kept


def repair_plan(plan: dict[str, Any], timeline: dict[str, Any], material_types: list[str] | None = None) -> dict[str, Any]:
    """Clamp B-roll durations while preserving a continuous timeline.

    LLM plans occasionally drift past the 3s B-roll cap. When that happens,
    give the extra time back to the immediately following talking-head segment.
    This keeps semantic ordering intact and avoids repeating B-roll materials.
    """
    plan = normalize_plan(plan)
    repair_parallel_effects(plan, timeline)
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
                "material_role": "image_scene" if material_kind_name == "image" else role_by_index.get(idx, "usage_scene"),
                "covered_caption_text": text_all,
                "narrative_stage": stage_by_index.get(idx, "proof"),
                "search_materials": [
                    {
                        "index": idx,
                        "search": "图片素材中的产品或场景主体" if material_kind_name == "image" else search_by_index.get(idx, "贴膜施工服务现场"),
                        "role": "image_scene" if material_kind_name == "image" else role_by_index.get(idx, "usage_scene"),
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
    return clean or "口播去气口视频"


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


def source_window(timestamp: float | None, source_duration: float, target_duration: float) -> tuple[float, float]:
    target_duration = max(1.5, min(3.0, target_duration))
    if timestamp is None:
        timestamp = source_duration / 2
    start = timestamp - target_duration / 2
    start = max(0.0, min(start, max(0.0, source_duration - target_duration - 0.05)))
    end = min(source_duration - 0.05, start + target_duration)
    if end <= start:
        start = 0.0
        end = min(source_duration, target_duration)
    return round(start, 6), round(end, 6)


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
    draft_name = f"{safe_title(title_base)}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    data = skill(api_key, run_dir, "create_draft", ["create-draft", "--name", draft_name, "--width", "1080", "--height", "1920"])
    draft_id = recursive_find(data, ("draft_id", "draftId"))
    draft_url = recursive_find(data, ("draft_url", "draftUrl"))
    if not draft_id:
        raise RuntimeError("Create draft response did not include draft_id")
    return str(draft_id), str(draft_url) if draft_url else None, draft_name


def add_talking_head(api_key: str, run_dir: Path, draft_id: str, host_url: str, host_duration: float, timeline: dict[str, Any]) -> None:
    for chunk in timeline["chunks"]:
        payload = {
            "draft_id": draft_id,
            "video_url": host_url,
            "start": seconds(chunk["source_start_ms"]),
            "end": seconds(chunk["source_end_ms"]),
            "duration": host_duration,
            "target_start": seconds(chunk["target_start_ms"]),
            "width": 1080,
            "height": 1920,
            "track_name": "talking_head_clip",
            "relative_index": 1,
            "volume": -60,
            "speed": 1.0,
        }
        skill(api_key, run_dir, f"add_talking_head_{chunk['chunk_index']:02d}", ["add-video", "--payload-json", json.dumps(payload, ensure_ascii=False)])


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


def split_subtitle_around_phrase(text: str, phrase: str) -> tuple[str, str, str] | None:
    """Split display text while ignoring ASR-inserted whitespace."""
    raw = str(text or "")
    compact_positions = [index for index, char in enumerate(raw) if not char.isspace()]
    compact = "".join(raw[index] for index in compact_positions)
    target = re.sub(r"\s+", "", str(phrase or ""))
    offset = compact.find(target)
    if offset < 0 or not target:
        return None
    raw_start = compact_positions[offset]
    raw_end = compact_positions[offset + len(target) - 1] + 1
    return raw[:raw_start].strip(), raw[raw_start:raw_end].strip(), raw[raw_end:].strip()


def exclude_parallel_subtitle_text(
    timeline: dict[str, Any],
    plan: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Let each parallel preset own its phrase in the subtitle layer."""
    effects_by_source: dict[int, list[str]] = {}
    for effect in plan.get("effects_plan") or []:
        if effect.get("type") != "parallel_preset":
            continue
        try:
            source_index = int(effect.get("source_index"))
        except (TypeError, ValueError):
            continue
        text1 = _title_text(effect.get("text1") or effect.get("keyword"))
        if text1:
            effects_by_source.setdefault(source_index, []).append(text1)

    result: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    for segment in timeline.get("segments") or []:
        source_index = int(segment.get("source_index", -1))
        phrases = effects_by_source.get(source_index, [])
        if not phrases:
            result.append({**segment})
            continue

        raw_text = str(segment.get("text") or "")
        compact_positions = [index for index, char in enumerate(raw_text) if not char.isspace()]
        compact_text = "".join(raw_text[index] for index in compact_positions)
        occurrences: list[dict[str, Any]] = []
        for phrase in phrases:
            phrase_compact = re.sub(r"\s+", "", phrase)
            compact_start = compact_text.find(phrase_compact)
            source_window = parallel_phrase_source_window(segment, phrase)
            target_window = map_source_window_to_target(*source_window, timeline) if source_window else None
            if compact_start < 0 or not target_window:
                events.append({"type": "parallel_subtitle_exclusion_skipped", "source_index": source_index, "text1": phrase})
                occurrences = []
                break
            occurrences.append({
                "phrase": phrase,
                "compact_start": compact_start,
                "compact_end": compact_start + len(phrase_compact),
                "target_start_ms": int(target_window[0]),
                "target_end_ms": int(target_window[1]),
            })
        if not occurrences:
            result.append({**segment})
            continue

        occurrences.sort(key=lambda item: (item["compact_start"], item["target_start_ms"]))
        text_cursor = 0
        target_cursor = int(segment["target_start_ms"])
        parts: list[dict[str, Any]] = []
        for occurrence in occurrences:
            raw_start = compact_positions[occurrence["compact_start"]]
            raw_end = compact_positions[occurrence["compact_end"] - 1] + 1
            prefix = raw_text[text_cursor:raw_start].strip()
            phrase_start = max(target_cursor, occurrence["target_start_ms"])
            if prefix and phrase_start > target_cursor:
                parts.append({
                    **segment,
                    "text": prefix,
                    "target_start_ms": target_cursor,
                    "target_end_ms": phrase_start,
                    "parallel_excluded": True,
                })
            text_cursor = raw_end
            target_cursor = max(target_cursor, occurrence["target_end_ms"])
            events.append({
                "type": "exclude_parallel_subtitle",
                "source_index": source_index,
                "text1": occurrence["phrase"],
                "target_start_ms": occurrence["target_start_ms"],
                "target_end_ms": occurrence["target_end_ms"],
            })
        suffix = raw_text[text_cursor:].strip()
        if suffix and int(segment["target_end_ms"]) > target_cursor:
            parts.append({
                **segment,
                "text": suffix,
                "target_start_ms": target_cursor,
                "target_end_ms": int(segment["target_end_ms"]),
                "parallel_excluded": True,
            })
        result.extend(parts)
    return result, events


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
    subtitle_source_segments, exclusion_events = exclude_parallel_subtitle_text(timeline, plan)
    subtitle_segments, subtitle_events = normalize_subtitle_segments(
        subtitle_source_segments,
        int(timeline["target_duration_ms"]),
    )
    write_json(run_dir / "subtitle_segments_normalized.json", subtitle_segments)
    write_json(run_dir / "subtitle_normalization_events.json", exclusion_events + subtitle_events)
    intro_sequence = subtitle_intro_sequence(len(subtitle_segments))
    intro_events: list[dict[str, Any]] = []
    for i, seg in enumerate(subtitle_segments):
        text_styles = subtitle_text_styles(seg["text"], subtitle_keywords(seg, plan))
        intro = intro_sequence[i] if i < len(intro_sequence) else SUBTITLE_INTRO_CHOICES[0]
        payload = {
            "draft_id": draft_id,
            "track_name": "manual_subtitle",
            "text": seg["text"],
            "start": seconds(seg["target_start_ms"]),
            "end": seconds(seg["target_end_ms"]),
            "width": 1080,
            "height": 1920,
            "font": SUBTITLE_FONT,
            "font_color": SUBTITLE_FONT_COLOR,
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
            }
        )
        if text_styles:
            payload["text_styles"] = text_styles
        skill(api_key, run_dir, f"add_subtitle_{i:02d}", ["add-text", "--payload-json", json.dumps(payload, ensure_ascii=False)])
    write_json(run_dir / "subtitle_intro_animations.json", intro_events)
    return len(subtitle_segments)


def add_title(api_key: str, run_dir: Path, draft_id: str, plan: dict[str, Any], total_duration_ms: int) -> int:
    """Write the model summary as two independent opening title layers."""
    end = min(TITLE_DURATION_SECONDS, seconds(total_duration_ms))
    lines = normalize_title_lines(plan)
    write_json(run_dir / "title_lines.json", lines)
    common = {
        "draft_id": draft_id,
        "start": 0.0,
        "end": end,
        "width": 1080,
        "height": 1920,
        "font": TITLE_FONT,
        "font_color": TITLE_FONT_COLOR,
        "font_alpha": 1.0,
        "border_color": TITLE_BORDER_COLOR,
        "background_color": TITLE_BACKGROUND_COLOR,
        "background_height": 0.0,
        "background_width": 0.0,
        "shadow_enabled": False,
        "transform_x_px": 0,
        "align": 1,
        "fixed_width": 0.78,
    }
    payloads = [
        {
            **common,
            "track_name": "selling_title_top",
            "text": lines["line1"],
            "font_size": 18,
            "border_width": 23,
            "background_alpha": 0.0,
            "transform_y_px": 1450,
            "relative_index": 10000,
        },
        {
            **common,
            "track_name": "selling_title_bottom",
            "text": lines["line2"],
            "font_size": 15,
            "border_width": 35,
            "background_alpha": 1.0,
            "transform_y_px": 1200,
            "relative_index": 10001,
        },
    ]
    for index, payload in enumerate(payloads, start=1):
        skill(api_key, run_dir, f"add_title_{index:02d}", ["add-text", "--payload-json", json.dumps(payload, ensure_ascii=False)])
    return len(payloads)


def parallel_phrase_source_window(segment: dict[str, Any], text1: str) -> tuple[int, int] | None:
    words = [word for word in segment.get("words") or [] if str(word.get("text") or "")]
    joined = "".join(str(word.get("text") or "") for word in words)
    offset = joined.find(text1)
    if offset < 0:
        return None
    end_offset = offset + len(text1)
    cursor = 0
    selected: list[dict[str, Any]] = []
    for word in words:
        word_text = str(word.get("text") or "")
        next_cursor = cursor + len(word_text)
        if cursor < end_offset and next_cursor > offset:
            selected.append(word)
        cursor = next_cursor
    if not selected:
        return None
    start_ms = int(selected[0].get("start_ms", 0))
    end_ms = int(selected[-1].get("end_ms", start_ms))
    return (start_ms, end_ms) if end_ms > start_ms else None


def map_source_window_to_target(start_ms: int, end_ms: int, timeline: dict[str, Any]) -> tuple[int, int] | None:
    pieces: list[tuple[int, int]] = []
    for chunk in timeline.get("chunks") or []:
        source_start = int(chunk["source_start_ms"])
        source_end = int(chunk["source_end_ms"])
        overlap_start = max(start_ms, source_start)
        overlap_end = min(end_ms, source_end)
        if overlap_end <= overlap_start:
            continue
        target_start = int(chunk["target_start_ms"]) + overlap_start - source_start
        target_end = int(chunk["target_start_ms"]) + overlap_end - source_start
        pieces.append((target_start, target_end))
    if not pieces:
        return None
    return pieces[0][0], pieces[-1][1]


def add_parallel_presets(
    api_key: str,
    run_dir: Path,
    draft_id: str,
    plan: dict[str, Any],
    timeline: dict[str, Any],
) -> int:
    captions = {int(seg.get("source_index")): seg for seg in timeline.get("segments") or []}
    writes: list[dict[str, Any]] = []
    count = 0
    seen: set[str] = set()
    for effect in plan.get("effects_plan") or []:
        if effect.get("type") != "parallel_preset" or count >= 4:
            continue
        text1 = _title_text(effect.get("text1") or effect.get("keyword"))
        try:
            source_index = int(effect.get("source_index"))
        except (TypeError, ValueError):
            writes.append({"effect": effect, "success": False, "error": "invalid source_index"})
            continue
        segment = captions.get(source_index)
        source_window = parallel_phrase_source_window(segment, text1) if segment else None
        target_window = map_source_window_to_target(*source_window, timeline) if source_window else None
        if not 3 <= len(text1) <= 4 or text1 in seen or not target_window:
            writes.append({"effect": effect, "success": False, "error": "phrase is not a valid ASR word-level window"})
            continue
        seen.add(text1)
        target_start_ms, target_end_ms = target_window
        preset_duration_seconds = seconds(target_end_ms - target_start_ms)
        payload = {
            "draft_id": draft_id,
            "preset_id": PARALLEL_TEXT_PRESET_ID,
            "replacements": [{"text1": text1}],
            "start": 0.0,
            "end": preset_duration_seconds,
            "target_start": seconds(target_start_ms),
            "target_end": seconds(target_end_ms),
            "track_name": "parallel_text_preset",
            "relative_index": 10500 + count,
            "width": 1080,
            "height": 1920,
            "transform_x": 0,
            "transform_y": 0,
            "rotation": 0,
            "scale_x": 1.0,
            "scale_y": 1.0,
        }
        result = skill(
            api_key,
            run_dir,
            f"add_parallel_preset_{count + 1:02d}",
            ["add-preset", "--payload-json", json.dumps(payload, ensure_ascii=False)],
            check=True,
        )
        ok = isinstance(result, dict) and result.get("success") is True
        writes.append({"text1": text1, "source_index": source_index, "target_start_ms": target_start_ms, "target_end_ms": target_end_ms, "payload": payload, "success": ok, "response": result})
        if not ok:
            raise RuntimeError(f"parallel preset request did not succeed for {text1}")
        count += 1
    write_json(run_dir / "parallel_preset_writes.json", {"requested": len([e for e in plan.get("effects_plan") or [] if e.get("type") == "parallel_preset"]), "success_count": count, "writes": writes})
    return count


def add_effects(
    api_key: str,
    run_dir: Path,
    draft_id: str,
    plan: dict[str, Any],
    total_duration_ms: int,
    timeline: dict[str, Any],
) -> int:
    parallel_count = add_parallel_presets(api_key, run_dir, draft_id, plan, timeline)
    sound_count = 0
    template_count = 0
    sticker_count = 0
    zoom_count = 0
    for effect in plan.get("effects_plan", []):
        effect_type = effect.get("type")
        if effect_type == "parallel_preset":
            continue
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
    return parallel_count


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
    parser = argparse.ArgumentParser(description="Create a VectCut Jianying draft for a debreathed talking-head video with keyword captions.")
    parser.add_argument("--api-key", help="VectCut API key for this run. If omitted, reads VECTCUT_API_KEY or prompts.")
    parser.add_argument("--talking-head-url", default=DEFAULT_TALKING_HEAD_URL, help="Public URL of the talking-head video.")
    parser.add_argument("--material-url", action="append", default=[], help="Optional public B-roll material URL. Repeat up to 50 times.")
    parser.add_argument("--topic", default="口播视频")
    parser.add_argument("--output-root", default=str(ROOT / "artifacts" / "koubo_keyword_caption_runs"))
    parser.add_argument("--max-wait", type=int, default=1200, help="Max wait seconds for async VectCut tasks.")
    parser.add_argument("--asr-effect-mode", default="llm_vad", choices=("llm_vad", "llm"), help="VectCut ASR effect_mode.")
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
    run_dir = Path(args.output_root) / datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    log(f"运行目录：{run_dir}")

    log("查询视频时长")
    host_duration = media_duration(api_key, run_dir, "duration_talking_head", args.talking_head_url)
    material_durations = [
        media_duration(api_key, run_dir, f"duration_material_{i + 1}", url) if material_types[i] == "video" else 0.0
        for i, url in enumerate(material_urls)
    ]
    if sum(duration for duration, kind in zip(material_durations, material_types) if kind == "video") > 20 * 60:
        raise SystemExit("Material total duration exceeds 20 minutes.")

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
    timeline = run_timeline(run_dir / "asr.json", host_duration, run_dir / "timeline.json")

    if material_urls:
        log(f"理解穿插素材：视频 {material_types.count('video')} 条，图片 {material_types.count('image')} 条")
    else:
        log("未传补充素材，将全程展示口播视频")
    material_analyses = []
    for i, url in enumerate(material_urls):
        if material_types[i] == "image":
            material_analyses.append(local_image_analysis(url, run_dir, i + 1))
        else:
            detail = skill_wait(
                api_key,
                run_dir,
                f"video_detail_material_{i + 1}",
                ["video-detail", "submit-and-wait", "--video-url", url],
                max_wait=args.max_wait,
            )
            material_analyses.append(build_material_analysis(detail))

    log("生成分镜计划")
    plan_input = build_plan_input(timeline, args.talking_head_url, host_duration, material_urls, material_types, material_durations, material_analyses, args.topic)
    if material_urls:
        try:
            plan = run_plan_llm(api_key, run_dir, plan_input, max_wait=args.max_wait)
            plan = repair_plan(plan, timeline, material_types)
            write_json(run_dir / "plan.json", plan)
            plan_stats = validate_plan(plan, timeline, material_types)
        except Exception as exc:
            log(f"LLM 分镜校验失败，改用兜底分镜：{exc}")
            plan = fallback_plan(timeline, material_types)
            plan = repair_plan(plan, timeline, material_types)
            write_json(run_dir / "plan.json", plan)
            plan_stats = validate_plan(plan, timeline, material_types)
    else:
        plan = fallback_plan(timeline, material_types)
        plan = repair_plan(plan, timeline, material_types)
        write_json(run_dir / "plan.json", plan)
        plan_stats = validate_plan(plan, timeline, material_types)

    log("创建并写入剪映草稿")
    draft_id, draft_url, draft_name = create_draft(api_key, run_dir, plan.get("draft_title_base") or "口播去气口视频")
    add_talking_head(api_key, run_dir, draft_id, args.talking_head_url, host_duration, timeline)
    add_broll(api_key, run_dir, draft_id, plan, material_urls, material_types, material_durations, max_wait=args.max_wait)
    title_count = add_title(api_key, run_dir, draft_id, plan, int(timeline["target_duration_ms"]))
    subtitle_count = add_subtitles(api_key, run_dir, draft_id, timeline, plan)
    parallel_preset_count = add_effects(api_key, run_dir, draft_id, plan, int(timeline["target_duration_ms"]), timeline)
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
        "target_duration_ms": timeline["target_duration_ms"],
        "removed_duration_ms": timeline["removed_duration_ms"],
        "talking_head_chunks": len(timeline["chunks"]),
        "speech_audio_chunks": len(timeline["chunks"]),
        "title_count": title_count,
        "title_lines": plan.get("title_lines"),
        "title_duration_ms": min(3000, int(timeline["target_duration_ms"])),
        "parallel_preset_count": parallel_preset_count,
        "subtitle_count": subtitle_count,
        "original_subtitle_count": len(timeline["segments"]),
        "broll_count": plan_stats["broll_count"],
        "material_video_count": material_types.count("video"),
        "material_image_count": material_types.count("image"),
        "talking_head_ratio": round(plan_stats["talking_head_ratio"], 4),
        "query_summary": query_summary,
    }
    write_json(run_dir / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
