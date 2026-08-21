#!/usr/bin/env python3
"""Generate a local manifest for bundled quick skills.

Usage:
    python3 publish_quick_skill_manifest.py
    python3 publish_quick_skill_manifest.py --dry-run

Workflow:
1. Read each bundled quick skill website entry.
2. Extract preview metadata from `website/index.html`.
3. Extract skill metadata from `SKILL.md`.
4. Detect an optional local cover image in the website folder.
5. Rewrite `manifest.json` with a fresh `updatedAt`.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

PUBLIC_BASE_URL = "https://player.install-ai-guider.top/quick/skills"

SKILL_CONFIGS = [
    {
        "folder_name": "网感口播",
        "name": "网感口播",
        "headline": "高级红双语口播模板",
        "preview_video_url": "https://player.install-ai-guider.top/example/skills/koubo_1f9c/f95ff31e-6a92-4fcd-9b1d-c7421a031f68.mp4",
        "action": "bootstrap-trendy-koubo",
        "version": "1.0.0",
        "order": 1,
    },
    {
        "folder_name": "旅游攻略混剪",
        "action": "bootstrap-travel-guide",
        "version": "1.0.0",
        "order": 2,
    },
    {
        "folder_name": "直播切片",
        "action": "bootstrap-live-clipping",
        "version": "1.0.0",
        "order": 3,
    },
]

TITLE_PATTERN = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
VIDEO_PATTERN = re.compile(r'<video[^>]*?src="([^"]+)"', re.IGNORECASE | re.DOTALL)
HEADING_PATTERN = re.compile(r'<h1 class="preview-heading">(.*?)</h1>', re.IGNORECASE | re.DOTALL)
TAG_PATTERN = re.compile(r"<[^>]+>")
FRONTMATTER_PATTERN = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
FRONTMATTER_DESCRIPTION_PATTERN = re.compile(r'^description:\s*["\']?(.*?)["\']?\s*$', re.MULTILINE)


def parse_args() -> argparse.Namespace:
    default_root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Generate manifest.json for bundled quick skills")
    parser.add_argument(
        "--skills-root",
        default=str(default_root),
        help="Root directory containing quick skill folders and manifest.json",
    )
    parser.add_argument(
        "--manifest",
        default=None,
        help="Path to manifest.json, defaults to <skills-root>/manifest.json",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the generated manifest without writing it to disk",
    )
    return parser.parse_args()


def now_iso8601() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def extract_first(pattern: re.Pattern[str], content: str, field_name: str) -> str:
    matched = pattern.search(content)
    if not matched:
        raise ValueError(f"Cannot find {field_name} in website/index.html")
    return TAG_PATTERN.sub("", matched.group(1)).strip()


def extract_skill_description(skill_md_path: Path) -> str:
    content = skill_md_path.read_text(encoding="utf-8")
    frontmatter_match = FRONTMATTER_PATTERN.search(content)
    if not frontmatter_match:
        raise ValueError(f"Cannot find frontmatter in {skill_md_path}")

    frontmatter = frontmatter_match.group(1)
    description_match = FRONTMATTER_DESCRIPTION_PATTERN.search(frontmatter)
    if not description_match:
        raise ValueError(f"Cannot find description in {skill_md_path}")

    return description_match.group(1).strip()


def detect_cover_relative_path(website_dir: Path, skills_root: Path) -> str:
    for file_name in ("cover.png", "cover.jpg", "cover.jpeg", "cover.webp"):
        candidate = website_dir / file_name
        if candidate.exists():
            return candidate.relative_to(skills_root).as_posix()
    return ""


def build_cover_url(cover_path: str) -> str:
    normalized_cover_path = str(cover_path or "").strip().lstrip("/")
    if not normalized_cover_path:
        return ""
    return f"{PUBLIC_BASE_URL}/{normalized_cover_path}"


def build_manifest(skills_root: Path) -> dict:
    skills: dict[str, dict] = {}
    for config in SKILL_CONFIGS:
        folder_name = config["folder_name"]
        website_dir = skills_root / folder_name / "website"
        website_path = website_dir / "index.html"
        skill_md_path = skills_root / folder_name / "SKILL.md"
        if not skill_md_path.exists():
            raise FileNotFoundError(f"Skill file not found: {skill_md_path}")

        title = str(config.get("name") or folder_name).strip()
        headline = str(config.get("headline") or "").strip()
        preview_video_url = str(config.get("preview_video_url") or "").strip()
        website_relative_path = ""
        cover_path = ""

        if website_path.exists():
            content = website_path.read_text(encoding="utf-8")
            title = extract_first(TITLE_PATTERN, content, "title")
            preview_video_url = extract_first(VIDEO_PATTERN, content, "preview video url")
            headline = extract_first(HEADING_PATTERN, content, "preview heading")
            website_relative_path = website_path.relative_to(skills_root).as_posix()
            cover_path = detect_cover_relative_path(website_dir, skills_root)

        description = extract_skill_description(skill_md_path)

        skills[folder_name] = {
            "version": config["version"],
            "name": title,
            "folderName": folder_name,
            "action": config["action"],
            "order": config["order"],
            "headline": headline,
            "description": description,
            "websitePath": website_relative_path,
            "coverPath": cover_path,
            "coverUrl": build_cover_url(cover_path),
            "previewVideoUrl": preview_video_url,
        }

    return {
        "updatedAt": now_iso8601(),
        "skills": skills,
    }


def main() -> int:
    args = parse_args()
    skills_root = Path(args.skills_root).resolve()
    manifest_path = Path(args.manifest).resolve() if args.manifest else skills_root / "manifest.json"
    manifest = build_manifest(skills_root)

    if args.dry_run:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        return 0

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Manifest updated: {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
