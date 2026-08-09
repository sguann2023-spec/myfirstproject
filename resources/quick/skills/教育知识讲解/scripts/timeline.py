#!/usr/bin/env python3
"""Build and validate a source-to-target timeline from llm_vad ASR segments."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_ms(value: Any) -> int:
    """VectCut ASR start/end fields are milliseconds."""
    return int(round(_number(value)))


def _extract_words(item: dict[str, Any]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for word in item.get("words") or []:
        if not isinstance(word, dict):
            continue
        text = str(word.get("text") or "").strip()
        start_ms = _as_ms(word.get("start_time", word.get("start_ms", word.get("start", 0))))
        end_ms = _as_ms(word.get("end_time", word.get("end_ms", word.get("end", start_ms))))
        if text and end_ms > start_ms:
            words.append({"text": text, "start_ms": start_ms, "end_ms": end_ms})
    words.sort(key=lambda word: (word["start_ms"], word["end_ms"]))
    return words


def _extract_keywords(item: dict[str, Any]) -> list[dict[str, Any]]:
    keywords: list[dict[str, Any]] = []
    for keyword in item.get("keywords") or []:
        if not isinstance(keyword, dict):
            continue
        text = str(keyword.get("text") or "").strip()
        start_ms = _as_ms(keyword.get("start_time", keyword.get("start_ms", keyword.get("start", 0))))
        end_ms = _as_ms(keyword.get("end_time", keyword.get("end_ms", keyword.get("end", start_ms))))
        if text:
            keywords.append({"text": text, "start_ms": start_ms, "end_ms": end_ms})
    return keywords


def extract_segments(data: Any) -> list[dict[str, Any]]:
    """Normalize a saved ASR response into source-time segments in milliseconds."""
    candidates: list[Any] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                if key in {"segments", "sentences", "utterances"} and isinstance(nested, list):
                    candidates.append(nested)
                walk(nested)
        elif isinstance(value, list):
            for nested in value:
                walk(nested)

    walk(data)
    raw = next((item for item in candidates if item), None)
    if not raw:
        raise ValueError("ASR response does not contain non-empty segments")

    result: list[dict[str, Any]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("content") or item.get("sentence") or "").strip()
        start_ms = _as_ms(item.get("start_ms", item.get("start", 0)))
        end_ms = _as_ms(item.get("end_ms", item.get("end", start_ms)))
        if text and end_ms > start_ms:
            result.append({
                "source_index": int(item.get("source_index", index)),
                "source_start_ms": start_ms,
                "source_end_ms": end_ms,
                "text": text,
                "words": _extract_words(item),
                "keywords": _extract_keywords(item),
            })
    result.sort(key=lambda item: (item["source_start_ms"], item["source_end_ms"]))
    if not result:
        raise ValueError("ASR segments are empty after normalization")
    return result


def trailing_spillover(segment: dict[str, Any], padding_after_ms: int) -> dict[str, Any] | None:
    """Find a word that begins outside the sentence text but inside post-padding."""
    source_end = int(segment["source_end_ms"])
    padding_end = source_end + max(0, padding_after_ms)
    for word in segment.get("words") or []:
        start = int(word.get("start_ms", 0))
        if source_end <= start < padding_end:
            return {
                "source_index": segment.get("source_index"),
                "text": word.get("text", ""),
                "word_start_ms": start,
                "word_end_ms": int(word.get("end_ms", start)),
                "segment_text": segment.get("text", ""),
            }
    return None


def build_timeline(
    segments: list[dict[str, Any]],
    source_duration_ms: int,
    *,
    padding_before_ms: int = 40,
    padding_after_ms: int = 80,
    merge_gap_ms: int = 180,
) -> dict[str, Any]:
    """Create contiguous source chunks and their compact target positions."""
    if source_duration_ms <= 0:
        raise ValueError("source_duration_ms must be positive")

    source_ranges: list[list[int]] = []
    spillovers: list[dict[str, Any]] = []
    for segment in segments:
        after_padding = padding_after_ms
        spillover = trailing_spillover(segment, padding_after_ms)
        if spillover:
            after_padding = max(0, int(spillover["word_start_ms"]) - int(segment["source_end_ms"]))
            spillover["trimmed_padding_after_ms"] = after_padding
            spillovers.append(spillover)
        start = max(0, int(segment["source_start_ms"]) - padding_before_ms)
        end = min(source_duration_ms, int(segment["source_end_ms"]) + after_padding)
        if end <= start:
            continue
        if source_ranges and start - source_ranges[-1][1] <= merge_gap_ms:
            source_ranges[-1][1] = max(source_ranges[-1][1], end)
        else:
            source_ranges.append([start, end])

    chunks: list[dict[str, int]] = []
    target_cursor = 0
    for index, (source_start_ms, source_end_ms) in enumerate(source_ranges):
        duration_ms = source_end_ms - source_start_ms
        chunks.append({
            "chunk_index": index,
            "source_start_ms": source_start_ms,
            "source_end_ms": source_end_ms,
            "target_start_ms": target_cursor,
            "target_end_ms": target_cursor + duration_ms,
            "duration_ms": duration_ms,
        })
        target_cursor += duration_ms

    if not chunks:
        raise ValueError("timeline contains no usable source chunks")
    return {
        "source_duration_ms": source_duration_ms,
        "target_duration_ms": target_cursor,
        "removed_duration_ms": max(0, source_duration_ms - target_cursor),
        "padding_before_ms": padding_before_ms,
        "padding_after_ms": padding_after_ms,
        "merge_gap_ms": merge_gap_ms,
        "trailing_spillovers": spillovers,
        "chunks": chunks,
    }


def remap_interval(start_ms: int, end_ms: int, timeline: dict[str, Any]) -> list[dict[str, int]]:
    """Map one source interval to one or more target intervals."""
    pieces: list[dict[str, int]] = []
    for chunk in timeline["chunks"]:
        overlap_start = max(start_ms, int(chunk["source_start_ms"]))
        overlap_end = min(end_ms, int(chunk["source_end_ms"]))
        if overlap_end <= overlap_start:
            continue
        pieces.append({
            "target_start_ms": int(chunk["target_start_ms"]) + overlap_start - int(chunk["source_start_ms"]),
            "target_end_ms": int(chunk["target_start_ms"]) + overlap_end - int(chunk["source_start_ms"]),
        })
    return pieces


def remap_segments(segments: list[dict[str, Any]], timeline: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for segment in segments:
        pieces = remap_interval(segment["source_start_ms"], segment["source_end_ms"], timeline)
        if not pieces:
            continue
        result.append({
            **segment,
            "target_start_ms": pieces[0]["target_start_ms"],
            "target_end_ms": pieces[-1]["target_end_ms"],
            "target_pieces": pieces,
        })
    return result


def validate_timeline(timeline: dict[str, Any]) -> None:
    chunks = timeline.get("chunks") or []
    if not chunks:
        raise ValueError("timeline chunks are empty")
    cursor = 0
    for index, chunk in enumerate(chunks):
        if int(chunk["chunk_index"]) != index:
            raise ValueError("chunk_index is not sequential")
        if int(chunk["target_start_ms"]) != cursor:
            raise ValueError("target timeline has a gap or overlap")
        if int(chunk["target_end_ms"]) <= int(chunk["target_start_ms"]):
            raise ValueError("chunk has non-positive duration")
        if int(chunk["source_end_ms"]) <= int(chunk["source_start_ms"]):
            raise ValueError("source chunk has non-positive duration")
        cursor = int(chunk["target_end_ms"])
    if cursor != int(timeline["target_duration_ms"]):
        raise ValueError("target_duration_ms does not match chunks")


def _main() -> int:
    parser = argparse.ArgumentParser(description="Build a source-to-target timeline from saved llm_vad ASR JSON")
    parser.add_argument("--asr-json", required=True)
    parser.add_argument("--source-duration", type=float, required=True, help="source video duration in seconds")
    parser.add_argument("--padding-before-ms", type=int, default=40)
    parser.add_argument("--padding-after-ms", type=int, default=80)
    parser.add_argument("--merge-gap-ms", type=int, default=180)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    data = json.loads(Path(args.asr_json).read_text(encoding="utf-8"))
    segments = extract_segments(data)
    timeline = build_timeline(
        segments,
        int(round(args.source_duration * 1000)),
        padding_before_ms=args.padding_before_ms,
        padding_after_ms=args.padding_after_ms,
        merge_gap_ms=args.merge_gap_ms,
    )
    timeline["segments"] = remap_segments(segments, timeline)
    validate_timeline(timeline)
    Path(args.output).write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(timeline, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
