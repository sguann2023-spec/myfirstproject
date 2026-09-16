#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Atomic runner scaffold for koubo-c6f1-brush-pip.

This script intentionally does not import or call the repository's
koubo_c6f1 template function. It keeps the style constants and validation
rules close to the skill so a caller can implement the VectCut API steps
with atomic calls only.
"""

import argparse
import json
import math
import os
import re
from datetime import datetime


PROMOTION_TEMPLATE_ID = "7351211478738849035"
SELF_REVIEW_TEMPLATE_ID = "7393022390638251303"
PIP_EDGE_GUARD_SECONDS = 2.0


def valid_pip_window(start, end, total_duration, min_duration=0.0):
    """Keep model-planned material windows away from both timeline edges."""
    start = float(start)
    end = float(end)
    total_duration = float(total_duration)
    return (
        total_duration > PIP_EDGE_GUARD_SECONDS * 2
        and start >= PIP_EDGE_GUARD_SECONDS
        and end > start
        and end <= total_duration - PIP_EDGE_GUARD_SECONDS
        and end - start >= float(min_duration)
    )


def title_items(title_lines, total_duration):
    end = min(3.0, float(total_duration or 0.0)) or 3.0
    lines = [str(line or "").strip() for line in (title_lines or []) if str(line or "").strip()]
    if not lines:
        return []
    base = {
        "start": 0.0,
        "end": end,
        "font": "新青年体",
        "border_color": "#000000",
        "fixed_width": 0.78,
        "transform_x_px": 0,
    }
    items = [{
        **base,
        "track_name": "koubo_c6f1_title_top",
        "text": lines[0][:6],
        "font_size": 20,
        "font_color": "#FFD320",
        "border_width": 25,
        "transform_y_px": 1260,
        "relative_index": 15000,
    }]
    if len(lines) > 1:
        items.append({
            **base,
            "track_name": "koubo_c6f1_title_bottom",
            "text": lines[1][:8],
            "font_size": 15,
            "font_color": "#ffffff",
            "border_width": 30,
            "transform_y_px": 1000,
            "relative_index": 15010,
        })
    return items


def subtitle_item(segment, index):
    text = str((segment or {}).get("text") or "").strip()
    start = float((segment or {}).get("start") or 0.0)
    end = float((segment or {}).get("end") or start + 0.1)
    return {
        "track_name": "koubo_c6f1_subtitle",
        "text": text,
        "start": round(start, 3),
        "end": round(max(end, start + 0.1), 3),
        "font": "毛笔行楷",
        "font_color": "#ffffff",
        "font_size": 12,
        "font_alpha": 1.0,
        "border_color": "#000000",
        "border_width": 30,
        "background_alpha": 0,
        "shadow_enabled": False,
        "transform_y_px": -700,
        "align": 1,
        "fixed_width": 0.65,
        "relative_index": 16000 + int(index),
    }


def ranges_overlap(start, end, other_start, other_end):
    return float(start) < float(other_end) and float(end) > float(other_start)


def normalize_keyword_items(raw_items, segments, total_duration):
    segment_by_index = {str(item.get("source_index")): item for item in (segments or [])}
    per_template_limit = max(1, int(math.ceil(max(float(total_duration or 1.0), 1.0) / 60.0)) * 2)
    template_counts = {}
    used_ranges = []
    result = []
    for raw in raw_items or []:
        category = str(raw.get("category") or "").strip()
        template_id = PROMOTION_TEMPLATE_ID if category == "promotion" else SELF_REVIEW_TEMPLATE_ID if category == "self_review" else ""
        if not template_id or template_counts.get(template_id, 0) >= per_template_limit:
            continue
        segment = segment_by_index.get(str(raw.get("source_index") or "").strip())
        if not segment:
            continue
        keyword = re.sub(r"\s+", "", str(raw.get("keyword") or ""))[:8]
        if len(keyword) < 2:
            continue
        seg_start = float(segment.get("start") or 0.0)
        seg_end = float(segment.get("end") or seg_start + 1.0)
        start = max(seg_start, min(float(raw.get("start") or seg_start), seg_end))
        end = max(start + 0.6, min(float(raw.get("end") or start + 1.5), seg_end))
        if any(ranges_overlap(start, end, used_start, used_end) for used_start, used_end in used_ranges):
            continue
        result.append({
            "template_id": template_id,
            "texts": [keyword],
            "start": round(start, 3),
            "end": round(end, 3),
            "track_name": "koubo_c6f1_keyword",
        })
        template_counts[template_id] = template_counts.get(template_id, 0) + 1
        used_ranges.append((start, end))
        if len(result) >= 4:
            break
    return result


def material_pip_video_item(video_url, target_start, duration):
    return {
        "video_url": video_url,
        "start": 0.0,
        "end": round(float(duration), 3),
        "duration": round(float(duration), 3),
        "target_start": round(float(target_start), 3),
        "volume": -100,
        "track_name": "koubo_c6f1_material_pip_video",
        "relative_index": 11000,
        "scale_x": 0.58,
        "scale_y": 0.58,
        "transform_x": 0,
        "transform_y": 0,
    }


def blur_effect_item(target_start, duration):
    start = float(target_start)
    end = start + float(duration)
    return {
        "effect_type": "模糊",
        "effect_category": "scene",
        "start": round(start, 3),
        "end": round(end, 3),
        "track_name": "koubo_c6f1_material_pip_blur",
        "relative_index": 100,
        "intensity": 100,
    }


def run_dry():
    segments = [
        {"source_index": 1, "text": "这款早餐很适合上班族", "start": 0.0, "end": 2.0},
        {"source_index": 2, "text": "今天有限时优惠", "start": 3.0, "end": 5.0},
    ]
    titles = title_items(["元气早餐", "三分钟搞定"], 10.0)
    subtitles = [subtitle_item(item, index) for index, item in enumerate(segments, start=1)]
    keywords = normalize_keyword_items([
        {"source_index": 2, "keyword": "限时优惠", "category": "promotion", "start": 3.0, "end": 4.2},
    ], segments, 60.0)
    pip = material_pip_video_item("https://example.com/material.mp4", 6.0, 2.5)
    blur = blur_effect_item(6.0, 2.5)
    assert titles[0]["end"] == 3.0
    assert subtitles[0]["font"] == "毛笔行楷"
    assert keywords[0]["track_name"] == "koubo_c6f1_keyword"
    assert blur["relative_index"] == 100
    assert pip["relative_index"] == 11000
    assert pip["relative_index"] > blur["relative_index"]
    assert valid_pip_window(6.0, 8.5, 12.0, 2.0)
    assert not valid_pip_window(0.0, 2.5, 12.0, 2.0)
    assert not valid_pip_window(8.5, 10.5, 12.0, 2.0)
    print(json.dumps({
        "stage": "dry_run_passed",
        "title_items": titles,
        "subtitle_items": subtitles,
        "keyword_items": keywords,
        "material_pip_video_item": pip,
        "blur_effect_item": blur,
    }, ensure_ascii=False, indent=2))


def run_full(_args):
    raise RuntimeError(
        "This scaffold documents the atomic implementation path. "
        "For production execution, implement the remote calls using "
        "pipeline.tasks atomics listed in references/api-contracts.md; "
        "do not call the koubo_c6f1 template function."
    )


def main():
    parser = argparse.ArgumentParser(description="koubo-c6f1 atomic skill scaffold")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--jwt-token", default=os.getenv("VECTCUT_JWT_TOKEN", ""))
    parser.add_argument("--video-url", default="")
    parser.add_argument("--title", default="")
    parser.add_argument("--text-content", default="")
    parser.add_argument("--material-url", action="append", default=[])
    parser.add_argument("--remove-silence", default="true")
    parser.add_argument("--message-id", default="koubo_c6f1_skill_" + datetime.now().strftime("%Y%m%d_%H%M%S"))
    args = parser.parse_args()
    if args.dry_run:
        run_dry()
        return
    run_full(args)


if __name__ == "__main__":
    main()
